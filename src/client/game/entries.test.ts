import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs, farthestCell } from './maze.ts';
import { entriesFor, roofHatch, tunnelGrate, withinSteps, facingOut } from './entries.ts';

test('the ways in open up over the first jobs, and the Daily Heist offers all three', () => {
  assert.deepEqual(entriesFor(1, false), ['dock']);
  assert.deepEqual(entriesFor(2, false), ['dock', 'roof']);
  assert.deepEqual(entriesFor(3, false), ['dock', 'roof', 'tunnel']);
  assert.deepEqual(entriesFor(3, true), ['dock', 'roof', 'tunnel']);
});

test('the roof hatch is the free dead end farthest from the stair landing', () => {
  for (let run = 0; run < 50; run++) {
    const cells = generateMaze(16, 12);
    const dist = bfs(cells, 16, 12, 0, 0);
    const used = new Set(['0,0']);
    const hatch = roofHatch(cells, 16, 12, dist, used)!;
    assert.ok(hatch);
    const c = cells[hatch.y]![hatch.x]!;
    assert.equal([c.N, c.S, c.E, c.W].filter(Boolean).length, 1, 'a dead end');
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
      const deadEnd = [cells[y]![x]!.N, cells[y]![x]!.S, cells[y]![x]!.E, cells[y]![x]!.W].filter(Boolean).length === 1;
      if (deadEnd) assert.ok(dist[y]![x]! <= dist[hatch.y]![hatch.x]!);
    }
    // Facing out of it: its one opening.
    assert.equal(c[facingOut(cells, hatch.x, hatch.y)], true);
  }
});

test('the tunnel grate is a free dead end well into the building, short of the exit', () => {
  let found = 0;
  for (let run = 0; run < 100; run++) {
    const cells = generateMaze(16, 12);
    const { x: ex, y: ey, dist } = farthestCell(cells, 16, 12, 0, 0);
    const used = new Set(['0,0', `${ex},${ey}`]);
    const grate = tunnelGrate(cells, 16, 12, dist, used, dist[ey]![ex]!);
    if (!grate) continue;
    found++;
    const d = dist[grate.y]![grate.x]!;
    assert.ok(d >= 4 && d <= dist[ey]![ex]! - 3, `at ${d} of ${dist[ey]![ex]}`);
    assert.ok(!used.has(`${grate.x},${grate.y}`));
  }
  assert.ok(found >= 95, `only ${found} of 100 buildings had a grate`);
});

test('the quiet zone is every cell within a few steps’ walk', () => {
  const open = [[{ N: false, S: false, E: true, W: false }, { N: false, S: false, E: true, W: true }, { N: false, S: false, E: false, W: true }]];
  assert.equal(withinSteps(open, 3, 1, 0, 0, 1).length, 2);
  assert.equal(withinSteps(open, 3, 1, 0, 0, 5).length, 3);
});

test('the hatch and the grate are never shut in behind a locked door: reachable from the start with every door still locked', async () => {
  const { planSecurity, navCellsFor } = await import('./security.ts');
  const { difficultyFor } = await import('./difficulty.ts');
  let sealedBefore = 0;
  let found = 0;
  for (let run = 0; run < 200; run++) {
    const d = difficultyFor(2 + (run % 8));
    const cells = generateMaze(d.cols, d.rows);
    const { x: ex, y: ey, dist } = farthestCell(cells, d.cols, d.rows, 0, 0);
    const used = new Set(['0,0', `${ex},${ey}`]);
    const counts = { doors: d.doors, storage: 2, decor: d.decorRooms, chain: d.chainedDoors, network: ['uplink'] as const };
    for (const pick of [
      (open: (x: number, y: number) => boolean, taken: ReadonlySet<string>) => roofHatch(cells, d.cols, d.rows, dist, taken, open),
      (open: (x: number, y: number) => boolean, taken: ReadonlySet<string>) => tunnelGrate(cells, d.cols, d.rows, dist, taken, dist[ey]![ex]!, open),
    ]) {
      const plan = planSecurity(cells, d.cols, d.rows, dist, { x: 0, y: 0 }, new Set(used), { ...counts, entry: pick });
      const locked = bfs(navCellsFor(cells, plan.doors, d.cols, d.rows), d.cols, d.rows, 0, 0);
      if (plan.entry) {
        found++;
        assert.ok(locked[plan.entry.y]![plan.entry.x]! >= 0, `run ${run}: (${plan.entry.x}, ${plan.entry.y}) is behind a locked door`);
        assert.ok(!plan.rooms.some((r) => r.cells.some((c) => c.x === plan.entry!.x && c.y === plan.entry!.y)), 'a room took it');
      }
      // Without the check, the farthest dead end is often behind a door: the bug this guards against.
      const anywhere = roofHatch(cells, d.cols, d.rows, dist, used);
      if (anywhere && locked[anywhere.y]![anywhere.x]! < 0) sealedBefore++;
    }
  }
  // On floors no bigger than 14×10 (few dead ends), there's room ~97% of the time (measured 378–395 of 400);
  // the rest go in by the loading dock instead.
  assert.ok(found >= 365, `only ${found} of 400 floors had room for the way in`);
  assert.ok(sealedBefore > 0, 'the unguarded pick never landed behind a door, so this test proves nothing');
});
