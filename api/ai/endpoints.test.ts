import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeta, type MetaClient } from '../_lib/meta.ts';
import { createRateLimiter } from '../_lib/guard.ts';
import { wav } from '../_lib/testing.ts';
import { createHandler as ping } from './ping.ts';
import { createHandler as director } from './director.ts';
import { createHandler as transcribe } from './transcribe.ts';
import { createHandler as scan } from './scan.ts';
import { createHandler as story } from './story.ts';
import directorModule from './director.ts';

const KEY = 'sk-test-SECRET-0123456789';

function fakeMeta(over: Partial<MetaClient> = {}): MetaClient {
  const boom = async () => {
    throw new Error('the model must not be called by a stub');
  };
  return {
    chat: boom,
    responses: boom,
    transcribe: boom,
    image: boom,
    hasKey: () => true,
    openWeights: () => false,
    models: () => ({ text: 't', planner: 'p', image: 'i', asr: 'a', sam: 's' }),
    ...over,
  };
}
const roomy = () => createRateLimiter({ capacity: 1000, refillPerSec: 1000 });
const url = (name: string) => `http://localhost/api/ai/${name}`;
const jsonPost = (name: string, body: unknown) =>
  new Request(url(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('ping answers ok with models and a boolean for the key, never the key', async () => {
  const meta = createMeta({ env: () => ({ MODEL_API_KEY: KEY, MODEL_TEXT: 'custom-text' }) });
  const res = await ping({ meta })(new Request(url('ping')));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(KEY));
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.hasKey, true);
  assert.equal(body.models.text, 'custom-text');
  assert.equal(body.models.sam, 'sam-3.1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const none = createMeta({ env: () => ({}) });
  const noKeyBody = (await (await ping({ meta: none })(new Request(url('ping')))).json()) as { hasKey: boolean };
  assert.equal(noKeyBody.hasKey, false);
});

test('ping: wrong method, cross-origin and rate limit', async () => {
  const h = ping({ meta: fakeMeta(), limiter: createRateLimiter({ capacity: 1, refillPerSec: 0.001 }) });
  assert.equal((await h(new Request(url('ping'), { method: 'POST' }))).status, 405);
  assert.equal((await h(new Request(url('ping'), { headers: { origin: 'https://evil.example', host: 'localhost' } }))).status, 403);
  assert.equal((await h(new Request(url('ping')))).status, 200);
  const limited = await h(new Request(url('ping')));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('OPTIONS preflight gets no CORS allow headers', async () => {
  const res = await ping({ meta: fakeMeta() })(new Request(url('ping'), { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

async function expectStub(res: Response) {
  assert.equal(res.status, 501);
  assert.deepEqual(await res.json(), { error: 'not_implemented', fallback: true });
}

test('director: validates, then streams events; a dead model still ends in a verified fallback level', async () => {
  const h = director({ meta: fakeMeta(), limiter: roomy() });
  const res = await h(jsonPost('director', { prompt: 'night job at a museum', seed: 7 }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await res.text();
  assert.ok(body.includes('event: done'));
  assert.ok(body.includes('"usedFallback":true'));
  assert.equal((await h(jsonPost('director', {}))).status, 400);
  assert.equal((await h(jsonPost('director', { prompt: '   ' }))).status, 400);
  assert.equal((await h(jsonPost('director', { prompt: 'x'.repeat(501) }))).status, 413);
  assert.equal((await h(jsonPost('director', { prompt: 'ok', seed: -1 }))).status, 400);
  assert.equal((await h(jsonPost('director', { prompt: 'ok', seed: 1.5 }))).status, 400);
  assert.equal((await h(new Request(url('director'), { method: 'POST', body: 'prompt=x' }))).status, 415);
  assert.equal((await h(new Request(url('director'), { method: 'GET' }))).status, 405);
});

test('director: the default export is a Web-standard { fetch } and is rate limited per IP', async () => {
  assert.equal(typeof directorModule.fetch, 'function');
  const h = director({ meta: fakeMeta(), limiter: createRateLimiter({ capacity: 1, refillPerSec: 0.001 }) });
  await h(jsonPost('director', { prompt: 'a' }));
  assert.equal((await h(jsonPost('director', { prompt: 'a' }))).status, 429);
});

test('a hook plugs in: object -> 200 JSON, Response passes through, MetaError -> fallback status', async () => {
  const seen: unknown[] = [];
  const ok = director({ meta: fakeMeta(), hook: async (input) => (seen.push(input), { spec: { title: 'x' } }) });
  const res = await ok(jsonPost('director', { prompt: 'museum' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { spec: { title: 'x' } });
  assert.deepEqual(seen, [{ prompt: 'museum' }]);
  const stream = director({ meta: fakeMeta(), hook: async () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  assert.equal((await stream(jsonPost('director', { prompt: 'a' }))).headers.get('content-type'), 'text/event-stream');

  const noKey = createMeta({ env: () => ({}) });
  const failing = director({ meta: noKey, hook: async (_i, { meta }) => meta.chat({ messages: [] }) });
  const f = await failing(jsonPost('director', { prompt: 'a' }));
  assert.equal(f.status, 503);
  assert.deepEqual(await f.json(), { error: 'no_key', fallback: true });
  const crashing = director({ meta: fakeMeta(), hook: async () => { throw new Error(`secret ${KEY}`); } });
  const c = await crashing(jsonPost('director', { prompt: 'a' }));
  assert.equal(c.status, 500);
  assert.ok(!(await c.text()).includes(KEY));
});

function audioForm(extra: Record<string, string> = {}, audio: Uint8Array = wav(2)) {
  const form = new FormData();
  form.append('audio', new Blob([audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'a.wav');
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request(url('transcribe'), { method: 'POST', body: form });
}

test('transcribe: validates audio, keywords and mode, then 501 with fallback', async () => {
  const h = transcribe({ meta: fakeMeta(), limiter: roomy() });
  await expectStub(await h(audioForm({ keywords: JSON.stringify(['lift', 'EMP']), mode: 'PUSH_TO_TALK' })));
  assert.equal((await h(audioForm({}, wav(11, 24000)))).status, 413);
  assert.equal((await h(audioForm({}, new Uint8Array(100)))).status, 400);
  assert.equal((await h(audioForm({ keywords: 'not json' }))).status, 400);
  assert.equal((await h(audioForm({ keywords: JSON.stringify(['x'.repeat(41)]) }))).status, 400);
  assert.equal((await h(audioForm({ mode: 'SHOUT' }))).status, 400);
  const noAudio = new FormData();
  noAudio.append('mode', 'PUSH_TO_TALK');
  assert.equal((await h(new Request(url('transcribe'), { method: 'POST', body: noAudio }))).status, 400);
  assert.equal((await h(jsonPost('transcribe', {}))).status, 415);
  const huge = new Uint8Array(1_200_000);
  assert.equal((await h(audioForm({}, huge))).status, 413);
});

test('scan: accepts raw and multipart images, rejects bad ones, then 501', async () => {
  const h = scan({ meta: fakeMeta(), limiter: roomy() });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await expectStub(await h(new Request(url('scan'), { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })));
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'p.png');
  await expectStub(await h(new Request(url('scan'), { method: 'POST', body: form })));
  assert.equal((await h(new Request(url('scan'), { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3, 4]) }))).status, 415);
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  big.set([0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await h(new Request(url('scan'), { method: 'POST', headers: { 'content-type': 'image/png' }, body: big }))).status, 413);
  assert.equal((await h(jsonPost('scan', {}))).status, 415);
});

test('story: validates kind and context, then 501 with fallback', async () => {
  const h = story({ meta: fakeMeta(), limiter: roomy() });
  await expectStub(await h(jsonPost('story', { kind: 'briefing', context: { place: 'museum' } })));
  await expectStub(await h(jsonPost('story', { kind: 'poster' })));
  assert.equal((await h(jsonPost('story', { kind: 'comic', context: {} }))).status, 400);
  assert.equal((await h(jsonPost('story', { kind: 'dossier', context: [1] }))).status, 400);
  assert.equal((await h(jsonPost('story', { kind: 'dossier', context: { text: 'x'.repeat(4001) } }))).status, 413);
});
