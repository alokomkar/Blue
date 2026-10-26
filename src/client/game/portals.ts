// The ways in and out that are not a lift (ways.ts says which place has which). Each is returned as an ElevatorRig, so the game works them the same way as a lift:
// they have doors that open and shut with a collision box in the doorway, a spawn point, a point in front, and a readout.
//
// The five ways IN are doorways in the building's outer wall at the start cell: the agent starts outside, the doors open, and they walk in. They are built
// in a frame whose +Z points into the building and whose wall plane is at z = -CELL/2; the cell's outer wall is taken out of the plan the floor is drawn from
// (game.ts) and this fills the gap: a jamb either side, a lintel, and the doors.
//
//   doors    (museum)    two wooden leaves with brass, swinging inward
//   gate     (refinery)  a mesh gate on a track, sliding aside
//   service  (bank)      one steel door, hinged on the left, swinging inward
//   rollup   (warehouse) a corrugated shutter that rolls up
//   airlock  (lab)       two glass leaves sliding apart over a hazard-striped sill
//
// The two ways OUT built here are in the farthest dead end, facing the corridor: the museum's grand doors (pocket doors sliding apart on a bright glare) and
// the refinery's maintenance hatch (a ladder up to a hatch in a catwalk, behind a hazard barrier that lifts). The airlock, the truck and the vault door are lift
// shafts in another style (elevator.ts).

import * as THREE from 'three';
import { markBloom } from './postfx';
import { CELL, WALL_H, WALL_T, type WallBox } from './scene';
import type { Dir } from './security';
import type { ElevatorRig, ElevatorState } from './elevator';
import type { EntryKind } from './ways';

const FACING: Record<Dir, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };
const OPEN_HALF = 0.85; // half the doorway: 1.7 wide, like a room's
const DOOR_H = 2.5;
const WALL_Z = -CELL / 2; // the outer wall's centre plane, in the frame whose +Z goes into the building
const BACK_Z = -(CELL / 2 - WALL_T / 2); // a dead end's back wall, inner face
const DOOR_S = 1.0;

const mat = (color: number, o: { rough?: number; metal?: number; glow?: number; alpha?: number } = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.2, emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0, transparent: o.alpha !== undefined, opacity: o.alpha ?? 1, depthWrite: o.alpha === undefined });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A cell-centred frame turned to face `opens`, with the conversions the rest of the code needs between it and floor-local metres. */
function frame(cellX: number, cellY: number, opens: Dir) {
  const facing = FACING[opens];
  const group = new THREE.Group();
  group.position.set(cellX * CELL, 0, cellY * CELL);
  group.rotation.y = facing;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const toFloor = (x: number, z: number): { x: number; z: number } => ({ x: cellX * CELL + x * cos + z * sin, z: cellY * CELL - x * sin + z * cos });
  const toLocal = (x: number, z: number): { x: number; z: number } => {
    const dx = x - cellX * CELL;
    const dz = z - cellY * CELL;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const boxOf = (x0: number, x1: number, z0: number, z1: number): WallBox => {
    const a = toFloor(x0, z0);
    const b = toFloor(x1, z1);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  };
  return { facing, group, toFloor, toLocal, boxOf };
}

/** The readout over a doorway: a line of text in a colour, redrawn per state. */
function readoutPlane(group: THREE.Group, x: number, y: number, z: number, w: number, flip: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 56;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.2 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.25), m);
  plane.position.set(x, y, z);
  if (flip) plane.rotation.y = Math.PI;
  markBloom(plane);
  group.add(plane);
  return (text: string, color: string): void => {
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    tex.needsUpdate = true;
  };
}

const STATE_LOOK: Record<ElevatorState, { color: string; lamp: number }> = {
  locked: { color: '#ff4a4a', lamp: 0xff3b3b },
  ready: { color: '#5dff9a', lamp: 0x3dff84 },
  arrival: { color: '#ffc864', lamp: 0xffb347 },
  idle: { color: '#6a7480', lamp: 0x39414a },
};

