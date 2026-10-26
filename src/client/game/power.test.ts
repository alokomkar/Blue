import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { breakerSpot, planCircuits, wallFor } from './power.ts';

test('circuits cover the floor in connected patches of broadly similar size', () => {
  for (let run = 0; run < 60; run++) {
    const cols = 24;
    const rows = 18;
    const cells = generateMaze(cols, rows);
    const { circuit, seeds } = planCircuits(cells, cols, rows, 3);
    assert.equal(seeds.length, 3);
    const sizes = [0, 0, 0];
    for (const row of circuit) for (const k of row) sizes[k]!++;
    assert.equal(sizes.reduce((a, b) => a + b, 0), cols * rows, 'every cell is wired');
    // Grown in turns from the best of a few seedings, the smallest of three is about a quarter of the floor
    // typically; never under 16% in 3000 trial floors.
    assert.ok(Math.min(...sizes) >= cols * rows * 0.1, `run ${run}: circuits ${sizes}`);
    // Connected: walking only through a circuit's own cells from its seed reaches all of them.
    for (let k = 0; k < 3; k++) {
      const own = cells.map((row, y) =>
        row.map((c, x) => ({
          N: c.N && circuit[y - 1]?.[x] === k,
          S: c.S && circuit[y + 1]?.[x] === k,
          E: c.E && circuit[y]?.[x + 1] === k,
          W: c.W && circuit[y]?.[x - 1] === k,
        }))
      );
      const reach = bfs(own, cols, rows, seeds[k]!.x, seeds[k]!.y);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (circuit[y]![x] === k) assert.ok(reach[y]![x]! >= 0, `run ${run}: circuit ${k} split`);
    }
  }
});

test('a breaker goes on a corridor wall in its own circuit, clear of anything else', () => {
  const cols = 20;
  const rows = 16;
  const cells = generateMaze(cols, rows);
  const { circuit, seeds } = planCircuits(cells, cols, rows, 2);
  const used = new Set<string>();
  for (let k = 0; k < 2; k++) {
    const spot = breakerSpot(cells, cols, rows, circuit, k, seeds[k]!, used);
    assert.ok(spot);
    assert.equal(circuit[spot.y]![spot.x], k);
    const c = cells[spot.y]![spot.x]!;
    assert.equal([c.N, c.S, c.E, c.W].filter(Boolean).length, 2);
    assert.equal(c[spot.wall], false, 'mounted on a wall, not across an opening');
    used.add(`${spot.x},${spot.y}`);
  }
});

test('a four-way junction has no wall to mount a switch on', () => {
  const open = [[{ N: true, S: true, E: true, W: true }]];
  assert.equal(wallFor(open, 0, 0), null);
  assert.equal(wallFor([[{ N: true, S: false, E: true, W: true }]], 0, 0), 'S');
});
