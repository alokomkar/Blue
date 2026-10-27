// Can Muse Image make game art? A seamless floor texture, a wall painting, a panorama and a prop on white for SAM to cut out.
// Usage: node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/spikes/spike9_graphics.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { client, scrub, OUT } from './common.mjs';
const jobs = {
  floor_stone: ['A seamless tileable texture of polished grey stone floor tiles seen straight from above, subtle wear, flat even lighting, no perspective, no objects, no text', '1024x1024'],
  floor_carpet: ['A seamless tileable texture of a dark red carpet with a subtle gold geometric pattern, seen straight from above, flat even lighting, no perspective, no objects, no text', '1024x1024'],
  painting: ['A framed abstract oil painting in a museum, front view, ornate gold frame, deep blues and ochre, a plain dark wall behind it, no text', '1024x1024'],
  panorama: ['A wide panoramic night skyline of an invented industrial port city seen from a rooftop, distant lit cranes and warehouses, teal and orange haze, no text, no people', '2048x1024'],
  prop: ['A potted green plant in a ceramic pot photographed on a plain pure white background, centred, soft shadow, no text', '1024x1024'],
};
const t0 = Date.now();
await Promise.all(Object.entries(jobs).map(async ([name, [prompt, size]]) => {
  try {
    const r = await client.image(prompt, { size });
    const buf = Buffer.from(r.b64, 'base64');
    fs.writeFileSync(`${OUT}${name}.webp`, buf);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}${name}.webp`, `${OUT}${name}.png`]);
    console.log(name.padEnd(13), 'ok', `${((Date.now() - t0) / 1000).toFixed(1)}s`, buf.length, 'bytes');
  } catch (e) { console.log(name, 'ERR', scrub(e.message ?? e)); }
}));
