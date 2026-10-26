// The meshes for power.ts's wall fittings: a light switch (a small plate,
// its toggle and a status LED), and a circuit-breaker panel (a steel box
// with a big lever, a hazard stripe and its circuit's letter). Both are
// built facing +Z out into the cell, on a wall of cell (x, y), and return
// the floor-local spot the player stands on to use them.

import * as THREE from 'three';
import { CELL, WALL_T } from './scene';
import { markBloom } from './postfx';
import type { Dir } from './security';

const FACE_AWAY: Record<Dir, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const ON = 0x4ee08a;
const OFF = 0xff4a3a;

export type PowerFittingRig = {
  group: THREE.Group;
  /** Floor-local spot in front of it, and the facing toward it. */
  front: { x: number; z: number; facing: number };
  setOn: (on: boolean) => void;
};

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Positions `group` flat against `wall` of cell (x, y), `depth` deep, and works out where to stand. */
function mount(group: THREE.Group, x: number, y: number, wall: Dir, depth: number): PowerFittingRig['front'] {
  const [dx, dy] = DELTA[wall];
  const back = CELL / 2 - WALL_T / 2 - depth / 2 - 0.01;
  group.position.set(x * CELL + dx * back, 0, y * CELL + dy * back);
  group.rotation.y = FACE_AWAY[wall];
  const stand = CELL / 2 - 1;
  // Facing the wall: toward +dx/+dy, the same convention as the player's facing (sin, cos).
  return { x: x * CELL + dx * stand, z: y * CELL + dy * stand, facing: Math.atan2(dx, dy) };
}

function statusLight(size: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ON, emissiveIntensity: 1.8 });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(size, 12), mat);
  markBloom(mesh);
  return { mesh, mat };
}

/** A light switch on `wall` of cell (x, y). */
export function buildLightSwitch(x: number, y: number, wall: Dir): PowerFittingRig {
  const group = new THREE.Group();
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.55, metalness: 0.1 });
  const nubMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.4, metalness: 0.3 });
  group.add(box(0.13, 0.19, 0.02, plateMat, 0, 1.25, 0));
  const pivot = new THREE.Group();
  pivot.position.set(0, 1.26, 0.012);
  pivot.add(box(0.035, 0.07, 0.03, nubMat, 0, 0, 0.012));
  group.add(pivot);
  const led = statusLight(0.012);
  led.mesh.position.set(0, 1.17, 0.012);
  group.add(led.mesh);
  const front = mount(group, x, y, wall, 0.02);
  return {
    group,
    front,
    setOn(on) {
      pivot.rotation.x = on ? -0.45 : 0.45;
      led.mat.emissive.setHex(on ? ON : OFF);
    },
  };
}

/** A circuit-breaker panel on `wall` of cell (x, y), for circuit `letter`. */
export function buildBreaker(x: number, y: number, wall: Dir, letter: string, keyColor: number): PowerFittingRig {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5f6975, roughness: 0.5, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.7 });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.6 });
  const tag = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: keyColor, emissiveIntensity: 0.9 });
  group.add(box(0.56, 0.78, 0.14, steel, 0, 1.35, 0));
  group.add(box(0.5, 0.06, 0.005, hazard, 0, 1.68, 0.073));
  group.add(box(0.36, 0.5, 0.005, dark, -0.06, 1.3, 0.073));
  // Its letter on a lit tag, so a glimpse down a corridor says which circuit it is.
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: letterTexture(letter), transparent: true }));
  label.position.set(0.17, 1.52, 0.074);
  group.add(label);
  const tagMesh = box(0.16, 0.16, 0.004, tag, 0.17, 1.52, 0.071);
  markBloom(tagMesh);
  group.add(tagMesh);
  // The lever: up is on.
  const lever = new THREE.Group();
  lever.position.set(0.17, 1.25, 0.08);
  lever.add(box(0.03, 0.2, 0.03, dark, 0, 0.09, 0.02));
  lever.add(box(0.06, 0.04, 0.05, hazard, 0, 0.19, 0.03));
  group.add(lever);
  const led = statusLight(0.02);
  led.mesh.position.set(-0.19, 1.6, 0.074); // top left, where the lever never covers it
  group.add(led.mesh);
  const front = mount(group, x, y, wall, 0.14);
  return {
    group,
    front,
    setOn(on) {
      lever.rotation.x = on ? -0.2 : Math.PI - 0.2;
      led.mat.emissive.setHex(on ? ON : OFF);
    },
  };
}

function letterTexture(letter: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0d10';
  ctx.font = '700 44px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 32, 35);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
