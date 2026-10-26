import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBuilding, hallRows } from './building.ts';
import { bfs, type MazeCells } from './maze.ts';

const SIZES: Array<[number, number]> = [[10, 8], [12, 10], [14, 10], [14, 8]];

const openings = (cells: MazeCells): number => {
  let n = 0;
  for (const row of cells) for (const c of row) n += Number(c.N) + Number(c.S) + Number(c.E) + Number(c.W);
  return n / 2;
};

test('every wall agrees from both sides, and nothing opens off the edge', () => {
  for (const [cols, rows] of SIZES) {
    for (let run = 0; run < 20; run++) {
      const cells = generateBuilding(cols, rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const c = cells[y]![x]!;
          if (x + 1 < cols) assert.equal(c.E, cells[y]![x + 1]!.W);
          if (y + 1 < rows) assert.equal(c.S, cells[y + 1]![x]!.N);
          if (x === 0) assert.equal(c.W, false);
          if (y === 0) assert.equal(c.N, false);
          if (x === cols - 1) assert.equal(c.E, false);
          if (y === rows - 1) assert.equal(c.S, false);
        }
      }
    }
  }
});

test('it is a tree from the start cell: every open cell reachable, exactly one way to each', () => {
  for (const [cols, rows] of SIZES) {
    for (let run = 0; run < 20; run++) {
      const cells = generateBuilding(cols, rows);
      const dist = bfs(cells, cols, rows, 0, 0);
      const reached = dist.flat().filter((d) => d >= 0).length;
      assert.equal(openings(cells), reached - 1, `${cols}x${rows}: a tree over the ${reached} cells reached`);
      // Anything with an opening is reached.
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const c = cells[y]![x]!;
          if (c.N || c.S || c.E || c.W) assert.ok(dist[y]![x]! >= 0, `${x},${y} is cut off`);
        }
    }
  }
});

test('most of the floor is used, with plenty of dead-end rooms and straight hall stretches', () => {
  for (const [cols, rows] of SIZES) {
    for (let run = 0; run < 20; run++) {
      const cells = generateBuilding(cols, rows);
      const flat = cells.flat();
      const used = flat.filter((c) => c.N || c.S || c.E || c.W).length;
      assert.ok(used / (cols * rows) >= 0.5, `${cols}x${rows}: ${used} of ${cols * rows} cells in use`);
      const deadEnds = flat.filter((c) => Number(c.N) + Number(c.S) + Number(c.E) + Number(c.W) === 1).length;
      assert.ok(deadEnds >= 10, `${cols}x${rows}: ${deadEnds} dead ends`);
      // A straight horizontal stretch of two cells off the west corridor: somewhere a stair or a tower can stand.
      let stretch = false;
      for (let y = 0; y < rows; y++) for (let x = 1; x + 1 < cols; x++) {
        const a = cells[y]![x]!;
        const b = cells[y]![x + 1]!;
        if (a.E && a.W && !a.N && !a.S && b.E && b.W && !b.N && !b.S) stretch = true;
      }
      assert.ok(stretch, `${cols}x${rows}: no straight stretch`);
    }
  }
});

test('the start cell connects, and the halls sit apart and inside the floor', () => {
  for (const rows of [6, 8, 10]) {
    for (const j of [-1, 0, 1]) {
      const halls = hallRows(rows, j);
      assert.ok(halls.every((h) => h >= 1 && h <= rows - 2));
      assert.deepEqual([...halls].sort((a, b) => a - b), halls);
      for (let i = 1; i < halls.length; i++) assert.ok(halls[i]! - halls[i - 1]! >= 3, `${rows} rows, halls ${halls}`);
    }
  }
  const cells = generateBuilding(14, 10);
  assert.ok(cells[0]![0]!.S, 'the start cell leads south to the halls');
});

test('two buildings rarely come out alike: a new one has a good share of its walls somewhere else', () => {
  const walls = (cells: ReturnType<typeof generateBuilding>): Set<string> => {
    const out = new Set<string>();
    cells.forEach((row, y) => row.forEach((c, x) => {
      if (!c.N) out.add(`${x},${y}N`);
      if (!c.W) out.add(`${x},${y}W`);
    }));
    return out;
  };
  // A pair can come out nearly alike (the halls fall on the same rows and the rooms split at about the same places: about one pair in twenty
  // moves under 6% of its walls) but on average a fifth of the walls move. Pairs vary a lot, so the average is taken over enough of them
  // (100: it then falls under 0.18 about once in ten thousand runs, where over 12 it did about one run in ten).
  const plans = Array.from({ length: 200 }, () => walls(generateBuilding(14, 10)));
  assert.ok(new Set(plans.map((p) => [...p].sort().join('|'))).size >= 180, 'nearly every plan is its own');
  let different = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < plans.length; i += 2) {
    const a = plans[i]!;
    const b = plans[i + 1]!;
    different += [...a].filter((k) => !b.has(k)).length / a.size;
    pairs++;
  }
  assert.ok(different / pairs > 0.18, `on average ${(100 * different) / pairs}% of the walls moved`);
});
