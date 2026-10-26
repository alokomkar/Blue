// The verifier: layers V1 to V3 of docs/DESIGN.md section 2, pure functions over a spec and a built floor, so the Director's repair loop can run them on a
// server with no browser. Each returns `{ ok, failures }`, a failure carrying a code the model can act on, a sentence saying what is wrong, and where.
//
//   V1 schema     bad_field, twist_misfit                                    checkSpec: types, ranges, enums, twists that fit
//   V2 grid       unreachable, exit_close, mostly_dead_ends                  checkGrid: the floor's walls, from the start to the exit
//   V3 placement  spawn_close, blocked_exit, station_unreachable             checkPlacement: where the enemies, lasers, doors and rooms landed
//
// V2 and V3 read a VerifyFloor (below), plain data, so a hand-built floor tests them and the game's own placement fills one in (floorbuild.ts). V4, a scripted
// autopilot, needs the running game and is not here; its codes are in the type for the client to use. Pure, so it's unit-tested under Node.

import { inspectSpec, type Pt } from './levelspec.ts';

export type FailureCode =
  | 'bad_field'
  | 'twist_misfit'
  | 'unreachable'
  | 'exit_close'
  | 'mostly_dead_ends'
  | 'spawn_close'
  | 'blocked_exit'
  | 'station_unreachable'
  | 'autopilot_stuck'
  | 'timeout';

export type Failure = { code: FailureCode; message: string; where?: { x: number; y: number; floor: number } };
export type VerifyResult = { ok: boolean; failures: Failure[] };

const result = (failures: Failure[]): VerifyResult => ({ ok: failures.length === 0, failures });

/** One cell's openings, as the game's own maze.ts has them. */
export type Cell = { N: boolean; S: boolean; E: boolean; W: boolean };
export type Dir = 'N' | 'S' | 'E' | 'W';

export type EnemyKind = 'guard' | 'watchdog' | 'crawler' | 'alpha' | 'drone';
export type HazardKind = 'line' | 'gate' | 'sweeper' | 'slider' | 'shutter';

/** A station the level makes the agent reach: a room (storage, terminal, server, uplink, logs) or the big room a contract's steps go in (landmark, when the plan has one: a step with none goes against a wall). `keyId` is the door a terminal or server belongs to. */
export type Station = Pt & { kind: string; keyId?: number | null };

/** What a floor's placement was asked for, so a floor that came up short can be told from one that was never asked. */
export type Expect = {
  /** Records rooms wanted on this floor (documents, for the records contract); more than none means at least one has to be placed. */
  storage: number;
  /** Whether the floor is meant to hold the stair up. */
  stair: boolean;
};

export type VerifyFloor = {
  /** 0 is the ground floor. */
  floor: number;
  cols: number;
  rows: number;
  cells: Cell[][];
  /** Where the agent comes in (the lift or door on the ground floor, the stair's landing above). */
  start: Pt;
  /** The way out, on the ground floor; none on the floor above. */
  exit: Pt | null;
  /** The way up, on a ground floor with a floor above it. */
  stair: Pt | null;
  /** Everything that starts out walking, hunting, rolling or flying. (Sentries and heavies stand at a room's door and are not here: a post is where its room is.) */
  guards: Array<Pt & { kind: EnemyKind }>;
  /** The trip lasers: a beam across a corridor, which a cloak crosses and nothing else does. */
  lasers: Pt[];
  /** Every other laser or shutter, by the cell it sits in (a curtain's every cell). */
  hazards: Array<Pt & { kind: HazardKind }>;
  /** The locked doors: from (x, y), through `dir`. */
  doors: Array<Pt & { id: number; dir: Dir }>;
  stations: Station[];
  expect?: Expect;
};

export type VerifyOptions = {
  /** The shortest walk from the start to the exit, in steps. */
  minExitSteps?: number;
  /** The most the longest dead-end corridor may hold, as a share of the floor's cells. */
  maxDeadEndShare?: number;
  /** How near the start (in steps) an enemy may begin. Left out, it is the game's own rule (maze.ts's placeBotSpawn): eight, less on a floor too small for it, never under five. */
  minSpawnSteps?: number;
  /** How many trip lasers every way to the exit may cross (a cloak crosses any of them, and recharges). Left out, one. The design's own rule, none, fails seven floors in ten that have a single laser, since the lasers go on the long straight corridors the way out is made of. */
  laserCrossings?: number;
};

