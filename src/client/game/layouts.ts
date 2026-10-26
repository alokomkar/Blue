// How a floor is laid out, one template per kind of place, so the buildings stop feeling like the same corridors:
//
//   halls     two long halls east off a corridor on the west, rooms in pairs either side (building.ts: the campus)
//   aisles    full-width aisles one above another, a bay off every few cells: racking, rows of boxes (warehouse, vaults)
//   fishbone  one long hall across the middle and galleries running up and down off it, with a few niches (museum)
//   plus      a hall across and a hall up and down crossing at the middle, short branches off both (lab, sculpture hall)
//   uturn     a hall out along the top, down the far end and back along the bottom (refinery)
//
// Every template makes a tree, like the maze, because security.ts seals sections off with doors and needs every passage to be the only
// route between its two sides. Cells no hall or room uses stay shut in on all sides, like a utility core; and then one block of them is
// opened out into a landmark (carveLandmark): a big open room, 3x2 cells or so, hung off one corridor. Its inside has loops, but it is a
// single pocket with one way in, so the tree still holds everywhere that matters (doors sit only on straight corridor passages, rooms in
// dead ends, and the landmark is neither).
// Pure (type-only imports), so it's unit-tested under Node.

import type { Cell, MazeCells } from './maze';

export type LayoutStyle = 'halls' | 'aisles' | 'fishbone' | 'plus' | 'uturn';

/** What a landmark is dressed as (landmarks.ts): one per kind of place. */
export type LandmarkKind = 'commons' | 'greathall' | 'tankyard' | 'vaulthall' | 'dockyard' | 'atrium';

export type Landmark = {
  kind: LandmarkKind;
  /** Top-left cell, and the size in cells. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** The corridor cell its one way in leads to, and the way from there into the landmark. */
  from: { x: number; y: number };
  dir: 'N' | 'S' | 'E' | 'W';
};

type Dir = 'N' | 'S' | 'E' | 'W';
const D: Record<Dir, [number, number, Dir]> = { N: [0, -1, 'S'], S: [0, 1, 'N'], E: [1, 0, 'W'], W: [-1, 0, 'E'] };

const closed = (): Cell => ({ N: false, S: false, E: false, W: false });
const blank = (cols: number, rows: number): MazeCells => Array.from({ length: rows }, () => Array.from({ length: cols }, closed));

function link(cells: MazeCells, x: number, y: number, dir: Dir): void {
  const [dx, dy, back] = D[dir];
  const other = cells[y + dy]?.[x + dx];
  if (!other || !cells[y]?.[x]) return;
  cells[y]![x]![dir] = true;
  other[back] = true;
}

const hline = (cells: MazeCells, y: number, x0: number, x1: number): void => {
  for (let x = x0; x < x1; x++) link(cells, x, y, 'E');
};
const vline = (cells: MazeCells, x: number, y0: number, y1: number): void => {
  for (let y = y0; y < y1; y++) link(cells, x, y, 'S');
};
const rnd = (n: number): number => Math.floor(Math.random() * n);
const chance = (p: number): boolean => Math.random() < p;

/** Full-width aisles every third row from row 1, with bays off them, skipping a stretch of columns (and a few at random) so there is solid ground to open out. */
function aisles(cols: number, rows: number): MazeCells {
  const cells = blank(cols, rows);
  vline(cells, 0, 0, rows - 1);
  const ys: number[] = [];
  for (let y = 1; y <= rows - 2; y += 3) ys.push(y);
  for (const y of ys) hline(cells, y, 0, cols - 1);
  const solidFrom = 3 + rnd(Math.max(1, cols - 8));
  const solid = (x: number): boolean => x >= solidFrom && x < solidFrom + 3;
  for (let x = 1; x < cols; x++) {
    if (solid(x) || chance(0.28)) continue;
    for (const [i, y] of ys.entries()) {
      if (i === 0) link(cells, x, 0, 'S');
      // the two rows between this aisle and the next hang off whichever is nearer
      if (y + 1 < rows && !ys.includes(y + 1)) link(cells, x, y + 1, 'N');
      const next = ys[i + 1];
      if (next !== undefined && next - 1 > y + 1) link(cells, x, next - 1, 'S');
      // below the last aisle, a second row to make the bay two cells deep now and then
      if (next === undefined && y + 2 < rows && chance(0.5)) link(cells, x, y + 2, 'N');
    }
  }
  return cells;
}

