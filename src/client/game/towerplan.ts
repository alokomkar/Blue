// The towers' plans: the entry level where the agent works up through four storeys to the heist door (docs/ideas/tower-prototype.md), as data. Each maze level's place has its own tower with
// its own plan (a footprint, four floors of different shapes, where the stairs, lifts, bridge, rooms and doors go): the campus's is drawn by hand, the other five are laid out by `solve`
// from four floor shapes and a few choices, and every plan is held to the same rules (`validatePlan`, and the tests).
//
//   0 Lobby    the street door; the grand stair(s) to the next floor
//   1 Mezzanine the first floor up, with the security room (its cameras and console) and the climb to the next
//   2 Gallery  a floor in two sections joined by a bridge across the void, a service lift and its keycard, the timed stair up (its console), and the lasers
//   3 Top      the keycard doors of the back offices, the service lift's corridor, the dogs and the heist door in the south wall
//
// North is row 0. Every storey is drawn as a plain hall; what is not floor (a void, a stair's footprint, a lift cab) is left out of the floor, closed to the guards' paths, and ringed with a
// balustrade where someone could walk off it. Pure, so it is unit-tested under Node; tower.ts builds the scene from it. The active plan is chosen with `selectTowerPlan` (the constants below
// are live: they change with it).

import type { Sweeper, Slider } from './movingLasers';
import type { Gate } from './evade';
import type { LineLaser } from './linelasers';
import type { CameraPlan } from './cameras';
import type { Piece, TowerSetId } from './towerfurniture';

export type TowerLevel = { name: string; /** Which floor look it takes (tower.ts's themes). */ look: 'lobby' | 'balcony' | 'gallery' | 'offices' };
export const TOWER_LEVELS: readonly TowerLevel[] = [
  { name: 'Lobby', look: 'lobby' },
  { name: 'Balcony', look: 'balcony' },
  { name: 'Gallery', look: 'gallery' },
  { name: 'Offices', look: 'offices' },
];
export const LOBBY = 0;
export const OFFICES = TOWER_LEVELS.length - 1;

/**
 * A flight of stairs in the hall. It runs along z (north to south) over `run` cells from row `y`, `width` cells wide from column `x`. `fromLevel` is the storey at its
 * north end, `toLevel` the storey at its south end: the two differ by one, in either direction.
 */
export type TowerStair = { id: string; x: number; y: number; run: number; width: number; fromLevel: number; toLevel: number; /** Folded away until a console lowers it, for `STAIR_OPEN_S` seconds. */ timed?: boolean; /** No flight at all: a tall wall at the upper end of its footprint, to be climbed (highwall.ts) to a ledge on the storey above and pulled over. */ climb?: boolean };

/** How long the core stair stays down once its console has lowered it. */
export const STAIR_OPEN_S = 40;

/** The storeys a stair joins, lower first. */
export const stairLow = (s: TowerStair): number => Math.min(s.fromLevel, s.toLevel);
export const stairHigh = (s: TowerStair): number => Math.max(s.fromLevel, s.toLevel);
const touches = (s: TowerStair, level: number): boolean => s.fromLevel === level || s.toLevel === level;

/** The cells a stair stands on. */
export function stairCells(s: TowerStair): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = s.y; y < s.y + s.run; y++) for (let x = s.x; x < s.x + s.width; x++) out.push({ x, y });
  return out;
}

/** A lift: a cab in this cell on every storey it serves, its doors opening `opens` (north or south) into the storey. A locked one wants the keycard. */
export type TowerLift = { id: string; x: number; y: number; opens: 'N' | 'S'; serves: readonly number[]; locked: boolean };
/** The cell in front of a lift's doors. */
export const liftFront = (l: TowerLift): { x: number; y: number } => ({ x: l.x, y: l.y + (l.opens === 'N' ? -1 : 1) });

/** Interior walls of a storey: the edge on the north (N) or west (W) side of a cell. */
export type TowerWall = { x: number; y: number; dir: 'N' | 'W' };
/** A keycard on a storey: its cell. */
export type TowerCard = { level: number; x: number; y: number };
/** A gap left in a partition wall: the edge (as a wall's) a walker passes through between two sections. */
export type TowerDoorway = { level: number; x: number; y: number; dir: 'N' | 'W' };

/**
 * A thin bridge across a void: a deck 1.2 m wide along row `y` of `level` from the landing cell `fromX` to the landing cell `toX`, over the cells between them. It is too low to walk
 * (an agent lying flat crawls it), has no cover, and is in plain sight of the hall below and both wings.
 */
export type TowerBridge = { level: number; y: number; fromX: number; toX: number; width: number };

type Cell = { x: number; y: number };
/** A guard on a round: it starts at the first cell and walks them in order, round and round. */
export type TowerPatrol = { level: number; route: Cell[] };
/** A guard who holds a post, facing `facing` (0 is south, as everywhere in the game; a half turn is north, a quarter east). */
export type TowerPost = { level: number; x: number; y: number; facing: number };
export type TowerDog = { level: number; x: number; y: number };
/** A pylon: a free-standing double-height wall across a cell of the lobby, under the openings above (nothing overhead for six metres), with a camera's panel at its top: climb it (highwall.ts) to the top shelf to switch that camera off. */
export type TowerPylon = { level: number; x: number; y: number };

/** Grapple points: a ring on the balustrade where the line can be hooked from the storey below, to haul the agent up to hang from that ledge. `x, z` is on the rail's line, world metres. */

/** A balustrade along one edge of a cell on a storey: `dir` is the side of the cell it stands on. */
export type TowerRail = { level: number; x: number; y: number; dir: 'N' | 'S' | 'E' | 'W' };

type Open = { N: boolean; S: boolean; E: boolean; W: boolean };

/** Everything a plan is. */
export type TowerPlanData = {
  id: TowerSetId;
  cols: number;
  rows: number;
  /** The four floors' shapes: `#` floor, `.` nothing. */
  floors: readonly [string[], string[], string[], string[]];
  /** The street door's cell on the lobby, and the way out's. */
  start: Cell;
  exit: Cell;
  stairs: TowerStair[];
  lifts: TowerLift[];
  /** The gallery's keycard cell (the one that also opens the service lift and the back offices' doors). */
  keycard: { level: number; x: number; y: number };
  /** One keycard on each storey (the gallery's among them): the heist door wants all of them. */
  cards: TowerCard[];
  /** What this layout was generated from (0: the default): the same seed gives the same tower. */
  seed: number;
  /** The heist door: the top floor's cell in the south row, and the passage beyond it (the lift cab's cell). */
  heist: Cell;
  heistLift: Cell;
  walls: Record<number, TowerWall[]>;
  /** The gaps in the partition walls (which divide each storey into sections, each with its own guards, dog and camera). */
  doorways: TowerDoorway[];
  /** Lanes nobody walks, because the fixed furniture stands in them (the reception desk): shut in the play cells, drawn open. */
  shut: Array<{ level: number; x: number; y: number; dir: 'N' | 'S' | 'E' | 'W' }>;
  bridges: TowerBridge[];
  lasers: Record<number, { sweepers: Sweeper[]; sliders: Slider[]; gates: Gate[]; /** Line lasers (linelasers.ts) across a doorway in a partition wall. */ lines?: LineLaser[] }>;
  patrols: TowerPatrol[];
  posts: TowerPost[];
  dogs: TowerDog[];
  /** Alpha units (enemies/alpha.ts), one on each storey: each roams a section of its own and, on the agent's storey, hunts them by ear and by scent. */
  alphas: TowerDog[];
  pylons: TowerPylon[];
  cameras: CameraPlan[];
  /** The security room's cells (on the first floor up). */
  security: { level: number; cells: Cell[] };
  officeDoors: Array<{ level: number; x: number; y: number }>;
  /** A bonus on the middle of the bridge's deck (world metres): taken by whoever is out there. */
  bridgeBonus: { level: number; x: number; z: number };
  /** The pieces every tower has the same, where the game needs them (the reception desk, the security console, the stair console): see towerfurniture.ts. */
  fixed: Piece[];
};

// ---- the rules, on any plan ----

const isPylonP = (p: TowerPlanData, level: number, x: number, y: number): boolean => p.pylons.some((q) => q.level === level && q.x === x && q.y === y);

const mapFloor = (p: TowerPlanData, level: number, x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.cols && y < p.rows && p.floors[level]![y]![x] === '#';
// (A climb has no flight: under its opening the lower storey's floor is plain floor, walked up to the wall.)
const inStairP = (p: TowerPlanData, level: number, x: number, y: number): boolean => p.stairs.some((s) => touches(s, level) && !(s.climb && stairLow(s) === level) && stairCells(s).some((c) => c.x === x && c.y === y));
const isLiftP = (p: TowerPlanData, level: number, x: number, y: number): boolean => p.lifts.some((l) => l.x === x && l.y === y && l.serves.includes(level));

/** Whether a floor tile is drawn at the cell: where a flight comes up through a storey, the tile is cut out for it. */
export function hasFloorP(p: TowerPlanData, level: number, x: number, y: number): boolean {
  if (!mapFloor(p, level, x, y)) return false;
  return !p.stairs.some((s) => stairHigh(s) === level && stairCells(s).some((c) => c.x === x && c.y === y));
}

/** Whether someone can stand in the cell: floor, and not a stair's footprint or a lift's cab. */
export function walkableP(p: TowerPlanData, level: number, x: number, y: number): boolean {
  return hasFloorP(p, level, x, y) && !inStairP(p, level, x, y) && !isLiftP(p, level, x, y) && !isPylonP(p, level, x, y);
}

const hasWallP = (p: TowerPlanData, level: number, x: number, y: number, dir: 'N' | 'W'): boolean => (p.walls[level] ?? []).some((w) => w.x === x && w.y === y && w.dir === dir);

/** Which way the street door's lift (or doorway) faces: the cab stands outside the building's wall, so the doors open into the hall (a west-wall door opens east, a north-wall door south, and so on). */
export const startOpening = (c: Cell, cols: number, rows: number): 'N' | 'S' | 'E' | 'W' => (c.x === 0 ? 'E' : c.y === 0 ? 'S' : c.x === cols - 1 ? 'W' : c.y === rows - 1 ? 'N' : 'S');
/** And the way out's, in the south, east, north or west wall: the cab stands outside, the doors open into the hall. */
export const exitOpening = (c: Cell, cols: number, rows: number): 'N' | 'S' | 'E' | 'W' => (c.y === rows - 1 ? 'N' : c.y === 0 ? 'S' : c.x === cols - 1 ? 'W' : 'E');

/** The two lifts' cells on the ground floor are dead ends: the cab's doors fill the middle of the cell, so nobody walks through them. */
export function lobbyShut(start: Cell, exit: Cell, cols: number, rows: number): TowerPlanData['shut'] {
  const deadEnd = (c: Cell, open: 'N' | 'S' | 'E' | 'W') => (['N', 'S', 'E', 'W'] as const).filter((d) => d !== open).map((dir) => ({ level: 0, x: c.x, y: c.y, dir }));
  return [...deadEnd(start, startOpening(start, cols, rows)), ...deadEnd(exit, exitOpening(exit, cols, rows))];
}

const STEP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;

/** Strips of floor that must stay clear of furniture though they are not lanes between cells: the landings at the two ends of each flight, the bridge deck's approach, the front of each lift. */
export function keepClearP(p: TowerPlanData, level: number): Array<{ x0: number; x1: number; z0: number; z1: number }> {
  const out: Array<{ x0: number; x1: number; z0: number; z1: number }> = [];
  for (const s of p.stairs) {
    const x0 = s.x * 4 - 2;
    const x1 = (s.x + s.width) * 4 - 2;
    if (s.fromLevel === level) out.push({ x0, x1, z0: (s.y - 1) * 4 - 0.6, z1: s.y * 4 - 1.8 });
    if (s.toLevel === level) out.push({ x0, x1, z0: (s.y + s.run) * 4 - 2.2, z1: (s.y + s.run) * 4 + 0.6 });
  }
  for (const b of p.bridges) if (b.level === level) out.push({ x0: b.fromX * 4, x1: b.toX * 4, z0: b.y * 4 - 0.7, z1: b.y * 4 + 0.7 });
  // Where the agent stands at a camera's panel: nothing nearer to Interact with than the panel.
  for (const c of p.cameras) if (c.level === level) out.push({ x0: c.x - 1.7, x1: c.x + 1.7, z0: c.z - 1.7, z1: c.z + 1.7 });
  for (const lf of p.lifts) {
    if (!lf.serves.includes(level)) continue;
    out.push(lf.opens === 'N' ? { x0: lf.x * 4 - 0.8, x1: lf.x * 4 + 0.8, z0: (lf.y - 1) * 4 - 0.6, z1: lf.y * 4 - 1.8 } : { x0: lf.x * 4 - 0.8, x1: lf.x * 4 + 0.8, z0: lf.y * 4 + 1.8, z1: (lf.y + 1) * 4 + 0.6 });
  }
  return out;
}

/** The slabs of every wall of a storey as it is drawn (outer, partitions, rooms'), world metres, with a little clearance: nothing may stand in them. */
export function wallRectsP(p: TowerPlanData, level: number): Array<{ x0: number; x1: number; z0: number; z1: number }> {
  const T = 0.14 + 0.05; // half the wall's thickness, and a hand's breadth
  const d = drawCellsP(p, level);
  const out: Array<{ x0: number; x1: number; z0: number; z1: number }> = [];
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (!walkableP(p, level, x, y)) continue;
      if (!d[y]![x]!.N) out.push({ x0: x * 4 - 2, x1: x * 4 + 2, z0: y * 4 - 2 - T, z1: y * 4 - 2 + T });
      if (!d[y]![x]!.S) out.push({ x0: x * 4 - 2, x1: x * 4 + 2, z0: y * 4 + 2 - T, z1: y * 4 + 2 + T });
      if (!d[y]![x]!.W) out.push({ x0: x * 4 - 2 - T, x1: x * 4 - 2 + T, z0: y * 4 - 2, z1: y * 4 + 2 });
      if (!d[y]![x]!.E) out.push({ x0: x * 4 + 2 - T, x1: x * 4 + 2 + T, z0: y * 4 - 2, z1: y * 4 + 2 });
    }
  }
  return out;
}

