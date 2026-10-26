import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineBlocked, pickCover, segmentHitsBox, type CoverBox } from './coverMove.ts';

const crate: CoverBox = { minX: -0.95, maxX: 0.95, minZ: 9.4, maxZ: 10.6, cover: 'low' };
const wall: CoverBox = { minX: -8, maxX: 8, minZ: 19.8, maxZ: 20.2 };

test('a segment through a box hits it, one beside it or short of it does not', () => {
  assert.equal(segmentHitsBox({ x: 0, z: 0 }, { x: 0, z: 20 }, crate), true);
  assert.equal(segmentHitsBox({ x: 3, z: 0 }, { x: 3, z: 20 }, crate), false);
  assert.equal(segmentHitsBox({ x: 0, z: 0 }, { x: 0, z: 9 }, crate), false);
  assert.equal(lineBlocked({ x: 0, z: 0 }, { x: 0, z: 15 }, [crate]), true);
});

test('against an agent across the room, a guard takes cover behind the crate, hidden, with a spot at its end to lean out to', () => {
  const agent = { x: 0, z: 0 };
  const pick = pickCover({ x: 0, z: 18 }, agent, [crate, wall])!;
  assert.ok(pick, 'there is cover');
  assert.equal(pick.box, crate);
  assert.ok(pick.hide.z > crate.maxZ, 'on the far side from the agent');
  assert.ok(lineBlocked(agent, pick.hide, [crate]), 'hidden from the agent');
  assert.ok(!lineBlocked(agent, pick.peek, [crate, wall]), 'in its sight at the end of the crate');
  assert.ok(Math.abs(pick.peek.x) > 0.95, 'out past the crate’s end');
});

test('cover that does not bring the guard nearer the agent, or is too close to the agent, or is a wall, is not taken', () => {
  const agent = { x: 0, z: 0 };
  assert.equal(pickCover({ x: 0, z: 11.2 }, agent, [crate]), null, 'already behind it: no progress to be made');
  assert.equal(pickCover({ x: 0, z: 18 }, { x: 0, z: 8 }, [crate]), null, 'the agent is right at it');
  assert.equal(pickCover({ x: 0, z: 25 }, agent, [wall]), null, 'a wall has no cover set');
  assert.equal(pickCover({ x: 0, z: 18 }, agent, []), null, 'nothing to hide behind');
});

test('a run too long to cover is not worth it; of two, the nearer wins', () => {
  const far: CoverBox = { minX: 20, maxX: 22, minZ: 5, maxZ: 6, cover: 'tall' };
  assert.equal(pickCover({ x: 40, z: 40 }, { x: 0, z: 0 }, [far], { maxRun: 6 }), null);
  const pick = pickCover({ x: 0, z: 18 }, { x: 0, z: 0 }, [far, crate])!;
  assert.equal(pick.box, crate);
});

test('the spot behind a crate is never inside another box', () => {
  const blocker: CoverBox = { minX: -2, maxX: 2, minZ: 10.8, maxZ: 12.2, cover: 'tall' };
  const pick = pickCover({ x: 0, z: 18 }, { x: 0, z: 0 }, [crate, blocker]);
  if (pick) assert.ok(!(pick.hide.z > 10.8 && pick.hide.z < 12.2 && Math.abs(pick.hide.x) < 2.3));
});
