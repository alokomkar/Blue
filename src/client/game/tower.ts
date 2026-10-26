// The tower's scene (towerplan.ts says what is where): the timber lobby, balcony and gallery, the office floor, the stairs between them with their side rails, the
// balustrades along every drop, and the lift cabs. Each storey is an ordinary FloorRig drawn from a plain hall (scene.ts's buildFloor); this takes the floor out where the
// plan has none, and stands the rest of the building on it.

import * as THREE from 'three';
import type { FloorRig, FloorTheme, WallBox } from './scene';
import { CELL, WALL_H, WALL_T } from './scene';
import type { FadeProp } from './propfade';
import { buildStairMesh } from './stairs';
import { markBloom } from './postfx';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { furnitureFor, setLayoutPlan, type Placed, type TowerSetId } from './towerfurniture';
import { LOCATIONS, type Location } from './locations';
import { coneRadii, type CameraPlan } from './cameras';
import { buildElevator, LIFT_STYLE, type ElevatorRig, type LiftStyle } from './elevator';
import {
  TOWER_COLS,
  TOWER_ROWS,
  TOWER_STAIRS,
  TOWER_LAYOUT,
  TOWER_LIFTS,
  TOWER_BRIDGES,
  TOWER_CAMERAS,
  HEIST_DOOR,
  HEIST_LIFT,
  TOWER_CARDS,
  TOWER_BRIDGE_BONUS,
  TOWER_OFFICE_DOORS,
  OFFICES,
  hasFloor,
  walkable,
  railsFor,
  stairHigh,
  stairLow,
  climbWalls,
  TOWER_PYLONS,
} from './towerplan';
import { LEDGE_OUT as SHELF_OUT } from './highwall';

const RAIL_H = 1.05;
/** A high camera's panel, on a pylon's wall near its top (the top shelf's hands are 6.07 m up: hanging from it the panel is at the chest). */
export const HIGH_PANEL_Y = 5.2;

setLayoutPlan(TOWER_LAYOUT);

/** The place each tower is built in: its two floors' looks (ground, upper), taken from the maze level it belongs to, over the tower's four storeys (the lobby and the balcony in the ground look, the gallery and the top floor in the upper). */
export function towerThemes(set: TowerSetId, names: readonly string[], look: Location = LOCATIONS[set]): FloorTheme[] {
  const loc = look;
  return [loc.floors[0], loc.floors[0], loc.floors[1], loc.floors[1]].map((t, i) => ({ ...t, name: names[i] ?? t.name }));
}

/** The lift's look: the freight lift's, reading as a passenger lift; and the service lift's, steel and dark. */
const PASSENGER: LiftStyle = { ...LIFT_STYLE, ready: '▲▼ LIFT' };
const SERVICE: LiftStyle = { ...LIFT_STYLE, ready: '▲▼ SERVICE', door: 0x6d7680, shaft: 0x20252a };

const mat = (color: number, rough = 0.7): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough });

/** Takes the floor tile out of every cell the plan has no floor in. */
function cutFloor(floor: FloorRig, level: number): void {
  const gone = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let y = 0; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) if (!hasFloor(level, x, y)) floor.floorTiles.setMatrixAt(y * TOWER_COLS + x, gone);
  floor.floorTiles.instanceMatrix.needsUpdate = true;
}

/** Posts for a balustrade, collected so one instanced mesh draws all of a storey's. */
type Post = { x: number; y: number; z: number; h: number };

function postsMesh(posts: Post[], material: THREE.Material): THREE.InstancedMesh | null {
  if (!posts.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1, 0.07), material, posts.length);
  const m = new THREE.Matrix4();
  posts.forEach((p, i) => {
    m.makeScale(1, p.h, 1);
    m.setPosition(p.x, p.y + p.h / 2, p.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.structure = true;
  return mesh;
}

/** A balustrade along a straight run (axis-aligned, world metres): an oak handrail on balusters, and a see-through body-stopping box under it. */
function railSpan(floor: FloorRig, posts: Post[], rail: THREE.Material, x0: number, z0: number, x1: number, z1: number): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.12, 0.08, alongX ? 0.12 : len), rail);
  hand.position.set(cx, RAIL_H, cz);
  floor.group.add(hand);
  const n = Math.max(1, Math.round(len / 0.4));
  for (let k = 0; k < n; k++) {
    const o = -len / 2 + (len * (k + 0.5)) / n;
    posts.push({ x: alongX ? cx + o : cx, y: 0, z: alongX ? cz : cz + o, h: RAIL_H });
  }
  const t = 0.15;
  floor.wallBoxes.push({ minX: cx - (alongX ? len / 2 : t), maxX: cx + (alongX ? len / 2 : t), minZ: cz - (alongX ? t : len / 2), maxZ: cz + (alongX ? t : len / 2), see: true });
}

/** A balustrade along the edge of a cell. */
function railEdge(floor: FloorRig, posts: Post[], rail: THREE.Material, x: number, y: number, dir: 'N' | 'S' | 'E' | 'W'): void {
  const dx = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
  const dz = dir === 'S' ? 1 : dir === 'N' ? -1 : 0;
  const cx = x * CELL + (dx * CELL) / 2;
  const cz = y * CELL + (dz * CELL) / 2;
  if (dz !== 0) railSpan(floor, posts, rail, cx - CELL / 2, cz, cx + CELL / 2, cz);
  else railSpan(floor, posts, rail, cx, cz - CELL / 2, cx, cz + CELL / 2);
}

/**
 * The thin bridge (towerplan.ts's TOWER_BRIDGES): a steel deck over the atrium, low arches along it, a lip down each side. It is a crawl space (an `under` box with no cover): an agent lying
 * flat gets onto it and along it, nobody else can, and it hides no one.
 */
function buildBridge(floor: FloorRig, b: (typeof TOWER_BRIDGES)[number]): void {
  const x0 = b.fromX * CELL + CELL / 2;
  const x1 = b.toX * CELL - CELL / 2;
  const zc = b.y * CELL;
  const steel = mat(0x30363d, 0.45);
  const trim = new THREE.MeshStandardMaterial({ color: 0xf0b24a, emissive: 0xf0b24a, emissiveIntensity: 0.9, roughness: 0.4 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.1, 0.18, b.width), steel);
  deck.position.set((x0 + x1) / 2, -0.09, zc);
  floor.group.add(deck);
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.06), trim);
    strip.position.set((x0 + x1) / 2, 0.02, zc + (side * (b.width - 0.1)) / 2);
    markBloom(strip);
    floor.group.add(strip);
    // A lip along each side, and a see-through box to keep the agent on the deck.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.18, 0.05), steel);
    lip.position.set((x0 + x1) / 2, 0.09, zc + (side * (b.width + 0.05)) / 2);
    floor.group.add(lip);
    const edge = zc + side * (b.width / 2 + 0.1);
    floor.wallBoxes.push({ minX: x0, maxX: x1, minZ: edge - 0.1, maxZ: edge + 0.1, see: true });
  }
  // Low arches along it, so it reads as a crawlway.
  const arches = Math.floor((x1 - x0) / 1.5);
  for (let k = 0; k < arches; k++) {
    const ax = x0 + ((k + 0.5) * (x1 - x0)) / arches;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), steel);
      leg.position.set(ax, 0.31, zc + (side * (b.width - 0.06)) / 2);
      floor.group.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, b.width), steel);
    bar.position.set(ax, 0.64, zc);
    floor.group.add(bar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, b.width * 0.5), trim);
    top.position.set(ax, 0.675, zc);
    markBloom(top);
    floor.group.add(top);
  }
  // Too low to walk: standing or crouching, the agent is stopped at the end; lying flat, they pass.
  floor.wallBoxes.push({ minX: x0, maxX: x1, minZ: zc - b.width / 2, maxZ: zc + b.width / 2, see: true, under: true });
}

/** The side of a flight: a sloped handrail with balusters under it, and a box along it that keeps the agent on the flight. */
function stairSide(floor: FloorRig, posts: Post[], rail: THREE.Material, s: (typeof TOWER_STAIRS)[number], xs: number, floorHeight: number): void {
  const z0 = s.y * CELL - CELL / 2;
  const len = s.run * CELL;
  const low = stairLow(s) * floorHeight;
  const rises = s.toLevel > s.fromLevel; // higher at the south end
  const slope = Math.atan2(floorHeight, len);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, Math.hypot(len, floorHeight)), rail);
  hand.position.set(xs, low + floorHeight / 2 + RAIL_H - floor.group.position.y, z0 + len / 2);
  hand.rotation.x = rises ? -slope : slope;
  floor.group.add(hand);
  const n = Math.round(len / 0.5);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const y = low + (rises ? t : 1 - t) * floorHeight - floor.group.position.y;
    posts.push({ x: xs, y, z: z0 + t * len, h: RAIL_H });
  }
  const t = 0.15;
  floor.wallBoxes.push({ minX: xs - t, maxX: xs + t, minZ: z0, maxZ: z0 + len, see: true });
}

/**
 * A climb's wall (towerplan.ts's climbWalls): a wall the height of the storey across the upper end of the stair's footprint, with the shelf along its face at an ordinary wall's top
 * for the dash up it to catch, and, above that, the opening's rail ledge on the storey over it (the wall is set so the hands on one are over the other). Climb it (highwall.ts) to the
 * shelf, push forward to go on up to the ledge, and pull over it onto the storey above.
 */
function buildClimbWall(floor: FloorRig, c: ReturnType<typeof climbWalls>[number], floorHeight: number, fadables: FadeProp[]): void {
  const len = c.x1 - c.x0;
  const midX = (c.x0 + c.x1) / 2;
  const z = c.edge + c.nz * 0.08;
  const wallMat = new THREE.MeshStandardMaterial({ color: floor.theme.wall, roughness: 0.92 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: floor.theme.cap, roughness: 0.5, metalness: 0.3 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, floorHeight, WALL_T), wallMat);
  wall.position.set(midX, floorHeight / 2, z);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, WALL_T + SHELF_OUT * 2), shelfMat);
  slab.position.set(midX, WALL_H - 0.07, z);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.07, WALL_T + SHELF_OUT * 2), shelfMat);
  cap.position.set(midX, WALL_H + 0.035, z);
  for (const o of [wall, slab, cap]) o.userData.structure = true;
  floor.group.add(wall, slab, cap);
  const box: WallBox = { minX: c.x0, maxX: c.x1, minZ: z - WALL_T / 2, maxZ: z + WALL_T / 2 };
  floor.wallBoxes.push(box);
  floor.climbBoxes.push({ ...box, high: true, top: floorHeight + 0.02, toLevel: c.toLevel });
  fadables.push({ objects: [wall, slab, cap], box: { minX: c.x0, maxX: c.x1, minY: 0, maxY: floorHeight, minZ: z - WALL_T / 2 - 0.1, maxZ: z + WALL_T / 2 + 0.1 } });
}

