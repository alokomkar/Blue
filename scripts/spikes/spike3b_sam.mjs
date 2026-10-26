import fs from 'node:fs';
import { key, scrub, OUT, FIXTURES } from './common.mjs';
const url = 'data:image/jpeg;base64,' + fs.readFileSync(`${FIXTURES}sketch1.jpg`).toString('base64');
async function run(phrase, stream) {
  const t0 = Date.now();
  const res = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sam-3.1', stream, metadata: { mask_encoding: 'one_bit' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: phrase }, { type: 'input_image', image_url: url }] }] }) });
  const raw = await res.text();
  let text = '';
  if (stream) { for (const line of raw.split('\n')) { if (!line.startsWith('data:')) continue; try { const j = JSON.parse(line.slice(5)); if (j.type === 'response.output_text.delta') text += j.delta; } catch {} } }
  else { try { const j = JSON.parse(raw); text = (j.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join(''); } catch {} }
  const boxes = [...text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)].map((m) => m.slice(1, 7).join(','));
  console.log(`${phrase.padEnd(24)} stream=${stream} status=${res.status} ${Date.now() - t0}ms text=${text.length}ch boxes=${boxes.length}`, boxes.slice(0, 4).join(' | '));
  return text;
}
for (const p of ['paper', 'black marker line', 'wall', 'room', 'door', 'rectangle']) { try { const t = await run(p, true); if (p === 'wall') fs.writeFileSync(`${OUT}sam_wall_stream.txt`, t); } catch (e) { console.log(p, 'ERR', scrub(e.message)); } }
await run('wall', false);
