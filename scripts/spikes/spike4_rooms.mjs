import fs from 'node:fs';
import { client, meta, key, scrub, OUT, FIXTURES } from './common.mjs';
const url = 'data:image/jpeg;base64,' + fs.readFileSync(`${FIXTURES}sketch1.jpg`).toString('base64');
const W = 1024, H = 1024;
// 1. Spark: the rooms as boxes on the 0-1000 grid
const schema = { type: 'object', additionalProperties: false, required: ['rooms', 'entrance'], properties: {
  rooms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'x_min', 'y_min', 'x_max', 'y_max'], properties: { name: { type: 'string' }, x_min: { type: 'integer' }, y_min: { type: 'integer' }, x_max: { type: 'integer' }, y_max: { type: 'integer' } } } },
  entrance: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'integer' }, y: { type: 'integer' } } } } };
let t0 = Date.now();
const res = await client.chat({ model: 'muse-spark-1.3', max_tokens: 1500, reasoning_effort: 'minimal',
  messages: [{ role: 'user', content: [
    { type: 'text', text: 'This is a hand-drawn floor plan seen from above. List every enclosed room as a bounding box of its INTERIOR (the white space inside the walls, not the walls) on a normalized 0-1000 grid with (0,0) top-left, and the entrance (a gap in the outer wall that opens to the outside). Return JSON only.' },
    { type: 'image_url', image_url: { url } }] }],
  response_format: { type: 'json_schema', json_schema: { name: 'Plan', schema } } });
const plan = JSON.parse(meta.chatText(res));
console.log('spark rooms', Date.now() - t0, 'ms', JSON.stringify(plan));
// 2. SAM: each room's box -> a mask
const px = (v, n) => Math.min(n - 1, Math.max(0, Math.round(v * n / 1000)));
const objs = plan.rooms.map((r, i) => `${i + 1}<|box;x1=${px(r.x_min, W)};y1=${px(r.y_min, H)};x2=${px(r.x_max, W)};y2=${px(r.y_max, H)};w=${W};h=${H}|>`);
const prompt = `<0f>${objs.join(',')}`;
console.log('prompt', prompt.slice(0, 300));
t0 = Date.now();
const r = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'sam-3.1', stream: true, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: url }] }] }) });
const raw = await r.text();
let text = ''; for (const line of raw.split('\n')) { if (!line.startsWith('data:')) continue; try { const j = JSON.parse(line.slice(5)); if (j.type === 'response.output_text.delta') text += j.delta; } catch {} }
fs.writeFileSync(`${OUT}sam_rooms.txt`, text);
const boxes = [...text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)].map((m) => m.slice(1, 5).join(','));
console.log('sam', r.status, Date.now() - t0, 'ms', 'text', text.length, 'ch; boxes', boxes.length, boxes.join(' | '));
console.log(scrub(raw.slice(0, 200)));
