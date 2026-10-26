// Where the stealth props go — pure placement, tested under Node (no value
// imports, so it runs under Node's type stripping).
//
// - Staff lockers: tall steel lockers against a corridor wall that the
//   player can step inside to hide.
// - Vents: a crawl-through grille on each side of a wall between two cells
//   that sit side by side but are far apart by the corridors — a shortcut.
//   Both ends are always in the same door section, so a vent never skips a
//   locked door.

type Cell = { N: boolean; S: boolean; E: boolean; W: boolean };
type Dir = 'N' | 'S' | 'E' | 'W';

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DIRS: Dir[] = ['N', 'S', 'E', 'W'];

export const VENT_MIN_DETOUR = 6;
/** A vent may run through up to this many solid cells between its two ends. */
export const VENT_MAX_GAP = 2; // cells of walking the vent has to save to be worth one

/** Walking distance in cells from (sx, sy) to every cell; -1 where unreachable. */
function walkDistances(cells: Cell[][], cols: number, rows: number, sx: number, sy: number): number[][] {
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  dist[sy]![sx] = 0;
  const queue: Array<[number, number]> = [[sx, sy]];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head]!;
    for (const d of DIRS) {
      if (!cells[y]![x]![d]) continue;
      const [dx, dy] = DELTA[d];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny]![nx]! >= 0) continue;
      dist[ny]![nx] = dist[y]![x]! + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

/** A staff locker: in cell (x, y), standing against its closed `wall`. */
export type StaffLockerSpot = { x: number; y: number; wall: Dir };

/** Up to `count` lockers in plain corridor cells (two openings), against a closed wall, in cells nothing else uses. */
export function placeStaffLockers(cells: Cell[][], cols: number, rows: number, used: Set<string>, count: number, rand: () => number = Math.random): StaffLockerSpot[] {
  const options: StaffLockerSpot[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (used.has(`${x},${y}`)) continue;
      const c = cells[y]![x]!;
      const open = DIRS.filter((d) => c[d]);
      if (open.length !== 2) continue;
      const closed = DIRS.filter((d) => !c[d]);
      options.push({ x, y, wall: closed[Math.floor(rand() * closed.length)]! });
    }
  }
  const out: StaffLockerSpot[] = [];
  while (out.length < count && options.length) {
    const pick = options.splice(Math.floor(rand() * options.length), 1)[0]!;
    // Spread out: never two in neighbouring cells.
    if (out.some((o) => Math.abs(o.x - pick.x) + Math.abs(o.y - pick.y) < 3)) continue;
    out.push(pick);
    used.add(`${pick.x},${pick.y}`);
  }
  return out;
}

/** A vent from cell `a` to cell `b`, on a's `side`: through the wall between neighbours, or on through a couple of solid cells. */
export type VentPair = { a: { x: number; y: number }; b: { x: number; y: number }; side: Dir };

/**
 * Up to `count` vents: neighbouring cells with a wall between them, in the
 * same door section, neither used by anything else, and at least
 * VENT_MIN_DETOUR cells apart by the corridors.
 */
export function placeVents(
  cells: Cell[][],
  cols: number,
  rows: number,
  section: number[][],
  used: Set<string>,
  count: number,
  rand: () => number = Math.random
): VentPair[] {
  const options: VentPair[] = [];
  const shut = (x: number, y: number): boolean => {
    const c = cells[y]?.[x];
    return !!c && !c.N && !c.S && !c.E && !c.W;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (shut(x, y)) continue;
      for (const side of ['E', 'S'] as const) {
        const [dx, dy] = DELTA[side];
        if (cells[y]![x]![side]) continue; // already open — no wall to vent through
        // Through the wall to the next cell, or on through one or two solid cells (a utility core) to the open cell past them.
        let bx = x + dx;
        let by = y + dy;
        for (let gap = 0; gap < VENT_MAX_GAP && bx < cols && by < rows && shut(bx, by); gap++) {
          bx += dx;
          by += dy;
        }
        if (bx >= cols || by >= rows || shut(bx, by)) continue;
        if (used.has(`${x},${y}`) || used.has(`${bx},${by}`)) continue;
        if (section[y]![x] !== section[by]![bx]) continue;
        options.push({ a: { x, y }, b: { x: bx, y: by }, side });
      }
    }
  }
  const out: VentPair[] = [];
  while (out.length < count && options.length) {
    const pick = options.splice(Math.floor(rand() * options.length), 1)[0]!;
    const k = (c: { x: number; y: number }): string => `${c.x},${c.y}`;
    if (used.has(k(pick.a)) || used.has(k(pick.b))) continue;
    const walk = walkDistances(cells, cols, rows, pick.a.x, pick.a.y)[pick.b.y]![pick.b.x]!;
    if (walk < VENT_MIN_DETOUR) continue;
    out.push(pick);
    used.add(k(pick.a));
    used.add(k(pick.b));
  }
  return out;
}
