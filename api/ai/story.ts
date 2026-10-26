// POST /api/ai/story  { kind: 'briefing' | 'dossier' | 'poster' | 'newspaper', context: object }
// `context` is a JSON object of at most 4000 characters (the level spec or the run's results).
// Stub: validates and answers 501 until the text and Muse Image calls (docs/DESIGN.md section 5) are plugged in.
import { LIMITS, GuardError, parseJson } from '../_lib/guard.ts';
import { asRecord, createEndpoint, type Deps } from '../_lib/endpoint.ts';

export const STORY_KINDS = ['briefing', 'dossier', 'poster', 'newspaper'] as const;
export type StoryKind = (typeof STORY_KINDS)[number];
export type StoryInput = { kind: StoryKind; context: Record<string, unknown> };

export async function parseStory(request: Request): Promise<StoryInput> {
  const body = asRecord(await parseJson(request));
  const { kind, context } = body;
  if (typeof kind !== 'string' || !(STORY_KINDS as readonly string[]).includes(kind)) {
    throw new GuardError(400, 'bad_field', `kind must be one of ${STORY_KINDS.join(', ')}`);
  }
  const ctx = asRecord(context ?? {});
  if (JSON.stringify(ctx).length > LIMITS.storyContextBytes) {
    throw new GuardError(413, 'context_too_large', `context is larger than ${LIMITS.storyContextBytes} characters`);
  }
  return { kind: kind as StoryKind, context: ctx };
}

export function createHandler(deps: Deps<StoryInput> = {}) {
  return createEndpoint<StoryInput>(
    {
      name: 'story',
      methods: ['POST'],
      rate: { capacity: 15, refillPerSec: 0.3 },
      parse: parseStory,
      // HOOK: planner text for briefing/dossier/newspaper, meta.image() for poster and the front page; cache by contentHash.
    },
    deps,
  );
}

export default { fetch: createHandler() };
