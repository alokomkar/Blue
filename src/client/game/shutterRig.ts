// A timed shutter's 3D side (shutters.ts has the rules): a frame across the
// passage with a roller shutter that comes down from its header, a strip on
// both faces of the header counting down how long it stays open, and a
// panel on the wall at either end to hack it open. Floor-local, like the
// rest of a floor's fittings.

import * as THREE from 'three';
import { CELL, WALL_H, WALL_T, type WallBox } from './scene';
import { markBloom } from './postfx';
import type { ShutterPlan } from './shutters';
import type { Dir } from './security';

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPENING = WALL_H - 0.4; // under the header
const SHUT_LIGHT = 0xff3b3b;
const OPEN_LIGHT = 0x4ee08a;
const COUNT_LIGHT = 0xffb347;
const BOX_HALF_T = 0.18;

export type ShutterRig = {
  group: THREE.Group;
  /** Floor-local collider while it's shut. */
  box: WallBox;
  /** Floor-local centre of the passage. */
  center: { x: number; z: number };
  /** Where to stand to work each panel (floor-local), and the way you face to. */
  panels: Array<{ front: { x: number; z: number }; facing: number }>;
  /** Shows it `closure` of the way down (0 open, 1 shut), `left` (0–1) of its open time to go; `hacking`, a panel being worked. */
  set: (closure: number, left: number, hacking: boolean) => void;
};

export function buildShutter(plan: ShutterPlan): ShutterRig {
  const [dx, dz] = DELTA[plan.dir];
  const center = { x: plan.x * CELL + (dx * CELL) / 2, z: plan.y * CELL + (dz * CELL) / 2 };
  const acrossX = dz !== 0; // a N/S passage has its shutter spanning X
  const span = CELL - WALL_T;
  const root = new THREE.Group();
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  if (!acrossX) group.rotation.y = Math.PI / 2;
  root.add(group);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.5, metalness: 0.4 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, WALL_H, 0.4), frameMat);
    post.position.set(side * (span / 2 - 0.05), WALL_H / 2, 0);
    group.add(post);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(span, 0.4, 0.5), frameMat);
  header.position.y = WALL_H - 0.2;
  group.add(header);

  // The countdown: a strip on each face of the header that drains as the time runs out.
  const stripMat = new THREE.MeshStandardMaterial({ color: SHUT_LIGHT, emissive: SHUT_LIGHT, emissiveIntensity: 2.2 });
  const strips: THREE.Mesh[] = [];
  for (const face of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(span - 0.5, 0.1, 0.03), stripMat);
    strip.position.set(0, WALL_H - 0.2, face * 0.26);
    markBloom(strip);
    group.add(strip);
    strips.push(strip);
  }

  // The shutter: slats, rolling down from under the header (scaled from its top edge).
  const shutter = new THREE.Group();
  shutter.position.y = OPENING;
  const slatMat = new THREE.MeshStandardMaterial({ color: 0x7d8691, roughness: 0.5, metalness: 0.5 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.4 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(span - 0.3, OPENING, 0.07), slatMat);
  slab.position.y = -OPENING / 2;
  shutter.add(slab);
  for (let y = 0.25; y < OPENING; y += 0.25) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(span - 0.3, 0.03, 0.09), seamMat);
    seam.position.y = -y;
    shutter.add(seam);
  }
  group.add(shutter);

  const box: WallBox = acrossX
    ? { minX: center.x - span / 2, maxX: center.x + span / 2, minZ: center.z - BOX_HALF_T, maxZ: center.z + BOX_HALF_T }
    : { minX: center.x - BOX_HALF_T, maxX: center.x + BOX_HALF_T, minZ: center.z - span / 2, maxZ: center.z + span / 2 };

  // The panels: a console on the wall, its screen red while it's shut, green while it's open.
  const screenMat = new THREE.MeshStandardMaterial({ color: SHUT_LIGHT, emissive: SHUT_LIGHT, emissiveIntensity: 1.8 });
  const panels = plan.panels.map((p) => {
    const [wx, wz] = DELTA[p.wall];
    const panel = new THREE.Group();
    const onWall = CELL / 2 - WALL_T / 2 - 0.09;
    panel.position.set(p.x * CELL + wx * onWall, 1.25, p.y * CELL + wz * onWall);
    panel.rotation.y = Math.atan2(-wx, -wz); // facing out of the wall
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.14), frameMat);
    panel.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), screenMat);
    screen.position.z = 0.075;
    markBloom(screen);
    panel.add(screen);
    root.add(panel);
    const out = CELL / 2 - 0.9;
    return { front: { x: p.x * CELL + wx * out, z: p.y * CELL + wz * out }, facing: Math.atan2(wx, wz) };
  });

  const set = (closure: number, left: number, hacking: boolean): void => {
    const c = Math.max(0.001, Math.min(1, closure));
    shutter.scale.y = c;
    const open = closure < 1;
    const colour = open ? (left > 0.4 ? OPEN_LIGHT : COUNT_LIGHT) : hacking ? COUNT_LIGHT : SHUT_LIGHT;
    stripMat.color.setHex(colour);
    stripMat.emissive.setHex(colour);
    for (const s of strips) s.scale.x = open ? Math.max(0.02, left) : 1;
    screenMat.color.setHex(open ? OPEN_LIGHT : hacking ? COUNT_LIGHT : SHUT_LIGHT);
    screenMat.emissive.copy(screenMat.color);
  };
  set(1, 0, false);
  return { group: root, box, center, panels, set };
}
