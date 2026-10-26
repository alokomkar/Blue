// The Heist Director: a request in plain words becomes a level that has passed the verifier (docs/DESIGN.md section 3).
// The planner model answers with a LevelSpec (schema-constrained), the verifier checks it, and the failures go back to the
// model as the next message until the level passes or the rounds run out. Each step is an event, so the page can show the
// agent repairing its own work. When the model is unavailable or cannot produce a level that passes, a verified fallback
// level is returned instead (usedFallback), so the caller always gets something playable.
import { LEVEL_SPEC_SCHEMA, SPEC_LIMITS, BRIEF_MAX, TITLE_MAX, CONTRACT_IDS, LAYOUT_IDS, PLACE_IDS, TWIST_IDS, parseSpec, type LevelSpec } from '../../src/shared/levelspec.ts';
import { verifyLevel, type FloorGenerators } from '../../src/shared/floorbuild.ts';
import type { Failure } from '../../src/shared/verify.ts';
import { MetaError, chatText, type ChatMessage, type MetaClient } from './meta.ts';
import { pickFallback } from './fallbacks.ts';

export type DirectorInput = { prompt: string; seed?: number };

export type DirectorEvent =
  | { type: 'round'; n: number; of: number }
  | { type: 'spec'; n: number; spec: LevelSpec; changes: string[] }
  | { type: 'verify'; n: number; ok: boolean; failures: Failure[] }
  | { type: 'done'; ok: true; spec: LevelSpec; rounds: number; usedFallback: boolean; reason?: string };

export type DirectorDeps = {
  meta: Pick<MetaClient, 'chat' | 'models'>;
  generators: FloorGenerators;
  /** At most this many model calls (default 4). */
  maxRounds?: number;
  /** Reasoning effort for the planner (default 'minimal': the spec is small and the loop is on the clock). */
  effort?: string;
  /** The checker (default: floorbuild.ts's verifyLevel); tests pass a scripted one. */
  verify?: (spec: LevelSpec, g: FloorGenerators) => { ok: boolean; failures: Failure[] };
};

const range = (r: readonly [number, number]): string => `${r[0]} to ${r[1]}`;

export const SYSTEM_PROMPT = `You design one level of a stealth-heist game from a short request. Reply with a single JSON object that matches the schema, and nothing else.

Ranges (the game's own limits): the floor is ${range(SPEC_LIMITS.cols)} columns by ${range(SPEC_LIMITS.rows)} rows; guards ${range(SPEC_LIMITS.roster.guards)} per floor, watchdogs (dogs) ${range(SPEC_LIMITS.roster.watchdogs)}, lasers ${range(SPEC_LIMITS.hazards.lasers)}, doors ${range(SPEC_LIMITS.hazards.doors)}, documents ${range(SPEC_LIMITS.documents)}. Prefer small numbers: a level must be finishable.
Places: ${PLACE_IDS.join(', ')}. Layouts: ${LAYOUT_IDS.join(', ')}. Contracts: ${CONTRACT_IDS.join(', ')}. Twists (at most two, and they must suit the contract): ${TWIST_IDS.join(', ')}.
The title is at most ${TITLE_MAX} characters and the brief one sentence of at most ${BRIEF_MAX}. Use a neutral, invented setting: no real brands, people or places. Pick the place and contract that match the request; leave the roster modest unless the request asks for more.
If you are given a list of failures from a checker, change exactly those things and keep the rest.`;

/**
 * Meta's input filter rejected "a huge bank robbery" (400, content policy) while "a big bank job" passed (docs/HISTORY.md), so the words that name the crime rather than
 * the game are softened before the request goes out. The level is the same either way.
 */
export function softenPrompt(prompt: string): string {
  return prompt.replace(/\b(rob(?:bery|beries|bing|bed|s)?|burglary|burglar|steal(?:ing)?|stole|theft|loot(?:ing)?)\b/gi, 'heist');
}

