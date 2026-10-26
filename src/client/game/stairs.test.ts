import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFlightEnd, stairGroundHeight } from './stairs.ts';
import type { Stair } from './maze.ts';

const CELL = 4; // matches scene.ts's real constant — kept local since stairGroundHeight is deliberately dependency-free (see stairs.ts's header comment)

test('stairGroundHeight: returns null outside the stair cell footprint', () => {
  const stair: Stair = { x: 2, y: 3, spanX: true, fromFloorY: 0, toFloorY: 4, run: 1 };
  assert.equal(stairGroundHeight(stair, 2 * CELL, 20, CELL), null); // far outside the cell in Z
  assert.equal(stairGroundHeight(stair, 20, 3 * CELL, CELL), null); // far outside the cell in X
});

test('stairGroundHeight: spanX=true interpolates along Z, ignoring X within the footprint', () => {
  const stair: Stair = { x: 2, y: 3, spanX: true, fromFloorY: 0, toFloorY: 4, run: 1 };
  const cx = 2 * CELL;
  const cz = 3 * CELL;
  const half = CELL / 2;

  assert.equal(stairGroundHeight(stair, cx, cz - half, CELL), 0); // near edge -> fromFloorY
  assert.equal(stairGroundHeight(stair, cx, cz + half, CELL), 4); // far edge -> toFloorY
  assert.equal(stairGroundHeight(stair, cx, cz, CELL), 2); // midpoint -> halfway up
  // Same Z, different X within the cell's width — height shouldn't change,
  // since the whole corridor width climbs together, not just a centerline.
  assert.equal(stairGroundHeight(stair, cx + 1, cz, CELL), 2);
});

test('stairGroundHeight: spanX=false interpolates along X instead', () => {
  const stair: Stair = { x: 5, y: 1, spanX: false, fromFloorY: 0, toFloorY: 4, run: 1 };
  const cx = 5 * CELL;
  const cz = 1 * CELL;
  const half = CELL / 2;

  assert.equal(stairGroundHeight(stair, cx - half, cz, CELL), 0);
  assert.equal(stairGroundHeight(stair, cx + half, cz, CELL), 4);
  assert.equal(stairGroundHeight(stair, cx, cz, CELL), 2);
});

test('stairGroundHeight: works in reverse too (descending is just the same field walked the other way)', () => {
  const stair: Stair = { x: 0, y: 0, spanX: true, fromFloorY: 0, toFloorY: 4, run: 1 };
  const half = CELL / 2;
  // Walking from the far (high) edge back toward the near (low) edge should
  // retrace the exact same height values — a real bidirectional staircase,
  // not a one-way climb.
  assert.equal(stairGroundHeight(stair, 0, half, CELL), 4);
  assert.equal(stairGroundHeight(stair, 0, 0, CELL), 2);
  assert.equal(stairGroundHeight(stair, 0, -half, CELL), 0);
});

test('stairGroundHeight: a two-cell run climbs over both cells, and ends at the far edge of the second', () => {
  const stair: Stair = { x: 2, y: 3, spanX: true, fromFloorY: 0, toFloorY: 7, run: 2 };
  const cx = 2 * CELL;
  const cz = 3 * CELL;
  const half = CELL / 2;
  assert.equal(stairGroundHeight(stair, cx, cz - half, CELL), 0);
  assert.equal(stairGroundHeight(stair, cx, cz + half, CELL), 3.5); // the join between the two cells: halfway up
  assert.equal(stairGroundHeight(stair, cx, cz + half + CELL, CELL), 7);
  assert.equal(stairGroundHeight(stair, cx, cz + half + CELL + 0.1, CELL), null);
});

test('stairGroundHeight: a wider stair covers its whole width, and nothing past it', () => {
  const stair: Stair = { x: 4, y: 1, spanX: true, fromFloorY: 0, toFloorY: 4, run: 3, width: 3 };
  const half = CELL / 2;
  const cx = 4 * CELL;
  const cz = 1 * CELL;
  assert.equal(stairGroundHeight(stair, cx - half, cz - half, CELL), 0); // the near corner of the first cell
  assert.equal(stairGroundHeight(stair, cx - half + 3 * CELL, cz - half + 3 * CELL, CELL), 4); // the far corner of the last
  assert.equal(stairGroundHeight(stair, cx + 2 * CELL, cz - half + 1.5 * CELL, CELL), 2); // across its width, halfway along
  assert.equal(stairGroundHeight(stair, cx - half - 0.1, cz, CELL), null); // just off one side
  assert.equal(stairGroundHeight(stair, cx - half + 3 * CELL + 0.1, cz, CELL), null); // just off the other
});

test('stairGroundHeight: a stair that descends along its axis falls toward its far end', () => {
  const stair: Stair = { x: 0, y: 1, spanX: true, fromFloorY: 8, toFloorY: 4, run: 2 };
  const half = CELL / 2;
  assert.equal(stairGroundHeight(stair, 0, 1 * CELL - half, CELL), 8);
  assert.equal(stairGroundHeight(stair, 0, 1 * CELL - half + 2 * CELL, CELL), 4);
});

test('openFlightEnd: takes the end wall and the cell beyond it, across the stairwell, and leaves furniture and walls elsewhere', () => {
  const wall = (x: number, z: number, extra: object = {}) => ({ minX: x - 0.04 * CELL, maxX: x + 0.04 * CELL, minZ: z - CELL / 2, maxZ: z + CELL / 2, ...extra });
  const edge = 11.5 * CELL; // the stairwell's west end (its foot, on the storey above)
  const z0 = 13.5 * CELL;
  const z1 = 15.5 * CELL;
  const boxes = [
    wall(edge, 14 * CELL), // the end wall, two boxes across
    wall(edge, 15 * CELL),
    wall(edge - CELL, 14.5 * CELL), // the cell beyond
    wall(edge - 2 * CELL, 14.5 * CELL), // further out: stays
    wall(edge + 2 * CELL, 14 * CELL), // inside the stairwell (a side wall running along it): stays
    wall(edge, 14 * CELL, { cover: 'low' }), // furniture: stays
    wall(edge, 20 * CELL), // beside the stairwell: stays
  ];
  const removed = openFlightEnd(boxes, edge, -1, z0, z1, CELL);
  assert.equal(removed, 3);
  assert.equal(boxes.length, 4);
  // the other way (toward +x) takes the east end's
  const east = [wall(edge + 4 * CELL, 14 * CELL), wall(edge + 5 * CELL, 14 * CELL), wall(edge + 7 * CELL, 14 * CELL)];
  assert.equal(openFlightEnd(east, edge + 4 * CELL, 1, z0, z1, CELL), 2);
});