/** The cells a storey is played on: open between neighbours that both stand on floor, shut round everything that does not. */
export function playCellsP(p: TowerPlanData, level: number): Open[][] {
  const ok = (x: number, y: number): boolean => walkableP(p, level, x, y);
  const shut = (x: number, y: number, dir: 'N' | 'S' | 'E' | 'W'): boolean => {
    const opp = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
    const [dx, dy] = STEP[dir];
    return p.shut.some((e) => e.level === level && ((e.x === x && e.y === y && e.dir === dir) || (e.x === x + dx && e.y === y + dy && e.dir === opp[dir])));
  };
  return Array.from({ length: p.rows }, (_, y) =>
    Array.from({ length: p.cols }, (_, x) => ({
      N: ok(x, y) && ok(x, y - 1) && !hasWallP(p, level, x, y, 'N') && !shut(x, y, 'N'),
      S: ok(x, y) && ok(x, y + 1) && !hasWallP(p, level, x, y + 1, 'N') && !shut(x, y, 'S'),
      W: ok(x, y) && ok(x - 1, y) && !hasWallP(p, level, x, y, 'W') && !shut(x, y, 'W'),
      E: ok(x, y) && ok(x + 1, y) && !hasWallP(p, level, x + 1, y, 'W') && !shut(x, y, 'E'),
    }))
  );
}

/** The cells a storey is drawn from: a plain hall, walls only on its boundary and on the interior walls, none round a void, a stair or a lift. */
export function drawCellsP(p: TowerPlanData, level: number): Open[][] {
  const solid = (x: number, y: number): boolean => !walkableP(p, level, x, y) && !isPylonP(p, level, x, y); // (a pylon stands in an open cell: its own wall, no box round it)
  return Array.from({ length: p.rows }, (_, y) =>
    Array.from({ length: p.cols }, (_, x) => ({
      N: y > 0 && (solid(x, y) || solid(x, y - 1) || !hasWallP(p, level, x, y, 'N')),
      // (The wall at the heist door is open: the passage to the lift goes out through it.)
      S: (level === OFFICES && x === p.heist.x && y === p.heist.y) || (y < p.rows - 1 && (solid(x, y) || solid(x, y + 1) || !hasWallP(p, level, x, y + 1, 'N'))),
      W: x > 0 && (solid(x, y) || solid(x - 1, y) || !hasWallP(p, level, x, y, 'W')),
      E: x < p.cols - 1 && (solid(x, y) || solid(x + 1, y) || !hasWallP(p, level, x + 1, y, 'W')),
    }))
  );
}

/** Whether the edge of (x, y) on `dir` is where a flight comes onto the storey: the foot or the head of a stair, which has no rail across it. */
function stairEdgeP(p: TowerPlanData, level: number, x: number, y: number, dir: 'N' | 'S' | 'E' | 'W'): boolean {
  return p.stairs.some((s) => {
    if (s.climb) return false; // (a climb has a rail all round its opening: the way up is over it, from a ledge)
    if (!(x >= s.x && x < s.x + s.width)) return false;
    if (dir === 'S' && y === s.y - 1) return s.fromLevel === level; // the north end of the flight
    if (dir === 'N' && y === s.y + s.run) return s.toLevel === level; // the south end
    return false;
  });
}

/** Every edge on a storey where floor meets a drop or a stair's side, bar where the stair itself arrives. */
export function railsForP(p: TowerPlanData, level: number): TowerRail[] {
  const out: TowerRail[] = [];
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (!walkableP(p, level, x, y)) continue;
      for (const dir of ['N', 'S', 'E', 'W'] as const) {
        const [dx, dy] = STEP[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= p.cols || ny >= p.rows) continue; // the hall's wall is there
        if (walkableP(p, level, nx, ny) || isLiftP(p, level, nx, ny) || isPylonP(p, level, nx, ny)) continue;
        if (stairEdgeP(p, level, x, y, dir)) continue;
        out.push({ level, x, y, dir });
      }
    }
  }
  return out;
}

/** Every storey and cell a walker can reach from the street door, by floor and stairs and bridges (and, if `lifts`, the lifts too). */
export function reachableP(p: TowerPlanData, lifts: boolean): Set<string> {
  const seen = new Set<string>([`0,${p.start.x},${p.start.y}`]);
  const queue: Array<[number, number, number]> = [[0, p.start.x, p.start.y]];
  const key = (l: number, x: number, y: number): string => `${l},${x},${y}`;
  const play = [0, 1, 2, 3].map((l) => playCellsP(p, l));
  const push = (l: number, x: number, y: number): void => {
    if (seen.has(key(l, x, y)) || !walkableP(p, l, x, y)) return;
    seen.add(key(l, x, y));
    queue.push([l, x, y]);
  };
  while (queue.length) {
    const [l, x, y] = queue.shift()!;
    const open = play[l]![y]![x]!;
    if (open.N) push(l, x, y - 1);
    if (open.S) push(l, x, y + 1);
    if (open.E) push(l, x + 1, y);
    if (open.W) push(l, x - 1, y);
    for (const s of p.stairs) {
      // A flight is walked from the cell just past either end.
      if (x >= s.x && x < s.x + s.width) {
        if (l === s.fromLevel && y === s.y - 1) push(s.toLevel, x, s.y + s.run);
        if (l === s.toLevel && y === s.y + s.run) push(s.fromLevel, x, s.y - 1);
      }
    }
    for (const b of p.bridges) {
      if (l !== b.level || y !== b.y) continue;
      if (x === b.fromX) push(l, b.toX, b.y);
      if (x === b.toX) push(l, b.fromX, b.y);
    }
    if (lifts) for (const lf of p.lifts) if (lf.serves.includes(l) && x === liftFront(lf).x && y === liftFront(lf).y) for (const to of lf.serves) push(to, liftFront(lf).x, liftFront(lf).y);
  }
  return seen;
}

/**
 * Where nothing may stand, so the way through stays plain: a stair's head, a lift's doors, the keycard, the heist door's row, the street door's corner, the way out, a sentry's cell and an
 * office door's two cells. The furniture sets (towerfurniture.ts) keep off these.
 */
export function blockedP(p: TowerPlanData, level: number, x: number, y: number): boolean {
  for (const s of p.stairs) {
    if (!touches(s, level)) continue;
    for (let cx = s.x; cx < s.x + s.width; cx++) {
      if (s.fromLevel === level && x === cx && y === s.y - 1) return true;
      if (s.toLevel === level && x === cx && y === s.y + s.run) return true;
    }
  }
  for (const l of p.lifts) if (l.serves.includes(level) && x === liftFront(l).x && y === liftFront(l).y) return true;
  if (level === p.keycard.level && x === p.keycard.x && y === p.keycard.y) return true;
  if (p.cards.some((c) => c.level === level && c.x === x && c.y === y)) return true;
  if (level === OFFICES && y === p.heist.y && Math.abs(x - p.heist.x) <= 1) return true;
  if (level === 0 && Math.abs(x - p.start.x) <= 1 && Math.abs(y - p.start.y) <= 1) return true;
  if (level === 0 && Math.abs(x - p.exit.x) <= 1 && Math.abs(y - p.exit.y) <= 1) return true;
  if (p.posts.some((g) => g.level === level && g.x === x && g.y === y)) return true;
  if (p.officeDoors.some((d) => d.level === level && d.x === x && (d.y === y || d.y - 1 === y))) return true;
  return false;
}

// ---- ledges ----

/** How far from their own spot someone looking down over a rail can lean out, metres. */
const LEAN_M = 2.6;

/** A run of balustrade with a void on its far side: the agent vaults it and hangs below, hands on the slab's edge. `axis` is the way it runs, `fixed` the other coordinate of its line (world metres), `nx, nz` the unit normal toward the drop. */
export type LedgeSpan = { level: number; axis: 'x' | 'z'; fixed: number; from: number; to: number; nx: number; nz: number; /** The long edge of a bridge's deck, not a rail: it can be hooked from below and climbed onto, lying flat. */ deck?: boolean };

/** Every balustrade on a storey with a drop beyond it, runs of neighbouring edges joined. The bridge's landing edges are left out (their rail has a gap for the deck). */
export function ledgeSpansP(p: TowerPlanData, level: number): LedgeSpan[] {
  const raw: LedgeSpan[] = [];
  for (const r of railsForP(p, level)) {
    const [dx, dy] = STEP[r.dir];
    if (hasFloorP(p, level, r.x + dx, r.y + dy)) continue; // (a stair's side or a lift: not a drop)
    if (p.bridges.some((b) => b.level === level && r.y === b.y && ((r.x === b.fromX && r.dir === 'E') || (r.x === b.toX && r.dir === 'W')))) continue;
    const alongX = r.dir === 'N' || r.dir === 'S';
    const cx = r.x * 4 + dx * 2;
    const cz = r.y * 4 + dy * 2;
    raw.push(alongX ? { level, axis: 'x', fixed: cz, from: cx - 2, to: cx + 2, nx: 0, nz: dy } : { level, axis: 'z', fixed: cx, from: cz - 2, to: cz + 2, nx: dx, nz: 0 });
  }
  const out: LedgeSpan[] = [];
  for (const sp of raw.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : a.fixed - b.fixed || a.nx - b.nx || a.nz - b.nz || a.from - b.from))) {
    const last = out[out.length - 1];
    if (last && last.axis === sp.axis && last.fixed === sp.fixed && last.nx === sp.nx && last.nz === sp.nz && Math.abs(last.to - sp.from) < 1e-9) last.to = sp.to;
    else out.push({ ...sp });
  }
  return out;
}

// ---- building a plan ----

type Rect = readonly ['+' | '-', number, number, number, number];
/** A floor shape from rectangles added and taken away, in order (x0, y0, x1, y1 inclusive). */
function shape(cols: number, rows: number, ops: readonly Rect[]): string[] {
  const g = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '.'));
  for (const [op, x0, y0, x1, y1] of ops) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g[y]?.[x] !== undefined) g[y]![x] = op === '+' ? '#' : '.';
  return g.map((r) => r.join(''));
}

const range = (n: number, from = 0): number[] => Array.from({ length: n }, (_, i) => from + i);

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The facing (see TowerPost) of someone looking toward `dir`. */
const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 } as const;

/** Whether stepping from the cell `d`-ward crosses a gap in a partition wall. */
function crossesDoorway(p: TowerPlanData, level: number, c: Cell, d: 'N' | 'S' | 'E' | 'W'): boolean {
  const [x, y, dir] = d === 'N' ? [c.x, c.y, 'N'] : d === 'S' ? [c.x, c.y + 1, 'N'] : d === 'W' ? [c.x, c.y, 'W'] : [c.x + 1, c.y, 'W'];
  return p.doorways.some((g) => g.level === level && g.x === x && g.y === y && g.dir === dir);
}

/**
 * Connected groups of walkable cells on a storey (the guards' paths: stairs and the bridge do not count). With `sectioned`, a gap in a partition wall divides them too: the groups are
 * then the storey's sections, each with guards, a dog and a camera of its own.
 */
