import fs from 'node:fs';
import { client, meta, scrub, OUT } from './common.mjs';
const keywords = ['lift', 'console', 'terminal', 'guard', 'dog', 'alpha', 'cover', 'hold', 'stay', 'follow', 'distract', 'flash', 'EMP', 'stairs', 'door'];
const schema = { type: 'object', additionalProperties: false, required: ['order', 'say'], properties: {
  order: { type: 'string', enum: ['hold', 'follow', 'cover_me', 'distract', 'take', 'wait_at_lift', 'regroup', 'none'] },
  target: { type: 'string', enum: ['nearest_guard', 'nearest_dog', 'next_guard', 'north', 'south', 'east', 'west'] },
  say: { type: 'string' } } };
// macOS only: the test commands are spoken with `say` and converted to mono 24 kHz WAV (the format the endpoint wants).
import { execFileSync } from 'node:child_process';
const SAY = { cover: ['Samantha', 'Cover me while I work the console'], take: ['Daniel', 'Take out the guard on the left, then hold at the lift'] };
for (const name of ['cover', 'take']) {
  if (!fs.existsSync(`${OUT}${name}.wav`)) {
    execFileSync('say', ['-v', SAY[name][0], '-o', `${OUT}${name}.aiff`, SAY[name][1]]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}${name}.aiff`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', `${OUT}${name}.wav`]);
  }
  const wav = new Uint8Array(fs.readFileSync(`${OUT}${name}.wav`));
  let t0 = Date.now();
  try {
    const tr = await client.transcribe(wav, { keywords, mode: 'PUSH_TO_TALK' });
    const t1 = Date.now() - t0; t0 = Date.now();
    const res = await client.chat({ model: 'muse-spark-1.3', max_tokens: 400, reasoning_effort: 'minimal',
      messages: [{ role: 'system', content: 'You are an AI partner agent in a stealth game. Turn the player\'s spoken command into one order. Use order "none" if it is not a command. Reply with JSON only. "say" is a 6-word-max reply.' }, { role: 'user', content: tr.transcript }],
      response_format: { type: 'json_schema', json_schema: { name: 'Order', schema } } });
    const t2 = Date.now() - t0;
    console.log(`${name}: transcript=${JSON.stringify(tr.transcript)} (${t1} ms) -> ${meta.chatText(res)} (${t2} ms) total ${t1 + t2} ms`);
  } catch (e) { console.log(name, 'ERR', scrub(e.message ?? e)); }
}
