// Writes public/fallback/director/levels.json from api/_lib/fallbacks.ts: the ready-made levels the Director page offers when
// the server is unreachable. A test checks that the file is in step with the source. Run: node --experimental-strip-types
// --no-warnings=ExperimentalWarning scripts/build-fallbacks.mjs
import fs from 'node:fs';
const { FALLBACKS } = await import(new URL('../api/_lib/fallbacks.ts', import.meta.url).href);
const out = new URL('../public/fallback/director/levels.json', import.meta.url);
fs.writeFileSync(out, `${JSON.stringify(FALLBACKS, null, 2)}\n`);
console.log('wrote', out.pathname, Object.keys(FALLBACKS).join(', '));