function components(p: TowerPlanData, level: number, sectioned = false): Cell[][] {
  const play = playCellsP(p, level);
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (!walkableP(p, level, x, y) || seen.has(`${x},${y}`)) continue;
      const comp: Cell[] = [];
      const q: Cell[] = [{ x, y }];
      seen.add(`${x},${y}`);
      while (q.length) {
        const c = q.shift()!;
        comp.push(c);
        for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
          const k = `${c.x + dx},${c.y + dy}`;
          if (play[c.y]![c.x]![d] && !(sectioned && crossesDoorway(p, level, c, d)) && !seen.has(k)) {
            seen.add(k);
            q.push({ x: c.x + dx, y: c.y + dy });
          }
        }
      }
      out.push(comp);
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Rounds for `count` guards on a storey: each four or so cells spread over its larger sections, ordered into a loop. */
function roundsFor(p: TowerPlanData, level: number, count: number, rand: () => number, keepAway?: (c: Cell) => boolean): TowerPatrol[] {
  const comps = components(p, level, true).filter((c) => c.length >= 4);
  const out: TowerPatrol[] = [];
  const total = comps.reduce((a, c) => a + c.length, 0);
  let given = 0;
  comps.forEach((comp, ci) => {
    const n = Math.max(1, ci === comps.length - 1 ? count - given : Math.round((count * comp.length) / total));
    given += n;
    const cells = comp.filter((c) => !blockedP(p, level, c.x, c.y) && !(keepAway?.(c) ?? false));
    for (let k = 0; k < n && cells.length >= 4; k++) {
      // Farthest-point picks from a random start, so a round spans its section.
      const pick: Cell[] = [cells[Math.floor(rand() * cells.length)]!];
      while (pick.length < 4) {
        let best = cells[0]!;
        let bestD = -1;
        for (const c of cells) {
          const d = Math.min(...pick.map((q) => Math.abs(q.x - c.x) + Math.abs(q.y - c.y)));
          if (d > bestD + (rand() < 0.15 ? 1 : 0)) {
            bestD = d;
            best = c;
          }
        }
        pick.push(best);
      }
      // Order them round (nearest next) into a loop.
      const route: Cell[] = [pick.shift()!];
      while (pick.length) {
        const last = route[route.length - 1]!;
        pick.sort((a, b) => Math.abs(a.x - last.x) + Math.abs(a.y - last.y) - (Math.abs(b.x - last.x) + Math.abs(b.y - last.y)));
        route.push(pick.shift()!);
      }
      out.push({ level, route });
    }
  });
  return out;
}

/** What a plan is built from, beyond the four floor shapes. */
type Spec = {
  id: TowerSetId;
  cols: number;
  rows: number;
  /** The four floors' shapes, as rectangles. */
  ops: readonly [readonly Rect[], readonly Rect[], readonly Rect[], readonly Rect[]];
  start: Cell;
  exit: Cell;
  /** Stairs: where to look for one, as fixed ones (the plan says where) or a count and a width. */
  /** `flip`: the north end is on the first floor up (the stair climbs northward, as under a mezzanine along the north wall). */
  grand: Array<{ x: number; y: number; width: number; run?: number; flip?: boolean }>;
  /** `flip`: the north end is on the upper floor (the stair is entered from the south on the first floor up, and climbed northward). */
  wide: { x: number; y: number; width: number; run?: number; flip?: boolean };
  core: { x: number; y: number; run?: number };
  liftA: { x: number; y: number; opens: 'N' | 'S' };
  liftB: { x: number; y: number; opens: 'N' | 'S' };
  keycard: Cell;
  bridge: { y: number; fromX: number; toX: number };
  /** The security room on the first floor up: its cells' rectangle, and the edge its door is on ('N','S','E','W') at which row or column. */
  security: { x: number; y: number; w: number; h: number; door: 'N' | 'S' | 'E' | 'W'; at: number; console: 'N' | 'S' | 'E' | 'W' };
  /** The back offices: the row their wall runs along the north of, its doorways, and the corridor column (walled off on its west) of the service lift, if any. */
  offices: { y: number; doors: number[]; corridorX?: number; corridorFrom?: number; corridorTo?: number; /** Which side of the corridor column its wall is on (default west). */ corridorSide?: 'W' | 'E' };
  heistX: number;
  cameras: Array<{ side: 'N' | 'S' | 'E' | 'W'; at: number; range?: number; half?: number }>;
  reception: Cell;
  /** Lasers on the gallery. */
  lasers: { sweeper: Cell; slider: { axis: 'x' | 'z'; at: number; from: number; to: number }; gate: { x: number; y: number; spanX: boolean } };
  /** Where the stair console goes (a cell of the gallery and the wall it stands against). */
  stairConsole: { x: number; y: number; edge: 'N' | 'S' | 'E' | 'W'; along?: number };
  /** Posts and dogs that the plan places itself (otherwise chosen). */
  rail?: Cell;
  /** Walls a storey needs beyond the rooms' (campus's gallery is split by walls rather than by a void). */
  extraWalls?: Array<TowerWall & { level: number }>;
};

/** Builds a plan from a spec: the walls, rounds, posts, dogs, cameras and fixed furniture all follow from where the rooms and stairs are. */
function buildPlan(s: Spec, seed = 0): TowerPlanData {
  const floors = s.ops.map((o) => shape(s.cols, s.rows, o)) as [string[], string[], string[], string[]];
  const stairs: TowerStair[] = [
    ...s.grand.map((g, i): TowerStair => ({ id: s.grand.length > 1 ? (i === 0 ? 'grandW' : 'grandE') : 'grand', x: g.x, y: g.y, run: g.run ?? 3, width: g.width, fromLevel: g.flip ? 1 : 0, toLevel: g.flip ? 0 : 1 })),
    { id: 'wide', x: s.wide.x, y: s.wide.y, run: s.wide.run ?? 2, width: s.wide.width, fromLevel: s.wide.flip ? 2 : 1, toLevel: s.wide.flip ? 1 : 2, climb: true },
    { id: 'core', x: s.core.x, y: s.core.y, run: s.core.run ?? 3, width: 1, fromLevel: 3, toLevel: 2, climb: true },
  ];
  const lifts: TowerLift[] = [
    { id: 'A', x: s.liftA.x, y: s.liftA.y, opens: s.liftA.opens, serves: [0, 1, 2], locked: false },
    { id: 'B', x: s.liftB.x, y: s.liftB.y, opens: s.liftB.opens, serves: [2, 3], locked: true },
  ];
  // The security room's walls: every edge between a room cell and a floor cell outside it, bar the door's.
  const room: Cell[] = [];
  for (let y = s.security.y; y < s.security.y + s.security.h; y++) for (let x = s.security.x; x < s.security.x + s.security.w; x++) room.push({ x, y });
  const inRoom = (x: number, y: number): boolean => room.some((c) => c.x === x && c.y === y);
  const walls: Record<number, TowerWall[]> = { 0: [], 1: [], 2: [], 3: [] };
  const door = (c: Cell, d: 'N' | 'S' | 'E' | 'W'): boolean => d === s.security.door && ((d === 'N' || d === 'S') ? c.x === s.security.at : c.y === s.security.at);
  for (const c of room) {
    if (!inRoom(c.x, c.y - 1) && !door(c, 'N')) walls[1]!.push({ x: c.x, y: c.y, dir: 'N' });
    if (!inRoom(c.x, c.y + 1) && !door(c, 'S')) walls[1]!.push({ x: c.x, y: c.y + 1, dir: 'N' });
    if (!inRoom(c.x - 1, c.y) && !door(c, 'W')) walls[1]!.push({ x: c.x, y: c.y, dir: 'W' });
    if (!inRoom(c.x + 1, c.y) && !door(c, 'E')) walls[1]!.push({ x: c.x + 1, y: c.y, dir: 'W' });
  }
  // The back offices: a wall along the north of their first row, with doorways; and the service corridor's west wall.
  // (The service corridor's column, at the east or west end, runs on through the wall.)
  for (const x of range(s.cols)) if (!s.offices.doors.includes(x) && x !== s.offices.corridorX) walls[3]!.push({ x, y: s.offices.y, dir: 'N' });
  if (s.offices.corridorX !== undefined) for (const y of range(s.offices.corridorTo! - s.offices.corridorFrom! + 1, s.offices.corridorFrom!)) walls[3]!.push({ x: s.offices.corridorX + (s.offices.corridorSide === 'E' ? 1 : 0), y, dir: 'W' });
  for (const w of s.extraWalls ?? []) walls[w.level]!.push({ x: w.x, y: w.y, dir: w.dir });
  const officeDoors = s.offices.doors.map((x) => ({ level: 3, x, y: s.offices.y }));
  const bridges: TowerBridge[] = [{ level: 2, y: s.bridge.y, fromX: s.bridge.fromX, toX: s.bridge.toX, width: 1.2 }];

  // The plan so far, to ask where the guards may go.
  const draft: TowerPlanData = {
    id: s.id, cols: s.cols, rows: s.rows, floors, start: s.start, exit: s.exit, stairs, lifts,
    keycard: { level: 2, x: s.keycard.x, y: s.keycard.y }, cards: [], seed, heist: { x: s.heistX, y: s.rows - 1 }, heistLift: { x: s.heistX, y: s.rows + 2 },
    walls, doorways: [], shut: [], bridges, lasers: { 2: { sweepers: [{ x: s.lasers.sweeper.x, y: s.lasers.sweeper.y, phase: 0, dir: 1 }], sliders: [{ ...s.lasers.slider, phase: 0.3, speed: 1.3 }], gates: [{ x: s.lasers.gate.x, y: s.lasers.gate.y, spanX: s.lasers.gate.spanX, kind: 'pulse', phase: 0.2 }] } },
    bridgeBonus: { level: 2, x: 0, z: 0 }, patrols: [], posts: [], dogs: [], alphas: [], pylons: [], cameras: [], security: { level: 1, cells: room }, officeDoors, fixed: [],
  };
  const rand = makeRng(77 + s.id.length * 31 + s.cols * 7 + s.rows + seed * 7919);

  // The posts: the desk man in the lobby, the security room's guard and a rail sentry on the first floor up, a watcher at each end of the bridge, two sentries at the heist door.
  const posts: TowerPost[] = [{ level: 0, x: s.reception.x, y: s.reception.y, facing: FACE.N }];
  const consoleCell = (() => {
    // The console stands in the room's far corner from the door, against the wall opposite it.
    const away = room.filter((c) => (s.security.door === 'W' ? c.x === Math.max(...room.map((r) => r.x)) : s.security.door === 'E' ? c.x === Math.min(...room.map((r) => r.x)) : s.security.door === 'N' ? c.y === Math.max(...room.map((r) => r.y)) : c.y === Math.min(...room.map((r) => r.y))));
    return away[Math.floor(away.length / 2)] ?? room[0]!;
  })();
  const guardCell = room.find((c) => (c.x !== consoleCell.x || c.y !== consoleCell.y) && walkableP(draft, 1, c.x, c.y)) ?? room[0]!;
  posts.push({ level: 1, x: guardCell.x, y: guardCell.y, facing: FACE[s.security.console] });
  // The rail sentry: a first-floor cell with a drop beside it and nothing else to do with it.
  const railCells = railsForP(draft, 1).filter((r) => walkableP(draft, 1, r.x, r.y) && !blockedP(draft, 1, r.x, r.y) && !inRoom(r.x, r.y) && !(r.x === guardCell.x && r.y === guardCell.y));
  const railPick = s.rail ? railCells.find((r) => r.x === s.rail!.x && r.y === s.rail!.y) : railCells[Math.floor(railCells.length / 2)];
  if (railPick) posts.push({ level: 1, x: railPick.x, y: railPick.y, facing: FACE[railPick.dir] });
  // Bridge watchers: a cell back from each landing, looking away from the bridge (so whoever crawls across comes out behind one, for a silent takedown), or the landing itself.
  const bw = s.bridge;
  const backW = walkableP(draft, 2, bw.fromX - 1, bw.y) ? bw.fromX - 1 : bw.fromX;
  const backE = walkableP(draft, 2, bw.toX + 1, bw.y) ? bw.toX + 1 : bw.toX;
  posts.push({ level: 2, x: backW, y: bw.y, facing: FACE.W }, { level: 2, x: backE, y: bw.y, facing: FACE.E });
  // The heist door's sentries: two cells either side, a row up from the south wall, looking at each other across the door.
  const hy = s.rows - 2;
  for (const [dx, f] of [[-2, FACE.E], [2, FACE.W]] as const) {
    const x = s.heistX + dx;
    if (walkableP(draft, 3, x, hy)) posts.push({ level: 3, x, y: hy, facing: f });
  }
  draft.posts = posts;

  // Cameras: along the outer wall of the first floor up, facing in; the world metres of the wall's inside.
  draft.cameras = s.cameras.map((c, i): CameraPlan => {
    const range = c.range ?? 15;
    const half = c.half ?? 0.5;
    const base = { level: 1, sweep: 0.7 + 0.1 * (i % 3), period: 9 + (i % 3), phase: i * 0.25, range, half };
    if (c.side === 'W') return { ...base, x: -1.45, z: c.at * 4, face: FACE.E };
    if (c.side === 'E') return { ...base, x: (s.cols - 1) * 4 + 1.45, z: c.at * 4, face: FACE.W };
    if (c.side === 'S') return { ...base, x: c.at * 4, z: (s.rows - 1) * 4 + 1.4, face: FACE.N };
    return { ...base, x: c.at * 4, z: -1.4, face: FACE.S };
  });

  // A bonus on the deck's middle for whoever crawls their way out there.
  draft.bridgeBonus = { level: bridges[0]!.level, x: ((bridges[0]!.fromX + bridges[0]!.toX) / 2) * 4, z: bridges[0]!.y * 4 };

  // The fixed furniture: the reception desk behind the desk man, the security console against the room's wall (a chair beside it), the stair console on the gallery.
  const edgeOf = (d: 'N' | 'S' | 'E' | 'W'): 'N' | 'S' | 'E' | 'W' => d;
  const sc = s.stairConsole;
  draft.fixed = [
    { level: 0, kind: 'desk', x: s.reception.x, y: s.reception.y, edge: 'S', along: 0 },
    { level: 1, kind: 'console', x: consoleCell.x, y: consoleCell.y, edge: edgeOf(s.security.console), along: 0 },
    { level: 1, kind: 'chair', x: consoleCell.x, y: consoleCell.y, edge: edgeOf(s.security.console), along: -1.3 },
    { level: 2, kind: 'console', x: sc.x, y: sc.y, edge: sc.edge, along: sc.along ?? 0 },
    { level: 2, kind: 'chair', x: sc.x, y: sc.y, edge: sc.edge, along: (sc.along ?? 0) + 1.4 },
  ];
  // The lane beside each of them is shut: nobody walks into a desk or a console.
  draft.shut = [
    ...lobbyShut(s.start, s.exit, s.cols, s.rows),
    { level: 0, x: s.reception.x, y: s.reception.y, dir: 'S' },
    { level: 1, x: consoleCell.x, y: consoleCell.y, dir: s.security.console },
    { level: 2, x: sc.x, y: sc.y, dir: sc.edge },
  ];
  draft.seed = seed;
  return partitionPlan(draft, rand);
}


