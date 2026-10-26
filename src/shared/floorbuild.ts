// Builds a level's floors for the verifier, without a browser: the game's own generators and placement run under a seeded random, and what they put where is
// written down as plain data (verify.ts's VerifyFloor) for the V2 and V3 checks. It follows the order game.ts's startJob and populateFloor build in (the plan,
// the exit, the stair, the contract's steps, then each floor's doors and rooms, enemies, crates and lasers), so what is verified is what the game would build from
// the same plan, floor for floor; what it leaves out is said at the end.
//
// The generators are passed in, not imported: they live in src/client, and this file is in src/shared, a separate project that can't reach into the client (tsc's
// rootDir). Anything with the shapes of FloorGenerators will do; floorbuild.test.ts wires the real ones, and a server can do the same (api/ imports the client
// files with their .ts extensions). Pure apart from the generators it is given, so it's unit-tested under Node.
//
// Left out, because each needs the scene or has nothing to check: the ceiling pipes, cameras, blackout patches, staff lockers, vents, the way in (hatch or grate),
// sentries and heavies (they stand at a room's door), and the decorative rooms' look. They take cells from `used` in the game, so a floor built here can differ from the
// game's in where the last few small things sit (never in the plan, the exit, the stair or the doors, which are placed first).

import { BUILD_PHASE, carveAlcoves, effectiveSize, enemyPhase, hazardPhase, inspectSpec, phaseSeed, twistedRoster, type ContractId, type LayoutId, type LevelSpec, type PlaceId, type Pt } from './levelspec.ts';
import { checkFloors, checkSpec, type Cell, type Dir, type EnemyKind, type Expect, type Failure, type HazardKind, type Station, type VerifyFloor, type VerifyOptions, type VerifyResult } from './verify.ts';

type Spot = Pt & { spanX: boolean };
type Rect = { x0: number; y0: number; w: number; h: number };

/** A floor plan with what layouts.ts remembers about it: the big room carved into it, and the spur a stair needs. */
export type Plan = { cells: Cell[][]; landmark: Rect | null; spur: Pt[] | null };

