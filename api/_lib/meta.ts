// A small client for the Meta Model API (OpenAI-compatible at https://api.meta.ai/v1), on plain `fetch`.
//
// The key is read from the environment on every call and is only ever placed in the Authorization header.
// Nothing here logs, and every error message is passed through `redact`, so the key can't reach a log line
// or a response body by way of an error.

export type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

export type Models = { text: string; planner: string; image: string; asr: string; sam: string };

export function modelsFromEnv(env: Env): Models {
  return {
    text: env.MODEL_TEXT || 'muse-spark-1.3',
    planner: env.MODEL_PLANNER || 'muse-spark-1.3',
    image: env.MODEL_IMAGE || 'muse-image-1.0',
    asr: env.MODEL_ASR || 'muse-voice-transcribe-1.0',
    sam: env.MODEL_SAM || 'sam-3.1',
  };
}

/** The model a chat call uses by default. LLM_MODEL (the open-weight run) beats the per-role name. */
export function chatModel(env: Env, role: 'text' | 'planner' = 'text'): string {
  return env.LLM_MODEL || modelsFromEnv(env)[role];
}

export type MetaErrorKind =
  | 'no_key' // MODEL_API_KEY is not set
  | 'timeout'
  | 'network'
  | 'rate_limited' // 429 that outlasted the retries (or asked us to wait longer than we may)
  | 'unavailable' // 503 that outlasted the retries
  | 'bad_request' // 400/422: our request was rejected
  | 'upstream' // any other non-2xx
  | 'bad_response'; // 2xx whose body is not what we expect

/** Every failure of the client. Handlers branch on `kind` and answer with a fallback. */
export class MetaError extends Error {
  readonly kind: MetaErrorKind;
  readonly status: number | undefined;
  constructor(kind: MetaErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'MetaError';
    this.kind = kind;
    this.status = status;
  }
}

/** Removes the key, and anything shaped like a bearer token, from text that may be shown or logged. */
export function redact(text: string, env: Env): string {
  let out = text;
  const key = env.MODEL_API_KEY;
  if (key) out = out.split(key).join('[redacted]');
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

// ---- Wire types (only the parts we read) ----

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
};

export type ChatParams = {
  model?: string;
  messages: ChatMessage[];
  response_format?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  reasoning_effort?: string;
  temperature?: number;
  max_tokens?: number;
};

export type ChatCompletion = {
  id?: string;
  model?: string;
  choices: Array<{
    message: { role?: string; content: string | null; tool_calls?: Array<Record<string, unknown>> };
    finish_reason?: string;
  }>;
  usage?: Record<string, number>;
};

export type ResponsesParams = { model: string; input: unknown; [extra: string]: unknown };
export type TranscribeMode = 'PUSH_TO_TALK' | 'ENDPOINTING' | 'DIARIZATION';
export type TranscribeResult = { transcript: string; audioDurationMs?: number; sessionId?: string; turns?: unknown[] };
export type ImageResult = { b64: string; mime: 'image/png' };

/** What handlers depend on; tests pass a fake. */
export interface MetaClient {
  chat(params: ChatParams): Promise<ChatCompletion>;
  responses(params: ResponsesParams): Promise<unknown>;
  transcribe(wav: Uint8Array, opts?: { keywords?: string[]; mode?: TranscribeMode }): Promise<TranscribeResult>;
  image(prompt: string, opts?: { size?: string }): Promise<ImageResult>;
  hasKey(): boolean;
  /** True when LLM_BASE_URL points somewhere other than Meta (the open-weight run). */
  openWeights(): boolean;
  models(): Models;
}

/** The text of the first choice, or '' when there is none. */
export function chatText(completion: ChatCompletion): string {
  return completion.choices[0]?.message.content ?? '';
}

export type MetaOptions = {
  env?: () => Env;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Per attempt, including reading the body. Default 25 s. */
  timeoutMs?: number;
  /** Retries after the first attempt, on 429 and 503 only. Default 3. */
  maxRetries?: number;
  baseDelayMs?: number;
  /** Longest single wait. A Retry-After above this gives up instead of waiting. */
  maxDelayMs?: number;
};

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The multipart body of POST /v1/asr/transcribe, built by hand so the JSON part carries no filename. */
export function transcribeBody(request: Record<string, unknown>, wav: Uint8Array, boundary: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  return concat([
    enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(request)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    wav,
    enc.encode(`\r\n--${boundary}--\r\n`),
  ]);
}

