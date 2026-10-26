// The other two ways in (entries.ts): the roof hatch, a ladder up the back
// wall of a dead end into a square of night sky, beside the junction box
// where the building's uplink line can be cut; and the service-tunnel
// grate, lifted aside in the floor. Built from primitives in a dead end's
// own frame (+Z out through its opening), like rooms.ts, and added to the
// floor's group, so positions are floor-local.

import * as THREE from 'three';
import { CELL, WALL_H, WALL_T } from './scene';
import { markBloom } from './postfx';
import type { Dir } from './security';

const YAW: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
const BACK = -(CELL / 2 - WALL_T / 2);
const SIDE = CELL / 2 - WALL_T / 2;
const METAL = 0x4a4f57;
const LINE_LIVE = 0x4ee08a;
const LINE_CUT = 0x3a4a5a;

/** Floor-local position of a point given in a dead end's own frame. */
function toFloor(x: number, y: number, openDir: Dir, lx: number, lz: number): { x: number; z: number } {
  const a = YAW[openDir];
  return { x: x * CELL + lx * Math.cos(a) + lz * Math.sin(a), z: y * CELL - lx * Math.sin(a) + lz * Math.cos(a) };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export type RoofHatchRig = {
  group: THREE.Group;
  /** Where the player lands, facing the ladder they came down, so the camera looks in from the corridor (floor-local). */
  spawn: { x: number; z: number; facing: number };
  /** Where to stand to cut the uplink's line at the junction box (floor-local). */
  junction: { x: number; z: number };
  setCut: (cut: boolean) => void;
};

/** The roof hatch in dead end (x, y), opening toward `openDir`. */
export function buildRoofHatch(x: number, y: number, openDir: Dir): RoofHatchRig {
  const group = new THREE.Group();
  group.position.set(x * CELL, 0, y * CELL);
  group.rotation.y = YAW[openDir];
  const metal = new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.5, metalness: 0.5 });

  // The ladder up the back wall, into the open hatch.
  const lz = BACK + 0.14;
  for (const side of [-0.24, 0.24]) group.add(box(0.05, WALL_H, 0.05, metal, side, WALL_H / 2, lz));
  for (let rung = 0.3; rung < WALL_H; rung += 0.34) group.add(box(0.48, 0.035, 0.035, metal, 0, rung, lz));
  // The hatch: a frame at the ceiling, and a cool square of night sky through it.
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x1a2a44, emissive: 0x7d9cd6, emissiveIntensity: 0.8 });
  const sky = box(0.9, 0.02, 0.9, skyMat, 0, WALL_H - 0.01, BACK + 0.55);
  markBloom(sky);
  group.add(sky, box(1.05, 0.06, 0.08, metal, 0, WALL_H - 0.04, BACK + 0.08), box(1.05, 0.06, 0.08, metal, 0, WALL_H - 0.04, BACK + 1.02));
  const moon = new THREE.PointLight(0x9fb8e8, 4, 4.5);
  moon.position.set(0, WALL_H - 0.3, BACK + 0.6);
  moon.userData.keepInDark = true; // light from outside: a blackout inside doesn't touch it
  group.add(moon);

  // The uplink's line: a conduit up the side wall into a junction box with a status light.
  const jz = 0.2;
  group.add(box(0.06, WALL_H, 0.06, metal, SIDE - 0.05, WALL_H / 2, jz));
  group.add(box(0.14, 0.5, 0.36, new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.6, metalness: 0.3 }), SIDE - 0.08, 1.25, jz));
  const ledMat = new THREE.MeshStandardMaterial({ color: LINE_LIVE, emissive: LINE_LIVE, emissiveIntensity: 2 });
  const led = box(0.02, 0.06, 0.06, ledMat, SIDE - 0.16, 1.42, jz);
  markBloom(led);
  group.add(led);

  const out = toFloor(x, y, openDir, 0, BACK + 1.1);
  return {
    group,
    spawn: { ...out, facing: YAW[openDir] + Math.PI },
    junction: toFloor(x, y, openDir, SIDE - 0.9, jz),
    setCut(cut) {
      const c = cut ? LINE_CUT : LINE_LIVE;
      ledMat.color.setHex(c);
      ledMat.emissive.setHex(c);
      ledMat.emissiveIntensity = cut ? 0.4 : 2;
    },
  };
}

export type TunnelGrateRig = {
  group: THREE.Group;
  /** Where the player climbs out, facing back into the dead end, so the camera looks in from the corridor (floor-local). */
  spawn: { x: number; z: number; facing: number };
};

/** The service-tunnel grate in dead end (x, y), opening toward `openDir`: the hole, and its grate lifted aside. */
export function buildTunnelGrate(x: number, y: number, openDir: Dir): TunnelGrateRig {
  const group = new THREE.Group();
  group.position.set(x * CELL, 0, y * CELL);
  group.rotation.y = YAW[openDir];
  const metal = new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.6, metalness: 0.5 });
  const hz = BACK + 0.9;
  group.add(box(0.95, 0.02, 0.95, new THREE.MeshBasicMaterial({ color: 0x030405 }), 0, 0.012, hz)); // the dark of the shaft
  for (const [w, d, dx, dz] of [
    [1.05, 0.06, 0, -0.5],
    [1.05, 0.06, 0, 0.5],
    [0.06, 1.05, -0.5, 0],
    [0.06, 1.05, 0.5, 0],
  ] as const) {
    group.add(box(w, 0.04, d, metal, dx, 0.03, hz + dz));
  }
  // The grate itself, pushed aside against the wall.
  const grate = new THREE.Group();
  for (let i = -0.4; i <= 0.41; i += 0.16) grate.add(box(0.05, 0.03, 0.9, metal, i, 0, 0));
  grate.add(box(0.9, 0.03, 0.05, metal, 0, 0, -0.43), box(0.9, 0.03, 0.05, metal, 0, 0, 0.43));
  grate.position.set(SIDE - 0.55, 0.05, hz + 0.3);
  grate.rotation.y = 0.35;
  group.add(grate);
  const out = toFloor(x, y, openDir, 0, hz + 0.1);
  return { group, spawn: { ...out, facing: YAW[openDir] + Math.PI } };
}
