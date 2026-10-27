import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SAY, ORDER_IDS, ORDER_SCHEMA, SAY_MAX, TARGET_IDS, matchOrder, normalise, parseOrder } from './orders.ts';

const orderOf = (t: string) => matchOrder(t)?.order ?? null;

test('every order has a default line of at most SAY_MAX characters, and the schema lists the same orders and targets', () => {
  for (const id of ORDER_IDS) assert.ok(DEFAULT_SAY[id].length <= SAY_MAX, id);
  for (const id of ORDER_IDS) if (id !== 'none') assert.ok(DEFAULT_SAY[id].length > 0, id);
  assert.deepEqual(ORDER_SCHEMA.properties.order.enum, [...ORDER_IDS]);
  assert.deepEqual(ORDER_SCHEMA.properties.target.enum, [...TARGET_IDS]);
  assert.deepEqual(ORDER_SCHEMA.required, ['order', 'say']);
});

test('normalise: lower case, no punctuation or apostrophes, single spaces', () => {
  assert.equal(normalise("  Don't   MOVE!! "), 'dont move');
  assert.equal(normalise('Cover me, please.'), 'cover me please');
  assert.equal(normalise('Café—hold'), 'cafe hold');
  assert.equal(normalise('…'), '');
});

test('cover me, and the ways of saying it', () => {
  for (const t of ['cover me', 'Cover me.', 'COVER ME!', 'cover', 'cover us', 'give me cover', 'watch my back', 'watch my six', 'you got my back', 'help', 'help me', 'need cover']) {
    assert.equal(orderOf(t), 'cover_me', t);
  }
});

test('hold, stay and wait', () => {
  for (const t of ['hold', 'Hold.', 'hold here', 'hold position', 'hold up', 'stay', 'stay here', 'stay put', 'stay there', 'wait', 'wait here', 'hang back', 'stand by', 'freeze', 'stop', "don't move", 'do not move']) {
    assert.equal(orderOf(t), 'hold', t);
  }
});

test('follow', () => {
  for (const t of ['follow me', 'follow', 'with me', 'come with me', 'stay with me', 'stick with me', 'keep up', 'come on', "let's go", 'move out']) {
    assert.equal(orderOf(t), 'follow', t);
  }
});

test('regroup and come here', () => {
  for (const t of ['regroup', 'regroup on me', 'come here', 'Come here!', 'to me', 'over here', 'get over here', 'back to me', 'on me']) {
    assert.equal(orderOf(t), 'regroup', t);
  }
});

test('wait at the lift', () => {
  for (const t of ['wait at the lift', 'wait by the lift', 'hold the lift', 'hold at the lift', 'meet me at the lift', 'go to the lift', 'head to the elevator', 'wait for me at the lift']) {
    assert.equal(orderOf(t), 'wait_at_lift', t);
  }
});

test('take: a guard by default, a dog or the next one when said', () => {
  for (const t of ['take him', 'take them', 'take the guard', 'take out the guard', 'take down the guard', 'shoot', 'shoot him', 'shoot the guard', 'stun him', 'fire', 'engage']) {
    assert.deepEqual(matchOrder(t), { order: 'take', target: 'nearest_guard', say: DEFAULT_SAY.take }, t);
  }
  assert.equal(matchOrder('shoot the dog')?.target, 'nearest_dog');
  assert.equal(matchOrder('take out the dog')?.target, 'nearest_dog');
  assert.equal(matchOrder('take the next guard')?.target, 'next_guard');
});

test('distract', () => {
  for (const t of ['distract', 'distract him', 'distract the guard', 'make a distraction', 'make some noise', 'create a distraction']) {
    assert.deepEqual(matchOrder(t), { order: 'distract', target: 'nearest_guard', say: DEFAULT_SAY.distract }, t);
  }
});

test('um, okay, please and the partner name around an order change nothing', () => {
  assert.equal(orderOf('um, hold'), 'hold');
  assert.equal(orderOf('Okay, cover me.'), 'cover_me');
  assert.equal(orderOf('uh okay um follow me please'), 'follow');
  assert.equal(orderOf('Agent B, hold.'), 'hold');
  assert.equal(orderOf('agent a cover me'), 'cover_me');
  assert.equal(orderOf('Hey partner, regroup'), 'regroup');
  assert.equal(orderOf('can you cover me'), 'cover_me');
  assert.equal(orderOf('could you please hold here'), 'hold');
  assert.equal(orderOf('I need you to take him'), 'take');
  assert.equal(orderOf('cover me now'), 'cover_me');
  assert.equal(orderOf('hold please'), 'hold');
  assert.equal(orderOf('ok ok follow me'), 'follow');
});

test('the answer carries the default line and no target for orders that do not aim', () => {
  assert.deepEqual(matchOrder('cover me'), { order: 'cover_me', say: 'Covering you' });
  assert.deepEqual(matchOrder('hold'), { order: 'hold', say: 'Holding here' });
  assert.equal('target' in matchOrder('follow me')!, false);
});

