// Landmarks: the one big open room on a floor (layouts.ts carves it out of solid cells and hangs it off a corridor), dressed for the place:
// a loading yard, a lab atrium, a great hall of statues, a tank yard, a vault hall, a campus commons. Where the rest of a floor is corridors
// and small rooms, this is somewhere to cross in the open: cover to move between, sightlines to be seen along, more than one way across.
// Built in a local frame whose +Z points out through the way in, like rooms.ts, then turned to face it. All primitives.

import * as THREE from 'three';
import { CELL, WALL_T, type WallBox } from './scene';
import { markBloom } from './postfx';
import type { Landmark } from './layouts';

type Dir = 'N' | 'S' | 'E' | 'W';
const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
// Three.js rotation.y maps local +Z to (sin a, cos a) in world XZ.
const YAW: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

/** Somewhere along the back wall (the wall facing the way in) left clear for a contract's station: its centre in floor-local metres, and the heading its front faces. */
export type LandmarkSpot = { x: number; z: number; facing: number };

export type BuiltLandmark = {
  group: THREE.Group;
  /** Floor-local (zero-origin) colliders, with their cover heights. */
  boxes: WallBox[];
  /** Up to three clear spots along the walls (the back one first), for the steps of a contract (objectives.ts). */
  spots: LandmarkSpot[];
};

const mat = (color: number, o: { rough?: number; metal?: number; glow?: number; alpha?: number } = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.1, emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0, transparent: o.alpha !== undefined, opacity: o.alpha ?? 1, depthWrite: o.alpha === undefined });

