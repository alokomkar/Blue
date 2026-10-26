import fs from 'node:fs';
import { client, scrub, OUT } from './common.mjs';
const prompts = {
  sketch: 'A hand-drawn floor plan of a small building, drawn with a thick black marker on plain white paper, viewed straight from above, simple rectangular rooms with thick walls, a few gaps for doors, no text, no furniture, a phone photo with soft light',
};
for (const [name, prompt] of Object.entries(prompts)) {
  const t0 = Date.now();
  try {
    const r = await client.image(prompt, { size: '1024x1024' });
    fs.writeFileSync(`${OUT}${name}.png`, Buffer.from(r.b64, 'base64'));
    console.log(name, 'ok', Date.now() - t0, 'ms', Buffer.from(r.b64, 'base64').length, 'bytes', r.mime);
  } catch (e) { console.log(name, 'ERR', scrub(e.message ?? e)); }
}