// ---- partitions: each storey is cut into sections ----

type Cut = { level: number; axis: 'v' | 'h'; at: number; walls: TowerWall[]; gaps: TowerWall[]; side: 1 | -1; edges: Array<{ a: Cell; b: Cell }> };

/**
 * A straight partition wall across each storey, with a doorway or two, so that the storey is a few sections joined by gaps rather than one hall: the wall runs along the line between two
 * rows or two columns, across the largest connected stretch of floor it can cross cleanly (not through a stair's foot, a lift's doors or a fixture, which are left open as doorways), and
 * leaves both sides room for a round. Walkers pass through the gaps; guards, dogs and a camera are each dedicated to a section.
 */
function addPartitions(p: TowerPlanData, rand: () => number): Cut[] {
  const cuts: Cut[] = [];
  const fixedAt = new Set(p.fixed.map((f) => `${f.level},${f.x},${f.y}`));
  const officeY = p.officeDoors[0]?.y ?? p.rows;
  for (let level = 0; level < 4; level++) {
    const walk = (x: number, y: number): boolean => walkableP(p, level, x, y);
    const comps = components(p, level);
    const compOf = new Map<string, number>();
    comps.forEach((comp, i) => comp.forEach((c) => compOf.set(`${c.x},${c.y}`, i)));
    type Cand = { cut: Cut; score: number };
    const cands: Cand[] = [];
    for (const axis of ['v', 'h'] as const) {
      if (level === 3 && axis === 'h') continue; // (the offices already have their wall along a row)
      const n = axis === 'v' ? p.cols : p.rows;
      for (let at = 2; at <= n - 2; at++) {
        const walls: TowerWall[] = [];
        const natural: TowerWall[] = [];
        const edges: Array<{ a: Cell; b: Cell }> = [];
        const len = axis === 'v' ? p.rows : p.cols;
        for (let k = 0; k < len; k++) {
          const a = axis === 'v' ? { x: at - 1, y: k } : { x: k, y: at - 1 };
          const b = axis === 'v' ? { x: at, y: k } : { x: k, y: at };
          if (!walk(a.x, a.y) || !walk(b.x, b.y)) continue;
          if (level === 3 && (a.y >= officeY || b.y >= officeY)) continue;
          const edge: TowerWall = axis === 'v' ? { x: at, y: k, dir: 'W' } : { x: k, y: at, dir: 'N' };
          if (hasWallP(p, level, edge.x, edge.y, edge.dir)) continue;
          if (blockedP(p, level, a.x, a.y) || blockedP(p, level, b.x, b.y) || fixedAt.has(`${level},${a.x},${a.y}`) || fixedAt.has(`${level},${b.x},${b.y}`)) {
            natural.push(edge);
            continue;
          }
          walls.push(edge);
          edges.push({ a, b });
        }
        if (walls.length < 3 || natural.length > 2) continue;
        const comp = new Set(edges.map((e) => compOf.get(`${e.a.x},${e.a.y}`)));
        if (comp.size !== 1) continue;
        const cells = comps[[...comp][0]!]!;
        const before = cells.filter((c) => (axis === 'v' ? c.x : c.y) < at).length;
        const after = cells.length - before;
        if (before < 6 || after < 6) continue;
        // One or two doorways: those the fixtures and stairs leave open, or chosen in the wall.
        const need = Math.max(0, 2 - natural.length);
        const gaps: TowerWall[] = [...natural];
        const keep = walls.slice();
        if (need > 0) {
          if (keep.length < need + 2) continue;
          for (let g = 0; g < need; g++) {
            const idx = Math.max(0, Math.min(keep.length - 1, Math.floor(((g + 1) * keep.length) / (need + 1)) + (rand() < 0.5 ? -1 : 0)));
            gaps.push(keep.splice(idx, 1)[0]!);
          }
        }
        // The dedicated camera goes on the larger side.
        const side: 1 | -1 = after >= before ? 1 : -1;
        // (The camera goes on a stretch of real wall, not in a doorway.)
        const wallEdges = keep.map((w) => (w.dir === 'W' ? { a: { x: w.x - 1, y: w.y }, b: { x: w.x, y: w.y } } : { a: { x: w.x, y: w.y - 1 }, b: { x: w.x, y: w.y } }));
        cands.push({ cut: { level, axis, at, walls: keep, gaps, side, edges: wallEdges }, score: Math.abs(before - after) / cells.length + 0.01 * keep.length + (cuts.some((c) => c.axis === axis && c.at === at) ? 0.15 : 0) });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    // Not always the best-scoring cut: one of the first few, then the rest in order.
    const first = Math.floor(rand() * Math.min(3, cands.length));
    const order = cands.length ? [cands[first]!, ...cands.filter((_, i) => i !== first)] : [];
    for (const { cut } of order) {
      const trial: TowerPlanData = { ...p, walls: { ...p.walls, [level]: [...(p.walls[level] ?? []), ...cut.walls] }, doorways: [...p.doorways, ...cut.gaps.map((g) => ({ level, ...g }))] };
      const all = reachableP(trial, false);
      let ok = true;
      for (let y = 0; y < p.rows && ok; y++) for (let x = 0; x < p.cols; x++) if (walkableP(p, level, x, y) && !all.has(`${level},${x},${y}`)) { ok = false; break; }
      // Both sides need a section big enough for a round.
      if (ok && components(trial, level, true).filter((c) => c.length >= 4).length < 2) ok = false;
      if (!ok) continue;
      p.walls[level] = trial.walls[level]!;
      p.doorways = trial.doorways;
      cuts.push(cut);
      break;
    }
  }
  return cuts;
}

/** The rounds, dogs and camera that the sections get: three guards in the lobby, three on the first floor up, four on the gallery, five on the top (two of them a pair), spread so each section has some. */
function partitionPlan(p: TowerPlanData, rand: () => number): TowerPlanData {
  const cuts = addPartitions(p, rand);
  placePylons(p, rand); // (before the rounds and the dogs, which then walk round them)
  p.cards = []; // (the rounds and dogs are laid out before the cards, so a card is not in the way of a post)
  const away = (c: Cell): boolean => Math.hypot(c.x - p.start.x, c.y - p.start.y) < 3;
  const patrols: TowerPatrol[] = [...roundsFor(p, 0, 3, rand, away), ...roundsFor(p, 1, 3, rand), ...roundsFor(p, 2, 4, rand)];
  const top = roundsFor(p, 3, 4, rand);
  if (top[0]) {
    // A second guard a cell behind the first on the same round.
    const r0 = top[0].route;
    const first = r0[0]!;
    const near = [{ x: first.x - 1, y: first.y }, { x: first.x + 1, y: first.y }, { x: first.x, y: first.y - 1 }, { x: first.x, y: first.y + 1 }].find((c) => walkableP(p, 3, c.x, c.y));
    if (near) top.splice(1, 0, { level: 3, route: [near, ...r0.slice(1)] });
  }
  patrols.push(...top.slice(0, 6)); // (with the two at the heist door, eight guards at most)
  p.patrols = patrols;
  // Dogs: one in the lobby, one on the first floor up, two on the gallery, three on the top: each in a section (the larger ones first).
  const dogs: TowerDog[] = [];
  for (const [level, n] of [[0, 1], [1, 1], [2, 2], [3, 3]] as const) {
    const secs = components(p, level, true).filter((c) => c.length >= 4);
    for (let k = 0; k < n; k++) {
      const sec = secs[k % secs.length]!;
      const cells = sec.filter((c) => !blockedP(p, level, c.x, c.y) && !(level === 0 && away(c)));
      const c = cells[Math.floor(rand() * cells.length)]!;
      dogs.push({ level, x: c.x, y: c.y });
    }
  }
  p.dogs = dogs;
  placeCards(p, rand);
  // A camera for each partition, on its wall, watching the larger side.
  cuts.forEach((cut, i) => {
    const mid = cut.edges[Math.floor(cut.edges.length / 2)]!;
    const cell = cut.side === 1 ? mid.b : mid.a;
    const plane = cut.at * 4 - 2;
    const off = 0.55 * cut.side;
    const base = { level: cut.level, sweep: 0.7, period: 9 + Math.floor(rand() * 4) + (i % 2), phase: rand(), range: 11, half: 0.55 };
    if (cut.axis === 'v') p.cameras.push({ ...base, x: plane + off, z: cell.y * 4, face: cut.side === 1 ? FACE.E : FACE.W, wall: cut.side === 1 ? 'W' : 'E' });
    else p.cameras.push({ ...base, x: cell.x * 4, z: plane + off, face: cut.side === 1 ? FACE.S : FACE.N, wall: cut.side === 1 ? 'N' : 'S' });
  });
  pylonCameras(p);
  placeLasers(p);
  placeLines(p, rand);
  placeAlphas(p, rand);
  return p;
}

/**
 * Line lasers (linelasers.ts) where they guard something: across the doorway in a partition wall nearest each storey's keycard (a doorway is the one cell with a wall on both sides, so the
 * beams run wall to wall): two rising lines on the first floor up, two sweeping ones on the top. The gallery has its curtain, gate and sweeper already. The vertical ones' lower end is
 * linelasers.ts's GAP_CROUCH (1.4): the tests hold the two together.
 */
function placeLines(p: TowerPlanData, rand: () => number): void {
  // Each group tries its storey, then the next choice where that storey has no doorway in a straight wall to spare (a hall with no partition there).
  const groups: Array<{ levels: number[]; orient: 'h' | 'v' }> = [{ levels: [1, 0], orient: 'h' }, { levels: [3, 1], orient: 'v' }];
  const done = new Set<number>();
  for (const { levels, orient } of groups) {
    for (const level of levels) {
      if (done.has(level)) continue;
      const card = p.cards.find((c) => c.level === level);
      const play = playCellsP(p, level);
      const las = p.lasers[level];
      const taken = new Set<string>();
      for (const g of las?.gates ?? []) taken.add(`${g.x},${g.y}`);
      for (const w of las?.sweepers ?? []) taken.add(`${w.x},${w.y}`);
      for (const strict of [true, false]) {
        const spots: Array<{ x: number; y: number; spanX: boolean; d: number }> = [];
        for (let y = 0; y < p.rows; y++) {
          for (let x = 0; x < p.cols; x++) {
            if (!walkableP(p, level, x, y) || blockedP(p, level, x, y) || taken.has(`${x},${y}`) || (level === 0 && Math.hypot(x - p.start.x, y - p.start.y) < 3)) continue;
            const c = play[y]![x]!;
            const ns = c.N && c.S && !c.E && !c.W;
            const ew = c.E && c.W && !c.N && !c.S;
            if (!ns && !ew) continue;
            // (Strictly: no stair's head or lift's doors in the next cell, where the beams would be across the way off it.)
            if (strict && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => blockedP(p, level, x + dx!, y + dy!))) continue;
            spots.push({ x, y, spanX: ns, d: card ? Math.abs(x - card.x) + Math.abs(y - card.y) : 0 });
          }
        }
        spots.sort((a, b) => a.d - b.d);
        const near = spots.filter((s) => s.d >= 2).slice(0, 3);
        const pick = near[Math.floor(rand() * near.length)];
        if (!pick) continue;
        const entry = (p.lasers[level] ??= { sweepers: [], sliders: [], gates: [] });
        entry.lines = [{ x: pick.x, y: pick.y, spanX: pick.spanX, orient, count: 2, phase: rand(), gap: 1.4 }];
        done.add(level);
        break;
      }
      if (done.has(level)) break;
    }
  }
}

/**
 * An alpha unit on each storey, in the largest section that has room, well away from the street door, the guards' posts and rounds, the dogs, the keycards and the lasers: so no spawn is
 * a surprise at a way in, and a section is never one alpha's and one dog's both. Drawn after everything else, so the layouts before it do not change with it.
 */
function placeAlphas(p: TowerPlanData, rand: () => number): void {
  p.alphas = [];
  for (let level = 0; level < 4; level++) {
    const taken = new Set<string>();
    for (const r of p.patrols) if (r.level === level) for (const c of r.route) taken.add(`${c.x},${c.y}`);
    for (const g of p.posts) if (g.level === level) taken.add(`${g.x},${g.y}`);
    for (const d of p.dogs) if (d.level === level) taken.add(`${d.x},${d.y}`);
    for (const c of p.cards) if (c.level === level) taken.add(`${c.x},${c.y}`);
    const las = p.lasers[level];
    for (const g of las?.gates ?? []) taken.add(`${g.x},${g.y}`);
    for (const w of las?.sweepers ?? []) taken.add(`${w.x},${w.y}`);
    const dogSecs = p.dogs.filter((d) => d.level === level).map((d) => sectionOfP(p, level, d.x, d.y));
    const secs = components(p, level, true).filter((c) => c.length >= 4).sort((a, b) => b.length - a.length);
    const free = secs.filter((sec) => !dogSecs.some((ds) => ds.some((c) => sec.some((q) => q.x === c.x && q.y === c.y))));
    for (const sec of [...free, ...secs]) {
      const cells = sec.filter((c) => !blockedP(p, level, c.x, c.y) && !taken.has(`${c.x},${c.y}`) && !(level === 0 && Math.hypot(c.x - p.start.x, c.y - p.start.y) < 5) && !(level === 0 && Math.hypot(c.x - p.exit.x, c.y - p.exit.y) < 3));
      const c = cells[Math.floor(rand() * cells.length)];
      if (c) {
        p.alphas.push({ level, x: c.x, y: c.y });
        break;
      }
    }
  }
}

/**
 * Up to two pylons in the lobby: free-standing double-height walls (highwall.ts) in cells under the openings above (no floor over them on the first floor up or the gallery, so six metres
 * clear), with a way round on every side, clear of the start, the way out, the guards' rounds, the dog and every strip the furniture keeps clear: the first well away from the street door, the
 * second near it (the guards' rounds and the dog are laid out after, round them). The lobby's keycard is then put in view of them (placeCards), and each gets its camera (pylonCameras).
 */
function placePylons(p: TowerPlanData, rand: () => number): void {
  p.pylons = [];
  const reserved = new Set<string>();
  for (const r of p.patrols) if (r.level === 0) for (const c of r.route) reserved.add(`${c.x},${c.y}`);
  for (const d of p.dogs) if (d.level === 0) reserved.add(`${d.x},${d.y}`);
  for (const g of p.posts) if (g.level === 0) reserved.add(`${g.x},${g.y}`);
  // Tiers, strictest first: six metres clear overhead and a free way round each side; then only the first floor up clear (the gallery's floor is at eight metres, above a climber's head); then
  // the guards' rounds may touch the neighbours.
  const picks: Cell[] = [];
  const tiers: Array<{ both: boolean; free: boolean }> = [{ both: true, free: true }, { both: false, free: true }, { both: false, free: false }];
  for (const tier of tiers) {
    if (picks.length >= 2) break;
    const cands: Array<{ x: number; y: number; d: number }> = [];
    for (let y = 1; y < p.rows - 1; y++) {
      for (let x = 1; x < p.cols - 1; x++) {
        if (!walkableP(p, 0, x, y) || blockedP(p, 0, x, y) || reserved.has(`${x},${y}`)) continue;
        if (hasFloorP(p, 1, x, y) || (tier.both && hasFloorP(p, 2, x, y))) continue;
        if (!([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).every(([dx, dy]) => walkableP(p, 0, x + dx, y + dy) && (!tier.free || !reserved.has(`${x + dx},${y + dy}`)))) continue;
        if (Math.hypot(x - p.start.x, y - p.start.y) < 3 || Math.hypot(x - p.exit.x, y - p.exit.y) < 3) continue;
        cands.push({ x, y, d: Math.hypot(x - p.start.x, y - p.start.y) + rand() * 0.5 });
      }
    }
    cands.sort((a, b) => b.d - a.d);
    for (const c of cands) {
      if (picks.length >= 2) break;
      // The second: not too near the first, and in its section (the two watch the same desk).
      if (picks.length === 1 && (Math.hypot(picks[0]!.x - c.x, picks[0]!.y - c.y) < 3 || !pylonSection(p, picks[0]!).some((q) => q.x === c.x && q.y === c.y))) continue;
      picks.push({ x: c.x, y: c.y });
    }
  }
  for (const c of picks) p.pylons.push({ level: 0, x: c.x, y: c.y });
}

/** The cells of the section a pylon stands in (its own cell is solid: a way round it is the section). */
function pylonSection(p: TowerPlanData, q: Cell): Cell[] {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) if (walkableP(p, 0, q.x + dx, q.y + dy)) return sectionOfP(p, 0, q.x + dx, q.y + dy);
  return [];
}

/** How far (in cells) a pylon's camera may be from the lobby's keycard: its range, a half circle, reaches it with room to spare. */
const PYLON_WATCH_MIN = 2;
/** Where there is no card position that near (a plan with one cell of void in its lobby), further out is allowed, step by step. */
const PYLON_WATCH_FAR = [4.6, 6.5, 9];

/**
 * A camera on each pylon, on its face toward the lobby's keycard, fixed and a half circle wide (a hundred and eighty degrees, no sweep), aimed straight at the keycard's desk. The card cannot be
 * taken while one of them has it in view (game.ts's takeTowerKey): climb a pylon (the far face is out of its cone), hang beside the panel and switch it off. A pylon too far from the card to
 * watch it (a plan with nowhere nearer) is dropped.
 */
function pylonCameras(p: TowerPlanData): void {
  const card = p.cards.find((c) => c.level === 0);
  if (!card) {
    p.pylons = [];
    return;
  }
  const kept: TowerPylon[] = [];
  for (const q of p.pylons) {
    const d = Math.hypot(q.x - card.x, q.y - card.y);
    if (d < PYLON_WATCH_MIN || d > PYLON_WATCH_FAR[PYLON_WATCH_FAR.length - 1]! + 1 || !pylonSection(p, q).some((c) => c.x === card.x && c.y === card.y)) continue;
    kept.push(q);
    const south = card.y >= q.y;
    const mx = q.x * 4;
    const mz = q.y * 4 + (south ? 0.55 : -0.55);
    const dx = card.x * 4 - mx;
    const dz = card.y * 4 - mz;
    p.cameras.push({ level: 0, x: mx, z: mz, face: Math.atan2(dx, dz), sweep: 0, period: 10, phase: 0, range: Math.hypot(dx, dz) + 4, half: Math.PI / 2, wall: south ? 'N' : 'S', high: true });
  }
  p.pylons = kept;
}

/**
 * The gallery's lasers, put where they have something to guard: a curtain sweeping across the keycard's desk, and, in front of the core climb (the way up to the offices), a sweeper
 * in the cell before the foot and a pulsing gate across the foot itself. Where the plan has no room for one (a wall in the way, an off-floor cell) the authored spot stays.
 */
function placeLasers(p: TowerPlanData): void {
  const level = 2;
  const cur = p.lasers[level];
  if (!cur) return;
  const play = playCellsP(p, level);
  const card = p.keycard.level === level ? p.keycard : undefined; // (the plan's own: the others are put later)
  if (card) {
    // A run of up to five open cells through the card's cell, along its row or (where the void or a wall closes the row) its column: the longer wins.
    const run = (along: 'x' | 'y'): { from: number; to: number } => {
      const lim = along === 'x' ? p.cols - 1 : p.rows - 1;
      const at = (i: number): { x: number; y: number } => (along === 'x' ? { x: i, y: card.y } : { x: card.x, y: i });
      const own = along === 'x' ? card.x : card.y;
      let from = own;
      let to = own;
      const back = along === 'x' ? 'W' : 'N';
      const fwd = along === 'x' ? 'E' : 'S';
      while (from > 0 && own - from < 2 && play[at(from).y]![at(from).x]![back] && walkableP(p, level, at(from - 1).x, at(from - 1).y)) from--;
      while (to < lim && to - own < 2 && play[at(to).y]![at(to).x]![fwd] && walkableP(p, level, at(to + 1).x, at(to + 1).y)) to++;
      return { from, to };
    };
    const rx = run('x');
    const ry = run('y');
    const alongX = rx.to - rx.from >= ry.to - ry.from;
    const best = alongX ? rx : ry;
    if (best.to - best.from >= 2) cur.sliders = [{ axis: alongX ? 'x' : 'z', at: alongX ? card.y : card.x, from: best.from, to: best.to, phase: 0.3, speed: 1.3 }];
  }
  const core = p.stairs.find((s) => s.id === 'core' && s.climb);
  if (core) {
    const foot = { x: core.x, y: core.y + core.run };
    if (walkableP(p, level, foot.x, foot.y)) cur.gates = [{ x: foot.x, y: foot.y, spanX: true, kind: 'pulse', phase: 0.2 }];
    const before = [{ x: foot.x, y: foot.y + 1 }, { x: foot.x + 1, y: foot.y }, { x: foot.x - 1, y: foot.y }].find((c) => walkableP(p, level, c.x, c.y));
    if (before) cur.sweepers = [{ x: before.x, y: before.y, phase: 0, dir: 1 }];
  }
}

/** The sections of a storey: its connected stretches of floor, the gaps in the partition walls dividing them. */
export const sectionsP = (p: TowerPlanData, level: number): Cell[][] => components(p, level, true);

/**
 * One keycard on each storey: the gallery's is where the plan puts it; the others each in the cell farthest (by walking) from where the agent arrives on that storey, a pick from the few farthest,
 * out of the security room and (on the top) in the front hall, not the back offices behind their doors.
 */
function placeCards(p: TowerPlanData, rand: () => number): void {
  const cards: TowerCard[] = [];
  const room = new Set(p.security.cells.map((c) => `${p.security.level},${c.x},${c.y}`));
  const officeY = p.officeDoors[0]?.y ?? p.rows;
  for (let level = 0; level < 4; level++) {
    if (level === p.keycard.level) {
      cards.push({ level, x: p.keycard.x, y: p.keycard.y });
      continue;
    }
    // Where the agent comes onto the storey: the street door, or the feet of the flights from below (the top: the core stair).
    const arrive: Cell[] = level === 0 ? [p.start] : p.stairs.filter((st) => touches(st, level) && (st.fromLevel === level ? st.toLevel : st.fromLevel) === level - 1).map((st) => (st.fromLevel === level ? { x: st.x, y: st.y - 1 } : { x: st.x, y: st.y + st.run }));
    const play = playCellsP(p, level);
    const dist = new Map<string, number>();
    const queue: Cell[] = [];
    for (const a of arrive) if (walkableP(p, level, a.x, a.y)) { dist.set(`${a.x},${a.y}`, 0); queue.push(a); }
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (play[c.y]![c.x]![d] && !dist.has(k)) {
          dist.set(k, dist.get(`${c.x},${c.y}`)! + 1);
          queue.push({ x: c.x + dx, y: c.y + dy });
        }
      }
    }
    const far = [...dist.entries()]
      .map(([k, d]) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]), d }))
      .filter((c) => c.d >= 3 && !blockedP(p, level, c.x, c.y) && !room.has(`${level},${c.x},${c.y}`) && !(level === OFFICES && c.y >= officeY) && !p.officeDoors.some((o) => o.level === level && o.x === c.x))
      .sort((a, b) => b.d - a.d);
    // The lobby's card is in view of the pylons (pylonCameras): in their section, a few cells from the nearest one, and as far from the street door as that allows.
    let watched: typeof far = [];
    if (level === 0 && p.pylons.length > 0) {
      for (const reach of PYLON_WATCH_FAR) {
        watched = far.filter((c) => p.pylons.some((q) => { const d = Math.hypot(q.x - c.x, q.y - c.y); return d >= PYLON_WATCH_MIN && d <= reach && pylonSection(p, q).some((s) => s.x === c.x && s.y === c.y); }));
        if (watched.length > 0) break;
      }
    }
    const pool = watched.length > 0 ? watched : far;
    const pick = pool[Math.floor(rand() * Math.min(4, pool.length))] ?? pool[0];
    if (pick) cards.push({ level, x: pick.x, y: pick.y });
  }
  p.cards = cards.sort((a, b) => a.level - b.level);
}