/**
 * A pylon (towerplan.ts's TOWER_PYLONS): a free-standing wall across a lobby cell, six metres high with a shelf at three and another at the top, on both faces: climb it as the training's
 * double wall (highwall.ts) to hang from the top shelf beside the camera panel on its south face.
 */
function buildPylon(floor: FloorRig, px: number, py: number, fadables: FadeProp[]): void {
  const len = CELL;
  const x = px * CELL;
  const z = py * CELL;
  const H = 6;
  const wallMat = new THREE.MeshStandardMaterial({ color: floor.theme.wall, roughness: 0.92 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: floor.theme.cap, roughness: 0.5, metalness: 0.3 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, H, WALL_T), wallMat);
  wall.position.set(x, H / 2, z);
  const parts: THREE.Mesh[] = [wall];
  for (const top of [WALL_H, H]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, WALL_T + SHELF_OUT * 2), shelfMat);
    slab.position.set(x, top - 0.07, z);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.07, WALL_T + SHELF_OUT * 2), shelfMat);
    cap.position.set(x, top + 0.035, z);
    parts.push(slab, cap);
  }
  for (const o of parts) o.userData.structure = true;
  floor.group.add(...parts);
  const box: WallBox = { minX: x - len / 2, maxX: x + len / 2, minZ: z - WALL_T / 2, maxZ: z + WALL_T / 2 };
  floor.wallBoxes.push(box);
  floor.climbBoxes.push({ ...box, high: true });
  fadables.push({ objects: parts, box: { minX: box.minX, maxX: box.maxX, minY: 0, maxY: H, minZ: box.minZ - 0.1, maxZ: box.maxZ + 0.1 } });
}

/** What a tower's furniture is made of, and its rails and fins: a set's palette. */
export type Fabric = { sofa: number; wood: number; dark: number; metal: number; leaf: number; rail: number; railDark: number; accent: number; glass: number; /** What fills a specimen tank (the lab's is green; the final level's is blue). */ liquid?: number; /** What the bunker's cargo blocks are drawn as (a shipping container when absent): shelving banks (the Records Annex), wooden crate stacks (the Founders' Store), parked vans (the Armoured Depot), banks of glass tubes (the Tube Hall). */ cargoSkin?: 'archive' | 'crates' | 'van' | 'tubes' };
export const FABRICS: Record<TowerSetId, Fabric> = {
  campus: { sofa: 0x44566a, wood: 0x8a8f96, dark: 0x2a2f36, metal: 0x9aa4ae, leaf: 0x4a8a52, rail: 0x7a828a, railDark: 0x3a4148, accent: 0x6fd6f0, glass: 0x6fb4c8 },
  museum: { sofa: 0x6d3b3b, wood: 0x9b8a6c, dark: 0x3a2f22, metal: 0xc9a85a, leaf: 0x4a7a52, rail: 0xc9a56a, railDark: 0x6a4524, accent: 0xe6c46c, glass: 0x8cc4d4 },
  refinery: { sofa: 0x8a5a2a, wood: 0x5b6772, dark: 0x20262c, metal: 0xb9743a, leaf: 0x4a7a52, rail: 0x7a8590, railDark: 0x2a3138, accent: 0xff9a3c, glass: 0x7fb4c8 },
  bank: { sofa: 0x2f5a44, wood: 0x8b6b44, dark: 0x2a1e14, metal: 0xbda35a, leaf: 0x4a7a52, rail: 0xbda35a, railDark: 0x4a3a22, accent: 0x9be0b0, glass: 0x8fd0c2 },
  warehouse: { sofa: 0x3f6a8a, wood: 0x9a7a3c, dark: 0x2a2218, metal: 0xd9b13d, leaf: 0x4a7a52, rail: 0xd9b13d, railDark: 0x3a3d40, accent: 0xffd45a, glass: 0x7fb4c8 },
  lab: { sofa: 0x4a7a8a, wood: 0xaab6bf, dark: 0x2c3640, metal: 0xcfd8de, leaf: 0x4a8a62, rail: 0xcfd8de, railDark: 0x5a6a76, accent: 0x9aeff5, glass: 0x8fe0e8 },
};

/** The Records Annex's: the campus's, with the cargo blocks drawn as banks of sliding shelving. */
export const ANNEX_FABRIC: Fabric = { ...FABRICS.campus, cargoSkin: 'archive' };
/** The Founders' Store's: the museum's, with the cargo blocks drawn as stacks of wooden crates. */
export const STORE_FABRIC: Fabric = { ...FABRICS.museum, cargoSkin: 'crates' };
/** The Armoured Depot's: the bank's, with the cargo blocks drawn as parked armoured vans. */
export const DEPOT_FABRIC: Fabric = { ...FABRICS.bank, cargoSkin: 'van' };

/** The final level's fabric: the lab's, with its tanks filled with blue light. */
export const CORE_FABRIC: Fabric = { ...FABRICS.lab, liquid: 0x5fd4ff, accent: 0x5fd4ff, glass: 0xbfe6ff };

