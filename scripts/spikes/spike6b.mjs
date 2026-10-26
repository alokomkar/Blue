import { client, meta, scrub } from './common.mjs';
const schema = { type: 'object', additionalProperties: false, required: ['order', 'say'], properties: {
  order: { type: 'string', enum: ['hold', 'follow', 'cover_me', 'distract', 'take', 'wait_at_lift', 'regroup', 'none'] },
  target: { type: 'string', enum: ['nearest_guard', 'nearest_dog', 'next_guard', 'north', 'south', 'east', 'west'] },
  say: { type: 'string' } } };
const text = 'take out the guard on the left then hold at the lift.';
for (const [label, extra] of [['minimal+400', { reasoning_effort: 'minimal', max_tokens: 400 }], ['default+800', { max_tokens: 800 }], ['minimal+schema-no-target', { reasoning_effort: 'minimal', max_tokens: 400, noTarget: true }]]) {
  const sch = extra.noTarget ? { ...schema, properties: { order: schema.properties.order, say: schema.properties.say } } : schema;
  const t0 = Date.now();
  const res = await client.chat({ model: 'muse-spark-1.3', max_tokens: extra.max_tokens, ...(extra.reasoning_effort ? { reasoning_effort: extra.reasoning_effort } : {}),
    messages: [{ role: 'system', content: 'You are an AI partner agent in a stealth game. Turn the player\'s spoken command into the FIRST order to carry out (later steps are ignored). Use order "none" if it is not a command. Reply with JSON only. "say" is a 6-word-max reply.' }, { role: 'user', content: text }],
    response_format: { type: 'json_schema', json_schema: { name: 'Order', schema: sch } } });
  console.log(label, Date.now() - t0, 'ms', 'finish', res.choices?.[0]?.finish_reason, 'content', JSON.stringify(meta.chatText(res)), 'usage', JSON.stringify(res.usage?.completion_tokens_details));
}