/** A hall across the middle with galleries up and down it every third column, a few niches off them, and a gap or two left solid. */
function fishbone(cols: number, rows: number): MazeCells {
  const cells = blank(cols, rows);
  vline(cells, 0, 0, rows - 1);
  const m = Math.floor(rows / 2);
  hline(cells, m, 0, cols - 1);
  const gx: number[] = [];
  for (let x = 3; x <= cols - 2; x += 3) gx.push(x);
  for (const x of gx) vline(cells, x, 0, rows - 1);
  // The gaps between galleries (and between the corridor and the first gallery): one is left solid, the rest get niches.
  const solidGap = rnd(gx.length);
  for (const [i, x] of gx.entries()) {
    const left = i === 0 ? 0 : gx[i - 1]!;
    if (i === solidGap) continue;
    for (let y = 0; y < rows; y++) {
      if (y === m || (y + i) % 2 === 1) continue;
      if (x - left >= 2) link(cells, x - 1, y, 'E');
      if (left > 0 && x - left >= 4) link(cells, left + 1, y, 'W');
    }
  }
  return cells;
}

/** A hall across and a hall down crossing at the middle, short branches off both, and four big solid quarters between. */
function plus(cols: number, rows: number): MazeCells {
  const cells = blank(cols, rows);
  const hx = Math.floor(cols / 2);
  const hy = Math.floor(rows / 2);
  vline(cells, 0, 0, hy);
  hline(cells, hy, 0, cols - 1);
  vline(cells, hx, 0, rows - 1);
  for (let x = 1; x < cols; x++) {
    if (Math.abs(x - hx) < 2 || x % 3 === 0 || chance(0.12)) continue;
    link(cells, x, hy - 1, 'S');
    link(cells, x, hy + 1, 'N');
  }
  for (let y = 0; y < rows; y++) {
    if (Math.abs(y - hy) < 2 || y % 3 === 1 || chance(0.12)) continue;
    link(cells, hx - 1, y, 'E');
    link(cells, hx + 1, y, 'W');
  }
  return cells;
}

/** A hall along the top, down the east end and back along the bottom, with bays off both; the middle is left solid. */
function uturn(cols: number, rows: number): MazeCells {
  const cells = blank(cols, rows);
  const a = 1;
  const b = rows - 2;
  link(cells, 0, 0, 'S');
  hline(cells, a, 0, cols - 1);
  vline(cells, cols - 1, a, b);
  hline(cells, b, 1, cols - 1);
  for (let x = 1; x < cols - 1; x++) {
    if (chance(0.3)) continue;
    link(cells, x, 0, 'S');
    if (x > 0) link(cells, x, a + 1, 'N');
    if (chance(0.8)) link(cells, x, b - 1, 'S');
    link(cells, x, rows - 1, 'N');
  }
  return cells;
}

/** The templates built here; `halls` is building.ts's, handed in (a value import from a sibling would not run under Node's test runner). */
const TEMPLATES: Record<Exclude<LayoutStyle, 'halls'>, (cols: number, rows: number) => MazeCells> = {
  aisles,
  fishbone,
  plus,
  uturn,
};

