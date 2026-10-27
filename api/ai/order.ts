// POST /api/ai/order  { text: string (<= 300 chars) }
// The voice partner's order step on its own, for testing without a microphone (the page's localhost-only window.__order) and for a typed command:
// the same fast path and the same single Spark call that /api/ai/transcribe uses after it has the words (api/_lib/voice.ts).
// Answers { order, source: 'fast' | 'model' | 'none', ms }; a failed model call answers { error, fallback: true } like the others.
import { GuardError, parseJson } from '../_lib/guard.ts';
import { asRecord, createEndpoint, type Deps, type Hook } from '../_lib/endpoint.ts';
import { TEXT_MAX, modelOrder } from '../_lib/voice.ts';
import { matchOrder, normalise, type PartnerOrder } from '../../src/shared/orders.ts';

export type OrderInput = { text: string };
export type OrderOutput = { order: PartnerOrder; source: 'fast' | 'model' | 'none'; ms: number };

export async function parseOrderRequest(request: Request): Promise<OrderInput> {
  const body = asRecord(await parseJson(request));
  const { text } = body;
  if (typeof text !== 'string' || text.trim().length === 0) throw new GuardError(400, 'bad_field', 'text must be a non-empty string');
  if (text.length > TEXT_MAX) throw new GuardError(413, 'text_too_long', `text is longer than ${TEXT_MAX} characters`);
  return { text: text.trim() };
}

export const orderHook: Hook<OrderInput> = async (input, ctx) => {
  const t0 = Date.now();
  const fast = matchOrder(input.text);
  if (fast) return { order: fast, source: 'fast', ms: Date.now() - t0 } satisfies OrderOutput;
  if (normalise(input.text) === '') return { order: { order: 'none', say: '' }, source: 'none', ms: 0 } satisfies OrderOutput;
  const order = await modelOrder(ctx.meta, input.text); // (a failure here is the endpoint's: { error, fallback: true })
  return { order, source: order.order === 'none' ? 'none' : 'model', ms: Date.now() - t0 } satisfies OrderOutput;
};

export function createHandler(deps: Deps<OrderInput> = {}) {
  return createEndpoint<OrderInput>(
    {
      name: 'order',
      methods: ['POST'],
      rate: { capacity: 15, refillPerSec: 0.5 },
      parse: parseOrderRequest,
      defaultHook: orderHook,
    },
    deps,
  );
}

export default { fetch: createHandler() };
