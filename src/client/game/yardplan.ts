// The dock yard's plan: the open-air level beside the water, as data. Eighteen by eleven cells of eight metres: a west bank where the way in is, a canal down the
// middle with a guarded bridge at its south end and a zipline across it, and an east bank with the port office (the file) and the truck out. Shipping containers stand
// in rows and blocks, some stacked; between them, lanes. Pure, so it is unit-tested under Node; yard.ts builds the scene from it.

export const YARD_COLS = 18;
export const YARD_ROWS = 11;
/** The yard is laid out for eight-metre cells. */
export const YARD_CELL = 8;

/** The canal runs down this column of cells (the rows listed are water; the last row is the bridge). */
export const CANAL_COL = 8;
export const CANAL_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const BRIDGE_ROW = 10;

/** The port office: a block of solid cells in the north-east, its one room opening south. */
export const OFFICE = { x0: 14, x1: 16, y0: 0, y1: 2, room: { x: 15, y: 2 } } as const;
/** The way out: a dead-end alcove on the east edge, its north and south neighbours solid so it can only be entered from the west. */
export const EXIT_CELL = { x: 17, y: 5 } as const;

export type ContainerSpec = {
  /** Centre, metres. */
  x: number;
  z: number;
  /** Twenty or forty feet (6.1 or 12.2), or a tank's or a rack's own length. */
  len: number;
  /** Along x (false) or along z (true). */
  alongZ: boolean;
  color: number;
  /** One high or two. */
  stack: 1 | 2;
  /** What it is: a shipping container (the default), or, in the Tank Farm, a round tank, a pipe rack, or a drum cage (which opens as a container does). */
  shape?: 'box' | 'tank' | 'rack' | 'cage';
  /** Its width across, metres, where it is not the container's: a tank's diameter, a rack's thickness. */
  width?: number;
};

const RED = 0xa83a2a;
const BLUE = 0x2a5f8a;
const GREEN = 0x3f6b3a;
const ORANGE = 0xc2662a;
const GREY = 0x6b7580;
const YELLOW = 0xc2a22a;
const TEAL = 0x2a7a7a;
const BROWN = 0x6a4a34;

export const CONTAINER_W = 2.44;
export const CONTAINER_H = 2.6;

function row(z: number, xs: number[], len: 6.1 | 12.2, colors: number[], stackAt: number[] = []): ContainerSpec[] {
  return xs.map((x, i) => ({ x, z, len, alongZ: false, color: colors[i % colors.length]!, stack: stackAt.includes(i) ? 2 : 1 }));
}
function column(x: number, zs: number[], len: 6.1 | 12.2, colors: number[], stackAt: number[] = []): ContainerSpec[] {
  return zs.map((z, i) => ({ x, z, len, alongZ: true, color: colors[i % colors.length]!, stack: stackAt.includes(i) ? 2 : 1 }));
}

export const DOCK_CONTAINERS: ContainerSpec[] = [
  // The west bank: long rows with gaps to cross, and a column down the middle.
  ...row(12, [24, 38], 12.2, [RED, BLUE], [1]),
  ...row(28, [14, 28, 46], 12.2, [GREEN, ORANGE, GREY], [0]),
  ...row(28, [4], 6.1, [YELLOW]),
  ...column(36, [46, 59], 12.2, [TEAL, RED], [1]),
  ...row(60, [12, 26], 12.2, [BLUE, BROWN]),
  ...row(68, [24, 42], 6.1, [GREY, GREEN], [0]),
  ...row(44, [12], 12.2, [ORANGE]),
  // The east bank.
  ...row(12, [86, 100], 12.2, [GREEN, RED], [0]),
  ...row(28, [80, 94, 112], 12.2, [BLUE, YELLOW, TEAL], [1]),
  ...column(108, [46, 59], 12.2, [RED, GREY], [0]),
  ...row(60, [84, 98], 12.2, [ORANGE, BLUE]),
  ...row(68, [92, 120], 6.1, [BROWN, TEAL], [1]),
  ...row(44, [122], 12.2, [GREEN]),
  ...row(76, [112], 12.2, [RED]),
];

/** The zipline: from the west bank over the canal to the east, a gentle drop. Heights are of the cable, metres. */
export const DOCK_ZIPLINE = {
  from: { x: 52, z: 40 },
  to: { x: 76, z: 40 },
  fromHeight: 5.2,
  toHeight: 3.5,
  /** Seconds from one end to the other. */
  rideS: 2.8,
  /** How far from the high end a hand reaches the handle. */
  reach: 2.4,
} as const;

/** Where the cable is (x, z, height) when the rider is `k` (0 to 1) of the way along: a straight line with a little sag in the middle. */
export function zipPoint(k: number): { x: number; y: number; z: number } {
  const z = DOCK_ZIPLINE;
  const t = Math.min(1, Math.max(0, k));
  const sag = 0.5 * Math.sin(t * Math.PI);
  return {
    x: z.from.x + (z.to.x - z.from.x) * t,
    y: z.fromHeight + (z.toHeight - z.fromHeight) * t - sag,
    z: z.from.z + (z.to.z - z.from.z) * t,
  };
}

/** Where the water is (metres): the canal's full length (the bridge row's cell is dry). */
export const DOCK_WATER = { minX: (CANAL_COL - 0.5) * YARD_CELL, maxX: (CANAL_COL + 0.5) * YARD_CELL, minZ: -0.5 * YARD_CELL, maxZ: (CANAL_ROWS[CANAL_ROWS.length - 1]! + 0.5) * YARD_CELL } as const;

