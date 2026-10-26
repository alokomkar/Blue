// Maze generation — ported from blueprint/src/index.html:2599 (generateMaze),
// :2634 (bfs), :2657 (pathFromDist). Same iterative recursive-backtracker
// algorithm family, typed. Kept logic-identical to the 2D game so job-size
// scaling and structure placement behave the same way once those systems
// land — except for one deliberate deviation, below.
//
// Straight-line bias (added after direct feedback that the maze "feels
// twisty... too many turns"): the stock recursive-backtracker picks the
// next direction uniformly at random among open neighbors, which is
// exactly why it reads as twisty regardless of maze size — a fresh
// coin-flip at every single cell means a turn at nearly every cell,
// independent of how big the maze is. STRAIGHT_BIAS below weights
// "continue in the direction I just arrived from" heavily over turning,
// so corridors run long before branching — still a real perfect maze (the
// spanning-tree/backtracking guarantee — exactly one path between any two
// cells — doesn't depend on the selection being uniform, only on picking
// among genuinely-open unvisited neighbors), just laid out with actual
// corridors instead of a turn every 4 units. See maze.test.ts for the
// regression guard on this.

export type Cell = { N: boolean; S: boolean; E: boolean; W: boolean };
export type MazeCells = Cell[][];

const DIRS: Array<[number, number, keyof Cell, keyof Cell]> = [
  [0, -1, 'N', 'S'],
  [1, 0, 'E', 'W'],
  [0, 1, 'S', 'N'],
  [-1, 0, 'W', 'E'],
];

const STRAIGHT_BIAS = 5; // relative weight for continuing straight vs. turning — tuned by feel, not derived

export function generateMaze(cols: number, rows: number): MazeCells {
  const cells: MazeCells = [];
  for (let y = 0; y < rows; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < cols; x++) row.push({ N: false, E: false, S: false, W: false });
    cells.push(row);
  }
  const visited: boolean[][] = [];
  for (let y = 0; y < rows; y++) visited.push(new Array(cols).fill(false));

  const stack: Array<[number, number]> = [[0, 0]];
  // Direction used to *arrive* at the matching entry in `stack` (null for
  // the start cell) — popped in lockstep with `stack` on backtrack, so the
  // bias below always reflects the direction actually last taken along the
  // current path, not some stale global value.
  const dirStack: Array<[number, number] | null> = [null];
  visited[0]![0] = true;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1]!;
    const lastDir = dirStack[dirStack.length - 1]!;
    const options: Array<[number, number, keyof Cell, keyof Cell, number, number]> = [];
    for (const [dx, dy, fwd, back] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny]![nx]) {
        options.push([nx, ny, fwd, back, dx, dy]);
      }
    }
    if (options.length === 0) {
      stack.pop();
      dirStack.pop();
      continue;
    }

    const weights = options.map(([, , , , dx, dy]) => (lastDir && dx === lastDir[0] && dy === lastDir[1] ? STRAIGHT_BIAS : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    let chosen = options.length - 1;
    for (let i = 0; i < options.length; i++) {
      r -= weights[i]!;
      if (r <= 0) {
        chosen = i;
        break;
      }
    }

    const [nx, ny, fwd, back, dx, dy] = options[chosen]!;
    cells[cy]![cx]![fwd] = true;
    cells[ny]![nx]![back] = true;
    visited[ny]![nx] = true;
    stack.push([nx, ny]);
    dirStack.push([dx, dy]);
  }
  return cells;
}

