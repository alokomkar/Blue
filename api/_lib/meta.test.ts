import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaError, createMeta, chatText, redact, type Env } from './meta.ts';

const KEY = 'sk-test-SECRET-0123456789';
const env: Env = { MODEL_API_KEY: KEY };

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const chatOk = () => ok({ choices: [{ message: { role: 'assistant', content: 'hi' } }] });

function client(responses: Array<Response | Error>, extra: Partial<Parameters<typeof createMeta>[0]> = {}) {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const meta = createMeta({ env: () => env, fetch: f.fn, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, ...extra });
  return { meta, calls: f.calls, sleeps };
}

test('chat posts to the configured base URL with the bearer key and default model', async () => {
  const c = client([chatOk()]);
  const res = await c.meta.chat({ messages: [{ role: 'user', content: 'x' }], reasoning_effort: 'low' });
  assert.equal(chatText(res), 'hi');
  assert.equal(c.calls[0]!.url, 'https://api.meta.ai/v1/chat/completions');
  const headers = c.calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(c.calls[0]!.init.body as string);
  assert.equal(body.model, 'muse-spark-1.3');
  assert.equal(body.reasoning_effort, 'low');
});

test('LLM_BASE_URL and LLM_MODEL redirect the same client (open-weight run)', async () => {
  const f = fakeFetch([chatOk()]);
  const meta = createMeta({ env: () => ({ ...env, LLM_BASE_URL: 'https://example.test/v1/', LLM_MODEL: 'open-model' }), fetch: f.fn });
  await meta.chat({ messages: [] });
  assert.equal(f.calls[0]!.url, 'https://example.test/v1/chat/completions');
  assert.equal(JSON.parse(f.calls[0]!.init.body as string).model, 'open-model');
  assert.equal(meta.openWeights(), true);
});

test('retries on 429 with backoff, then succeeds', async () => {
  const c = client([new Response('{}', { status: 429 }), new Response('{}', { status: 503 }), chatOk()]);
  await c.meta.chat({ messages: [] });
  assert.equal(c.calls.length, 3);
  assert.equal(c.sleeps.length, 2);
  assert.ok(c.sleeps[1]! > c.sleeps[0]!, 'backoff grows');
});

test('honours Retry-After seconds', async () => {
  const c = client([new Response('{}', { status: 429, headers: { 'retry-after': '2' } }), chatOk()]);
  await c.meta.chat({ messages: [] });
  assert.deepEqual(c.sleeps, [2000]);
});

test('a Retry-After longer than the cap gives up as rate_limited without waiting', async () => {
  const c = client([new Response('{}', { status: 429, headers: { 'retry-after': '120' } })]);
  await assert.rejects(c.meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'rate_limited');
  assert.equal(c.sleeps.length, 0);
});

test('gives up after maxRetries and types the error', async () => {
  const c = client([new Response('{}', { status: 503 }), new Response('{}', { status: 503 }), new Response('{}', { status: 503 })], { maxRetries: 2 });
  await assert.rejects(c.meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'unavailable' && e.status === 503);
  assert.equal(c.calls.length, 3);
});

test('does not retry other statuses', async () => {
  const c = client([new Response('{"error":{"message":"bad model"}}', { status: 400 })]);
  await assert.rejects(c.meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'bad_request' && /bad model/.test(e.message));
  assert.equal(c.calls.length, 1);
});

test('no key: typed error and no request made', async () => {
  const f = fakeFetch([]);
  const meta = createMeta({ env: () => ({}), fetch: f.fn });
  await assert.rejects(meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'no_key');
  assert.equal(f.calls.length, 0);
  assert.equal(meta.hasKey(), false);
});

test('a hung request becomes a timeout error', async () => {
  const hang = (async (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason));
    })) as typeof fetch;
  const meta = createMeta({ env: () => env, fetch: hang, timeoutMs: 20 });
  await assert.rejects(meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'timeout');
});

test('malformed success bodies are bad_response', async () => {
  await assert.rejects(client([ok({ nope: 1 })]).meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'bad_response');
  await assert.rejects(client([new Response('<html>', { status: 200 })]).meta.chat({ messages: [] }), (e) => e instanceof MetaError && e.kind === 'bad_response');
});

test('the key never appears in errors or in console output, even when upstream echoes it', async () => {
  const logged: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(saved) as Array<keyof typeof saved>) console[k] = (...a: unknown[]) => void logged.push(a.join(' '));
  const echoes = [
    new Response(JSON.stringify({ error: { message: `invalid key ${KEY}` } }), { status: 401 }),
    new Error(`connect failed with Authorization: Bearer ${KEY}`),
  ];
  const seen: string[] = [];
  try {
    for (const r of echoes) {
      try {
        await client([r]).meta.chat({ messages: [] });
      } catch (e) {
        seen.push(String((e as Error).message), String((e as Error).stack ?? ''), JSON.stringify(e));
      }
    }
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(seen.length, 6);
  for (const s of [...seen, ...logged]) assert.ok(!s.includes(KEY), 'key leaked');
});

test('redact strips bearer tokens', () => {
  assert.equal(redact('x Bearer abc.def-1 y', {}), 'x Bearer [redacted] y');
});

test('transcribe builds the multipart request and parses the transcript', async () => {
  const wav = new Uint8Array([1, 2, 3, 4]);
  const c = client([ok({ sessionId: 's', transcript: 'cover me', audioDurationMs: 900, turns: [] })]);
  const out = await c.meta.transcribe(wav, { keywords: ['lift', 'EMP'], mode: 'PUSH_TO_TALK' });
  assert.deepEqual(out, { transcript: 'cover me', audioDurationMs: 900, sessionId: 's', turns: [] });
  assert.equal(c.calls[0]!.url, 'https://api.meta.ai/v1/asr/transcribe');
  const headers = c.calls[0]!.init.headers as Record<string, string>;
  const boundary = /boundary=(.+)$/.exec(headers['content-type']!)![1]!;
  const text = new TextDecoder('latin1').decode(c.calls[0]!.init.body as Uint8Array);
  assert.ok(text.includes(`--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n`));
  assert.ok(text.includes('name="audio"; filename="audio.wav"'));
  const json = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(text)![1]!);
  assert.deepEqual(json, { mode: 'PUSH_TO_TALK', model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', keywords: ['lift', 'EMP'] });
  assert.ok(!text.includes(KEY));
});

test('image returns the base64 payload and asks for b64_json', async () => {
  const c = client([ok({ data: [{ b64_json: 'QUJD' }] })]);
  const out = await c.meta.image('a poster', { size: '1024x1024' });
  assert.equal(out.b64, 'QUJD');
  assert.deepEqual(JSON.parse(c.calls[0]!.init.body as string), { model: 'muse-image-1.0', prompt: 'a poster', response_format: 'b64_json', n: 1, size: '1024x1024' });
  await assert.rejects(client([ok({ data: [] })]).meta.image('x'), (e) => e instanceof MetaError && e.kind === 'bad_response');
});

test('responses passes the body through', async () => {
  const c = client([ok({ id: 'r1' })]);
  await c.meta.responses({ model: 'sam-3.1', input: 'wall' });
  assert.equal(c.calls[0]!.url, 'https://api.meta.ai/v1/responses');
});