/** What the game's own modules provide, by the names and shapes they have there (maze.ts, layouts.ts, building.ts, security.ts, the laser and shutter placers, objectives.ts, seeded.ts). */
export type FloorGenerators = {
  /** seeded.ts: Math.random becomes the seeded one until restoreRandom. */
  seedRandom(seed: number): void;
  restoreRandom(): void;
  /** A floor plan in `layout` for `place` (the maze, or layouts.ts's generateLayout with the place's landmark), with its landmark and stair spur. */
  plan(place: PlaceId, layout: LayoutId, floor: 0 | 1, cols: number, rows: number): Plan;
  bfs(cells: Cell[][], cols: number, rows: number, sx: number, sy: number): number[][];
  farthestCell(cells: Cell[][], cols: number, rows: number, sx: number, sy: number, ok?: (x: number, y: number) => boolean): Pt;
  placeStair(cols: number, rows: number, cells: Cell[][], dist: number[][], used: Set<string>, run?: number, prefer?: Pt | null): Spot | null;
  stairReserved(stair: Spot, run: number): Pt[];
  planSecurity(
    cells: Cell[][],
    cols: number,
    rows: number,
    dist: number[][],
    spawn: Pt,
    used: Set<string>,
    counts: { doors: number; storage: number; decor: number; chain?: boolean; network?: ReadonlyArray<'uplink' | 'logs'>; entry?: ((open: (x: number, y: number) => boolean, taken: ReadonlySet<string>) => Pt | null) | undefined }
  ): { doors: Array<Pt & { id: number; dir: Dir }>; rooms: Array<Pt & { kind: string; keyId: number | null }> };
  placeBotSpawn(cols: number, rows: number, dist: number[][], used: Set<string>): Pt | null;
  placeHidingSpots(cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Pt[];
  placeLaserTraps(cols: number, rows: number, cells: Cell[][], dist: number[][], used: Set<string>, count: number): Pt[];
  placeSweepers(cells: Cell[][], cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Pt[];
  placeSliders(cells: Cell[][], cols: number, rows: number, dist: number[][], used: Set<string>, count: number, length?: number, fast?: number): Array<{ axis: 'x' | 'z'; at: number; from: number; to: number }>;
  placeLines(cells: Cell[][], cols: number, rows: number, dist: number[][], used: Set<string>, count: number, size?: 1 | 2 | 3): Pt[];
  placeGates(cells: Cell[][], cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Pt[];
  placeShutters(cells: Cell[][], cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Pt[];
  /** entries.ts's roofHatch and tunnelGrate: where the way in goes (the roof hatch upstairs, the service tunnel's grate on the ground floor), a dead end that takes a room's place. Left out, it is not reserved. */
  roofHatch?(cells: Cell[][], cols: number, rows: number, dist: number[][], taken: ReadonlySet<string>, open?: (x: number, y: number) => boolean): Pt | null;
  tunnelGrate?(cells: Cell[][], cols: number, rows: number, dist: number[][], taken: ReadonlySet<string>, exitDist: number, open?: (x: number, y: number) => boolean): Pt | null;
  /** objectives.ts's planObjectives: a contract's steps, each in the big room or along a wall, on a floor. */
  planObjectives(contract: ContractId, floors: 1 | 2, pick: number): { steps: Array<{ where: 'landmark' | 'wall'; floor: 0 | 1 }> };
};

/** The things a floor holds that DESIGN.md's Difficulty does not let a spec set, at what job 2 has. */
const DECOR_ROOMS = 2;
const CRATES = 3;

const key = (p: Pt): string => `${p.x},${p.y}`;

/** A sketch's grid as the game's cells. */
function gridCells(grid: NonNullable<LevelSpec['grid']>): Cell[][] {
  return Array.from({ length: grid.rows }, (_, y) =>
    Array.from({ length: grid.cols }, (_, x) => {
      const c = grid.cells[y * grid.cols + x]!;
      return { N: c.n, S: c.s, E: c.e, W: c.w };
    })
  );
}

type Counts = { documents: number; network: ReadonlyArray<'uplink' | 'logs'>; objectiveHere: boolean };

/** One floor's doors, rooms, enemies and hazards, placed as populateFloor places them. */
function populate(spec: LevelSpec, g: FloorGenerators, floor: 0 | 1, plan: Plan, dist: number[][], used: Set<string>, start: Pt, counts: Counts, exitDist = 0): Omit<VerifyFloor, 'exit' | 'stair' | 'expect'> {
  const { cells } = plan;
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  const roster = twistedRoster(spec);
  g.seedRandom(phaseSeed(spec.seed, floor === 1 ? BUILD_PHASE.upperSecurity : BUILD_PHASE.groundSecurity)); // (the game reseeds here too: see phaseSeed)
  const sec = g.planSecurity(cells, cols, rows, dist, start, used, {
    doors: spec.hazards.doors,
    storage: counts.documents,
    decor: DECOR_ROOMS,
    // A chain only with two doors to chain; the harder jobs chain them, and a chain asks more of the plan than doors in a row do.
    chain: spec.hazards.doors >= 2,
    network: counts.network,
    // The way in this floor holds, taken before the rooms are (as the game does): a hatch up top, a grate on the ground floor.
    entry:
      floor === 1 && g.roofHatch
        ? (open, taken) => g.roofHatch!(cells, cols, rows, dist, taken, open)
        : floor === 0 && g.tunnelGrate
          ? (open, taken) => g.tunnelGrate!(cells, cols, rows, dist, taken, exitDist, open)
          : undefined,
  });
  const guards: VerifyFloor['guards'] = [];
  let placed = 0;
  const spawn = (kind: EnemyKind, n: number): void => {
    for (let i = 0; i < n; i++) {
      g.seedRandom(phaseSeed(spec.seed, enemyPhase(floor === 1, placed++)));
      const p = g.placeBotSpawn(cols, rows, dist, used);
      if (p) guards.push({ x: p.x, y: p.y, kind });
    }
  };
  // The game's order: patrol guards, then mines, alphas, drones, dogs.
  spawn('guard', roster.guards);
  spawn('crawler', roster.crawlers);
  spawn('alpha', roster.alphas);
  spawn('drone', roster.drones);
  spawn('watchdog', roster.watchdogs);
  const reseed = (k: number): void => g.seedRandom(phaseSeed(spec.seed, hazardPhase(floor === 1, k)));
  reseed(0);
  g.placeHidingSpots(cols, rows, dist, used, CRATES);
  reseed(1);
  const lasers = g.placeLaserTraps(cols, rows, cells, dist, used, spec.hazards.lasers).map((p) => ({ x: p.x, y: p.y }));
  const hazards: VerifyFloor['hazards'] = [];
  const add = (kind: HazardKind, p: Pt): void => void hazards.push({ kind, x: p.x, y: p.y });
  reseed(2);
  for (const p of g.placeSweepers(cells, cols, rows, dist, used, spec.hazards.sweepers)) add('sweeper', p);
  reseed(3);
  for (const s of g.placeSliders(cells, cols, rows, dist, used, spec.hazards.sliders, 4, 0)) {
    for (let i = s.from; i <= s.to; i++) add('slider', s.axis === 'x' ? { x: i, y: s.at } : { x: s.at, y: i });
  }
  reseed(4);
  for (const p of g.placeLines(cells, cols, rows, dist, used, spec.hazards.lines, 1)) add('line', p);
  reseed(5);
  for (const p of g.placeGates(cells, cols, rows, dist, used, spec.hazards.gates)) add('gate', p);
  reseed(6);
  for (const p of g.placeShutters(cells, cols, rows, dist, used, spec.hazards.shutters)) add('shutter', p);
  const stations: Station[] = sec.rooms.filter((r) => ['storage', 'terminal', 'server', 'uplink', 'logs'].includes(r.kind)).map((r) => ({ kind: r.kind, x: r.x, y: r.y, keyId: r.keyId }));
  // A contract's steps in the big room: the room's first cell stands for it.
  if (counts.objectiveHere && plan.landmark) stations.push({ kind: 'landmark', x: plan.landmark.x0, y: plan.landmark.y0 });
  return { floor, cols, rows, cells, start, guards, lasers, hazards, doors: sec.doors.map((d) => ({ id: d.id, x: d.x, y: d.y, dir: d.dir })), stations };
}

/**
 * The floors of `spec`, built with `g` under `spec.seed` (the same spec and seed always give the same floors), as data for checkFloors. The first is the ground floor,
 * with the exit and the stair; a second, if the spec has two floors, starts at the stair's landing. A spec with a `grid` is laid out on those walls, with its start and exit.
 * The seed is applied to Math.random only while this runs.
 */
export function buildFloorForVerify(spec: LevelSpec, g: FloorGenerators): VerifyFloor[] {
  g.seedRandom(spec.seed);
  try {
    return build(spec, g);
  } finally {
    g.restoreRandom();
  }
}

function build(raw: LevelSpec, g: FloorGenerators): VerifyFloor[] {
  // A sketch with no dead ends for the rooms gets closets opened in its solid blocks (carveAlcoves), as the game's loader does.
  const spec = raw.grid ? { ...raw, grid: carveAlcoves(raw).grid! } : raw;
  const { cols, rows } = spec.grid ? { cols: spec.grid.cols, rows: spec.grid.rows } : effectiveSize(spec);
  const plan0: Plan = spec.grid ? { cells: gridCells(spec.grid), landmark: null, spur: null } : g.plan(spec.place, spec.layout, 0, cols, rows);
  const start: Pt = spec.grid ? { ...spec.grid.start } : { x: 0, y: 0 };
  // The exit is never in the big room or the stair's spur (startJob).
  const inLandmark = (x: number, y: number): boolean => !!plan0.landmark && x >= plan0.landmark.x0 && x < plan0.landmark.x0 + plan0.landmark.w && y >= plan0.landmark.y0 && y < plan0.landmark.y0 + plan0.landmark.h;
  const exit: Pt = spec.grid ? { ...spec.grid.exit } : g.farthestCell(plan0.cells, cols, rows, 0, 0, (x, y) => !inLandmark(x, y) && !plan0.spur?.some((c) => c.x === x && c.y === y));
  const dist0 = g.bfs(plan0.cells, cols, rows, start.x, start.y);
  const used0 = new Set<string>([key(start), key(exit)]);
  if (plan0.landmark) for (let y = plan0.landmark.y0; y < plan0.landmark.y0 + plan0.landmark.h; y++) for (let x = plan0.landmark.x0; x < plan0.landmark.x0 + plan0.landmark.w; x++) used0.add(`${x},${y}`);

  // The way up, placed before anything else takes a cell: two cells long if there is room, else one.
  g.seedRandom(phaseSeed(spec.seed, BUILD_PHASE.stair));
  let stair: Spot | null = null;
  if (spec.floors === 2) {
    const long = g.placeStair(cols, rows, plan0.cells, dist0, used0, 2, plan0.spur?.[0]);
    stair = long ?? g.placeStair(cols, rows, plan0.cells, dist0, used0);
    if (stair) {
      for (const c of g.stairReserved(stair, long ? 2 : 1)) used0.add(key(c));
      used0.add(`${stair.x - (stair.spanX ? 0 : 1)},${stair.y - (stair.spanX ? 1 : 0)}`);
    }
  }
  // A contract other than records has steps at stations instead of files in records rooms.
  const objective = g.planObjectives(spec.contract, stair ? 2 : 1, Math.floor(Math.random() * 4));
  const hasObjective = objective.steps.length > 0;
  const requested = hasObjective ? 0 : spec.loot.documents;
  const upperDocs = stair ? Math.ceil(requested / 2) : 0;
  const lowerDocs = requested - upperDocs;
  const out: VerifyFloor[] = [];

  let upper: VerifyFloor | null = null;
  if (stair) {
    // (The upper floor is built at the spec's own size, as the game builds it: a silent night shrinks the ground floor only.)
    g.seedRandom(phaseSeed(spec.seed, BUILD_PHASE.upperPlan));
    const plan1 = g.plan(spec.place, spec.layout, 1, spec.size.cols, spec.size.rows);
    const c1 = plan1.cells;
    // The stairwell doorway (startJob): the landing's outer wall is punched open.
    if (stair.spanX) c1[0]![0]!.N = true;
    else c1[0]![0]!.W = true;
    const dist1 = g.bfs(c1, spec.size.cols, spec.size.rows, 0, 0);
    const used1 = new Set<string>(['0,0']);
    if (plan1.landmark) for (let y = plan1.landmark.y0; y < plan1.landmark.y0 + plan1.landmark.h; y++) for (let x = plan1.landmark.x0; x < plan1.landmark.x0 + plan1.landmark.w; x++) used1.add(`${x},${y}`);
    const objectiveHere = objective.steps.some((s) => s.where === 'landmark' && s.floor === 1);
    const placed = populate(spec, g, 1, plan1, dist1, used1, { x: 0, y: 0 }, { documents: upperDocs, network: hasObjective ? [] : ['logs'], objectiveHere });
    const expect: Expect = { storage: upperDocs, stair: false };
    upper = { ...placed, exit: null, stair: null, expect };
  }
  const objectiveHere = objective.steps.some((s) => s.where === 'landmark' && s.floor === 0);
  const placed = populate(spec, g, 0, plan0, dist0, used0, start, { documents: lowerDocs, network: upper || hasObjective ? ['uplink'] : ['uplink', 'logs'], objectiveHere }, dist0[exit.y]![exit.x]!);
  out.push({ ...placed, exit, stair: stair ? { x: stair.x, y: stair.y } : null, expect: { storage: lowerDocs, stair: spec.floors === 2 } });
  if (upper) out.push(upper);
  return out;
}

export type LevelVerdict = VerifyResult & {
  /** The spec as read, if it passed V1 (otherwise nothing was built). */
  spec: LevelSpec | null;
  floors: VerifyFloor[];
};

/** V1 to V3 on `raw`: the spec strictly, then, if it is sound, its floors built with `g` and checked. */
export function verifyLevel(raw: unknown, g: FloorGenerators, opts: VerifyOptions = {}): LevelVerdict {
  const v1 = checkSpec(raw);
  if (!v1.ok) return { ...v1, spec: null, floors: [] };
  const { spec } = inspectSpec(raw);
  const floors = buildFloorForVerify(spec, g);
  const failures: Failure[] = checkFloors(floors, opts).failures;
  return { ok: failures.length === 0, failures, spec, floors };
}
