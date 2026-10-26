// The building's lighting. Every corridor light and every lit room has a
// wall switch: flicking it off is silent (unlike shooting the bulb out),
// but a guard nearby notices and comes to switch it back on, so darkness is
// both a tool and a lure. From job 10 each floor is also split into wiring
// circuits, each with a breaker panel. Cutting a breaker blacks out its
// whole circuit, and after a while a guard is sent to reset it. Here are the
// pure parts: splitting a floor into circuits, and where panels go. Type-only
// imports, so it's unit-tested under Node.

import type { MazeCells } from './maze';
import type { Dir } from './security';

/** Guards within this many cells' walk of a light switched off come to switch it back on. */
export const LIGHT_LURE_CELLS = 5;
/** Seconds after a breaker is cut before a guard is sent to reset it. */
export const BREAKER_DISPATCH_S = 25;
/** Seconds a guard spends at a switch or breaker, putting it back. */
export const RESET_TAKES_S = 1.2;
/** Seedings planCircuits tries, keeping the one whose smallest circuit is largest. */
const SEEDING_ATTEMPTS = 4;

const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function walkFrom(cells: MazeCells, cols: number, rows: number, starts: Array<{ x: number; y: number }>): { dist: number[][]; from: number[][] } {
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  const from = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  const queue: Array<[number, number]> = [];
  starts.forEach((s, i) => {
    dist[s.y]![s.x] = 0;
    from[s.y]![s.x] = i;
    queue.push([s.x, s.y]);
  });
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q]!;
    for (const d of DIRS) {
      if (!cells[y]![x]![d]) continue;
      const nx = x + DELTA[d][0];
      const ny = y + DELTA[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny]![nx]! >= 0) continue;
      dist[ny]![nx] = dist[y]![x]! + 1;
      from[ny]![nx] = from[y]![x]!;
      queue.push([nx, ny]);
    }
  }
  return { dist, from };
}

/**
 * Splits the floor into `count` circuits of about equal reach: seeds spread
 * out by walking distance (each new one among the cells farthest from the
 * seeds so far), then every cell wired to its nearest seed. Each circuit is
 * one connected patch of corridors.
 */
export function planCircuits(
  cells: MazeCells,
  cols: number,
  rows: number,
  count: number,
  rand: () => number = Math.random
): { circuit: number[][]; seeds: Array<{ x: number; y: number }> } {
  // A seed boxed into a pocket of the maze can leave its circuit small, so
  // try a few seedings and keep the most even split.
  let best: { circuit: number[][]; seeds: Array<{ x: number; y: number }>; smallest: number } | null = null;
  for (let attempt = 0; attempt < SEEDING_ATTEMPTS; attempt++) {
    const plan = seedCircuits(cells, cols, rows, count, rand);
    const sizes = new Array<number>(plan.seeds.length).fill(0);
    for (const row of plan.circuit) for (const k of row) if (k >= 0) sizes[k]!++;
    const smallest = Math.min(...sizes);
    if (!best || smallest > best.smallest) best = { ...plan, smallest };
  }
  return { circuit: best!.circuit, seeds: best!.seeds };
}

/** One seeding: seeds spread out by walking distance, then the circuits grown from them in turns. */
function seedCircuits(
  cells: MazeCells,
  cols: number,
  rows: number,
  count: number,
  rand: () => number
): { circuit: number[][]; seeds: Array<{ x: number; y: number }> } {
  const seeds = [{ x: Math.floor(rand() * cols), y: Math.floor(rand() * rows) }];
  while (seeds.length < count) {
    const { dist } = walkFrom(cells, cols, rows, seeds);
    const far: Array<{ x: number; y: number; d: number }> = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) far.push({ x, y, d: dist[y]![x]! });
    far.sort((a, b) => b.d - a.d);
    const top = far.slice(0, Math.max(1, Math.ceil(far.length * 0.1)));
    const pick = top[Math.floor(rand() * top.length)]!;
    if (pick.d <= 0) break; // nowhere left to put another
    seeds.push({ x: pick.x, y: pick.y });
  }
  return { circuit: growBalanced(cells, cols, rows, seeds), seeds };
}

/**
 * Wires every cell to a seed by growing the circuits outward in turns, the
 * smallest one each time, so they come out about the same size and each
 * stays one connected patch. (Wiring each cell to its nearest seed instead
 * can leave one circuit a few dozen cells and another most of the floor.)
 */
function growBalanced(cells: MazeCells, cols: number, rows: number, seeds: Array<{ x: number; y: number }>): number[][] {
  const circuit = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  const queues = seeds.map((s) => [s]);
  const heads = seeds.map(() => 0);
  const sizes = seeds.map(() => 1);
  seeds.forEach((s, k) => (circuit[s.y]![s.x] = k));
  for (;;) {
    let k = -1;
    for (let i = 0; i < seeds.length; i++) if (heads[i]! < queues[i]!.length && (k < 0 || sizes[i]! < sizes[k]!)) k = i;
    if (k < 0) break;
    const { x, y } = queues[k]![heads[k]!++]!;
    for (const d of DIRS) {
      if (!cells[y]![x]![d]) continue;
      const nx = x + DELTA[d][0];
      const ny = y + DELTA[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || circuit[ny]![nx]! >= 0) continue;
      circuit[ny]![nx] = k;
      sizes[k]!++;
      queues[k]!.push({ x: nx, y: ny });
    }
  }
  return circuit;
}

/** A wall of cell (x, y) it doesn't open through, to mount something on; null for a four-way junction. */
export function wallFor(cells: MazeCells, x: number, y: number, rand: () => number = Math.random): Dir | null {
  const closed = DIRS.filter((d) => !cells[y]![x]![d]);
  return closed.length ? closed[Math.floor(rand() * closed.length)]! : null;
}

/**
 * Where circuit `k`'s breaker panel goes: a corridor cell (two ways through,
 * so it's on a route, not tucked in a dead end) in the circuit and nothing
 * else's, as near its seed as possible. Null if the circuit has no such cell.
 */
export function breakerSpot(
  cells: MazeCells,
  cols: number,
  rows: number,
  circuit: number[][],
  k: number,
  seed: { x: number; y: number },
  used: ReadonlySet<string>,
  rand: () => number = Math.random
): { x: number; y: number; wall: Dir } | null {
  const { dist } = walkFrom(cells, cols, rows, [seed]);
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (circuit[y]![x] !== k || used.has(`${x},${y}`)) continue;
      if (DIRS.filter((d) => cells[y]![x]![d]).length !== 2) continue;
      const d = dist[y]![x]!;
      if (d >= 0 && (!best || d < best.d)) best = { x, y, d };
    }
  }
  if (!best) return null;
  const wall = wallFor(cells, best.x, best.y, rand);
  return wall ? { x: best.x, y: best.y, wall } : null;
}
