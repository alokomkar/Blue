import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverSpotNear, cornerSpotNear, clampToCover, coverFacing, COVER_STANDOFF, COVER_PEEK, CORNER_PEEK } from './cover.ts';
import type { WallBox } from './scene.ts';

const desk: WallBox = { minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3, cover: 'low' };
const wall: WallBox = { minX: -1, maxX: 1, minZ: 4, maxZ: 4.3 };

test('finds the face you are standing by, with the right side and standing line', () => {
  const spot = coverSpotNear([desk], 0.4, 0.9);
  assert.ok(spot);
  assert.deepEqual([spot.nx, spot.nz], [0, 1]);
  assert.ok(Math.abs(spot.az - (0.3 + COVER_STANDOFF)) < 1e-9);
  assert.deepEqual([spot.ax, spot.bx], [-1, 1]);
  assert.equal(spot.px, 0.4);
});

test('nothing when too far away, off the end of the face, or next to a plain wall', () => {
  assert.equal(coverSpotNear([desk], 0, 2), null);
  assert.equal(coverSpotNear([desk], 2, 0.6), null);
  assert.equal(coverSpotNear([wall], 0, 3.6), null);
});

test('picks the nearer of two faces', () => {
  const spot = coverSpotNear([desk], 1.5, 0.1);
  assert.ok(spot);
  assert.deepEqual([spot.nx, spot.nz], [1, 0]);
});

test('clampToCover keeps you on the line, leaning out only a little past the ends', () => {
  const spot = coverSpotNear([desk], 0, 0.9)!;
  const held = clampToCover(spot, 0.2, 3);
  assert.deepEqual([held.x, held.z], [0.2, spot.az]);
  assert.equal(clampToCover(spot, 5, 0.9).x, 1 + COVER_PEEK);
  assert.equal(clampToCover(spot, -5, 0.9).x, -1 - COVER_PEEK);
});

test('in cover you face the furniture', () => {
  const spot = coverSpotNear([desk], 0, 0.9)!; // on the +Z side, so facing -Z
  assert.ok(Math.abs(Math.abs(coverFacing(spot)) - Math.PI) < 1e-9);
});

// An L: a side corridor along z = 0..2, its south wall running west from x = -2 where the long corridor (x from -2 to 2) heads south.
const sideWall: WallBox = { minX: -8, maxX: -2, minZ: 2, maxZ: 2.28 };
const longWallWest: WallBox = { minX: -2.28, maxX: -2, minZ: 2.28, maxZ: 20 };
const sideRoof: WallBox = { minX: -8, maxX: 2, minZ: -2.28, maxZ: -2 };

test('a wall that ends at an opening is cover: hug it back from the end, lean out past it, facing down the way it opens', () => {
  const spot = cornerSpotNear([sideWall, longWallWest, sideRoof], -3.4, 1.4);
  assert.ok(spot, 'a corner');
  assert.equal(spot.corner, true);
  assert.deepEqual([spot.nx, spot.nz], [0, -1], 'on the north face of the south wall');
  assert.ok(spot.px < -2 && spot.px > -3.5, `hugging back from the end: ${spot.px}`);
  assert.ok(Math.abs(spot.lean!.x - (-2 + CORNER_PEEK)) < 1e-9, 'the lean is past the end');
  assert.ok(Math.abs(spot.lean!.z - spot.pz) < 1e-9, 'along the same line');
  // Facing into the wall is facing south, down the long corridor.
  assert.ok(Math.abs(coverFacing(spot)) < 1e-9);
  // Aimed, it is clear of the other wall; the held lean stays on the line.
  assert.ok(spot.lean!.x > -2 + 0.25);
  assert.equal(clampToCover(spot, 9, 0).x, -2 + CORNER_PEEK, 'the spot allows its own peek');
});

test('no corner where the wall carries on, in a dead end, or far from the end', () => {
  const continues: WallBox = { minX: -2, maxX: 6, minZ: 2, maxZ: 2.28 };
  assert.equal(cornerSpotNear([sideWall, continues, longWallWest, sideRoof], -3.4, 1.4), null, 'the wall goes on past the end');
  const deadEnd: WallBox = { minX: -2, maxX: 2, minZ: 4, maxZ: 4.28 };
  assert.equal(cornerSpotNear([sideWall, longWallWest, sideRoof, deadEnd], -3.4, 1.4), null, 'the way ahead is shut a step on');
  assert.equal(cornerSpotNear([sideWall, longWallWest, sideRoof], -5, 1.4), null, 'too far from either end');
  assert.equal(cornerSpotNear([sideWall, longWallWest, sideRoof], -3.4, 0), null, 'too far from the face');
});

test('furniture is not a corner (it has its own cover)', () => {
  assert.equal(cornerSpotNear([desk], 1.3, 0.1), null);
});

test('no corner where a wall meets another at its end, closing the way', () => {
  // The south wall's open end is shut by a wall running across the corridor mouth: nothing to lean out into.
  const across: WallBox = { minX: -2.28, maxX: 2, minZ: 2, maxZ: 2.28 };
  assert.equal(cornerSpotNear([sideWall, across, longWallWest, sideRoof], -3.4, 1.4), null);
});

test('a wall with only a short way clear past its end is cover when a guard can be seen and shot from the lean', () => {
  // The long corridor is shut four metres on: not a corner for its own sake...
  const shut: WallBox = { minX: -2, maxX: 2, minZ: 5, maxZ: 5.28 };
  const walls = [sideWall, longWallWest, sideRoof, shut];
  assert.equal(cornerSpotNear(walls, -3.4, 1.4), null);
  // ...but with a guard standing in it, in sight of the lean, it is.
  const guard = { x: -0.2, z: 4.2 };
  const spot = cornerSpotNear(walls, -3.4, 1.4, undefined, [guard]);
  assert.ok(spot && spot.corner, 'a guard in sight makes it cover');
  // A guard behind a wall is not in sight.
  const hidden = { x: -6, z: 4.2 };
  assert.equal(cornerSpotNear(walls, -3.4, 1.4, undefined, [hidden]), null);
  // Nor one too far round to the side or out of range.
  assert.equal(cornerSpotNear(walls, -3.4, 1.4, undefined, [{ x: 0, z: 30 }]), null);
});