/** A model of one piece, front toward +z, standing on the floor at the origin. Low-poly boxes: it reads from the top-down camera, and a crawl space shows under the sofas and desks. */
function pieceModel(p: Placed, f: Fabric): THREE.Group {
  const g = new THREE.Group();
  const m = (color: number, rough = 0.7, metal = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z);
    g.add(b);
  };
  const cyl = (r: number, h: number, mat: THREE.Material, x: number, y: number, z: number): void => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat);
    c.position.set(x, y, z);
    g.add(c);
  };
  const cylX = (r: number, l: number, mat: THREE.Material, x: number, y: number, z: number): void => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), mat);
    c.rotation.z = Math.PI / 2;
    c.position.set(x, y, z);
    g.add(c);
  };
  const sph = (r: number, mat: THREE.Material, x: number, y: number, z: number): void => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    c.position.set(x, y, z);
    g.add(c);
  };
  const glassMat = (fab: Fabric): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: fab.glass, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1 });
  const { len, depth, height } = p.spec;
  switch (p.kind) {
    case 'sofa': {
      const fabric = m(f.sofa, 0.85);
      box(len, 0.24, depth - 0.12, fabric, 0, 0.42, 0.06); // the seat, raised on its feet so there is room under it
      box(len, 0.5, 0.22, fabric, 0, 0.7, -depth / 2 + 0.11); // the back
      for (const s of [-1, 1]) box(0.2, 0.42, depth - 0.1, fabric, s * (len / 2 - 0.1), 0.58, 0.05); // the arms
      for (const x of [-1, 1]) for (const z of [-1, 1]) box(0.08, 0.28, 0.08, m(f.dark), x * (len / 2 - 0.12), 0.14, z * (depth / 2 - 0.12));
      break;
    }
    case 'desk': {
      box(len, 0.06, depth, m(f.wood, 0.5), 0, height, 0);
      for (const s of [-1, 1]) box(0.05, height - 0.04, depth - 0.1, m(f.dark), s * (len / 2 - 0.06), (height - 0.04) / 2, 0);
      box(len - 0.2, 0.4, 0.03, m(f.dark), 0, height - 0.22, -depth / 2 + 0.1); // the modesty panel at the back
      box(0.42, 0.3, 0.04, m(0x15181c, 0.3), 0.3, height + 0.2, -0.15); // a screen
      box(0.14, 0.12, 0.05, m(0x15181c, 0.3), 0.3, height + 0.07, -0.15);
      break;
    }
    case 'conference': {
      box(len, 0.07, depth, m(f.wood, 0.45), 0, height, 0);
      for (const s of [-1, 1]) box(0.5, height - 0.04, depth - 0.3, m(f.dark), s * (len / 2 - 0.5), (height - 0.04) / 2, 0);
      break;
    }
    case 'table': {
      box(len, 0.05, depth, m(f.wood, 0.4), 0, height, 0);
      for (const x of [-1, 1]) for (const z of [-1, 1]) box(0.05, height, 0.05, m(f.dark), x * (len / 2 - 0.06), height / 2, z * (depth / 2 - 0.06));
      break;
    }
    case 'bench': {
      box(len, 0.06, depth, m(f.wood, 0.5), 0, height, 0);
      for (const s of [-1, 1]) box(0.06, height, depth - 0.08, m(f.dark), s * (len / 2 - 0.12), height / 2, 0);
      break;
    }
    case 'cabinet': {
      box(len, height, depth, m(f.wood, 0.55), 0, height / 2, 0);
      box(len + 0.02, 0.04, depth + 0.02, m(f.dark), 0, height + 0.02, 0);
      for (const s of [-1, 1]) box(0.03, height - 0.3, 0.02, m(f.metal, 0.3, 0.7), s * 0.14, height / 2, depth / 2 + 0.01); // the handles
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 12), m(0x5b3a22, 0.8));
      pot.position.y = 0.2;
      g.add(pot);
      for (const [x, y, z, r] of [[0, 0.85, 0, 0.36], [0.12, 1.1, -0.06, 0.26], [-0.12, 0.7, 0.1, 0.24]] as const) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m(f.leaf, 0.9));
        leaf.position.set(x, y, z);
        g.add(leaf);
      }
      break;
    }
    case 'lamp': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, height - 0.35, 8), m(f.metal, 0.3, 0.6));
      pole.position.y = (height - 0.35) / 2;
      g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 12), m(f.dark, 0.4));
      base.position.y = 0.02;
      g.add(base);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffd59a, emissiveIntensity: 1.5, side: THREE.DoubleSide }));
      shade.position.y = height - 0.2;
      markBloom(shade);
      g.add(shade);
      break;
    }
    case 'console': {
      box(len, 0.06, depth, m(f.dark, 0.5), 0, height, 0);
      for (const s of [-1, 1]) box(0.05, height - 0.04, depth - 0.1, m(f.dark), s * (len / 2 - 0.06), (height - 0.04) / 2, 0);
      for (const [x, c] of [[-0.55, 0x4ee0d0], [0, 0x6fd6f0], [0.55, 0x4ee0a0]] as const) {
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: c, emissiveIntensity: 1.3 }));
        screen.position.set(x, height + 0.28, -0.1);
        screen.rotation.x = -0.15;
        screen.userData.consoleScreen = true; // (turned green once there is nothing left to loop)
        markBloom(screen);
        g.add(screen);
      }
      box(0.9, 0.03, 0.22, m(0x15181c, 0.3), 0, height + 0.05, 0.14);
      break;
    }
    case 'deskrow': {
      box(len, 0.05, depth, m(f.wood, 0.5), 0, height, 0);
      for (const x of [-1, 0, 1]) box(0.05, height - 0.04, depth - 0.1, m(f.dark), x * (len / 2 - 0.05), (height - 0.04) / 2, 0);
      box(len - 0.1, 0.35, 0.03, m(f.dark), 0, height - 0.2, -depth / 2 + 0.06); // the modesty panel
      for (const x of [-0.9, 0, 0.9]) {
        box(0.5, 0.32, 0.04, m(0x15181c, 0.3), x, height + 0.21, -0.2); // a screen
        box(0.16, 0.14, 0.05, m(0x15181c, 0.3), x, height + 0.08, -0.2);
        box(0.38, 0.015, 0.14, m(0x2a2f36, 0.5), x, height + 0.03, 0.1); // a keyboard
      }
      break;
    }
    case 'spine': {
      box(len, height, depth, m(f.wood, 0.55), 0, height / 2, 0);
      box(len + 0.02, 0.04, depth + 0.02, m(f.dark), 0, height + 0.02, 0);
      for (const x of [-0.9, 0, 0.9]) for (const s of [-1, 1]) box(0.03, height - 0.5, 0.02, m(f.metal, 0.3, 0.7), x, height / 2, s * (depth / 2 + 0.01)); // the handles, both sides
      break;
    }
    case 'round': {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(len / 2, len / 2, 0.05, 20), m(f.wood, 0.4));
      top.position.y = height;
      g.add(top);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height, 8), m(f.dark, 0.4));
      stem.position.y = height / 2;
      g.add(stem);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14), m(f.dark, 0.4));
      foot.position.y = 0.015;
      g.add(foot);
      box(0.3, 0.015, 0.22, m(0xe8ecef, 0.6), 0.1, height + 0.035, 0.05); // a laptop
      break;
    }
    case 'case': {
      box(len, 0.4, depth, m(f.dark, 0.6), 0, 0.2, 0);
      box(len - 0.06, height - 0.4, depth - 0.06, glassMat(f), 0, 0.4 + (height - 0.4) / 2, 0);
      box(0.18, 0.18, 0.18, m(f.metal, 0.3, 0.7), 0, 0.5, 0);
      break;
    }
    case 'plinth':
    case 'colossus': {
      const big = p.kind === 'colossus';
      box(len, height * (big ? 0.35 : 0.55), depth, m(0xcfc8b4, 0.8), 0, (height * (big ? 0.35 : 0.55)) / 2, 0);
      box(len * 0.82, 0.08, depth * 0.82, m(0xaaa28c, 0.8), 0, height * (big ? 0.35 : 0.55) + 0.04, 0);
      const bronze = m(0x8a6a36, 0.4, 0.5);
      const base = height * (big ? 0.35 : 0.55) + 0.08;
      cyl(len * (big ? 0.2 : 0.2), height * 0.28, bronze, 0, base + height * 0.14, 0);
      cyl(len * (big ? 0.12 : 0.13), height * 0.18, bronze, 0, base + height * 0.37, 0);
      sph(len * 0.11, bronze, 0, base + height * 0.52, 0);
      break;
    }
    case 'panel': {
      box(len, height, depth, m(f.sofa, 0.9), 0, height / 2, 0);
      box(len + 0.04, 0.06, depth + 0.04, m(f.metal, 0.3, 0.7), 0, height, 0);
      box(len * 0.6, height * 0.5, depth + 0.02, m(f.metal, 0.5, 0.4), 0, height * 0.55, 0);
      break;
    }
    case 'crate': {
      box(len, height, depth, m(0xa07a46, 0.85), 0, height / 2, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, height + 0.02, 0.08, m(0x6a4a22, 0.85), sx * (len / 2 - 0.04), height / 2, sz * (depth / 2 - 0.04));
      box(len + 0.02, 0.06, 0.12, m(0x6a4a22, 0.85), 0, height * 0.5, depth / 2);
      break;
    }
    case 'pipes': {
      const frame = m(f.dark, 0.6);
      for (const sx of [-1, 0, 1]) box(0.08, height, depth, frame, sx * (len / 2 - 0.05), height / 2, 0);
      for (let k = 0; k < 4; k++) {
        const hy = 0.55 + k * 0.5;
        for (const sz of [-1, 1]) cylX(0.14, len - 0.1, m(k % 2 ? f.wood : f.metal, 0.4, 0.5), 0, hy, sz * (depth / 4));
      }
      for (let k = 1; k < 5; k++) box(0.06, height - 0.4, depth + 0.02, m(f.dark, 0.5), -len / 2 + k * len / 5, height / 2, 0);
      break;
    }
    case 'boiler': {
      const r = len / 2;
      cyl(r, height * 0.85, m(f.wood, 0.5, 0.5), 0, height * 0.425, 0);
      sph(r, m(f.wood, 0.5, 0.5), 0, height * 0.85, 0);
      for (const hy of [0.4, 1.2, 2.0]) cyl(r + 0.03, 0.12, m(f.metal, 0.4, 0.6), 0, hy, 0);
      cyl(0.1, 0.3, m(f.accent, 0.4, 0.2), r * 0.7, 1.4, r * 0.7);
      break;
    }
    case 'manifold': {
      box(len, 0.25, depth, m(f.dark, 0.6), 0, 0.125, 0);
      for (const sz of [-1, 1]) cylX(0.12, len - 0.1, m(f.wood, 0.4, 0.5), 0, 0.5, sz * 0.25);
      for (const sx of [-1, 1]) cyl(0.2, 0.05, m(0xc23a2a, 0.5), sx * 0.4, 0.82, 0);
      box(0.1, 0.5, 0.1, m(f.dark), 0, 0.5, 0);
      break;
    }
    case 'drums': {
      box(len, 0.15, depth, m(0x6a5a3c, 0.9), 0, 0.075, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.29, 0.85, m(0x2f6f9a, 0.5, 0.3), sx * 0.3, 0.58, sz * 0.3);
      break;
    }
    case 'pump': {
      box(len, 0.2, depth, m(f.dark, 0.6), 0, 0.1, 0);
      cylX(0.28, 0.8, m(f.wood, 0.4, 0.5), -0.3, 0.55, 0);
      box(0.5, 0.5, 0.6, m(f.metal, 0.5, 0.4), 0.45, 0.45, 0);
      break;
    }
    case 'bottles': {
      for (let k = 0; k < 4; k++) cyl(0.12, height - 0.3, m(0xa8b6c0, 0.4, 0.5), -len / 2 + (k + 0.5) * len / 4, (height - 0.3) / 2, 0);
      box(len, 0.05, 0.02, m(f.dark), 0, height * 0.6, depth / 2 - 0.05);
      break;
    }
    case 'counter': {
      box(len, height - 0.06, depth, m(f.wood, 0.55), 0, (height - 0.06) / 2, 0);
      box(len + 0.04, 0.06, depth + 0.04, m(f.metal, 0.3, 0.6), 0, height - 0.03, 0);
      box(len - 0.1, 0.7, 0.04, glassMat(f), 0, height + 0.35, -depth / 2 + 0.1);
      for (const x of [-0.9, 0, 0.9]) box(0.3, 0.2, 0.04, m(0x15181c, 0.3), x, height + 0.12, 0.05);
      break;
    }
    case 'deposit': {
      box(len, height, depth, m(f.dark, 0.6), 0, height / 2, 0);
      const brass = m(f.metal, 0.35, 0.7);
      for (let c = 0; c < 8; c++) for (let r = 0; r < 4; r++) box(len / 8 - 0.06, 0.4, 0.03, brass, -len / 2 + (c + 0.5) * len / 8, 0.35 + r * 0.45, depth / 2 + 0.01);
      break;
    }
    case 'glass': {
      box(len, height, 0.05, glassMat(f), 0, height / 2, 0);
      box(len + 0.04, 0.06, 0.1, m(f.metal, 0.3, 0.7), 0, 0.03, 0);
      box(len + 0.04, 0.06, 0.1, m(f.metal, 0.3, 0.7), 0, height, 0);
      break;
    }
    case 'pillar': {
      box(len, height, depth, m(0xd9d2c0, 0.7), 0, height / 2, 0);
      box(len + 0.2, 0.25, depth + 0.2, m(0xb9b19c, 0.7), 0, 0.125, 0);
      box(len + 0.2, 0.25, depth + 0.2, m(0xb9b19c, 0.7), 0, height - 0.125, 0);
      break;
    }
    case 'cart': {
      box(len, 0.1, depth, m(f.dark, 0.6), 0, 0.3, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.07, 0.06, m(0x15181c), sx * (len / 2 - 0.1), 0.07, sz * (depth / 2 - 0.08));
      for (const sx of [-1, 1]) box(0.4, 0.4, depth - 0.1, m(0x5f8a4d, 0.9), sx * 0.22, 0.55, 0);
      box(0.05, 0.9, depth, m(f.metal, 0.4, 0.6), len / 2 - 0.03, 0.55, 0);
      break;
    }
    case 'atm': {
      box(len, height, depth, m(f.dark, 0.5), 0, height / 2, 0);
      box(0.5, 0.35, 0.04, new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: f.accent, emissiveIntensity: 1.1 }), 0, 1.3, depth / 2 + 0.01);
      box(0.4, 0.08, 0.1, m(f.metal, 0.3, 0.7), 0, 0.95, depth / 2);
      break;
    }
    case 'rack': {
      const up = m(0x3a4b6a, 0.5, 0.3);
      const beam = m(0xe07a2a, 0.5, 0.3);
      for (const x of [-0.5, -1 / 6 - 0.17, 0.17 + 1 / 6, 0.5].map((v) => v * (len - 0.1))) for (const z of [-1, 1]) box(0.07, height, 0.07, up, x, height / 2, z * (depth / 2 - 0.04));
      for (const hy of [0.55, 1.5, 2.45]) {
        box(len - 0.05, 0.1, depth, beam, 0, hy, 0);
        for (let k = 0; k < 3; k++) box(len / 3 - 0.14, 0.5, depth - 0.15, m(0xb48a4a, 0.85), -len / 3 + k * len / 3, hy + 0.3, 0);
      }
      break;
    }
    case 'pallets': {
      box(len, 0.14, depth, m(0x8a6a3c, 0.9), 0, 0.07, 0);
      for (const sx of [-1, 1]) for (const lvl of [0, 1]) box(len / 2 - 0.05, 0.8, depth - 0.1, m(lvl ? 0xc8b078 : 0xb89a5c, 0.85), sx * len / 4, 0.14 + 0.4 + lvl * 0.8, 0);
      box(len + 0.02, 1.6, depth + 0.02, new THREE.MeshStandardMaterial({ color: 0xd2ebff, transparent: true, opacity: 0.18, roughness: 0.2 }), 0, 0.94, 0);
      break;
    }
    case 'forklift': {
      // Long way along z (its front, the forks, toward +z).
      box(len, 0.5, depth * 0.55, m(0xe0a22a, 0.5, 0.3), 0, 0.5, -depth * 0.2);
      box(len * 0.8, 0.85, depth * 0.3, m(0x2a3138, 0.4), 0, 1.0, -depth * 0.25);
      box(0.06, 1.2, 0.06, m(0xe0a22a), -len * 0.4, 1.05, -depth * 0.05);
      box(0.06, 1.2, 0.06, m(0xe0a22a), len * 0.4, 1.05, -depth * 0.05);
      box(len * 0.85, 1.1, 0.08, m(f.dark, 0.5), 0, 0.85, depth * 0.1);
      for (const sx of [-1, 1]) box(0.1, 0.06, depth * 0.38, m(0x8a949c, 0.4, 0.6), sx * len * 0.3, 0.12, depth * 0.3);
      for (const sx of [-1, 1]) for (const sz of [-0.35, 0.2]) cylX(0.22, 0.16, m(0x15181c), sx * (len / 2 + 0.02), 0.22, sz * depth);
      break;
    }
    case 'conveyor': {
      for (const sx of [-1, -0.34, 0.34, 1]) for (const sz of [-1, 1]) box(0.06, 0.5, 0.06, m(f.dark), sx * (len / 2 - 0.1), 0.25, sz * (depth / 2 - 0.06));
      box(len, 0.1, depth, m(0x3a4046, 0.6), 0, 0.55, 0);
      box(len - 0.1, 0.04, depth - 0.2, m(0x23282d, 0.7), 0, 0.62, 0);
      box(0.5, 0.3, 0.4, m(0xb48a4a, 0.85), 0.3, 0.8, 0);
      break;
    }
    case 'container': {
      box(len, height, depth, m(0xb0452e, 0.7, 0.3), 0, height / 2, 0);
      for (let k = 0; k < 14; k++) box(0.05, height - 0.1, 0.05, m(0x8a3422, 0.8), -len / 2 + (k + 0.5) * len / 14, height / 2, depth / 2 + 0.02);
      break;
    }
    case 'cage': {
      const frame = m(0x6a7580, 0.5, 0.5);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.06, height, 0.06, frame, sx * (len / 2 - 0.03), height / 2, sz * (depth / 2 - 0.03));
      box(len, 0.06, depth, frame, 0, height, 0);
      box(len, height, depth, new THREE.MeshStandardMaterial({ color: 0x9bb0bd, transparent: true, opacity: 0.16, roughness: 0.5 }), 0, height / 2, 0);
      box(0.6, 0.5, 0.5, m(0xb48a4a, 0.85), 0, 0.25, 0);
      break;
    }
    case 'labbench': {
      box(len, height - 0.06, depth, m(0xc6d0d7, 0.5), 0, (height - 0.06) / 2, 0);
      box(len + 0.04, 0.06, depth + 0.04, m(0x3a4852, 0.4), 0, height - 0.03, 0);
      cyl(0.18, 0.04, m(0x7a8792, 0.3, 0.7), -0.8, height + 0.02, 0);
      box(0.3, 0.3, 0.3, m(f.glass, 0.2), 0.7, height + 0.15, -0.1);
      box(0.5, 0.18, 0.3, m(f.dark, 0.5), 1.05, height + 0.09, 0.1);
      break;
    }
    case 'hood': {
      box(len, height, depth, m(0xd6dde2, 0.5), 0, height / 2, 0);
      box(len - 0.2, height * 0.5, 0.04, glassMat(f), 0, height * 0.55, depth / 2 + 0.01);
      box(len * 0.5, 0.2, depth * 0.7, m(f.dark, 0.5), 0, height + 0.1, 0);
      break;
    }
    case 'tank': {
      const r = len / 2;
      cyl(r + 0.05, 0.12, m(f.dark, 0.4, 0.5), 0, 0.06, 0);
      cyl(r, height - 0.3, new THREE.MeshStandardMaterial({ color: f.glass, transparent: true, opacity: 0.28, roughness: 0.1 }), 0, 0.12 + (height - 0.3) / 2, 0);
      cyl(r * 0.45, height - 0.8, new THREE.MeshStandardMaterial({ color: f.liquid === undefined ? 0x1a4a34 : 0x123a5a, emissive: f.liquid ?? 0x6aff9a, emissiveIntensity: 0.7 }), 0, 0.12 + (height - 0.8) / 2 + 0.2, 0);
      cyl(r + 0.05, 0.14, m(f.dark, 0.4, 0.5), 0, height - 0.07, 0);
      break;
    }
    case 'fridge': {
      box(len, height, depth, m(0xe4eaee, 0.4), 0, height / 2, 0);
      box(0.04, 0.5, 0.05, m(f.metal, 0.3, 0.7), len * 0.35, height * 0.6, depth / 2 + 0.02);
      break;
    }
    case 'board': {
      box(len, height - 0.2, depth, m(0xf2f5f7, 0.5), 0, 0.2 + (height - 0.2) / 2, 0);
      box(len + 0.06, 0.06, depth + 0.04, m(f.metal, 0.3, 0.6), 0, height, 0);
      for (const sx of [-1, 1]) box(0.06, 0.4, depth + 0.02, m(f.metal, 0.3, 0.6), sx * (len / 2 - 0.1), 0.2, 0);
      break;
    }
    case 'airlock': {
      const frame = m(f.metal, 0.3, 0.6);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, height, 0.08, frame, sx * (len / 2 - 0.04), height / 2, sz * (depth / 2 - 0.04));
      box(len, 0.1, depth, frame, 0, height, 0);
      box(len - 0.1, height - 0.1, depth - 0.1, new THREE.MeshStandardMaterial({ color: f.glass, transparent: true, opacity: 0.2, roughness: 0.1 }), 0, height / 2, 0);
      break;
    }
    case 'stool': {
      for (const sx of [-1, 1]) {
        cyl(0.17, 0.05, m(f.sofa, 0.8), sx * len * 0.25, 0.55, 0);
        cyl(0.03, 0.5, m(f.metal, 0.3, 0.6), sx * len * 0.25, 0.27, 0);
      }
      break;
    }
    // ---- the bunker's cube-built set ----
    case 'cargo':
    case 'bank': {
      if (f.cargoSkin === 'archive') {
        // A bank of sliding shelving (compactus): a steel carcass on floor rails, bays of coloured file spines down both long sides, a top lip, and a hand wheel at the end it is slid from.
        const steelA = m(0x6d7a89, 0.55, 0.45);
        const frameA = m(0x3f4a58, 0.5, 0.6);
        const rail = m(0x22272d, 0.5, 0.5);
        const spines = [0xc4524a, 0x4f8fc0, 0xd1a548, 0x6fa07a, 0xdcd6c4, 0x8a6fb0];
        box(len, height - 0.12, depth, steelA, 0, (height - 0.12) / 2 + 0.06, 0);
        for (const sz of [-1, 1]) box(len + 0.1, 0.1, 0.16, rail, 0, 0.05, sz * (depth / 2 - 0.3));
        box(len + 0.06, 0.1, depth + 0.06, frameA, 0, height - 0.05, 0);
        const bays = 6;
        for (let b = 0; b < bays; b++) {
          const x = -len / 2 + 0.35 + (b * (len - 0.7)) / (bays - 1);
          for (const sz of [-1, 1]) {
            box(0.08, height - 0.3, 0.06, frameA, x + (len - 0.7) / (bays - 1) / 2, height / 2, sz * (depth / 2 + 0.03));
            for (let r = 0; r < 4; r++) box((len - 0.7) / (bays - 1) - 0.18, 0.2, 0.06, m(spines[(b * 2 + r + (sz > 0 ? 1 : 0) + Math.abs(Math.round(p.cx / 4) + Math.round(p.cz / 4))) % spines.length]!, 0.7, 0.1), x, 0.42 + r * 0.56, sz * (depth / 2 + 0.03));
          }
        }
        box(0.1, height - 0.4, depth - 0.4, frameA, len / 2 + 0.05, height / 2, 0);
        box(0.06, 0.5, 0.5, m(0xc9a56a, 0.4, 0.6), len / 2 + 0.14, height * 0.55, 0);
        for (const dz of [-0.2, 0.2]) box(0.05, 0.05, 0.5, m(0xc9a56a, 0.4, 0.6), len / 2 + 0.18, height * 0.55, dz * 0 + dz);
        break;
      }
      if (f.cargoSkin === 'crates') {
        // Stacks of wooden crates: a plank body in two tiers, slats and corner battens, a stencilled plate on the door end.
        const wood = m(0x8a6a44, 0.85, 0.05);
        const slat = m(0x5d452b, 0.9, 0.05);
        const bat = m(0x3a2c1c, 0.8, 0.1);
        box(len, height - 0.1, depth, wood, 0, (height - 0.1) / 2 + 0.05, 0);
        box(len + 0.04, 0.08, depth + 0.04, bat, 0, height * 0.5, 0);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.14, height, 0.14, bat, sx * (len / 2 - 0.07), height / 2, sz * (depth / 2 - 0.07));
        const n = Math.floor(len / 0.75);
        for (let i = 1; i < n; i++) for (const sz of [-1, 1]) box(0.05, height - 0.2, 0.05, slat, -len / 2 + (i * len) / n, height / 2, sz * (depth / 2 + 0.02));
        box(0.04, 0.5, 0.9, m(0xe6dcc0, 0.6, 0.0), len / 2 + 0.03, height * 0.6, 0);
        box(0.05, 0.08, depth + 0.1, bat, len / 2 + 0.03, height - 0.12, 0);
        break;
      }
      if (f.cargoSkin === 'van') {
        // A parked armoured van, its cab at the +x end: a white box body, a lower cab with a dark windscreen, a red stripe and four wheels.
        const bodyL = len * 0.7;
        const cabL = len - bodyL;
        const white = m(0xdcdad0, 0.5, 0.3);
        const dark = m(0x14181d, 0.4, 0.5);
        box(bodyL, height - 0.45, depth, white, -len / 2 + bodyL / 2, 0.45 + (height - 0.45) / 2, 0);
        box(cabL, height * 0.62, depth - 0.2, white, len / 2 - cabL / 2, 0.45 + (height * 0.62) / 2, 0);
        box(0.05, height * 0.3, depth - 0.7, dark, len / 2 + 0.02, 0.45 + height * 0.42, 0);
        for (const sz of [-1, 1]) box(len, 0.12, 0.04, m(0xb23a3a, 0.6, 0.1), 0, 1.2, sz * (depth / 2 + 0.02));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.42, 0.34, dark, sx * (len / 2 - 1.1), 0.42, sz * (depth / 2 - 0.1));
        break;
      }
      if (f.cargoSkin === 'tubes') {
        // A bank of glass tubes: a base slab and a top plate, five tubes in a row lit blue from inside.
        const frame = m(0xdce6ec, 0.4, 0.4);
        const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.32, roughness: 0.1 });
        const core = new THREE.MeshStandardMaterial({ color: 0x123a5a, emissive: 0x5fd4ff, emissiveIntensity: 0.9 });
        box(len, 0.3, depth, frame, 0, 0.15, 0);
        box(len, 0.2, depth, frame, 0, height - 0.1, 0);
        const n = 5;
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + (len / n) * (i + 0.5);
          for (const z of [-depth * 0.22, depth * 0.22]) {
            cyl(0.62, height - 0.5, glass, x, 0.3 + (height - 0.5) / 2, z);
            const inner = cyl(0.26, height - 1.1, core, x, 0.3 + (height - 0.5) / 2, z);
            void inner;
          }
        }
        break;
      }
      // A shipping container: ribbed steel in one of a handful of colours (by where it stands), corner posts, a top frame, and at one end the doors with their locking bars.
      const palette = [0x8a4b32, 0x2f5f82, 0x4d6e3c, 0x7c8186, 0xb08a2e, 0x6b3a52];
      const col = palette[Math.abs(Math.round(p.cx / 4) * 7 + Math.round(p.cz / 4) * 13) % palette.length]!;
      const rib = new THREE.Color(col).multiplyScalar(0.78).getHex();
      const dark = m(0x15181c, 0.5, 0.5);
      const steel = m(0x3b4046, 0.4, 0.7);
      box(len, height, depth, m(col, 0.62, 0.35), 0, height / 2, 0);
      const n = Math.floor(len / 0.55);
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + 0.4 + (i * (len - 0.8)) / (n - 1);
        for (const sz of [-1, 1]) box(0.12, height - 0.3, 0.06, m(rib, 0.7, 0.3), x, height / 2, sz * (depth / 2 + 0.02));
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.18, height + 0.04, 0.18, steel, sx * (len / 2 - 0.09), height / 2, sz * (depth / 2 - 0.09));
      for (const sz of [-1, 1]) box(len, 0.12, 0.14, steel, 0, height - 0.04, sz * (depth / 2 - 0.07));
      box(0.05, height - 0.4, depth - 0.5, dark, len / 2 + 0.02, height / 2, 0);
      for (const dz of [-1.2, -0.4, 0.4, 1.2]) box(0.07, height - 0.5, 0.05, steel, len / 2 + 0.06, height / 2, dz);
      break;
    }
    case 'cube': {
      // A one-metre cube module: a shell with a dark band round its middle and corner posts, so cubes read as cubes where they stand side by side.
      box(len, height, depth, m(f.wood, 0.55, 0.15), 0, height / 2, 0);
      box(len + 0.02, 0.07, depth + 0.02, m(f.dark, 0.5), 0, height * 0.5, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.06, height + 0.02, 0.06, m(f.metal, 0.3, 0.6), sx * (len / 2 - 0.02), height / 2, sz * (depth / 2 - 0.02));
      break;
    }
    case 'cubetable': {
      // A cube for a pedestal, a wide top on it, and the top's border lit: a thin strip of light all round its edge.
      box(0.9, height - 0.08, 0.9, m(f.dark, 0.5, 0.2), 0, (height - 0.08) / 2, 0);
      box(len, 0.08, depth, m(f.wood, 0.4, 0.2), 0, height - 0.04, 0);
      const glow = new THREE.MeshStandardMaterial({ color: 0x0a1a1c, emissive: f.accent, emissiveIntensity: 2.4, roughness: 0.3 });
      const strips: Array<[number, number, number, number]> = [[len, 0.04, 0, -depth / 2 + 0.03], [len, 0.04, 0, depth / 2 - 0.03], [0.04, depth, -len / 2 + 0.03, 0], [0.04, depth, len / 2 - 0.03, 0]];
      for (const [w, d, x, z] of strips) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, d), glow);
        s.position.set(x, height + 0.005, z);
        markBloom(s);
        g.add(s);
      }
      break;
    }
    case 'cubestool': {
      box(len, height, depth, m(f.sofa, 0.8), 0, height / 2, 0);
      box(len + 0.02, 0.04, depth + 0.02, m(f.dark, 0.5), 0, height * 0.5, 0);
      break;
    }
    case 'cubebunk': {
      // Two cubes stacked, a lit rail along the front of the upper one.
      box(len, 0.86, depth, m(f.wood, 0.55, 0.15), 0, 0.43, 0);
      box(len, 0.86, depth, m(f.sofa, 0.8), 0, 0.9 + 0.43, 0);
      box(len + 0.02, 0.07, depth + 0.02, m(f.dark, 0.5), 0, 0.89, 0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len - 0.1, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0x0a1a1c, emissive: f.accent, emissiveIntensity: 2.2 }));
      rail.position.set(0, height - 0.03, depth / 2 + 0.01);
      markBloom(rail);
      g.add(rail);
      break;
    }
    case 'cubelocker': {
      box(len, height, depth, m(f.metal, 0.4, 0.5), 0, height / 2, 0);
      box(0.03, height - 0.2, 0.02, m(f.dark, 0.5), 0, height / 2, depth / 2 + 0.01); // the door's seam
      for (let k = 0; k < 4; k++) box(len - 0.3, 0.025, 0.02, m(f.dark, 0.5), 0, height - 0.25 - k * 0.07, depth / 2 + 0.012); // vent slats
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x0a1a1c, emissive: f.accent, emissiveIntensity: 2.4 }));
      led.position.set(len * 0.3, height * 0.55, depth / 2 + 0.015);
      markBloom(led);
      g.add(led);
      break;
    }
    case 'seat':
    case 'chair': {
      box(0.46, 0.05, 0.46, m(f.dark, 0.7), 0, 0.46, 0);
      box(0.46, 0.46, 0.05, m(f.dark, 0.7), 0, 0.72, -0.2);
      box(0.06, 0.44, 0.06, m(f.metal, 0.3, 0.6), 0, 0.22, 0);
      box(0.4, 0.03, 0.04, m(f.metal, 0.3, 0.6), 0, 0.03, 0);
      box(0.04, 0.03, 0.4, m(f.metal, 0.3, 0.6), 0, 0.03, 0);
      break;
    }
  }
  return g;
}

