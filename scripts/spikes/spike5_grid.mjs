import fs from 'node:fs';
import { key, OUT, FIXTURES } from './common.mjs';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
const url = 'data:image/jpeg;base64,' + fs.readFileSync(`${FIXTURES}sketch1.jpg`).toString('base64');
const prompt = '<0f>1<|box;x1=210;y1=287;x2=507;y2=778;w=1024;h=1024|>,2<|box;x1=543;y1=287;x2=799;y2=507;w=1024;h=1024|>,3<|box;x1=548;y1=568;x2=799;y2=778;w=1024;h=1024|>';
const r = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'sam-3.1', stream: true, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: url }] }] }) });
const raw = await r.text();
const evs = []; for (const block of raw.split('\n\n')) { const d = block.split('\n').find((l) => l.startsWith('data:')); if (!d) continue; try { evs.push(JSON.parse(d.slice(5))); } catch {} }
console.log('events', evs.map((e) => e.type).join(' '));
async function* gen() { for (const e of evs) yield e; }
const result = await parseImageStream(gen()).finalResult;
const masks = recordsOfKind(result.records, 'mask');
console.log('records', result.records.length, 'masks', masks.length, 'diagnostics', JSON.stringify(result.diagnostics ?? []).slice(0, 200));
const W = 1024, H = 1024, G = 16, cell = W / G;
const boxes = recordsOfKind(result.records, 'box');
console.log('box record keys', Object.keys(boxes[0] ?? {}), JSON.stringify(boxes[0]).slice(0,200));
console.log('mask record keys', Object.keys(masks[0] ?? {}), JSON.stringify({...masks[0], mask: Object.keys(masks[0].mask)}).slice(0,300));
const rooms = masks.map((rec, i) => { const m = rec.mask ?? rec; const ras = decodeMaskToRaster(m); const b = boxes[i].box ?? boxes[i]; return { id: rec.objectId ?? rec.id, ras, w: m.width ?? m.w, h: m.height ?? m.h, x1: rec.bounds.left, y1: rec.bounds.top }; });
console.log(rooms.map((q) => `${q.id}: ${q.w}x${q.h} on=${q.ras.reduce((a, b) => a + b, 0)}`).join(' | '));
const grid = [];
for (let gy = 0; gy < G; gy++) { let row = ''; for (let gx = 0; gx < G; gx++) { let best = '.', bf = 0.45;
  for (const q of rooms) { let on = 0, n = 0; for (let y = Math.floor(gy * cell); y < Math.floor((gy + 1) * cell); y += 4) for (let x = Math.floor(gx * cell); x < Math.floor((gx + 1) * cell); x += 4) { n++; const mx = x - q.x1, my = y - q.y1; if (mx >= 0 && my >= 0 && mx < q.w && my < q.h) on += q.ras[my * q.w + mx] ? 1 : 0; } if (on / n > bf) { bf = on / n; best = String(q.id); } }
  row += best; } grid.push(row); }
console.log(grid.join('\n'));
