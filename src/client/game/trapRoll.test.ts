import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollStop, ROLL_DISTANCE, ROLL_WALL_MARGIN } from './trapRoll.ts';

const OPEN = ROLL_DISTANCE + ROLL_WALL_MARGIN; // nothing in the way
const WALL = 5; // a wall 5 ahead

test('a trap rolls its full distance on open floor, the way you face', () => {
  const s = rollStop(0, 0, 0, OPEN, []);
  assert.equal(s.slot, null);
  assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.z - ROLL_DISTANCE) < 1e-9);
  const east = rollStop(0, 0, Math.PI / 2, OPEN, []);
  assert.ok(Math.abs(east.x - ROLL_DISTANCE) < 1e-9);
});

test('it stops short of a wall in the way', () => {
  const s = rollStop(0, 0, 0, WALL, []);
  assert.ok(s.z < 5 && s.z > 4.3, `stopped at ${s.z}`);
});

test('it settles into a pack meeting point or a sentry post on its way, the nearest first', () => {
  const s = rollStop(0, 0, 0, OPEN, [
    { x: 0.8, z: 6, kind: 'sentry' },
    { x: -0.5, z: 3, kind: 'pack' },
  ]);
  assert.equal(s.slot, 'pack');
  assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.z - 3) < 1e-9, 'on its own line, level with the slot');
});

test('slots behind a wall, off to the side, or under your feet do not catch it', () => {
  assert.equal(rollStop(0, 0, 0, WALL, [{ x: 0, z: 7, kind: 'pack' }]).slot, null);
  assert.equal(rollStop(0, 0, 0, OPEN, [{ x: 3, z: 4, kind: 'pack' }]).slot, null);
  assert.equal(rollStop(0, 0, 0, OPEN, [{ x: 0, z: 0.3, kind: 'sentry' }]).slot, null);
});
