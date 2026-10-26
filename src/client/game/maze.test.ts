import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMaze,
  bfs,
  placeLaserTraps,
  placeStair,
  stairReserved,
  farthestCell,
  placeBotSpawn,
  SPAWN_MIN_CELLS,
} from './maze.ts';
import { difficultyFor } from './difficulty.ts';

test('placeLaserTraps only places on clean straight-through cells, never on a used cell or one closer than 3 steps from start', () => {
  const cols = 30;
  const rows = 24;
  const cells = generateMaze(cols, rows);
  const dist = bfs(cells, cols, rows, 0, 0);
  const used = new Set<string>(['0,0']);
  const traps = placeLaserTraps(cols, rows, cells, dist, used, 6);

  assert.ok(traps.length <= 6);
  for (const t of traps) {
    assert.ok(dist[t.y]![t.x]! >= 3, `laser trap at (${t.x},${t.y}) is too close to spawn`);
    const c = cells[t.y]![t.x]!;
    const spanNS = c.N && c.S && !c.E && !c.W;
    const spanEW = c.E && c.W && !c.N && !c.S;
    assert.ok(spanNS || spanEW, `laser trap at (${t.x},${t.y}) should only be on a clean straight-through cell`);
    assert.equal(t.spanX, spanNS, `laser trap at (${t.x},${t.y})'s spanX should match the corridor's actual open direction`);
  }
  const keys = traps.map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(keys).size, keys.length, 'no two laser traps share a cell');
});

test('placeStair only places on a clean straight-through cell, never closer than 3 steps from start, and reserves it in `used`', () => {
  const cols = 30;
  const rows = 24;
  // About 1 maze in 75 has no qualifying cell at all (the game then simply
  // builds no second floor), so try a few before checking the one placed.
  let cells = generateMaze(cols, rows);
  let dist = bfs(cells, cols, rows, 0, 0);
  let used = new Set<string>(['0,0']);
  let stair = placeStair(cols, rows, cells, dist, used);
  for (let tries = 0; !stair && tries < 10; tries++) {
    cells = generateMaze(cols, rows);
    dist = bfs(cells, cols, rows, 0, 0);
    used = new Set<string>(['0,0']);
    stair = placeStair(cols, rows, cells, dist, used);
  }

  assert.ok(stair, 'one of ten 30x24 mazes should have a qualifying straight-through cell');
  assert.ok(dist[stair!.y]![stair!.x]! >= 3, `stair at (${stair!.x},${stair!.y}) is too close to spawn`);
  const c = cells[stair!.y]![stair!.x]!;
  const spanNS = c.N && c.S && !c.E && !c.W;
  const spanEW = c.E && c.W && !c.N && !c.S;
  assert.ok(spanNS || spanEW, `stair at (${stair!.x},${stair!.y}) should only be on a clean straight-through cell`);
  assert.equal(stair!.spanX, spanNS, `stair at (${stair!.x},${stair!.y})'s spanX should match the corridor's actual open direction`);
  assert.ok(used.has(`${stair!.x},${stair!.y}`), "the stair's cell should be reserved in `used`");

  // Real bug guard: the "far" neighbor (the cell past the top of the climb)
  // must be a genuine dead end, reachable only via the stair itself — see
  // placeStair's header comment for the live-reproduced bug this prevents
  // (a separate floor-0 path into that cell let a player glitch the height
  // field by stepping onto the stair from the "top" side while still on
  // floor 0).
  // The rest of the run is the same straight corridor, and the landing past it a dead end.
  const reserved = stairReserved(stair!, 1);
  assert.equal(reserved.length, 1);
  for (const r of reserved.slice(0, -1)) {
    const s = cells[r.y]![r.x]!;
    assert.ok(stair!.spanX ? s.N && s.S && !s.E && !s.W : s.E && s.W && !s.N && !s.S, `run cell (${r.x},${r.y}) should be straight through`);
  }
  const { x: farX, y: farY } = reserved[reserved.length - 1]!;
  const far = cells[farY]![farX]!;
  const farOpenCount = Number(far.N) + Number(far.S) + Number(far.E) + Number(far.W);
  assert.equal(farOpenCount, 1, `stair at (${stair!.x},${stair!.y})'s far neighbor (${farX},${farY}) should be a dead end`);
});

