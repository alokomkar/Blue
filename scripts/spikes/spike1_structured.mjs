import { client, meta, scrub } from './common.mjs';
const schema = { type: 'object', additionalProperties: false, required: ['title','place','layout','contract','size','roster'],
  properties: {
    title: { type: 'string' },
    place: { type: 'string', enum: ['campus','museum','refinery','bank','warehouse','lab'] },
    layout: { type: 'string', enum: ['halls','aisles','fishbone','plus','uturn','maze'] },
    contract: { type: 'string', enum: ['records','sabotage','vault','hit','blackout','extract','swap','shipment'] },
    size: { type: 'object', additionalProperties: false, required: ['cols','rows'], properties: { cols: { type: 'integer', minimum: 6, maximum: 14 }, rows: { type: 'integer', minimum: 5, maximum: 10 } } },
    roster: { type: 'object', additionalProperties: false, required: ['guards','watchdogs'], properties: { guards: { type: 'integer', minimum: 1, maximum: 6 }, watchdogs: { type: 'integer', minimum: 0, maximum: 2 } } },
  } };
for (const effort of ['minimal', undefined]) {
  const t0 = Date.now();
  try {
    const res = await client.chat({ model: meta.modelsFromEnv(process.env).planner, max_tokens: 800, ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: 'system', content: 'You design one level of a stealth-heist game from a request. Reply only with the JSON spec.' }, { role: 'user', content: 'A night job at a museum: two guards, one dog, steal a painting from the vault.' }],
      response_format: { type: 'json_schema', json_schema: { name: 'LevelSpec', schema } } });
    const text = meta.chatText(res);
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    console.log(`effort=${effort ?? 'default'} ${Date.now() - t0} ms parsed=${!!parsed}`, text.slice(0, 300));
  } catch (e) { console.log('ERR', effort, scrub(e.message ?? e)); }
}