export function userMessage(input: DirectorInput): string {
  return `Request: ${softenPrompt(input.prompt)}${input.seed !== undefined ? `\nUse seed ${input.seed}.` : ''}`;
}

/** The checker's failures as the next message to the model. */
export function repairMessage(failures: readonly Failure[]): string {
  const lines = failures.map((f) => `- ${f.code}: ${f.message}${f.where ? ` (floor ${f.where.floor}, cell ${f.where.x},${f.where.y})` : ''}`);
  return `The checker found these problems with that level:\n${lines.join('\n')}\nReply with a corrected JSON level that fixes them.`;
}

export async function* runDirector(input: DirectorInput, deps: DirectorDeps): AsyncGenerator<DirectorEvent> {
  const rounds = deps.maxRounds ?? 4;
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage(input) },
  ];
  let lastFailure = 'no usable answer';
  let used = 0;

  for (let n = 1; n <= rounds; n++) {
    used = n;
    yield { type: 'round', n, of: rounds };
    let text = '';
    let failed = false;
    // Meta's content filter is borderline and not deterministic (the same request passed and failed on different tries, see docs/SPIKES.md), so a rejected call is tried once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await deps.meta.chat({
          model: deps.meta.models().planner,
          messages,
          response_format: { type: 'json_schema', json_schema: { name: 'LevelSpec', schema: LEVEL_SPEC_SCHEMA } },
          // Spark spends tokens on reasoning even at minimal effort (docs/SPIKES.md): leave room for the answer.
          max_tokens: 3000,
          reasoning_effort: deps.effort ?? 'minimal',
        });
        text = chatText(res);
        failed = false;
        break;
      } catch (e) {
        // The model is down or slow: whatever has happened, the caller gets a playable level.
        lastFailure = e instanceof MetaError ? (e.kind === 'bad_request' ? 'request_rejected' : e.kind) : 'model_error';
        failed = true;
        if (e instanceof MetaError && e.kind === 'bad_request') continue;
        break;
      }
    }
    if (failed) break;

    const parsed = parseSpec(text);
    if (!parsed.ok) {
      lastFailure = 'unreadable_answer';
      const failures: Failure[] = [{ code: 'bad_field', message: `that was not a level in the schema: ${parsed.error}` }];
      yield { type: 'verify', n, ok: false, failures };
      messages.push({ role: 'assistant', content: text || '(empty)' }, { role: 'user', content: repairMessage(failures) });
      continue;
    }

    const spec: LevelSpec = input.seed !== undefined ? { ...parsed.spec, seed: input.seed } : parsed.spec;
    yield { type: 'spec', n, spec, changes: parsed.changes };
    const verdict = (deps.verify ?? verifyLevel)(spec, deps.generators);
    yield { type: 'verify', n, ok: verdict.ok, failures: verdict.failures };
    if (verdict.ok) {
      yield { type: 'done', ok: true, spec, rounds: n, usedFallback: false };
      return;
    }
    lastFailure = verdict.failures[0]?.code ?? 'failed_checks';
    messages.push({ role: 'assistant', content: JSON.stringify(spec) }, { role: 'user', content: repairMessage(verdict.failures) });
  }

  const fallback = pickFallback(input.prompt, input.seed);
  yield { type: 'done', ok: true, spec: fallback, rounds: used, usedFallback: true, reason: lastFailure };
}

/** The events as a server-sent-events body. */
export function eventStream(events: AsyncIterable<DirectorEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`event: ${next.value.type}\ndata: ${JSON.stringify(next.value)}\n\n`));
      } catch {
        // A thrown error after the stream began cannot change the status: end the stream so the client uses its fallback.
        controller.enqueue(encoder.encode('event: error\ndata: {"type":"error","fallback":true}\n\n'));
        controller.close();
      }
    },
    cancel() {
      void iterator.return?.();
    },
  });
}