const ENTRY_LOOK: Record<EntryKind, { wall: number; trim: number; sign: string }> = {
  lift: { wall: 0x5b6169, trim: 0x2a3038, sign: '▼' },
  doors: { wall: 0x6b4a44, trim: 0xb8965a, sign: 'STAFF' },
  gate: { wall: 0x4f5559, trim: 0xc2b13a, sign: 'GATE 1' },
  service: { wall: 0x4a3a2e, trim: 0xb08d4a, sign: 'STAFF ONLY' },
  rollup: { wall: 0x56606a, trim: 0xd8b02a, sign: 'BAY 2' },
  airlock: { wall: 0x8a9aa3, trim: 0x1f9a98, sign: 'AIRLOCK' },
};

/**
 * A doorway in the outer wall of the start cell (cellX, cellY), the agent starting outside it and `opens` pointing into the building. `label` is what the readout says
 * as the job starts. The returned rig works like a lift's, except `spawn` is outside, `front` is a little way inside, and `isOutside` means "out past the doors, into the building".
 */
export function buildEntryPortal(kind: Exclude<EntryKind, 'lift'>, cellX: number, cellY: number, opens: Dir): ElevatorRig {
  const { facing, group, toFloor, toLocal, boxOf } = frame(cellX, cellY, opens);
  const look = ENTRY_LOOK[kind];
  const T = WALL_T;
  const jamb = mat(look.wall, { rough: 0.8 });
  const trim = mat(look.trim, { rough: 0.45, metal: 0.55 });
  const dark = mat(0x1b1f24, { rough: 0.7 });

  // The wall's gap, filled: a jamb either side up to the wall's height, and a lintel over the doorway.
  const side = CELL / 2 + T / 2 - OPEN_HALF;
  for (const s of [-1, 1]) group.add(box(side, WALL_H, T, jamb, s * (OPEN_HALF + side / 2), WALL_H / 2, WALL_Z));
  group.add(box(OPEN_HALF * 2, WALL_H - DOOR_H, T, jamb, 0, DOOR_H + (WALL_H - DOOR_H) / 2, WALL_Z));
  for (const s of [-1, 1]) group.add(box(0.1, DOOR_H, T + 0.06, trim, s * (OPEN_HALF + 0.05), DOOR_H / 2, WALL_Z)); // door posts
  group.add(box(OPEN_HALF * 2 + 0.2, 0.08, T + 0.06, trim, 0, DOOR_H + 0.04, WALL_Z));

  // The doors.
  type Mover = (e: number) => void;
  let move: Mover = () => {};
  let slow = DOOR_S;
  switch (kind) {
    case 'doors': {
      const wood = mat(0x4a2f22, { rough: 0.55 });
      const brass = mat(0xb08d4a, { rough: 0.3, metal: 0.8 });
      const leaves = [-1, 1].map((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * OPEN_HALF, 0, WALL_Z);
        pivot.add(box(OPEN_HALF, DOOR_H, 0.07, wood, -s * (OPEN_HALF / 2), DOOR_H / 2, 0));
        for (const py of [0.8, 1.7]) pivot.add(box(OPEN_HALF - 0.2, 0.7, 0.03, brass, -s * (OPEN_HALF / 2), py, 0.04)); // brass panels
        pivot.add(box(0.05, 0.05, 0.14, brass, -s * (OPEN_HALF - 0.1), 1.1, 0.06)); // the pulls
        group.add(pivot);
        return { pivot, s };
      });
      for (const s of [-1, 1]) {
        const lamp = box(0.14, 0.14, 0.14, mat(0xffd9a0, { glow: 1.8 }), s * (OPEN_HALF + 0.45), 2.3, WALL_Z - T / 2 - 0.1);
        markBloom(lamp);
        group.add(lamp);
      }
      slow = 1.4;
      move = (e) => {
        for (const l of leaves) l.pivot.rotation.y = -l.s * e * 1.75;
      };
      break;
    }
    case 'service': {
      const steel = mat(0x56636e, { rough: 0.4, metal: 0.6 });
      const pivot = new THREE.Group();
      pivot.position.set(-OPEN_HALF, 0, WALL_Z);
      pivot.add(box(OPEN_HALF * 2, DOOR_H, 0.07, steel, OPEN_HALF, DOOR_H / 2, 0));
      pivot.add(box(OPEN_HALF * 1.2, 0.07, 0.1, trim, OPEN_HALF, 1.05, -0.06)); // the push bar, on the outside
      group.add(pivot);
      const keypad = box(0.16, 0.24, 0.04, mat(0x15181b), OPEN_HALF + 0.3, 1.3, WALL_Z - T / 2 - 0.02);
      group.add(keypad);
      const keys = box(0.1, 0.06, 0.02, mat(0x4ee08a, { glow: 1.6 }), OPEN_HALF + 0.3, 1.36, WALL_Z - T / 2 - 0.05);
      markBloom(keys);
      group.add(keys);
      const lamp = box(0.3, 0.1, 0.1, mat(0xffe0a8, { glow: 1.8 }), 0, 2.78, WALL_Z - T / 2 - 0.12);
      markBloom(lamp);
      group.add(lamp);
      move = (e) => {
        pivot.rotation.y = -e * 1.75;
      };
      break;
    }
    case 'gate': {
      // A mesh gate in front of the opening on a track: bars and cross-wires, a hazard top rail, sliding across the right-hand jamb.
      const gateGroup = new THREE.Group();
      gateGroup.position.set(0, 0, WALL_Z - T / 2 - 0.1);
      const bars = mat(0x8b9299, { rough: 0.5, metal: 0.7 });
      for (let x = -OPEN_HALF - 0.05; x <= OPEN_HALF + 0.06; x += 0.17) gateGroup.add(box(0.03, DOOR_H, 0.03, bars, x, DOOR_H / 2, 0));
      for (const y of [0.3, 0.9, 1.5, 2.1]) gateGroup.add(box(OPEN_HALF * 2 + 0.2, 0.03, 0.03, bars, 0, y, 0));
      for (let i = 0; i < 7; i++) gateGroup.add(box(0.2, 0.14, 0.05, mat(i % 2 ? 0x15181b : 0xc2b13a), -OPEN_HALF + 0.12 + i * 0.26, DOOR_H - 0.05, 0));
      group.add(gateGroup);
      group.add(box(OPEN_HALF * 2 + 2.6, 0.06, 0.06, bars, 0.9, DOOR_H + 0.12, WALL_Z - T / 2 - 0.1)); // the track
      const beacon = box(0.2, 0.2, 0.2, mat(0xff8a2a, { glow: 2.2 }), -OPEN_HALF - 0.25, 2.8, WALL_Z - T / 2 - 0.1);
      markBloom(beacon);
      group.add(beacon);
      move = (e) => {
        gateGroup.position.x = e * (OPEN_HALF * 2 + 0.3);
      };
      break;
    }
    case 'rollup': {
      const slat = mat(0x8a949f, { rough: 0.5, metal: 0.55 });
      const roller = new THREE.Group();
      roller.position.set(0, DOOR_H, WALL_Z);
      roller.add(box(OPEN_HALF * 2, DOOR_H, 0.05, slat, 0, -DOOR_H / 2, 0));
      for (let y = 0.18; y < DOOR_H; y += 0.18) roller.add(box(OPEN_HALF * 2, 0.025, 0.07, dark, 0, -y, 0));
      roller.add(box(OPEN_HALF * 2, 0.09, 0.1, mat(0xd8b02a), 0, -DOOR_H + 0.045, 0));
      group.add(roller);
      group.add(box(OPEN_HALF * 2 + 0.3, 0.3, 0.3, trim, 0, DOOR_H + 0.15, WALL_Z - T / 2 - 0.1)); // the drum, over the door
      for (const s of [-1, 1]) {
        const lamp = box(0.12, 0.3, 0.12, mat(0xffb04a, { glow: 1.8 }), s * (OPEN_HALF + 0.35), 2.5, WALL_Z - T / 2 - 0.1);
        markBloom(lamp);
        group.add(lamp);
      }
      move = (e) => {
        roller.scale.y = 1 - 0.97 * e;
      };
      break;
    }
    case 'airlock': {
      const glass = mat(0x9fe8f0, { rough: 0.1, metal: 0.3, alpha: 0.4, glow: 0.25 });
      const leaves = [-1, 1].map((s) => {
        const leaf = new THREE.Group();
        leaf.add(box(OPEN_HALF, DOOR_H, 0.05, glass, 0, DOOR_H / 2, 0));
        leaf.add(box(0.05, DOOR_H, 0.07, trim, -s * (OPEN_HALF / 2 - 0.02), DOOR_H / 2, 0));
        leaf.position.set(s * (OPEN_HALF / 2), 0, WALL_Z - T / 2 - 0.06);
        group.add(leaf);
        return { leaf, s };
      });
      // The hazard-striped sill, and a cyan strip over the doors.
      for (let i = -4; i <= 4; i++) group.add(box(0.13, 0.02, 0.5, mat(i % 2 ? 0x15181b : 0xd8b02a), i * 0.2, 0.012, WALL_Z - T / 2 - 0.3));
      const strip = box(OPEN_HALF * 2, 0.05, 0.05, mat(0x6ff5e6, { glow: 1.8 }), 0, DOOR_H + 0.18, WALL_Z - T / 2 - 0.05);
      markBloom(strip);
      group.add(strip);
      move = (e) => {
        for (const l of leaves) l.leaf.position.x = l.s * (OPEN_HALF / 2 + e * OPEN_HALF);
      };
      break;
    }
  }

  // The sign over the doors, outside, and a light that comes on over them.
  const say = readoutPlane(group, 0, DOOR_H + 0.55, WALL_Z - T / 2 - 0.02, 1.1, true);
  const lampLight = new THREE.PointLight(0xfff1dc, 1.4, 6);
  lampLight.userData.keepInDark = true; // the way in runs on its own supply: blackouts leave it lit
  lampLight.position.set(0, 2.6, WALL_Z - 0.9);
  group.add(lampLight);
  const dot = box(0.1, 0.1, 0.04, mat(0x39414a, { glow: 2 }), OPEN_HALF + 0.3, 1.0, WALL_Z - T / 2 - 0.03);
  markBloom(dot);
  group.add(dot);

  const boxes: WallBox[] = [boxOf(-CELL / 2 - T / 2, -OPEN_HALF, WALL_Z - T / 2, WALL_Z + T / 2), boxOf(OPEN_HALF, CELL / 2 + T / 2, WALL_Z - T / 2, WALL_Z + T / 2)];
  const doorBox = boxOf(-OPEN_HALF, OPEN_HALF, WALL_Z - T / 2, WALL_Z + T / 2);
  const spawnPt = toFloor(0, WALL_Z - 1.5);
  const frontPt = toFloor(0, WALL_Z + 1.6);
  let open = false;
  let slide = 0;
  const rig: ElevatorRig = {
    group,
    boxes,
    doorBox,
    spawn: { x: spawnPt.x, z: spawnPt.z, facing },
    front: frontPt,
    contains: () => false,
    isOutside: (x, z) => toLocal(x, z).z > WALL_Z + 1.2,
    setOpen(next) {
      open = next;
    },
    isOpen: () => open,
    setState(state, label) {
      const l = STATE_LOOK[state];
      say(label ?? look.sign, state === 'arrival' || state === 'idle' ? l.color : l.color);
      (dot.material as THREE.MeshStandardMaterial).emissive.setHex(l.lamp);
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (slide === target) return;
      slide = open ? Math.min(1, slide + dt / slow) : Math.max(0, slide - dt / slow);
      const e = slide * slide * (3 - 2 * slide);
      move(e);
      lampLight.intensity = 1.4 + e * 4;
    },
  };
  rig.setState('arrival', look.sign);
  return rig;
}