/** Steps from (0, 0) to each cell by open passages, -1 where it can't be reached. */
function distances(cells: MazeCells, cols: number, rows: number): number[][] {
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  dist[0]![0] = 0;
  const queue: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    for (const d of ['N', 'S', 'E', 'W'] as const) {
      if (!cells[y]![x]![d]) continue;
      const nx = x + D[d][0];
      const ny = y + D[d][1];
      if (dist[ny]?.[nx] === -1) {
        dist[ny]![nx] = dist[y]![x]! + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return dist;
}

/**
 * Whether a stair (maze.ts's placeStair) fits somewhere, two cells long (tall floors): a straight corridor cell, the cell after it straight too,
 * and past those a dead end opening back toward them, with the stair at least three steps from the start.
 */
function hasTallStair(cells: MazeCells, cols: number, rows: number, dist: number[][]): boolean {
  const count = (c: Cell): number => (c.N ? 1 : 0) + (c.S ? 1 : 0) + (c.E ? 1 : 0) + (c.W ? 1 : 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (dist[y]![x]! < 3) continue;
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const straight = (cx: number, cy: number): boolean => {
          const c = cells[cy]?.[cx];
          return !!c && count(c) === 2 && (dx === 0 ? c.N && c.S : c.E && c.W);
        };
        const far = cells[y + dy * 2]?.[x + dx * 2];
        if (straight(x, y) && straight(x + dx, y + dy) && far && count(far) === 1) return true;
      }
    }
  }
  return false;
}

/** Hangs a straight dead-end spur three cells long off a hall, out of solid cells, for the stair (see hasTallStair); false if there is no room for one. */
function addStairSpur(cells: MazeCells, cols: number, rows: number, dist: number[][]): Array<{ x: number; y: number }> | null {
  const options: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y]![x]!;
      if (dist[y]![x]! < 2) continue;
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
      ] as const) {
        // The hall cell runs across the spur's direction, with nothing opening toward it yet.
        const across = dx === 0 ? c.E && c.W && !c.S : c.N && c.S && !c.E;
        if (!across || openCount(c) !== 2) continue;
        const free = [1, 2, 3].every((k) => {
          const t = cells[y + dy * k]?.[x + dx * k];
          return !!t && isClosed(t);
        });
        if (free) options.push({ x, y, dx, dy });
      }
    }
  }
  if (!options.length) return null;
  const o = options[rnd(options.length)]!;
  const dir: Dir = o.dx === 0 ? 'S' : 'E';
  for (let k = 0; k < 3; k++) link(cells, o.x + o.dx * k, o.y + o.dy * k, dir);
  return [1, 2, 3].map((k) => ({ x: o.x + o.dx * k, y: o.y + o.dy * k }));
}

const landmarks = new WeakMap<MazeCells, Landmark>();
const spurs = new WeakMap<MazeCells, Array<{ x: number; y: number }>>();

/** The cells of the stair spur this plan was given (its first cell is where the stair goes, its last a dead end that must not be the exit), if it needed one. */
export const stairSpurOf = (cells: MazeCells): Array<{ x: number; y: number }> | null => spurs.get(cells) ?? null;

/** The landmark `cells` was laid out with, if it has one. */
export const landmarkOf = (cells: MazeCells): Landmark | null => landmarks.get(cells) ?? null;

/** Whether cell (x, y) is inside `lm`. */
export const inLandmark = (lm: Landmark | null, x: number, y: number): boolean => !!lm && x >= lm.x0 && x < lm.x0 + lm.w && y >= lm.y0 && y < lm.y0 + lm.h;

const isClosed = (c: Cell): boolean => !c.N && !c.S && !c.E && !c.W;
const openCount = (c: Cell): number => (c.N ? 1 : 0) + (c.S ? 1 : 0) + (c.E ? 1 : 0) + (c.W ? 1 : 0);

/**
 * Opens out a block of solid cells next to a corridor into one big room with a single way in, and remembers it. Looks for the
 * biggest block (3x2 or 2x3, else 2x2) whose every cell is solid and which touches a corridor cell running straight past it, not too
 * near the start; returns null when the template left no such block.
 */
