// A prop generated on a white background, then cut out with SAM 3.1 ("potted plant"): can an AI-made picture become a sprite with transparent edges?
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { key, OUT } from './common.mjs';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}prop.png`, '-vf', 'scale=1024:1024', '-q:v', '3', `${OUT}prop.jpg`]);
const url = 'data:image/jpeg;base64,' + fs.readFileSync(`${OUT}prop.jpg`).toString('base64');
const t0 = Date.now();
const r = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'sam-3.1', stream: true, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'potted plant' }, { type: 'input_image', image_url: url }] }] }) });
const raw = await r.text();
const evs = []; for (const block of raw.split('\n\n')) { const d = block.split('\n').find((l) => l.startsWith('data:')); if (!d) continue; try { evs.push(JSON.parse(d.slice(5))); } catch {} }
async function* gen() { for (const e of evs) yield e; }
const result = await parseImageStream(gen()).finalResult;
const masks = recordsOfKind(result.records, 'mask');
console.log('sam', r.status, `${Date.now() - t0} ms`, 'matches', masks.length);
if (!masks.length) process.exit(0);
const m = masks[0]; const ras = decodeMaskToRaster(m.mask); const { left, top } = m.bounds; const W = 1024;
const on = ras.reduce((a, b) => a + b, 0);
console.log('mask', m.mask.width, 'x', m.mask.height, 'at', left, top, 'coverage', ((on / ras.length) * 100).toFixed(0) + '% of its box');
// write an RGBA-less preview: the mask as a grey image on black, to look at it (PGM -> png by ffmpeg)
const img = Buffer.alloc(W * W);
for (let y = 0; y < m.mask.height; y++) for (let x = 0; x < m.mask.width; x++) if (ras[y * m.mask.width + x]) img[(top + y) * W + (left + x)] = 255;
fs.writeFileSync(`${OUT}prop_mask.pgm`, Buffer.concat([Buffer.from(`P5 ${W} ${W} 255\n`), img]));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}prop_mask.pgm`, '-vf', 'scale=384:384', `${OUT}prop_mask.png`]);
