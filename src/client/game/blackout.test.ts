import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { planBlackouts, BLACKOUT_CLEAR_OF_SPAWN } from './blackout.ts';
import { FULL_GOGGLES, GOGGLES_DRAIN_S, GOGGLES_MIN_START, GOGGLES_RECHARGE_S, tickGoggles, toggleGoggles } from './goggles.ts';

/** The blackouts as separate connected patches (through open passages). */
function patches(cells: ReturnType<typeof generateMaze>, dark: boolean[][]): Array<Array<{ x: number; y: number }>> {
  const seen = new Set<string>();
  const out: Array<Array<{ x: number; y: number }>> = [];
  for (let y = 0; y < dark.length; y++) {
    for (let x = 0; x < dark[0]!.length; x++) {
      if (!dark[y]![x] || seen.has(`${x},${y}`)) continue;
      const patch: Array<{ x: number; y: number }> = [];
      const stack = [{ x, y }];
      seen.add(`${x},${y}`);
      while (stack.length) {
        const p = stack.pop()!;
        patch.push(p);
        const c = cells[p.y]![p.x]!;
        for (const [open, nx, ny] of [
          [c.N, p.x, p.y - 1],
          [c.S, p.x, p.y + 1],
          [c.W, p.x - 1, p.y],
          [c.E, p.x + 1, p.y],
        ] as const) {
          if (open && dark[ny]?.[nx] && !seen.has(`${nx},${ny}`)) {
            seen.add(`${nx},${ny}`);
            stack.push({ x: nx, y: ny });
          }
        }
      }
      out.push(patch);
    }
  }
  return out;
}

test('blackouts are connected patches of about the asked size, clear of the spawn and of each other', () => {
  for (let run = 0; run < 40; run++) {
    const cols = 24;
    const rows = 18;
    const cells = generateMaze(cols, rows);
    const dist = bfs(cells, cols, rows, 0, 0);
    const dark = planBlackouts(cells, cols, rows, dist, 2, 20);
    const found = patches(cells, dark);
    assert.equal(found.length, 2, `run ${run}: ${found.length} patches`);
    for (const p of found) assert.ok(p.length >= 10 && p.length <= 20, `run ${run}: a patch of ${p.length}`);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (dark[y]![x]) assert.ok(dist[y]![x]! >= BLACKOUT_CLEAR_OF_SPAWN);
  }
});

test('a blackout never covers a cell it is told to avoid, and none are planned when none are asked for', () => {
  const cells = generateMaze(12, 10);
  const dist = bfs(cells, 12, 10, 0, 0);
  const dark = planBlackouts(cells, 12, 10, dist, 1, 30, (x) => x > 6);
  for (let y = 0; y < 10; y++) for (let x = 7; x < 12; x++) assert.equal(dark[y]![x], false);
  assert.ok(planBlackouts(cells, 12, 10, dist, 0, 30).every((row) => row.every((d) => !d)));
});

test('the goggles drain while worn, recharge while off, and won’t start flat', () => {
  let s = toggleGoggles(FULL_GOGGLES);
  assert.equal(s.on, true);
  s = tickGoggles(s, GOGGLES_DRAIN_S / 2);
  assert.ok(Math.abs(s.energy - 0.5) < 1e-9);
  s = tickGoggles(s, GOGGLES_DRAIN_S);
  assert.deepEqual(s, { energy: 0, on: false });
  assert.equal(toggleGoggles(s).on, false);
  s = tickGoggles(s, GOGGLES_RECHARGE_S * GOGGLES_MIN_START);
  assert.equal(toggleGoggles(s).on, true);
  assert.equal(tickGoggles({ energy: 0.99, on: false }, GOGGLES_RECHARGE_S).energy, 1);
});