export function bfs(cells: MazeCells, cols: number, rows: number, sx: number, sy: number): number[][] {
  const dist: number[][] = [];
  for (let y = 0; y < rows; y++) dist.push(new Array(cols).fill(-1));
  // Starting outside the grid (the agent on the stair between floors, a cell off this floor's edge) reaches nothing: all -1, rather than a throw.
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return dist;
  const q: Array<[number, number]> = [[sx, sy]];
  dist[sy]![sx] = 0;
  let qi = 0;
  while (qi < q.length) {
    const [x, y] = q[qi++]!;
    const c = cells[y]![x]!;
    const neighbors: Array<[number, number]> = [];
    if (c.N) neighbors.push([x, y - 1]);
    if (c.S) neighbors.push([x, y + 1]);
    if (c.E) neighbors.push([x + 1, y]);
    if (c.W) neighbors.push([x - 1, y]);
    for (const [nx, ny] of neighbors) {
      // A cell can claim an opening toward a neighbor that doesn't actually
      // exist in the grid — e.g. the multi-floor stairwell-doorway punch
      // (game.ts's startJob) deliberately forces cell (0,0)'s N or W flag
      // open for wall-rendering purposes even though row -1/col -1 has no
      // real cell. Bounds-check before indexing rather than trusting the
      // flag, or that case throws (reproduced live: "Cannot read properties
      // of undefined (reading '0')" from dist[-1][0]).
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (dist[ny]![nx] === -1) {
        dist[ny]![nx] = dist[y]![x]! + 1;
        q.push([nx, ny]);
      }
    }
  }
  return dist;
}

export function pathFromDist(
  cells: MazeCells,
  dist: number[][],
  tx: number,
  ty: number,
  sx: number,
  sy: number
): Array<{ x: number; y: number }> | null {
  const path = [{ x: tx, y: ty }];
  let cx = tx;
  let cy = ty;
  while (!(cx === sx && cy === sy)) {
    const c = cells[cy]![cx]!;
    const candidates: Array<[number, number]> = [];
    if (c.N) candidates.push([cx, cy - 1]);
    if (c.S) candidates.push([cx, cy + 1]);
    if (c.E) candidates.push([cx + 1, cy]);
    if (c.W) candidates.push([cx - 1, cy]);
    // Same out-of-grid-neighbor guard as bfs() above — a candidate whose
    // claimed opening points off the edge of the grid (the stairwell
    // doorway punch) must be filtered out before indexing `dist`.
    const next = candidates.find(
      ([nx, ny]) => ny >= 0 && ny < dist.length && nx >= 0 && nx < dist[ny]!.length && dist[ny]![nx] === dist[cy]![cx]! - 1
    );
    if (!next) return null;
    [cx, cy] = next;
    path.push({ x: cx, y: cy });
  }
  return path.reverse();
}

/** Farthest cell from (sx,sy) by BFS distance — used to place the exit. */
export function farthestCell(cells: MazeCells, cols: number, rows: number, sx: number, sy: number, ok: (x: number, y: number) => boolean = () => true): {
  x: number;
  y: number;
  dist: number[][];
} {
  const dist = bfs(cells, cols, rows, sx, sy);
  let fx = sx;
  let fy = sy;
  let best = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (dist[y]![x]! > best && ok(x, y)) {
        best = dist[y]![x]!;
        fx = x;
        fy = y;
      }
    }
  }
  return { x: fx, y: fy, dist };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** How far from where the agent comes in (in cells of walking) an enemy starts, on a floor big enough for it: a breather before the first meeting. */
export const SPAWN_MIN_CELLS = 8;
const SPAWN_FLOOR_CELLS = 5; // never closer than this, however small the floor

/**
 * Enemy spawn point — ported from blueprint/src/index.html's placeBots() (~:2901), with a longer lead than the original's 5 cells: the agent gets SPAWN_MIN_CELLS of walking to
 * themselves (less on a floor too small for that: about 55% of its farthest cell, never under 5), and only after half the attempts fail does it settle for the old 5.
 * Call once per enemy; each call reserves its cell in `used` so repeated calls place non-overlapping spawns.
 */
export function placeBotSpawn(
  cols: number,
  rows: number,
  dist: number[][],
  used: Set<string>,
  ok: (x: number, y: number) => boolean = () => true
): { x: number; y: number } | null {
  let far = 0;
  for (const row of dist) for (const d of row) if (d > far) far = d;
  const lead = Math.max(SPAWN_FLOOR_CELLS, Math.min(SPAWN_MIN_CELLS, Math.floor(far * 0.55)));
  let attempts = 0;
  while (attempts < 300) {
    attempts++;
    const rx = Math.floor(Math.random() * cols);
    const ry = Math.floor(Math.random() * rows);
    const k = cellKey(rx, ry);
    const need = attempts <= 150 ? lead : SPAWN_FLOOR_CELLS;
    if (used.has(k) || dist[ry]![rx]! < need || !ok(rx, ry)) continue;
    used.add(k);
    return { x: rx, y: ry };
  }
  return null;
}