/** A piece of furniture that can be shot to bits (the exit levels): its body-stopping box, how many hits it takes, and what takes it out of the picture. */
export type Destructible = { box: WallBox; kind: string; hp: number; cx: number; cz: number; kill: () => void; /** The piece's own model, where it keeps one (it can be moved: a sliding bank). */ group: THREE.Object3D | null };

/**
 * Furnishes a storey: a model for each piece, and a body-stopping box under it (sofas and desks have room to crawl under; low pieces hide a crouched agent; cabinets hide anyone). The floors are
 * thick with furniture (hundreds of pieces), so the models are baked into one mesh per material per storey, not hundreds of small ones (the lamps and the consoles, which glow, stay as they are).
 */
function furnish(floor: FloorRig, level: number, set: TowerSetId): Destructible[] {
  return furnishPieces(floor, furnitureFor(level, set), FABRICS[set]);
}

/** The same, for any list of placed pieces (the bunker's, as well as a tower storey's). */
export function furnishPieces(floor: FloorRig, pieces: readonly Placed[], fabric: Fabric): Destructible[] {
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; verts: number }>();
  // Each baked piece remembers which vertices of which merged mesh are its own: shot to bits, they are collapsed to a point (no rebuilding, no extra draw calls).
  const pending: Array<{ box: WallBox; kind: string; hp: number; cx: number; cz: number; parts: Array<{ key: string; start: number; count: number }>; group: THREE.Object3D | null }> = [];
  for (const p of pieces) {
    const g = pieceModel(p, fabric);
    const parts: Array<{ key: string; start: number; count: number }> = [];
    let group: THREE.Object3D | null = null;
    g.position.set(p.cx, 0, p.cz);
    g.rotation.y = p.yaw;
    if (p.kind === 'lamp' || p.kind === 'console' || p.kind === 'cubetable' || p.kind === 'cubebunk' || p.kind === 'cubelocker' || p.kind === 'bank') {
      g.userData.furniture = true;
      if (p.kind === 'console') g.userData.console = true;
      floor.group.add(g);
      group = g;
    } else {
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.MeshStandardMaterial;
        const key = `${m.color.getHex()}|${m.roughness}|${m.metalness}|${m.emissive.getHex()}|${m.emissiveIntensity}|${m.side}|${m.transparent}|${m.opacity}`;
        let b = buckets.get(key);
        if (!b) {
          b = { mat: m, geos: [], verts: 0 };
          buckets.set(key, b);
        }
        const baked = o.geometry.clone().applyMatrix4(o.matrixWorld);
        parts.push({ key, start: b.verts, count: baked.getAttribute('position').count });
        b.verts += baked.getAttribute('position').count;
        b.geos.push(baked);
        o.geometry.dispose();
        if (m !== b.mat) m.dispose();
      });
    }
    if (p.spec.decor) continue;
    const box: WallBox = { ...p.box };
    if (p.spec.cover) box.cover = p.spec.cover;
    if (p.spec.crawl) box.under = true;
    if (p.spec.see) box.see = true;
    if (p.spec.roof) {
      box.roof = p.spec.height;
      floor.climbBoxes.push({ ...box });
    }
    floor.wallBoxes.push(box);
    // (Glass shatters at a hit; low furniture takes a few; tall pieces, the most.)
    pending.push({ box, kind: p.kind, hp: p.spec.see ? 1 : p.spec.cover === 'tall' ? 6 : p.spec.cover === 'low' ? 3 : 2, cx: p.cx, cz: p.cz, parts, group });
  }
  const meshes = new Map<string, THREE.Mesh>();
  for (const [key, { mat, geos }] of buckets.entries()) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.furniture = true;
    floor.group.add(mesh);
    meshes.set(key, mesh);
  }
  markHidingPlaces(floor, pieces);
  return pending.map((d) => ({
    box: d.box,
    kind: d.kind,
    hp: d.hp,
    cx: d.cx,
    cz: d.cz,
    group: d.group,
    kill: () => {
      if (d.group) d.group.visible = false;
      for (const part of d.parts) {
        const pos = meshes.get(part.key)?.geometry.getAttribute('position');
        if (!pos) continue;
        for (let i = part.start; i < part.start + part.count; i++) pos.setXYZ(i, 0, 0, 0);
        pos.needsUpdate = true;
      }
    },
  }));
}

