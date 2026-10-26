import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDirector, repairMessage, eventStream, softenPrompt, userMessage, SYSTEM_PROMPT, type DirectorEvent } from './director.ts';
import { FALLBACKS, pickFallback } from './fallbacks.ts';
import { generators } from './generators.ts';
import { MetaError, type ChatParams, type MetaClient } from './meta.ts';
import { defaultSpec, PLACE_IDS, LEVEL_SPEC_SCHEMA, type LevelSpec } from '../../src/shared/levelspec.ts';
import { verifyLevel } from '../../src/shared/floorbuild.ts';
import type { Failure } from '../../src/shared/verify.ts';

const spec = (over: Partial<LevelSpec> = {}): LevelSpec => ({ ...defaultSpec(), title: 'Museum night', brief: 'Take the painting.', place: 'museum', contract: 'vault', ...over });

/** A planner that answers from a script, one entry per call (a string is the answer, an Error is thrown). Records what it was asked. */
function scripted(answers: Array<string | Error>) {
  const calls: ChatParams[] = [];
  const meta: Pick<MetaClient, 'chat' | 'models'> = {
    models: () => ({ text: 't', planner: 'planner-model', image: 'i', asr: 'a', sam: 's' }),
    chat: async (params) => {
      calls.push(JSON.parse(JSON.stringify(params)) as ChatParams);
      const a = answers[calls.length - 1];
      if (a === undefined) throw new Error('script ran out');
      if (a instanceof Error) throw a;
      return { choices: [{ message: { content: a }, finish_reason: 'stop' }] } as never;
    },
  };
  return { meta, calls };
}

const collect = async (gen: AsyncGenerator<DirectorEvent>): Promise<DirectorEvent[]> => {
  const out: DirectorEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};
const failing: Failure[] = [{ code: 'exit_close', message: 'the exit is only 5 steps from the start', where: { x: 3, y: 1, floor: 0 } }];

test('a level that passes the first time ends the loop in one round', async () => {
  const { meta, calls } = scripted([JSON.stringify(spec())]);
  const events = await collect(runDirector({ prompt: 'a night job at a museum' }, { meta, generators, verify: () => ({ ok: true, failures: [] }) }));
  assert.deepEqual(events.map((e) => e.type), ['round', 'spec', 'verify', 'done']);
  const done = events.at(-1)!;
  assert.equal(done.type === 'done' && done.rounds, 1);
  assert.equal(done.type === 'done' && done.usedFallback, false);
  assert.equal(calls.length, 1);
});

test('the request carries the schema, the planner model, headroom for reasoning and the seed', async () => {
  const { meta, calls } = scripted([JSON.stringify(spec())]);
  await collect(runDirector({ prompt: 'bank job', seed: 77 }, { meta, generators, verify: () => ({ ok: true, failures: [] }) }));
  const c = calls[0]!;
  assert.equal(c.model, 'planner-model');
  assert.equal(c.reasoning_effort, 'minimal');
  assert.ok((c.max_tokens ?? 0) >= 2000);
  assert.deepEqual((c.response_format as { json_schema: { schema: unknown } }).json_schema.schema, LEVEL_SPEC_SCHEMA);
  assert.equal(c.messages[0]!.role, 'system');
  assert.equal(c.messages[0]!.content, SYSTEM_PROMPT);
  assert.match(String(c.messages[1]!.content), /bank job/);
  assert.match(String(c.messages[1]!.content), /seed 77/);
});

test('failures go back to the planner and the repaired level ends the loop', async () => {
  const { meta, calls } = scripted([JSON.stringify(spec({ size: { cols: 6, rows: 5 } })), JSON.stringify(spec({ size: { cols: 12, rows: 8 } }))]);
  let n = 0;
  const verify = () => (++n === 1 ? { ok: false, failures: failing } : { ok: true, failures: [] });
  const events = await collect(runDirector({ prompt: 'museum' }, { meta, generators, verify }));
  assert.deepEqual(events.map((e) => e.type), ['round', 'spec', 'verify', 'round', 'spec', 'verify', 'done']);
  const second = calls[1]!.messages;
  assert.equal(second.length, 4);
  assert.equal(second[2]!.role, 'assistant');
  assert.equal(second[3]!.role, 'user');
  assert.match(String(second[3]!.content), /exit_close/);
  assert.match(String(second[3]!.content), /floor 0, cell 3,1/);
  const done = events.at(-1)!;
  assert.equal(done.type === 'done' && done.rounds, 2);
  assert.equal(done.type === 'done' && done.spec.size.cols, 12);
});

test('an unreadable answer is a failed round, not a crash', async () => {
  const { meta } = scripted(['this is not json', JSON.stringify(spec())]);
  const events = await collect(runDirector({ prompt: 'x' }, { meta, generators, verify: () => ({ ok: true, failures: [] }) }));
  const verifies = events.filter((e) => e.type === 'verify');
  assert.equal(verifies[0]!.type === 'verify' && verifies[0]!.ok, false);
  assert.equal(events.at(-1)!.type === 'done' && (events.at(-1) as { rounds: number }).rounds, 2);
});

