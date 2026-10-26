// Where the writing goes in the bunker (signage.ts has the words): the sector letter high on a room's wall, procedure plates low on it, the room's code and the hall's lane markings on the floor,
// and each container's ID on its sides. Pure: it works from the plan and the cells of the drawn map, so it is unit-tested under Node; signrender.ts draws what it lists.

import type { MazeCells } from './maze';
import type * as Signage from './signage';
import type * as Plan from './bunkerplan';

type Space = Plan.Space;

/** What the placing draws on, handed in (the plan's data and the words), so this file imports nothing at run time and runs under Node: `plan` is bunkerplan.ts's exports, `text` is signage.ts's. */
export type Deps = { plan: Pick<typeof Plan, 'BUNKER_CAMERAS' | 'BUNKER_SPACES' | 'atDoorway' | 'furnishedCells' | 'spacesOn' | 'stairCells' | 'stairEnds' | 'stairsOn'>; text: typeof Signage };

export type SignStyle = 'stencil' | 'plate' | 'big' | 'faint';

/** One piece of writing, as a rectangle `w` by `h` metres centred on (x, y, z). Up on a wall or a container's side it faces out along the angle `angle` (0 is +z, a quarter turn +x); flat on the floor its text reads along `angle` (0 along +x, with the top of the page toward -z; the floor's all read along -x, top toward +z: the right way up for someone walking south down the bunker). */
export type Sign = { lines: string[]; style: SignStyle; x: number; y: number; z: number; w: number; h: number; angle: number; flat: boolean; /** The container it is on, so it goes when the container does. */ key?: string };

/** A cell is CELL metres across (scene.ts's CELL), a wall WALL_T thick: the same numbers, kept here so this file imports nothing from the scene. */
const C = 4;
const FACE = 0.14 + 0.02;
const SIDES = [
  { side: 'N', dx: 0, dy: -1, angle: 0 },
  { side: 'S', dx: 0, dy: 1, angle: Math.PI },
  { side: 'W', dx: -1, dy: 0, angle: Math.PI / 2 },
  { side: 'E', dx: 1, dy: 0, angle: -Math.PI / 2 },
] as const;

type Edge = { x: number; y: number; angle: number; px: number; pz: number };

/** The wall faces of a space that look into it, as the centre of each: not at a doorway, a stair, a duct or a camera. */
function wallEdges(sp: Space, cells: MazeCells, avoid: ReadonlySet<string>, atDoorway: (x: number, y: number) => boolean): Edge[] {
  const out: Edge[] = [];
  for (let y = sp.y0; y <= sp.y1; y++) {
    for (let x = sp.x0; x <= sp.x1; x++) {
      if (avoid.has(`${x},${y}`) || atDoorway(x, y)) continue;
      const cell = cells[y]?.[x];
      if (!cell) continue;
      for (const s of SIDES) {
        const nx = x + s.dx;
        const ny = y + s.dy;
        const inside = nx >= sp.x0 && nx <= sp.x1 && ny >= sp.y0 && ny <= sp.y1;
        if (inside || cell[s.side]) continue; // (open to the next cell, or not a boundary)
        const lineX = x * C + (s.dx * C) / 2;
        const lineZ = y * C + (s.dy * C) / 2;
        out.push({ x, y, angle: s.angle, px: s.dx === 0 ? x * C : lineX - s.dx * FACE, pz: s.dy === 0 ? y * C : lineZ - s.dy * FACE });
      }
    }
  }
  return out;
}

