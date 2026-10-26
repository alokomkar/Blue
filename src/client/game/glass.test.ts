import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSkylight } from './glass.ts';
import type { MazeCells } from './maze.ts';

const corridor = (n: number): MazeCells => Array.from({ length: 3 }, (_, y) => Array.from({ length: n }, (_, x) => ({ N: y > 0, S: y < 2, E: x < n - 1, W: x > 0, visited: true }))) as unknown as MazeCells;
const open = (cols: number, rows: number): number[][] => Array.from({ length: rows }, () => Array.from({ length: cols }, () => -1));

test('picks a cell open on both floors, never a taken one, and prefers junctions below', () => {
  const cells = corridor(4);
  const pick = pickSkylight({ cells1: cells, section1: open(4, 3), cols1: 4, rows1: 3, taken1: new Set(), cells0: cells, cols0: 4, rows0: 3, taken0: new Set(), offX: 0, offY: 0, rand: () => 0 });
  assert.ok(pick);
  const taken = new Set(['1,1', '2,1']);
  const again = pickSkylight({ cells1: cells, section1: open(4, 3), cols1: 4, rows1: 3, taken1: taken, cells0: cells, cols0: 4, rows0: 3, taken0: new Set(), offX: 0, offY: 0, rand: () => 0.5 });
  assert.ok(again && !taken.has(`${again.x1},${again.y1}`));
});

test('an upper cell beyond the ground floor, or in a locked section, is not used', () => {
  const cells = corridor(4);
  const sec = open(4, 3);
  for (const row of sec) row.fill(0);
  assert.equal(pickSkylight({ cells1: cells, section1: sec, cols1: 4, rows1: 3, taken1: new Set(), cells0: cells, cols0: 4, rows0: 3, taken0: new Set(), offX: 0, offY: 0, rand: () => 0 }), null);
  assert.equal(pickSkylight({ cells1: cells, section1: open(4, 3), cols1: 4, rows1: 3, taken1: new Set(), cells0: cells, cols0: 4, rows0: 3, taken0: new Set(), offX: 9, offY: 0, rand: () => 0 }), null);
});
