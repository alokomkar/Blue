// The level spec: everything a level is built from, written down so a model (or a photo) can ask for one. Today a job number
// picks the place, layout, contract, twists and every count; a spec makes them explicit and serialisable (docs/DESIGN.md
// section 1). Here: the type, the JSON Schema a model is held to, a clamp that turns any JSON into a legal spec and says what it
// changed, a parser for model text, and the overlay of a spec onto a job's Difficulty (client/game/difficulty.ts).
// Pure, so it's unit-tested under Node.
//
// This file can't import the client's own lists (shared is its own project, rooted at src/shared), so the place, layout and
// twist lists, the caps and the twist rules are mirrored here, each said to be; levelspec.test.ts holds every one equal to the
// game's own (locations.ts, layouts.ts, twists.ts, difficulty.ts), so a drift fails a test rather than a level.

import { CONTRACT_IDS, type ContractId } from './contracts.ts';

/** locations.ts's LocationId. */
export const PLACE_IDS = ['campus', 'museum', 'refinery', 'bank', 'warehouse', 'lab'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

/** layouts.ts's LayoutStyle, and the plain maze. */
export const LAYOUT_IDS = ['halls', 'aisles', 'fishbone', 'plus', 'uturn', 'maze'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

/** twists.ts's TwistId, in its order. */
export const TWIST_IDS = ['shiftchange', 'lockdown', 'lightsout', 'reinforcements', 'lightkit', 'silent', 'timer'] as const;
export type TwistId = (typeof TWIST_IDS)[number];

export { CONTRACT_IDS };
export type { ContractId };

export type Pt = { x: number; y: number };

/** One cell's openings, as a sketch gives them (the game's own Cell is N/S/E/W). */
export type GridCell = { n: boolean; s: boolean; e: boolean; w: boolean };

/** Photo to map: the walls are given, not generated. Row-major, `cols * rows` cells. */
export type SpecGrid = { cols: number; rows: number; cells: GridCell[]; start: Pt; exit: Pt };

export type LevelSpec = {
  version: 1;
  /** Shown in the brief; at most TITLE_MAX characters. */
  title: string;
  /** One sentence; at most BRIEF_MAX characters. */
  brief: string;
  place: PlaceId;
  layout: LayoutId;
  size: { cols: number; rows: number };
  floors: 1 | 2;
  /** A uint32: the same spec with the same seed builds the same level. */
  seed: number;
  contract: ContractId;
  /** Up to MAX_TWISTS, each fitting the contract and not clashing with the other. */
  twists: TwistId[];
  /** Per floor. */
  roster: { guards: number; watchdogs: number; crawlers: number; alphas: number; drones: number; heavies: number };
  /** Per floor. */
  hazards: { doors: number; lasers: number; lines: number; gates: number; sweepers: number; sliders: number; shutters: number; blackouts: number };
  /** For the whole job, split across the floors. */
  loot: { documents: number };
  grid?: SpecGrid;
};

/**
 * The seed a build phase draws from. The game builds a floor with a great deal between the layout steps that draws random numbers too (decor, lamps, patrol routes), which the
 * verifier's pure build does not, so one stream from the start would drift apart after the first floor plan. Both reseed from here at the same few points (the stair and the
 * contract's steps, the upper plan, each floor's doors and rooms, each enemy, each hazard), so what the verifier checks of the plan, the exit, the stair, the doors and the rooms is what the game builds.
 */
export const BUILD_PHASE = { stair: 1, upperPlan: 2, upperSecurity: 3, groundSecurity: 4 } as const;
/** The phase of the `n`th enemy placed on a floor (guards, then mines, alphas, drones and dogs): each from its own seed, since making the one before draws random numbers (its patrol) too. */
export const enemyPhase = (upper: boolean, n: number): number => (upper ? 300 : 400) + n;
/** The phase of hazard `k` on a floor (the crates, 0; then the trip lasers, sweepers, sliders, lines, gates and shutters, 1 to 6): each is placed from its own seed, because building the one before draws random numbers too. */
export const hazardPhase = (upper: boolean, k: number): number => (upper ? 100 : 150) + k;
export const phaseSeed = (seed: number, phase: number): number => (((seed >>> 0) ^ Math.imul(phase, 0x9e3779b1)) >>> 0) || 1;

export const TITLE_MAX = 60;
export const BRIEF_MAX = 200;
export const MAX_TWISTS = 2;
export const MAX_SEED = 0xffffffff;

type Range = readonly [number, number];

/**
 * The ranges. The size is the game's own cap (difficulty.ts's MAX_COLS and MAX_ROWS) down to the smallest floor with room for a
 * stair, a records room and a door; every count tops out at the most any job of the game uses (difficulty.ts across jobs 1 to 40:
 * guards 4, dogs 2, mines 2, drones 1, doors 2, lasers 3, lines 2, gates 3, sweepers 2, sliders 2, shutters 1, blackouts 2,
 * documents 4), except the alphas and heavies, which DESIGN.md allows two of. Per floor, except the documents.
 */
export const SPEC_LIMITS = {
  cols: [6, 14] as Range,
  rows: [5, 10] as Range,
  roster: {
    guards: [0, 4] as Range,
    watchdogs: [0, 2] as Range,
    crawlers: [0, 2] as Range,
    alphas: [0, 2] as Range,
    drones: [0, 1] as Range,
    heavies: [0, 2] as Range,
  },
  hazards: {
    doors: [0, 2] as Range,
    lasers: [0, 3] as Range,
    lines: [0, 2] as Range,
    gates: [0, 3] as Range,
    sweepers: [0, 2] as Range,
    sliders: [0, 2] as Range,
    shutters: [0, 1] as Range,
    blackouts: [0, 2] as Range,
  },
  documents: [1, 4] as Range,
} as const;

/** A legal spec that is also a calm one (job 2's settings): what every missing or unusable field falls back to. */
export function defaultSpec(): LevelSpec {
  return {
    version: 1,
    title: 'Untitled job',
    brief: 'Get in, take the files and get out.',
    place: 'campus',
    layout: 'halls',
    size: { cols: 10, rows: 8 },
    floors: 2,
    seed: 1,
    contract: 'records',
    twists: [],
    roster: { guards: 2, watchdogs: 0, crawlers: 0, alphas: 0, drones: 0, heavies: 0 },
    hazards: { doors: 1, lasers: 1, lines: 1, gates: 2, sweepers: 0, sliders: 0, shutters: 0, blackouts: 0 },
    loot: { documents: 2 },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Twist rules, mirrored from client/game/twists.ts (the client can't be imported from here).

/** twists.ts's fitsContract: a sabotage's fuse has to be outrun, and nobody outruns anything in a silent night. */
export function fitsContract(id: TwistId, contract: ContractId): boolean {
  return !(id === 'silent' && contract === 'sabotage');
}

/** twists.ts's CLASH: pairs that are unfair together. */
const CLASH: ReadonlyArray<readonly [TwistId, TwistId]> = [
  ['timer', 'lockdown'],
  ['lightkit', 'reinforcements'],
  ['timer', 'reinforcements'],
  ['silent', 'shiftchange'],
  ['silent', 'reinforcements'],
  ['silent', 'timer'],
];

/** twists.ts's mayShare: whether two twists may share a job. */
export const mayShare = (a: TwistId, b: TwistId): boolean => a !== b && !CLASH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** The floor's size under a silent night (twists.ts's SILENT_MAX_COLS and SILENT_MAX_ROWS): the pace is half, so the building shrinks to match. */
const SILENT_MAX_COLS = 10;
const SILENT_MAX_ROWS = 7;
/** twists.ts's SILENT_DOGS. */
const SILENT_DOGS = 2;

/** The size a spec's floors are built at: its own, or the silent night's smaller one. */
export function effectiveSize(spec: Pick<LevelSpec, 'size' | 'twists'>): { cols: number; rows: number } {
  const silent = spec.twists.includes('silent');
  return silent ? { cols: Math.min(spec.size.cols, SILENT_MAX_COLS), rows: Math.min(spec.size.rows, SILENT_MAX_ROWS) } : { ...spec.size };
}

/** A spec's per-floor roster once its twists are applied: twists.ts's applyTwists, plus game.ts's silent night (no guards, mines, alphas, drones or heavies; dogs only). */
export function twistedRoster(spec: Pick<LevelSpec, 'roster' | 'hazards' | 'twists'>): LevelSpec['roster'] & { blackouts: number } {
  let out = { ...spec.roster, blackouts: spec.hazards.blackouts };
  for (const id of spec.twists) {
    if (id === 'lightsout') out = { ...out, blackouts: out.blackouts + 2 };
    if (id === 'reinforcements') out = { ...out, guards: out.guards + 1, watchdogs: out.watchdogs + 1 };
    if (id === 'silent') out = { ...out, guards: 0, watchdogs: Math.max(out.watchdogs, SILENT_DOGS), heavies: 0, crawlers: 0, alphas: 0, drones: 0 };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading any JSON as a spec.

export type SpecProblem = {
  /** bad_field: a type, range or enum that is wrong, or a field that is missing or unknown; twist_misfit: a twist the contract (or the other twist) can't take. */
  code: 'bad_field' | 'twist_misfit';
  /** Dotted path of the field, e.g. `roster.guards`. */
  field: string;
  /** What was wrong and what was done about it. */
  message: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const describe = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'string' ? `"${v.length > 24 ? v.slice(0, 24) + '...' : v}"` : String(typeof v === 'object' ? 'an object' : v));

class Reader {
  readonly problems: SpecProblem[] = [];

  bad(field: string, message: string, code: SpecProblem['code'] = 'bad_field'): void {
    this.problems.push({ code, field, message });
  }

  /** The object at `key` of `src`, or an empty one (reported) when it is missing or not an object. */
  obj(src: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
    const v = src[key];
    if (isObj(v)) return v;
    this.bad(path, v === undefined ? `${path} is missing; using defaults` : `${path} must be an object, not ${describe(v)}; using defaults`);
    return {};
  }

  /** Reports any key of `src` that is not in `known`. */
  unknown(src: Record<string, unknown>, known: readonly string[], path: string): void {
    for (const k of Object.keys(src)) if (!known.includes(k)) this.bad(path ? `${path}.${k}` : k, `${path ? path + '.' : ''}${k} is not a field of a level spec; ignored`);
  }

  int(src: Record<string, unknown>, key: string, path: string, [lo, hi]: Range, fallback: number): number {
    const v = src[key];
    if (v === undefined) {
      this.bad(path, `${path} is missing; using ${fallback}`);
      return fallback;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.bad(path, `${path} must be a number, not ${describe(v)}; using ${fallback}`);
      return fallback;
    }
    const rounded = Math.round(v);
    const out = Math.min(hi, Math.max(lo, rounded));
    if (out !== v) this.bad(path, rounded !== v && out === rounded ? `${path} ${v} is not a whole number; rounded to ${out}` : `${path} ${v} is outside ${lo} to ${hi}; clamped to ${out}`);
    return out;
  }

  oneOf<T extends string>(src: Record<string, unknown>, key: string, path: string, ids: readonly T[], fallback: T): T {
    const v = src[key];
    if (v === undefined) {
      this.bad(path, `${path} is missing; using ${fallback}`);
      return fallback;
    }
    if (typeof v === 'string' && (ids as readonly string[]).includes(v)) return v as T;
    this.bad(path, `${path} must be one of ${ids.join(', ')}, not ${describe(v)}; using ${fallback}`);
    return fallback;
  }

  text(src: Record<string, unknown>, key: string, max: number, fallback: string): string {
    const v = src[key];
    if (typeof v !== 'string') {
      this.bad(key, v === undefined ? `${key} is missing; using "${fallback}"` : `${key} must be text, not ${describe(v)}; using "${fallback}"`);
      return fallback;
    }
    // eslint-disable-next-line no-control-regex
    const clean = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean === '') {
      this.bad(key, `${key} is empty; using "${fallback}"`);
      return fallback;
    }
    if (clean.length > max) {
      this.bad(key, `${key} is ${clean.length} characters; cut to ${max}`);
      return clean.slice(0, max).trimEnd();
    }
    if (clean !== v) this.bad(key, `${key} had stray whitespace or control characters; tidied`);
    return clean;
  }
}

/** Cells reachable from `from` over the grid's own openings, with their step counts (-1 for none). */
function gridDistances(cells: GridCell[], cols: number, rows: number, from: Pt): number[] {
  const dist = new Array<number>(cols * rows).fill(-1);
  dist[from.y * cols + from.x] = 0;
  const queue: Pt[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const { x, y } = queue[qi]!;
    const c = cells[y * cols + x]!;
    const next: Pt[] = [];
    if (c.n) next.push({ x, y: y - 1 });
    if (c.s) next.push({ x, y: y + 1 });
    if (c.e) next.push({ x: x + 1, y });
    if (c.w) next.push({ x: x - 1, y });
    for (const n of next) {
      if (n.x < 0 || n.y < 0 || n.x >= cols || n.y >= rows || dist[n.y * cols + n.x]! !== -1) continue;
      dist[n.y * cols + n.x] = dist[y * cols + x]! + 1;
      queue.push(n);
    }
  }
  return dist;
}

const inGrid = (p: unknown, cols: number, rows: number): p is Pt =>
  isObj(p) && typeof p.x === 'number' && typeof p.y === 'number' && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;

/** The sketch's grid, made legal, or null (reported) when it can't be: a size outside the game's, or not `cols * rows` cells. */
function readGrid(r: Reader, raw: unknown): SpecGrid | null {
  if (!isObj(raw)) {
    r.bad('grid', `grid must be an object, not ${describe(raw)}; dropped`);
    return null;
  }
  r.unknown(raw, ['cols', 'rows', 'cells', 'start', 'exit'], 'grid');
  const { cols, rows, cells: rawCells } = raw;
  const [cLo, cHi] = SPEC_LIMITS.cols;
  const [rLo, rHi] = SPEC_LIMITS.rows;
  if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < cLo || cols > cHi || rows < rLo || rows > rHi) {
    r.bad('grid', `grid size must be whole numbers ${cLo} to ${cHi} by ${rLo} to ${rHi}, not ${describe(cols)} by ${describe(rows)}; dropped`);
    return null;
  }
  if (!Array.isArray(rawCells) || rawCells.length !== cols * rows) {
    r.bad('grid.cells', `grid.cells must be ${cols * rows} cells (${cols} by ${rows}), not ${Array.isArray(rawCells) ? rawCells.length : describe(rawCells)}; grid dropped`);
    return null;
  }
  const cells: GridCell[] = rawCells.map((c) => {
    const o = isObj(c) ? c : {};
    return { n: o.n === true, s: o.s === true, e: o.e === true, w: o.w === true };
  });
  // A wall wins: an opening both cells don't agree on is closed, and none leads off the edge.
  let fixed = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y * cols + x]!;
      const was = [c.n, c.s, c.e, c.w];
      if (y === 0) c.n = false;
      if (y === rows - 1) c.s = false;
      if (x === 0) c.w = false;
      if (x === cols - 1) c.e = false;
      if (c.e) {
        const o = cells[y * cols + x + 1]!;
        if (!o.w) c.e = false;
      }
      if (c.s) {
        const o = cells[(y + 1) * cols + x]!;
        if (!o.n) c.s = false;
      }
      if (c.w && !cells[y * cols + x - 1]!.e) c.w = false;
      if (c.n && !cells[(y - 1) * cols + x]!.s) c.n = false;
      if ([c.n, c.s, c.e, c.w].some((v, i) => v !== was[i])) fixed++;
    }
  }
  if (fixed > 0) r.bad('grid.cells', `${fixed} cells had an opening the cell beside it did not share, or one off the edge; closed them`);
  // A floor is the cells with an opening; the rest are solid blocks (layouts.ts's utility cores). Fewer than a start and an exit's worth is no floor.
  const open = (p: Pt): boolean => {
    const c = cells[p.y * cols + p.x]!;
    return c.n || c.s || c.e || c.w;
  };
  const firstOpen = cells.findIndex((c) => c.n || c.s || c.e || c.w);
  if (cells.filter((c) => c.n || c.s || c.e || c.w).length < 2) {
    r.bad('grid.cells', 'grid.cells has fewer than two cells with an opening, so there is no floor to walk; grid dropped');
    return null;
  }
  // The start and the exit are on the floor: a lift cannot stand in a solid block.
  let start: Pt;
  if (inGrid(raw.start, cols, rows) && open(raw.start)) start = { x: raw.start.x, y: raw.start.y };
  else {
    start = { x: firstOpen % cols, y: Math.floor(firstOpen / cols) };
    r.bad('grid.start', `grid.start must be a cell of the grid with an opening; using ${start.x},${start.y}`);
  }
  let exit: Pt;
  if (inGrid(raw.exit, cols, rows) && open(raw.exit) && !(raw.exit.x === start.x && raw.exit.y === start.y)) exit = { x: raw.exit.x, y: raw.exit.y };
  else {
    // The farthest cell by walking, as the game picks its own exit.
    const dist = gridDistances(cells, cols, rows, start);
    let best = -1;
    exit = { x: start.x === cols - 1 ? 0 : cols - 1, y: start.y };
    for (let i = 0; i < dist.length; i++) {
      if (dist[i]! > best) {
        best = dist[i]!;
        exit = { x: i % cols, y: Math.floor(i / cols) };
      }
    }
    // (A start walled off from every other open cell has nowhere to walk to: any other open cell, for the verifier to report as unreachable.)
    if (exit.x === start.x && exit.y === start.y) {
      const other = cells.findIndex((c, i) => i !== start.y * cols + start.x && (c.n || c.s || c.e || c.w));
      exit = { x: other % cols, y: Math.floor(other / cols) };
    }
    r.bad('grid.exit', `grid.exit must be a cell of the grid with an opening, other than the start; using the farthest cell, ${exit.x},${exit.y}`);
  }
  return { cols, rows, cells, start, exit };
}

// ---------------------------------------------------------------------------------------------------------------------
// Closets for a sketch with no dead ends.

/** security.ts's ROOM_MIN_DIST: a room's pocket is at least this many steps from the start. */
const ROOM_MIN_STEPS = 3;
/** The most closets opened into a sketch's solid blocks (a sketch needs a handful, never a warren). */
export const MAX_ALCOVES = 6;

/**
 * The game puts its rooms (the records rooms, the uplink closet, the log server) in dead-end pockets, one opening each, and the floors it generates are full of them. A sketch
 * drawn as open rooms joined by door gaps has none, and a floor with no pocket has nowhere to put a file: the contract could not be played. So, for a spec with a grid whose dead
 * ends fall short of what it needs (its documents, on a records job, and the uplink and log server), this opens one-cell closets into its solid blocks, off the cells that are
 * already a corridor or a room (never the start, the exit or another dead end), spread as far from one another as the grid allows. A sketch that has enough is returned as it is.
 * The game and the verifier both read the grid through this, so what is verified is what is built. Pure.
 */
export function carveAlcoves(spec: Pick<LevelSpec, 'grid' | 'contract' | 'loot' | 'floors'>): { grid: SpecGrid | null; carved: Pt[] } {
  const grid = spec.grid;
  if (!grid) return { grid: null, carved: [] };
  const { cols, rows } = grid;
  const cells = grid.cells.map((c) => ({ ...c }));
  const at = (x: number, y: number): GridCell => cells[y * cols + x]!;
  const openings = (c: GridCell): number => (c.n ? 1 : 0) + (c.s ? 1 : 0) + (c.e ? 1 : 0) + (c.w ? 1 : 0);
  const want = (spec.contract === 'records' ? spec.loot.documents : 0) + 2;
  const isEnd = (x: number, y: number, dist: number[]): boolean => openings(at(x, y)) === 1 && !(x === grid.start.x && y === grid.start.y) && !(x === grid.exit.x && y === grid.exit.y) && dist[y * cols + x]! >= ROOM_MIN_STEPS;
  const carved: Pt[] = [];
  for (let n = 0; n < MAX_ALCOVES; n++) {
    const dist = gridDistances(cells, cols, rows, grid.start);
    const ends: Pt[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (isEnd(x, y, dist)) ends.push({ x, y });
    if (ends.length >= want) break;
    let best: { at: Pt; from: Pt; dir: 'n' | 's' | 'e' | 'w'; score: number } | null = null;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (openings(at(x, y)) !== 0) continue;
        for (const [dir, dx, dy] of [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]] as const) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
          const parent = at(px, py);
          const reach = dist[py * cols + px]!;
          // A passage or a room to open off (two or more openings already), reached from the start, far enough that the pocket is too, and not where the lift or the way out stand.
          if (openings(parent) < 2 || reach < ROOM_MIN_STEPS - 1 || (px === grid.start.x && py === grid.start.y) || (px === grid.exit.x && py === grid.exit.y)) continue;
          const score = Math.min(99, ...ends.map((e) => Math.abs(e.x - x) + Math.abs(e.y - y)));
          if (!best || score > best.score) best = { at: { x, y }, from: { x: px, y: py }, dir, score };
        }
      }
    }
    if (!best) break;
    const opposite = { n: 's', s: 'n', e: 'w', w: 'e' } as const;
    at(best.at.x, best.at.y)[best.dir] = true;
    at(best.from.x, best.from.y)[opposite[best.dir]] = true;
    carved.push(best.at);
  }
  // A second floor needs a way up: maze.ts's placeStair wants a straight cell (open on two opposite sides only) with a dead end past it to the east or south.
  if (spec.floors === 2 && !hasSpur(cells, cols, rows, grid)) {
    const dist = gridDistances(cells, cols, rows, grid.start);
    let best: { p: Pt; dir: 'e' | 's'; score: number } | null = null;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (openings(at(x, y)) < 2 || dist[y * cols + x]! < ROOM_MIN_STEPS - 1) continue;
        for (const [dir, dx, dy] of [['e', 1, 0], ['s', 0, 1]] as const) {
          const ax = x + dx;
          const ay = y + dy;
          const bx = ax + dx;
          const by = ay + dy;
          if (bx >= cols || by >= rows || openings(at(ax, ay)) !== 0 || openings(at(bx, by)) !== 0) continue;
          if ((ax === grid.exit.x && ay === grid.exit.y) || (bx === grid.exit.x && by === grid.exit.y)) continue;
          const score = dist[y * cols + x]!;
          if (!best || score > best.score) best = { p: { x, y }, dir, score };
        }
      }
    }
    if (best) {
      const [dx, dy] = best.dir === 'e' ? [1, 0] : [0, 1];
      const a = { x: best.p.x + dx, y: best.p.y + dy };
      const b = { x: a.x + dx, y: a.y + dy };
      const [out, back] = best.dir === 'e' ? (['e', 'w'] as const) : (['s', 'n'] as const);
      at(best.p.x, best.p.y)[out] = true;
      at(a.x, a.y)[back] = true;
      at(a.x, a.y)[out] = true;
      at(b.x, b.y)[back] = true;
      carved.push(a, b);
    }
  }
  return carved.length ? { grid: { ...grid, cells }, carved } : { grid, carved };
}