export function carveLandmark(cells: MazeCells, cols: number, rows: number, kind: LandmarkKind): Landmark | null {
  const dist = distances(cells, cols, rows);
  type Option = { x0: number; y0: number; w: number; h: number; from: { x: number; y: number }; dir: Dir; into: { x: number; y: number }; score: number };
  const options: Option[] = [];
  for (const [w, h] of [
    [3, 2],
    [2, 3],
    [2, 2],
  ] as const) {
    for (let y0 = 0; y0 + h <= rows; y0++) {
      for (let x0 = 0; x0 + w <= cols; x0++) {
        let free = true;
        for (let y = y0; y < y0 + h && free; y++) for (let x = x0; x < x0 + w && free; x++) if (!isClosed(cells[y]![x]!)) free = false;
        if (!free) continue;
        // A corridor cell beside the block that runs straight past it: it becomes a T.
        for (const dir of ['N', 'S', 'E', 'W'] as const) {
          const [dx, dy] = D[dir];
          const edge: Array<{ x: number; y: number }> = [];
          if (dir === 'N') for (let x = x0; x < x0 + w; x++) edge.push({ x, y: y0 });
          if (dir === 'S') for (let x = x0; x < x0 + w; x++) edge.push({ x, y: y0 + h - 1 });
          if (dir === 'W') for (let y = y0; y < y0 + h; y++) edge.push({ x: x0, y });
          if (dir === 'E') for (let y = y0; y < y0 + h; y++) edge.push({ x: x0 + w - 1, y });
          for (const into of edge) {
            const from = { x: into.x + dx, y: into.y + dy };
            const c = cells[from.y]?.[from.x];
            if (!c || openCount(c) !== 2 || (dist[from.y]![from.x] ?? -1) < 3) continue;
            // the corridor must run along the block's edge, not into it
            const along = dir === 'N' || dir === 'S' ? c.E && c.W : c.N && c.S;
            if (!along) continue;
            options.push({ x0, y0, w, h, from, dir: D[dir][2], into, score: w * h * 10 + Math.min(12, dist[from.y]![from.x]!) + Math.random() * 6 });
          }
        }
      }
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  const best = options[0]!;
  // `best.dir` points from the corridor cell into the block.
  link(cells, best.from.x, best.from.y, best.dir);
  for (let y = best.y0; y < best.y0 + best.h; y++) {
    for (let x = best.x0; x < best.x0 + best.w; x++) {
      if (x + 1 < best.x0 + best.w) link(cells, x, y, 'E');
      if (y + 1 < best.y0 + best.h) link(cells, x, y, 'S');
    }
  }
  const lm: Landmark = { kind, x0: best.x0, y0: best.y0, w: best.w, h: best.h, from: best.from, dir: best.dir };
  landmarks.set(cells, lm);
  return lm;
}

/** A floor plan in `style`, with a landmark of `kind` opened out in it (or none, if `kind` is null or there was no room). */
export function generateLayout(style: LayoutStyle, cols: number, rows: number, kind: LandmarkKind | null, halls: (cols: number, rows: number) => MazeCells): MazeCells {
  let best: MazeCells | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const cells = style === 'halls' ? halls(cols, rows) : TEMPLATES[style](cols, rows);
    if (kind) carveLandmark(cells, cols, rows, kind);
    // A way up must exist (the stair needs a straight corridor ending in a dead end): add a spur for it if the template has none, after the landmark
    // has taken its block so it can't be turned into a junction by it. Halls come with plenty.
    const dist = distances(cells, cols, rows);
    if (style !== 'halls' && !hasTallStair(cells, cols, rows, dist)) {
      const spur = addStairSpur(cells, cols, rows, dist);
      if (spur) spurs.set(cells, spur);
    }
    if (hasTallStair(cells, cols, rows, distances(cells, cols, rows)) || style === 'halls') return cells;
    best ??= cells;
  }
  return best!;
}
