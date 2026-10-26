// The meshes for the stealth props placed by props.ts: a staff locker the
// player can step into, and a vent grille at the foot of a wall. Both are
// built in a local frame facing +Z (out into the cell) and returned with the
// floor-local spot the player stands on to use them.

import * as THREE from 'three';
import { CELL, WALL_T, type WallBox } from './scene';
import { markBloom } from './postfx';
import type { HideSkin } from './hideouts';

type Dir = 'N' | 'S' | 'E' | 'W';

/** Rotation that turns the local +Z front to face away from `wall`, into the cell. */
const FACE_AWAY: Record<Dir, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

const W = 0.7;
const D = 0.55;
const H = 2;
const STEEL = 0x5f6975;

export type StaffLockerRig = {
  group: THREE.Group;
  box: WallBox;
  /** Floor-local spot in front of the door, and the facing out of it (the way the player steps out). */
  front: { x: number; z: number; facing: number };
  /** Swings the door open for a moment (stepping in or out). */
  flap: () => void;
  /** Holds the door `amount` open (0 shut, 1 wide) — for putting a body away; overrides a flap. */
  setOpen: (amount: number | null) => void;
  update: (dt: number) => void;
};

function panel(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A tall staff locker standing against `wall` of cell (x, y). */
export function buildStaffLocker(x: number, y: number, wall: Dir, skin?: HideSkin['locker']): StaffLockerRig {
  const [dx, dy] = DELTA[wall];
  const back = CELL / 2 - WALL_T / 2 - D / 2 - 0.02;
  const cx = x * CELL + dx * back;
  const cz = y * CELL + dy * back;
  const group = new THREE.Group();
  group.position.set(cx, 0, cz);
  group.rotation.y = FACE_AWAY[wall];

  const steel = new THREE.MeshStandardMaterial({ color: skin?.door ?? STEEL, roughness: 0.5, metalness: skin?.glass ? 0.2 : 0.55 });
  const trim = new THREE.MeshStandardMaterial({ color: skin?.trim ?? STEEL, roughness: 0.4, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.7 });
  group.add(panel(W, H, D, dark, 0, H / 2, 0)); // the shell (dark inside shows when the door opens)
  group.add(panel(W, 0.04, D, trim, 0, H, 0));
  for (const side of [-1, 1]) group.add(panel(0.03, H, D, trim, (side * W) / 2, H / 2, 0));

  // The door, hinged on its left edge, with vent slots.
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2, 0, D / 2);
  const door = panel(W - 0.02, H - 0.06, 0.03, steel, (W - 0.02) / 2, H / 2, 0);
  hinge.add(door);
  for (let i = 0; i < 5; i++) hinge.add(panel(W * 0.5, 0.02, 0.012, dark, W / 2, H - 0.3 - i * 0.07, 0.02));
  hinge.add(panel(0.03, 0.18, 0.04, skin ? trim : dark, W - 0.1, H / 2, 0.03)); // handle
  if (skin) {
    // The place's own look: bands of trim at the head and foot of the door, a painted stripe, a lit window.
    hinge.add(panel(W - 0.02, 0.05, 0.04, trim, (W - 0.02) / 2, H - 0.12, 0.012));
    hinge.add(panel(W - 0.02, 0.05, 0.04, trim, (W - 0.02) / 2, 0.14, 0.012));
    if (skin.stripe) hinge.add(panel(W - 0.04, 0.18, 0.012, new THREE.MeshStandardMaterial({ color: skin.stripe, roughness: 0.6 }), (W - 0.02) / 2, H * 0.52, 0.02));
    if (skin.glass) {
      const win = panel(W * 0.46, 0.55, 0.012, new THREE.MeshStandardMaterial({ color: skin.glass, emissive: skin.glass, emissiveIntensity: 0.9, transparent: true, opacity: 0.75, roughness: 0.1 }), W / 2, H * 0.66, 0.022);
      markBloom(win);
      hinge.add(win);
    }
  }
  group.add(hinge);

  // Local +Z is into the cell; the front spot is just past the door.
  const [fx, fz] = [-dx, -dy];
  const front = { x: cx + fx * (D / 2 + 0.55), z: cz + fz * (D / 2 + 0.55), facing: Math.atan2(fx, fz) };
  const alongX = dx === 0;
  const box: WallBox = alongX
    ? { minX: cx - W / 2, maxX: cx + W / 2, minZ: cz - D / 2, maxZ: cz + D / 2, cover: 'tall' }
    : { minX: cx - D / 2, maxX: cx + D / 2, minZ: cz - W / 2, maxZ: cz + W / 2, cover: 'tall' };

  let swing = 0; // 0 → 1 → 0 over one flap
  let flapping = false;
  let held: number | null = null;
  return {
    group,
    box,
    front,
    flap() {
      flapping = true;
      swing = 0;
    },
    setOpen(amount: number | null) {
      held = amount;
      if (amount !== null) hinge.rotation.y = -amount * 1.6;
    },
    update(dt: number) {
      if (!flapping || held !== null) return;
      swing = Math.min(1, swing + dt / 0.7);
      hinge.rotation.y = -Math.sin(swing * Math.PI) * 1.6;
      if (swing >= 1) flapping = false;
    },
  };
}

export type VentRig = {
  group: THREE.Group;
  /** Lifts the grille off its frame: 0 on, 1 swung out and up (putting a body in). */
  setOpen: (amount: number) => void;
  /** Floor-local spot in front of the grille, facing it (the way into the vent). */
  stand: { x: number; z: number; facing: number };
};

/** A crawl-through grille at the foot of `side` wall of cell (x, y), on the cell's side of it. */
export function buildVentGrille(x: number, y: number, side: Dir, skin?: HideSkin['vent']): VentRig {
  const [dx, dy] = DELTA[side];
  const face = CELL / 2 - WALL_T / 2 - 0.01;
  const gx = x * CELL + dx * face;
  const gz = y * CELL + dy * face;
  const group = new THREE.Group();
  group.position.set(gx, 0, gz);
  group.rotation.y = FACE_AWAY[side];
  const frame = new THREE.MeshStandardMaterial({ color: skin?.frame ?? 0x3b424b, roughness: 0.5, metalness: 0.5 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1 });
  group.add(panel(0.92, 0.56, 0.02, hole, 0, 0.3, 0.005));
  if (skin?.glow) {
    const lit = panel(0.84, 0.48, 0.01, new THREE.MeshStandardMaterial({ color: skin.glow, emissive: skin.glow, emissiveIntensity: 1.1, roughness: 0.6 }), 0, 0.3, 0.012);
    markBloom(lit);
    group.add(lit);
  }
  // The grille (frame and slats) hangs from its top edge so it can swing out and up.
  const grille = new THREE.Group();
  grille.position.y = 0.6;
  for (const [w, h, px, py] of [
    [0.98, 0.05, 0, 0.6],
    [0.98, 0.05, 0, 0.02],
    [0.05, 0.6, -0.47, 0.3],
    [0.05, 0.6, 0.47, 0.3],
  ] as const) {
    grille.add(panel(w, h, 0.04, frame, px, py - 0.6, 0.02));
  }
  for (let i = 0; i < 6; i++) grille.add(panel(0.9, 0.025, 0.03, frame, 0, 0.1 + i * 0.085 - 0.6, 0.025));
  group.add(grille);
  const stand = { x: x * CELL + dx * (face - 0.75), z: y * CELL + dy * (face - 0.75), facing: Math.atan2(dx, dy) };
  return { group, stand, setOpen: (amount: number) => { grille.rotation.x = amount * 1.45; } };
}
