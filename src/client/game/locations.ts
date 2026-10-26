// Where a job takes place. The campaign moves through six buildings, each with its own look (its floors'
// themes: palette, floor surface, wall trim, lighting and what stands round the outside of the level) and
// its own kinds of room, so jobs stop feeling like the same corridors:
//
//   jobs 1-5   the campus: offices and the data center above them
//   jobs 6-7   the museum: galleries below, a sculpture hall above (sweeping lasers debut here)
//   jobs 8-11  the refinery: a process floor of gratings and pipes, a control level above (the towers and pipes)
//   jobs 12+   the bank: a banking hall, a vault level above (timed shutters, and the fast curtains, are its vault)
//   after those, in turn: a dockside warehouse (racking and loading bays, a mezzanine above) and a research lab
//   (benches and specimen tanks, a cleanroom above)
//
// Data only, no scene: scene.ts builds a floor from its theme. Node-testable.

import type { FloorTheme } from './scene';
import type { LayoutStyle, LandmarkKind } from './layouts';

export type LocationId = 'campus' | 'museum' | 'refinery' | 'bank' | 'warehouse' | 'lab';

export type Location = {
  id: LocationId;
  name: string;
  /** The ground floor's theme, then the upper floor's. */
  floors: [FloorTheme, FloorTheme];
  /** How each of the two floors is laid out (layouts.ts), and what the big open room on each is (landmarks.ts). */
  layouts: [LayoutStyle, LayoutStyle];
  landmark: LandmarkKind;
  /** Said when the campaign first comes here. */
  arrival: string;
};


/** The campus, the two looks the game began with. */
export const FLOOR_THEMES: FloorTheme[] = [
  {
    name: 'Offices',
    wall: 0x5b6169,
    cap: 0x9aa3ad,
    floor: 'carpet',
    fixture: 0xcfe3ff,
    accents: [0x2e6b6e, 0xb23a3a, 0x8a5a2a, 0x2f5b8a],
    marking: 0xd9b35a,
    decorKinds: ['office', 'conference', 'cafeteria'],
    edge: { kind: 'campus', ground: 0x1c2026, lamp: 0xcfe3ff, windows: 0x9fd4ff },
  },
  {
    name: 'Data Center',
    wall: 0x3d4652,
    cap: 0x74828f,
    floor: 'raised',
    fixture: 0x8ff5e6,
    accents: [0x1f7a78, 0x2f5b8a, 0x4a8a3a, 0x5b3a8a],
    marking: 0x5fd4ff,
    decorKinds: ['rack', 'office', 'rack', 'conference'],
    edge: { kind: 'campus', ground: 0x161c22, lamp: 0x8ff5e6, windows: 0x8ff5e6 },
  },
];

const OFFICES = FLOOR_THEMES[0]!;
const DATA_CENTER = FLOOR_THEMES[1]!;

const MUSEUM_GALLERIES: FloorTheme = {
  name: 'Galleries',
  wall: 0x6b4a44,
  cap: 0xb8965a,
  floor: 'marble',
  fixture: 0xffd9a0,
  accents: [0x7a2f36, 0x2f5b6a, 0xa8873f],
  marking: 0xd9b35a,
  decorKinds: ['gallery', 'exhibit', 'gallery'],
  bands: [
    { y0: 0, y1: 0.28, color: 0xcfc7b8, out: 0.05 }, // marble skirting
    { y0: 2.35, y1: 2.43, color: 0xb8965a, out: 0.04, metal: true }, // brass picture rail
    { y0: 2.78, y1: 3.0, color: 0xd9d0bf, out: 0.08 }, // plaster cornice
  ],
  edge: { kind: 'museum', ground: 0x8a857c, lamp: 0xffd9a0, windows: 0xffd9a0 },
};

const MUSEUM_SCULPTURE: FloorTheme = {
  name: 'Sculpture Hall',
  wall: 0x4a5a56,
  cap: 0xc9c2b4,
  floor: 'marble',
  fixture: 0xe8f0e4,
  accents: [0x2f5b6a, 0x7a2f36],
  marking: 0xd9b35a,
  decorKinds: ['exhibit', 'gallery', 'exhibit'],
  bands: [
    { y0: 0, y1: 0.3, color: 0xd9d3c6, out: 0.06 },
    { y0: 2.4, y1: 2.47, color: 0xc9c2b4, out: 0.05, metal: true },
    { y0: 2.8, y1: 3.0, color: 0xe2ddd0, out: 0.08 },
  ],
  edge: { kind: 'museum', ground: 0x8a857c, lamp: 0xffd9a0, windows: 0xffd9a0 },
};