// ---- who is here ----
const FACING = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 } as const;
export const DOCK_GUARDS = [
  { x: 2, y: 1, facing: FACING.S }, // by the gate
  { x: 7, y: 10, facing: FACING.E }, // each end of the bridge
  { x: 9, y: 10, facing: FACING.W },
  { x: 15, y: 4, facing: FACING.N }, // at the office door
];
export const DOCK_PATROLS = [
  { x: 4, y: 3 },
  { x: 5, y: 7 },
  { x: 11, y: 4 },
  { x: 13, y: 8 },
  { x: 15, y: 5 },
];
export const DOCK_DOGS = [
  { x: 3, y: 8 },
  { x: 12, y: 2 },
  { x: 14, y: 7 },
];
/** Hiding spots: pairs of crates (the same ones that take a body) among the containers. */
export const DOCK_CRATES = [
  { x: 2, y: 3 },
  { x: 6, y: 2 },
  { x: 3, y: 6 },
  { x: 6, y: 8 },
  { x: 1, y: 9 },
  { x: 10, y: 3 },
  { x: 12, y: 6 },
  { x: 13, y: 9 },
  { x: 16, y: 7 },
  { x: 11, y: 1 },
];

// ---- the Tank Farm: the same yard, laid out as a refinery's tank farm (docs/level-plan.md) ----
// Round tanks and pipe racks in place of the shipping containers, drum cages (the ones that open) among them, a pipe trench with steam down the middle in place of the canal, a flare stack in
// the corner. Same fence, same gate, same office and truck, so the map (tutorial.ts's DOCK_MAP) is the same; what differs is what stands on it.
export const FARM_CONTAINERS: ContainerSpec[] = [
  { x: 16.5, z: 19.0, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 17.2, z: 43.8, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 17.0, z: 67.7, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 39.1, z: 17.9, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 42.6, z: 64.5, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 90.1, z: 19.7, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 92.1, z: 40.6, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 92.2, z: 64.6, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 114.8, z: 64.9, len: 9, alongZ: false, color: 0x6c5a52, stack: 1, shape: 'tank', width: 9 },
  { x: 27.8, z: 18.4, len: 8, alongZ: false, color: 0x7a838d, stack: 1, shape: 'rack', width: 1.6 },
  { x: 17.1, z: 55.7, len: 8, alongZ: true, color: 0x7a838d, stack: 1, shape: 'rack', width: 1.6 },
  { x: 29.8, z: 66.1, len: 12.2, alongZ: false, color: 0x7a838d, stack: 1, shape: 'rack', width: 1.6 },
  { x: 92.1, z: 52.6, len: 8, alongZ: true, color: 0x7a838d, stack: 1, shape: 'rack', width: 1.6 },
  { x: 103.5, z: 64.7, len: 8, alongZ: false, color: 0x7a838d, stack: 1, shape: 'rack', width: 1.6 },
  { x: 118.9, z: 24.6, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 74.3, z: 54.9, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 42.4, z: 49.0, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 111.7, z: 39.5, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 28.3, z: 60.9, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 72.3, z: 62.5, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 47.6, z: 74.1, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 43.9, z: 26.7, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 33.8, z: 48.3, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 135.9, z: 68.5, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 105.1, z: 55.9, len: 6.1, alongZ: true, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 3.6, z: 44.7, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 94.2, z: 78.1, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
  { x: 5.7, z: 14.5, len: 6.1, alongZ: false, color: 0x8a6a3a, stack: 1, shape: 'cage' },
];
export const FARM_PATROLS = [{ x: 1, y: 9 }, { x: 16, y: 9 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 11, y: 1 }];
export const FARM_DOGS = [{ x: 4, y: 7 }, { x: 10, y: 4 }, { x: 13, y: 9 }];
export const FARM_CRATES = [{ x: 1, y: 3 }, { x: 5, y: 9 }, { x: 9, y: 2 }, { x: 9, y: 6 }, { x: 12, y: 6 }, { x: 14, y: 7 }, { x: 1, y: 5 }, { x: 1, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 1 }];
/** The clue consoles of each yard, in the order they are hacked (yardsite.ts has the dock's; these are the same cells). */
export const FARM_CLUES = [
  { x: 3, y: 4, facing: 0, name: 'west bank, by the gate' },
  { x: 10, y: 8, facing: 0, name: 'the rack row, past the trench' },
  { x: 13, y: 4, facing: 0, name: 'the pump house' },
] as const;

export type YardId = 'dock' | 'farm';
export type YardPlanData = {
  id: YardId;
  containers: ContainerSpec[];
  guards: ReadonlyArray<{ x: number; y: number; facing: number }>;
  patrols: ReadonlyArray<{ x: number; y: number }>;
  dogs: ReadonlyArray<{ x: number; y: number }>;
  crates: ReadonlyArray<{ x: number; y: number }>;
  clues: ReadonlyArray<{ x: number; y: number; facing: number; name: string }>;
};
export const YARD_PLANS: Readonly<Record<YardId, YardPlanData>> = {
  dock: { id: 'dock', containers: DOCK_CONTAINERS, guards: DOCK_GUARDS, patrols: DOCK_PATROLS, dogs: DOCK_DOGS, crates: DOCK_CRATES, clues: [{ x: 3, y: 4, facing: 0, name: 'west bank, by the gate' }, { x: 10, y: 8, facing: 0, name: 'east bank, past the bridge' }, { x: 13, y: 4, facing: 0, name: 'yard by the port office' }] },
  farm: { id: 'farm', containers: FARM_CONTAINERS, guards: DOCK_GUARDS, patrols: FARM_PATROLS, dogs: FARM_DOGS, crates: FARM_CRATES, clues: FARM_CLUES },
};