/** The writing on a storey's walls and floors (the containers' own are containerSigns's). */
export function roomSigns(deps: Deps, level: number, cells: MazeCells): Sign[] {
  const { plan, text } = deps;
  const { LEVEL_CODES, LEVEL_TITLES, HALL_FLOOR, LORE_FLOOR, LORE_PLATE, PLATES, ROOM_NAMES, pick } = text;
  const { BUNKER_CAMERAS, BUNKER_SPACES, furnishedCells, spacesOn, stairCells, stairEnds, stairsOn, atDoorway } = plan;
  const signs: Sign[] = [];
  const furnished = furnishedCells(level);
  const avoid = new Set<string>();
  for (const st of stairsOn(level)) for (const c of [...stairCells(st), ...stairEnds(st).foot, ...stairEnds(st).head]) avoid.add(`${c.x},${c.y}`);
  for (const cam of BUNKER_CAMERAS) if (cam.level === level) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) avoid.add(`${Math.round(cam.x / C) + dx},${Math.round(cam.z / C) + dy}`);
  const code = LEVEL_CODES[level] ?? 'B';
  const title = LEVEL_TITLES[level] ?? '';
  for (const sp of spacesOn(level)) {
    const seed = level * 1009 + sp.id.charCodeAt(sp.id.length - 1) * 31 + sp.x0 * 7 + sp.y0;
    const edges = wallEdges(sp, cells, avoid, atDoorway);
    const open = edges.filter((e) => !furnished.has(`${e.x},${e.y}`));
    const centre = { x: ((sp.x0 + sp.x1) / 2) * C, z: ((sp.y0 + sp.y1) / 2) * C };
    if (!sp.hall) {
      // High on a wall, above the containers: the sector letter.
      if (edges.length > 0) {
        const e = pick(edges, seed + 1);
        const letter = 'ABCDEFGHJK'[BUNKER_SPACES.filter((q) => !q.hall).indexOf(sp)] ?? 'A';
        signs.push({ lines: ['SECTOR', letter], style: 'big', x: e.px, y: 3.9, z: e.pz, w: 1.7, h: 2.0, angle: e.angle, flat: false });
      }
      // Low on the aisle walls: the room's name and a procedure plate.
      if (open.length > 0) {
        const a = pick(open, seed + 2);
        signs.push({ lines: [ROOM_NAMES[sp.id] ?? sp.name.toUpperCase(), `${code} · ${title}`], style: 'plate', x: a.px, y: 1.95, z: a.pz, w: 1.5, h: 0.55, angle: a.angle, flat: false });
        const rest = open.filter((e) => Math.hypot(e.px - a.px, e.pz - a.pz) > 3);
        if (rest.length > 0) {
          const b = pick(rest, seed + 3);
          signs.push({ lines: [...pick(PLATES, seed + 4)], style: 'plate', x: b.px, y: 1.95, z: b.pz, w: 1.5, h: 0.55, angle: b.angle, flat: false });
        }
      }
      // On the floor, in an aisle near the middle: its code.
      const aisle = freeCellNear(sp, furnished, centre);
      if (aisle) signs.push({ lines: [`${code} / ${ROOM_NAMES[sp.id] ?? sp.name.toUpperCase()}`], style: 'stencil', x: aisle.x * C, y: 0.03, z: aisle.y * C, w: 3.2, h: 0.42, angle: Math.PI, flat: true });
    } else {
      // A hall: lane markings along it, and a plate.
      const alongX = sp.x1 - sp.x0 >= sp.y1 - sp.y0;
      const len = alongX ? sp.x1 - sp.x0 + 1 : sp.y1 - sp.y0 + 1;
      const midAcross = alongX ? ((sp.y0 + sp.y1) / 2) * C : ((sp.x0 + sp.x1) / 2) * C;
      for (let k = 0; k < Math.min(2, Math.floor(len / 2)); k++) {
        const along = (alongX ? sp.x0 : sp.y0) + (len * (k + 0.5)) / Math.min(2, Math.floor(len / 2));
        const x = alongX ? along * C - C / 2 : midAcross;
        const z = alongX ? midAcross : along * C - C / 2;
        if (furnished.has(`${Math.round(x / C)},${Math.round(z / C)}`)) continue;
        signs.push({ lines: [pick(HALL_FLOOR, seed + 10 + k)], style: 'stencil', x, y: 0.03, z, w: 2.6, h: 0.4, angle: Math.PI, flat: true });
      }
      if (open.length > 0) {
        const e = pick(open, seed + 20);
        signs.push({ lines: [...pick(PLATES, seed + 21)], style: 'plate', x: e.px, y: 1.95, z: e.pz, w: 1.5, h: 0.55, angle: e.angle, flat: false });
      }
    }
  }
  // The faint ones, once or twice a level.
  const halls = spacesOn(level).filter((s) => s.hall);
  const rooms = spacesOn(level).filter((s) => !s.hall);
  if (level === 0 && rooms[0]) addPlate(deps, signs, rooms[0], cells, avoid, furnished, ['DAYS SINCE LAST INCIDENT', '000'], 'faint', 31);
  if (level === 1 && halls[0]) {
    const sp = halls[0];
    const alongX = sp.x1 - sp.x0 >= sp.y1 - sp.y0;
    signs.push({ lines: [LORE_FLOOR[0]!], style: 'faint', x: alongX ? ((sp.x0 + sp.x1) / 2) * C : ((sp.x0 + sp.x1) / 2) * C, y: 0.03, z: alongX ? ((sp.y0 + sp.y1) / 2) * C + 1 : ((sp.y0 + sp.y1) / 2) * C, w: 3.4, h: 0.26, angle: Math.PI, flat: true });
  }
  if (level === 2 && rooms[0]) addPlate(deps, signs, rooms[0], cells, avoid, furnished, [...LORE_PLATE[1]!], 'faint', 32);
  if (level === 3 && rooms[0]) addPlate(deps, signs, rooms[rooms.length - 1]!, cells, avoid, furnished, [...LORE_PLATE[2]!], 'faint', 33);
  return signs;
}