/** DESIGN.md's V2 and V3 numbers. */
export const MIN_EXIT_STEPS = 12;
export const MAX_DEAD_END_SHARE = 0.4;
/** maze.ts's SPAWN_MIN_CELLS and the floor under it (placeBotSpawn's SPAWN_FLOOR_CELLS), mirrored. */
export const SPAWN_MIN_STEPS = 8;
const SPAWN_FLOOR_STEPS = 5;

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DIRS: Dir[] = ['N', 'S', 'E', 'W'];
const key = (x: number, y: number): string => `${x},${y}`;

/** V1: the spec's types, ranges, enums and twists, strictly: anything the clamp would have to change is a failure here (the model is told, rather than quietly fixed). */
export function checkSpec(raw: unknown): VerifyResult {
  return result(inspectSpec(raw).problems.map((p) => ({ code: p.code, message: p.message })));
}

/** The cells of `f` with at least one opening: the rest are solid blocks, walled in on all sides like a utility core (layouts.ts), and nothing is meant to reach them. */
const isFloor = (f: VerifyFloor, x: number, y: number): boolean => {
  const c = f.cells[y]?.[x];
  return !!c && (c.N || c.S || c.E || c.W);
};

/** Whether the passage from (x, y) through `dir` is open and leads to a cell of the floor. */
function passage(f: VerifyFloor, x: number, y: number, dir: Dir): Pt | null {
  const c = f.cells[y]?.[x];
  if (!c?.[dir]) return null;
  const nx = x + DELTA[dir][0];
  const ny = y + DELTA[dir][1];
  return nx >= 0 && ny >= 0 && nx < f.cols && ny < f.rows ? { x: nx, y: ny } : null;
}

/** Steps from `from` to every cell, over open passages (-1 where there is no way), skipping any passage `shut` says is closed. */
function steps(f: VerifyFloor, from: Pt, shut: (x: number, y: number, dir: Dir) => boolean = () => false): number[][] {
  const dist = Array.from({ length: f.rows }, () => new Array<number>(f.cols).fill(-1));
  if (from.x < 0 || from.y < 0 || from.x >= f.cols || from.y >= f.rows) return dist;
  dist[from.y]![from.x] = 0;
  const queue: Pt[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const { x, y } = queue[qi]!;
    for (const dir of DIRS) {
      const n = passage(f, x, y, dir);
      if (!n || shut(x, y, dir) || dist[n.y]![n.x]! !== -1) continue;
      dist[n.y]![n.x] = dist[y]![x]! + 1;
      queue.push(n);
    }
  }
  return dist;
}

const at = (f: VerifyFloor, p: Pt) => ({ x: p.x, y: p.y, floor: f.floor });
const farthest = (dist: number[][]): number => Math.max(0, ...dist.map((row) => Math.max(...row)));

/**
 * The longest dead-end corridor: from a cell with one way out (other than the start and the exit), back along cells with two to the first junction. A pocket of
 * rooms and halls is made of short ones; a floor that is mostly one long cul-de-sac has a long one. A chain that runs into the start or the exit is the way
 * through, not a dead end, and doesn't count.
 */
function longestDeadEnd(f: VerifyFloor): { size: number; at: Pt } {
  const open = (p: Pt): Pt[] => DIRS.flatMap((d) => passage(f, p.x, p.y, d) ?? []);
  const special = new Set([key(f.start.x, f.start.y), ...(f.exit ? [key(f.exit.x, f.exit.y)] : [])]);
  let best = { size: 0, at: f.start };
  for (let y = 0; y < f.rows; y++) {
    for (let x = 0; x < f.cols; x++) {
      if (special.has(key(x, y)) || open({ x, y }).length !== 1) continue;
      let prev: Pt = { x, y };
      let cur = open(prev)[0]!;
      let size = 1;
      let through = false;
      for (;;) {
        if (special.has(key(cur.x, cur.y))) {
          through = true;
          break;
        }
        const next = open(cur);
        if (next.length !== 2) break;
        size++;
        const after = next.find((n) => n.x !== prev.x || n.y !== prev.y)!;
        prev = cur;
        cur = after;
      }
      if (!through && size > best.size) best = { size, at: { x, y } };
    }
  }
  return best;
}