/**
 * The museum's way out: a pair of tall pocket doors in the dead end's back wall, in a stone frame; shut they hide the glare of the street behind them, open they slide apart
 * on it. `contains` is the spot in front of them.
 */
export function buildExitDoors(cellX: number, cellY: number, opens: Dir): ElevatorRig {
  const { facing, group, toFloor, toLocal, boxOf } = frame(cellX, cellY, opens);
  const stone = mat(0xcfc7b8, { rough: 0.7 });
  const gold = mat(0xb8965a, { rough: 0.3, metal: 0.8 });
  const wood = mat(0x4a2f22, { rough: 0.55 });
  const z0 = BACK_Z + 0.05;
  // The glare behind: a bright panel and a warm light, only seen when the doors part.
  const glare = box(OPEN_HALF * 2, DOOR_H, 0.03, mat(0xfff2d0, { glow: 2.2 }), 0, DOOR_H / 2, z0 - 0.02);
  markBloom(glare);
  group.add(glare);
  const glow = new THREE.PointLight(0xffe6b8, 0, 7);
  glow.userData.keepInDark = true;
  glow.position.set(0, 1.6, z0 + 0.6);
  group.add(glow);
  // A frame: two fluted columns, a lintel with gold, and steps' worth of plinth.
  for (const s of [-1, 1]) {
    group.add(box(0.34, DOOR_H + 0.3, 0.34, stone, s * (OPEN_HALF + 0.22), (DOOR_H + 0.3) / 2, z0 + 0.15));
    group.add(box(0.4, 0.14, 0.4, gold, s * (OPEN_HALF + 0.22), 0.07, z0 + 0.15));
    group.add(box(0.4, 0.14, 0.4, gold, s * (OPEN_HALF + 0.22), DOOR_H + 0.28, z0 + 0.15));
  }
  group.add(box(OPEN_HALF * 2 + 0.9, 0.3, 0.4, stone, 0, DOOR_H + 0.15, z0 + 0.15));
  group.add(box(OPEN_HALF * 2 + 0.9, 0.06, 0.42, gold, 0, DOOR_H + 0.02, z0 + 0.16));
  // The doors: two wood slabs with brass panels, sliding apart behind the columns.
  const slabs = [-1, 1].map((s) => {
    const slab = new THREE.Group();
    slab.add(box(OPEN_HALF, DOOR_H, 0.06, wood, 0, DOOR_H / 2, 0));
    slab.add(box(OPEN_HALF - 0.2, 0.7, 0.03, gold, 0, 0.8, 0.045));
    slab.add(box(OPEN_HALF - 0.2, 0.7, 0.03, gold, 0, 1.7, 0.045));
    slab.position.set(s * (OPEN_HALF / 2), 0, z0 + 0.1);
    group.add(slab);
    return { slab, s };
  });
  const say = readoutPlane(group, 0, DOOR_H + 0.5, z0 + 0.37, 1.1, false);
  const boxes: WallBox[] = [boxOf(-OPEN_HALF - 0.4, -OPEN_HALF - 0.05, z0, z0 + 0.32), boxOf(OPEN_HALF + 0.05, OPEN_HALF + 0.4, z0, z0 + 0.32)];
  const doorBox = boxOf(-OPEN_HALF, OPEN_HALF, z0, z0 + 0.3);
  const spawnPt = toFloor(0, BACK_Z + 0.9);
  const frontPt = toFloor(0, BACK_Z + 1.6);
  let open = false;
  let slide = 0;
  return {
    group,
    boxes,
    doorBox,
    spawn: { x: spawnPt.x, z: spawnPt.z, facing },
    front: frontPt,
    contains(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) < OPEN_HALF + 0.3 && p.z < BACK_Z + 1.4 && p.z > BACK_Z;
    },
    isOutside: (x, z) => toLocal(x, z).z > BACK_Z + 1.5,
    setOpen(next) {
      open = next;
    },
    isOpen: () => open,
    setState(state, label) {
      say(label ?? (state === 'ready' ? 'EXIT' : 'LOCKED'), STATE_LOOK[state].color);
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (slide === target) return;
      slide = open ? Math.min(1, slide + dt / 1.2) : Math.max(0, slide - dt / 1.2);
      const e = slide * slide * (3 - 2 * slide);
      for (const l of slabs) l.slab.position.x = l.s * (OPEN_HALF / 2 + e * (OPEN_HALF + 0.35));
      glow.intensity = e * 6;
    },
  };
}