function addPlate(deps: Deps, signs: Sign[], sp: Space, cells: MazeCells, avoid: ReadonlySet<string>, furnished: ReadonlySet<string>, lines: string[], style: SignStyle, seed: number): void {
  const open = wallEdges(sp, cells, avoid, deps.plan.atDoorway).filter((e) => !furnished.has(`${e.x},${e.y}`));
  if (open.length === 0) return;
  const e = deps.text.pick(open, seed);
  signs.push({ lines, style, x: e.px, y: 1.35, z: e.pz, w: 1.3, h: 0.45, angle: e.angle, flat: false });
}

function freeCellNear(sp: Space, furnished: ReadonlySet<string>, at: { x: number; z: number }): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = sp.y0; y <= sp.y1; y++) {
    for (let x = sp.x0; x <= sp.x1; x++) {
      if (furnished.has(`${x},${y}`)) continue;
      const d = Math.hypot(x * C - at.x, y * C - at.z);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

export type ContainerBox = { cx: number; cz: number; yaw: number; len: number; depth: number; height: number; /** Its box's minX and minZ, to find it again. */ key: string };

/** A container's ID on both long sides, and its cargo and handling marks on one. `index` numbers them down a storey. */
export function containerSigns(deps: Deps, level: number, boxes: readonly ContainerBox[]): Sign[] {
  const { CARGO, HANDLING, SIZE_CODE, containerId, pick } = deps.text;
  const signs: Sign[] = [];
  boxes.forEach((b, i) => {
    const alongX = b.yaw === 0;
    const id = containerId(level, i);
    const faces = alongX
      ? [
          { angle: 0, px: b.cx - 1.4, pz: b.cz + b.depth / 2 + 0.02, sign: 1 },
          { angle: Math.PI, px: b.cx + 1.4, pz: b.cz - b.depth / 2 - 0.02, sign: -1 },
        ]
      : [
          { angle: Math.PI / 2, px: b.cx + b.depth / 2 + 0.02, pz: b.cz + 1.4, sign: 1 },
          { angle: -Math.PI / 2, px: b.cx - b.depth / 2 - 0.02, pz: b.cz - 1.4, sign: -1 },
        ];
    for (const f of faces) {
      signs.push({ lines: [id, SIZE_CODE], style: 'stencil', x: f.px, y: b.height * 0.62, z: f.pz, w: 2.1, h: 0.62, angle: f.angle, flat: false, key: b.key });
    }
    // The cargo and handling, small, on the first face, lower down and further along.
    const f = faces[0]!;
    signs.push({ lines: [pick(CARGO, level * 131 + i * 17), pick(HANDLING, level * 53 + i * 29 + 5)], style: 'plate', x: f.px + (alongX ? 4.0 : 0), y: b.height * 0.3, z: f.pz + (alongX ? 0 : -4.0), w: 1.3, h: 0.45, angle: f.angle, flat: false, key: b.key });
  });
  return signs;
}
