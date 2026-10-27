import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaError, createMeta, type MetaClient } from '../_lib/meta.ts';
import { createRateLimiter } from '../_lib/guard.ts';
import { wav } from '../_lib/testing.ts';
import { createHandler as ping } from './ping.ts';
import { createHandler as director } from './director.ts';
import { createHandler as transcribe } from './transcribe.ts';
import { createHandler as order } from './order.ts';
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

function audioForm(extra: Record<string, string> = {}, audio: Uint8Array = wav(2), path = 'transcribe') {
  const form = new FormData();
  form.append('audio', new Blob([audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'a.wav');
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request(url(path), { method: 'POST', body: form });
}

const say = (transcript: string, calls: string[] = []) => async (_wav: Uint8Array, opts?: { keywords?: string[]; mode?: string }) => {
  calls.push(`asr:${(opts?.keywords ?? []).join(',')}:${opts?.mode}`);
  return { transcript };
};
const chatJson = (body: unknown, calls: string[] = []): MetaClient['chat'] => async (params) => {
  calls.push(`chat:${params.reasoning_effort}:${params.max_tokens}:${(params.response_format as { type?: string } | undefined)?.type}`);
  return { choices: [{ message: { content: typeof body === 'string' ? body : JSON.stringify(body) } }] };
};
type VoiceBody = { transcript: string; order: { order: string; target?: string; say: string }; source: string; ms: { asr: number; order: number }; error?: string; fallback?: boolean };

test('transcribe: validates audio, keywords and mode', async () => {
  const h = transcribe({ meta: fakeMeta({ transcribe: say('hold') }), limiter: roomy() });
  assert.equal((await h(audioForm({ keywords: JSON.stringify(['lift', 'EMP']), mode: 'PUSH_TO_TALK' }))).status, 200);
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
  assert.equal((await h(audioForm({}, wav(2, 44100)))).status, 400, 'a rate the model does not take');
  assert.equal((await h(audioForm({}, wav(2, 24000, { channels: 2 })))).status, 400, 'stereo is refused');
});

test('transcribe: an obvious command takes the fast path and never calls the model', async () => {
  const calls: string[] = [];
  const h = transcribe({ meta: fakeMeta({ transcribe: say('Okay, cover me.', calls) }), limiter: roomy() });
  const res = await h(audioForm());
  assert.equal(res.status, 200);
  const body = (await res.json()) as VoiceBody;
  assert.equal(body.transcript, 'Okay, cover me.');
  assert.deepEqual(body.order, { order: 'cover_me', say: 'Covering you' });
  assert.equal(body.source, 'fast');
  assert.equal(typeof body.ms.asr, 'number');
  assert.equal(typeof body.ms.order, 'number');
  assert.equal(calls.length, 1, 'only the transcription ran: the fake chat would have thrown');
  // the game's words are sent to bias the transcription, in push-to-talk mode
  assert.match(calls[0]!, /^asr:lift,console,terminal,guard,dog,alpha,cover,hold,stay,follow,distract,flash,EMP,stairs,door:PUSH_TO_TALK$/);
});

test('transcribe: the caller\'s own keywords replace the defaults', async () => {
  const calls: string[] = [];
  const h = transcribe({ meta: fakeMeta({ transcribe: say('hold', calls) }), limiter: roomy() });
  await h(audioForm({ keywords: JSON.stringify(['vault']) }));
  assert.equal(calls[0], 'asr:vault:PUSH_TO_TALK');
});

test('transcribe: anything else goes to one Spark call, at minimal effort with room for its reasoning', async () => {
  const calls: string[] = [];
  const meta = fakeMeta({ transcribe: say('Cover me while I work the console.', calls), chat: chatJson({ order: 'cover_me', say: 'Covering you.' }, calls) });
  const body = (await (await transcribe({ meta, limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.equal(body.source, 'model');
  assert.deepEqual(body.order, { order: 'cover_me', say: 'Covering you.' });
  assert.deepEqual(calls.slice(1), ['chat:minimal:1500:json_schema']);
});

test('transcribe: a compound command gets the order for its first step', async () => {
  let asked = '';
  const meta = fakeMeta({
    transcribe: say('Take out the guard on the left, then hold at the lift.'),
    chat: async (params) => {
      asked = JSON.stringify(params.messages);
      return { choices: [{ message: { content: JSON.stringify({ order: 'take', target: 'nearest_guard', say: 'Taking him.' }) } }] };
    },
  });
  const body = (await (await transcribe({ meta, limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.equal(body.source, 'model');
  assert.equal(body.order.order, 'take');
  assert.equal(body.order.target, 'nearest_guard');
  assert.match(asked, /FIRST step/, 'the prompt says to act on the first step');
  assert.match(asked, /none/, 'and to answer none for what is not a command');
  assert.ok(!/take out/i.test(asked.split('The player said')[1] ?? ''), 'violent phrasing is softened before it goes out');
});

test('transcribe: chatter comes back as order none, source none', async () => {
  const meta = fakeMeta({ transcribe: say('What a nice day.'), chat: chatJson({ order: 'none', say: '' }) });
  const body = (await (await transcribe({ meta, limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.equal(body.transcript, 'What a nice day.');
  assert.deepEqual(body.order, { order: 'none', say: '' });
  assert.equal(body.source, 'none');
});

test('transcribe: a silent clip (empty transcript) is none and calls no model', async () => {
  const body = (await (await transcribe({ meta: fakeMeta({ transcribe: say('  ') }), limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.deepEqual(body.order, { order: 'none', say: '' });
  assert.equal(body.source, 'none');
});

test('transcribe: when only the Spark step fails the transcript still comes back, with order none', async () => {
  const meta = fakeMeta({
    transcribe: say('Cover me while I work the console.'),
    chat: async () => {
      throw new MetaError('timeout', 'slow');
    },
  });
  const res = await transcribe({ meta, limiter: roomy() })(audioForm());
  assert.equal(res.status, 200);
  const body = (await res.json()) as VoiceBody & { note?: string };
  assert.equal(body.transcript, 'Cover me while I work the console.');
  assert.deepEqual(body.order, { order: 'none', say: '' });
  assert.equal(body.source, 'none');
  assert.equal(body.note, 'model_timeout');
});

test('transcribe: a model answer that is not an order is none, not an error', async () => {
  const meta = fakeMeta({ transcribe: say('do the thing with the other thing'), chat: chatJson('this is not json') });
  const body = (await (await transcribe({ meta, limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.deepEqual(body.order, { order: 'none', say: '' });
});

test('transcribe: a rejected Spark call is tried once more, then falls back to none', async () => {
  let n = 0;
  const meta = fakeMeta({
    transcribe: say('shoot the thing near the box'),
    chat: async () => {
      n++;
      throw new MetaError('bad_request', 'filtered', 400);
    },
  });
  const body = (await (await transcribe({ meta, limiter: roomy() })(audioForm())).json()) as VoiceBody;
  assert.equal(n, 2);
  assert.equal(body.order.order, 'none');
});

test('transcribe: a failed transcription answers { error, fallback: true } and never leaks the key', async () => {
  const noKey = createMeta({ env: () => ({}) });
  const a = await transcribe({ meta: noKey, limiter: roomy() })(audioForm());
  assert.equal(a.status, 503);
  assert.deepEqual(await a.json(), { error: 'no_key', fallback: true });
  const meta = fakeMeta({
    transcribe: async () => {
      throw new Error(`boom ${KEY}`);
    },
  });
  const b = await transcribe({ meta, limiter: roomy() })(audioForm());
  assert.equal(b.status, 500);
  const text = await b.text();
  assert.ok(!text.includes(KEY));
  assert.match(text, /"fallback":true/);
});

test('transcribe: a model error that carries the key in its message does not reach the answer', async () => {
  const meta = fakeMeta({
    transcribe: say('cover me while I work the console'),
    chat: async () => {
      throw new MetaError('network', `request failed with ${KEY}`);
    },
  });
  const res = await transcribe({ meta, limiter: roomy() })(audioForm());
  assert.equal(res.status, 200);
  assert.ok(!(await res.text()).includes(KEY));
});

test('transcribe ?stream=1: the words in the first line, the whole answer in the second; a Spark failure still ends in an answer line', async () => {
  const meta = fakeMeta({ transcribe: say('Cover me while I work the console.'), chat: chatJson({ order: 'cover_me', say: 'Covering you.' }) });
  const req = audioForm({}, wav(2), 'transcribe?stream=1');
  const res = await transcribe({ meta, limiter: roomy() })(req);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /ndjson/);
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as VoiceBody);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { transcript: 'Cover me while I work the console.' });
  assert.equal(lines[1]!.order.order, 'cover_me');
  assert.equal(lines[1]!.source, 'model');
  // the fast path streams too (two lines, the second right behind the first)
  const fast = await transcribe({ meta: fakeMeta({ transcribe: say('hold') }), limiter: roomy() })(audioForm({}, wav(2), 'transcribe?stream=1'));
  const fastLines = (await fast.text()).trim().split('\n').map((l) => JSON.parse(l) as VoiceBody);
  assert.equal(fastLines[1]!.source, 'fast');
  // a dead Spark: still the transcript, then an answer of none
  const down = fakeMeta({
    transcribe: say('cover me while I work the console'),
    chat: async () => {
      throw new MetaError('timeout', 'slow');
    },
  });
  const d = await transcribe({ meta: down, limiter: roomy() })(audioForm({}, wav(2), 'transcribe?stream=1'));
  const dLines = (await d.text()).trim().split('\n').map((l) => JSON.parse(l) as VoiceBody);
  assert.equal(dLines[1]!.order.order, 'none');
  // a failed transcription is an error status, not a stream
  const noKey = await transcribe({ meta: createMeta({ env: () => ({}) }), limiter: roomy() })(audioForm({}, wav(2), 'transcribe?stream=1'));
  assert.equal(noKey.status, 503);
});

test('order: the typed-command twin of transcribe: validates, fast path, model path, failure', async () => {
  const calls: string[] = [];
  const meta = fakeMeta({ chat: chatJson({ order: 'hold', say: 'Holding.' }, calls) });
  const h = order({ meta, limiter: roomy() });
  const fast = (await (await h(jsonPost('order', { text: 'follow me' }))).json()) as { order: { order: string }; source: string };
  assert.equal(fast.order.order, 'follow');
  assert.equal(fast.source, 'fast');
  assert.equal(calls.length, 0);
  const viaModel = (await (await h(jsonPost('order', { text: 'could you maybe wait around here for a while' }))).json()) as { order: { order: string }; source: string };
  assert.equal(viaModel.order.order, 'hold');
  assert.equal(viaModel.source, 'model');
  assert.equal(calls.length, 1);
  assert.equal((await h(jsonPost('order', {}))).status, 400);
  assert.equal((await h(jsonPost('order', { text: '   ' }))).status, 400);
  assert.equal((await h(jsonPost('order', { text: 'x'.repeat(301) }))).status, 413);
  assert.equal((await h(new Request(url('order'), { method: 'POST', body: 'text=hold' }))).status, 415);
  const down = order({
    meta: fakeMeta({
      chat: async () => {
        throw new MetaError('timeout', 'slow');
      },
    }),
    limiter: roomy(),
  });
  const failed = await down(jsonPost('order', { text: 'a long and winding request' }));
  assert.equal(failed.status, 504);
  assert.deepEqual(await failed.json(), { error: 'timeout', fallback: true });
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
