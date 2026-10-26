import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { placeSweepers, placeSliders, sweepAngle, slidePosition, sweeperHits, sliderHits, SWEEP_REACH, SLIDE_SPEED, FAST_SLIDE_SPEED, type Slider } from './movingLasers.ts';

const CELL = 4;
const R = 0.32;

test('sweepers go in junctions, apart, and reserve their cells', () => {
  for (let run = 0; run < 40; run++) {
    const cells = generateMaze(14, 10);
    const dist = bfs(cells, 14, 10, 0, 0);
    const used = new Set(['0,0']);
    const sweepers = placeSweepers(cells, 14, 10, dist, used, 2);
    for (const s of sweepers) {
      const c = cells[s.y]![s.x]!;
      assert.ok([c.N, c.S, c.E, c.W].filter(Boolean).length >= 3, 'in a junction');
      assert.ok(dist[s.y]![s.x]! >= 3);
      assert.ok(used.has(`${s.x},${s.y}`));
    }
    if (sweepers.length === 2) assert.ok(Math.abs(sweepers[0]!.x - sweepers[1]!.x) + Math.abs(sweepers[0]!.y - sweepers[1]!.y) >= 3);
  }
});

test('sliders run a joined straight stretch with a way out to the side, and reserve it', () => {
  let placed = 0;
  for (let run = 0; run < 40; run++) {
    const cells = generateMaze(14, 10);
    const dist = bfs(cells, 14, 10, 0, 0);
    const used = new Set(['0,0']);
    for (const s of placeSliders(cells, 14, 10, dist, used, 2)) {
      placed++;
      assert.ok(s.to - s.from >= 2, 'at least three cells');
      let aside = false;
      for (let i = s.from; i <= s.to; i++) {
        const [x, y] = s.axis === 'x' ? [i, s.at] : [s.at, i];
        const c = cells[y]![x]!;
        assert.ok(used.has(`${x},${y}`));
        if (i < s.to) assert.ok(s.axis === 'x' ? c.E : c.S, 'joined along its run');
        if (s.axis === 'x' ? c.N || c.S : c.E || c.W) aside = true;
      }
      assert.ok(aside, 'somewhere to step aside');
    }
  }
  assert.ok(placed > 40, `only ${placed} sliders placed in 40 floors`);
});

test('a sweeper catches someone upright in its path, not beside it or beyond its reach', () => {
  const s = { x: 2, y: 2, phase: 0, dir: 1 as const };
  // At t = 0 the beam lies along x through (8, 8).
  assert.ok(sweeperHits(s, 0, 9, 8, CELL, R));
  assert.ok(sweeperHits(s, 0, 7, 8.2, CELL, R));
  assert.ok(!sweeperHits(s, 0, 9, 9, CELL, R));
  assert.ok(!sweeperHits(s, 0, 8 + SWEEP_REACH + 0.5, 8, CELL, R));
  // A quarter turn later it lies along z.
  const t = Math.PI / 2 / 1.6;
  assert.ok(Math.abs(sweepAngle(s, t) - Math.PI / 2) < 1e-9);
  assert.ok(sweeperHits(s, t, 8, 9, CELL, R));
  assert.ok(!sweeperHits(s, t, 9, 8, CELL, R));
});

test('a slider runs to either end of its stretch and back, and catches whoever it passes', () => {
  const s: Slider = { axis: 'x', at: 1, from: 2, to: 5, phase: 0, speed: SLIDE_SPEED };
  const seen: number[] = [];
  for (let t = 0; t < 40; t += 0.1) seen.push(slidePosition(s, t, CELL));
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  assert.ok(lo >= 2 * CELL - CELL / 2 && lo < 2 * CELL - CELL / 2 + 0.6, `turns back at ${lo}`);
  assert.ok(hi <= 5 * CELL + CELL / 2 && hi > 5 * CELL + CELL / 2 - 0.6, `turns back at ${hi}`);
  const at = slidePosition(s, 3, CELL);
  assert.ok(sliderHits(s, 3, at + 0.1, 4, CELL, R));
  assert.ok(!sliderHits(s, 3, at + 1, 4, CELL, R));
  assert.ok(!sliderHits(s, 3, at, 4 + CELL, CELL, R), 'not someone in the next row');
});

test('a fast curtain covers its run quicker than a walk, and the first ones placed run fast', () => {
  const slow: Slider = { axis: 'x', at: 1, from: 2, to: 5, phase: 0, speed: SLIDE_SPEED };
  const fast: Slider = { ...slow, speed: FAST_SLIDE_SPEED };
  assert.ok(FAST_SLIDE_SPEED > 7 && FAST_SLIDE_SPEED < 11, 'faster than a walk, slower than a dash');
  assert.ok(slidePosition(fast, 1, CELL) - slidePosition(fast, 0, CELL) > slidePosition(slow, 1, CELL) - slidePosition(slow, 0, CELL));
  for (let run = 0; run < 20; run++) {
    const cells = generateMaze(14, 10);
    const placed = placeSliders(cells, 14, 10, bfs(cells, 14, 10, 0, 0), new Set(['0,0']), 2, 4, 1);
    if (placed.length === 2) assert.deepEqual(placed.map((s) => s.speed), [FAST_SLIDE_SPEED, SLIDE_SPEED]);
  }
});
