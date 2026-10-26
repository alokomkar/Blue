// GET /api/ai/ping: proves the function and its environment are wired, without revealing anything secret.
import { createEndpoint, type Deps } from '../_lib/endpoint.ts';

export type PingInput = null;

export function createHandler(deps: Deps<PingInput> = {}) {
  return createEndpoint<PingInput>(
    {
      name: 'ping',
      methods: ['GET'],
      rate: { capacity: 30, refillPerSec: 1 },
      parse: async () => null,
      // hasKey is a boolean; the key itself never leaves meta.ts.
      defaultHook: async (_input, { meta }) => ({ ok: true, hasKey: meta.hasKey(), openWeights: meta.openWeights(), models: meta.models() }),
    },
    deps,
  );
}

export default { fetch: createHandler() };