const REFINERY_PROCESS: FloorTheme = {
  name: 'Process Floor',
  wall: 0x4f5559,
  cap: 0x8b9299,
  floor: 'grating',
  fixture: 0xffb35a,
  accents: [0xc26a1a, 0xc2b13a, 0xb23a3a],
  marking: 0xc2b13a,
  decorKinds: ['boiler', 'control', 'boiler'],
  bands: [
    { y0: 0, y1: 0.3, color: 0xc2b13a, out: 0.04 }, // hazard-yellow kerb
    { y0: 1.05, y1: 1.2, color: 0x7a8087, out: 0.12, metal: true }, // a pipe run
    { y0: 2.3, y1: 2.55, color: 0xc26a1a, out: 0.13, metal: true }, // and another, rust-orange
  ],
  edge: { kind: 'refinery', ground: 0x2c2926, lamp: 0xffb35a, windows: 0xffb04a },
};

const REFINERY_CONTROL: FloorTheme = {
  name: 'Control Level',
  wall: 0x3f464d,
  cap: 0x8b9299,
  floor: 'raised',
  fixture: 0xffc27a,
  accents: [0xc26a1a, 0x2f5b8a],
  marking: 0xffb35a,
  decorKinds: ['control', 'boiler', 'control'],
  bands: [
    { y0: 0, y1: 0.3, color: 0x2a3035, out: 0.05 },
    { y0: 1.4, y1: 1.5, color: 0xc26a1a, out: 0.07, metal: true },
    { y0: 2.7, y1: 3.0, color: 0x2a3035, out: 0.08 },
  ],
  edge: { kind: 'refinery', ground: 0x2c2926, lamp: 0xffb35a, windows: 0xffb04a },
};

const BANK_HALL: FloorTheme = {
  name: 'Banking Hall',
  wall: 0x4a3a2e,
  cap: 0xb08d4a,
  floor: 'parquet',
  fixture: 0xffe0a8,
  accents: [0x5a1f24, 0xb08d4a, 0x2f5b3a],
  marking: 0xb08d4a,
  decorKinds: ['teller', 'deposit', 'teller'],
  bands: [
    { y0: 0, y1: 1.1, color: 0x33251b, out: 0.06 }, // wood wainscot
    { y0: 1.1, y1: 1.18, color: 0xb08d4a, out: 0.08, metal: true }, // brass rail
    { y0: 2.78, y1: 3.0, color: 0xd9d0bf, out: 0.08 },
  ],
  edge: { kind: 'bank', ground: 0x2b2826, lamp: 0xffe0a8, windows: 0xffe0a8 },
};

const BANK_VAULTS: FloorTheme = {
  name: 'Vault Level',
  wall: 0x505a63,
  cap: 0x9aa5ae,
  floor: 'raised',
  fixture: 0xdfefff,
  accents: [0xb08d4a, 0x5a1f24],
  marking: 0xb08d4a,
  decorKinds: ['deposit', 'teller', 'deposit'],
  bands: [
    { y0: 0, y1: 0.4, color: 0x3a4148, out: 0.05 },
    { y0: 1.5, y1: 1.58, color: 0xb08d4a, out: 0.06, metal: true },
    { y0: 2.85, y1: 3.0, color: 0x3a4148, out: 0.06 },
  ],
  edge: { kind: 'bank', ground: 0x2b2826, lamp: 0xffe0a8, windows: 0xffe0a8 },
};

const WAREHOUSE_FLOOR: FloorTheme = {
  name: 'Loading Floor',
  wall: 0x56606a,
  cap: 0x9aa4ad,
  floor: 'concrete',
  fixture: 0xfff0c0,
  accents: [0xd8a22a, 0x2a6fa8, 0xb23a2a],
  marking: 0xd8b02a,
  decorKinds: ['shelving', 'dock', 'shelving'],
  bands: [
    { y0: 0, y1: 0.35, color: 0xd8b02a, out: 0.05 }, // safety-yellow kerb
    { y0: 1.2, y1: 1.28, color: 0x2a3036, out: 0.05, metal: true }, // a steel girt
    { y0: 2.7, y1: 3.0, color: 0x2a3036, out: 0.08 },
  ],
  edge: { kind: 'warehouse', ground: 0x25282b, lamp: 0xfff0c0, windows: 0xffe9a8 },
};

const WAREHOUSE_MEZZANINE: FloorTheme = {
  name: 'Mezzanine',
  wall: 0x3f4a53,
  cap: 0x8b97a2,
  floor: 'grating',
  fixture: 0xffe3a0,
  accents: [0xd8a22a, 0x2a6fa8],
  marking: 0xffd24a,
  decorKinds: ['dock', 'shelving', 'dock'],
  bands: [
    { y0: 0, y1: 0.3, color: 0x20262b, out: 0.05 },
    { y0: 1.1, y1: 1.2, color: 0xd8a22a, out: 0.07, metal: true },
    { y0: 2.8, y1: 3.0, color: 0x20262b, out: 0.08 },
  ],
  edge: { kind: 'warehouse', ground: 0x25282b, lamp: 0xfff0c0, windows: 0xffe9a8 },
};

