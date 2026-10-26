// The shared skeleton of an /api/ai endpoint: method check, same-origin check, per-IP rate limit, input
// parsing, then a hook that does the model work. A handler with no hook answers 501 `fallback:true`, which
// is what the stubs do until their loops exist. Every failure tells the client to use its cached fallback.

import { GuardError, checkOrigin, clientIp, createRateLimiter, guardResponse, json, type RateLimiter } from './guard.ts';
import { MetaError, defaultMeta, type MetaClient } from './meta.ts';

export type HookContext = { meta: MetaClient; ip: string; request: Request };
/** Returns a Response (sent as is, e.g. a stream), an object (sent as JSON 200), or null for "not built". */
export type Hook<I> = (input: I, ctx: HookContext) => Promise<Response | object | null>;

/** What tests inject. Anything left out gets the real default. */
export type Deps<I> = { meta?: MetaClient; limiter?: RateLimiter; hook?: Hook<I> };

export type EndpointSpec<I> = {
  name: string;
  methods: readonly string[];
  rate: { capacity: number; refillPerSec: number };
  parse: (request: Request) => Promise<I>;
  /** The built-in behaviour; absent for a stub, which then answers 501. */
  defaultHook?: Hook<I>;
};

const NOT_IMPLEMENTED = { error: 'not_implemented', fallback: true } as const;

function metaStatus(kind: MetaError['kind']): number {
  switch (kind) {
    case 'no_key':
      return 503;
    case 'timeout':
      return 504;
    case 'rate_limited':
      return 429;
    default:
      return 502;
  }
}

export function createEndpoint<I>(spec: EndpointSpec<I>, deps: Deps<I> = {}): (request: Request) => Promise<Response> {
  const limiter = deps.limiter ?? createRateLimiter(spec.rate);
  const allow = ['OPTIONS', ...spec.methods].join(', ');

  return async (request) => {
    // Same-origin only: a preflight is answered without any Access-Control-Allow-* header, so it fails.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow, 'cache-control': 'no-store' } });
    if (!spec.methods.includes(request.method)) return json(405, { error: 'method_not_allowed' }, { allow });
    const origin = checkOrigin(request);
    if (origin) return guardResponse(origin);

    const ip = clientIp(request);
    const taken = limiter.take(ip);
    if (!taken.ok) return json(429, { error: 'rate_limited', fallback: true }, { 'retry-after': String(taken.retryAfterSec) });

    let input: I;
    try {
      input = await spec.parse(request);
    } catch (e) {
      if (e instanceof GuardError) return guardResponse(e);
      return json(400, { error: 'bad_request' });
    }

    const hook = deps.hook ?? spec.defaultHook;
    if (!hook) return json(501, NOT_IMPLEMENTED);
    try {
      const out = await hook(input, { meta: deps.meta ?? defaultMeta(), ip, request });
      if (out === null) return json(501, NOT_IMPLEMENTED);
      if (out instanceof Response) return out;
      return json(200, out);
    } catch (e) {
      if (e instanceof GuardError) return guardResponse(e);
      if (e instanceof MetaError) {
        console.error(`[ai/${spec.name}] model call failed: ${e.kind}${e.status ? ` ${e.status}` : ''}`);
        return json(metaStatus(e.kind), { error: e.kind, fallback: true });
      }
      console.error(`[ai/${spec.name}] unexpected ${e instanceof Error ? e.name : 'error'}`);
      return json(500, { error: 'internal', fallback: true });
    }
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new GuardError(400, 'bad_field', 'Body must be a JSON object');
  return value as Record<string, unknown>;
}