/** The section of `level` that holds cell (x, y): its cells. */
export function sectionOfP(p: TowerPlanData, level: number, x: number, y: number): Cell[] {
  return components(p, level, true).find((c) => c.some((q) => q.x === x && q.y === y)) ?? [{ x, y }];
}

/**
 * Whether a plan keeps the rules every tower must: the four shapes agree, the doors and stairs stand on floor, every walkable cell can be reached from the street door by stairs and bridge
 * (the lifts add nothing the stairs do not already reach), the keycard can be fetched without the key, the heist door can be reached from the top's stair, and so on. Returns what is wrong.
 */
export function validatePlan(p: TowerPlanData): string[] {
  const bad: string[] = [];
  const err = (m: string): void => void bad.push(`${p.id}: ${m}`);
  for (let l = 0; l < 4; l++) {
    if (p.floors[l]!.length !== p.rows || p.floors[l]!.some((r) => r.length !== p.cols)) err(`floor ${l} is not ${p.cols} by ${p.rows}`);
  }
  if (bad.length) return bad;
  const W = (l: number, x: number, y: number): boolean => walkableP(p, l, x, y);
  if (!W(0, p.start.x, p.start.y)) err('the street door is not on floor');
  if (!W(0, p.exit.x, p.exit.y)) err('the way out is not on floor');
  if (p.heist.y !== p.rows - 1 || !W(3, p.heist.x, p.heist.y)) err('the heist door is not in the top floor\'s south row on floor');
  for (const dx of [-1, 1]) if (!W(3, p.heist.x + dx, p.heist.y)) err('the heist door has no room either side');
  for (const s of p.stairs) {
    const lo = stairLow(s);
    if (Math.abs(s.fromLevel - s.toLevel) !== 1) err(`stair ${s.id} does not join neighbouring floors`);
    if (s.y - 1 < 0 || s.y + s.run > p.rows - 1 || s.x < 0 || s.x + s.width > p.cols) err(`stair ${s.id} is outside the plan`);
    for (const c of stairCells(s)) if (!mapFloor(p, lo, c.x, c.y)) err(`stair ${s.id} has no floor under it at ${c.x},${c.y}`);
    for (let x = s.x; x < s.x + s.width; x++) {
      if (!W(s.fromLevel, x, s.y - 1)) err(`stair ${s.id}'s north end ${x},${s.y - 1} is not floor on floor ${s.fromLevel}`);
      if (!W(s.toLevel, x, s.y + s.run)) err(`stair ${s.id}'s south end ${x},${s.y + s.run} is not floor on floor ${s.toLevel}`);
    }
    for (const t of p.stairs) {
      if (t === s) continue;
      for (const lvl of [s.fromLevel, s.toLevel]) {
        if (!touches(t, lvl)) continue;
        const own = stairCells(s).map((c) => `${c.x},${c.y}`);
        const theirs = [...stairCells(t), ...range(t.width, t.x).flatMap((x) => [{ x, y: t.y - 1 }, { x, y: t.y + t.run }])].map((c) => `${c.x},${c.y}`);
        if (own.some((k) => theirs.includes(k))) err(`stairs ${s.id} and ${t.id} meet on floor ${lvl}`);
      }
    }
  }
  for (const l of p.lifts) {
    for (const lvl of l.serves) {
      if (!mapFloor(p, lvl, l.x, l.y)) err(`lift ${l.id} has no floor on ${lvl}`);
      const f = liftFront(l);
      if (!W(lvl, f.x, f.y)) err(`lift ${l.id}'s doors open on nothing on floor ${lvl}`);
    }
  }
  const all = reachableP(p, false);
  const lost: string[] = [];
  for (let l = 0; l < 4; l++) for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.cols; x++) if (W(l, x, y) && !all.has(`${l},${x},${y}`)) lost.push(`${x},${y} on ${l}`);
  if (lost.length) err(`${lost.length} cells cannot be reached by the stairs and the bridge: ${lost.slice(0, 6).join('; ')}`);
  // The keycard without the key: the gallery's cell must be reached before the service lift is used (nothing needs the key to get to it).
  if (!all.has(`2,${p.keycard.x},${p.keycard.y}`)) err('the keycard cannot be fetched');
  // A keycard on every storey, on floor, reachable, and the gallery's is the plan's keycard.
  for (let l = 0; l < 4; l++) {
    const cs = p.cards.filter((c) => c.level === l);
    if (cs.length !== 1) err(`storey ${l} has ${cs.length} keycards, not one`);
    else if (!all.has(`${l},${cs[0]!.x},${cs[0]!.y}`)) err(`the keycard on storey ${l} cannot be reached`);
  }
  const gallery = p.cards.find((c) => c.level === p.keycard.level);
  if (gallery && (gallery.x !== p.keycard.x || gallery.y !== p.keycard.y)) err('the gallery keycard is not the plan\'s keycard');
  for (const b of p.bridges) {
    if (!W(b.level, b.fromX, b.y) || !W(b.level, b.toX, b.y)) err('a bridge landing is not floor');
    for (let x = b.fromX + 1; x < b.toX; x++) if (hasFloorP(p, b.level, x, b.y)) err(`the bridge crosses floor at ${x},${b.y}`);
    // Without the bridge the gallery is in two (a bridge that joins nothing is no bridge).
    const noBridge = { ...p, bridges: [] };
    const reach = reachableP(noBridge, false);
    if ([...all].filter((k) => k.startsWith('2,')).length === [...reach].filter((k) => k.startsWith('2,')).length) err('the gallery does not need its bridge');
  }
  for (const d of p.officeDoors) {
    if (!W(3, d.x, d.y) || !W(3, d.x, d.y - 1)) err(`an office door at ${d.x},${d.y} has no floor on both sides`);
  }
  for (const c of p.security.cells) if (!W(1, c.x, c.y)) err(`the security room's ${c.x},${c.y} is not floor`);
  for (const r of p.patrols) {
    const play = playCellsP(p, r.level);
    const seen = new Set<string>([`${r.route[0]!.x},${r.route[0]!.y}`]);
    const q = [r.route[0]!];
    while (q.length) {
      const c = q.shift()!;
      for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (play[c.y]![c.x]![d] && !seen.has(k)) {
          seen.add(k);
          q.push({ x: c.x + dx, y: c.y + dy });
        }
      }
    }
    for (const c of r.route) {
      if (!W(r.level, c.x, c.y)) err(`a round on floor ${r.level} stands off the floor at ${c.x},${c.y}`);
      else if (!seen.has(`${c.x},${c.y}`)) err(`a round on floor ${r.level} cannot be walked: ${c.x},${c.y}`);
    }
  }
  for (const g of p.posts) if (!W(g.level, g.x, g.y)) err(`a post on floor ${g.level} is off the floor at ${g.x},${g.y}`);
  for (const d of p.dogs) if (!W(d.level, d.x, d.y)) err(`a dog on floor ${d.level} is off the floor at ${d.x},${d.y}`);
  for (const a of p.alphas) if (!W(a.level, a.x, a.y)) err(`an alpha on floor ${a.level} is off the floor at ${a.x},${a.y}`);
  const lasers = p.lasers[2];
  for (const sw of lasers?.sweepers ?? []) if (!W(2, sw.x, sw.y)) err('a sweeper is off the floor');
  for (const g of lasers?.gates ?? []) if (!W(2, g.x, g.y)) err('a gate is off the floor');
  for (const sl of lasers?.sliders ?? []) for (let i = sl.from; i <= sl.to; i++) if (!(sl.axis === 'x' ? W(2, i, sl.at) : W(2, sl.at, i))) err('a slider runs off the floor');
  for (const c of p.fixed) {
    if (c.kind !== 'console') continue;
    for (const cam of p.cameras) if (cam.level === c.level && Math.hypot(cam.x - c.x * 4, cam.z - c.y * 4) < 3.5) err(`a camera's panel is beside the console at ${c.x},${c.y}`);
  }
  for (const cam of p.cameras) {
    // The cell in front of a camera's panel must be somewhere the agent can stand (not a stair's foot, not a drop).
    const cx = Math.min(p.cols - 1, Math.max(0, Math.round(cam.x / 4)));
    const cy = Math.min(p.rows - 1, Math.max(0, Math.round(cam.z / 4) + (cam.high ? (cam.wall === 'S' ? -1 : 1) : 0))); // (a pylon camera is on a face: its own cell is the pylon, the floor to stand on is the next one out)
    if (!walkableP(p, cam.level, cx, cy)) err(`a camera's panel at ${cx},${cy} has no floor to stand on in front of it`);
  }
  for (const c of p.cameras) if (c.x > -3 && c.x < p.cols * 4 + 3 && (c.z < -3 || c.z > p.rows * 4 + 3)) err('a camera is off the building');
  return bad;
}