/** Whether maze.ts's placeStair could put a stair in these cells (one cell long): a straight cell, three or more steps from the start and not the exit, with a dead end next to it to the east or south. */
function hasSpur(cells: GridCell[], cols: number, rows: number, grid: SpecGrid): boolean {
  const dist = gridDistances(cells, cols, rows, grid.start);
  const count = (c: GridCell): number => (c.n ? 1 : 0) + (c.s ? 1 : 0) + (c.e ? 1 : 0) + (c.w ? 1 : 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y * cols + x]!;
      if (dist[y * cols + x]! < 3 || (x === grid.start.x && y === grid.start.y) || (x === grid.exit.x && y === grid.exit.y)) continue;
      const ns = c.n && c.s && !c.e && !c.w;
      const ew = c.e && c.w && !c.n && !c.s;
      if (!ns && !ew) continue;
      const fx = ns ? x : x + 1;
      const fy = ns ? y + 1 : y;
      if (fx >= cols || fy >= rows || (fx === grid.exit.x && fy === grid.exit.y)) continue;
      if (count(cells[fy * cols + fx]!) === 1) return true;
    }
  }
  return false;
}

const TOP_KEYS = ['version', 'title', 'brief', 'place', 'layout', 'size', 'floors', 'seed', 'contract', 'twists', 'roster', 'hazards', 'loot', 'grid'] as const;