/** The dock yard (yardplan.ts): open air on concrete, fenced, with the warehouse's ground and skyline round it. */
export const DOCK_YARD: FloorTheme = {
  name: 'Dock Yard',
  wall: 0x56606a,
  cap: 0x9aa4ad,
  floor: 'concrete',
  fixture: 0xfff0c0,
  accents: [0xd8a22a, 0x2a6fa8, 0xb23a2a],
  marking: 0xd8b02a,
  decorKinds: ['dock', 'shelving', 'dock'],
  bands: [
    { y0: 0, y1: 0.35, color: 0xd8b02a, out: 0.05 },
    { y0: 2.7, y1: 3.0, color: 0x2a3036, out: 0.08 },
  ],
  edge: { kind: 'warehouse', ground: 0x25282b, lamp: 0xfff0c0, windows: 0xffe9a8 },
  fence: true,
};

/** The Tank Farm: the dock yard's open air, in a refinery's rust and grating under orange light. */
export const FARM_YARD: FloorTheme = {
  name: 'Tank Farm',
  wall: 0x4a403a,
  cap: 0x8a7466,
  floor: 'grating',
  fixture: 0xffc890,
  accents: [0xe0782a, 0x7a838d, 0xc2a22a],
  marking: 0xe0a02a,
  decorKinds: ['boiler', 'control', 'boiler'],
  bands: [
    { y0: 0, y1: 0.35, color: 0xe0a02a, out: 0.05 },
    { y0: 2.7, y1: 3.0, color: 0x2a2220, out: 0.08 },
  ],
  edge: { kind: 'warehouse', ground: 0x1d1816, lamp: 0xffc890, windows: 0xffb060 },
  fence: true,
};

const LAB_BENCHES: FloorTheme = {
  name: 'Laboratory',
  wall: 0x8a9aa3,
  cap: 0xdfe8ec,
  floor: 'tile',
  fixture: 0xe6fbff,
  accents: [0x1f9a98, 0x2f6fb0, 0x6a8a3a],
  marking: 0x5fd4c8,
  decorKinds: ['bench', 'specimen', 'bench'],
  bands: [
    { y0: 0, y1: 0.25, color: 0x5d6a72, out: 0.04 }, // a cove base
    { y0: 1.0, y1: 1.08, color: 0x1f9a98, out: 0.05 }, // a teal stripe at hand height
    { y0: 2.85, y1: 3.0, color: 0xdfe8ec, out: 0.05 },
  ],
  edge: { kind: 'lab', ground: 0x4c5558, lamp: 0xd6fbff, windows: 0x9ff0ff },
};

const LAB_CLEANROOM: FloorTheme = {
  name: 'Cleanroom',
  wall: 0x5d7480,
  cap: 0xc2d3db,
  floor: 'tile',
  fixture: 0xd6f5ff,
  accents: [0x1f9a98, 0x6a5acd],
  marking: 0x8ff5e6,
  decorKinds: ['specimen', 'bench', 'specimen'],
  bands: [
    { y0: 0, y1: 0.25, color: 0x2e3b43, out: 0.04 },
    { y0: 1.3, y1: 1.36, color: 0x8ff5e6, out: 0.04, metal: true },
    { y0: 2.85, y1: 3.0, color: 0x2e3b43, out: 0.05 },
  ],
  edge: { kind: 'lab', ground: 0x4c5558, lamp: 0xd6fbff, windows: 0x9ff0ff },
};

const CAMPUS: Location = { id: 'campus', name: 'The campus', floors: [OFFICES, DATA_CENTER], layouts: ['halls', 'halls'], landmark: 'commons', arrival: '' };
const MUSEUM: Location = {
  id: 'museum',
  name: 'The museum',
  floors: [MUSEUM_GALLERIES, MUSEUM_SCULPTURE],
  layouts: ['fishbone', 'plus'],
  landmark: 'greathall',
  arrival: 'NEW LOCATION · THE MUSEUM: MARBLE HALLS AND LONG GALLERIES. NOTHING SOFT TO MUFFLE A FOOTSTEP',
};
const REFINERY: Location = {
  id: 'refinery',
  name: 'The refinery',
  floors: [REFINERY_PROCESS, REFINERY_CONTROL],
  layouts: ['uturn', 'halls'],
  landmark: 'tankyard',
  arrival: 'NEW LOCATION · THE REFINERY: STEEL GRATING UNDERFOOT, PIPES OVERHEAD, MACHINERY LOUD ENOUGH TO COVER A FOOTSTEP',
};
const BANK: Location = {
  id: 'bank',
  name: 'The bank',
  floors: [BANK_HALL, BANK_VAULTS],
  layouts: ['halls', 'aisles'],
  landmark: 'vaulthall',
  arrival: 'NEW LOCATION · THE BANK: A BANKING HALL ABOVE, THE VAULTS BELOW. EVERYTHING LOCKS DOWN',
};

