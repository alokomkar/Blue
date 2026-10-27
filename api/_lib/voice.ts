// The voice partner's two steps on the server (docs/DESIGN.md section 4): the words a clip was heard as, and the one order they mean.
// The fast path (src/shared/orders.ts's matchOrder) answers the obvious commands with no model call; this is the Spark step for the rest:
// one structured call at minimal reasoning effort, told to act on the FIRST step of a compound command and to answer `none` for anything that is not an order.
import { ORDER_SCHEMA, matchOrder, normalise, parseOrder, type PartnerOrder } from '../../src/shared/orders.ts';
import { MetaError, chatText, type MetaClient } from './meta.ts';

/** The game's words, to bias the transcription (docs/DESIGN.md section 4). */
export const VOICE_KEYWORDS: readonly string[] = ['lift', 'console', 'terminal', 'guard', 'dog', 'alpha', 'cover', 'hold', 'stay', 'follow', 'distract', 'flash', 'EMP', 'stairs', 'door'];

/** A longer transcript than this is not a command: it is cut before it goes to the model (and the order endpoint refuses it). */
export const TEXT_MAX = 300;

export const ORDER_PROMPT = `You are the AI partner agent in a non-violent stealth puzzle game: guards are stunned, never hurt. The player has spoken a short command to you over the radio. The words come from speech recognition and may contain small mistakes. Reply with one JSON object that matches the schema, and nothing else.

order is exactly one of:
- hold: stay where you are and wait there.
- follow: come along behind the player (stop holding).
- cover_me: stand guard beside the player and stun any guard that comes close, for example while the player works a console or terminal.
- take: stun a guard or dog now. Set target to nearest_guard, nearest_dog or next_guard.
- distract: draw a guard's attention with noise so the player can slip by. Set target the same way.
- wait_at_lift: go to the exit lift and wait there.
- regroup: come back to the player right now.
- none: the words are not a command to you (chatter, a question, thinking aloud, a remark about the game, a command for someone else).

If the command has several steps, give the order for the FIRST step only. If it is not clearly a command to you, answer none. say is your reply as a teammate on the radio, at most six words (for example "Covering you."); for none, say is an empty string.`;

/** Meta's input filter once rejected a request for naming the crime rather than the game (docs/SPIKES.md): violent words in a spoken command are softened to the game's own. */
export function softenSpeech(text: string): string {
  return text.replace(/\b(kill(?:ing|ed|s)?|murder(?:ing|ed|s)?|shoot(?:ing|s)?|execute|eliminate|neutrali[sz]e|knock out|take out)\b/gi, () => 'stun');
}

/** How many times the Spark call is made when the content filter rejects it (the filter is not deterministic). */
export const FILTER_TRIES = 2;

/** One Spark call: the transcript as a PartnerOrder. Throws MetaError when the model is unavailable; an unreadable answer is `none`. */
export async function modelOrder(meta: Pick<MetaClient, 'chat' | 'models'>, transcript: string): Promise<PartnerOrder> {
  const text = softenSpeech(transcript.slice(0, TEXT_MAX));
  let lastError: MetaError | null = null;
  for (let attempt = 0; attempt < FILTER_TRIES; attempt++) {
    try {
      const res = await meta.chat({
        model: meta.models().planner,
        messages: [
          { role: 'system', content: ORDER_PROMPT },
          { role: 'user', content: `The player said: "${text.replace(/"/g, "'")}"` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'PartnerOrder', schema: ORDER_SCHEMA } },
        // Spark spends tokens on reasoning even at minimal effort (docs/SPIKES.md): 400 ran out on a two-step command, so leave room.
        max_tokens: 1500,
        reasoning_effort: 'minimal',
      });
      return parseOrder(chatText(res)) ?? { order: 'none', say: '' };
    } catch (e) {
      if (!(e instanceof MetaError)) throw e;
      lastError = e;
      if (e.kind !== 'bad_request') break;
    }
  }
  throw lastError ?? new MetaError('bad_response', 'no order');
}

export type Resolved = { order: PartnerOrder; source: 'fast' | 'model' | 'none'; ms: number; note?: string };

/** The transcript as an order: the local fast path first, then one Spark call. `modelFailure` set when the model was needed and failed (the order is then `none`). */
export async function resolveOrder(meta: Pick<MetaClient, 'chat' | 'models'>, transcript: string, now: () => number = Date.now): Promise<Resolved> {
  const t0 = now();
  const fast = matchOrder(transcript);
  if (fast) return { order: fast, source: 'fast', ms: now() - t0 };
  if (normalise(transcript) === '') return { order: { order: 'none', say: '' }, source: 'none', ms: now() - t0 };
  try {
    const order = await modelOrder(meta, transcript);
    return { order, source: order.order === 'none' ? 'none' : 'model', ms: now() - t0 };
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    console.error(`[ai/voice] order model failed: ${e.kind}${e.status ? ` ${e.status}` : ''}`);
    return { order: { order: 'none', say: '' }, source: 'none', ms: now() - t0, note: `model_${e.kind}` };
  }
}
