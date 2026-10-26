// The bunkers: underground buildings of several storeys (docs/levels/bunker.md), climbed from the lowest up to the ground floor. Each storey is a run through spaces (rooms, and halls two
// cells wide, twice a maze corridor), joined by stairs, guarded, and by AC-duct shafts: a duct that ends in a vertical shaft, hooked with the grapple and climbed to the duct on the storey
// above. Ducts are also bypasses on their own floors: crouch or crawl, never stand. Pure data and layout (no runtime imports, so it is unit-tested under Node); game.ts builds each floor from
// it (the training-map format) and the furniture's models come from tower.ts.
//
// A bunker is a plan (`RawPlan`): its spaces, stairs, ducts, posts, lasers, cameras and clue rooms. `createBunkerPlan` works everything else out of one, and this file holds two: the Sump
// (the lab's, four storeys, the first level of the old runs and of free ones) and the Records Annex (the campus's, the first operation's first level). The names below (BUNKER_SPACES,
// spacesOn, bunkerMap...) are always the SELECTED plan's: `selectBunkerPlan` re-points them, and importers see the change (they are live bindings). Every storey of a plan shares one
// footprint (cols x rows), so a shaft is the same cell on the two floors it joins.

import type { CameraPlan } from './cameras';
import type { Gate } from './evade';
import type { LineLaser } from './linelasers';
import type { Sweeper, Slider } from './movingLasers';

const CELL = 4;

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Space = Rect & { id: string; name: string; hall: boolean; level: number };
export type BunkerStair = { id: string; x: number; y: number; run: number; width: number; dir: 1 | -1; low: number; high: number };
export type Cell = { x: number; y: number };
export type Duct = { id: string; level: number; cells: ReadonlyArray<Cell>; ends: readonly [Cell | null, Cell | null] };
export type Shaft = { level: number; x: number; y: number };
export type Post = { x: number; y: number; facing: number };
export type Patrol = { x: number; y: number; round: Array<{ x: number; y: number }> };
export type Beast = { x: number; y: number; /** The rectangle it prowls (an alpha's chase goes anywhere). */ zone: Rect };
export type BunkerSpot = { level: number; x: number; y: number };
export type BunkerStation = { title: string; goal: BunkerSpot; checkpoint: BunkerSpot; text: string };
export type Sizes = Record<string, { len: number; depth: number }>;
export type BunkerPiece = { kind: string; /** A sliding bank (the Annex's): the cell step it moves by, across its length, into the aisle beside it. */ slide?: { dx: number; dy: number }; cx: number; cz: number; yaw: number; box: { minX: number; maxX: number; minZ: number; maxZ: number }; /** Part of a lit table or bunk: draws as its own piece. */ pair: number };
export type BunkerClue = { level: number; /** The room it is in. */ space: string; /** Its cell, against the wall on its `side`. */ x: number; y: number; side: Side; /** The cell the agent stands on to work it (the same cell: the console is on the wall face). */ stand: Cell };
export type BunkerContainer = { id: string; level: number; index: number; cx: number; cz: number; yaw: number; box: BunkerPiece['box']; cells: Cell[]; door: Cell };

export const DUCT_LANE = 1.4;
export const DUCT_H = 1.45;
export const BUNKER_WALL_H = 6;
export const BUNKER_CAMERA_Y = 5.2;
export const SENTRIES_PER_LEVEL = 2;
export const FURNITURE_SHARE = 0.7;
const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 } as const;
type Dir = keyof typeof FACE;
const post = (x: number, y: number, d: Dir): Post => ({ x, y, facing: FACE[d] });

const line = (x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> => {
  const out: Array<{ x: number; y: number }> = [];
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  for (let x = x0, y = y0; ; x += dx, y += dy) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
  }
  return out;
};
const join = (...parts: Array<Array<{ x: number; y: number }>>): Array<{ x: number; y: number }> => {
  const out: Array<{ x: number; y: number }> = [];
  for (const p of parts) for (const c of p) if (!out.some((o) => o.x === c.x && o.y === c.y)) out.push(c);
  return out;
};
const gates = (cells: Array<[number, number]>, spanX: boolean, kind: Gate['kind'], phase = 0): Gate[] => cells.map(([x, y]) => ({ x, y, spanX, kind, phase }));

export const BUNKER_SETS: Record<string, Record<string, readonly string[]>> = {
  lab: {
    A: ['cubestool', 'cubetable'],
    hall: ['cube', 'cubelocker', 'fridge'],
    Z1: ['cubetable', 'cubebunk'],
    Z2: ['cubelocker', 'cube'],
    Z3: ['labbench', 'hood', 'cubetable'],
    Z4: ['console', 'cubetable', 'board'],
    Z5: ['pipes', 'drums', 'cube'],
    Z6: ['cube', 'cubelocker'],
  },
  // The museum's Founders' Store: crates, plinths and statues, cases and panels, with the crate stacks (the cargo blocks) filling the rest.
  museum: {
    A: ['crate', 'plinth'],
    hall: ['plinth', 'case', 'plinth'],
    Z1: ['crate', 'plinth', 'crate'],
    Z2: ['plinth', 'case', 'colossus'],
    Z3: ['panel', 'crate', 'plinth'],
    Z4: ['plinth', 'colossus', 'case'],
    Z5: ['case', 'plinth', 'panel'],
  },
  // The bank's Armoured Depot: pallets, trolleys and pillars among the parked vans (the cargo blocks).
  bank: {
    A: ['counter', 'cart'],
    hall: ['cart', 'pillar', 'pallets'],
    Z1: ['pallets', 'cart', 'forklift'],
    Z2: ['pillar', 'cart', 'pallets'],
    Z3: ['counter', 'cart', 'deposit'],
    Z4: ['deposit', 'cart', 'pillar'],
    Z5: ['deposit', 'pillar', 'cart'],
  },
  // The campus's Records Annex: reading desks, trolleys and lockers, with shelving banks (the cargo blocks) filling the rest.
  campus: {
    A: ['cubetable', 'cubestool', 'cart'],
    hall: ['cubelocker', 'cart', 'cube'],
    Z1: ['cubetable', 'cubestool', 'cart'],
    Z2: ['cart', 'cubelocker'],
    Z3: ['cubetable', 'cart', 'cubelocker'],
    Z4: ['cubelocker', 'cube'],
    Z5: ['cubetable', 'cubelocker', 'cart'],
    H2b: ['cubelocker', 'cart'],
    H3b: ['cubelocker', 'cube'],
  },
  // The final level's white lab: tanks, row on row, in the halls and the rooms.
  core: {
    A: ['tank', 'cubetable'],
    hall: ['tank', 'tank', 'cube', 'tank'],
    Z1: ['tank', 'cubebunk'],
    Z2: ['tank', 'tank', 'cubelocker'],
    Z3: ['tank', 'labbench', 'tank'],
    Z4: ['console', 'tank', 'board'],
    Z5: ['tank', 'tank', 'cube'],
    Z6: ['tank', 'cubelocker'],
  },
};

export type RawCamera = [string, Side, number, Lens, number, number?];
export type RawBeast = { x: number; y: number; zone: string };
export type BunkerPack = { dogs: Array<{ x: number; y: number }>; meet: { x: number; y: number }; roamS: readonly [number, number] };
type Side = 'N' | 'S' | 'E' | 'W';
type Lens = 'monitor' | 'wide' | 'hall';
/** Everything a bunker is made of: the data createBunkerPlan works from. */
export type RawPlan = {
  id: string;
  cols: number;
  rows: number;
  /** Storeys: 0 is the lowest, where the job starts; the last is the ground floor, where the lift out is. */
  levels: number;
  levelNames: readonly string[];
  spaces: readonly Space[];
  start: Cell;
  exit: Cell;
  stairs: readonly BunkerStair[];
  ducts: readonly Duct[];
  shafts: readonly Shaft[];
  posts: readonly Post[];
  dogs: readonly RawBeast[];
  pack: BunkerPack;
  alphas: readonly RawBeast[];
  gates: readonly Gate[];
  sweepers: readonly Sweeper[];
  sliders: readonly Slider[];
  lines: readonly LineLaser[];
  stations: readonly BunkerStation[];
  cameras: readonly RawCamera[];
  patrolCounts: Record<string, number>;
  /** Rooms whose shelving banks can be slid (some of their cargo blocks are `bank` pieces, with a free aisle beside them to slide into). */
  slideRooms?: readonly string[];
  /** A room's own share of floor the furniture stands on, where it is not the usual FURNITURE_SHARE (the sliding rooms keep more aisle). */
  furnitureShare?: Readonly<Record<string, number>>;
  /** The room of each storey the clue system is in (by index of storey). */
  clueRooms: readonly string[];
};