/** V2: the floor itself. Every cell that is floor can be reached from the start, the exit is a real walk away, and no one dead-end corridor is most of the building. */
export function checkGrid(floors: readonly VerifyFloor[], opts: VerifyOptions = {}): VerifyResult {
  const minExit = opts.minExitSteps ?? MIN_EXIT_STEPS;
  const maxShare = opts.maxDeadEndShare ?? MAX_DEAD_END_SHARE;
  const failures: Failure[] = [];
  for (const f of floors) {
    const dist = steps(f, f.start);
    const lost: Pt[] = [];
    for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.cols; x++) if (isFloor(f, x, y) && dist[y]![x]! < 0) lost.push({ x, y });
    if (!isFloor(f, f.start.x, f.start.y)) failures.push({ code: 'unreachable', message: `the start (${f.start.x},${f.start.y}) on floor ${f.floor} is walled in on every side`, where: at(f, f.start) });
    else if (lost.length) failures.push({ code: 'unreachable', message: `${lost.length} cell${lost.length === 1 ? '' : 's'} on floor ${f.floor} cannot be reached from the start, the first at (${lost[0]!.x},${lost[0]!.y})`, where: at(f, lost[0]!) });
    if (!f.exit) continue;
    const toExit = dist[f.exit.y]?.[f.exit.x] ?? -1;
    if (toExit < 0) {
      failures.push({ code: 'unreachable', message: `the exit (${f.exit.x},${f.exit.y}) on floor ${f.floor} cannot be reached from the start`, where: at(f, f.exit) });
      continue;
    }
    if (toExit < minExit) failures.push({ code: 'exit_close', message: `the exit is ${toExit} steps from the start on floor ${f.floor}; it must be at least ${minExit}`, where: at(f, f.exit) });
    const total = f.cells.reduce((n, row, y) => n + row.filter((_, x) => isFloor(f, x, y)).length, 0);
    const dead = longestDeadEnd(f);
    if (total > 0 && dead.size / total > maxShare) {
      failures.push({ code: 'mostly_dead_ends', message: `the dead-end corridor from (${dead.at.x},${dead.at.y}) on floor ${f.floor} holds ${dead.size} of the floor's ${total} cells (${Math.round((100 * dead.size) / total)}%, over ${Math.round(100 * maxShare)}%)`, where: at(f, dead.at) });
    }
  }
  return result(failures);
}

/** The fewest trip lasers on any walk from the start to `to`, and the first laser of one such walk. */
function fewestLasers(f: VerifyFloor, to: Pt): { count: number; first: Pt | null } {
  const laser = new Set(f.lasers.map((l) => key(l.x, l.y)));
  const best = new Map<string, number>([[key(f.start.x, f.start.y), laser.has(key(f.start.x, f.start.y)) ? 1 : 0]]);
  const from = new Map<string, Pt>();
  // 0-1 breadth-first: stepping onto a laser costs one.
  const deque: Pt[] = [f.start];
  while (deque.length) {
    const cur = deque.shift()!;
    const here = best.get(key(cur.x, cur.y))!;
    for (const d of DIRS) {
      const n = passage(f, cur.x, cur.y, d);
      if (!n) continue;
      const cost = here + (laser.has(key(n.x, n.y)) ? 1 : 0);
      if (cost >= (best.get(key(n.x, n.y)) ?? Infinity)) continue;
      best.set(key(n.x, n.y), cost);
      from.set(key(n.x, n.y), cur);
      if (cost === here) deque.unshift(n);
      else deque.push(n);
    }
  }
  const count = best.get(key(to.x, to.y));
  if (count === undefined) return { count: Infinity, first: null };
  let first: Pt | null = null;
  for (let cur: Pt | undefined = to; cur; cur = from.get(key(cur.x, cur.y))) if (laser.has(key(cur.x, cur.y))) first = cur;
  return { count, first };
}

/** Which rooms' cells can be reached once the doors are opened as the game does: a door opens when its terminal and its server can be reached, in any order. */
function reachWithDoors(f: VerifyFloor): { dist: number[][]; stuck: number[] } {
  const closed = new Set<number>(f.doors.map((d) => d.id));
  const shutAt = (x: number, y: number, dir: Dir): boolean =>
    f.doors.some((d) => closed.has(d.id) && ((d.x === x && d.y === y && d.dir === dir) || (d.x + DELTA[d.dir][0] === x && d.y + DELTA[d.dir][1] === y && d.x === x + DELTA[dir][0] && d.y === y + DELTA[dir][1])));
  for (;;) {
    const dist = steps(f, f.start, shutAt);
    const opened = [...closed].filter((id) => {
      const controls = f.stations.filter((s) => s.keyId === id && (s.kind === 'terminal' || s.kind === 'server'));
      return controls.some((s) => s.kind === 'terminal') && controls.some((s) => s.kind === 'server') && controls.every((s) => (dist[s.y]?.[s.x] ?? -1) >= 0);
    });
    if (!opened.length) return { dist, stuck: [...closed] };
    for (const id of opened) closed.delete(id);
  }
}

