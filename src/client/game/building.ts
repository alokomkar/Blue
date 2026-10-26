// A floor laid out like a building instead of a maze: a corridor down the west side (where the lift or the stair
// lands), long halls running east off it, and rooms either side of each hall, in pairs of 1×2 cells, with a solid
// block between each pair so a hall has straight stretches (for a stair, a tower, a laser). Still a tree, so
// everything built for the maze (doors that seal a section, rooms in dead ends, patrols) works unchanged; but
// where the maze twists, this one is easy to read: the way on is along the hall, and every dead end is a room.
//
// Cells that are neither hall nor room (the blocks) stay walled in on all sides, like a utility core.
// Pure (type-only imports), so it's unit-tested under Node.

import type { Cell, MazeCells } from './maze';

/** Rooms come in pairs of columns, with two or three solid columns between pairs so the hall past them is straight. */
const SOLID_BETWEEN = [2, 2, 3];

/** Which columns have rooms: pairs, from a random first column, each followed by a random run of solid ones. */
function roomColumns(cols: number): Set<number> {
  const out = new Set<number>();
  for (let x = 1 + Math.floor(Math.random() * 3); x < cols; x += 2 + SOLID_BETWEEN[Math.floor(Math.random() * SOLID_BETWEEN.length)]!) {
    out.add(x);
    if (x + 1 < cols) out.add(x + 1);
  }
  return out;
}

const closed = (): Cell => ({ N: false, S: false, E: false, W: false });

function link(cells: MazeCells, x: number, y: number, dir: 'N' | 'S' | 'E' | 'W'): void {
  const d = { N: [0, -1, 'S'], S: [0, 1, 'N'], E: [1, 0, 'W'], W: [-1, 0, 'E'] } as const;
  const [dx, dy, back] = d[dir];
  const other = cells[y + dy]?.[x + dx];
  if (!other) return;
  cells[y]![x]![dir] = true;
  other[back] = true;
}

/**
 * The halls' rows for a floor `rows` tall: two, a quarter and three quarters of the way down (one when the floor
 * is too short for two). `jitter` (-1, 0 or 1) moves them for variety.
 */
export function hallRows(rows: number, jitter = 0): number[] {
  if (rows < 6) return [Math.floor(rows / 2)];
  const a = Math.min(rows - 5, Math.max(1, Math.floor((rows - 1) / 4) + jitter));
  const b = Math.min(rows - 2, Math.max(a + 3, rows - 1 - a - jitter));
  return [a, b];
}

export function generateBuilding(cols: number, rows: number): MazeCells {
  const cells: MazeCells = Array.from({ length: rows }, () => Array.from({ length: cols }, closed));
  const jitter = Math.floor(Math.random() * 5) - 2;
  const rooms = roomColumns(cols);
  const halls = hallRows(rows, jitter);
  // The corridor down the west side, where everything starts.
  for (let y = 0; y + 1 < rows; y++) link(cells, 0, y, 'S');
  // Each hall, west to east.
  for (const hy of halls) for (let x = 0; x + 1 < cols; x++) link(cells, x, hy, 'E');
  // Rooms: in each column that has them, every row hangs off a hall.
  const splits = new Map<number, number>();
  for (let x = 1; x < cols; x++) {
    if (!rooms.has(x)) continue;
    if (halls.length === 2) splits.set(x, halls[0]! + Math.floor(Math.random() * (halls[1]! - halls[0]!)));
    for (let y = 0; y < rows; y++) {
      if (halls.includes(y)) continue;
      // Toward a hall: the nearer one for a row outside both, and for the rows between the two, wherever this column's own split falls (so
      // the rooms in one column reach further up or down than the next: the same building is never quite the same twice).
      const hall = halls.length === 2 && y > halls[0]! && y < halls[1]! ? (y <= splits.get(x)! ? halls[0]! : halls[1]!) : halls.reduce((best, h) => (Math.abs(h - y) < Math.abs(best - y) ? h : best), halls[0]!);
      // Link this cell to the next one toward the hall.
      link(cells, x, y, y < hall ? 'S' : 'N');
    }
  }
  return cells;
}
