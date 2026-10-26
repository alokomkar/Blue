import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_RANGE, MIN_ATTACK_ARC, STANDOFF_R, backOffSpot, bearingApart, holdsBack, pickBearing, rangeStep } from './standoff.ts';

test('a guard holds back at the stand-off from a player out of its reach, and not a step before', () => {
  assert.equal(holdsBack(true, 0, 0, STANDOFF_R + 0.5, 0), false);
  assert.equal(holdsBack(true, 0, 0, STANDOFF_R, 0), true);
  assert.equal(holdsBack(true, 0, 0, 1, 1), true, 'and one already underneath stays put');
});

test('a player within reach is walked up to as ever', () => {
  assert.equal(holdsBack(false, 0, 0, 1, 0), false);
  assert.equal(holdsBack(false, 0, 0, STANDOFF_R, 0), false);
});

test('the stand-off is inside a guard’s firing range, so being seen up there still has its price', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./bots.ts', import.meta.url), 'utf8');
  const range = Number(/export const BOT_FIRE_RANGE = (\d+)/.exec(src)![1]);
  assert.ok(STANDOFF_R < range, `${STANDOFF_R} < ${range}`);
});

test('a guard in a fight comes on until it is in range, stands and shoots in the band, and backs off when the agent is too near', () => {
  const r = HOLD_RANGE.guard;
  assert.equal(rangeStep(r.max + 1, r, true), 'close');
  assert.equal(rangeStep((r.min + r.max) / 2, r, true), 'hold');
  assert.equal(rangeStep(r.min - 1, r, true), 'back');
  assert.equal(rangeStep(r.min - 1, r, false), 'hold', 'a guard that cannot see them does not back away from where they might be');
});

test('every kind keeps to a band that is inside its firing range, and with room to stand in', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./bots.ts', import.meta.url), 'utf8');
  const fire = Number(/export const BOT_FIRE_RANGE = (\d+)/.exec(src)![1]);
  for (const [kind, r] of Object.entries(HOLD_RANGE)) {
    assert.ok(r.max < fire, `${kind}: ${r.max} is inside ${fire}`);
    assert.ok(r.max - r.min >= 1.5, `${kind} has a band to stand in`);
    assert.ok(r.min >= 3, `${kind} keeps its distance`);
  }
});

test('backing off goes out along the line from the agent, past the near edge of the band', () => {
  const r = HOLD_RANGE.guard;
  const spot = backOffSpot({ x: 0, z: 0 }, { x: 2, z: 0 }, r);
  assert.ok(spot.x > r.min && Math.abs(spot.z) < 1e-9);
  const diag = backOffSpot({ x: 1, z: 1 }, { x: 2, z: 2 }, r);
  assert.ok(Math.hypot(diag.x - 1, diag.z - 1) > r.min);
});

test('a guard keeps its own bearing when no other attacker is within 30 degrees of it', () => {
  assert.equal(pickBearing(1, []), 1);
  assert.equal(pickBearing(1, [1 + MIN_ATTACK_ARC + 0.05, 1 - MIN_ATTACK_ARC - 0.05]), 1);
});

test('with another attacker on its line, a guard takes the nearest bearing that is at least 30 degrees from every other', () => {
  const others = [1.0, 1.0 + 0.7];
  const b = pickBearing(1.05, others);
  for (const o of others) assert.ok(bearingApart(b, o) >= MIN_ATTACK_ARC - 1e-9, `${b} vs ${o}`);
  assert.ok(bearingApart(b, 1.05) < Math.PI / 2, 'it goes round the short way, not to the far side');
});

test('a ring of attackers fills the circle: each new one finds a gap, all at least 30 degrees apart', () => {
  const taken: number[] = [];
  for (let i = 0; i < 6; i++) {
    const b = pickBearing(0.1, taken);
    for (const o of taken) assert.ok(bearingApart(b, o) >= MIN_ATTACK_ARC - 1e-9, `attacker ${i}`);
    taken.push(b);
  }
  assert.equal(taken.length, 6);
});

test('wrapping round the circle: bearings across the +PI / -PI line count as close', () => {
  assert.ok(bearingApart(3.1, -3.1) < 0.2);
  const b = pickBearing(3.1, [-3.1]);
  assert.ok(bearingApart(b, -3.1) >= MIN_ATTACK_ARC - 1e-9);
});