// ---- variants: the same building, laid out another way ----

/** A spec turned left for right: every column counted from the other side (the stairs, lifts, rooms, doors, cameras, lasers and the rest, and which wall each is on). */
function mirrorSpec(s: Spec): Spec {
  const mx = (x: number): number => s.cols - 1 - x;
  const span = (x: number, width: number): number => s.cols - x - width; // the left edge of something `width` cells wide, mirrored
  const side = (d: 'N' | 'S' | 'E' | 'W'): 'N' | 'S' | 'E' | 'W' => (d === 'E' ? 'W' : d === 'W' ? 'E' : d);
  const flipOps = (ops: readonly Rect[]): Rect[] => ops.map(([op, x0, y0, x1, y1]): Rect => [op, mx(x1), y0, mx(x0), y1]);
  return {
    ...s,
    ops: [flipOps(s.ops[0]), flipOps(s.ops[1]), flipOps(s.ops[2]), flipOps(s.ops[3])],
    start: { x: mx(s.start.x), y: s.start.y },
    exit: { x: mx(s.exit.x), y: s.exit.y },
    grand: s.grand.map((g) => ({ ...g, x: span(g.x, g.width) })).reverse(),
    wide: { ...s.wide, x: span(s.wide.x, s.wide.width) },
    core: { ...s.core, x: mx(s.core.x) },
    liftA: { ...s.liftA, x: mx(s.liftA.x) },
    liftB: { ...s.liftB, x: mx(s.liftB.x) },
    keycard: { x: mx(s.keycard.x), y: s.keycard.y },
    bridge: { y: s.bridge.y, fromX: mx(s.bridge.toX), toX: mx(s.bridge.fromX) },
    security: { ...s.security, x: span(s.security.x, s.security.w), door: side(s.security.door), console: side(s.security.console), at: s.security.door === 'N' || s.security.door === 'S' ? mx(s.security.at) : s.security.at },
    offices: { ...s.offices, doors: s.offices.doors.map(mx).sort((a, b) => a - b), ...(s.offices.corridorX === undefined ? {} : { corridorX: mx(s.offices.corridorX), corridorSide: s.offices.corridorSide === 'E' ? ('W' as const) : ('E' as const) }) },
    heistX: mx(s.heistX),
    cameras: s.cameras.map((c) => ({ ...c, side: side(c.side), at: c.side === 'N' || c.side === 'S' ? mx(c.at) : c.at })),
    reception: { x: mx(s.reception.x), y: s.reception.y },
    lasers: {
      sweeper: { x: mx(s.lasers.sweeper.x), y: s.lasers.sweeper.y },
      slider: s.lasers.slider.axis === 'x' ? { ...s.lasers.slider, from: mx(s.lasers.slider.to), to: mx(s.lasers.slider.from) } : { ...s.lasers.slider, at: mx(s.lasers.slider.at) },
      gate: { ...s.lasers.gate, x: mx(s.lasers.gate.x) },
    },
    stairConsole: { x: mx(s.stairConsole.x), y: s.stairConsole.y, edge: side(s.stairConsole.edge), ...(s.stairConsole.along === undefined ? {} : { along: s.stairConsole.edge === 'N' || s.stairConsole.edge === 'S' ? -s.stairConsole.along : s.stairConsole.along }) },
    ...(s.rail ? { rail: { x: mx(s.rail.x), y: s.rail.y } } : {}),
    ...(s.extraWalls ? { extraWalls: s.extraWalls.map((w) => ({ ...w, x: w.dir === 'W' ? mx(w.x) + 1 : mx(w.x) })) } : {}),
  };
}

