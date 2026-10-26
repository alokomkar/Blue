import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_S, closeCells, nearBox, openCells, shiftedBox, slideEase } from './slideshelf.ts';
import type { MazeCells } from './maze.ts';

/** A 5 x 4 grid of cells, all open to their neighbours inside it. */
const grid = (): MazeCells => Array.from({ length: 4 }, (_, y) => Array.from({ length: 5 }, (_, x) => ({ N: y > 0, S: y < 3, E: x < 4, W: x > 0 })));

test('a slide eases from 0 to 1, and a bank moves one cell across its length', () => {
  assert.equal(slideEase(0), 0);
  assert.equal(slideEase(1), 1);
  assert.ok(slideEase(0.5) > 0.49 && slideEase(0.5) < 0.51);
  assert.equal(slideEase(-3), 0);
  assert.ok(SLIDE_S > 0.5 && SLIDE_S < 4);
  const b = { minX: 8, maxX: 16, minZ: 4, maxZ: 8 };
  assert.deepEqual(shiftedBox(b, 0, 1, 1), { minX: 8, maxX: 16, minZ: 8, maxZ: 12 });
  assert.deepEqual(shiftedBox(b, -1, 0, 0.5), { minX: 6, maxX: 14, minZ: 4, maxZ: 8 });
  assert.deepEqual(shiftedBox(b, 1, 0, 0), b);
});

test('closing cells shuts them from every side, and the neighbours stop leading into them', () => {
  const nav = grid();
  closeCells(nav, [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
  for (const c of [{ x: 2, y: 1 }, { x: 3, y: 1 }]) assert.deepEqual(nav[c.y]![c.x], { N: false, S: false, E: false, W: false });
  assert.equal(nav[1]![1]!.E, false, 'the cell west of them no longer leads in');
  assert.equal(nav[1]![4]!.W, false, 'nor the one east');
  assert.equal(nav[0]![2]!.S, false, 'nor the one north');
  assert.equal(nav[2]![3]!.N, false, 'nor the one south');
  assert.equal(nav[1]![1]!.W, true, 'the rest of the grid is as it was');
});

test('opening cells joins them to every open neighbour, undoing a close', () => {
  const nav = grid();
  const cells = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
  closeCells(nav, cells);
  openCells(nav, cells, (x, y) => x >= 0 && x < 5 && y >= 0 && y < 4, () => false);
  assert.deepEqual(nav, grid());
});

test('a cell still blocked, or outside every space, stays shut when its neighbour opens', () => {
  const nav = grid();
  closeCells(nav, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  // (2,1) opens, but (1,1) is still a bank: (2,1) joins its other neighbours and not it
  openCells(nav, [{ x: 2, y: 1 }], () => true, (x, y) => x === 1 && y === 1);
  assert.deepEqual(nav[1]![2], { N: true, S: true, E: true, W: false });
  assert.equal(nav[1]![1]!.E, false);
  // a cell that is not in a space is never opened
  const wall = grid();
  closeCells(wall, [{ x: 4, y: 3 }]);
  openCells(wall, [{ x: 4, y: 3 }], (x, y) => !(x === 4 && y === 3), () => false);
  assert.deepEqual(wall[3]![4], { N: false, S: false, E: false, W: false });
});

test('anything within a margin of a bank is in the way of its slide', () => {
  const b = { minX: 8, maxX: 16, minZ: 4, maxZ: 8 };
  assert.equal(nearBox(b, 12, 6, 0.5), true);
  assert.equal(nearBox(b, 12, 8.4, 0.5), true);
  assert.equal(nearBox(b, 12, 9, 0.5), false);
  assert.equal(nearBox(b, 7.6, 6, 0.5), true);
});