/** A frame of four quads on the floor round a footprint: `gap` off its edge, `thick` wide. Appended to `out` as triangles. */
function frameQuads(out: number[], b: { minX: number; maxX: number; minZ: number; maxZ: number }, gap: number, thick: number): void {
  const x0 = b.minX - gap;
  const x1 = b.maxX + gap;
  const z0 = b.minZ - gap;
  const z1 = b.maxZ + gap;
  const quad = (ax: number, az: number, bx: number, bz: number): void => {
    out.push(ax, 0.03, az, bx, 0.03, az, bx, 0.03, bz, ax, 0.03, az, bx, 0.03, bz, ax, 0.03, bz);
  };
  quad(x0 - thick, z0 - thick, x1 + thick, z0); // north
  quad(x0 - thick, z1, x1 + thick, z1 + thick); // south
  quad(x0 - thick, z0, x0, z1); // west
  quad(x1, z0, x1 + thick, z1); // east
}

/**
 * Shows which pieces the agent can crawl under: a cyan ring on the floor round every sofa, desk, conference table and conveyor with room beneath it, and a pool of the same cyan under it.
 * Nothing else has one, so a ring always means "crawl under here".
 */
function markHidingPlaces(floor: FloorRig, pieces: readonly Placed[]): void {
  const ring: number[] = [];
  const pool: number[] = [];
  for (const p of pieces) {
    if (p.spec.decor) continue;
    if (p.spec.crawl) {
      frameQuads(ring, p.box, 0.1, 0.12);
      const b = p.box;
      const y = 0.025;
      pool.push(b.minX, y, b.minZ, b.maxX, y, b.minZ, b.maxX, y, b.maxZ, b.minX, y, b.minZ, b.maxX, y, b.maxZ, b.minX, y, b.maxZ);
    }
  }
  const add = (verts: number[], color: number, opacity: number): void => {
    if (verts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 2;
    mesh.userData.furniture = true;
    floor.group.add(mesh);
  };
  add(pool, 0x3fd8ff, 0.2);
  add(ring, 0x5fe6ff, 0.8);
}

/** One security camera in the scene: its head, the cone it throws on the floor, and what it is doing. */
export type CameraRig = {
  plan: CameraPlan;
  /** 'sweep' idle, 'lock' it has the agent, 'off' the feed is looped. */
  setState: (state: 'sweep' | 'lock' | 'off') => void;
  /** Turns the head to `yaw` and redraws the cone, clipped by the storey's walls; `dt` is the frame, over which the cone's edge eases to where it is now. */
  aim: (yaw: number, walls: readonly WallBox[], dt?: number) => void;
  group: THREE.Group;
  /** Its own control panel, on the wall under it (world metres): Interact there blinds just this camera for a while. */
  panel: { x: number; z: number };
  /** The panel's light: green while the camera is on, dark while it is blind. */
  setPanel: (on: boolean) => void;
  /** The middle of the panel's front, a hand's breadth off the wall: what a shot is aimed at (world metres). */
  shot: { x: number; z: number };
};

/** A camera's head tilts this far down (radians) when it looks about, and this far when it is switched off, over this many seconds. */
const CAMERA_PITCH = 0.32;
const CAMERA_DROOPED = 1.3;
const CAMERA_DROOP_S = 0.6;
const CONE_RAYS = 72; // (a fine fan: the cone's edge follows a wall or a cabinet closely, not in coarse steps)
const LENS_OUT = 0.45; // metres the lens is out from the camera's mount, along its way
const CONE_ALPHA_NEAR = 0.03;
const CONE_ALPHA_FAR = 0.2;

/** The storey's cameras: a wall bracket and a head that turns, a red lens, and a translucent cone on the floor. */
export function buildCameras(floor: FloorRig, level: number, plans: readonly CameraPlan[] = TOWER_CAMERAS): CameraRig[] {
  const rigs: CameraRig[] = [];
  for (const plan of plans) {
    if (plan.level !== level) continue;
    const group = new THREE.Group();
    const headY = plan.mountY ?? (plan.high ? HIGH_PANEL_Y + 0.85 : 2.55); // (a high camera sits above its panel, near the pylon's top)
    const lensY = headY - 0.13;
    group.position.set(plan.x, headY, plan.z);
    // The bracket runs back to the nearest wall.
    const toWall = plan.wall ? ({ W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] } as const)[plan.wall] : plan.x < 2 ? [-1, 0] : plan.x > (TOWER_COLS - 1) * CELL - 1 ? [1, 0] : plan.z > (TOWER_ROWS - 1) * CELL - 1 ? [0, 1] : [0, -1];
    const arm = new THREE.Mesh(new THREE.BoxGeometry(toWall[0] !== 0 ? 0.45 : 0.08, 0.08, toWall[1] !== 0 ? 0.45 : 0.08), mat(0x20252a, 0.5));
    arm.position.set(toWall[0]! * 0.22, 0, toWall[1]! * 0.22);
    group.add(arm);
    const turret = new THREE.Group();
    const pitch = new THREE.Group();
    pitch.rotation.x = CAMERA_PITCH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.5), mat(0x39414a, 0.4));
    body.position.z = 0.1;
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 1.6 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 12), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.4;
    markBloom(lens);
    pitch.add(body, lens);
    turret.add(pitch);
    group.add(turret);
    if (plan.mountY !== undefined && plan.mountY > 4) group.scale.setScalar(1.7); // (up on a double-height wall: bigger, to read from the chase camera)
    group.userData.camera = true;
    floor.group.add(group);

    // The cone on the floor: a fine fan, faint at the camera and stronger out at its edge, with a thin line round it.
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((CONE_RAYS + 2) * 3);
    const col = new Float32Array((CONE_RAYS + 2) * 4);
    const idx: number[] = [];
    for (let k = 1; k <= CONE_RAYS; k++) idx.push(0, k, k + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(idx);
    const coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(geo, coneMat);
    cone.frustumCulled = false;
    cone.userData.cameraCone = true;
    const edgeGeo = new THREE.BufferGeometry();
    const edgePos = new Float32Array((CONE_RAYS + 3) * 3);
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.3, depthWrite: false });
    const edge = new THREE.Line(edgeGeo, edgeMat);
    edge.frustumCulled = false;
    floor.group.add(cone, edge);
    const paint = (hex: number, near: number, far: number): void => {
      const c = new THREE.Color(hex);
      for (let k = 0; k < CONE_RAYS + 2; k++) {
        col[k * 4] = c.r;
        col[k * 4 + 1] = c.g;
        col[k * 4 + 2] = c.b;
        col[k * 4 + 3] = k === 0 ? near : far;
      }
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      edgeMat.color.set(hex);
    };
    paint(0xffb03a, CONE_ALPHA_NEAR, CONE_ALPHA_FAR);
    const smooth: number[] = [];

    // The camera's control panel on the wall, at the height of a hand: a boxed switch standing proud of the wall's face (the wall is thick: the panel's spot is its middle), a lit screen and a
    // light that is green while the camera is on and dark once it is off. (Interact works from the spot `panelAt`, the wall's middle.)
    const panelAt = { x: plan.x + toWall[0]! * 0.55, z: plan.z + toWall[1]! * 0.55 };
    const face = { x: panelAt.x - toWall[0]! * (WALL_T / 2), z: panelAt.z - toWall[1]! * (WALL_T / 2) }; // the wall's face, on the camera's side
    const alongX = toWall[0] === 0; // a wall running along x (the camera is north or south of it)
    const W = 0.7;
    const H = 0.5;
    const D = 0.12;
    const at = (out: number, y: number, along = 0): THREE.Vector3 => new THREE.Vector3(face.x - toWall[0]! * out + (alongX ? along : 0), y, face.z - toWall[1]! * out + (alongX ? 0 : along));
    const dims = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(alongX ? w : d, h, alongX ? d : w);
    const PY = plan.high ? HIGH_PANEL_Y : 1.3; // (a high camera's panel is up on a tall wall, beside the shelf)
    const box = new THREE.Mesh(dims(W, H, D), mat(0x39414a, 0.45));
    box.position.copy(at(D / 2, PY));
    const rim = new THREE.Mesh(dims(W + 0.08, H + 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.5 }));
    rim.position.copy(at(0.015, PY));
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x082010, emissive: 0x4ee08a, emissiveIntensity: 1.6 });
    const screen = new THREE.Mesh(dims(W - 0.16, H - 0.22, 0.03), screenMat);
    screen.position.copy(at(D + 0.012, PY + 0.04));
    markBloom(screen);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x082010, emissive: 0x4ee08a, emissiveIntensity: 1.6 });
    const led = new THREE.Mesh(dims(0.12, 0.07, 0.04), ledMat);
    led.position.copy(at(D + 0.02, PY - 0.17));
    markBloom(led);
    floor.group.add(rim, box, screen, led);
    const setPanel = (on: boolean): void => {
      ledMat.emissive.set(on ? 0x4ee08a : 0x40201a);
      ledMat.emissiveIntensity = on ? 1.6 : 0.4;
      screenMat.emissive.set(on ? 0x4ee08a : 0x2a1210);
      screenMat.emissiveIntensity = on ? 1.4 : 0.25;
    };

    let state: 'sweep' | 'lock' | 'off' = 'sweep';
    const setState = (st: 'sweep' | 'lock' | 'off'): void => {
      state = st;
      group.visible = true;
      cone.visible = st !== 'off';
      edge.visible = st !== 'off';
      if (st === 'lock') paint(0xff3a2a, 0.08, 0.38);
      else paint(0xffb03a, CONE_ALPHA_NEAR, CONE_ALPHA_FAR);
      lensMat.emissiveIntensity = st === 'off' ? 0 : st === 'lock' ? 3 : 1.6;
    };
    // Switched off, the head stops where it is and nods down to face the floor (and comes back up, turning again, when it is on).
    let droop = 0;
    let heldYaw: number | null = null;
    const aim = (yaw: number, walls: readonly WallBox[], dt = 1 / 60): void => {
      droop = state === 'off' ? Math.min(1, droop + dt / CAMERA_DROOP_S) : Math.max(0, droop - dt / CAMERA_DROOP_S);
      pitch.rotation.x = CAMERA_PITCH + (CAMERA_DROOPED - CAMERA_PITCH) * droop * droop * (3 - 2 * droop);
      heldYaw ??= yaw;
      if (state === 'off') {
        turret.rotation.y = heldYaw;
        return;
      }
      heldYaw = yaw;
      turret.rotation.y = yaw;
      const radii = coneRadii(plan, yaw, walls, CONE_RAYS);
      // Each ray's length eases to where it should be (about a twentieth of a second), so the edge does not jump when it passes the end of a cabinet.
      const ease = 1 - Math.exp(-dt * 20);
      radii.forEach((r, k) => {
        smooth[k] = smooth[k] === undefined ? r : smooth[k]! + (r - smooth[k]!) * ease;
      });
      const a = geo.getAttribute('position') as THREE.BufferAttribute;
      const e = edgeGeo.getAttribute('position') as THREE.BufferAttribute;
      // The beam leaves the lens, up on the wall bracket, and comes down to the floor at its far edge: from above it is seen starting at the camera, not at the floor beneath it.
      const lensX = plan.x + Math.sin(yaw) * LENS_OUT;
      const lensZ = plan.z + Math.cos(yaw) * LENS_OUT;
      a.setXYZ(0, lensX, lensY, lensZ);
      e.setXYZ(0, lensX, lensY, lensZ);
      smooth.forEach((r, k) => {
        const ang = yaw - plan.half + (2 * plan.half * k) / CONE_RAYS;
        const x = plan.x + Math.sin(ang) * r;
        const z = plan.z + Math.cos(ang) * r;
        a.setXYZ(k + 1, x, 0.06, z);
        e.setXYZ(k + 1, x, 0.07, z);
      });
      e.setXYZ(CONE_RAYS + 2, lensX, lensY, lensZ);
      a.needsUpdate = true;
      e.needsUpdate = true;
    };
    const shotAt = at(D + 0.06, PY);
    rigs.push({ plan, setState, aim, group, panel: panelAt, setPanel, shot: { x: shotAt.x, z: shotAt.z } });
  }
  return rigs;
}