/** Hiding-spot placement — ported from blueprint/src/index.html's placeHidingSpots(), min-distance-3 filter. */
export function placeHidingSpots(cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Array<{ x: number; y: number }> {
  const spots: Array<{ x: number; y: number }> = [];
  let attempts = 0;
  while (spots.length < count && attempts < 300) {
    attempts++;
    const rx = Math.floor(Math.random() * cols);
    const ry = Math.floor(Math.random() * rows);
    const k = cellKey(rx, ry);
    if (used.has(k) || dist[ry]![rx]! < 3) continue;
    used.add(k);
    spots.push({ x: rx, y: ry });
  }
  return spots;
}

/**
 * Laser-trap placement — same min-distance-3 filter as the other placement
 * functions, but additionally requires a clean straight-through cell
 * (exactly one pair of opposite openings, same shape lasers.ts's header
 * comment and maze.test.ts's corridor-bias check both rely on) so the
 * beam's orientation is never ambiguous. `spanX` tells lasers.ts which way
 * to lay the beam: the corridor runs N-S (player crosses along Z), so the
 * beam spans X to block that crossing, and vice versa.
 */
export function placeLaserTraps(cols: number, rows: number, cells: MazeCells, dist: number[][], used: Set<string>, count: number): Array<{ x: number; y: number; spanX: boolean }> {
  const traps: Array<{ x: number; y: number; spanX: boolean }> = [];
  let attempts = 0;
  while (traps.length < count && attempts < 300) {
    attempts++;
    const rx = Math.floor(Math.random() * cols);
    const ry = Math.floor(Math.random() * rows);
    const k = cellKey(rx, ry);
    if (used.has(k) || dist[ry]![rx]! < 3) continue;
    const c = cells[ry]![rx]!;
    const spanNS = c.N && c.S && !c.E && !c.W; // corridor runs N-S -> beam spans X
    const spanEW = c.E && c.W && !c.N && !c.S; // corridor runs E-W -> beam spans Z
    if (!spanNS && !spanEW) continue;
    used.add(k);
    traps.push({ x: rx, y: ry, spanX: spanNS });
  }
  return traps;
}

// Multi-floor building — vertical-movement foundation (stairs.ts owns the
// mesh/height-field math). A staircase connects two stacked floors, so its
// cell needs the exact same "clean straight-through corridor" shape already
// established for laser traps (exactly one pair of opposite openings): the
// stair occupies that whole cell, replacing its normal flat floor with a
// ramp, and reuses the cell's own pre-existing side walls (from ordinary
// maze generation) as the stair's guard rails — no separate collision
// geometry needed for the sides, only the height field itself (see
// stairs.ts's stairGroundHeight()).
/** A staircase: its first cell, the axis it climbs along, the heights it joins, and how many cells long its run is. */
export type Stair = {
  x: number;
  y: number;
  spanX: boolean;
  fromFloorY: number;
  toFloorY: number;
  run: number;
  /** How many cells wide it is, across its run (a hall's grand stair): one when left out. */
  width?: number;
};

/** The cells a stair at (x, y), `run` cells long, puts out of bounds on its own floor: the rest of its run, and the landing past the top (see placeStair). */
export function stairReserved(stair: { x: number; y: number; spanX: boolean }, run: number): Array<{ x: number; y: number }> {
  return Array.from({ length: run }, (_, i) => (stair.spanX ? { x: stair.x, y: stair.y + i + 1 } : { x: stair.x + i + 1, y: stair.y }));
}

/**
 * Stair placement — identical filter to placeLaserTraps (min-distance-3,
 * clean straight-through cell only, so the ramp's run direction is never
 * ambiguous), returning at most one result since this foundation pass
 * connects exactly two floors. `spanX` follows the same convention as
 * laser traps: true means the corridor runs N-S, so the player climbs along
 * the Z axis.
 *
 * The run is `run` cells long (two where floors are tall, scene.ts's
 * TALL_FLOOR_HEIGHT): every cell of it must be the same clean
 * straight-through corridor. A one-cell run samples cells at random, as it
 * always has (so buildings that don't need the longer stairs come out as
 * they always did); a longer one, rarer, checks every cell.
 *
 * Additionally requires the stair's "far" neighbor (the cell past the top
 * of the climb — `run` along the axis, matching game.ts's own
 * floor-1-origin offset) to be a genuine dead end (exactly one opening,
 * necessarily the one facing back toward the stair). Real bug, reproduced
 * live: without this, that cell is a completely ordinary, fully-connected
 * floor-0 corridor cell too — a player could walk there via floor 0's own
 * network without ever climbing, then step back onto the stair from the
 * "top" side while still on floor 0. The height field has no way to tell
 * "genuinely climbed" from "walked around to the top," so it snapped the
 * player's height to match wherever they entered and rode them back down —
 * reading exactly as "walking through" the stairs. Requiring a dead-end far
 * neighbor makes climbing the *only* way to ever reach that cell.
 */
export function placeStair(cols: number, rows: number, cells: MazeCells, dist: number[][], used: Set<string>, run = 1, prefer?: { x: number; y: number } | null): { x: number; y: number; spanX: boolean } | null {
  const fits = (rx: number, ry: number): { x: number; y: number; spanX: boolean } | null => {
    if (used.has(cellKey(rx, ry)) || dist[ry]![rx]! < 3) return null;
    const c = cells[ry]![rx]!;
    const spanNS = c.N && c.S && !c.E && !c.W;
    const spanEW = c.E && c.W && !c.N && !c.S;
    if (!spanNS && !spanEW) return null;
    const spanX = spanNS;
    // The rest of the run: straight through along the same axis, and free.
    for (let i = 1; i < run; i++) {
      const sx = spanX ? rx : rx + i;
      const sy = spanX ? ry + i : ry;
      const s = cells[sy]?.[sx];
      if (!s || used.has(cellKey(sx, sy)) || !(spanX ? s.N && s.S && !s.E && !s.W : s.E && s.W && !s.N && !s.S)) return null;
    }
    const farX = spanX ? rx : rx + run;
    const farY = spanX ? ry + run : ry;
    if (farX < 0 || farX >= cols || farY < 0 || farY >= rows) return null;
    // The dead end past the top of the climb is never the exit (or anything else reserved): the stair would have to be climbed to reach it.
    if (used.has(cellKey(farX, farY))) return null;
    const far = cells[farY]![farX]!;
    if (Number(far.N) + Number(far.S) + Number(far.E) + Number(far.W) !== 1) return null;
    return { x: rx, y: ry, spanX };
  };
  let found: { x: number; y: number; spanX: boolean } | null = null;
  if (run === 1) {
    for (let attempts = 0; attempts < 300 && !found; attempts++) {
      const rx = Math.floor(Math.random() * cols);
      const ry = Math.floor(Math.random() * rows);
      found = fits(rx, ry);
    }
    // 300 random cells can miss the one cell that fits (a sketch may have a single spur, and a big floor has few cells to hit it with): look at every cell before giving up.
    if (!found) {
      const all: Array<{ x: number; y: number; spanX: boolean }> = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const f = fits(x, y);
        if (f) all.push(f);
      }
      if (all.length) found = all[Math.floor(Math.random() * all.length)]!;
    }
  } else {
    const all: Array<{ x: number; y: number; spanX: boolean }> = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const f = fits(x, y);
      if (f) all.push(f);
    }
    const wanted = prefer ? all.find((f) => f.x === prefer.x && f.y === prefer.y) : undefined;
    found = wanted ?? (all.length ? all[Math.floor(Math.random() * all.length)]! : null);
  }
  if (found) used.add(cellKey(found.x, found.y));
  return found;
}