/** The spec a seed asks for: seed 0 is the plan as authored; any other seed may turn it left for right and nudge the reception desk and the cameras along their walls. */
function variantSpec(base: Spec, seed: number, attempt: number): Spec {
  if (seed === 0 || attempt >= 6) return base;
  const rand = makeRng(seed * 2654435 + attempt * 40503 + base.id.length);
  let s = rand() < 0.5 ? mirrorSpec(base) : base;
  const nudge = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v + (rand() < 0.34 ? -1 : rand() < 0.5 ? 1 : 0)));
  s = {
    ...s,
    reception: { x: nudge(s.reception.x, 2, s.cols - 3), y: s.reception.y },
    cameras: s.cameras.map((c) => ({ ...c, at: c.side === 'N' || c.side === 'S' ? nudge(c.at, 1, s.cols - 2) : nudge(c.at, 1, s.rows - 2) })),
  };
  return s;
}

/** Builds a place's plan from its spec for a seed, falling back through other variants (and finally the authored plan) if a variant breaks a rule. */
function makePlan(base: Spec, seed: number): TowerPlanData {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const p = buildPlan(variantSpec(base, seed, attempt), seed + attempt * 1000003);
    p.seed = seed;
    if (validatePlan(p).length === 0) return p;
  }
  const p = buildPlan(base, seed);
  p.seed = seed;
  return p;
}

// ---- the plans ----

const CAMPUS_SPEC: Spec = {
  id: 'campus',
  cols: 11,
  rows: 8,
  ops: [
    [['+', 0, 0, 10, 7]],
    [['+', 0, 4, 10, 7]],
    [['+', 0, 4, 10, 7], ['-', 4, 4, 6, 6], ['+', 0, 1, 0, 3], ['+', 10, 1, 10, 3]],
    [['+', 0, 0, 10, 7], ['-', 10, 0, 10, 0]],
  ],
  start: { x: 0, y: 0 },
  exit: { x: 0, y: 7 },
  grand: [{ x: 1, y: 1, width: 1 }, { x: 9, y: 1, width: 1 }],
  wide: { x: 4, y: 5, width: 3 },
  core: { x: 0, y: 1 },
  liftA: { x: 8, y: 7, opens: 'N' },
  liftB: { x: 10, y: 1, opens: 'S' },
  keycard: { x: 10, y: 3 },
  bridge: { y: 4, fromX: 3, toX: 7 },
  security: { x: 9, y: 5, w: 2, h: 3, door: 'W', at: 5, console: 'E' },
  offices: { y: 4, doors: [2, 7], corridorX: 10, corridorFrom: 1, corridorTo: 6 },
  heistX: 5,
  cameras: [{ side: 'W', at: 5 }, { side: 'E', at: 4 }, { side: 'S', at: 5, range: 16 }],
  reception: { x: 5, y: 6 },
  lasers: { sweeper: { x: 0, y: 5 }, slider: { axis: 'x', at: 7, from: 3, to: 6 }, gate: { x: 10, y: 2, spanX: true } },
  stairConsole: { x: 2, y: 5, edge: 'N' },
  extraWalls: [{ level: 2, x: 7, y: 7, dir: 'W' }, { level: 2, x: 3, y: 7, dir: 'N' }, { level: 2, x: 1, y: 5, dir: 'W' }, { level: 2, x: 1, y: 6, dir: 'W' }, { level: 2, x: 1, y: 4, dir: 'W' }],
};
const CAMPUS = (seed = 0): TowerPlanData => makePlan(CAMPUS_SPEC, seed);

/** The museum: a long great hall, with a U of galleries round it on the first floor up, two sculpture wings over the hall joined by a bridge, and the curators' wing on top. */
const MUSEUM_SPEC: Spec = {
    id: 'museum',
    cols: 13,
    rows: 8,
    ops: [
      [['+', 0, 0, 12, 7]],
      [['+', 0, 5, 12, 7], ['+', 0, 1, 1, 4], ['+', 11, 1, 12, 4]],
      [['+', 0, 0, 4, 7], ['+', 8, 0, 12, 7]],
      [['+', 0, 0, 12, 7]],
    ],
    start: { x: 0, y: 0 },
    exit: { x: 12, y: 7 },
    grand: [{ x: 5, y: 2, width: 3 }],
    wide: { x: 0, y: 1, width: 2, flip: true },
    core: { x: 11, y: 1 },
    liftA: { x: 3, y: 7, opens: 'N' },
    liftB: { x: 12, y: 0, opens: 'S' },
    keycard: { x: 12, y: 2 },
    bridge: { y: 4, fromX: 4, toX: 8 },
    security: { x: 11, y: 1, w: 2, h: 2, door: 'S', at: 11, console: 'N' },
    offices: { y: 4, doors: [3, 9], corridorX: 12, corridorFrom: 1, corridorTo: 6 },
    heistX: 6,
    cameras: [{ side: 'W', at: 3 }, { side: 'E', at: 3 }, { side: 'S', at: 6, range: 16 }],
    reception: { x: 6, y: 6 },
    lasers: { sweeper: { x: 11, y: 5 }, slider: { axis: 'x', at: 6, from: 8, to: 11 }, gate: { x: 12, y: 1, spanX: true } },
    stairConsole: { x: 10, y: 4, edge: 'S' },
};
const MUSEUM = (seed = 0): TowerPlanData => makePlan(MUSEUM_SPEC, seed);

/** The refinery: a pump hall, a catwalk ring round a tank well, two boiler decks across a slot joined by a bridge, a control room on top. */
const REFINERY_SPEC: Spec = {
    id: 'refinery',
    cols: 11,
    rows: 9,
    ops: [
      [['+', 0, 0, 10, 8]],
      [['+', 0, 0, 10, 8], ['-', 3, 2, 7, 6]],
      [['+', 0, 0, 4, 8], ['+', 6, 0, 10, 8]],
      [['+', 0, 0, 10, 8]],
    ],
    start: { x: 0, y: 0 },
    exit: { x: 10, y: 8 },
    grand: [{ x: 1, y: 2, width: 1 }, { x: 9, y: 2, width: 1 }],
    wide: { x: 2, y: 6, width: 1, flip: true },
    core: { x: 2, y: 1 },
    liftA: { x: 0, y: 6, opens: 'N' },
    liftB: { x: 10, y: 0, opens: 'S' },
    keycard: { x: 10, y: 2 },
    bridge: { y: 4, fromX: 4, toX: 6 },
    security: { x: 0, y: 7, w: 2, h: 2, door: 'E', at: 8, console: 'W' },
    offices: { y: 5, doors: [2, 8], corridorX: 10, corridorFrom: 1, corridorTo: 7 },
    heistX: 5,
    cameras: [{ side: 'W', at: 4 }, { side: 'E', at: 4 }, { side: 'S', at: 5, range: 16 }],
    reception: { x: 5, y: 6 },
    lasers: { sweeper: { x: 2, y: 4 }, slider: { axis: 'x', at: 8, from: 0, to: 4 }, gate: { x: 10, y: 1, spanX: true } },
    stairConsole: { x: 4, y: 6, edge: 'E' },
};
const REFINERY = (seed = 0): TowerPlanData => makePlan(REFINERY_SPEC, seed);

/** The bank: a banking hall under a mezzanine ring, a deposit level in two blocks across a slot, the vault level on top. */
const BANK_SPEC: Spec = {
    id: 'bank',
    cols: 11,
    rows: 9,
    ops: [
      [['+', 0, 0, 10, 8]],
      [['+', 0, 0, 10, 8], ['-', 2, 2, 8, 6]],
      [['+', 0, 0, 3, 8], ['+', 7, 0, 10, 8]],
      [['+', 0, 0, 10, 8]],
    ],
    start: { x: 5, y: 0 },
    exit: { x: 5, y: 8 },
    grand: [{ x: 0, y: 1, width: 1 }, { x: 10, y: 1, width: 1 }],
    wide: { x: 1, y: 6, width: 1, flip: true },
    core: { x: 9, y: 1 },
    liftA: { x: 10, y: 6, opens: 'N' },
    liftB: { x: 7, y: 0, opens: 'S' },
    keycard: { x: 7, y: 2 },
    bridge: { y: 4, fromX: 3, toX: 7 },
    security: { x: 4, y: 7, w: 2, h: 2, door: 'W', at: 8, console: 'E' },
    offices: { y: 5, doors: [2, 8] },
    heistX: 5,
    cameras: [{ side: 'W', at: 4 }, { side: 'E', at: 4 }, { side: 'S', at: 8, range: 16 }],
    reception: { x: 5, y: 6 },
    lasers: { sweeper: { x: 9, y: 5 }, slider: { axis: 'x', at: 7, from: 7, to: 10 }, gate: { x: 7, y: 1, spanX: true } },
    stairConsole: { x: 7, y: 5, edge: 'W' },
};
const BANK = (seed = 0): TowerPlanData => makePlan(BANK_SPEC, seed);

/** The warehouse: a wide yard under a mezzanine along the north wall, two catwalk decks over it joined by a long bridge, dispatch offices on top. */
const WAREHOUSE_SPEC: Spec = {
    id: 'warehouse',
    cols: 14,
    rows: 7,
    ops: [
      [['+', 0, 0, 13, 6]],
      [['+', 0, 0, 13, 2], ['+', 11, 3, 13, 6]],
      [['+', 0, 0, 5, 6], ['+', 9, 0, 13, 6]],
      [['+', 0, 0, 13, 6]],
    ],
    start: { x: 0, y: 6 },
    exit: { x: 13, y: 6 },
    grand: [{ x: 3, y: 3, width: 1, flip: true }, { x: 8, y: 3, width: 1, flip: true }],
    wide: { x: 12, y: 3, width: 2 },
    core: { x: 1, y: 1 },
    liftA: { x: 10, y: 2, opens: 'N' },
    liftB: { x: 9, y: 0, opens: 'S' },
    keycard: { x: 9, y: 2 },
    bridge: { y: 3, fromX: 5, toX: 9 },
    security: { x: 12, y: 5, w: 2, h: 2, door: 'W', at: 6, console: 'E' },
    offices: { y: 3, doors: [2, 11] },
    heistX: 6,
    cameras: [{ side: 'W', at: 1 }, { side: 'E', at: 2 }, { side: 'S', at: 12, range: 16 }],
    reception: { x: 6, y: 3 },
    lasers: { sweeper: { x: 1, y: 5 }, slider: { axis: 'x', at: 6, from: 9, to: 13 }, gate: { x: 9, y: 1, spanX: true } },
    stairConsole: { x: 5, y: 5, edge: 'E' },
};
const WAREHOUSE = (seed = 0): TowerPlanData => makePlan(WAREHOUSE_SPEC, seed);

/** The lab: a cross-shaped building, a mezzanine ring round a glass well, two wings across a slot joined by a bridge, the director's labs on top. */
const LAB_SPEC: Spec = {
    id: 'lab',
    cols: 11,
    rows: 11,
    ops: [
      [['+', 3, 0, 7, 10], ['+', 0, 3, 10, 7]],
      [['+', 3, 0, 7, 10], ['+', 0, 3, 10, 7], ['-', 5, 5, 5, 5]],
      [['+', 3, 0, 4, 10], ['+', 0, 3, 4, 7], ['+', 6, 0, 7, 10], ['+', 6, 3, 10, 7]],
      [['+', 3, 0, 7, 10], ['+', 0, 3, 10, 7]],
    ],
    start: { x: 5, y: 0 },
    exit: { x: 5, y: 10 },
    grand: [{ x: 3, y: 1, width: 1 }, { x: 7, y: 1, width: 1 }],
    wide: { x: 1, y: 4, width: 1 },
    core: { x: 7, y: 1 },
    liftA: { x: 9, y: 6, opens: 'N' },
    liftB: { x: 10, y: 3, opens: 'S' },
    keycard: { x: 10, y: 5 },
    bridge: { y: 5, fromX: 4, toX: 6 },
    security: { x: 5, y: 0, w: 1, h: 2, door: 'S', at: 5, console: 'N' },
    offices: { y: 8, doors: [4, 6] },
    heistX: 5,
    cameras: [{ side: 'W', at: 5 }, { side: 'E', at: 5 }, { side: 'N', at: 3, range: 16 }],
    reception: { x: 5, y: 6 },
    lasers: { sweeper: { x: 7, y: 4 }, slider: { axis: 'x', at: 7, from: 6, to: 10 }, gate: { x: 10, y: 4, spanX: true } },
    stairConsole: { x: 4, y: 6, edge: 'E' },
};
const LAB = (seed = 0): TowerPlanData => makePlan(LAB_SPEC, seed);