/** What dressing a storey in the hall: its fins, lamps and balustrades. Returns the lift cabs it stands. */
export type DressedLevel = {
  lifts: Array<{ id: string; rig: ElevatorRig }>;
  keycard: THREE.Group | null;
  /** The bonus lying on the bridge's deck, on the storey the bridge is on. */
  bonus: THREE.Group | null;
  cameras: CameraRig[];
  /** The timed stair's folding flight (on the lower storey) and the boxes that shut each of its ends while it is folded away (one per storey it joins). */
  timedStair: THREE.Object3D | null;
  timedBarriers: WallBox[];
  officeDoors: OfficeDoorRig[];
  /** Props that ghost out when they stand between the camera and the agent (propfade.ts): the passage's walls, the office doors, the lift cabs. */
  fadables: FadeProp[];
  /** The furniture that can be shot to bits (the exit levels). */
  pieces: Destructible[];
  /** The offices' way out: the doors, and the lift cab at the end of the passage beyond them. */
  heist: { lift: ElevatorRig; door: { box: WallBox; position: { x: number; z: number }; slide: (k: number) => void; setLocked: (locked: boolean) => void } } | null;
};

/** What the heist beyond the tower looks like (its place's floor theme and name): the passage to the lift is dressed in it. */
export type HeistLook = { wall: number; cap: number; fixture: number; marking: number; label: string };