/**
 * Reads `raw` (anything JSON.parse can give) as a spec: a legal one always, and every place it had to change something, in the order the fields come.
 * Never throws. Fields the sketch gives win over the size.
 */
export function inspectSpec(raw: unknown): { spec: LevelSpec; problems: SpecProblem[] } {
  const r = new Reader();
  const d = defaultSpec();
  if (!isObj(raw)) {
    r.bad('', `a level spec is an object, not ${describe(raw)}; using the default spec`);
    return { spec: d, problems: r.problems };
  }
  r.unknown(raw, TOP_KEYS, '');
  if (raw.version !== 1) r.bad('version', raw.version === undefined ? 'version is missing; using 1' : `version must be 1, not ${describe(raw.version)}; using 1`);
  const title = r.text(raw, 'title', TITLE_MAX, d.title);
  const brief = r.text(raw, 'brief', BRIEF_MAX, d.brief);
  const place = r.oneOf(raw, 'place', 'place', PLACE_IDS, d.place);
  const layout = r.oneOf(raw, 'layout', 'layout', LAYOUT_IDS, d.layout);
  const sizeSrc = r.obj(raw, 'size', 'size');
  r.unknown(sizeSrc, ['cols', 'rows'], 'size');
  let cols = r.int(sizeSrc, 'cols', 'size.cols', SPEC_LIMITS.cols, d.size.cols);
  let rows = r.int(sizeSrc, 'rows', 'size.rows', SPEC_LIMITS.rows, d.size.rows);
  const floors = r.int(raw, 'floors', 'floors', [1, 2], d.floors) as 1 | 2;
  const seed = r.int(raw, 'seed', 'seed', [0, MAX_SEED], d.seed);
  const contract = r.oneOf(raw, 'contract', 'contract', CONTRACT_IDS, d.contract);

  // Twists: known, distinct, at most two, fitting the contract and each other. A twist that doesn't is dropped, never swapped for another.
  const twists: TwistId[] = [];
  const rawTwists = raw.twists;
  if (rawTwists === undefined) r.bad('twists', 'twists is missing; using none');
  else if (!Array.isArray(rawTwists)) r.bad('twists', `twists must be a list, not ${describe(rawTwists)}; using none`);
  else {
    for (const t of rawTwists) {
      if (typeof t !== 'string' || !(TWIST_IDS as readonly string[]).includes(t)) r.bad('twists', `twists has ${describe(t)}, which is not a twist (${TWIST_IDS.join(', ')}); dropped`);
      else if (twists.includes(t as TwistId)) r.bad('twists', `twists names ${t} twice; kept once`);
      else if (!fitsContract(t as TwistId, contract)) r.bad('twists', `the twist ${t} does not fit the ${contract} contract; dropped`, 'twist_misfit');
      else if (twists.length >= MAX_TWISTS) r.bad('twists', `twists holds at most ${MAX_TWISTS}; dropped ${t}`);
      else if (twists.some((o) => !mayShare(o, t as TwistId))) r.bad('twists', `the twists ${twists.join(', ')} and ${t} are unfair together; dropped ${t}`, 'twist_misfit');
      else twists.push(t as TwistId);
    }
  }

  const rosterSrc = r.obj(raw, 'roster', 'roster');
  r.unknown(rosterSrc, Object.keys(SPEC_LIMITS.roster), 'roster');
  const roster = { ...d.roster };
  for (const k of Object.keys(roster) as Array<keyof typeof roster>) roster[k] = r.int(rosterSrc, k, `roster.${k}`, SPEC_LIMITS.roster[k], d.roster[k]);
  const hazardSrc = r.obj(raw, 'hazards', 'hazards');
  r.unknown(hazardSrc, Object.keys(SPEC_LIMITS.hazards), 'hazards');
  const hazards = { ...d.hazards };
  for (const k of Object.keys(hazards) as Array<keyof typeof hazards>) hazards[k] = r.int(hazardSrc, k, `hazards.${k}`, SPEC_LIMITS.hazards[k], d.hazards[k]);
  const lootSrc = r.obj(raw, 'loot', 'loot');
  r.unknown(lootSrc, ['documents'], 'loot');
  const documents = r.int(lootSrc, 'documents', 'loot.documents', SPEC_LIMITS.documents, d.loot.documents);

  const spec: LevelSpec = { version: 1, title, brief, place, layout, size: { cols, rows }, floors, seed, contract, twists, roster, hazards, loot: { documents } };
  if (raw.grid !== undefined) {
    const grid = readGrid(r, raw.grid);
    if (grid) {
      if (grid.cols !== cols || grid.rows !== rows) r.bad('size', `size ${cols} by ${rows} does not match the grid's ${grid.cols} by ${grid.rows}; using the grid's`);
      cols = grid.cols;
      rows = grid.rows;
      spec.size = { cols, rows };
      spec.grid = grid;
    }
  }
  return { spec, problems: r.problems };
}

