import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreRandom, seedRandom } from './seeded.ts';
import { generateMaze, bfs, farthestCell, placeBotSpawn, placeStair } from './maze.ts';
import { planSecurity } from './security.ts';
import { planBlackouts } from './blackout.ts';
import { difficultyFor } from './difficulty.ts';

/** Lays out a job the way game.ts does, reduced to what can be compared. */
function layout(seed: number): string {
  seedRandom(seed);
  try {
    const d = difficultyFor(8);
    const cells = generateMaze(d.cols, d.rows);
    const { x, y, dist } = farthestCell(cells, d.cols, d.rows, 0, 0);
    const used = new Set([`0,0`, `${x},${y}`]);
    const stair = placeStair(d.cols, d.rows, cells, dist, used);
    const plan = planSecurity(cells, d.cols, d.rows, dist, { x: 0, y: 0 }, used, { doors: d.doors, storage: 2, decor: d.decorRooms, chain: d.chainedDoors });
    const guards = Array.from({ length: d.guards }, () => placeBotSpawn(d.cols, d.rows, dist, used));
    const dark = planBlackouts(cells, d.cols, d.rows, bfs(cells, d.cols, d.rows, 0, 0), d.blackouts, d.blackoutCells);
    return JSON.stringify({ cells, stair, doors: plan.doors, rooms: plan.rooms.map((r) => [r.kind, r.x, r.y]), guards, dark });
  } finally {
    restoreRandom();
  }
}

test('the same seed lays out the same job, and a different seed a different one', () => {
  assert.equal(layout(12345), layout(12345));
  assert.notEqual(layout(12345), layout(12346));
});

test('Math.random is the browser’s own again once the job is built', () => {
  const native = Math.random;
  seedRandom(1);
  assert.notEqual(Math.random, native);
  restoreRandom();
  assert.equal(Math.random, native);
});
