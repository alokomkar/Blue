import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatTarget, legPause, BEAT_CHANCE, BEAT_PAUSE_S, LEG_PAUSE_S } from './patrol.ts';

const dist = [
  [0, 1, 2, 3],
  [-1, -1, -1, 4],
  [8, 7, 6, 5],
];
const beat = [
  { x: 1, y: 0 }, // right beside it: doesn't count
  { x: 3, y: 1 },
  { x: 0, y: 2 },
];

test('most legs head for a beat point the guard can reach and isn’t already at', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = beatTarget(dist, beat, () => (i % 10) / 10);
    if (t) seen.add(`${t.x},${t.y}`);
  }
  assert.deepEqual([...seen].sort(), ['0,2', '3,1']);
});

test('the rest of the time it wanders, and with no beat points in reach it always does', () => {
  assert.equal(beatTarget(dist, beat, () => BEAT_CHANCE), null);
  assert.equal(beatTarget(dist, [{ x: 0, y: 1 }], () => 0), null, 'unreachable');
  assert.equal(beatTarget(dist, [], () => 0), null);
});

test('a guard stops longer at a beat point and looks further round than at the end of an ordinary leg', () => {
  const beat = legPause(true, () => 0.5);
  const leg = legPause(false, () => 0.5);
  assert.ok(beat.seconds > leg.seconds && beat.look > leg.look);
  assert.equal(legPause(true, () => 0).seconds, BEAT_PAUSE_S[0]);
  assert.ok(legPause(false, () => 0.999).seconds < LEG_PAUSE_S[1]);
});

import { lingerTarget, lingerPause, LINGER_CHANCE, LINGER_CHANCE_HIDER, LINGER_PAUSE_S, BEAT_PAUSE_S as BEAT_PAUSE } from './patrol.ts';

const spots = [
  { x: 3, y: 1, facing: 1 },
  { x: 0, y: 2, facing: 2 },
  { x: 1, y: 0, facing: 3 }, // beside it: doesn't count
];

test('a guard lingers at a stop it can reach and isn’t already beside, now and then', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    let calls = 0;
    const t = lingerTarget(dist, spots, null, () => (calls++ === 0 ? 0 : (i % 10) / 10));
    if (t) seen.add(`${t.x},${t.y}`);
  }
  assert.deepEqual([...seen].sort(), ['0,2', '3,1']);
  assert.equal(lingerTarget(dist, spots, null, () => LINGER_CHANCE), null);
  assert.equal(lingerTarget(dist, [], null, () => 0), null);
  assert.equal(lingerTarget(dist, [{ x: 0, y: 1, facing: 0 }], null, () => 0), null, 'unreachable');
});

test('with the agent hiding, the stop nearest to them is the one it goes to, and more often', () => {
  assert.deepEqual(lingerTarget(dist, spots, { x: 3, y: 2 }, () => 0.5), spots[0]);
  assert.deepEqual(lingerTarget(dist, spots, { x: 0, y: 2 }, () => 0.5), spots[1]);
  assert.equal(lingerTarget(dist, spots, { x: 3, y: 2 }, () => LINGER_CHANCE_HIDER), null);
  assert.ok(LINGER_CHANCE_HIDER > LINGER_CHANCE);
  // A hider far from every stop changes nothing.
  assert.equal(lingerTarget(dist, spots, { x: 40, y: 40 }, () => LINGER_CHANCE), null);
});

test('a lingering guard stays longer than at any beat', () => {
  assert.ok(lingerPause(() => 0) >= BEAT_PAUSE[1] - 1);
  assert.equal(lingerPause(() => 0), LINGER_PAUSE_S[0]);
});
