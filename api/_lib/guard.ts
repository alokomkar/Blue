// Request guards shared by every /api/ai endpoint: size caps, parsing, same-origin CORS, a per-IP token
// bucket and a content-hash cache.
//
// Vercel runs each function in its own instances and they do not share memory, so the rate limiter and the
// cache below are best-effort (a burst that lands on several instances gets several buckets). They cap cost
// and blunt abuse on a hackathon link; they are not a security boundary. Put a real limit on the Meta
// billing page too.

import { createHash } from 'node:crypto';

export const LIMITS = {
  promptChars: 500,
  /** A JSON request body (prompts, story context). */
  jsonBytes: 16 * 1024,
  storyContextBytes: 4_000,
  audioBytes: 1_000_000,
  audioSeconds: 10,
  /** Room for the multipart envelope around the audio part. */
  multipartSlack: 16 * 1024,
  imageBytes: 4 * 1024 * 1024,
  keywords: 50,
  keywordChars: 40,
} as const;

export class GuardError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'GuardError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

// ---- Responses ----

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function guardResponse(e: GuardError): Response {
  return json(e.status, { error: e.code, message: e.message }, e.headers);
}

// ---- Body size and parsing ----

/** Reads a request body, refusing as soon as it is larger than `maxBytes` (declared or actual). */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw new GuardError(400, 'bad_length', 'Invalid Content-Length');
    if (n > maxBytes) throw new GuardError(413, 'too_large', `Body is larger than ${maxBytes} bytes`);
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GuardError(413, 'too_large', `Body is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function parseJson(request: Request, maxBytes: number = LIMITS.jsonBytes): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    throw new GuardError(415, 'unsupported_media_type', 'Expected application/json');
  }
  const bytes = await readBody(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GuardError(400, 'bad_json', 'Body is not valid JSON');
  }
}

export async function parseMultipart(request: Request, maxBytes: number): Promise<FormData> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw new GuardError(415, 'unsupported_media_type', 'Expected multipart/form-data');
  }
  const bytes = await readBody(request, maxBytes);
  try {
    return await new Request('http://local.invalid/', { method: 'POST', headers: { 'content-type': type }, body: bytes as Uint8Array<ArrayBuffer> }).formData();
  } catch {
    throw new GuardError(400, 'bad_multipart', 'Body is not valid multipart/form-data');
  }
}

/** A file part's bytes, or null when the part is missing or is plain text. */
export async function filePart(form: FormData, name: string): Promise<Uint8Array | null> {
  const part = form.get(name);
  return part instanceof Blob ? new Uint8Array(await part.arrayBuffer()) : null;
}

// ---- Media checks ----

/** Checks a WAV is mono 16-bit PCM at 16 or 24 kHz and at most 10 s. Returns its length in seconds. */
export function checkWav(bytes: Uint8Array): { sampleRate: number; seconds: number } {
  if (bytes.length > LIMITS.audioBytes) throw new GuardError(413, 'audio_too_large', `Audio is larger than ${LIMITS.audioBytes} bytes`);
  const bad = (msg: string) => new GuardError(400, 'bad_audio', msg);
  if (bytes.length < 44) throw bad('Not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw bad('Not a WAV file');

  let sampleRate = 0;
  let dataBytes = -1;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ' && at + 8 + 16 <= bytes.length) {
      const format = view.getUint16(at + 8, true);
      const channels = view.getUint16(at + 10, true);
      sampleRate = view.getUint32(at + 12, true);
      const bits = view.getUint16(at + 22, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw bad('WAV must be mono 16-bit PCM');
      if (sampleRate !== 16000 && sampleRate !== 24000) throw bad('WAV sample rate must be 16000 or 24000 Hz');
    } else if (tag(at) === 'data') {
      dataBytes = Math.min(size, bytes.length - (at + 8)); // streamed WAVs may declare more than they hold
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (sampleRate === 0 || dataBytes < 0) throw bad('WAV has no fmt or data chunk');
  const seconds = dataBytes / (sampleRate * 2);
  if (seconds > LIMITS.audioSeconds) throw new GuardError(413, 'audio_too_long', `Audio is longer than ${LIMITS.audioSeconds} s`);
  if (seconds <= 0) throw bad('WAV holds no audio');
  return { sampleRate, seconds };
}

/** Sniffs PNG or JPEG by magic number (the declared type is not trusted) and applies the 4 MB cap. */
export function checkImage(bytes: Uint8Array): { mime: 'image/png' | 'image/jpeg' } {
  if (bytes.length > LIMITS.imageBytes) throw new GuardError(413, 'image_too_large', `Image is larger than ${LIMITS.imageBytes} bytes`);
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg' };
  throw new GuardError(415, 'bad_image', 'Image must be PNG or JPEG');
}

// ---- Same-origin CORS ----

/**
 * The endpoints are for the game page on the same origin, so no Access-Control-Allow-* header is ever sent
 * and cross-origin browser requests are refused here too. This protects users' browsers, not the API: a
 * script can forge any header, which is what the rate limit is for.
 */
export function checkOrigin(request: Request): GuardError | null {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin !== null) {
    const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host).split(',')[0]!.trim();
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* "null" or garbage */
    }
    if (originHost !== host) return new GuardError(403, 'cross_origin', 'Cross-origin requests are not allowed');
  } else if (fetchSite === 'cross-site') {
    return new GuardError(403, 'cross_origin', 'Cross-origin requests are not allowed');
  }
  return null;
}

// ---- Rate limit ----

export function clientIp(request: Request): string {
  const h = request.headers;
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  return first(h.get('x-vercel-forwarded-for')) ?? first(h.get('x-real-ip')) ?? first(h.get('x-forwarded-for')) ?? 'unknown';
}

export interface RateLimiter {
  take(key: string, cost?: number): { ok: true } | { ok: false; retryAfterSec: number };
}

/** In-memory token bucket per key: `capacity` tokens, refilled at `refillPerSec`. Best-effort, see the file note. */
export function createRateLimiter(opts: { capacity: number; refillPerSec: number; maxKeys?: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 5_000;
  const buckets = new Map<string, { tokens: number; last: number }>();
  return {
    take(key, cost = 1) {
      const t = now();
      const b = buckets.get(key) ?? { tokens: opts.capacity, last: t };
      b.tokens = Math.min(opts.capacity, b.tokens + ((t - b.last) / 1000) * opts.refillPerSec);
      b.last = t;
      buckets.delete(key); // re-insert so the Map's order is least-recently-used first
      buckets.set(key, b);
      if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value as string);
      if (b.tokens >= cost) {
        b.tokens -= cost;
        return { ok: true };
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cost - b.tokens) / opts.refillPerSec)) };
    },
  };
}

// ---- Content-hash cache ----

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** SHA-256 over the parts (strings, bytes, or JSON-able values with sorted keys), as hex. */
export function contentHash(...parts: unknown[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p instanceof Uint8Array ? p : stable(p));
    h.update('\u0000');
  }
  return h.digest('hex');
}

export interface LruCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
}

export function createLruCache<V>(opts: { max: number; ttlMs?: number; now?: () => number }): LruCache<V> {
  const now = opts.now ?? Date.now;
  const map = new Map<string, { value: V; at: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (opts.ttlMs !== undefined && now() - hit.at > opts.ttlMs) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, at: now() });
      if (map.size > opts.max) map.delete(map.keys().next().value as string);
    },
    get size() {
      return map.size;
    },
  };
}