test('generateMaze biases toward straight corridors over turns', () => {
  // A stock (unbiased) recursive-backtracker picks uniformly at random
  // among 2-4 open directions at nearly every cell, so a "continues
  // straight through" cell is actually the minority outcome — this
  // asserts the opposite is true here, guarding the direct feedback this
  // bias was added for ("feels twisty... too many turns"). Large enough
  // maze that the random generation's own cell-to-cell variance washes out.
  const cols = 40;
  const rows = 30;
  const cells = generateMaze(cols, rows);
  let straight = 0;
  let turn = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y]![x]!;
      const openCount = Number(c.N) + Number(c.S) + Number(c.E) + Number(c.W);
      if (openCount !== 2) continue; // only a "pass-through" cell (exactly 2 open sides) is meaningfully straight-vs-turn
      if ((c.N && c.S) || (c.E && c.W)) straight++;
      else turn++;
    }
  }
  assert.ok(straight + turn > 100, 'expected plenty of pass-through cells in a 40x30 maze to measure from');
  assert.ok(
    straight / (straight + turn) > 0.55,
    `expected a clear majority of pass-through cells to continue straight, got ${straight} straight vs ${turn} turns`
  );
});


test('a two-cell stair (tall floors) is straight through for both cells, ends in a dead end, and is found in almost every big maze', () => {
  let placed = 0;
  for (let run = 0; run < 60; run++) {
    const cols = 24;
    const rows = 18;
    const cells = generateMaze(cols, rows);
    const dist = bfs(cells, cols, rows, 0, 0);
    const used = new Set<string>(['0,0']);
    const stair = placeStair(cols, rows, cells, dist, used, 2);
    if (!stair) continue;
    placed++;
    const [middle, landing] = stairReserved(stair, 2);
    for (const c of [stair, middle!]) {
      const s = cells[c.y]![c.x]!;
      assert.ok(stair.spanX ? s.N && s.S && !s.E && !s.W : s.E && s.W && !s.N && !s.S, `(${c.x},${c.y}) should be straight through`);
    }
    const far = cells[landing!.y]![landing!.x]!;
    assert.equal(Number(far.N) + Number(far.S) + Number(far.E) + Number(far.W), 1, 'the landing should be a dead end');
  }
  assert.ok(placed >= 55, `only ${placed} of 60 mazes had room for a two-cell stair`);
});

test('a search from outside the grid (the agent on the stair between floors) reaches nothing and does not throw', () => {
  const cells = generateMaze(8, 6);
  for (const [x, y] of [[-1, 0], [0, -1], [8, 2], [3, 6]] as const) {
    const d = bfs(cells, 8, 6, x, y);
    assert.equal(d.length, 6);
    assert.ok(d.every((row) => row.every((v) => v === -1)));
  }
});

test('enemies start at least SPAWN_MIN_CELLS of walking from where the agent comes in (less only on a floor too small for it)', () => {
  for (const job of [3, 8, 14]) {
    const d = difficultyFor(job);
    for (let n = 0; n < 40; n++) {
      const cells = generateMaze(d.cols, d.rows);
      const { dist } = farthestCell(cells, d.cols, d.rows, 0, 0);
      let far = 0;
      for (const row of dist) for (const v of row) far = Math.max(far, v);
      const lead = Math.max(5, Math.min(SPAWN_MIN_CELLS, Math.floor(far * 0.55)));
      const used = new Set<string>(['0,0']);
      for (let i = 0; i < 6; i++) {
        const s = placeBotSpawn(d.cols, d.rows, dist, used);
        if (s && i < 3) assert.ok(dist[s.y]![s.x]! >= lead, `job ${job}: spawn ${i} only ${dist[s.y]![s.x]} cells from the entrance, wanted ${lead}`);
      }
    }
  }
});