export function buildLandmark(lm: Landmark): BuiltLandmark {
  const group = new THREE.Group();
  const boxes: WallBox[] = [];
  const out = OPPOSITE[lm.dir];
  const a = YAW[out];
  const cx = (lm.x0 + (lm.w - 1) / 2) * CELL;
  const cz = (lm.y0 + (lm.h - 1) / 2) * CELL;
  // Local depth (along +Z, toward the way in) and width (across it), inside the walls.
  const alongZ = lm.dir === 'N' || lm.dir === 'S';
  const D = (alongZ ? lm.h : lm.w) * CELL - WALL_T;
  const Wd = (alongZ ? lm.w : lm.h) * CELL - WALL_T;
  group.position.set(cx, 0, cz);
  group.rotation.y = a;

  const add = (m: THREE.Object3D, x: number, y: number, z: number): void => {
    m.position.set(x, y, z);
    group.add(m);
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    add(mesh, x, y, z);
    return mesh;
  };
  const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 14): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
    add(mesh, x, y, z);
    return mesh;
  };
  /** A collision footprint for something at local (x, z), half-sizes hx and hz, turned into the floor's frame. */
  const locals: Array<{ x: number; z: number; hx: number; hz: number }> = [];
  const solid = (x: number, z: number, hx: number, hz: number, cover: 'low' | 'tall'): void => {
    locals.push({ x, z, hx, hz });
    const wx = cx + x * Math.cos(a) + z * Math.sin(a);
    const wz = cz - x * Math.sin(a) + z * Math.cos(a);
    const swap = out === 'E' || out === 'W';
    const ax = swap ? hz : hx;
    const az = swap ? hx : hz;
    boxes.push({ minX: wx - ax, maxX: wx + ax, minZ: wz - az, maxZ: wz + az, cover });
  };
  const light = (color: number, intensity: number, reach: number, x: number, y: number, z: number): void => {
    const l = new THREE.PointLight(color, intensity, reach);
    add(l, x, y, z);
  };
  const glowBar = (color: number, w: number, d: number, x: number, y: number, z: number): void => {
    const m = box(w, 0.06, d, mat(color, { glow: 1.6 }), x, y, z);
    markBloom(m);
  };
  /** A flat painted strip on the floor. */
  const paint = (color: number, w: number, d: number, x: number, z: number, glow = 0): void => {
    const m = box(w, 0.02, d, mat(color, { rough: 0.8, glow }), x, 0.012, z);
    if (glow) markBloom(m);
  };
  // Props sit inside this, leaving a clear ring (a couple of metres) round the walls to walk and to come in by.
  const ix = Math.max(0.8, Wd / 2 - 2.0);
  const iz = Math.max(0.8, D / 2 - 2.0);

  switch (lm.kind) {
    case 'dockyard': {
      const yellow = 0xd8b02a;
      paint(yellow, Wd - 1.4, 0.12, 0, -iz - 0.9);
      paint(yellow, 0.12, D - 1.6, -ix - 0.9, 0);
      paint(yellow, 0.12, D - 1.6, ix + 0.9, 0);
      // Two shipping containers, end on to one another with a gap to slip through.
      for (const [x, z, color] of [
        [-ix * 0.55, -iz * 0.35, 0xa83a2a],
        [ix * 0.6, iz * 0.3, 0x2a5f8a],
      ] as const) {
        box(1.7, 2.5, 3.6, mat(color, { rough: 0.6, metal: 0.3 }), x, 1.25, z);
        for (let r = -1.6; r <= 1.6; r += 0.4) box(1.74, 2.3, 0.05, mat(0x000000, { alpha: 0.18 }), x, 1.25, z + r);
        solid(x, z, 0.85, 1.8, 'tall');
      }
      // Pallets of boxes, and a forklift parked up.
      const card = mat(0xa88455, { rough: 0.85 });
      for (const [x, z] of [
        [ix * 0.15, -iz * 0.85],
        [-ix * 0.1, iz * 0.75],
      ] as const) {
        box(1.1, 0.14, 1.1, mat(0x7a5a34, { rough: 0.9 }), x, 0.07, z);
        box(0.95, 0.5, 0.95, card, x, 0.46, z);
        box(0.8, 0.5, 0.8, card, x, 0.96, z);
        solid(x, z, 0.55, 0.55, 'low');
      }
      const fx = ix * 0.95;
      const fz = -iz * 0.7;
      box(0.9, 0.7, 1.6, mat(0xd8a22a, { rough: 0.5, metal: 0.3 }), fx, 0.55, fz);
      box(0.9, 0.06, 1.4, mat(0x2a3036, { metal: 0.6 }), fx, 1.7, fz - 0.05);
      for (const px of [-0.4, 0.4]) box(0.06, 1.1, 0.06, mat(0x2a3036, { metal: 0.6 }), fx + px, 1.15, fz + 0.65);
      box(0.1, 1.6, 0.1, mat(0x2a3036, { metal: 0.6 }), fx, 0.9, fz - 0.95);
      box(0.1, 0.06, 0.9, mat(0x2a3036, { metal: 0.6 }), fx - 0.25, 0.1, fz - 1.4);
      box(0.1, 0.06, 0.9, mat(0x2a3036, { metal: 0.6 }), fx + 0.25, 0.1, fz - 1.4);
      solid(fx, fz - 0.3, 0.5, 1.2, 'tall');
      for (const x of [-ix * 0.6, ix * 0.6]) glowBar(0xfff0c0, 1.6, 0.12, x, 2.85, 0);
      light(0xffe9a8, 14, 12, 0, 2.7, 0);
      break;
    }
    case 'atrium': {
      const glass = mat(0xbfeaf0, { rough: 0.05, alpha: 0.3 });
      const core = cyl(0.8, 2.8, mat(0x4ee0d0, { glow: 0.9, alpha: 0.5 }), 0, 1.4, -iz * 0.1, 18);
      markBloom(core);
      cyl(0.95, 0.2, mat(0x2a3338, { rough: 0.4, metal: 0.6 }), 0, 0.1, -iz * 0.1, 18);
      cyl(0.95, 0.2, mat(0x2a3338, { rough: 0.4, metal: 0.6 }), 0, 2.85, -iz * 0.1, 18);
      cyl(0.9, 2.6, glass, 0, 1.4, -iz * 0.1, 18);
      solid(0, -iz * 0.1, 0.95, 0.95, 'tall');
      // A ring of light in the floor round it, and four slim pillars.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.05, 6, 40), mat(0x6ff5e6, { glow: 1.3 }));
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, 0.03, -iz * 0.1);
      markBloom(ring);
      for (const [x, z] of [
        [-ix, -iz],
        [ix, -iz],
        [-ix, iz * 0.8],
        [ix, iz * 0.8],
      ] as const) {
        box(0.45, 3.0, 0.45, mat(0xe4ecef, { rough: 0.3 }), x, 1.5, z);
        solid(x, z, 0.25, 0.25, 'tall');
      }
      // Two benches either side of the way in.
      for (const x of [-ix * 0.75, ix * 0.75]) {
        box(1.6, 0.4, 0.5, mat(0xe4ecef, { rough: 0.35 }), x, 0.4, iz * 0.9);
        box(1.6, 0.08, 0.5, mat(0x1f9a98, { rough: 0.5 }), x, 0.62, iz * 0.9);
        solid(x, iz * 0.9, 0.8, 0.25, 'low');
      }
      light(0x7ef5ff, 12, 11, 0, 2.6, 0);
      break;
    }
    case 'greathall': {
      const marble = mat(0xd5cfc4, { rough: 0.4 });
      paint(0x7a2f36, 2.0, D - 2.4, 0, 0);
      // Statues on plinths in two rows either side of the carpet.
      for (const sx of [-1, 1]) {
        for (const z of [-iz * 0.8, 0, iz * 0.8]) {
          const x = sx * ix * 0.62;
          box(0.7, 0.9, 0.7, marble, x, 0.45, z);
          const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.8, 10), marble);
          add(torso, x, 1.3, z);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), marble);
          add(head, x, 1.85, z);
          solid(x, z, 0.35, 0.35, 'tall');
        }
      }
      // A glass case in the middle, with a velvet rope round it.
      box(1.2, 0.8, 0.9, mat(0x2b2420, { rough: 0.6 }), 0, 0.4, -iz * 0.2);
      box(1.1, 0.7, 0.8, mat(0xaad4e0, { rough: 0.05, alpha: 0.22 }), 0, 1.15, -iz * 0.2);
      const relic = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 8), mat(0xd9b35a, { rough: 0.3, metal: 0.8, glow: 0.4 }));
      add(relic, 0, 1.1, -iz * 0.2);
      solid(0, -iz * 0.2, 0.65, 0.5, 'low');
      light(0xffd9a0, 14, 12, 0, 2.7, 0);
      glowBar(0xffe6b8, 2.4, 0.1, 0, 2.9, -iz * 0.2);
      break;
    }
    case 'tankyard': {
      const steel = mat(0x3a4046, { rough: 0.5, metal: 0.6 });
      const rust = mat(0xc26a1a, { rough: 0.6, metal: 0.4 });
      for (const x of [-ix * 0.62, ix * 0.62]) {
        const z = -iz * 0.35;
        cyl(1.15, 3.0, steel, x, 1.5, z, 18);
        for (const y of [0.6, 1.5, 2.4]) cyl(1.19, 0.08, rust, x, y, z, 18);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel);
        add(dome, x, 3.0, z);
        solid(x, z, 1.2, 1.2, 'tall');
      }
      // A manifold of pipes between them, a valve wheel, and a vent breathing amber.
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, ix * 1.24, 8), steel);
      pipe.rotation.z = Math.PI / 2;
      add(pipe, 0, 0.9, -iz * 0.35);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 14), mat(0xe0564e, { glow: 0.5 }));
      add(wheel, 0, 1.25, -iz * 0.35);
      const vx = 0;
      const vz = iz * 0.7;
      cyl(0.35, 0.5, steel, vx, 0.25, vz, 10);
      const vent = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xffb04a, emissiveIntensity: 1.8, transparent: true, opacity: 0.6, depthWrite: false }));
      add(vent, vx, 0.95, vz);
      markBloom(vent);
      solid(vx, vz, 0.4, 0.4, 'low');
      paint(0xc2b13a, Wd - 1.2, 0.14, 0, iz + 0.9);
      light(0xffb35a, 14, 12, 0, 2.7, 0);
      break;
    }
    case 'vaulthall': {
      const steel = mat(0x3a4148, { rough: 0.5, metal: 0.6 });
      const brass = mat(0xb08d4a, { rough: 0.3, metal: 0.8 });
      // The vault door in the far wall: a round steel slab with a brass wheel.
      const door = cyl(1.3, 0.3, steel, 0, 1.5, -D / 2 + 0.2, 28);
      door.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 24), brass);
      add(hub, 0, 1.5, -D / 2 + 0.4);
      for (let k = 0; k < 6; k++) {
        const spoke = box(0.07, 1.0, 0.07, brass, 0, 1.5, -D / 2 + 0.4);
        spoke.rotation.z = (k * Math.PI) / 3;
      }
      // Two long counters of safe-deposit boxes to work between.
      for (const sx of [-1, 1]) {
        const x = sx * ix * 0.6;
        box(1.0, 1.1, 3.6, steel, x, 0.55, 0);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 2; c++) box(0.04, 0.2, 0.34, brass, x + sx * -0.52, 0.35 + c * 0.38, -1.5 + r * 0.43);
        solid(x, 0, 0.55, 1.8, 'low');
      }
      // A brass rope and posts in front of the vault.
      for (const x of [-1.6, 1.6]) {
        cyl(0.05, 0.95, brass, x, 0.475, -iz * 0.95, 8);
        solid(x, -iz * 0.95, 0.1, 0.1, 'low');
      }
      box(3.2, 0.05, 0.05, mat(0x8a1f2a, { rough: 0.9 }), 0, 0.82, -iz * 0.95);
      light(0xffe0a8, 14, 12, 0, 2.7, 0);
      break;
    }
    case 'commons': {
      const planter = mat(0x3a4f3a, { rough: 0.8 });
      const wood = mat(0x5a4632, { rough: 0.6 });
      // Planters with small trees, a pair of round tables with chairs, and a bench each side of the way in.
      for (const [x, z] of [
        [-ix * 0.7, -iz * 0.6],
        [ix * 0.7, -iz * 0.6],
      ] as const) {
        box(1.1, 0.5, 1.1, planter, x, 0.25, z);
        cyl(0.07, 1.6, mat(0x4a3a2a), x, 1.3, z, 6);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), mat(0x2f7a3a, { rough: 0.9 }));
        add(crown, x, 2.3, z);
        solid(x, z, 0.6, 0.6, 'tall');
      }
      for (const x of [-ix * 0.25, ix * 0.25]) {
        cyl(0.55, 0.06, wood, x, 0.74, iz * 0.1, 16);
        cyl(0.05, 0.7, mat(0x24262a), x, 0.37, iz * 0.1, 6);
        for (const [dx, dz] of [
          [-0.8, 0],
          [0.8, 0],
        ] as const) box(0.4, 0.5, 0.4, mat(0x2d3138, { rough: 0.8 }), x + dx, 0.25, iz * 0.1 + dz);
        solid(x, iz * 0.1, 1.0, 0.7, 'low');
      }
      // A skylight's shaft of light on the floor.
      paint(0xcfe3ff, 2.6, 1.8, 0, -iz * 0.2, 0.35);
      light(0xcfe3ff, 12, 11, 0, 2.7, 0);
      break;
    }
  }
  // Up to three places along the walls, clear of the dressing (and of the way in), where a contract's stations go: the back wall first, then the side walls.
  // A station is about 1.9 by 1.1 and is worked from 1.25 m in front of it, so both that footprint and that standing place have to be free.
  type Cand = { x: number; z: number; f: number; hx: number; hz: number; sx: number; sz: number };
  const cands: Cand[] = [];
  const back = -D / 2 + 0.6;
  for (const x of [-Wd / 3, Wd / 3, 0, -Wd / 6, Wd / 6]) cands.push({ x, z: back, f: a, hx: 0.95, hz: 0.55, sx: x, sz: back + 1.25 });
  const left = -Wd / 2 + 0.6;
  const right = Wd / 2 - 0.6;
  for (const z of [-D / 6, D / 6, -D / 3]) {
    if (Math.abs(z) > D / 2 - 1.8) continue;
    cands.push({ x: left, z, f: a + Math.PI / 2, hx: 0.55, hz: 0.95, sx: left + 1.25, sz: z });
    cands.push({ x: right, z, f: a - Math.PI / 2, hx: 0.55, hz: 0.95, sx: right - 1.25, sz: z });
  }
  const MARGIN = 0.3;
  const clear = (c: Cand): boolean =>
    locals.every((b) => {
      const propHit = Math.abs(c.x - b.x) < c.hx + b.hx + MARGIN && Math.abs(c.z - b.z) < c.hz + b.hz + MARGIN;
      const standHit = Math.abs(c.sx - b.x) < b.hx + 0.5 && Math.abs(c.sz - b.z) < b.hz + 0.5;
      return !propHit && !standHit;
    });
  const taken: Cand[] = [];
  for (const c of cands) {
    if (taken.length >= 3) break;
    // Not on top of one already chosen either.
    if (!clear(c) || taken.some((t) => Math.abs(t.x - c.x) < 2.4 && Math.abs(t.z - c.z) < 2.4)) continue;
    taken.push(c);
  }
  const spots: LandmarkSpot[] = taken.map((c) => ({ x: cx + c.x * Math.cos(a) + c.z * Math.sin(a), z: cz - c.x * Math.sin(a) + c.z * Math.cos(a), facing: c.f }));
  return { group, boxes, spots };
}