test('after the last round a still-failing level becomes a verified fallback', async () => {
  const { meta, calls } = scripted([JSON.stringify(spec()), JSON.stringify(spec()), JSON.stringify(spec())]);
  const events = await collect(runDirector({ prompt: 'a museum heist', seed: 5 }, { meta, generators, maxRounds: 3, verify: () => ({ ok: false, failures: failing }) }));
  assert.equal(calls.length, 3);
  const done = events.at(-1)!;
  assert.ok(done.type === 'done' && done.usedFallback);
  assert.equal(done.type === 'done' && done.reason, 'exit_close');
  assert.equal(done.type === 'done' && done.spec.place, 'museum');
  assert.equal(done.type === 'done' && done.spec.seed, 5);
});

test('a model error ends in the fallback at once, and names why', async () => {
  const { meta, calls } = scripted([new MetaError('rate_limited', 'slow down', 429)]);
  const events = await collect(runDirector({ prompt: 'a refinery job' }, { meta, generators }));
  assert.equal(calls.length, 1);
  const done = events.at(-1)!;
  assert.ok(done.type === 'done' && done.usedFallback && done.reason === 'rate_limited');
  assert.equal(done.type === 'done' && done.spec.place, 'refinery');
});

test('the seed in the request replaces the model\'s', async () => {
  const { meta } = scripted([JSON.stringify(spec({ seed: 999 }))]);
  const events = await collect(runDirector({ prompt: 'x', seed: 12 }, { meta, generators, verify: () => ({ ok: true, failures: [] }) }));
  const s = events.find((e) => e.type === 'spec');
  assert.equal(s?.type === 'spec' && s.spec.seed, 12);
});

test('every fallback level passes the verifier, so the fallback is always playable', () => {
  for (const place of PLACE_IDS) {
    const v = verifyLevel(FALLBACKS[place], generators);
    assert.ok(v.ok, `${place}: ${JSON.stringify(v.failures)}`);
  }
});

test('pickFallback reads the request for a place, defaults to the campus, and keeps a given seed', () => {
  assert.equal(pickFallback('steal a painting from the gallery').place, 'museum');
  assert.equal(pickFallback('rob the bank').place, 'bank');
  assert.equal(pickFallback('sabotage the oil plant').place, 'refinery');
  assert.equal(pickFallback('find the shipment at the docks').place, 'warehouse');
  assert.equal(pickFallback('get the lab sample').place, 'lab');
  assert.equal(pickFallback('something quiet').place, 'campus');
  assert.equal(pickFallback('bank', 31).seed, 31);
});

test('repairMessage lists each failure with its code and where', () => {
  const m = repairMessage(failing);
  assert.match(m, /^The checker found these problems/);
  assert.match(m, /- exit_close: the exit is only 5 steps/);
});

test('eventStream writes server-sent events and ends cleanly, even when the source throws', async () => {
  async function* fine(): AsyncGenerator<DirectorEvent> {
    yield { type: 'round', n: 1, of: 4 };
  }
  assert.equal(await new Response(eventStream(fine())).text(), 'event: round\ndata: {"type":"round","n":1,"of":4}\n\n');
  async function* boom(): AsyncGenerator<DirectorEvent> {
    yield { type: 'round', n: 1, of: 4 };
    throw new Error('secret');
  }
  const text = await new Response(eventStream(boom())).text();
  assert.ok(text.includes('event: error'));
  assert.ok(!text.includes('secret'));
});

test('crime words are softened before the request goes out, ordinary words are left alone', () => {
  assert.equal(softenPrompt('A huge bank robbery with five dogs'), 'A huge bank heist with five dogs');
  assert.equal(softenPrompt('steal a painting; Robbing banks'), 'heist a painting; heist banks');
  assert.equal(softenPrompt('a museum job with a guard on the stairs'), 'a museum job with a guard on the stairs');
  assert.equal(userMessage({ prompt: 'rob the vault', seed: 3 }), 'Request: heist the vault\nUse seed 3.');
});

test('a request the model filter rejects ends in the fallback and says so, with the rounds actually used', async () => {
  const { meta, calls } = scripted([new MetaError('bad_request', 'filtered', 400), new MetaError('bad_request', 'filtered', 400), new MetaError('bad_request', 'filtered', 400)]);
  const events = await collect(runDirector({ prompt: 'a bank job' }, { meta, generators }));
  const done = events.at(-1)!;
  assert.ok(done.type === 'done' && done.usedFallback && done.reason === 'request_rejected');
  assert.equal(done.type === 'done' && done.rounds, 1);
  assert.equal(calls.length, 3, 'tried three times');
});

test('a filtered call is retried, and a good answer the second time carries on as normal', async () => {
  const { meta, calls } = scripted([new MetaError('bad_request', 'filtered', 400), JSON.stringify(spec())]);
  const events = await collect(runDirector({ prompt: 'a bank job' }, { meta, generators, verify: () => ({ ok: true, failures: [] }) }));
  assert.equal(calls.length, 2);
  const done = events.at(-1)!;
  assert.ok(done.type === 'done' && !done.usedFallback && done.rounds === 1);
});

test('the ready-made levels the page ships (public/fallback/director/levels.json) are in step with the server\'s fallbacks', async () => {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(new URL('../../public/fallback/director/levels.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, FALLBACKS, 'run node scripts/build-fallbacks.mjs');
});
