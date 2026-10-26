import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleCamo, tickCamo, camoConceals, bumpedInto, FULL_CAMO, CAMO_DRAIN_S, CAMO_RECHARGE_S, CAMO_MIN_START } from './camo.ts';

const run = (s: { energy: number; active: boolean }, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) s = tickCamo(s, 0.1);
  return s;
};

test('a full battery lasts CAMO_DRAIN_S, then camo switches itself off', () => {
  const on = toggleCamo(FULL_CAMO);
  assert.equal(on.active, true);
  assert.equal(run(on, CAMO_DRAIN_S - 0.5).active, true);
  const flat = run(on, CAMO_DRAIN_S + 0.5);
  assert.equal(flat.active, false);
  assert.ok(flat.energy < 0.05, 'flat, and only just starting to recharge');
});

test('it recharges while off, back to full in CAMO_RECHARGE_S', () => {
  const recharged = run({ energy: 0, active: false }, CAMO_RECHARGE_S + 0.5);
  assert.equal(recharged.energy, 1);
  assert.equal(recharged.active, false);
});

test('it will not switch on with a nearly flat battery', () => {
  assert.equal(toggleCamo({ energy: CAMO_MIN_START - 0.01, active: false }).active, false);
  assert.equal(toggleCamo({ energy: CAMO_MIN_START, active: false }).active, true);
});

test('switching it off early keeps the charge that is left', () => {
  const off = toggleCamo(run(toggleCamo(FULL_CAMO), 2));
  assert.equal(off.active, false);
  assert.ok(off.energy > 0.7 && off.energy < 0.8);
});

test('cloaked and still makes you invisible, sneaking or not; moving does not', () => {
  assert.equal(camoConceals(true, false), true);
  assert.equal(camoConceals(true, true), false);
  assert.equal(camoConceals(false, false), false);
});

test('standing still, the battery lasts twice as long', () => {
  let s = toggleCamo(FULL_CAMO);
  for (let t = 0; t < CAMO_DRAIN_S * 1.5; t += 0.1) s = tickCamo(s, 0.1, true);
  assert.equal(s.active, true);
  for (let t = 0; t < CAMO_DRAIN_S * 0.6; t += 0.1) s = tickCamo(s, 0.1, true);
  assert.equal(s.active, false);
});

test('an enemy walking right into you counts as a bump; one a step away does not', () => {
  const r = 0.32;
  assert.equal(bumpedInto(0, 0, r, [{ x: 0.34 + r, z: 0, r: 0.34 }]), true);
  assert.equal(bumpedInto(0, 0, r, [{ x: 1.5, z: 0, r: 0.34 }]), false);
  assert.equal(bumpedInto(0, 0, r, []), false);
});