const SUMP_RAW: RawPlan = {
  id: 'sump',
  cols: 28,
  rows: 52,
  levels: 4,
  levelNames: ['Level -3', 'Level -2', 'Level -1', 'Ground floor'],
  spaces: [
    { id: 'A', name: 'Arrival', hall: false, level: 0, x0: 2, y0: 1, x1: 7, y1: 5 },
    { id: 'H1', name: 'Hall', hall: true, level: 0, x0: 5, y0: 6, x1: 6, y1: 11 },
    { id: 'Z1', name: 'Barracks', hall: false, level: 0, x0: 1, y0: 12, x1: 11, y1: 19 },
    { id: 'H2', name: 'Hall', hall: true, level: 1, x0: 16, y0: 14, x1: 19, y1: 15 },
    { id: 'Z2', name: 'Armoury', hall: false, level: 1, x0: 20, y0: 9, x1: 26, y1: 19 },
    { id: 'H3', name: 'Hall', hall: true, level: 1, x0: 23, y0: 20, x1: 24, y1: 24 },
    { id: 'Z3', name: 'Lab', hall: false, level: 1, x0: 15, y0: 25, x1: 26, y1: 33 },
    { id: 'H4', name: 'Hall', hall: true, level: 2, x0: 8, y0: 28, x1: 10, y1: 29 },
    { id: 'Z4', name: 'Control', hall: false, level: 2, x0: 1, y0: 24, x1: 7, y1: 33 },
    { id: 'H5', name: 'Hall', hall: true, level: 2, x0: 4, y0: 34, x1: 5, y1: 39 },
    { id: 'Z5', name: 'Reactor hall', hall: false, level: 2, x0: 1, y0: 40, x1: 14, y1: 50 },
    { id: 'H6', name: 'Hall', hall: true, level: 3, x0: 19, y0: 45, x1: 20, y1: 46 },
    { id: 'Z6', name: 'Blast door', hall: false, level: 3, x0: 21, y0: 41, x1: 26, y1: 50 },
  ],
  start: { x: 2, y: 1 },
  exit: { x: 26, y: 50 },
  stairs: [
    { id: 'T1', x: 12, y: 14, run: 4, width: 2, dir: 1, low: 0, high: 1 },
    { id: 'T2', x: 11, y: 28, run: 4, width: 2, dir: -1, low: 1, high: 2 },
    { id: 'T3', x: 15, y: 45, run: 4, width: 2, dir: 1, low: 2, high: 3 },
  ],
  ducts: [
    // level -3: hall 1's east wall, along the wall mass above the barracks, to a shaft over the barracks' stair
    { id: 'D1', level: 0, cells: join(line(7, 9, 13, 9), line(13, 9, 13, 13)), ends: [{ x: 6, y: 9 }, null] },
    // level -2: out of that shaft, east above hall 2 to a grate at its east end (past the first stair and the pulsing gate)
    { id: 'D1u', level: 1, cells: line(13, 13, 19, 13), ends: [null, { x: 19, y: 14 }] },
    // level -2: hall 3's west wall, west and south to a shaft; a spur ends over the lab
    { id: 'D2', level: 1, cells: join(line(22, 22, 12, 22), line(12, 22, 12, 26)), ends: [{ x: 23, y: 22 }, null] },
    { id: 'D2b', level: 1, cells: line(16, 23, 16, 24), ends: [{ x: 16, y: 22 }, { x: 16, y: 25 }] },
    // level -1: out of that shaft, west to a grate at hall 4's east end, over its lasers
    { id: 'D2u', level: 2, cells: join(line(12, 26, 10, 26), line(10, 26, 10, 27)), ends: [null, { x: 10, y: 28 }] },
    // level -1: hall 5's east wall, east above the reactor hall and south to a shaft
    { id: 'D3', level: 2, cells: join(line(6, 37, 16, 37), line(16, 37, 16, 44)), ends: [{ x: 5, y: 37 }, null] },
    // the ground floor: out of that shaft, east to a grate in the blast door's room, past the hall's gate and lines
    { id: 'D3u', level: 3, cells: line(16, 44, 20, 44), ends: [null, { x: 21, y: 44 }] },
  ],
  shafts: [
    { level: 0, x: 13, y: 13 },
    { level: 1, x: 12, y: 26 },
    { level: 2, x: 16, y: 44 },
  ],
  posts: [
    post(6, 11, 'N'), post(10, 13, 'W'), post(22, 11, 'S'), post(25, 14, 'W'), post(25, 32, 'N'), post(6, 31, 'N'), post(12, 48, 'W'), post(22, 44, 'S'),
    post(2, 15, 'W'), post(10, 18, 'S'), post(24, 10, 'N'), post(21, 18, 'S'), post(17, 26, 'N'), post(3, 33, 'S'), post(13, 41, 'N'), post(2, 49, 'S'), post(25, 43, 'E'),
    post(3, 12, 'N'), post(9, 12, 'N'), post(1, 17, 'W'), post(7, 19, 'S'), post(26, 12, 'E'), post(26, 17, 'E'), post(20, 12, 'W'), post(25, 19, 'S'),
    post(21, 25, 'N'), post(26, 29, 'E'), post(16, 31, 'W'), post(2, 24, 'N'), post(6, 24, 'N'), post(7, 40, 'N'), post(14, 43, 'E'), post(9, 50, 'S'), post(23, 41, 'N'),
  ],
  dogs: [
    { x: 19, y: 15, zone: 'H2' },
    { x: 5, y: 36, zone: 'H5' },
    { x: 9, y: 16, zone: 'Z1' },
    { x: 22, y: 16, zone: 'Z2' },
    { x: 18, y: 31, zone: 'Z3' },
    { x: 11, y: 42, zone: 'Z5' },
  ],
  pack: { dogs: [{ x: 8, y: 28 }, { x: 8, y: 29 }], meet: { x: 9, y: 28 }, roamS: [8, 10] as const },
  alphas: [
    { x: 20, y: 29, zone: 'Z3' },
    { x: 7, y: 47, zone: 'Z5' },
    { x: 22, y: 47, zone: 'Z6' },
    { x: 4, y: 18, zone: 'Z1' },
    { x: 24, y: 12, zone: 'Z2' },
    { x: 5, y: 26, zone: 'Z4' },
  ],
  gates: [
    ...gates([[5, 8], [6, 8]], true, 'duck'),
    ...gates([[18, 14], [18, 15]], false, 'pulse', 0.1),
    ...gates([[23, 22], [24, 22]], true, 'crawl'),
    ...gates([[4, 36], [5, 36]], true, 'pulse', 0.4),
    ...gates([[20, 45], [20, 46]], false, 'pulse', 0.7),
  ],
  sweepers: [{ x: 23, y: 26, phase: 0, dir: 1 }],
  sliders: [{ axis: 'x', at: 45, from: 4, to: 11, phase: 0.2, speed: 1.3 }],
  lines: [
    { x: 9, y: 28, spanX: false, orient: 'h', count: 3, phase: 0.3, gap: 0 },
    { x: 9, y: 29, spanX: false, orient: 'h', count: 3, phase: 0.3, gap: 0 },
    { x: 22, y: 45, spanX: false, orient: 'v', count: 2, phase: 0.1, gap: 1.4 },
    { x: 22, y: 46, spanX: false, orient: 'v', count: 2, phase: 0.1, gap: 1.4 },
  ],
  stations: [
    { title: 'Down the hall', goal: { level: 0, x: 6, y: 11 }, checkpoint: { level: 0, x: 3, y: 2 }, text: 'The lift lets you out four floors down. You are on level -3, and the way out is the lift on the ground floor: up. A sentry holds the end of this hall behind a laser gate. Cover comes in pairs of two: go from one pair to the next, not down the middle. Beside one you go see-through, and you can aim from anywhere. Cameras sit on top of the walls: their panels are at hand height under them.' },
    { title: 'The barracks', goal: { level: 0, x: 11, y: 14 }, checkpoint: { level: 0, x: 6, y: 11 }, text: 'The barracks are full: guards on posts facing the walls (come up behind one and take it down) and patrols on rings. Or take the duct in the hall’s east wall: it ends in a shaft, and the grapple climbs it to level -2.' },
    { title: 'The first stair', goal: { level: 1, x: 16, y: 14 }, checkpoint: { level: 0, x: 11, y: 14 }, text: 'The stair is open and guarded from the room below. Up you go: level -2.' },
    { title: 'The fire lane', goal: { level: 1, x: 20, y: 14 }, checkpoint: { level: 1, x: 16, y: 14 }, text: 'A dog on a beat, and a pulsing gate across the hall: wait for it to blink off. Or take the duct above the hall: it comes out at the far end.' },
    { title: 'The armoury', goal: { level: 1, x: 23, y: 20 }, checkpoint: { level: 1, x: 20, y: 14 }, text: 'Guards and rows of lockers. Fight from behind a pair, or round them.' },
    { title: 'The crawl gate', goal: { level: 1, x: 23, y: 24 }, checkpoint: { level: 1, x: 23, y: 20 }, text: 'A low beam across the hall: lie down and crawl under it.' },
    { title: 'The lab', goal: { level: 1, x: 15, y: 28 }, checkpoint: { level: 1, x: 23, y: 24 }, text: 'Guards, a sweeping laser at the door, a dog and an alpha dog: it hears you, howls, runs at you and blows. Shoot it from outside its ring, or take the duct on the hall’s west wall: it ends in a shaft up.' },
    { title: 'The second stair', goal: { level: 2, x: 10, y: 28 }, checkpoint: { level: 1, x: 15, y: 28 }, text: 'The stair climbs west. Level -1.' },
    { title: 'The hall of dogs', goal: { level: 2, x: 7, y: 28 }, checkpoint: { level: 2, x: 10, y: 28 }, text: 'Two dogs and rising laser lines across the short hall: cross them lying flat while they are above you.' },
    { title: 'Control', goal: { level: 2, x: 4, y: 34 }, checkpoint: { level: 2, x: 7, y: 28 }, text: 'Guards at the consoles and an alpha. Lit tables show where you are when you crouch beside one.' },
    { title: 'The last hall', goal: { level: 2, x: 4, y: 40 }, checkpoint: { level: 2, x: 4, y: 34 }, text: 'A dog and a pulsing gate.' },
    { title: 'The reactor hall', goal: { level: 2, x: 14, y: 45 }, checkpoint: { level: 2, x: 4, y: 40 }, text: 'A sliding laser bar down the middle lane, guards and an alpha. Round it by the duct, or through.' },
    { title: 'The third stair', goal: { level: 3, x: 19, y: 45 }, checkpoint: { level: 2, x: 14, y: 45 }, text: 'The last flight: up to the ground floor.' },
    { title: 'The blast door', goal: { level: 3, x: 21, y: 45 }, checkpoint: { level: 3, x: 19, y: 45 }, text: 'A pulsing gate, lines across the doorway, guards and one more alpha. The lift in the corner takes you out: the next job starts at the tower.' },
  ],
  cameras: [
    ['A', 'E', 3, 'monitor', 0],
    ['H1', 'W', 7, 'hall', 1, 0],
    ['Z1', 'N', 2, 'wide', 2],
    ['Z1', 'S', 9, 'monitor', 3],
    ['H2', 'N', 17, 'hall', 4, Math.PI / 2],
    ['Z2', 'E', 12, 'wide', 5],
    ['Z2', 'N', 22, 'monitor', 6],
    ['H3', 'E', 21, 'hall', 7, 0],
    ['Z3', 'N', 18, 'wide', 8],
    ['Z3', 'S', 21, 'monitor', 9],
    ['Z3', 'E', 30, 'monitor', 10],
    ['H4', 'N', 9, 'hall', 11, Math.PI / 2],
    ['Z4', 'N', 4, 'wide', 12],
    ['H5', 'E', 35, 'hall', 13, 0],
    ['Z5', 'N', 9, 'wide', 14],
    ['Z5', 'S', 4, 'monitor', 15],
    ['Z5', 'E', 42, 'monitor', 16],
    ['H6', 'N', 19, 'hall', 17, Math.PI / 2],
    ['Z6', 'W', 42, 'wide', 18],
    ['Z6', 'N', 24, 'monitor', 19],
  ],
  patrolCounts: { Z1: 2, Z2: 1, Z3: 1, Z4: 1, Z5: 1, Z6: 2 },
  clueRooms: ['Z1', 'Z2', 'Z5', 'Z6'],
};

