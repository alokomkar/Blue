// A visual QA pass: Muse Spark looks at a screenshot and critiques it against a written style target.
// Usage: node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/spikes/spike11_visualqa.mjs <screenshot.jpg>
import fs from 'node:fs';
import { client, meta, scrub, OUT } from './common.mjs';
const file = process.argv[2] ?? `${OUT}hero.jpg`;
const url = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
const STYLE = 'Style target: dark stealth noir. High contrast between lit and shadowed areas, visible light shafts and torch cones, glossy reflective floors, a cool-versus-warm colour split, subtle film grain and vignette, readable silhouettes, art on the walls that makes the place feel specific.';
const t0 = Date.now();
const res = await client.chat({ model: 'muse-spark-1.3', max_tokens: 2500, reasoning_effort: 'minimal',
  messages: [{ role: 'user', content: [
    { type: 'text', text: `${STYLE}\n\nThis is a screenshot of a 3D stealth game level. Critique it against the style target for a developer: give exactly five short bullets, each naming one concrete problem or strength and one specific fix I can make in a three.js renderer (a light, a material, a post effect, a prop). Then one line: overall, how close is it to the target on a 1 to 10 scale.` },
    { type: 'image_url', image_url: { url } }] }] });
console.log(scrub(meta.chatText(res)), `\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