/** The heist door and what is beyond it: sliding doors out of the south wall, a passage in the heist's own look (its walls, its light, its floor lines), and the lift cab that goes down to it. */
function buildHeistPassage(floor: FloorRig, look: HeistLook, fadables: FadeProp[]): NonNullable<DressedLevel['heist']> {
  const cx = HEIST_DOOR.x * CELL;
  const z0 = HEIST_DOOR.y * CELL + CELL / 2; // the doorway, in the south wall
  const z1 = HEIST_LIFT.y * CELL + CELL / 2; // the passage's far end, behind the cab
  const len = z1 - z0;
  const half = CELL / 2 - WALL_T / 2;
  const group = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.12, len + 0.3), mat(0x23272d, 0.7));
  slab.position.set(cx, -0.06, (z0 + z1) / 2);
  group.add(slab);
  const wallMat = mat(look.wall, 0.8);
  const capMat = mat(look.cap, 0.6);
  for (const s of [-1, 1]) {
    const x = cx + s * half;
    const w = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, len), wallMat);
    w.position.set(x, WALL_H / 2, (z0 + z1) / 2);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.04, 0.1, len), capMat);
    cap.position.set(x, WALL_H + 0.05, (z0 + z1) / 2);
    group.add(w, cap);
    floor.wallBoxes.push({ minX: x - WALL_T / 2, maxX: x + WALL_T / 2, minZ: z0, maxZ: z1 });
    fadables.push({ objects: [w, cap], box: { minX: x - WALL_T / 2 - 0.1, maxX: x + WALL_T / 2 + 0.1, minY: 0, maxY: WALL_H + 0.1, minZ: z0, maxZ: z1 } });
    // A line down the floor beside each wall, in the heist's marking colour, leading to the lift.
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, len - 1.2), new THREE.MeshStandardMaterial({ color: look.marking, emissive: look.marking, emissiveIntensity: 0.9 }));
    line.position.set(cx + s * (half - 0.35), 0.01, z0 + (len - 1.2) / 2 + 0.5);
    markBloom(line);
    group.add(line);
  }
  // The wall behind the lift.
  const back = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H, WALL_T), wallMat);
  back.position.set(cx, WALL_H / 2, z1 - WALL_T / 2);
  group.add(back);
  floor.wallBoxes.push({ minX: cx - CELL / 2, maxX: cx + CELL / 2, minZ: z1 - WALL_T, maxZ: z1 });
  fadables.push({ objects: [back], box: { minX: cx - CELL / 2, maxX: cx + CELL / 2, minY: 0, maxY: WALL_H, minZ: z1 - WALL_T - 0.1, maxZ: z1 } });
  // Its light, the heist's: a fixture over the doorway side and one over the lift.
  for (const z of [z0 + 2.6, z0 + 7]) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: look.fixture, emissive: look.fixture, emissiveIntensity: 2.2 }));
    bulb.position.set(cx, WALL_H - 0.3, z);
    markBloom(bulb);
    const light = new THREE.PointLight(look.fixture, 38, 10);
    light.position.copy(bulb.position);
    group.add(bulb, light);
  }
  // The place's name on the floor, in front of the lift.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g2 = c.getContext('2d')!;
  g2.fillStyle = 'rgba(0,0,0,0)';
  g2.clearRect(0, 0, 512, 128);
  g2.fillStyle = '#' + look.marking.toString(16).padStart(6, '0');
  g2.font = 'bold 54px monospace';
  g2.textAlign = 'center';
  g2.textBaseline = 'middle';
  g2.fillText(look.label, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  sign.rotation.x = -Math.PI / 2;
  sign.rotation.z = Math.PI; // the lettering reads from the door, looking toward the lift
  sign.position.set(cx, 0.02, z1 - CELL - 0.6);
  group.add(sign);
  floor.group.add(group);

  // The lift down: the cab at the far end, doors open toward the doorway.
  const lift = buildElevator(HEIST_LIFT.x, HEIST_LIFT.y, 'N', LIFT_STYLE);
  floor.group.add(lift.group);
  floor.wallBoxes.push(...lift.boxes);
  lift.setState('ready', '▼ HEIST');
  lift.setOpen(true);

  // The doors: two leaves that slide apart into the wall, under a lintel with a warm strip. A shut door is a wall box.
  const frame = new THREE.Group();
  frame.position.set(cx, 0, z0);
  const leafMat = mat(0x2b3138, 0.4);
  const leafW = half;
  const leaves = [-1, 1].map((s) => {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, 2.6, 0.14), leafMat);
    leaf.position.set(s * leafW / 2, 1.3, 0);
    frame.add(leaf);
    return { leaf, s };
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.4, 0.3), mat(0x1b1f24, 0.5));
  lintel.position.set(0, 2.8, 0);
  const stripMat = new THREE.MeshStandardMaterial({ color: 0xff4a3a, emissive: 0xff4a3a, emissiveIntensity: 1.6 }); // (red until the tower is clear)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.8, 0.08, 0.34), stripMat);
  strip.position.set(0, 2.62, 0);
  markBloom(strip);
  frame.add(lintel, strip);
  floor.group.add(frame);
  const box: WallBox = { minX: cx - half, maxX: cx + half, minZ: z0 - 0.15, maxZ: z0 + 0.15 };
  floor.wallBoxes.push(box);
  return {
    lift,
    door: {
      box,
      position: { x: cx, z: z0 },
      slide: (k) => {
        for (const { leaf, s } of leaves) leaf.position.x = s * (leafW / 2 + k * (leafW - 0.1));
      },
      setLocked: (locked) => {
        stripMat.color.set(locked ? 0xff4a3a : 0x6fe39a);
        stripMat.emissive.set(locked ? 0xff4a3a : 0x6fe39a);
      },
    },
  };
}

/** A sliding keycard door in a doorway of the back offices: shut and red until the agent has the card, then green; `slide(k)` takes it from shut (0) to open (1). */
export type OfficeDoorRig = { x: number; y: number; box: WallBox; leaf: THREE.Object3D; slide: (k: number) => void; unlock: () => void; position: { x: number; z: number } };

function buildOfficeDoor(floor: FloorRig, d: { x: number; y: number }): OfficeDoorRig {
  const cx = d.x * CELL;
  const cz = d.y * CELL - CELL / 2;
  const w = CELL - 0.6;
  const group = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, 2.7, 0.12), mat(0x2a3138, 0.45));
  leaf.position.set(0, 1.35, 0);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff5a4a, emissiveIntensity: 1.6 });
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), lightMat);
  light.position.set(w / 2 - 0.4, 1.5, 0.08);
  markBloom(light);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.06, 0.14), lightMat);
  strip.position.set(0, 2.55, 0);
  group.add(leaf, light, strip);
  group.position.set(cx, 0, cz);
  floor.group.add(group);
  const box: WallBox = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - 0.15, maxZ: cz + 0.15 };
  return {
    x: d.x,
    y: d.y,
    box,
    leaf,
    position: { x: cx, z: cz },
    slide: (k) => {
      leaf.position.x = k * (w - 0.1);
      light.visible = k < 0.5;
    },
    unlock: () => {
      lightMat.color.set(0x6fe39a);
      lightMat.emissive.set(0x6fe39a);
    },
  };
}