// ---- The Records Annex: the campus's archive wing, three storeys up (docs/level-plan.md, docs/level-blueprints.html) ----
// Reading rooms and stacks on the ground floor, the sliding stacks above, the registry vault at the top. The cargo containers of the Sump are, here, the shelving banks and filing safes.
const ANNEX_RAW: RawPlan = {
  id: 'annex',
  cols: 56,
  rows: 30,
  levels: 3,
  levelNames: ['Reading hall', 'The stacks', 'The registry'],
  // (No two spaces overlap on the plan, on any storey: spaceAt does not know the storey. So each storey has its own part of the footprint: the ground floor at the left, the stacks over the middle and the sorting room at the top left, the registry on the right.)
  spaces: [
    { id: 'A', name: 'Arrival lobby', hall: false, level: 0, x0: 1, y0: 18, x1: 5, y1: 23 },
    { id: 'H1', name: 'Reading hall', hall: true, level: 0, x0: 6, y0: 20, x1: 10, y1: 21 },
    { id: 'Z1', name: 'Reading rooms', hall: false, level: 0, x0: 11, y0: 14, x1: 21, y1: 25 },
    { id: 'H2', name: 'Motion-light hall', hall: true, level: 1, x0: 26, y0: 10, x1: 27, y1: 20 },
    { id: 'Z2', name: 'The stacks', hall: false, level: 1, x0: 20, y0: 1, x1: 37, y1: 9 },
    { id: 'H2b', name: 'Duct hall', hall: true, level: 1, x0: 14, y0: 4, x1: 19, y1: 5 },
    { id: 'Z3', name: 'Sorting room', hall: false, level: 1, x0: 2, y0: 1, x1: 13, y1: 9 },
    { id: 'H3', name: 'Registry hall', hall: true, level: 2, x0: 42, y0: 4, x1: 46, y1: 5 },
    { id: 'Z4', name: 'Registry vault', hall: false, level: 2, x0: 47, y0: 1, x1: 55, y1: 12 },
    { id: 'H3b', name: 'Antechamber hall', hall: true, level: 2, x0: 50, y0: 13, x1: 51, y1: 16 },
    { id: 'Z5', name: 'Antechamber', hall: false, level: 2, x0: 44, y0: 17, x1: 55, y1: 28 },
  ],
  start: { x: 1, y: 18 },
  exit: { x: 55, y: 28 },
  stairs: [
    { id: 'T1', x: 22, y: 19, run: 4, width: 2, dir: 1, low: 0, high: 1 },
    { id: 'T2', x: 38, y: 4, run: 4, width: 2, dir: 1, low: 1, high: 2 },
  ],
  ducts: [],
  shafts: [],
  posts: [
    post(2, 19, 'S'), post(11, 16, 'W'), post(21, 15, 'E'), post(16, 25, 'N'),
    post(36, 2, 'S'), post(21, 3, 'E'), post(3, 8, 'N'), post(12, 2, 'S'),
    post(48, 3, 'S'), post(54, 11, 'N'), post(45, 18, 'E'), post(54, 18, 'W'),
  ],
  dogs: [
    { x: 30, y: 5, zone: 'Z2' },
    { x: 52, y: 8, zone: 'Z4' },
  ],
  pack: { dogs: [{ x: 16, y: 4 }, { x: 16, y: 5 }], meet: { x: 17, y: 4 }, roamS: [8, 10] },
  alphas: [
    { x: 35, y: 8, zone: 'Z2' },
    { x: 46, y: 26, zone: 'Z5' },
  ],
  gates: [
    ...gates([[8, 20], [8, 21]], false, 'pulse', 0.1),
    ...gates([[26, 15], [27, 15]], true, 'duck'),
    ...gates([[44, 4], [44, 5]], false, 'crawl'),
  ],
  sweepers: [{ x: 49, y: 5, phase: 0, dir: 1 }],
  sliders: [],
  lines: [
    { x: 26, y: 12, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
    { x: 27, y: 12, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
  ],
  stations: [
    { title: 'The reading hall', goal: { level: 0, x: 10, y: 20 }, checkpoint: { level: 0, x: 2, y: 19 }, text: 'The lift lets you out in the lobby. A pulsing gate across the reading hall: wait for it to blink off.' },
    { title: 'The reading rooms', goal: { level: 0, x: 21, y: 19 }, checkpoint: { level: 0, x: 10, y: 20 }, text: 'Glass rooms, banks of shelving and guards on posts. The aisle lights come on as you pass.' },
    { title: 'The first stair', goal: { level: 1, x: 26, y: 19 }, checkpoint: { level: 0, x: 21, y: 19 }, text: 'The stair is open and guarded from the room below. Up you go.' },
    { title: 'The motion-light hall', goal: { level: 1, x: 26, y: 11 }, checkpoint: { level: 1, x: 26, y: 19 }, text: 'A low beam and rising lines across the hall: duck the beam, and wait for the lines to rise.' },
    { title: 'The stacks', goal: { level: 1, x: 21, y: 4 }, checkpoint: { level: 1, x: 26, y: 11 }, text: 'Sliding banks, patrols and an alpha. Slide a bank across a lane to shut a guard out.' },
    { title: 'The sorting room', goal: { level: 1, x: 13, y: 4 }, checkpoint: { level: 1, x: 21, y: 4 }, text: 'A pair of dogs in the hall west of the stacks; the sorting room beyond has a terminal.' },
    { title: 'The second stair', goal: { level: 2, x: 42, y: 4 }, checkpoint: { level: 1, x: 36, y: 4 }, text: 'The stair climbs east: the registry floor.' },
    { title: 'The registry', goal: { level: 2, x: 47, y: 4 }, checkpoint: { level: 2, x: 42, y: 4 }, text: 'A crawl gate across the hall, then the vault: a sweeping laser at its door, a row of safes. The lift is in the far corner.' },
  ],
  cameras: [
    ['A', 'E', 20, 'monitor', 0],
    ['H1', 'N', 8, 'hall', 1, Math.PI / 2],
    ['Z1', 'N', 14, 'wide', 2],
    ['Z1', 'S', 17, 'monitor', 3],
    ['H2', 'W', 16, 'hall', 4, 0],
    ['Z2', 'N', 28, 'monitor', 5],
    ['Z2', 'S', 33, 'wide', 6],
    ['Z3', 'S', 8, 'monitor', 7],
    ['H3', 'N', 44, 'hall', 8, Math.PI / 2],
    ['Z4', 'S', 53, 'wide', 9],
    ['Z5', 'N', 47, 'monitor', 10],
    ['Z5', 'E', 22, 'wide', 11],
  ],
  patrolCounts: { Z1: 2, Z2: 2, Z3: 1, Z4: 1, Z5: 2 },
  slideRooms: ['Z2', 'Z3'],
  furnitureShare: { Z2: 0.55, Z3: 0.55 },
  clueRooms: ['Z1', 'Z3', 'Z5'],
};

// ---- The Founders' Store: the museum's cellars, three storeys down under the galleries (docs/level-plan.md) ----
// Crates of paintings and statues, climate rooms behind a pair of airlock gates, a gallery of plinths and laser cases. Each storey has its own band of the footprint, left to right.
const STORE_RAW: RawPlan = {
  id: 'store',
  cols: 72,
  rows: 28,
  levels: 3,
  levelNames: ['Receiving', 'Climate rooms', 'Statue gallery'],
  spaces: [
    { id: 'A', name: 'Loading dock', hall: false, level: 0, x0: 1, y0: 10, x1: 5, y1: 16 },
    { id: 'H1', name: 'Receiving hall', hall: true, level: 0, x0: 6, y0: 12, x1: 10, y1: 13 },
    { id: 'Z1', name: 'Crate stacks', hall: false, level: 0, x0: 11, y0: 5, x1: 24, y1: 22 },
    { id: 'H2', name: 'Airlock hall', hall: true, level: 1, x0: 29, y0: 12, x1: 33, y1: 13 },
    { id: 'Z2', name: 'Climate room', hall: false, level: 1, x0: 34, y0: 6, x1: 44, y1: 19 },
    { id: 'H2b', name: 'Rack hall', hall: true, level: 1, x0: 38, y0: 20, x1: 39, y1: 22 },
    { id: 'Z3', name: 'Painting racks', hall: false, level: 1, x0: 31, y0: 23, x1: 46, y1: 27 },
    { id: 'H3', name: 'Gallery hall', hall: true, level: 2, x0: 49, y0: 12, x1: 52, y1: 13 },
    { id: 'Z4', name: 'Statue gallery', hall: false, level: 2, x0: 53, y0: 5, x1: 68, y1: 20 },
    { id: 'H3b', name: 'Curators’ hall', hall: true, level: 2, x0: 60, y0: 21, x1: 61, y1: 22 },
    { id: 'Z5', name: 'Curators’ office', hall: false, level: 2, x0: 55, y0: 23, x1: 68, y1: 27 },
  ],
  start: { x: 1, y: 10 },
  exit: { x: 68, y: 27 },
  stairs: [
    { id: 'T1', x: 25, y: 12, run: 4, width: 2, dir: 1, low: 0, high: 1 },
    { id: 'T2', x: 45, y: 12, run: 4, width: 2, dir: 1, low: 1, high: 2 },
  ],
  ducts: [],
  shafts: [],
  posts: [
    post(2, 11, 'S'), post(11, 7, 'E'), post(24, 20, 'N'), post(15, 22, 'N'),
    post(35, 7, 'S'), post(43, 18, 'N'), post(32, 24, 'N'), post(45, 26, 'W'),
    post(54, 6, 'S'), post(67, 19, 'N'), post(56, 24, 'E'), post(67, 26, 'W'),
  ],
  dogs: [
    { x: 40, y: 10, zone: 'Z2' },
    { x: 60, y: 12, zone: 'Z4' },
  ],
  pack: { dogs: [{ x: 38, y: 21 }, { x: 39, y: 21 }], meet: { x: 38, y: 20 }, roamS: [8, 10] },
  alphas: [
    { x: 43, y: 17, zone: 'Z2' },
    { x: 66, y: 7, zone: 'Z4' },
  ],
  gates: [
    ...gates([[8, 12], [8, 13]], false, 'pulse', 0.1),
    // the airlock pair: one is shut while the other opens, so there is a moment to cross, and a moment to wait between them
    ...gates([[31, 12], [31, 13]], false, 'pulse', 0),
    ...gates([[33, 12], [33, 13]], false, 'pulse', 0.45),
    ...gates([[51, 12], [51, 13]], false, 'crawl'),
  ],
  sweepers: [{ x: 56, y: 12, phase: 0, dir: 1 }],
  sliders: [],
  lines: [
    { x: 38, y: 22, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
    { x: 39, y: 22, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
  ],
  stations: [
    { title: 'The receiving hall', goal: { level: 0, x: 10, y: 12 }, checkpoint: { level: 0, x: 2, y: 11 }, text: 'The loading dock lift lets you out under the galleries. A pulsing gate across the receiving hall: wait for it to blink off.' },
    { title: 'The crate stacks', goal: { level: 0, x: 24, y: 12 }, checkpoint: { level: 0, x: 10, y: 12 }, text: 'Crates of paintings and statues, patrols and guards on posts. Go round the stacks, or over them.' },
    { title: 'The first stair', goal: { level: 1, x: 29, y: 12 }, checkpoint: { level: 0, x: 24, y: 12 }, text: 'The stair climbs east, to the climate rooms.' },
    { title: 'The airlock', goal: { level: 1, x: 34, y: 12 }, checkpoint: { level: 1, x: 29, y: 12 }, text: 'Two gates, one after the other: when the first blinks off, cross to the space between and wait for the second.' },
    { title: 'The climate room', goal: { level: 1, x: 44, y: 12 }, checkpoint: { level: 1, x: 34, y: 12 }, text: 'Guards, a dog and an alpha among the crates. Keep to the aisles.' },
    { title: 'The painting racks', goal: { level: 1, x: 38, y: 24 }, checkpoint: { level: 1, x: 38, y: 19 }, text: 'Rising lines across the short hall to the painting racks.' },
    { title: 'The second stair', goal: { level: 2, x: 49, y: 12 }, checkpoint: { level: 1, x: 44, y: 12 }, text: 'Up to the statue gallery.' },
    { title: 'The statue gallery', goal: { level: 2, x: 53, y: 12 }, checkpoint: { level: 2, x: 49, y: 12 }, text: 'A crawl gate, then plinths and statues, a sweeping laser at the door, and the curators’ office beyond. The lift is in its far corner.' },
  ],
  cameras: [
    ['A', 'E', 13, 'monitor', 0],
    ['H1', 'N', 8, 'hall', 1, Math.PI / 2],
    ['Z1', 'N', 16, 'wide', 2],
    ['Z1', 'S', 20, 'monitor', 3],
    ['H2', 'N', 31, 'hall', 4, Math.PI / 2],
    ['Z2', 'N', 39, 'monitor', 5],
    ['Z2', 'S', 42, 'wide', 6],
    ['Z3', 'S', 36, 'monitor', 7],
    ['H3', 'N', 50, 'hall', 8, Math.PI / 2],
    ['Z4', 'N', 60, 'wide', 9],
    ['Z4', 'S', 65, 'monitor', 10],
    ['Z5', 'E', 25, 'wide', 11],
  ],
  patrolCounts: { Z1: 2, Z2: 2, Z3: 1, Z4: 2, Z5: 1 },
  clueRooms: ['Z1', 'Z2', 'Z5'],
};

// ---- The Armoured Depot: the bank's cash-in-transit car park (docs/level-plan.md) ----
// The gatehouse and loading bays, the parking deck with its vans and a control booth, the vault level with its antechamber and the vault itself.
const DEPOT_RAW: RawPlan = {
  id: 'depot',
  cols: 66,
  rows: 30,
  levels: 3,
  levelNames: ['Loading bays', 'Parking deck', 'Vault level'],
  spaces: [
    { id: 'A', name: 'Gatehouse', hall: false, level: 0, x0: 1, y0: 12, x1: 5, y1: 18 },
    { id: 'H1', name: 'Barrier lane', hall: true, level: 0, x0: 6, y0: 14, x1: 10, y1: 15 },
    { id: 'Z1', name: 'Loading bays', hall: false, level: 0, x0: 11, y0: 6, x1: 24, y1: 24 },
    { id: 'H2', name: 'Ramp lane', hall: true, level: 1, x0: 29, y0: 14, x1: 33, y1: 15 },
    { id: 'Z2', name: 'Parking deck', hall: false, level: 1, x0: 34, y0: 7, x1: 46, y1: 22 },
    { id: 'H2b', name: 'Booth hall', hall: true, level: 1, x0: 40, y0: 23, x1: 41, y1: 25 },
    { id: 'Z3', name: 'Control booth', hall: false, level: 1, x0: 33, y0: 26, x1: 47, y1: 29 },
    { id: 'H3', name: 'Vault ramp', hall: true, level: 2, x0: 51, y0: 14, x1: 54, y1: 15 },
    { id: 'Z4', name: 'Vault antechamber', hall: false, level: 2, x0: 55, y0: 8, x1: 65, y1: 22 },
    { id: 'H3b', name: 'Vault passage', hall: true, level: 2, x0: 59, y0: 23, x1: 60, y1: 24 },
    { id: 'Z5', name: 'The vault', hall: false, level: 2, x0: 55, y0: 25, x1: 65, y1: 29 },
  ],
  start: { x: 1, y: 12 },
  exit: { x: 65, y: 29 },
  stairs: [
    { id: 'T1', x: 25, y: 14, run: 4, width: 2, dir: 1, low: 0, high: 1 },
    { id: 'T2', x: 47, y: 14, run: 4, width: 2, dir: 1, low: 1, high: 2 },
  ],
  ducts: [],
  shafts: [],
  posts: [
    post(2, 13, 'S'), post(11, 8, 'E'), post(24, 22, 'N'), post(15, 24, 'N'),
    post(35, 8, 'S'), post(45, 21, 'N'), post(34, 27, 'E'), post(46, 28, 'W'),
    post(56, 9, 'S'), post(64, 21, 'N'), post(56, 27, 'E'), post(64, 28, 'W'),
  ],
  dogs: [
    { x: 40, y: 10, zone: 'Z2' },
    { x: 60, y: 12, zone: 'Z4' },
  ],
  pack: { dogs: [{ x: 40, y: 24 }, { x: 41, y: 24 }], meet: { x: 40, y: 23 }, roamS: [8, 10] },
  alphas: [
    { x: 45, y: 20, zone: 'Z2' },
    { x: 64, y: 10, zone: 'Z4' },
  ],
  gates: [
    // the barrier arms across the lanes
    ...gates([[8, 14], [8, 15]], false, 'pulse', 0.1),
    ...gates([[31, 14], [31, 15]], false, 'duck'),
    ...gates([[52, 14], [52, 15]], false, 'pulse', 0.5),
  ],
  sweepers: [{ x: 57, y: 24, phase: 0, dir: 1 }],
  // the armoured van's loop, drawn as a bar of light going down the deck and back
  sliders: [{ axis: 'x', at: 14, from: 35, to: 45, phase: 0.2, speed: 1.6 }],
  lines: [
    { x: 40, y: 25, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
    { x: 41, y: 25, spanX: true, orient: 'h', count: 3, phase: 0.3, gap: 0 },
  ],
  stations: [
    { title: 'The barrier lane', goal: { level: 0, x: 10, y: 14 }, checkpoint: { level: 0, x: 2, y: 13 }, text: 'The gatehouse lift lets you in off the street. A barrier arm across the lane: wait for it to rise.' },
    { title: 'The loading bays', goal: { level: 0, x: 24, y: 14 }, checkpoint: { level: 0, x: 10, y: 14 }, text: 'Bays, parked vans and guards. Slip along the aisles between them.' },
    { title: 'The ramp', goal: { level: 1, x: 29, y: 14 }, checkpoint: { level: 0, x: 24, y: 14 }, text: 'The ramp climbs east to the parking deck.' },
    { title: 'The parking deck', goal: { level: 1, x: 46, y: 14 }, checkpoint: { level: 1, x: 29, y: 14 }, text: 'A bar of light sweeps the middle lane: the van’s headlights. Time it, or go round.' },
    { title: 'The control booth', goal: { level: 1, x: 40, y: 26 }, checkpoint: { level: 1, x: 40, y: 22 }, text: 'Rising lines across the booth hall, and the booth itself.' },
    { title: 'The vault ramp', goal: { level: 2, x: 51, y: 14 }, checkpoint: { level: 1, x: 46, y: 14 }, text: 'Up to the vault level.' },
    { title: 'The antechamber', goal: { level: 2, x: 55, y: 14 }, checkpoint: { level: 2, x: 51, y: 14 }, text: 'A pulsing barrier, then the antechamber with a terminal and the manifest lockers.' },
    { title: 'The vault', goal: { level: 2, x: 59, y: 25 }, checkpoint: { level: 2, x: 59, y: 22 }, text: 'A sweeping laser across the vault’s passage. The lift is in its far corner.' },
  ],
  cameras: [
    ['A', 'E', 15, 'monitor', 0],
    ['H1', 'N', 8, 'hall', 1, Math.PI / 2],
    ['Z1', 'N', 16, 'wide', 2],
    ['Z1', 'S', 20, 'monitor', 3],
    ['H2', 'N', 31, 'hall', 4, Math.PI / 2],
    ['Z2', 'N', 40, 'monitor', 5],
    ['Z2', 'E', 18, 'wide', 6],
    ['Z3', 'S', 38, 'monitor', 7],
    ['H3', 'N', 52, 'hall', 8, Math.PI / 2],
    ['Z4', 'N', 60, 'wide', 9],
    ['Z4', 'E', 12, 'monitor', 10],
    ['Z5', 'N', 62, 'wide', 11],
  ],
  patrolCounts: { Z1: 2, Z2: 2, Z3: 1, Z4: 2, Z5: 1 },
  clueRooms: ['Z1', 'Z2', 'Z4'],
};

function createBunkerPlan(raw: RawPlan) {
  const BUNKER_COLS = raw.cols;
  const BUNKER_ROWS = raw.rows;
  const BUNKER_LEVELS = raw.levels;
  const BUNKER_LEVEL_NAMES = raw.levelNames;
  const BUNKER_SPACES: readonly Space[] = raw.spaces;
  const BUNKER_START = raw.start;
  const BUNKER_EXIT = raw.exit;
  const BUNKER_EXIT_LEVEL = BUNKER_LEVELS - 1;
  const BUNKER_STAIRS: readonly BunkerStair[] = raw.stairs;
  const BUNKER_DUCTS: readonly Duct[] = raw.ducts;
  const BUNKER_SHAFTS: readonly Shaft[] = raw.shafts;
  const RAW_POSTS: readonly Post[] = raw.posts;
  const BUNKER_PACK = raw.pack;
  const BUNKER_GATES: readonly Gate[] = raw.gates;
  const BUNKER_SWEEPERS: readonly Sweeper[] = raw.sweepers;
  const BUNKER_SLIDERS: readonly Slider[] = raw.sliders;
  const BUNKER_LINES: readonly LineLaser[] = raw.lines;
  const BUNKER_STATIONS: readonly BunkerStation[] = raw.stations;
  const PATROL_COUNTS: Record<string, number> = raw.patrolCounts;
  const CLUE_ROOMS: readonly string[] = raw.clueRooms;
  const space = (id: string): Space => BUNKER_SPACES.find((s) => s.id === id)!;
  const spacesOn = (level: number): Space[] => BUNKER_SPACES.filter((s) => s.level === level);
  const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const spaceAt = (x: number, y: number): Space | undefined => BUNKER_SPACES.find((s) => inRect(s, x, y));
  /** The storey a cell's occupant (a post, a patrol, a dog) is on: that of the space it stands in. */
  const levelOfCell = (x: number, y: number): number => spaceAt(x, y)?.level ?? -1;
  const on = <T extends { x: number; y: number }>(list: readonly T[], level: number): T[] => list.filter((a) => levelOfCell(a.x, a.y) === level);

  /** The start (the lift in, in the arrival room's north-west corner, on level -3) and the way out (the blast-door lift, in the last room's south-east corner, on the ground floor). */

  // ---- the stairs: a flight in a walled stairwell, 2 cells wide, running along x for 4 cells between two storeys ----
  // `dir` 1 climbs toward +x (its first cell is its foot), -1 toward -x. The foot opens onto a room's cell on the lower storey, the head onto a hall's cell on the upper one. A flight is guarded at both
  // ends (its foot's room has sentries by it). On the lower storey the stairwell is a walled passage to the foot; on the upper one it is a hole, walled round, opening onto the landing.

  const stairCells = (s: BunkerStair): Array<{ x: number; y: number }> => {
    const out: Array<{ x: number; y: number }> = [];
    for (let y = s.y; y < s.y + s.width; y++) for (let x = s.x; x < s.x + s.run; x++) out.push({ x, y });
    return out;
  };
  /** The cells just outside a flight's two ends (a row of `width` each): where the lower storey's room meets the foot, and where the upper one's hall meets the head. */
  function stairEnds(s: BunkerStair): { foot: Array<{ x: number; y: number }>; head: Array<{ x: number; y: number }> } {
    const west = Array.from({ length: s.width }, (_, i) => ({ x: s.x - 1, y: s.y + i }));
    const east = Array.from({ length: s.width }, (_, i) => ({ x: s.x + s.run, y: s.y + i }));
    return s.dir === 1 ? { foot: west, head: east } : { foot: east, head: west };
  }
  const stairsOn = (level: number): BunkerStair[] => BUNKER_STAIRS.filter((s) => s.low === level || s.high === level);

  // ---- the ducts ----
  // A duct is a one-cell-wide corridor of cells (its cells are open in what is drawn and closed to the guards' paths), narrowed to a lane (DUCT_LANE) between solid sides and roofed low (DUCT_H):
  // crouch or crawl, never stand. It starts and ends at a cell beside a hall (or, for the spur, the lab), where the lane meets the space: the grate.


  /** `ends`: the cell each end of the duct opens onto (a space's cell, or for a spur another duct's cell), the first cell's and the last's; null where the end is a shaft (below). */


  const ductsOn = (level: number): Duct[] => BUNKER_DUCTS.filter((d) => d.level === level);

  /** The grapple shafts: a duct's last cell on `level`, hooked from below, comes out in the first cell of a duct on the storey above, the same cell. */

  /** The cell map in the game's training format: the spaces open, the duct cells and stairwells closed (the guards' map). `withDucts` opens them too (the drawn map: walls, lane, stairwell). */
  function bunkerMap(level: number, withDucts = false): string[] {
    const open = new Set<string>();
    for (const s of spacesOn(level)) for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) open.add(`${x},${y}`);
    // (The guards' map shuts the cells the furniture stands in: they walk the aisles. What is drawn keeps them open.)
    if (!withDucts) for (const k of furnishedCells(level)) open.delete(k);
    const key = (c: { x: number; y: number }): string => `${c.x},${c.y}`;
    const joins: Array<[string, string]> = [];
    if (withDucts) {
      for (const d of ductsOn(level)) {
        for (const c of d.cells) open.add(key(c));
        for (let i = 1; i < d.cells.length; i++) joins.push([key(d.cells[i - 1]!), key(d.cells[i]!)]);
        // the ends: a duct's first cell onto the first space cell it opens on, its last onto the last (a shaft's end has none)
        if (d.ends[0]) joins.push([key(d.cells[0]!), key(d.ends[0])]);
        if (d.ends[1]) joins.push([key(d.cells[d.cells.length - 1]!), key(d.ends[1])]);
      }
      for (const st of stairsOn(level)) {
        const cells = stairCells(st);
        for (const c of cells) open.add(key(c));
        for (const a of cells) for (const b of cells) if ((Math.abs(a.x - b.x) === 1 && a.y === b.y) || (Math.abs(a.y - b.y) === 1 && a.x === b.x)) if (key(a) < key(b)) joins.push([key(a), key(b)]);
        const ends = stairEnds(st);
        const side = st.low === level ? ends.foot : ends.head;
        const first = st.dir === 1 ? (st.low === level ? 0 : st.run - 1) : st.low === level ? st.run - 1 : 0; // the stairwell's column at that end
        side.forEach((o, i) => joins.push([key({ x: st.x + first, y: st.y + i }), key(o)]));
      }
    }
    const rows = BUNKER_ROWS;
    const cols = BUNKER_COLS;
    const g: string[][] = Array.from({ length: 2 * rows + 1 }, () => Array.from({ length: 2 * cols + 1 }, () => '#'));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!open.has(`${x},${y}`)) continue;
        g[2 * y + 1]![2 * x + 1] = ' ';
        // inside a space (both cells in the same space) the passage is open
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const a = spaceAt(x, y);
          const b = spaceAt(x + dx, y + dy);
          if (a && b && open.has(`${x + dx},${y + dy}`)) g[2 * y + 1 + dy]![2 * x + 1 + dx] = ' ';
        }
      }
    }
    for (const [a, b] of joins) {
      const [ax, ay] = a.split(',').map(Number) as [number, number];
      const [bx, by] = b.split(',').map(Number) as [number, number];
      g[ay + by + 1]![ax + bx + 1] = ' ';
    }
    if (level === 0) g[2 * BUNKER_START.y + 1]![2 * BUNKER_START.x + 1] = '@';
    if (level === BUNKER_EXIT_LEVEL) g[2 * BUNKER_EXIT.y + 1]![2 * BUNKER_EXIT.x + 1] = 'X';
    return g.map((r) => r.join(''));
  }

  // ---- the people ----



  /**
   * Sentry posts (two of each storey's are used): hall ends and room doors (the first eight), then ones standing facing a wall or a corner of their room (the rest): fixed, and with their backs to the
   * floor, so an agent who gets behind one can take it down.
   */

  // ---- standing against the walls ----
  // Everyone placed in a room stands at its edge, where the aisles are (the furniture fills the middle): a sentry on the cell against the wall it faces, a dog or an alpha on the nearest edge.

  /** Whether the cell touches a hall or a stair's end: a doorway, kept clear. */
  function atDoorway(x: number, y: number): boolean {
    const near = (a: number, b: number): boolean => spaceAt(a, b)?.hall === true;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => near(x + dx!, y + dy!))) return true;
    return BUNKER_STAIRS.some((st) => [...stairEnds(st).foot, ...stairEnds(st).head].some((c) => c.x === x && c.y === y));
  }

  function snapToEdge<T extends { x: number; y: number }>(a: T, taken: Set<string>, edge: (sp: Space, x: number, y: number) => 'N' | 'S' | 'E' | 'W'): T {
    const sp = spaceAt(a.x, a.y);
    if (!sp || sp.hall) {
      taken.add(`${a.x},${a.y}`);
      return a;
    }
    const side = edge(sp, a.x, a.y);
    const x = side === 'W' ? sp.x0 : side === 'E' ? sp.x1 : a.x;
    const y = side === 'N' ? sp.y0 : side === 'S' ? sp.y1 : a.y;
    const along = side === 'N' || side === 'S' ? 'x' : 'y';
    const lo = along === 'x' ? sp.x0 : sp.y0;
    const hi = along === 'x' ? sp.x1 : sp.y1;
    // along the wall to the nearest cell that is not a doorway and not taken
    for (let d = 0; d <= hi - lo; d++) {
      for (const sign of d === 0 ? [1] : [1, -1]) {
        const v = (along === 'x' ? x : y) + sign * d;
        if (v < lo || v > hi) continue;
        const cx = along === 'x' ? v : x;
        const cy = along === 'x' ? y : v;
        if (taken.has(`${cx},${cy}`) || atDoorway(cx, cy)) continue;
        taken.add(`${cx},${cy}`);
        return { ...a, x: cx, y: cy };
      }
    }
    return a;
  }
  const facingEdge = (f: number): 'N' | 'S' | 'E' | 'W' => (Math.abs(f - Math.PI) < 0.1 ? 'N' : Math.abs(f) < 0.1 ? 'S' : f > 0 ? 'E' : 'W');
  const nearestEdge = (sp: Space, x: number, y: number): 'N' | 'S' | 'E' | 'W' => {
    const d = { N: y - sp.y0, S: sp.y1 - y, W: x - sp.x0, E: sp.x1 - x };
    return (Object.keys(d) as Array<'N' | 'S' | 'E' | 'W'>).reduce((a, b) => (d[b] < d[a] ? b : a));
  };
  const takenStarts = new Set<string>();
  /** Eight sentries (two to a storey, picked from the posts above), each moved to the edge of its room, facing its wall. */
  const ALL_POSTS: readonly Post[] = RAW_POSTS.map((p) => ({ ...snapToEdge(p, takenStarts, (_s, _x, _y) => facingEdge(p.facing)), facing: p.facing }));
  /** Sentries on each storey, and patrols on each (so four guards walk or stand on a floor, besides the two on its containers). */
  /** `n` of the list, the first and then each next the farthest from those already taken, so they stand well apart. */
  function spreadOut<T extends { x: number; y: number }>(list: readonly T[], n: number): T[] {
    const out = list.slice(0, 1);
    while (out.length < n && out.length < list.length) {
      let best = list[0]!;
      let bestD = -1;
      for (const c of list) {
        const d = Math.min(...out.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      out.push(best);
    }
    return out;
  }
  const BUNKER_POSTS: readonly Post[] = Array.from({ length: BUNKER_LEVELS }, (_, l) => spreadOut(on(ALL_POSTS, l), SENTRIES_PER_LEVEL)).flat();


  /** The pair in hall 4: a pack that meets at the hall's middle (the hall is short now: the first stair's head is at its east end). */
  const RAW_DOGS: readonly Beast[] = raw.dogs.map((b) => ({ ...b, zone: space(b.zone) }));
  const RAW_ALPHAS: readonly Beast[] = raw.alphas.map((b) => ({ ...b, zone: space(b.zone) }));
  const BUNKER_DOGS: readonly Beast[] = RAW_DOGS.map((d) => snapToEdge(d, takenStarts, nearestEdge));
  const BUNKER_ALPHAS: readonly Beast[] = RAW_ALPHAS.map((a) => snapToEdge(a, takenStarts, nearestEdge));
  const dogsOn = (level: number): Beast[] => on(BUNKER_DOGS, level);
  const alphasOn = (level: number): Beast[] => on(BUNKER_ALPHAS, level);
  const postsOn = (level: number): Post[] => on(BUNKER_POSTS, level);
  const patrolsOn = (level: number): Patrol[] => on(BUNKER_PATROLS, level);
  const packOn = (level: number): typeof BUNKER_PACK | null => (levelOfCell(BUNKER_PACK.meet.x, BUNKER_PACK.meet.y) === level ? BUNKER_PACK : null);

  // ---- the lasers (a gate, a line group or a slider spans one cell, so a hall takes two side by side) ----

  const gatesOn = (level: number): Gate[] => on(BUNKER_GATES, level);
  const sweepersOn = (level: number): Sweeper[] => on(BUNKER_SWEEPERS, level);
  const slidersOn = (level: number): Slider[] => BUNKER_SLIDERS.filter((s) => levelOfCell(s.axis === 'x' ? s.from : s.at, s.axis === 'x' ? s.at : s.from) === level);
  const linesOn = (level: number): LineLaser[] => on(BUNKER_LINES, level);

  // ---- the stations: a checkpoint and a beacon at each hall's mouth and at the head of each stair ----


  // ---- the furniture: cover in pairs ----


  /** The cells a storey keeps clear of furniture: the lasers' cells, the start's and the way out's, the hall mouths (a room's cells touching a hall), the stairs' foot and head, the duct grates and the actors' posts. */
  function laserCells(level: number): Set<string> {
    const out = new Set<string>();
    const add = (x: number, y: number, r = 0): void => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.add(`${x + dx},${y + dy}`);
    };
    for (const g of gatesOn(level)) add(g.x, g.y);
    for (const s of sweepersOn(level)) add(s.x, s.y, 1);
    for (const l of linesOn(level)) add(l.x, l.y);
    for (const s of slidersOn(level)) for (let i = s.from; i <= s.to; i++) { add(i, s.at); add(i, s.at - 1); add(i, s.at + 1); }
    return out;
  }

  function clearCells(level: number): Set<string> {
    const out = laserCells(level);
    const add = (x: number, y: number, r = 0): void => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.add(`${x + dx},${y + dy}`);
    };
    if (level === 0) add(BUNKER_START.x, BUNKER_START.y, 1);
    if (level === BUNKER_EXIT_LEVEL) add(BUNKER_EXIT.x, BUNKER_EXIT.y, 1);
    for (const sp of spacesOn(level)) {
      if (!sp.hall) continue;
      for (let y = sp.y0 - 1; y <= sp.y1 + 1; y++) for (let x = sp.x0 - 1; x <= sp.x1 + 1; x++) {
        const other = spaceAt(x, y);
        if (other && !other.hall && !inRect(sp, x, y)) add(x, y, 1); // a room's cells at a hall's mouth, and one more round
      }
    }
    for (const st of stairsOn(level)) {
      const ends = stairEnds(st);
      for (const c of st.low === level ? ends.foot : ends.head) add(c.x, c.y, 1);
    }
    for (const d of ductsOn(level)) for (const o of d.ends) if (o) add(o.x, o.y);
    return out;
  }

  /** What each space is furnished with, by place. The lab first. */

  const GAP = 0.06;

  function pairAt(kind: string, cx: number, cz: number, alongX: boolean, sizes: Sizes, id: number, across = false): BunkerPiece[] {
    const { len, depth } = sizes[kind]!;
    const out: BunkerPiece[] = [];
    if (across) {
      // two long pieces side by side (a cell is four metres: two benches end to end would not fit)
      for (const side of [-1, 1]) {
        const px = alongX ? cx : cx + side * (depth / 2 + GAP / 2);
        const pz = alongX ? cz + side * (depth / 2 + GAP / 2) : cz;
        out.push({
          kind,
          cx: px,
          cz: pz,
          yaw: alongX ? 0 : Math.PI / 2,
          box: alongX ? { minX: px - len / 2, maxX: px + len / 2, minZ: pz - depth / 2, maxZ: pz + depth / 2 } : { minX: px - depth / 2, maxX: px + depth / 2, minZ: pz - len / 2, maxZ: pz + len / 2 },
          pair: id,
        });
      }
      return out;
    }
    for (const side of [-1, 1]) {
      const px = alongX ? cx + side * (len / 2 + GAP / 2) : cx;
      const pz = alongX ? cz : cz + side * (len / 2 + GAP / 2);
      out.push({
        kind,
        cx: px,
        cz: pz,
        yaw: alongX ? 0 : Math.PI / 2,
        box: alongX ? { minX: px - len / 2, maxX: px + len / 2, minZ: pz - depth / 2, maxZ: pz + depth / 2 } : { minX: px - depth / 2, maxX: px + depth / 2, minZ: pz - len / 2, maxZ: pz + len / 2 },
        pair: id,
      });
    }
    return out;
  }

  /** The furniture of the whole bunker: pairs, a lane between pairs, none in a doorway, a laser's cell or a post. */
  /** What share of a room's floor the furniture stands on. */
  const hash = (x: number, y: number): number => Math.abs((x * 73856093) ^ (y * 19349663)) % 997;
  const furnishedCache = new Map<number, Set<string>>();

  /**
   * The cells of each room the furniture stands in. A room keeps free only what it needs: the lasers' cells, the doorways (a hall's mouth, a stair's foot or head, a duct's grate), the cell
   * everyone starts in (they stand against the walls) and each camera's panel, joined into one network of aisles by the shortest ways between them. Everything else is furnished, a pair to a cell,
   * from the middle outward, up to FURNITURE_SHARE of the room's cells (the lasers' apart); what is left over is more aisle, if it touches the network.
   */
  function furnishedCells(level: number): Set<string> {
    const cached = furnishedCache.get(level);
    if (cached) return cached;
    const lasers = laserCells(level);
    const needed = new Set<string>(lasers);
    if (level === 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) needed.add(`${BUNKER_START.x + dx},${BUNKER_START.y + dy}`);
    if (level === BUNKER_EXIT_LEVEL) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) needed.add(`${BUNKER_EXIT.x + dx},${BUNKER_EXIT.y + dy}`);
    for (const a of [...BUNKER_POSTS, ...BUNKER_ALPHAS, ...BUNKER_DOGS, ...BUNKER_PACK.dogs]) needed.add(`${a.x},${a.y}`);
    for (const c of camerasOn(level)) needed.add(`${Math.round(c.x / CELL)},${Math.round(c.z / CELL)}`);
    for (const d of ductsOn(level)) for (const o of d.ends) if (o) needed.add(`${o.x},${o.y}`);
    const out = new Set<string>();
    for (const sp of spacesOn(level)) {
      if (sp.hall) continue;
      const inRoom = (x: number, y: number): boolean => x >= sp.x0 && x <= sp.x1 && y >= sp.y0 && y <= sp.y1;
      const cells: string[] = [];
      for (let y = sp.y0; y <= sp.y1; y++) for (let x = sp.x0; x <= sp.x1; x++) cells.push(`${x},${y}`);
      const must = cells.filter((k) => {
        const [x, y] = k.split(',').map(Number) as [number, number];
        return needed.has(k) || atDoorway(x, y);
      });
      // the aisles: every needed cell joined to the first by the shortest way, through whatever cells lie between
      const network = new Set<string>();
      if (must.length) {
        network.add(must[0]!);
        let left = must.filter((k) => !network.has(k));
        while (left.length) {
          const prev = new Map<string, string | null>();
          const queue: string[] = [];
          for (const k of network) {
            prev.set(k, null);
            queue.push(k);
          }
          let hit: string | null = null;
          for (let q = 0; q < queue.length && !hit; q++) {
            const k = queue[q]!;
            const [x, y] = k.split(',').map(Number) as [number, number];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const n = `${x + dx},${y + dy}`;
              if (!inRoom(x + dx, y + dy) || prev.has(n)) continue;
              prev.set(n, k);
              if (left.includes(n)) {
                hit = n;
                break;
              }
              queue.push(n);
            }
          }
          if (!hit) break;
          for (let k: string | null = hit; k; k = prev.get(k) ?? null) network.add(k);
          left = left.filter((k) => !network.has(k));
        }
      }
      // the furniture: the middle first
      const edge = (k: string): number => {
        const [x, y] = k.split(',').map(Number) as [number, number];
        return Math.min(x - sp.x0, sp.x1 - x, y - sp.y0, sp.y1 - y);
      };
      const goal = Math.ceil((raw.furnitureShare?.[sp.id] ?? FURNITURE_SHARE) * cells.filter((k) => !lasers.has(k)).length);
      const rest = cells
        .filter((k) => !network.has(k) && !lasers.has(k))
        .sort((a, b) => edge(b) - edge(a) || hash(...(a.split(',').map(Number) as [number, number])) - hash(...(b.split(',').map(Number) as [number, number])));
      const furnished = new Set(rest.slice(0, goal));
      // what is left over is aisle only where it touches the network: the rest is furnished too
      const free = new Set(cells.filter((k) => !furnished.has(k)));
      const reach = new Set<string>();
      const stack = [...network];
      for (const k of network) reach.add(k);
      while (stack.length) {
        const [x, y] = stack.pop()!.split(',').map(Number) as [number, number];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = `${x + dx},${y + dy}`;
          if (free.has(n) && !reach.has(n)) {
            reach.add(n);
            stack.push(n);
          }
        }
      }
      for (const k of cells) if (!reach.has(k) && !lasers.has(k)) furnished.add(k);
      for (const k of furnished) out.add(k);
    }
    furnishedCache.set(level, out);
    return out;
  }

  /** The pairs on one storey. */
  function bunkerPieces(sizes: Sizes, placeId = 'lab', level = 0): BunkerPiece[] {
    const set = BUNKER_SETS[placeId] ?? BUNKER_SETS['lab']!;
    const clear = clearCells(level);
    const furnished = furnishedCells(level);
    const posts = new Set<string>([...postsOn(level), ...alphasOn(level), ...dogsOn(level), ...(packOn(level)?.dogs ?? [])].map((p) => `${p.x},${p.y}`));
    const slidable = raw.slideRooms ?? [];
    const walk = slidable.length > 0 ? walkableCells(level) : new Set<string>();
    const banksIn = new Map<string, number>();
    const out: BunkerPiece[] = [];
    let id = level * 1000;
    for (const sp of spacesOn(level)) {
      const kinds = sp.hall ? set['hall'] : set[sp.id];
      if (!kinds) continue;
      if (sp.hall) {
        // staggered along the hall: a pair against one wall, the next against the other, every cell along
        const vertical = sp.y1 - sp.y0 > sp.x1 - sp.x0;
        let i = 0;
        for (let t = (vertical ? sp.y0 : sp.x0) + 1; t < (vertical ? sp.y1 : sp.x1); t += 1, i++) {
          const kind = kinds[i % kinds.length]!;
          const { depth } = sizes[kind]!;
          const left = i % 2 === 0;
          const cellA = vertical ? { x: left ? sp.x0 : sp.x1, y: t } : { x: t, y: left ? sp.y0 : sp.y1 };
          if (clear.has(`${cellA.x},${cellA.y}`) || posts.has(`${cellA.x},${cellA.y}`)) continue;
          let cx: number;
          let cz: number;
          if (vertical) {
            cx = left ? sp.x0 * CELL - CELL / 2 + depth / 2 + 0.35 : sp.x1 * CELL + CELL / 2 - depth / 2 - 0.35;
            cz = t * CELL;
          } else {
            cx = t * CELL;
            cz = left ? sp.y0 * CELL - CELL / 2 + depth / 2 + 0.35 : sp.y1 * CELL + CELL / 2 - depth / 2 - 0.35;
          }
          out.push(...pairAt(kind, cx, cz, !vertical, sizes, id++));
        }
        continue;
      }
      // a room: blocks of cargo containers (two cells long, one wide, standing end to end and side by side) and, where a cell has no neighbour to share one, a pair of furniture: the cells the plan furnishes
      const done = new Set<string>();
      let i = 0;
      for (let y = sp.y0; y <= sp.y1; y++) {
        for (let x = sp.x0; x <= sp.x1; x++) {
          const k = `${x},${y}`;
          if (!furnished.has(k) || done.has(k)) continue;
          done.add(k);
          const east = `${x + 1},${y}`;
          const south = `${x},${y + 1}`;
          const wantsBox = hash(x, y) % 5 < 3;
          const along = hash(y, x) % 2 === 0;
          const free = (q: string): boolean => furnished.has(q) && !done.has(q);
          const horizontal = wantsBox && free(east) && (along || !free(south));
          const vertical = wantsBox && !horizontal && free(south);
          if (horizontal || vertical) {
            done.add(horizontal ? east : south);
            const cx = (x + (horizontal ? 0.5 : 0)) * CELL;
            const cz = (y + (vertical ? 0.5 : 0)) * CELL;
            const { len, depth } = sizes['cargo']!;
            // In a room whose banks slide: a block with a free aisle beside it (and its wheel end reachable) is a bank, up to four to a room.
            let slide: { dx: number; dy: number } | undefined;
            if (slidable.includes(sp.id) && (banksIn.get(sp.id) ?? 0) < 4) {
              const cells = [{ x, y }, horizontal ? { x: x + 1, y } : { x, y: y + 1 }];
              const door = horizontal ? { x: x + 2, y } : { x, y: y - 1 };
              const steps = horizontal ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
              if (walk.has(`${door.x},${door.y}`)) {
                slide = steps.find((d) =>
                  cells.every((c) => {
                    const k = `${c.x + d.dx},${c.y + d.dy}`;
                    return inRect(sp, c.x + d.dx, c.y + d.dy) && !furnished.has(k) && !clear.has(k) && !posts.has(k);
                  })
                );
              }
              if (slide) banksIn.set(sp.id, (banksIn.get(sp.id) ?? 0) + 1);
            }
            out.push({
              kind: slide ? 'bank' : 'cargo',
              ...(slide ? { slide } : {}),
              cx,
              cz,
              yaw: horizontal ? 0 : Math.PI / 2,
              box: horizontal ? { minX: cx - len / 2, maxX: cx + len / 2, minZ: cz - depth / 2, maxZ: cz + depth / 2 } : { minX: cx - depth / 2, maxX: cx + depth / 2, minZ: cz - len / 2, maxZ: cz + len / 2 },
              pair: id++,
            });
            continue;
          }
          const kind = kinds[(i + hash(x, y)) % kinds.length]!;
          i++;
          const { len } = sizes[kind]!;
          out.push(...pairAt(kind, x * CELL, y * CELL, hash(y, x) % 2 === 0, sizes, id++, len * 2 + GAP > 3.9));
        }
      }
    }
    return out;
  }

  /** The lane and sides of a duct cell, in world metres: the solid sub-rectangles (the four corners, and each side that is closed), for the walls round the lane. */
  function ductCellSolids(x: number, y: number, openSides: { N: boolean; S: boolean; E: boolean; W: boolean }): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
    const cx = x * CELL;
    const cz = y * CELL;
    const h = CELL / 2;
    const w = DUCT_LANE / 2;
    const xs = [cx - h, cx - w, cx + w, cx + h];
    const zs = [cz - h, cz - w, cz + w, cz + h];
    const out: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
    for (let iz = 0; iz < 3; iz++) {
      for (let ix = 0; ix < 3; ix++) {
        const centre = ix === 1 && iz === 1;
        const side = (ix === 1 ? (iz === 0 ? 'N' : iz === 2 ? 'S' : null) : iz === 1 ? (ix === 0 ? 'W' : 'E') : null) as 'N' | 'S' | 'E' | 'W' | null;
        if (centre) continue;
        if (side && openSides[side]) continue;
        out.push({ minX: xs[ix]!, maxX: xs[ix + 1]!, minZ: zs[iz]!, maxZ: zs[iz + 1]! });
      }
    }
    return out;
  }


  // ---- the security cameras ----
  // The walls are twice a maze wall's height (BUNKER_WALL_H) and every camera sits on the top of one, looking down on its room or hall: it sweeps, and some have a 180 degree lens. Each has a
  // panel on the wall at hand height under it (Interact switches that camera off for good); the cone is drawn on the floor.

  /** The bunker's walls: twice the maze's three metres. */
  /** How high a camera's head hangs: just under the top of the wall. */

  const LENSES: Record<Lens, { sweep: number; half: number; range: number; period: number }> = {
    /** Sweeps back and forth across a room. */
    monitor: { sweep: 0.9, half: 0.38, range: 16, period: 8 },
    /** A 180 degree lens, nearly still: covers the whole room before it, up close. */
    wide: { sweep: 0.3, half: Math.PI / 2, range: 10, period: 10 },
    /** Down the length of a hall. */
    hall: { sweep: 0.45, half: 0.3, range: 24, period: 9 },
  };
  const INWARD: Record<Side, number> = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 };

  function camera(spaceId: string, side: Side, at: number, lens: Lens, i: number, face: number = INWARD[side]): CameraPlan {
    const sp = space(spaceId);
    const left = sp.x0 * CELL - CELL / 2;
    const right = sp.x1 * CELL + CELL / 2;
    const top = sp.y0 * CELL - CELL / 2;
    const bottom = sp.y1 * CELL + CELL / 2;
    const MOUNT = 0.55; // from the wall's middle, the way a panel is (tower.ts's buildCameras)
    const x = side === 'W' ? left + MOUNT : side === 'E' ? right - MOUNT : at * CELL;
    const z = side === 'N' ? top + MOUNT : side === 'S' ? bottom - MOUNT : at * CELL;
    return { level: sp.level, x, z, face, wall: side, high: false, mountY: BUNKER_CAMERA_Y, phase: (i * 0.37) % 1, ...LENSES[lens] };
  }

  /** The cameras: 20, on every storey. `at` is the cell along the wall the camera is on (x for a north or south wall, y for a west or east one): never at a hall's mouth or a duct's grate. */
  const BUNKER_CAMERAS: readonly CameraPlan[] = raw.cameras.map(([spaceId, side, at, lens, i, face]) => camera(spaceId, side, at, lens, i, face));
  const camerasOn = (level: number): CameraPlan[] => BUNKER_CAMERAS.filter((c) => c.level === level);

  /** Patrols per room (two to a storey, eight in all). */

  /**
   * Eight patrols, each walking a beat of four cells of its room's aisles, as far from one another as the aisles allow (so each crosses the room): they start spread along the free cells,
   * on none that anyone else starts on. The guards find their way along the aisles (the furniture's cells are shut in their map).
   */
  const BUNKER_PATROLS: readonly Patrol[] = (() => {
    const taken = new Set<string>([...BUNKER_POSTS, ...BUNKER_DOGS, ...BUNKER_PACK.dogs, ...BUNKER_ALPHAS].map((a) => `${a.x},${a.y}`));
    const out: Patrol[] = [];
    for (const sp of BUNKER_SPACES) {
      const n = PATROL_COUNTS[sp.id];
      if (!n) continue;
      const furnished = furnishedCells(sp.level);
      const clear = clearCells(sp.level);
      const free: Array<{ x: number; y: number }> = [];
      for (let y = sp.y0; y <= sp.y1; y++) for (let x = sp.x0; x <= sp.x1; x++) if (!furnished.has(`${x},${y}`) && !clear.has(`${x},${y}`)) free.push({ x, y });
      for (let k = 0; k < n; k++) {
        let at = Math.floor(((k + 0.5) / n) * free.length);
        while (taken.has(`${free[at % free.length]!.x},${free[at % free.length]!.y}`)) at++;
        const start = free[at % free.length]!;
        taken.add(`${start.x},${start.y}`);
        const route = [start];
        for (let j = 1; j < 4; j++) {
          let best = free[0]!;
          let bestD = -1;
          for (const c of free) {
            const d = Math.min(...route.map((r) => Math.hypot(r.x - c.x, r.y - c.y)));
            if (d > bestD) {
              bestD = d;
              best = c;
            }
          }
          route.push(best);
        }
        if (k % 2 === 1) route.push(...route.splice(1).reverse());
        out.push({ x: start.x, y: start.y, round: route.map((c) => ({ ...c })) });
      }
    }
    return out;
  })();

  // ---- guards on the container roofs ----
  // The cargo containers stand end to end and side by side, so their roofs make islands of connected cells a guard can walk (the agent climbs up to them: game.ts's roof climb). A roof's
  // cells are the cells its containers cover; the nav grid for the guards up there joins each cell to its neighbours on the roof and to nothing else (the edge is the edge).

  /** The connected islands of roof cells (each a list of "x,y" keys), the biggest first. */
  function roofIslands(cells: ReadonlySet<string>): string[][] {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const start of [...cells].sort()) {
      if (seen.has(start)) continue;
      const island: string[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const k = stack.pop()!;
        island.push(k);
        const [x, y] = k.split(',').map(Number) as [number, number];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = `${x + dx},${y + dy}`;
          if (cells.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      out.push(island);
    }
    return out.sort((a, b) => b.length - a.length);
  }

  /** The guards' nav grid for a storey's roofs: a cell is open to each neighbour that is also roof. */
  function roofNav(cells: ReadonlySet<string>, cols: number, rows: number): Array<Array<{ N: boolean; S: boolean; E: boolean; W: boolean }>> {
    return Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => {
        const here = cells.has(`${x},${y}`);
        return { N: here && cells.has(`${x},${y - 1}`), S: here && cells.has(`${x},${y + 1}`), E: here && cells.has(`${x + 1},${y}`), W: here && cells.has(`${x - 1},${y}`) };
      })
    );
  }

  /**
   * The patrols on a storey's roofs: one on each island of at least `minCells` cells, two on one of at least `bigCells`, the biggest first, `max` in all. Each walks four cells of its
   * island, as far from one another as the island allows, and starts on the first; no two start on one cell.
   */
  function roofRoutes(cells: ReadonlySet<string>, max = 2, minCells = 8, bigCells = 20): Array<{ start: { x: number; y: number }; route: Array<{ x: number; y: number }> }> {
    const out: Array<{ start: { x: number; y: number }; route: Array<{ x: number; y: number }> }> = [];
    const taken = new Set<string>();
    for (const island of roofIslands(cells)) {
      if (island.length < minCells) continue;
      const pts = island.map((k) => k.split(',').map(Number) as [number, number]).map(([x, y]) => ({ x, y })).sort((a, b) => a.y - b.y || a.x - b.x);
      const n = island.length >= bigCells ? 2 : 1;
      for (let g = 0; g < n && out.length < max; g++) {
        let at = Math.floor(((g + 0.5) / n) * pts.length);
        while (taken.has(`${pts[at % pts.length]!.x},${pts[at % pts.length]!.y}`)) at++;
        const start = pts[at % pts.length]!;
        taken.add(`${start.x},${start.y}`);
        const route = [start];
        for (let j = 1; j < 4; j++) {
          let best = pts[0]!;
          let bestD = -1;
          for (const c of pts) {
            const d = Math.min(...route.map((r) => Math.hypot(r.x - c.x, r.y - c.y)));
            if (d > bestD) {
              bestD = d;
              best = c;
            }
          }
          route.push(best);
        }
        out.push({ start, route });
      }
      if (out.length >= max) break;
    }
    return out;
  }

  // ---- the objective (tasks/plan.md): systems that hold clues, and the containers one of which holds the dossier ----

  /** A clue system: a console on a room's wall, worked from the aisle cell in front of that wall (its own cell: the aisles run along the walls). */

  /** The room of each storey the clue system is in: the barracks, the armoury, the reactor hall (the control room is too full of furniture to have a wall aisle), the blast-door room. */

  const SIDE_STEP: Record<Side, { dx: number; dy: number }> = { N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 } };

  /** Everyone's starting cell on a storey, and the cells round each camera (its panel is on the wall under it). */
  function occupiedCells(level: number): Set<string> {
    const out = new Set<string>();
    for (const a of [...postsOn(level), ...patrolsOn(level), ...dogsOn(level), ...alphasOn(level), ...(packOn(level)?.dogs ?? [])]) out.add(`${a.x},${a.y}`);
    for (const c of camerasOn(level)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.add(`${Math.round(c.x / CELL) + dx},${Math.round(c.z / CELL) + dy}`);
    return out;
  }

  /** The clue system of a storey: on the wall of its room's aisle that is farthest from where the room is entered, on a cell nobody starts on. */
  function clueFor(level: number): BunkerClue | null {
    const sp = BUNKER_SPACES.find((q) => q.level === level && q.id === CLUE_ROOMS[level]);
    if (!sp) return null;
    const furnished = furnishedCells(level);
    const clear = clearCells(level);
    const occupied = occupiedCells(level);
    const mouths: Cell[] = [];
    for (let y = sp.y0; y <= sp.y1; y++) for (let x = sp.x0; x <= sp.x1; x++) if (atDoorway(x, y)) mouths.push({ x, y });
    let best: BunkerClue | null = null;
    let bestScore = -1;
    for (let y = sp.y0; y <= sp.y1; y++) {
      for (let x = sp.x0; x <= sp.x1; x++) {
        const k = `${x},${y}`;
        if (furnished.has(k) || clear.has(k) || occupied.has(k) || atDoorway(x, y)) continue;
        const against = (Object.keys(SIDE_STEP) as Side[]).filter((d) => !inRect(sp, x + SIDE_STEP[d].dx, y + SIDE_STEP[d].dy));
        if (against.length !== 1) continue; // against one wall, not in a corner
        const side = against[0]!;
        const stand = { x, y };
        const far = mouths.length ? Math.min(...mouths.map((m) => Math.hypot(m.x - x, m.y - y))) : 0;
        const score = far * 100 - hash(x, y) % 7;
        if (score > bestScore) {
          bestScore = score;
          best = { level, space: sp.id, x, y, side, stand };
        }
      }
    }
    return best;
  }

  /** One clue system on each storey. */
  const BUNKER_CLUES: readonly BunkerClue[] = Array.from({ length: BUNKER_LEVELS }, (_, l) => clueFor(l)).filter((c): c is BunkerClue => c !== null);
  const clueOn = (level: number): BunkerClue | null => BUNKER_CLUES.find((c) => c.level === level) ?? null;

  /** Where a storey is entered: the start on the lowest, the cell by the head of the stair below on the rest. */
  function entryCell(level: number): Cell {
    return level === 0 ? BUNKER_START : stairEnds(BUNKER_STAIRS.find((s) => s.high === level)!).head[0]!;
  }

  /** The cells of a storey the agent can walk to on foot from where it is entered, with the furniture shut (the rooms' aisles and the halls): "x,y" keys. */
  function walkableCells(level: number): Set<string> {
    const furnished = furnishedCells(level);
    const open = (x: number, y: number): boolean => spaceAt(x, y)?.level === level && !furnished.has(`${x},${y}`);
    const start = entryCell(level);
    const seen = new Set<string>();
    const stack = open(start.x, start.y) ? [start] : [];
    if (stack.length) seen.add(`${start.x},${start.y}`);
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of Object.values(SIDE_STEP)) {
        const x = c.x + d.dx;
        const y = c.y + d.dy;
        const k = `${x},${y}`;
        if (!seen.has(k) && open(x, y)) {
          seen.add(k);
          stack.push({ x, y });
        }
      }
    }
    return seen;
  }

  /** A cargo container of a storey, numbered by the order the plan lists them: where it is, the cells it covers, and the cell at its door end (the doors are at the end of its length that faces east, or north when it lies the other way). */

  /** The containers of a storey, numbered in the order bunkerPieces lists them (so the numbers are stable). */
  function containersOn(level: number, sizes: Sizes, placeId = 'lab'): BunkerContainer[] {
    const out: BunkerContainer[] = [];
    for (const p of bunkerPieces(sizes, placeId, level)) {
      if (p.kind !== 'cargo') continue;
      const index = out.length;
      const along = p.yaw === 0;
      const x = Math.round(p.cx / CELL - (along ? 0.5 : 0));
      const y = Math.round(p.cz / CELL - (along ? 0 : 0.5));
      out.push({
        id: `${level}:${index}`,
        level,
        index,
        cx: p.cx,
        cz: p.cz,
        yaw: p.yaw,
        box: p.box,
        cells: [{ x, y }, along ? { x: x + 1, y } : { x, y: y + 1 }],
        door: along ? { x: x + 2, y } : { x, y: y - 1 },
      });
    }
    return out;
  }

  /** The containers the agent can get to the door of: its door-end cell is free of furniture and reachable on foot. These are the ones the dossier may be in. */
  function openContainers(level: number, sizes: Sizes, placeId = 'lab'): BunkerContainer[] {
    const walk = walkableCells(level);
    return containersOn(level, sizes, placeId).filter((c) => walk.has(`${c.door.x},${c.door.y}`));
  }

  return {
    BUNKER_ALPHAS,
    BUNKER_CAMERAS,
    BUNKER_CLUES,
    BUNKER_COLS,
    BUNKER_DOGS,
    BUNKER_DUCTS,
    BUNKER_EXIT,
    BUNKER_EXIT_LEVEL,
    BUNKER_GATES,
    BUNKER_LEVELS,
    BUNKER_LEVEL_NAMES,
    BUNKER_LINES,
    BUNKER_PACK,
    BUNKER_PATROLS,
    BUNKER_POSTS,
    BUNKER_ROWS,
    BUNKER_SHAFTS,
    BUNKER_SLIDERS,
    BUNKER_SPACES,
    BUNKER_STAIRS,
    BUNKER_START,
    BUNKER_STATIONS,
    BUNKER_SWEEPERS,
    CLUE_ROOMS,
    alphasOn,
    atDoorway,
    bunkerMap,
    bunkerPieces,
    camerasOn,
    clearCells,
    clueOn,
    containersOn,
    dogsOn,
    ductCellSolids,
    ductsOn,
    entryCell,
    furnishedCells,
    gatesOn,
    levelOfCell,
    linesOn,
    openContainers,
    packOn,
    patrolsOn,
    postsOn,
    roofIslands,
    roofNav,
    roofRoutes,
    slidersOn,
    space,
    spaceAt,
    spacesOn,
    stairCells,
    stairEnds,
    stairsOn,
    sweepersOn,
    walkableCells,
  };
}

