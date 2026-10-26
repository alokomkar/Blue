import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout as layout, landmarkOf, inLandmark, stairSpurOf, type LayoutStyle, type LandmarkKind } from './layouts.ts';
import { bfs, placeStair, farthestCell, type MazeCells } from './maze.ts';
import { generateBuilding } from './building.ts';

const generateLayout = (style: LayoutStyle, cols: number, rows: number, kind: LandmarkKind | null): MazeCells => layout(style, cols, rows, kind, generateBuilding);

const STYLES: LayoutStyle[] = ['halls', 'aisles', 'fishbone', 'plus', 'uturn'];
const SIZES: Array<[number, number]> = [
  [10, 8],
  [12, 10],
  [14, 10],
];
const D = { N: [0, -1, 'S'], S: [0, 1, 'N'], E: [1, 0, 'W'], W: [-1, 0, 'E'] } as const;

/** Edges between reachable cells, counted once, and how many of them lie inside the landmark. */
function stats(cells: MazeCells, cols: number, rows: number) {
  const dist = bfs(cells, cols, rows, 0, 0);
  const lm = landmarkOf(cells);
  let reachable = 0;
  let edges = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (dist[y]![x]! < 0) continue;
      reachable++;
      for (const d of ['E', 'S'] as const) if (cells[y]![x]![d]) edges++;
    }
  }
  const inside = lm ? lm.w * (lm.h - 1) + lm.h * (lm.w - 1) : 0;
  const insideTree = lm ? lm.w * lm.h - 1 : 0;
  return { dist, lm, reachable, edges, extra: inside - insideTree };
}

test('every template is one connected tree, apart from the loops inside its landmark', () => {
  for (const style of STYLES) {
    for (const [cols, rows] of SIZES) {
      for (let n = 0; n < 40; n++) {
        const cells = generateLayout(style, cols, rows, 'commons');
        const s = stats(cells, cols, rows);
        assert.equal(s.edges, s.reachable - 1 + s.extra, `${style} ${cols}x${rows}: ${s.edges} passages for ${s.reachable} cells`);
        // passages agree from both sides
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) for (const d of ['N', 'S', 'E', 'W'] as const) {
          if (!cells[y]![x]![d]) continue;
          const o = cells[y + D[d][1]]?.[x + D[d][0]];
          assert.ok(o && o[D[d][2]], `${style}: a one-sided passage at ${x},${y} ${d}`);
        }
      }
    }
  }
});

test('the start cell opens somewhere, and enough of each floor can be walked, with dead ends for rooms', () => {
  for (const style of STYLES) {
    for (const [cols, rows] of SIZES.slice(1)) {
      for (let n = 0; n < 20; n++) {
        const cells = generateLayout(style, cols, rows, null);
        const c = cells[0]![0]!;
        assert.ok(c.E || c.S, `${style}: the start is shut in`);
        const { reachable } = stats(cells, cols, rows);
        assert.ok(reachable >= cols * rows * 0.28, `${style} ${cols}x${rows}: only ${reachable} cells reachable`);
        const dist = bfs(cells, cols, rows, 0, 0);
        let dead = 0;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const k = (['N', 'S', 'E', 'W'] as const).filter((d) => cells[y]![x]![d]).length;
          if (dist[y]![x]! > 2 && k === 1) dead++;
        }
        assert.ok(dead >= 11, `${style} ${cols}x${rows}: ${dead} dead ends for rooms`);
      }
    }
  }
});