const WAREHOUSE: Location = {
  id: 'warehouse',
  name: 'The warehouse',
  floors: [WAREHOUSE_FLOOR, WAREHOUSE_MEZZANINE],
  layouts: ['aisles', 'uturn'],
  landmark: 'dockyard',
  arrival: 'NEW LOCATION · THE WAREHOUSE: RACKING TO THE ROOF, LOADING BAYS, FORKLIFTS. PLENTY OF SHADOW BETWEEN THE AISLES',
};
const LAB: Location = {
  id: 'lab',
  name: 'The lab',
  floors: [LAB_BENCHES, LAB_CLEANROOM],
  layouts: ['plus', 'fishbone'],
  landmark: 'atrium',
  arrival: 'NEW LOCATION · THE LAB: WHITE TILE, BRIGHT LIGHT, SPECIMEN TANKS. YOUR FOOTSTEPS CARRY, AND THERE IS NOWHERE DARK TO STAND',
};

// The white lab (the final operation): the same lab, laid white. White walls and floor and a thin blue light at hand height, in place of the lab's greys.
const CORE_GROUND: FloorTheme = {
  name: 'The white lab',
  wall: 0xe9eff3,
  cap: 0xffffff,
  floor: 'tile',
  fixture: 0xdff2ff,
  accents: [0x3da5ff, 0x8fd0ff, 0xb9e3ff],
  marking: 0x5fd4ff,
  decorKinds: ['specimen', 'bench', 'specimen'],
  bands: [
    { y0: 0, y1: 0.22, color: 0xbac8d1, out: 0.04 },
    { y0: 1.15, y1: 1.2, color: 0x4fb8ff, out: 0.05, metal: true }, // the blue line at hand height
    { y0: 2.85, y1: 3.0, color: 0xffffff, out: 0.05 },
  ],
  edge: { kind: 'lab', ground: 0xaab6bd, lamp: 0xe6f6ff, windows: 0x9fd8ff },
};
const CORE_UPPER: FloorTheme = {
  ...CORE_GROUND,
  name: 'The white lab, upper levels',
  wall: 0xdde6ec,
  decorKinds: ['specimen', 'specimen', 'bench'],
  bands: [
    { y0: 0, y1: 0.22, color: 0xaebdc7, out: 0.04 },
    { y0: 1.15, y1: 1.2, color: 0x7fc8ff, out: 0.05, metal: true },
    { y0: 2.85, y1: 3.0, color: 0xf4f9fc, out: 0.05 },
  ],
};

/** The white lab's look, in the lab's place: used where the run is the final operation (`options.core`, arc.ts). */
export const CORE_LOCATION: Location = { ...LAB, name: 'The white lab', floors: [CORE_GROUND, CORE_UPPER], arrival: 'THE WHITE LAB · WHITE TILE AND BLUE GLASS. THE SPECIMEN TANKS ARE LIT FROM INSIDE' };

export const LOCATIONS: Record<LocationId, Location> = { campus: CAMPUS, museum: MUSEUM, refinery: REFINERY, bank: BANK, warehouse: WAREHOUSE, lab: LAB };

/** The first jobs are all on the campus: the building the training and the opening story are set in, while the player learns the game. */
export const CAMPUS_JOBS = 2;

/**
 * After that the places take turns, so clearing a job always brings somewhere new: every round of six jobs visits all six places, in an
 * order that changes from round to round, and no place ever comes up twice running (including across the rounds' ends). The first three
 * stay the museum, the refinery and the bank, as they were.
 */
const ROUNDS: ReadonlyArray<readonly LocationId[]> = [
  ['museum', 'refinery', 'bank', 'warehouse', 'lab', 'campus'],
  ['refinery', 'campus', 'lab', 'museum', 'warehouse', 'bank'],
  ['lab', 'bank', 'campus', 'refinery', 'museum', 'warehouse'],
  ['campus', 'warehouse', 'bank', 'museum', 'refinery', 'lab'],
];

/** Where job `level` takes place. */
export function locationFor(level: number): Location {
  if (level <= CAMPUS_JOBS) return CAMPUS;
  const i = Math.floor(level) - CAMPUS_JOBS - 1;
  return LOCATIONS[ROUNDS[Math.floor(i / 6) % ROUNDS.length]![i % 6]!];
}

/** Whether `level` is the first job in a place the story hasn't been to yet: every place but the campus announces itself once. */
export function arrivesAt(level: number): Location | null {
  const here = locationFor(level);
  if (here.id === 'campus') return null;
  for (let n = 1; n < level; n++) if (locationFor(n).id === here.id) return null;
  return here;
}