const PLANS = { sump: createBunkerPlan(SUMP_RAW), annex: createBunkerPlan(ANNEX_RAW), store: createBunkerPlan(STORE_RAW), depot: createBunkerPlan(DEPOT_RAW) };
export type BunkerPlanId = keyof typeof PLANS;
const SUMP = PLANS.sump;

/** The selected plan's names, re-pointed by selectBunkerPlan. */
export let BUNKER_COLS = SUMP.BUNKER_COLS;
export let BUNKER_ROWS = SUMP.BUNKER_ROWS;
export let BUNKER_LEVELS = SUMP.BUNKER_LEVELS;
export let BUNKER_LEVEL_NAMES = SUMP.BUNKER_LEVEL_NAMES;
export let BUNKER_SPACES = SUMP.BUNKER_SPACES;
export let space = SUMP.space;
export let spacesOn = SUMP.spacesOn;
export let spaceAt = SUMP.spaceAt;
export let levelOfCell = SUMP.levelOfCell;
export let BUNKER_START = SUMP.BUNKER_START;
export let BUNKER_EXIT = SUMP.BUNKER_EXIT;
export let BUNKER_EXIT_LEVEL = SUMP.BUNKER_EXIT_LEVEL;
export let BUNKER_STAIRS = SUMP.BUNKER_STAIRS;
export let stairCells = SUMP.stairCells;
export let stairEnds = SUMP.stairEnds;
export let stairsOn = SUMP.stairsOn;
export let BUNKER_DUCTS = SUMP.BUNKER_DUCTS;
export let ductsOn = SUMP.ductsOn;
export let BUNKER_SHAFTS = SUMP.BUNKER_SHAFTS;
export let bunkerMap = SUMP.bunkerMap;
export let atDoorway = SUMP.atDoorway;
export let BUNKER_POSTS = SUMP.BUNKER_POSTS;
export let BUNKER_PACK = SUMP.BUNKER_PACK;
export let BUNKER_DOGS = SUMP.BUNKER_DOGS;
export let BUNKER_ALPHAS = SUMP.BUNKER_ALPHAS;
export let dogsOn = SUMP.dogsOn;
export let alphasOn = SUMP.alphasOn;
export let postsOn = SUMP.postsOn;
export let patrolsOn = SUMP.patrolsOn;
export let packOn = SUMP.packOn;
export let BUNKER_GATES = SUMP.BUNKER_GATES;
export let BUNKER_SWEEPERS = SUMP.BUNKER_SWEEPERS;
export let BUNKER_SLIDERS = SUMP.BUNKER_SLIDERS;
export let BUNKER_LINES = SUMP.BUNKER_LINES;
export let gatesOn = SUMP.gatesOn;
export let sweepersOn = SUMP.sweepersOn;
export let slidersOn = SUMP.slidersOn;
export let linesOn = SUMP.linesOn;
export let BUNKER_STATIONS = SUMP.BUNKER_STATIONS;
export let clearCells = SUMP.clearCells;
export let furnishedCells = SUMP.furnishedCells;
export let bunkerPieces = SUMP.bunkerPieces;
export let ductCellSolids = SUMP.ductCellSolids;
export let BUNKER_CAMERAS = SUMP.BUNKER_CAMERAS;
export let camerasOn = SUMP.camerasOn;
export let BUNKER_PATROLS = SUMP.BUNKER_PATROLS;
export let roofIslands = SUMP.roofIslands;
export let roofNav = SUMP.roofNav;
export let roofRoutes = SUMP.roofRoutes;
export let CLUE_ROOMS = SUMP.CLUE_ROOMS;
export let BUNKER_CLUES = SUMP.BUNKER_CLUES;
export let clueOn = SUMP.clueOn;
export let entryCell = SUMP.entryCell;
export let walkableCells = SUMP.walkableCells;
export let containersOn = SUMP.containersOn;
export let openContainers = SUMP.openContainers;