test('a landmark is carved most of the time, is open inside and has exactly one way in', () => {
  const kinds: LandmarkKind[] = ['commons', 'greathall', 'tankyard', 'vaulthall', 'dockyard', 'atrium'];
  for (const [i, style] of STYLES.entries()) {
    let got = 0;
    const N = 60;
    for (let n = 0; n < N; n++) {
      const cells = generateLayout(style, 14, 10, kinds[i]!);
      const lm = landmarkOf(cells);
      if (!lm) continue;
      got++;
      assert.ok(lm.w * lm.h >= 4);
      let ways = 0;
      for (let y = lm.y0; y < lm.y0 + lm.h; y++) {
        for (let x = lm.x0; x < lm.x0 + lm.w; x++) {
          for (const d of ['N', 'S', 'E', 'W'] as const) {
            if (!cells[y]![x]![d]) {
              continue;
            }
            if (!inLandmark(lm, x + D[d][0], y + D[d][1])) ways++;
          }
          if (x + 1 < lm.x0 + lm.w) assert.ok(cells[y]![x]!.E, 'a wall inside the landmark');
          if (y + 1 < lm.y0 + lm.h) assert.ok(cells[y]![x]!.S, 'a wall inside the landmark');
        }
      }
      assert.equal(ways, 1, `${style}: the landmark has ${ways} ways in`);
    }
    assert.ok(got >= N * 0.9, `${style}: a landmark in only ${got} of ${N}`);
  }
});

test('the templates are different shapes: how long the longest straight run is, and how far the farthest cell is', () => {
  const longest = (cells: MazeCells, cols: number, rows: number): number => {
    let best = 0;
    for (let y = 0; y < rows; y++) for (let x = 0, run = 0; x < cols; x++) { run = x > 0 && cells[y]![x - 1]!.E ? run + 1 : 1; best = Math.max(best, run); }
    return best;
  };
  const far = (cells: MazeCells, cols: number, rows: number): number => Math.max(...bfs(cells, cols, rows, 0, 0).flat());
  const a = generateLayout('aisles', 14, 10, null);
  assert.ok(longest(a, 14, 10) >= 13, 'aisles run the full width');
  const u = generateLayout('uturn', 14, 10, null);
  assert.ok(far(u, 14, 10) >= 24, 'the U-turn is a long way round');
  const p = generateLayout('plus', 14, 10, null);
  assert.ok(far(p, 14, 10) <= 22, 'the plus keeps everything close to the middle');
});

test('every template leaves room for a stair, so the job has a second floor', () => {
  for (const style of STYLES) {
    for (const [cols, rows] of SIZES.slice(1)) {
      let up = 0;
      const N = 80;
      for (let n = 0; n < N; n++) {
        const cells = generateLayout(style, cols, rows, 'commons');
        const dist = bfs(cells, cols, rows, 0, 0);
        const used = new Set(['0,0']);
        if (placeStair(cols, rows, cells, dist, used, 2) || placeStair(cols, rows, cells, dist, new Set(['0,0']), 1)) up++;
      }
      assert.ok(up >= N * 0.98, `${style} ${cols}x${rows}: a stair on only ${up} of ${N}`);
    }
  }
});

test('the exit is never at the top of the stair: with the exit placed as the game does, a stair still fits and does not end in it', () => {
  for (const style of STYLES) {
    for (const [cols, rows] of SIZES.slice(1)) {
      for (let n = 0; n < 60; n++) {
        const cells = generateLayout(style, cols, rows, 'commons');
        const lm = landmarkOf(cells);
        const spur = stairSpurOf(cells);
        const { x, y, dist } = farthestCell(cells, cols, rows, 0, 0, (cx, cy) => !inLandmark(lm, cx, cy) && !spur?.some((c) => c.x === cx && c.y === cy));
        const used = new Set(['0,0', `${x},${y}`]);
        const stair = placeStair(cols, rows, cells, dist, used, 2, spur?.[0]) ?? placeStair(cols, rows, cells, dist, new Set(['0,0', `${x},${y}`]), 1);
        assert.ok(stair, `${style} ${cols}x${rows}: no stair once the exit is at ${x},${y}`);
        const run = placeStair(cols, rows, cells, dist, new Set(['0,0', `${x},${y}`]), 2, spur?.[0]) ? 2 : 1;
        const far = stair!.spanX ? { x: stair!.x, y: stair!.y + run } : { x: stair!.x + run, y: stair!.y };
        assert.ok(!(far.x === x && far.y === y), `${style}: the stair's top is the exit`);
      }
    }
  }
});