/** A legal spec from anything, and what changed to make it one. Never throws. */
export function clampSpec(raw: unknown): { spec: LevelSpec; changes: string[] } {
  const { spec, problems } = inspectSpec(raw);
  return { spec, changes: problems.map((p) => p.message) };
}

export type ParseResult = { ok: true; spec: LevelSpec; changes: string[] } | { ok: false; error: string };

/** A spec from a model's text: bare JSON, JSON in a code fence, or JSON with prose round it. Never throws. */
export function parseSpec(text: string): ParseResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'the reply is empty' };
  let body = text.trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(body);
  if (fence) body = fence[1]!.trim();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    const from = body.indexOf('{');
    const to = body.lastIndexOf('}');
    if (from === -1 || to <= from) return { ok: false, error: 'the reply holds no JSON object' };
    try {
      value = JSON.parse(body.slice(from, to + 1));
    } catch (e) {
      return { ok: false, error: `the reply is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
    }
  }
  if (!isObj(value)) return { ok: false, error: 'the reply is JSON but not an object' };
  const { spec, changes } = clampSpec(value);
  return { ok: true, spec, changes };
}

// ---------------------------------------------------------------------------------------------------------------------
// The schema a model is held to (structured output): flat, no recursion, three levels deep, every field required, no extra fields.

type Schema = Record<string, unknown>;
const integer = ([lo, hi]: Range): Schema => ({ type: 'integer', minimum: lo, maximum: hi });
const counts = (limits: Record<string, Range>): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(limits),
  properties: Object.fromEntries(Object.entries(limits).map(([k, range]) => [k, integer(range)])),
});

/**
 * The JSON Schema of a LevelSpec for the model's structured output. It leaves out `grid`: a model designs a level, it does not draw walls (those come from a
 * photo, through scan.ts); a grid in a reply is still read, by clampSpec.
 */
export const LEVEL_SPEC_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'title', 'brief', 'place', 'layout', 'size', 'floors', 'seed', 'contract', 'twists', 'roster', 'hazards', 'loot'],
  properties: {
    version: { type: 'integer', enum: [1] },
    title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
    brief: { type: 'string', minLength: 1, maxLength: BRIEF_MAX },
    place: { type: 'string', enum: [...PLACE_IDS] },
    layout: { type: 'string', enum: [...LAYOUT_IDS] },
    size: counts({ cols: SPEC_LIMITS.cols, rows: SPEC_LIMITS.rows }),
    floors: { type: 'integer', enum: [1, 2] },
    seed: integer([0, MAX_SEED]),
    contract: { type: 'string', enum: [...CONTRACT_IDS] },
    twists: { type: 'array', maxItems: MAX_TWISTS, items: { type: 'string', enum: [...TWIST_IDS] } },
    roster: counts(SPEC_LIMITS.roster),
    hazards: counts(SPEC_LIMITS.hazards),
    loot: counts({ documents: SPEC_LIMITS.documents }),
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Onto a job's settings.

/** The fields of difficulty.ts's Difficulty a spec sets, or reads to set the others. */
export type SpecDifficulty = {
  cols: number;
  rows: number;
  floors: 1 | 2;
  guards: number;
  watchdogs: number;
  crawlers: number;
  alphas: number;
  drones: number;
  heavies: number;
  doors: number;
  chainedDoors: boolean;
  lasers: number;
  lines: number;
  gates: number;
  sweepers: number;
  sliders: number;
  fastSliders: number;
  shutters: number;
  documents: number;
  blackouts: number;
};

/**
 * `base` (a job's Difficulty, from difficultyFor) with the spec's size, floors, roster, hazards and loot laid over it. What the spec has no word for stays the
 * base's: the line beams' group size, how many curtains run fast (never more than there are curtains), the blackouts' reach, the kit, the enemies' sharpness, and
 * whether the doors chain (only with two doors to chain). The twists are not applied here: the game applies them to this, as it does to any job's.
 */
export function specToDifficulty<D extends SpecDifficulty>(spec: LevelSpec, base: D): D {
  return {
    ...base,
    cols: spec.size.cols,
    rows: spec.size.rows,
    floors: spec.floors,
    ...spec.roster,
    doors: spec.hazards.doors,
    chainedDoors: base.chainedDoors && spec.hazards.doors >= 2,
    lasers: spec.hazards.lasers,
    lines: spec.hazards.lines,
    gates: spec.hazards.gates,
    sweepers: spec.hazards.sweepers,
    sliders: spec.hazards.sliders,
    fastSliders: Math.min(base.fastSliders, spec.hazards.sliders),
    shutters: spec.hazards.shutters,
    blackouts: spec.hazards.blackouts,
    documents: spec.loot.documents,
  };
}
