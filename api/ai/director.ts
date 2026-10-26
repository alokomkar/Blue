// POST /api/ai/director  { prompt: string (<= 500 chars), seed?: uint32 }
// Stub: validates the request and answers 501 until the Director loop (docs/DESIGN.md section 3) is plugged
// in as the hook below. The loop will answer a stream of server-sent events (round, spec, verify, done), so
// the hook may return a streaming Response.
import { LIMITS, GuardError, parseJson } from '../_lib/guard.ts';
import { asRecord, createEndpoint, type Deps } from '../_lib/endpoint.ts';

export type DirectorInput = { prompt: string; seed?: number };

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

export function createHandler(deps: Deps<DirectorInput> = {}) {
  return createEndpoint<DirectorInput>(
    {
      name: 'director',
      methods: ['POST'],
      rate: { capacity: 5, refillPerSec: 0.1 }, // an agent loop is the costliest call
      parse: parseDirector,
      // HOOK: the Director loop goes here (planner call, verify V1-V3, repair up to 4 rounds). Until then: 501.
    },
    deps,
  );
}

export default { fetch: createHandler() };