test('chatter and things that are not orders go to the model', () => {
  for (const t of ['what a nice day', 'nice weather today', 'hello', 'um', '', '   ', '...', 'okay', 'thanks', 'I love this level', 'where is the lift', 'is anyone there']) {
    assert.equal(matchOrder(t), null, t);
  }
});

test('near misses: a sentence that merely contains an order word is not an order', () => {
  // (null means "let the model decide": it may still call some of these an order, or none.)
  for (const t of [
    'I will hold the door',
    'I think you should cover me',
    'do not cover me',
    "don't follow me",
    'never hold',
    'we should hold the line',
    'he is going to take the guard',
    'the guard is holding',
    'cover the door',
    'follow the guard',
    'hold fire',
    'take the guard on the left',
    'shoot the camera',
    'wait for the guard to leave',
  ]) {
    assert.equal(matchOrder(t), null, t);
  }
});

test('compound or conditional sentences go to the model, which acts on the first step', () => {
  for (const t of [
    'cover me while I work the console',
    'take out the guard on the left, then hold at the lift',
    'hold and cover me',
    'follow me and stay quiet',
    'when I say go, shoot',
    'if a guard comes, take him',
    'cover me until I am done',
    'hold or follow',
    'stay here but cover me',
  ]) {
    assert.equal(matchOrder(t), null, t);
  }
});

test('a very long transcript is never an order', () => {
  assert.equal(matchOrder('hold '.repeat(30)), null);
});

test('parseOrder: model JSON becomes a legal order, anything else is null', () => {
  assert.deepEqual(parseOrder('{"order":"cover_me","say":"On it"}'), { order: 'cover_me', say: 'On it' });
  assert.deepEqual(parseOrder({ order: 'take', target: 'nearest_dog', say: 'Dog down' }), { order: 'take', target: 'nearest_dog', say: 'Dog down' });
  // an unknown target, or a target on an order that does not aim, is dropped
  assert.deepEqual(parseOrder({ order: 'take', target: 'moon', say: 'x' }), { order: 'take', say: 'x' });
  assert.deepEqual(parseOrder({ order: 'hold', target: 'north', say: 'x' }), { order: 'hold', say: 'x' });
  // a missing line is filled for an order, left empty for none
  assert.equal(parseOrder({ order: 'hold' })?.say, DEFAULT_SAY.hold);
  assert.equal(parseOrder({ order: 'none', say: '' })?.say, '');
  // a long line is cut to SAY_MAX
  const long = parseOrder({ order: 'follow', say: 'x'.repeat(200) })!;
  assert.equal(long.say.length, SAY_MAX);
  assert.ok(long.say.endsWith('…'));
  assert.equal(parseOrder({ order: 'follow', say: '  two   words\n' })?.say, 'two words');
  for (const bad of [null, undefined, 3, [], '[]', 'not json', '{"order":"dance","say":"x"}', { say: 'x' }, { order: 5 }]) assert.equal(parseOrder(bad), null, String(bad));
});

test('readVoiceReply: the endpoint\'s JSON, re-checked; an error body or a stub answer is not a reply', async () => {
  const { readVoiceReply, voiceErrorText } = await import('./orders.ts');
  const ok = readVoiceReply({ transcript: ' cover   me. ', order: { order: 'cover_me', say: 'Covering you' }, source: 'fast', ms: { asr: 1200, order: 0 } });
  assert.deepEqual(ok, { transcript: 'cover me.', order: { order: 'cover_me', say: 'Covering you' }, source: 'fast', ms: { asr: 1200, order: 0 } });
  // a bad order becomes none (the transcript still shows); an odd source is none
  assert.deepEqual(readVoiceReply({ transcript: 'x', order: { order: 'dance' }, source: 'weird' })?.order, { order: 'none', say: '' });
  assert.equal(readVoiceReply({ transcript: 'x', order: { order: 'hold', say: 'k' }, source: 'weird' })?.source, 'none');
  assert.equal(readVoiceReply({ transcript: 'x', order: { order: 'none', say: '' }, note: 'model_timeout' })?.note, 'model_timeout');
  assert.equal(readVoiceReply({ error: 'not_implemented', fallback: true }), null);
  assert.equal(readVoiceReply({ transcript: 'x', error: 'boom' }), null);
  for (const bad of [null, 'text', 5, [], {}]) assert.equal(readVoiceReply(bad), null);
  assert.ok(readVoiceReply({ transcript: 'x'.repeat(1000), order: { order: 'none', say: '' } })!.transcript.length <= 200);
  for (const [status, code] of [[0, 'network'], [0, 'timeout'], [503, 'no_key'], [429, 'rate_limited'], [413, 'audio_too_long'], [404, undefined], [500, 'internal']] as const) {
    assert.ok(voiceErrorText(status, code).length > 0);
  }
  assert.notEqual(voiceErrorText(0, 'timeout'), voiceErrorText(0, 'network'));
  assert.equal(voiceErrorText(504, 'timeout'), voiceErrorText(0, 'timeout'));
});
