import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_LENGTH, ROOM, TIMELINE, fits, firstThatFits, openness, ramp } from './stash.ts';

const HEAVY = 1.22;

test('a standard body fits a staff locker, a crate pair and a vent', () => {
  for (const c of ['locker', 'crates', 'vent'] as const) assert.equal(fits(c, 1), true, c);
});

test('a heavy fits none of them', () => {
  for (const c of ['locker', 'crates', 'vent'] as const) assert.equal(fits(c, HEAVY), false, c);
  assert.equal(firstThatFits(['locker', 'crates', 'vent'], HEAVY), null);
});

test('one crate (0.9 m) is too short for a body, two together are not', () => {
  assert.ok(BODY_LENGTH > 0.9);
  assert.ok(ROOM.crates.length >= BODY_LENGTH);
});

test('each container opens, loads and seals in order, and is open while the body goes in', () => {
  for (const c of ['locker', 'crates', 'vent'] as const) {
    const t = TIMELINE[c];
    assert.ok(t.open < t.load && t.load < t.seal && t.seal < t.done, c);
    assert.equal(openness(c, 0), 0);
    assert.ok(openness(c, t.load) > 0.99, `${c} open at load`);
    assert.equal(openness(c, t.done), 0);
  }
});

test('ramp eases between its ends', () => {
  assert.equal(ramp(0, 1, 2), 0);
  assert.equal(ramp(1.5, 1, 2), 0.5);
  assert.equal(ramp(3, 1, 2), 1);
});