/** Makes `id` the bunker every name in this file answers for (call before building the level). */
export function selectBunkerPlan(id: BunkerPlanId): void {
  const p = PLANS[id];
  BUNKER_COLS = p.BUNKER_COLS;
  BUNKER_ROWS = p.BUNKER_ROWS;
  BUNKER_LEVELS = p.BUNKER_LEVELS;
  BUNKER_LEVEL_NAMES = p.BUNKER_LEVEL_NAMES;
  BUNKER_SPACES = p.BUNKER_SPACES;
  space = p.space;
  spacesOn = p.spacesOn;
  spaceAt = p.spaceAt;
  levelOfCell = p.levelOfCell;
  BUNKER_START = p.BUNKER_START;
  BUNKER_EXIT = p.BUNKER_EXIT;
  BUNKER_EXIT_LEVEL = p.BUNKER_EXIT_LEVEL;
  BUNKER_STAIRS = p.BUNKER_STAIRS;
  stairCells = p.stairCells;
  stairEnds = p.stairEnds;
  stairsOn = p.stairsOn;
  BUNKER_DUCTS = p.BUNKER_DUCTS;
  ductsOn = p.ductsOn;
  BUNKER_SHAFTS = p.BUNKER_SHAFTS;
  bunkerMap = p.bunkerMap;
  atDoorway = p.atDoorway;
  BUNKER_POSTS = p.BUNKER_POSTS;
  BUNKER_PACK = p.BUNKER_PACK;
  BUNKER_DOGS = p.BUNKER_DOGS;
  BUNKER_ALPHAS = p.BUNKER_ALPHAS;
  dogsOn = p.dogsOn;
  alphasOn = p.alphasOn;
  postsOn = p.postsOn;
  patrolsOn = p.patrolsOn;
  packOn = p.packOn;
  BUNKER_GATES = p.BUNKER_GATES;
  BUNKER_SWEEPERS = p.BUNKER_SWEEPERS;
  BUNKER_SLIDERS = p.BUNKER_SLIDERS;
  BUNKER_LINES = p.BUNKER_LINES;
  gatesOn = p.gatesOn;
  sweepersOn = p.sweepersOn;
  slidersOn = p.slidersOn;
  linesOn = p.linesOn;
  BUNKER_STATIONS = p.BUNKER_STATIONS;
  clearCells = p.clearCells;
  furnishedCells = p.furnishedCells;
  bunkerPieces = p.bunkerPieces;
  ductCellSolids = p.ductCellSolids;
  BUNKER_CAMERAS = p.BUNKER_CAMERAS;
  camerasOn = p.camerasOn;
  BUNKER_PATROLS = p.BUNKER_PATROLS;
  roofIslands = p.roofIslands;
  roofNav = p.roofNav;
  roofRoutes = p.roofRoutes;
  CLUE_ROOMS = p.CLUE_ROOMS;
  BUNKER_CLUES = p.BUNKER_CLUES;
  clueOn = p.clueOn;
  entryCell = p.entryCell;
  walkableCells = p.walkableCells;
  containersOn = p.containersOn;
  openContainers = p.openContainers;
}