export function createMeta(options: MetaOptions = {}): MetaClient {
  const getEnv = options.env ?? (() => process.env);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;

  async function post(path: string, body: string | Uint8Array<ArrayBuffer>, contentType: string): Promise<unknown> {
    const env = getEnv();
    const key = env.MODEL_API_KEY;
    if (!key) throw new MetaError('no_key', 'MODEL_API_KEY is not set');
    const url = `${(env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')}${path}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
      try {
        const signal = controller.signal;
        res = await doFetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': contentType, accept: 'application/json' },
          body,
          signal,
        });
        text = await res.text();
      } catch (e) {
        const name = e instanceof Error ? e.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') throw new MetaError('timeout', `Meta API timed out after ${timeoutMs} ms`);
        throw new MetaError('network', redact(`Meta API request failed: ${e instanceof Error ? e.message : String(e)}`, env));
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new MetaError('bad_response', 'Meta API returned a body that is not JSON', res.status);
        }
      }

      const retryable = res.status === 429 || res.status === 503;
      if (retryable && attempt < maxRetries) {
        const asked = parseRetryAfter(res.headers.get('retry-after'), Date.now());
        if (asked !== null && asked > maxDelayMs) break; // told to wait longer than a function may
        const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        const backoff = ceiling / 2 + (random() * ceiling) / 2; // equal jitter
        await sleep(asked !== null ? Math.max(asked, 0) : backoff);
        continue;
      }
      throw failure(res.status, text, env);
    }
    // Only reached by the Retry-After break above: that was a 429 or 503.
    throw new MetaError('rate_limited', 'Meta API asked for a longer wait than allowed', 429);
  }

  function failure(status: number, text: string, env: Env): MetaError {
    let detail = '';
    try {
      const parsed: unknown = JSON.parse(text);
      const err = (parsed as { error?: { message?: unknown } | string } | null)?.error;
      detail = typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : '';
    } catch {
      /* not JSON: say nothing about the body */
    }
    const message = redact(`Meta API ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, env);
    const kind: MetaErrorKind =
      status === 429 ? 'rate_limited' : status === 503 ? 'unavailable' : status === 400 || status === 422 ? 'bad_request' : 'upstream';
    return new MetaError(kind, message, status);
  }

  const postJson = (path: string, payload: unknown) => post(path, JSON.stringify(payload), 'application/json');

  return {
    async chat(params) {
      const env = getEnv();
      const { model, ...rest } = params;
      const out = await postJson('/chat/completions', { model: model ?? chatModel(env, 'text'), ...rest });
      const choices = (out as { choices?: unknown } | null)?.choices;
      if (!Array.isArray(choices)) throw new MetaError('bad_response', 'chat response has no choices');
      return out as ChatCompletion;
    },

    async responses(params) {
      return postJson('/responses', params);
    },

    async transcribe(wav, opts = {}) {
      const env = getEnv();
      const request: Record<string, unknown> = {
        mode: opts.mode ?? 'PUSH_TO_TALK',
        model: modelsFromEnv(env).asr,
        audioEncoding: 'WAV',
      };
      if (opts.keywords && opts.keywords.length > 0) request.keywords = opts.keywords;
      const boundary = `----blueprint${Math.floor(random() * 1e9).toString(36)}${Date.now().toString(36)}`;
      const out = (await post('/asr/transcribe', transcribeBody(request, wav, boundary), `multipart/form-data; boundary=${boundary}`)) as {
        transcript?: unknown;
        audioDurationMs?: unknown;
        sessionId?: unknown;
        turns?: unknown;
      } | null;
      if (typeof out?.transcript !== 'string') throw new MetaError('bad_response', 'transcribe response has no transcript');
      const result: TranscribeResult = { transcript: out.transcript };
      if (typeof out.audioDurationMs === 'number') result.audioDurationMs = out.audioDurationMs;
      if (typeof out.sessionId === 'string') result.sessionId = out.sessionId;
      if (Array.isArray(out.turns)) result.turns = out.turns;
      return result;
    },

    async image(prompt, opts = {}) {
      const payload: Record<string, unknown> = { model: modelsFromEnv(getEnv()).image, prompt, response_format: 'b64_json', n: 1 };
      if (opts.size) payload.size = opts.size;
      const out = (await postJson('/images/generations', payload)) as { data?: Array<{ b64_json?: unknown }> } | null;
      const b64 = out?.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || b64.length === 0) throw new MetaError('bad_response', 'image response has no b64_json');
      return { b64, mime: 'image/png' };
    },

    hasKey: () => Boolean(getEnv().MODEL_API_KEY),
    openWeights: () => Boolean(getEnv().LLM_BASE_URL),
    models: () => modelsFromEnv(getEnv()),
  };
}

let shared: MetaClient | undefined;
/** The process-wide client over process.env; created on first use so importing a handler never throws. */
export function defaultMeta(): MetaClient {
  return (shared ??= createMeta());
}
