// Shared setup for the spike scripts: loads .env (git-ignored) and the project's own Meta client.
// Run any spike from the repo root:
//   node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/spikes/<name>.mjs
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
for (const l of fs.readFileSync(`${ROOT}.env`, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''); if (v) process.env[k] = v; }
export const meta = await import(`${ROOT}api/_lib/meta.ts`);
export const client = meta.defaultMeta();
export const key = process.env.MODEL_API_KEY;
/** Hides the key (and anything shaped like one) from output. */
export const scrub = (s) => String(s).split(key).join('***').replace(/LLM_[A-Za-z0-9_]+/g, 'LLM_***');
/** Where spikes read fixtures from and write results to (out/ is git-ignored). */
export const OUT = `${ROOT}scripts/spikes/out/`;
export const FIXTURES = `${ROOT}public/fallback/scans/`;
fs.mkdirSync(OUT, { recursive: true });