/** Builds everything of the tower that belongs to this storey onto its floor. `floorHeight` is the stacked storeys' spacing. */
export function dressTowerLevel(floor: FloorRig, level: number, floorHeight: number, heistLook?: HeistLook, set: TowerSetId = 'campus'): DressedLevel {
  cutFloor(floor, level);
  const pieces = furnish(floor, level, set);
  const fab = FABRICS[set];
  const timber = mat(fab.rail, 0.55);
  const dark = mat(fab.railDark, 0.6);
  const lamp = new THREE.MeshStandardMaterial({ color: fab.accent, emissive: fab.accent, emissiveIntensity: 1.6 });
  const posts: Post[] = [];

  // Balustrades along every edge where floor meets a drop.
  const bridge = TOWER_BRIDGES.find((b) => b.level === level);
  const landing = (r: { x: number; y: number; dir: string }): boolean => !!bridge && r.y === bridge.y && ((r.x === bridge.fromX && r.dir === 'E') || (r.x === bridge.toX && r.dir === 'W'));
  for (const r of railsFor(level)) {
    if (!landing(r)) {
      railEdge(floor, posts, timber, r.x, r.y, r.dir);
      continue;
    }
    // The bridge's landing: the rail along this edge stops short of the deck, either side.
    const ex = r.x * CELL + (r.dir === 'E' ? CELL / 2 : -CELL / 2);
    const zc = r.y * CELL;
    railSpan(floor, posts, timber, ex, zc - CELL / 2, ex, zc - bridge!.width / 2 - 0.15);
    railSpan(floor, posts, timber, ex, zc + bridge!.width / 2 + 0.15, ex, zc + CELL / 2);
  }
  if (bridge) buildBridge(floor, bridge);

  // The flights that start on this storey (they are drawn with the lower one, which is on view whenever the upper one is), and their sides, kept on both storeys the flight joins.
  let timedStair: THREE.Object3D | null = null;
  const timedBarriers: WallBox[] = [];
  const fadables: FadeProp[] = [];
  for (const w of climbWalls(level)) buildClimbWall(floor, w, floorHeight, fadables);
  for (const q of TOWER_PYLONS) if (q.level === level) buildPylon(floor, q.x, q.y, fadables);
  for (const s of TOWER_STAIRS) {
    if (s.climb) continue; // (no flight: a wall to climb, built above, and the rails round the opening)
    if (s.timed && (stairLow(s) === level || stairHigh(s) === level)) {
      // While it is folded away, a flight's mouth is shut with a see-through gate where it meets this storey (the end of the run on its low or its high side).
      const end = s.fromLevel === level ? s.y * CELL - CELL / 2 : (s.y + s.run) * CELL - CELL / 2;
      timedBarriers.push({ minX: s.x * CELL - CELL / 2, maxX: (s.x + s.width) * CELL - CELL / 2, minZ: end - 0.15, maxZ: end + 0.15, see: true });
    }
    if (stairLow(s) === level) {
      const mesh = buildStairMesh({ x: s.x, y: s.y, spanX: true, fromFloorY: s.fromLevel * floorHeight, toFloorY: s.toLevel * floorHeight, run: s.run, width: s.width }, CELL, { tread: fab.rail });
      mesh.position.y -= floor.group.position.y;
      floor.group.add(mesh);
      if (s.timed) timedStair = mesh;
      for (const xs of [s.x * CELL - CELL / 2, (s.x + s.width) * CELL - CELL / 2]) stairSide(floor, posts, timber, s, xs, floorHeight);
    } else if (stairHigh(s) === level) {
      // The other end of the flight: just the side boxes, so the agent coming down it is held in by this storey's walls too.
      const z0 = s.y * CELL - CELL / 2;
      for (const xs of [s.x * CELL - CELL / 2, (s.x + s.width) * CELL - CELL / 2]) floor.wallBoxes.push({ minX: xs - 0.15, maxX: xs + 0.15, minZ: z0, maxZ: z0 + s.run * CELL, see: true } satisfies WallBox);
    }
  }
  const postMesh = postsMesh(posts, timber);
  if (postMesh) floor.group.add(postMesh);

  // Timber fins down the walls of the lobby levels, with a lamp on each, and slats across the back.
  if (level <= 2) {
    const fin = (x: number, z: number, sx: number, sz: number): void => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_H, sz), dark);
      f.position.set(x, WALL_H / 2, z);
      floor.group.add(f);
    };
    const lampAt = (x: number, z: number): void => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), lamp);
      l.position.set(x, 2.3, z);
      floor.group.add(l);
    };
    const inner = WALL_T / 2;
    // The fins and lamps stand on the lines between cells, not in the middle of them: the furniture stands against the walls in the cells' middles.
    const floorAt = (x: number, y: number): boolean => walkable(level, x, y) || walkable(level, x, y - 1);
    for (let y = 1; y < TOWER_ROWS; y++) {
      const z = y * CELL - CELL / 2;
      if (floorAt(0, y)) {
        fin(-CELL / 2 + inner + 0.3, z, 0.6, 0.7);
        lampAt(-CELL / 2 + inner + 0.7, z);
      }
      if (floorAt(TOWER_COLS - 1, y)) {
        fin((TOWER_COLS - 1) * CELL + CELL / 2 - inner - 0.3, z, 0.6, 0.7);
        lampAt((TOWER_COLS - 1) * CELL + CELL / 2 - inner - 0.7, z);
      }
    }
    const rowAt = (x: number, y: number): boolean => walkable(level, x, y) || walkable(level, x - 1, y);
    for (let x = 1; x < TOWER_COLS; x++) {
      const px = x * CELL - CELL / 2;
      if (rowAt(x, 0)) fin(px, -CELL / 2 + inner + 0.15, 0.45, 0.3);
      if (rowAt(x, TOWER_ROWS - 1) && !TOWER_LIFTS.some((l) => l.x === x || l.x === x - 1)) {
        const zb = (TOWER_ROWS - 1) * CELL + CELL / 2 - inner - 0.15;
        fin(px, zb, 0.45, 0.3);
        for (const o of [-0.9, 0.9]) fin(px + o, zb, 0.3, 0.3);
      }
    }
  }

  // The heist door: sliding doors in the offices' back wall, and beyond them the way to the lift down (the passage is dressed in the heist's own look, so the other side is seen before it is entered).
  const heist = level === OFFICES && heistLook ? buildHeistPassage(floor, heistLook, fadables) : null;

  // The lift cabs: a passenger lift's doors stand open; stepping in and pressing Interact rides it. The service lift's are shut, and red, until the keycard.
  const lifts: DressedLevel['lifts'] = [];
  for (const lf of TOWER_LIFTS) {
    if (!lf.serves.includes(level)) continue;
    const rig = buildElevator(lf.x, lf.y, lf.opens, lf.locked ? SERVICE : PASSENGER);
    floor.group.add(rig.group);
    floor.wallBoxes.push(...rig.boxes);
    fadables.push({ objects: [rig.group], box: { minX: Math.min(...rig.boxes.map((b) => b.minX)), maxX: Math.max(...rig.boxes.map((b) => b.maxX)), minY: 0, maxY: WALL_H, minZ: Math.min(...rig.boxes.map((b) => b.minZ)), maxZ: Math.max(...rig.boxes.map((b) => b.maxZ)) } });
    if (lf.locked) {
      rig.setState('locked');
      rig.setOpen(false);
      floor.wallBoxes.push(rig.doorBox);
    } else {
      rig.setState('ready');
      rig.setOpen(true);
    }
    lifts.push({ id: lf.id, rig });
  }

  // This storey's keycard: a card on a little desk, glowing so it reads from across the floor (the heist door wants one from every storey; the gallery's also opens the service lift and the back offices).
  let keycard: THREE.Group | null = null;
  const cardHere = TOWER_CARDS.find((c) => c.level === level);
  if (cardHere) {
    keycard = new THREE.Group();
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.7), mat(0x3a2a1a, 0.6));
    desk.position.y = 0.45;
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0x6fd6f0, emissive: 0x6fd6f0, emissiveIntensity: 1.6 }));
    card.position.set(0, 0.94, 0);
    markBloom(card);
    keycard.userData.card = card; // (only the card is taken: the little desk stays)
    keycard.add(desk, card);
    keycard.position.set(cardHere.x * CELL + 0.4, 0, cardHere.y * CELL + CELL / 2 - 0.9);
    floor.group.add(keycard);
    // The little desk is solid: low enough to see over, and to take the card from beside it.
    floor.wallBoxes.push({ minX: keycard.position.x - 0.7, maxX: keycard.position.x + 0.7, minZ: keycard.position.z - 0.35, maxZ: keycard.position.z + 0.35, cover: 'low' });
  }
  // The bridge's bonus: a glowing gold chip lying in the middle of the deck, for whoever gets out there.
  let bonus: THREE.Group | null = null;
  if (TOWER_BRIDGES.length > 0 && level === TOWER_BRIDGE_BONUS.level) {
    bonus = new THREE.Group();
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0x3a2a08, emissive: 0xffc44a, emissiveIntensity: 2 }));
    chip.position.y = 0.06;
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.01, 20), new THREE.MeshBasicMaterial({ color: 0xffc44a, transparent: true, opacity: 0.3, depthWrite: false }));
    halo.position.y = 0.02;
    markBloom(chip);
    bonus.add(chip, halo);
    bonus.position.set(TOWER_BRIDGE_BONUS.x, 0, TOWER_BRIDGE_BONUS.z);
    floor.group.add(bonus);
  }
  const officeDoors = TOWER_OFFICE_DOORS.filter((d) => d.level === level).map((d) => buildOfficeDoor(floor, d));
  for (const d of officeDoors) {
    floor.wallBoxes.push(d.box);
    fadables.push({ objects: [d.leaf], box: { minX: d.box.minX, maxX: d.box.maxX, minY: 0, maxY: 2.8, minZ: d.box.minZ - 0.1, maxZ: d.box.maxZ + 0.1 } });
  }
  return { lifts, keycard, bonus, cameras: buildCameras(floor, level), timedStair, timedBarriers, officeDoors, fadables, pieces, heist };
}