/** V3: where things landed. Nothing hunts the agent at the start, no hazard sits on the start or the exit, the way out is not shut by a laser, and every station can be reached. */
export function checkPlacement(floors: readonly VerifyFloor[], opts: VerifyOptions = {}): VerifyResult {
  const failures: Failure[] = [];
  const allowed = opts.laserCrossings ?? 1;
  for (const f of floors) {
    const dist = steps(f, f.start);
    // The game's own lead (maze.ts): eight steps, or on a floor too small for that 55% of its farthest cell, never under five.
    const need = opts.minSpawnSteps ?? Math.min(SPAWN_MIN_STEPS, Math.max(SPAWN_FLOOR_STEPS, Math.floor(farthest(dist) * 0.55)));
    for (const g of f.guards) {
      const d = dist[g.y]?.[g.x] ?? -1;
      if (d >= 0 && d < need) failures.push({ code: 'spawn_close', message: `a ${g.kind} starts ${d} steps from the start on floor ${f.floor}; it must be at least ${need}`, where: at(f, g) });
    }
    const hazardsAt = (p: Pt): string[] => [...f.lasers.filter((l) => l.x === p.x && l.y === p.y).map(() => 'laser'), ...f.hazards.filter((h) => h.x === p.x && h.y === p.y).map((h) => h.kind), ...f.doors.filter((d) => d.x === p.x && d.y === p.y).map(() => 'door')];
    const onStart = hazardsAt(f.start);
    if (onStart.length) failures.push({ code: 'spawn_close', message: `a ${onStart[0]} sits on the start cell of floor ${f.floor}`, where: at(f, f.start) });
    if (f.exit) {
      const onExit = hazardsAt(f.exit);
      if (onExit.length) failures.push({ code: 'blocked_exit', message: `a ${onExit[0]} sits on the exit cell of floor ${f.floor}`, where: at(f, f.exit) });
      if ((dist[f.exit.y]?.[f.exit.x] ?? -1) >= 0) {
        const { count, first } = fewestLasers(f, f.exit);
        if (count > allowed && first) failures.push({ code: 'blocked_exit', message: `every way from the start to the exit on floor ${f.floor} crosses ${count} trip laser${count === 1 ? '' : 's'} (the first at (${first.x},${first.y})); at most ${allowed} may`, where: at(f, first) });
      }
    }
    const want = f.expect;
    if (want?.stair && !f.stair) failures.push({ code: 'station_unreachable', message: `no stair up could be placed on floor ${f.floor}`, where: at(f, f.start) });
    if (want && want.storage > 0 && !f.stations.some((s) => s.kind === 'storage')) failures.push({ code: 'station_unreachable', message: `no records room could be placed on floor ${f.floor}, which was to hold ${want.storage} document${want.storage === 1 ? '' : 's'}`, where: at(f, f.start) });
    const { dist: open, stuck } = reachWithDoors(f);
    for (const id of stuck) {
      const door = f.doors.find((d) => d.id === id)!;
      failures.push({ code: 'station_unreachable', message: `door ${String.fromCharCode(65 + id)} on floor ${f.floor} cannot be opened: its terminal and its server are not both reachable without it`, where: at(f, door) });
    }
    const targets: Array<Pt & { kind: string }> = [...f.stations, ...(f.stair ? [{ ...f.stair, kind: 'stair' }] : []), ...(f.exit ? [{ ...f.exit, kind: 'exit' }] : [])];
    for (const s of targets) {
      if ((open[s.y]?.[s.x] ?? -1) < 0) failures.push({ code: 'station_unreachable', message: `the ${s.kind} at (${s.x},${s.y}) on floor ${f.floor} cannot be reached`, where: at(f, s) });
    }
  }
  return result(failures);
}

/** V2 then V3 on every floor, in one report. */
export function checkFloors(floors: readonly VerifyFloor[], opts: VerifyOptions = {}): VerifyResult {
  return result([...checkGrid(floors, opts).failures, ...checkPlacement(floors, opts).failures]);
}
