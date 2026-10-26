// Elevators — how a job begins and ends. Each is a freestanding steel shaft
// against the back wall of its cell, doors facing the way out: the exit lift
// sits in the job's farthest dead end, locked (red readout, doors shut)
// until every document is recovered; the arrival lift stands in the start
// cell and lets the player out at the beginning of each job.
//
// Local frame: the doors face +Z; the shaft runs back to the cell's back
// wall at -Z. Built in cell-centred local space and placed into the floor
// group; collision boxes are returned in floor-local space (the caller
// offsets them by the floor's origin, like every other placement module).

import * as THREE from 'three';
import { markBloom } from './postfx';
import { CELL, WALL_H, WALL_T, type WallBox } from './scene';
import type { Dir } from './security';

const BACK_Z = -(CELL / 2 - WALL_T / 2); // the cell wall's inner face
const FRONT_Z = 0.1;
const HALF_W = 1.5; // side walls' centre lines
const SIDE_T = 0.16;
const OPEN_HALF = 0.7; // half the doorway: doors are 0.7 wide each
const DOOR_H = 2.45;
const DOOR_T = 0.06;
const SHAFT_H = WALL_H + 0.3;
const DOOR_S = 0.9; // seconds to slide open or shut
const STEEL = 0x8a949f;
const TRIM = 0x2a3038;

export type ElevatorState = 'locked' | 'ready' | 'arrival' | 'idle';

/**
 * How a lift-shaped way out looks. The freight lift is the default; the same shaft, doors and readout make an airlock (white, glass doors, cyan light), a
 * truck's trailer backed into a bay (white sides, a roll-up door) or a vault door (dark, heavy, riveted, with a wheel on it).
 */
export type LiftStyle = {
  shaft: number;
  steel: number;
  door: number;
  /** Doors slide apart (a lift, an airlock, a vault) or one panel rolls up (a trailer). */
  motion: 'slide' | 'roll';
  glass?: boolean;
  panel: number;
  light: number;
  /** What the readout says when it opens, in place of '▲ EXIT'. */
  ready: string;
  /** Extra dressing: hazard stripes on the floor, rivets and a wheel, wheels and tail lights, corrugation. */
  dress?: 'hazard' | 'vault' | 'trailer';
};

export const LIFT_STYLE: LiftStyle = { shaft: TRIM, steel: STEEL, door: 0xa9b3bd, motion: 'slide', panel: 0xd8e6f0, light: 0xfff1dc, ready: '▲ EXIT' };
export const AIRLOCK_STYLE: LiftStyle = { shaft: 0xdfe8ec, steel: 0xe4ecef, door: 0x9fe8f0, motion: 'slide', glass: true, panel: 0x9ff0ff, light: 0xbff6ff, ready: '◉ CLEAR', dress: 'hazard' };
export const TRUCK_STYLE: LiftStyle = { shaft: 0xe6e6de, steel: 0xcfcfc8, door: 0xb6bbc0, motion: 'roll', panel: 0xf2ecd8, light: 0xfff0c0, ready: '▲ LOAD', dress: 'trailer' };
export const VAULT_STYLE: LiftStyle = { shaft: 0x20252a, steel: 0x4a525a, door: 0x39414a, motion: 'slide', panel: 0xffe0a8, light: 0xffe0a8, ready: '▲ OPEN', dress: 'vault' };

export type ElevatorRig = {
  group: THREE.Group;
  /** Always-solid parts (side walls, door jambs), floor-local. */
  boxes: WallBox[];
  /** Fills the doorway while the doors are shut, floor-local. */
  doorBox: WallBox;
  /** Where to stand the player inside the cab, floor-local, facing out. */
  spawn: { x: number; z: number; facing: number };
  /** The point just outside the doors, floor-local — where "at the lift" is measured from. */
  front: { x: number; z: number };
  /** Whether a floor-local point is inside the cab. */
  contains: (x: number, z: number) => boolean;
  /** Whether a floor-local point is out past the doors. */
  isOutside: (x: number, z: number) => boolean;
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  setState: (state: ElevatorState, label?: string) => void;
  update: (dt: number) => void;
};

/** Facing angle (0 = +Z, as everywhere else) for doors opening toward `dir`. */
const FACING: Record<Dir, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function drawReadout(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = '#07090c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
}

const READOUT: Record<ElevatorState, { text: string; color: string; button: number }> = {
  locked: { text: '✕ LOCKED', color: '#ff4a4a', button: 0xff3b3b },
  ready: { text: '▲ EXIT', color: '#5dff9a', button: 0x3dff84 },
  arrival: { text: '▼', color: '#ffc864', button: 0xffb347 },
  idle: { text: '— —', color: '#6a7480', button: 0x39414a },
};

