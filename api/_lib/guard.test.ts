import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GuardError,
  LIMITS,
  checkImage,
  checkOrigin,
  checkWav,
  clientIp,
  contentHash,
  createLruCache,
  createRateLimiter,
  parseJson,
  parseMultipart,
  readBody,
} from './guard.ts';
import { wav } from './testing.ts';

const post = (body: string | Uint8Array | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/ai/x', { method: 'POST', headers, body });
const rejects = (p: Promise<unknown> | (() => unknown), status: number, code: string) =>
  assert.rejects(Promise.resolve().then(() => (typeof p === 'function' ? p() : p)), (e) => e instanceof GuardError && e.status === status && e.code === code);

test('readBody refuses a body whose Content-Length is over the cap', async () => {
  await rejects(readBody(post('x'.repeat(100), { 'content-length': '100' }), 50), 413, 'too_large');
});

test('readBody refuses an oversize body that declares no length (streamed)', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(10));
      c.close();
    },
  });
  const req = new Request('http://localhost/', { method: 'POST', body: stream, duplex: 'half' } as ConstructorParameters<typeof Request>[1]);
  await rejects(readBody(req, 50), 413, 'too_large');
  const ok = new Request('http://localhost/', { method: 'POST', body: new Uint8Array(40) });
  assert.equal((await readBody(ok, 50)).length, 40);
});

test('parseJson: content type, syntax and size', async () => {
  const j = { 'content-type': 'application/json' };
  assert.deepEqual(await parseJson(post('{"a":1}', j)), { a: 1 });
  await rejects(parseJson(post('{"a":1}', { 'content-type': 'text/plain' })), 415, 'unsupported_media_type');
  await rejects(parseJson(post('{oops', j)), 400, 'bad_json');
  await rejects(parseJson(post(JSON.stringify({ a: 'x'.repeat(LIMITS.jsonBytes) }), j)), 413, 'too_large');
});

test('parseMultipart round-trips a file part and rejects the wrong type', async () => {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])]), 'a.wav');
  form.append('mode', 'PUSH_TO_TALK');
  const req = new Request('http://localhost/', { method: 'POST', body: form });
  const got = await parseMultipart(req, 10_000);
  assert.equal(got.get('mode'), 'PUSH_TO_TALK');
  assert.ok(got.get('audio') instanceof Blob);
  await rejects(parseMultipart(post('x', { 'content-type': 'application/json' }), 10_000), 415, 'unsupported_media_type');
  const big = new FormData();
  big.append('audio', new Blob([new Uint8Array(5_000)]), 'a.wav');
  await rejects(parseMultipart(new Request('http://localhost/', { method: 'POST', body: big }), 1_000), 413, 'too_large');
});

test('checkWav accepts <= 10 s mono 16-bit and rejects the rest', () => {
  assert.equal(checkWav(wav(2)).seconds, 2);
  assert.equal(checkWav(wav(1, 24000)).sampleRate, 24000);
  assert.throws(() => checkWav(wav(11)), (e) => e instanceof GuardError && (e.code === 'audio_too_long' || e.code === 'audio_too_large'));
  assert.throws(() => checkWav(wav(1, 44100)), (e) => e instanceof GuardError && e.code === 'bad_audio');
  assert.throws(() => checkWav(wav(1, 16000, { channels: 2 })), (e) => e instanceof GuardError && e.code === 'bad_audio');
  assert.throws(() => checkWav(new Uint8Array(100)), (e) => e instanceof GuardError && e.code === 'bad_audio');
  assert.throws(() => checkWav(new Uint8Array(LIMITS.audioBytes + 1)), (e) => e instanceof GuardError && e.code === 'audio_too_large');
});

test('a WAV over 10 s but under 1 MB is refused for length', () => {
  // 24 kHz mono 16-bit is 48000 bytes a second, so 11 s is 528 kB.
  assert.throws(() => checkWav(wav(11, 24000)), (e) => e instanceof GuardError && e.code === 'audio_too_long');
});

test('checkImage sniffs magic numbers and caps size', () => {
  assert.equal(checkImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])).mime, 'image/png');
  assert.equal(checkImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).mime, 'image/jpeg');
  assert.throws(() => checkImage(new Uint8Array([1, 2, 3, 4])), (e) => e instanceof GuardError && e.status === 415);
  assert.throws(() => checkImage(new Uint8Array(LIMITS.imageBytes + 1)), (e) => e instanceof GuardError && e.status === 413);
});

test('checkOrigin allows same-origin and no-origin, refuses cross-origin', () => {
  const r = (headers: Record<string, string>) => checkOrigin(new Request('https://game.example/api/ai/ping', { headers }));
  assert.equal(r({}), null);
  assert.equal(r({ origin: 'https://game.example', host: 'game.example' }), null);
  assert.equal(r({ origin: 'https://evil.example', host: 'game.example' })?.status, 403);
  assert.equal(r({ origin: 'null', host: 'game.example' })?.status, 403);
  assert.equal(r({ 'sec-fetch-site': 'cross-site' })?.status, 403);
  assert.equal(r({ 'sec-fetch-site': 'same-origin' }), null);
});

test('rate limiter: burst, refill, per-key, eviction', () => {
  let t = 0;
  const rl = createRateLimiter({ capacity: 2, refillPerSec: 1, maxKeys: 2, now: () => t });
  assert.equal(rl.take('a').ok, true);
  assert.equal(rl.take('a').ok, true);
  const denied = rl.take('a');
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.retryAfterSec, 1);
  assert.equal(rl.take('b').ok, true);
  t = 1000;
  assert.equal(rl.take('a').ok, true);
  rl.take('c');
  rl.take('d'); // evicts the oldest key; the map stays bounded
  t = 1000;
  assert.equal(rl.take('a').ok, true, 'an evicted key starts with a fresh bucket');
});

test('clientIp prefers the platform header', () => {
  const h = (headers: Record<string, string>) => clientIp(new Request('http://x/', { headers }));
  assert.equal(h({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }), '1.2.3.4');
  assert.equal(h({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }), '5.6.7.8');
  assert.equal(h({}), 'unknown');
});

test('contentHash is stable across key order; LRU evicts and expires', () => {
  assert.equal(contentHash({ a: 1, b: [2, 3] }, 'x'), contentHash({ b: [2, 3], a: 1 }, 'x'));
  assert.notEqual(contentHash('a', 'b'), contentHash('ab'));
  assert.equal(contentHash(new Uint8Array([1, 2])).length, 64);
  let t = 0;
  const c = createLruCache<number>({ max: 2, ttlMs: 100, now: () => t });
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3); // evicts b, the least recently used
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  t = 500;
  assert.equal(c.get('a'), undefined);
});