/** The authored specs (for the tests: a variant is a spec turned or nudged). */
export const TOWER_SPECS = (): Record<TowerSetId, Spec> => ({ campus: CAMPUS_SPEC, museum: MUSEUM_SPEC, refinery: REFINERY_SPEC, bank: BANK_SPEC, warehouse: WAREHOUSE_SPEC, lab: LAB_SPEC });
export { mirrorSpec, buildPlan as buildPlanFromSpec };
export type { Spec as TowerSpec };

export const TOWER_PLANS: Record<TowerSetId, (seed?: number) => TowerPlanData> = {
  campus: CAMPUS,
  museum: MUSEUM,
  refinery: REFINERY,
  bank: BANK,
  warehouse: WAREHOUSE,
  lab: LAB,
};

// ---- the active plan ----

let ACTIVE: TowerPlanData = TOWER_PLANS.campus();
const BUILT = new Map<string, TowerPlanData>();

export let TOWER_COLS = ACTIVE.cols;
export let TOWER_ROWS = ACTIVE.rows;
export let TOWER_STAIRS: readonly TowerStair[] = ACTIVE.stairs;
export let TOWER_LIFTS: readonly TowerLift[] = ACTIVE.lifts;
export let TOWER_KEYCARD: { level: number; x: number; y: number } = ACTIVE.keycard;
export let TOWER_CARDS: readonly TowerCard[] = ACTIVE.cards;
export let TOWER_EXIT: Cell = ACTIVE.exit;
export let TOWER_START: Cell = ACTIVE.start;
export let HEIST_DOOR: Cell = ACTIVE.heist;
export let HEIST_LIFT: Cell = ACTIVE.heistLift;
export let TOWER_WALLS: Readonly<Record<number, readonly TowerWall[]>> = ACTIVE.walls;
export let TOWER_BRIDGES: readonly TowerBridge[] = ACTIVE.bridges;
export let TOWER_LASERS: Readonly<Record<number, { sweepers: Sweeper[]; sliders: Slider[]; gates: Gate[]; lines?: LineLaser[] }>> = ACTIVE.lasers;
export let TOWER_PATROLS: readonly TowerPatrol[] = ACTIVE.patrols;
export let TOWER_OFFICE_DOORS: readonly { level: number; x: number; y: number }[] = ACTIVE.officeDoors;
export let TOWER_POSTS: readonly TowerPost[] = ACTIVE.posts;
export let TOWER_CAMERAS: readonly CameraPlan[] = ACTIVE.cameras;
export let TOWER_SECURITY: { level: number; cells: Cell[] } = ACTIVE.security;
export let TOWER_DOGS: readonly TowerDog[] = ACTIVE.dogs;
export let TOWER_ALPHAS: readonly TowerDog[] = ACTIVE.alphas;
export let TOWER_PYLONS: readonly TowerPylon[] = ACTIVE.pylons;
export let TOWER_BRIDGE_BONUS: { level: number; x: number; z: number } = ACTIVE.bridgeBonus;
export let TOWER_FIXED: readonly Piece[] = ACTIVE.fixed;
export let TOWER_PLAN_ID: TowerSetId = ACTIVE.id;

/** Makes the plan of tower `id` the active one: the constants above (and the functions below) are then that tower's. */
export function selectTowerPlan(id: TowerSetId, seed = 0): TowerPlanData {
  const key = `${id}:${seed}`;
  let p = BUILT.get(key);
  if (!p) {
    p = TOWER_PLANS[id](seed);
    BUILT.set(key, p);
    // (A day's tower is asked for again and again; a one-off random one is not worth keeping: only the last few are.)
    if (BUILT.size > 12) BUILT.delete(BUILT.keys().next().value!);
  }
  ACTIVE = p;
  TOWER_COLS = p.cols;
  TOWER_ROWS = p.rows;
  TOWER_STAIRS = p.stairs;
  TOWER_LIFTS = p.lifts;
  TOWER_KEYCARD = p.keycard;
  TOWER_CARDS = p.cards;
  TOWER_EXIT = p.exit;
  TOWER_START = p.start;
  HEIST_DOOR = p.heist;
  HEIST_LIFT = p.heistLift;
  TOWER_WALLS = p.walls;
  TOWER_BRIDGES = p.bridges;
  TOWER_LASERS = p.lasers;
  TOWER_PATROLS = p.patrols;
  TOWER_OFFICE_DOORS = p.officeDoors;
  TOWER_POSTS = p.posts;
  TOWER_CAMERAS = p.cameras;
  TOWER_SECURITY = p.security;
  TOWER_DOGS = p.dogs;
  TOWER_ALPHAS = p.alphas;
  TOWER_PYLONS = p.pylons;
  TOWER_BRIDGE_BONUS = p.bridgeBonus;
  TOWER_FIXED = p.fixed;
  TOWER_PLAN_ID = p.id;
  return p;
}

export const activePlan = (): TowerPlanData => ACTIVE;
/** The section of storey `level` that holds cell (x, y). */
export const sectionOf = (level: number, x: number, y: number): Cell[] => sectionOfP(ACTIVE, level, x, y);

/** Whether this storey has floor under the cell (before stairs and lifts are taken out of it, bar where a flight comes up through it). */
export const hasFloor = (level: number, x: number, y: number): boolean => hasFloorP(ACTIVE, level, x, y);
/** Whether someone can stand in the cell: floor, and not a stair's footprint or a lift's cab. */
export const walkable = (level: number, x: number, y: number): boolean => walkableP(ACTIVE, level, x, y);
export const playCells = (level: number): Open[][] => playCellsP(ACTIVE, level);
export const drawCells = (level: number): Open[][] => drawCellsP(ACTIVE, level);
export const railsFor = (level: number): TowerRail[] => railsForP(ACTIVE, level);
export const reachable = (lifts: boolean): Set<string> => reachableP(ACTIVE, lifts);
export const towerBlocked = (level: number, x: number, y: number): boolean => blockedP(ACTIVE, level, x, y);
export const ledgeSpans = (level: number): LedgeSpan[] => ledgeSpansP(ACTIVE, level);

/** The stairs as the game's own kind (maze.ts's Stair), at the given storey height. */
export function gameStairs(floorHeight: number): Array<{ x: number; y: number; spanX: boolean; fromFloorY: number; toFloorY: number; run: number; width: number; id: string }> {
  return TOWER_STAIRS.filter((s) => !s.climb).map((s) => ({ id: s.id, x: s.x, y: s.y, spanX: true, run: s.run, width: s.width, fromFloorY: s.fromLevel * floorHeight, toFloorY: s.toLevel * floorHeight }));
}

/** A climb's tall wall: on the lower storey, across the upper end of the stair's footprint (`edge`, world z), for `x0` to `x1` (world x); `nz` the way it faces (toward the footprint); up to the opening's edge on `toLevel`. */
export type ClimbWall = { id: string; level: number; toLevel: number; x0: number; x1: number; edge: number; nz: 1 | -1 };

/** The climb walls standing on a storey. */
export function climbWallsP(p: TowerPlanData, level: number): ClimbWall[] {
  return p.stairs
    .filter((s) => s.climb && stairLow(s) === level)
    .map((s) => {
      // The upper end of the footprint: the north edge when the flight's north end is the high one, else the south.
      const north = s.fromLevel > s.toLevel;
      return { id: s.id, level, toLevel: stairHigh(s), x0: s.x * 4 - 2, x1: (s.x + s.width) * 4 - 2, edge: north ? s.y * 4 - 2 : (s.y + s.run) * 4 - 2, nz: north ? 1 : -1 };
    });
}
export const climbWalls = (level: number): ClimbWall[] => climbWallsP(ACTIVE, level);

/** A storey's play cells as a training map (tutorial.ts's parseTraining format), with the start and the way out marked on the lobby. */
export function levelMap(level: number): string[] {
  const cells = playCells(level);
  const g: string[][] = Array.from({ length: TOWER_ROWS * 2 + 1 }, () => Array.from({ length: TOWER_COLS * 2 + 1 }, () => '#'));
  for (let y = 0; y < TOWER_ROWS; y++) {
    for (let x = 0; x < TOWER_COLS; x++) {
      if (!walkable(level, x, y)) continue;
      g[2 * y + 1]![2 * x + 1] = ' ';
      if (cells[y]![x]!.E) g[2 * y + 1]![2 * x + 2] = ' ';
      if (cells[y]![x]!.S) g[2 * y + 2]![2 * x + 1] = ' ';
    }
  }
  if (level === LOBBY) {
    g[2 * TOWER_START.y + 1]![2 * TOWER_START.x + 1] = '@';
    g[2 * TOWER_EXIT.y + 1]![2 * TOWER_EXIT.x + 1] = 'X';
  }
  return g.map((r) => r.join(''));
}

/**
 * Whether a line from one point to another, across storeys, passes clear of every floor between them: down through a void, over a balcony's edge, not through a floor. Points are world
 * metres (eye height); a floor is solid where the plan has floor, or a lift cab. Used to let a guard on one storey see the agent on another, and the agent see the guard.
 */
export function sightAcross(floorHeight: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, cell = 4): boolean {
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  if (hi - lo < 1e-6) return false; // the same height: one storey, and its own walls decide
  for (let level = 1; level < TOWER_LEVELS.length; level++) {
    const planeY = level * floorHeight;
    if (planeY <= lo || planeY >= hi) continue;
    const t = (planeY - a.y) / (b.y - a.y);
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    // The one who looks down leans on the rail: the floor under their own feet is not in the way if it ends (at a drop) within their lean, in the way they are looking.
    const higher = a.y > b.y ? a : b;
    const lower = higher === a ? b : a;
    if (higher.y - planeY < 2.2 && Math.hypot(px - higher.x, pz - higher.z) <= LEAN_M) {
      const run = Math.hypot(lower.x - higher.x, lower.z - higher.z) || 1;
      const lean = Math.min(LEAN_M, run);
      const qx = Math.round((higher.x + ((lower.x - higher.x) / run) * lean) / cell);
      const qz = Math.round((higher.z + ((lower.z - higher.z) / run) * lean) / cell);
      if (!hasFloor(level, qx, qz) && !isLiftP(ACTIVE, level, qx, qz)) continue;
    }
    if (hasFloor(level, Math.round(px / cell), Math.round(pz / cell)) || isLiftP(ACTIVE, level, Math.round(px / cell), Math.round(pz / cell))) return false;
  }
  return true;
}

/** The nearest ledge the agent standing at (x, z) on `level` can vault: within `reach` of a rail's line, on the floor side of it, along its length. `at` is how far along it. */
export function ledgeNear(level: number, x: number, z: number, reach = 1.2): { span: LedgeSpan; at: number; dist: number } | null {
  let best: { span: LedgeSpan; at: number; dist: number } | null = null;
  for (const span of ledgeSpans(level)) {
    const along = span.axis === 'x' ? x : z;
    const across = span.axis === 'x' ? z : x;
    const n = span.axis === 'x' ? span.nz : span.nx;
    const inside = (span.fixed - across) * n; // positive on the floor side
    if (inside < -0.15 || inside > reach || along < span.from - 0.2 || along > span.to + 0.2) continue;
    if (!best || inside < best.dist) best = { span, at: Math.max(span.from, Math.min(span.to, along)), dist: inside };
  }
  return best;
}

/** The tower's plan as the furniture generator wants it (towerfurniture.ts's LayoutPlan): live, it follows the active plan. */
export const TOWER_LAYOUT = {
  get cols(): number {
    return TOWER_COLS;
  },
  get rows(): number {
    return TOWER_ROWS;
  },
  levels: TOWER_LEVELS.length,
  get seed(): number {
    return ACTIVE.seed;
  },
  walkable,
  playCells,
  blocked: towerBlocked,
  keepClear: (level: number) => keepClearP(ACTIVE, level),
  wallRects: (level: number) => wallRectsP(ACTIVE, level),
  get fixed(): readonly Piece[] {
    return TOWER_FIXED;
  },
};