/**
 * The refinery's way out: a maintenance ladder up the dead end's back wall to a hatch in a catwalk overhead, behind a hazard barrier across the cell that lifts when the hatch
 * is open. `contains` is the ladder's foot, behind the barrier.
 */
export function buildExitHatch(cellX: number, cellY: number, opens: Dir): ElevatorRig {
  const { facing, group, toFloor, toLocal, boxOf } = frame(cellX, cellY, opens);
  const steel = mat(0x4a5058, { rough: 0.45, metal: 0.65 });
  const hazard = [mat(0xd8b02a, { rough: 0.6 }), mat(0x15181b, { rough: 0.7 })];
  const rungMat = mat(0x8b9299, { rough: 0.4, metal: 0.7 });
  const BARRIER_Z = 0.3;
  const z0 = BACK_Z + 0.12;
  // The ladder: two rails and rungs up past the wall's top.
  const topY = WALL_H + 0.5;
  for (const s of [-1, 1]) group.add(box(0.05, topY, 0.05, rungMat, s * 0.3, topY / 2, z0));
  for (let y = 0.3; y < topY; y += 0.3) group.add(box(0.6, 0.035, 0.035, rungMat, 0, y, z0));
  // The catwalk and its hatch, overhead.
  const plateY = WALL_H + 0.45;
  for (const [x, z, w, d] of [
    [-0.9, z0 + 0.25, 0.6, 1.3],
    [0.9, z0 + 0.25, 0.6, 1.3],
    [0, z0 + 0.7, 1.2, 0.4],
  ] as const) group.add(box(w, 0.08, d, steel, x, plateY, z));
  const lid = new THREE.Group();
  lid.position.set(0, plateY, z0 - 0.12);
  lid.add(box(1.2, 0.07, 0.62, mat(0x6a7078, { rough: 0.4, metal: 0.7 }), 0, 0.01, 0.34));
  group.add(lid);
  const glare = box(1.1, 0.02, 0.55, mat(0xdff4ff, { glow: 2.4 }), 0, plateY + 0.02, z0 + 0.22);
  markBloom(glare);
  glare.visible = false;
  group.add(glare);
  const glow = new THREE.PointLight(0xdff4ff, 0, 6);
  glow.userData.keepInDark = true;
  glow.position.set(0, 2.6, z0 + 0.5);
  group.add(glow);
  // The barrier: a striped arm across the cell, pivoting up at the left wall.
  const arm = new THREE.Group();
  arm.position.set(-CELL / 2 + 0.2, 1.0, BARRIER_Z);
  for (let i = 0; i < 9; i++) arm.add(box(0.36, 0.14, 0.1, hazard[i % 2]!, 0.2 + i * 0.36, 0, 0));
  group.add(arm);
  for (const s of [-1, 1]) group.add(box(0.14, 1.2, 0.14, steel, s * (CELL / 2 - 0.2), 0.6, BARRIER_Z));
  const lamp = box(0.16, 0.16, 0.16, mat(0xff3b3b, { glow: 2.2 }), -CELL / 2 + 0.2, 1.3, BARRIER_Z);
  markBloom(lamp);
  group.add(lamp);
  const boxes: WallBox[] = [boxOf(-CELL / 2 + 0.13, -CELL / 2 + 0.27, BARRIER_Z - 0.07, BARRIER_Z + 0.07), boxOf(CELL / 2 - 0.27, CELL / 2 - 0.13, BARRIER_Z - 0.07, BARRIER_Z + 0.07)];
  const doorBox = boxOf(-CELL / 2 + 0.2, CELL / 2 - 0.2, BARRIER_Z - 0.1, BARRIER_Z + 0.1);
  const spawnPt = toFloor(0, BARRIER_Z - 0.9);
  const frontPt = toFloor(0, BARRIER_Z + 1.3);
  const say = readoutPlane(group, 0, 2.55, BARRIER_Z + 0.05, 0.9, false);
  let open = false;
  let slide = 0;
  return {
    group,
    boxes,
    doorBox,
    spawn: { x: spawnPt.x, z: spawnPt.z, facing },
    front: frontPt,
    contains(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) < 0.9 && p.z < BARRIER_Z - 0.3 && p.z > BACK_Z;
    },
    isOutside: (x, z) => toLocal(x, z).z > BARRIER_Z + 0.8,
    setOpen(next) {
      open = next;
    },
    isOpen: () => open,
    setState(state, label) {
      say(label ?? (state === 'ready' ? '▲ UP' : 'BARRED'), STATE_LOOK[state].color);
      (lamp.material as THREE.MeshStandardMaterial).emissive.setHex(state === 'ready' ? 0x3dff84 : 0xff3b3b);
      (lamp.material as THREE.MeshStandardMaterial).color.setHex(state === 'ready' ? 0x3dff84 : 0xff3b3b);
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (slide === target) return;
      slide = open ? Math.min(1, slide + dt / 1.1) : Math.max(0, slide - dt / 1.1);
      const e = slide * slide * (3 - 2 * slide);
      arm.rotation.z = e * 1.45;
      lid.rotation.x = -e * 1.6;
      glare.visible = e > 0.3;
      glow.intensity = e * 5;
    },
  };
}