/** Builds a lift (or, in another `style`, an airlock, a trailer or a vault door) in cell (cellX, cellY) whose doors open toward `opens`. */
export function buildElevator(cellX: number, cellY: number, opens: Dir, style: LiftStyle = LIFT_STYLE): ElevatorRig {
  const facing = FACING[opens];
  const group = new THREE.Group();
  group.position.set(cellX * CELL, 0, cellY * CELL);
  group.rotation.y = facing;

  const steel = new THREE.MeshStandardMaterial({ color: style.steel, roughness: 0.35, metalness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: style.shaft, roughness: 0.6, metalness: 0.4 });
  const depth = FRONT_Z - BACK_Z;
  const midZ = (FRONT_Z + BACK_Z) / 2;

  // Shaft: two side walls up to a little above the maze walls, a header
  // above the doors, and brushed-steel jambs either side of the doorway.
  for (const side of [-1, 1]) {
    group.add(box(SIDE_T, SHAFT_H, depth, trim, side * HALF_W, SHAFT_H / 2, midZ));
    const jambW = HALF_W + SIDE_T / 2 - OPEN_HALF;
    group.add(box(jambW, DOOR_H, 0.12, steel, side * (OPEN_HALF + jambW / 2), DOOR_H / 2, FRONT_Z - 0.06));
  }
  group.add(box(HALF_W * 2 + SIDE_T, SHAFT_H - DOOR_H, 0.14, trim, 0, DOOR_H + (SHAFT_H - DOOR_H) / 2, FRONT_Z - 0.07));

  // Cab: a ribbed floor plate, a lit back panel, and a ceiling light that
  // brightens whenever the doors open.
  const cabFloor = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 });
  group.add(box(HALF_W * 2 - SIDE_T, 0.04, depth - 0.1, cabFloor, 0, 0.02, midZ - 0.05));
  for (let i = -3; i <= 3; i++) group.add(box(0.03, 0.012, depth - 0.2, trim, i * 0.36, 0.045, midZ - 0.05));
  const panelMat = new THREE.MeshStandardMaterial({ color: style.panel, emissive: style.panel, emissiveIntensity: 0.25 });
  const panel = box(HALF_W * 2 - 0.5, 1.6, 0.03, panelMat, 0, 1.35, BACK_Z + 0.03);
  markBloom(panel);
  group.add(panel);
  group.add(box(HALF_W * 2 - 0.5, 0.05, 0.08, steel, 0, 0.95, BACK_Z + 0.08)); // handrail
  const cabLight = new THREE.PointLight(style.light, 1.2, 5);
  cabLight.userData.keepInDark = true; // the lifts run on their own supply: blackouts and cut breakers leave them lit
  cabLight.position.set(0, 2.6, midZ);
  group.add(cabLight);

  // Doors: two brushed panels meeting in the middle, sliding into the side walls (or one panel rolling up, for a trailer).
  const doorMat = new THREE.MeshStandardMaterial(
    style.glass
      ? { color: style.door, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.4, emissive: style.door, emissiveIntensity: 0.25, depthWrite: false }
      : { color: style.door, roughness: style.motion === 'roll' ? 0.55 : 0.25, metalness: style.motion === 'roll' ? 0.35 : 0.85 }
  );
  const doors: Array<{ group: THREE.Group; side: number }> = [];
  let roller: THREE.Group | null = null;
  if (style.motion === 'roll') {
    // A roll-up door: slats, hanging from a pivot at the top of the doorway, that gather upward as it opens.
    roller = new THREE.Group();
    roller.position.set(0, DOOR_H, FRONT_Z - 0.14);
    const panelBody = box(OPEN_HALF * 2, DOOR_H, DOOR_T, doorMat, 0, -DOOR_H / 2, 0);
    roller.add(panelBody);
    for (let y = 0.2; y < DOOR_H; y += 0.2) roller.add(box(OPEN_HALF * 2, 0.025, DOOR_T + 0.01, trim, 0, -y, 0));
    roller.add(box(OPEN_HALF * 2, 0.08, DOOR_T + 0.03, steel, 0, -DOOR_H + 0.04, 0.01)); // the bottom bar
    group.add(roller);
  } else {
    for (const side of [-1, 1]) {
      const d = new THREE.Group();
      d.add(box(OPEN_HALF, DOOR_H, DOOR_T, doorMat, 0, DOOR_H / 2, 0));
      d.add(box(0.02, DOOR_H - 0.1, DOOR_T + 0.01, trim, -side * (OPEN_HALF / 2 - 0.01), DOOR_H / 2, 0)); // the seam
      if (style.dress === 'vault') {
        // Heavy steel: rows of rivets, and half of the big wheel on each leaf.
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) d.add(box(0.05, 0.05, 0.05, steel, -side * (0.12 + c * 0.2), 0.35 + r * 0.55, DOOR_T / 2 + 0.02));
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.3, metalness: 0.8 }));
        wheel.position.set(-side * 0.02, 1.25, DOOR_T / 2 + 0.03);
        wheel.rotation.z = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        d.add(wheel);
      }
      d.position.set(side * (OPEN_HALF / 2), 0, FRONT_Z - 0.14);
      group.add(d);
      doors.push({ group: d, side });
    }
  }
  // The rest of the dressing.
  if (style.dress === 'hazard') {
    for (let i = -4; i <= 4; i++) group.add(box(0.14, 0.014, 0.5, new THREE.MeshStandardMaterial({ color: i % 2 ? 0x15181b : 0xd8b02a, roughness: 0.7 }), i * 0.3, 0.05, FRONT_Z - 0.25));
    const strip = box(HALF_W * 2 - 0.4, 0.04, 0.04, new THREE.MeshStandardMaterial({ color: 0x6ff5e6, emissive: 0x6ff5e6, emissiveIntensity: 1.6 }), 0, SHAFT_H - 0.3, BACK_Z + 0.2);
    markBloom(strip);
    group.add(strip);
  }
  if (style.dress === 'trailer') {
    // Wheels under the trailer's rear, a bumper, and red tail lights either side of the doorway.
    const tyre = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), tyre);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * (HALF_W + 0.12), 0.42, FRONT_Z - 0.9);
      group.add(w);
      const tail = box(0.1, 0.34, 0.05, new THREE.MeshStandardMaterial({ color: 0xff2a1f, emissive: 0xff2a1f, emissiveIntensity: 1.8 }), side * (HALF_W - 0.1), 0.7, FRONT_Z + 0.02);
      markBloom(tail);
      group.add(tail);
    }
    group.add(box(HALF_W * 2 + 0.2, 0.14, 0.14, steel, 0, 0.3, FRONT_Z + 0.05));
  }

  // Floor readout over the doors, and a call button beside them.
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 56;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const readoutMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.2 });
  const readouts: Record<ElevatorState, { text: string; color: string; button: number }> = { ...READOUT, ready: { ...READOUT.ready, text: style.ready } };
  const readout = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.32), readoutMat);
  readout.position.set(0, DOOR_H + 0.42, FRONT_Z + 0.005);
  markBloom(readout);
  group.add(readout);
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b3b, emissiveIntensity: 2 });
  const button = box(0.09, 0.09, 0.03, buttonMat, OPEN_HALF + 0.3, 1.2, FRONT_Z + 0.015);
  markBloom(button);
  group.add(button);
  group.add(box(0.2, 0.34, 0.02, trim, OPEN_HALF + 0.3, 1.2, FRONT_Z + 0.002));

  // Local → floor-local, for points and boxes (rotations are right angles, so boxes stay axis-aligned).
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const toFloor = (x: number, z: number): { x: number; z: number } => ({
    x: cellX * CELL + x * cos + z * sin,
    z: cellY * CELL - x * sin + z * cos,
  });
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
  const boxes: WallBox[] = [];
  for (const side of [-1, 1]) {
    const inner = HALF_W - SIDE_T / 2;
    const outer = HALF_W + SIDE_T / 2;
    boxes.push(side < 0 ? boxOf(-outer, -inner, BACK_Z, FRONT_Z) : boxOf(inner, outer, BACK_Z, FRONT_Z));
    boxes.push(side < 0 ? boxOf(-outer, -OPEN_HALF, FRONT_Z - 0.14, FRONT_Z) : boxOf(OPEN_HALF, outer, FRONT_Z - 0.14, FRONT_Z));
  }
  // The back of the cab: shut, so the only way out of it is the door (on a storey with no wall of its own behind it, as a tower's).
  boxes.push(boxOf(-(HALF_W + SIDE_T / 2), HALF_W + SIDE_T / 2, BACK_Z - 0.14, BACK_Z));
  const doorBox = boxOf(-OPEN_HALF, OPEN_HALF, FRONT_Z - 0.2, FRONT_Z);

  const spawnPt = toFloor(0, midZ);
  const frontPt = toFloor(0, FRONT_Z + 0.9);
  let open = false;
  let slide = 0; // 0 shut → 1 open

  const rig: ElevatorRig = {
    group,
    boxes,
    doorBox,
    spawn: { x: spawnPt.x, z: spawnPt.z, facing },
    front: frontPt,
    contains(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) < HALF_W - 0.2 && p.z < FRONT_Z - 0.45 && p.z > BACK_Z;
    },
    isOutside(x, z) {
      return toLocal(x, z).z > FRONT_Z + 0.5;
    },
    setOpen(next) {
      open = next;
    },
    isOpen: () => open,
    setState(state, label) {
      const r = readouts[state];
      drawReadout(ctx, label ?? r.text, r.color);
      tex.needsUpdate = true;
      buttonMat.emissive.setHex(r.button);
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (slide === target) return;
      slide = open ? Math.min(1, slide + dt / DOOR_S) : Math.max(0, slide - dt / DOOR_S);
      const e = slide * slide * (3 - 2 * slide);
      for (const d of doors) d.group.position.x = d.side * (OPEN_HALF / 2 + e * OPEN_HALF);
      if (roller) roller.scale.y = 1 - 0.97 * e;
      cabLight.intensity = 1.2 + e * 5;
      panelMat.emissiveIntensity = 0.25 + e * 0.45;
    },
  };
  rig.setState('locked');
  return rig;
}
