// How often does Meta's content filter reject the Director's request? Runs each example N times and counts the outcomes.
// Usage: node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/spikes/spike8_filter_rate.mjs [runs=3]
import { client } from './common.mjs';
const { runDirector } = await import(new URL('../../api/_lib/director.ts', import.meta.url).href);
const { generators } = await import(new URL('../../api/_lib/generators.ts', import.meta.url).href);
const prompts = ['A night job at a museum: two guards, one dog, steal a painting from the vault.', 'Quiet refinery sabotage, no dogs, small floor.', 'A big bank job with many guards and lasers everywhere.', 'Extract a sample from a lab, two guards, no dogs.'];
const runs = Number(process.argv[2] ?? 3);
let total = 0; let rejected = 0; let fellBack = 0; let rounds = 0; const t0 = Date.now();
await Promise.all(prompts.flatMap((p) => Array.from({ length: runs }, async () => {
  for await (const e of runDirector({ prompt: p }, { meta: client, generators })) if (e.type === 'done') { total++; rounds += e.rounds; if (e.usedFallback) { fellBack++; if (e.reason === 'request_rejected') rejected++; } }
})));
console.log(`${total} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${total - fellBack} real levels, ${fellBack} fallbacks (${rejected} rejected by the filter), ${(rounds / total).toFixed(1)} rounds on average`);
