// POST /api/ai/director  { prompt: string (<= 500 chars), seed?: uint32 }
// Answers a stream of server-sent events (docs/DESIGN.md section 3): `round`, `spec`, `verify` (repeated while the
// planner repairs its level) and a last `done` carrying the verified LevelSpec, or a verified fallback if the model is
// unavailable or cannot make a level that passes. A finished request is cached by its content for an hour, so a repeated
// demo prompt is instant.
import { LIMITS, GuardError, contentHash, createLruCache, parseJson } from '../_lib/guard.ts';
import { asRecord, createEndpoint, type Deps, type Hook } from '../_lib/endpoint.ts';
import { eventStream, runDirector, type DirectorEvent, type DirectorInput } from '../_lib/director.ts';
import { generators } from '../_lib/generators.ts';

export type { DirectorInput };

export async function parseDirector(request: Request): Promise<DirectorInput> {
  const body = asRecord(await parseJson(request));
  const { prompt, seed } = body;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new GuardError(400, 'bad_field', 'prompt must be a non-empty string');
  if (prompt.length > LIMITS.promptChars) throw new GuardError(413, 'prompt_too_long', `prompt is longer than ${LIMITS.promptChars} characters`);
  if (seed === undefined) return { prompt: prompt.trim() };
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new GuardError(400, 'bad_field', 'seed must be an integer from 0 to 4294967295');
  }
  return { prompt: prompt.trim(), seed };
}

const STREAM_HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' };

/** The finished (non-fallback) answers, by request: a repeated prompt costs no model call. */
const finished = createLruCache<DirectorEvent>({ max: 100, ttlMs: 60 * 60 * 1000 });

export const directorHook: Hook<DirectorInput> = async (input, ctx) => {
  const key = contentHash('director', input.prompt.toLowerCase(), input.seed ?? null);
  const hit = finished.get(key);
  async function* events(): AsyncGenerator<DirectorEvent> {
    if (hit) {
      yield hit;
      return;
    }
    for await (const e of runDirector(input, { meta: ctx.meta, generators })) {
      if (e.type === 'done' && !e.usedFallback) finished.set(key, e);
      yield e;
    }
  }
  return new Response(eventStream(events()), { status: 200, headers: STREAM_HEADERS });
};

export function createHandler(deps: Deps<DirectorInput> = {}) {
  return createEndpoint<DirectorInput>(
    {
      name: 'director',
      methods: ['POST'],
      rate: { capacity: 5, refillPerSec: 0.1 }, // an agent loop is the costliest call
      parse: parseDirector,
      defaultHook: directorHook,
    },
    deps,
  );
}

export default { fetch: createHandler() };
