// The dock yard's scene (yardplan.ts is its plan): shipping containers in rows and blocks, a canal with its quay and a bridge, a zipline across it between two lattice towers,
// and floodlight masts. All primitives and a couple of canvas textures. Built in floor-local metres, like the rest of a floor.

import * as THREE from 'three';
import { markBloom } from './postfx';
import type { WallBox } from './scene';
import { CONTAINER_H, CONTAINER_W, DOCK_WATER, DOCK_ZIPLINE, YARD_PLANS, zipPoint, type ContainerSpec, type YardId } from './yardplan';

const ribTexture = ((): (() => THREE.CanvasTexture) => {
  let cached: THREE.CanvasTexture | null = null;
  return () => {
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d7d7d7';
    g.fillRect(0, 0, 128, 64);
    for (let x = 0; x < 128; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x, 0, 3, 64);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 4, 0, 2, 64);
    }
    // A little rust and wear, so no two sides are quite clean.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(80,40,20,${0.04 + Math.random() * 0.08})`;
      g.fillRect(Math.random() * 128, Math.random() * 64, 2 + Math.random() * 10, 1 + Math.random() * 6);
    }
    cached = new THREE.CanvasTexture(c);
    cached.wrapS = cached.wrapT = THREE.RepeatWrapping;
    cached.colorSpace = THREE.SRGBColorSpace;
    return cached;
  };
})();

const std = (color: number, o: { rough?: number; metal?: number; glow?: number } = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.1, emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0 });

export type BuiltYard = {
  group: THREE.Group;
  /** Floor-local solid footprints of the containers, as tall cover. */
  boxes: WallBox[];
  /** The zipline's handle spot at its high end, and where the rider lands. */
  zip: { handle: { x: number; z: number }; land: { x: number; z: number } };
  /** Moves the water along. */
  update: (seconds: number, dt?: number) => void;
};

/** One container: ribbed steel in `color`, a door end with locking bars, and a second one on top when stacked. */
function container(spec: ContainerSpec): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: spec.color, map: ribTexture().clone(), roughness: 0.62, metalness: 0.35 });
  bodyMat.map!.repeat.set(spec.len / 1.5, 1);
  bodyMat.map!.needsUpdate = true;
  const dark = std(0x15181c, { rough: 0.5, metal: 0.5 });
  const steel = std(0x3b4046, { rough: 0.4, metal: 0.7 });
  for (let level = 0; level < spec.stack; level++) {
    const y = CONTAINER_H * level;
    const body = new THREE.Mesh(new THREE.BoxGeometry(spec.len, CONTAINER_H, CONTAINER_W), bodyMat);
    body.position.y = y + CONTAINER_H / 2;
    g.add(body);
    // Corner castings and a frame on the top and bottom edges.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, CONTAINER_H + 0.04, 0.16), steel);
      post.position.set((sx * (spec.len - 0.16)) / 2, y + CONTAINER_H / 2, (sz * (CONTAINER_W - 0.16)) / 2);
      g.add(post);
    }
    // The door end (at +x): two leaves and vertical locking bars; the other end plain.
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, CONTAINER_H - 0.3, CONTAINER_W - 0.3), dark);
    door.position.set(spec.len / 2 + 0.01, y + CONTAINER_H / 2, 0);
    g.add(door);
    for (const dz of [-0.5, -0.1, 0.1, 0.5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, CONTAINER_H - 0.4, 0.04), steel);
      bar.position.set(spec.len / 2 + 0.04, y + CONTAINER_H / 2, dz);
      g.add(bar);
    }
  }
  return g;
}

/** A lattice tower: four legs, cross braces, a deck and a rail. */
function tower(height: number, deck: number): THREE.Group {
  const g = new THREE.Group();
  const steel = std(0xc2a22a, { rough: 0.5, metal: 0.5 });
  const dark = std(0x2b3036, { rough: 0.5, metal: 0.6 });
  const half = 0.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, height, 0.14), steel);
    leg.position.set(sx * half, height / 2, sz * half);
    g.add(leg);
  }
  for (let y = 0.9; y < height; y += 1.4) {
    for (const [dx, dz, w, d] of [
      [0, half, half * 2, 0.07],
      [0, -half, half * 2, 0.07],
      [half, 0, 0.07, half * 2],
      [-half, 0, 0.07, half * 2],
    ] as const) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), steel);
      brace.position.set(dx, y, dz);
      g.add(brace);
    }
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 2.4), dark);
  platform.position.y = deck;
  g.add(platform);
  const lampMat = std(0xff7a2a, { glow: 1.6 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lampMat);
  lamp.position.set(half, height + 0.2, half);
  markBloom(lamp);
  g.add(lamp);
  return g;
}

/** A floodlight mast: a pole, a bank of lamps, and a light that reaches the ground round it. */
function mast(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 9, 8), std(0x2b3036, { metal: 0.6, rough: 0.5 }));
  pole.position.y = 4.5;
  g.add(pole);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.25), std(0xfff0c0, { glow: 2 }));
  bank.position.y = 9.1;
  markBloom(bank);
  g.add(bank);
  const light = new THREE.PointLight(0xffe9b0, 70, 30, 1.5);
  light.position.set(0, 8.6, 0);
  g.add(light);
  return g;
}

/** A round storage tank: a steel drum with a domed top, bands round it, a ladder and a pipe, and a manway. `d` is its diameter. */
function tank(d: number): THREE.Group {
  const g = new THREE.Group();
  const h = 6.4;
  const shell = std(0x7a6a62, { rough: 0.55, metal: 0.45 });
  const band = std(0x3a322e, { rough: 0.6, metal: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, h, 20), shell);
  body.position.y = h / 2;
  g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(d / 2, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  dome.scale.y = 0.35;
  dome.position.y = h;
  g.add(dome);
  for (const y of [1.2, 3.2, 5.2]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(d / 2 + 0.05, d / 2 + 0.05, 0.14, 20), band);
    ring.position.y = y;
    g.add(ring);
  }
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.08), std(0x2b3036, { metal: 0.6 }));
  ladder.position.set(d / 2 + 0.05, h / 2, 0);
  g.add(ladder);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, d * 0.5, 8), band);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(-d / 2 - 0.3, 0.7, 0);
  g.add(pipe);
  return g;
}

/** A pipe rack: posts every few metres and three pipes running along it at different heights. `len` is its length (along x, before it is turned). */
function rack(len: number): THREE.Group {
  const g = new THREE.Group();
  const steel = std(0x4a525a, { rough: 0.5, metal: 0.6 });
  const pipeMat = std(0x9aa4ad, { rough: 0.4, metal: 0.65 });
  for (let x = -len / 2 + 0.4; x <= len / 2 - 0.3; x += 3) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.2, 0.2), steel);
    post.position.set(x, 2.1, 0);
    g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 1.4), steel);
    arm.position.set(x, 3.9, 0);
    g.add(arm);
  }
  for (const [y, z, r] of [[2.4, 0, 0.22], [3.2, -0.45, 0.16], [3.9, 0.45, 0.2]] as const) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), pipeMat);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, y, z);
    g.add(p);
  }
  return g;
}

/** A drum cage: a steel frame with mesh sides round a few drums, its door end at +x (it opens as a container does). */
function cage(spec: ContainerSpec): THREE.Group {
  const g = new THREE.Group();
  const w = spec.width ?? CONTAINER_W;
  const h = CONTAINER_H;
  const steel = std(0x3b4046, { rough: 0.45, metal: 0.7 });
  const mesh = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.28, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), steel);
    post.position.set((sx * (spec.len - 0.14)) / 2, h / 2, (sz * (w - 0.14)) / 2);
    g.add(post);
  }
  for (const y of [0.05, h - 0.05]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(spec.len, 0.1, w), steel);
    frame.position.y = y;
    g.add(frame);
  }
  for (const sz of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(spec.len, h - 0.2, 0.03), mesh);
    side.position.set(0, h / 2, (sz * (w - 0.03)) / 2);
    g.add(side);
  }
  const drum = std(0x2a6fa8, { rough: 0.5, metal: 0.4 });
  const label = std(0xe8c04a, { rough: 0.6 });
  for (let i = 0; i < 4; i++) for (const sz of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.3, 12), drum);
    d.position.set(-spec.len / 2 + 0.9 + i * 1.3, 0.75, sz * 0.5);
    g.add(d);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.12, 12), label);
    band.position.copy(d.position).setY(1.0);
    g.add(band);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.3, w - 0.3), std(0x15181c, { rough: 0.5, metal: 0.5 }));
  door.position.set(spec.len / 2 + 0.01, h / 2, 0);
  g.add(door);
  return g;
}

/** The flare stack: a tall thin stack with a flame at the top and a light that flickers on the yard. */
function flare(): { group: THREE.Group; flame: THREE.Mesh; light: THREE.PointLight } {
  const group = new THREE.Group();
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 22, 8), std(0x3a3640, { rough: 0.6, metal: 0.5 }));
  stack.position.y = 11;
  group.add(stack);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 8), new THREE.MeshBasicMaterial({ color: 0xff9a30 }));
  flame.position.y = 23.6;
  markBloom(flame);
  group.add(flame);
  const light = new THREE.PointLight(0xff8a30, 260, 90, 1.4);
  light.position.y = 22;
  group.add(light);
  return { group, flame, light };
}

/** Falling rain over the whole yard: short streaks, moved down and wrapped each frame. */
function rain(w: number, d: number, n = 700): { lines: THREE.LineSegments; update: (dt: number) => void } {
  const pos = new Float32Array(n * 6);
  const seeds = Array.from({ length: n }, (_, i) => ({ x: ((i * 0.618) % 1) * w, z: ((i * 0.382 + 0.11) % 1) * d, y: ((i * 0.737) % 1) * 18, s: 14 + ((i * 0.31) % 1) * 8 }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xbcd4ec, transparent: true, opacity: 0.35 }));
  lines.frustumCulled = false;
  const write = (): void => {
    seeds.forEach((s, i) => {
      pos.set([s.x, s.y, s.z, s.x - 0.12, s.y - 0.7, s.z + 0.05], i * 6);
    });
    geo.attributes.position!.needsUpdate = true;
  };
  write();
  return {
    lines,
    update(dt) {
      for (const s of seeds) {
        s.y -= s.s * dt;
        if (s.y < 0) s.y += 18;
      }
      write();
    },
  };
}

/** A searchlight on a mast: a lamp and a beam that sweeps the yard, left and right of `aim` (radians, 0 along +x), at its own pace. */
function searchlight(aim: number, sweep: number, phase: number): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 11, 8), std(0x2b3036, { metal: 0.6, rough: 0.5 }));
  pole.position.y = 5.5;
  group.add(pole);
  const head = new THREE.Group();
  head.position.y = 11.3;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 0.8, 10), std(0xe8f4ff, { glow: 1.6 }));
  lamp.rotation.z = Math.PI / 2;
  markBloom(lamp);
  head.add(lamp);
  const spot = new THREE.SpotLight(0xe8f4ff, 900, 90, 0.16, 0.5, 1.2);
  spot.position.set(0, 0, 0);
  const target = new THREE.Object3D();
  head.add(spot, target);
  group.add(head);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(5.2, 60, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  beam.geometry.translate(0, -30, 0);
  head.add(beam);
  return {
    group,
    update(t) {
      const yaw = aim + sweep * Math.sin(t * 0.45 + phase);
      // pointing down and out along `yaw`
      const dir = new THREE.Vector3(Math.cos(yaw), -0.42, Math.sin(yaw)).normalize();
      target.position.copy(dir.clone().multiplyScalar(40));
      spot.target = target;
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    },
  };
}

/** A gantry crane along the north edge: two legs, a beam, a trolley that runs along it and a container hung from it. Overhead only. */
function crane(x0: number, x1: number, z: number): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const steel = std(0xc2a22a, { rough: 0.5, metal: 0.5 });
  const dark = std(0x2b3036, { rough: 0.5, metal: 0.6 });
  for (const x of [x0, x1]) {
    for (const dz of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 0.4), steel);
      leg.position.set(x, 7, z + dz);
      group.add(leg);
    }
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 2, 0.9, 3), steel);
  beam.position.set((x0 + x1) / 2, 14.2, z);
  group.add(beam);
  const trolley = new THREE.Group();
  const car = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), dark);
  car.position.y = 13.2;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 5), dark);
  cable.position.y = 9.4;
  const load = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.4, 2.4), std(0xa83a2a, { rough: 0.6, metal: 0.3 }));
  load.position.y = 5;
  trolley.add(car, cable, load);
  trolley.position.set(x0 + 10, 0, z);
  group.add(trolley);
  return {
    group,
    update(t) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.12);
      trolley.position.x = x0 + 8 + k * (x1 - x0 - 16);
    },
  };
}

const YARD_W = 144;
const YARD_D = 88;
const l_update = (list: Array<{ update: (t: number) => void }>, t: number): void => {
  for (const l of list) l.update(t);
};

export function buildYard(cell: number, planId: YardId = 'dock'): BuiltYard {
  const group = new THREE.Group();
  group.userData.structure = true;
  const boxes: WallBox[] = [];

  const farm = planId === 'farm';
  for (const spec of YARD_PLANS[planId].containers) {
    const shape = spec.shape ?? 'box';
    const c = shape === 'tank' ? tank(spec.width ?? spec.len) : shape === 'rack' ? rack(spec.len) : shape === 'cage' ? cage(spec) : container(spec);
    c.position.set(spec.x, 0, spec.z);
    c.rotation.y = spec.alongZ ? Math.PI / 2 : 0;
    group.add(c);
    const w = spec.width ?? CONTAINER_W;
    const hx = (spec.alongZ ? w : spec.len) / 2;
    const hz = (spec.alongZ ? spec.len : w) / 2;
    boxes.push({ minX: spec.x - hx, maxX: spec.x + hx, minZ: spec.z - hz, maxZ: spec.z + hz, cover: 'tall' });
  }

  // The canal: dark water down the middle, with a faint glow from the floodlights. In the farm it is a pipe trench: black grating, two fat pipes, and steam.
  const w = DOCK_WATER;
  const waterMat = farm
    ? new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.7, metalness: 0.5, emissive: 0x4a1a08, emissiveIntensity: 0.3 })
    : new THREE.MeshStandardMaterial({ color: 0x0a2a3a, roughness: 0.18, metalness: 0.6, emissive: 0x0b3a52, emissiveIntensity: 0.35 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w.maxX - w.minX, w.maxZ - w.minZ), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set((w.minX + w.maxX) / 2, 0.06, (w.minZ + w.maxZ) / 2);
  group.add(water);
  const steam: Array<{ m: THREE.Mesh; x: number; z: number; phase: number }> = [];
  if (farm) {
    for (const dx of [-1.4, 1.4]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, w.maxZ - w.minZ, 12), std(0x6a737c, { rough: 0.4, metal: 0.7 }));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set((w.minX + w.maxX) / 2 + dx, 0.9, (w.minZ + w.maxZ) / 2);
      group.add(pipe);
    }
    // steam: soft puffs that rise, widen and fade, from vents along the trench
    for (const vz of [10, 30, 52, 68]) for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe6ecf0, transparent: true, opacity: 0.0, depthWrite: false }));
      group.add(m);
      steam.push({ m, x: (w.minX + w.maxX) / 2, z: vz, phase: i / 4 });
    }
  }

  // The zipline: a tower at each end, the cable between, and the handle at the high end.
  const z = DOCK_ZIPLINE;
  const west = tower(z.fromHeight + 0.9, 1.6);
  west.position.set(z.from.x - 1.6, 0, z.from.z);
  group.add(west);
  const east = tower(z.toHeight + 0.9, 1.4);
  east.position.set(z.to.x + 1.6, 0, z.to.z);
  group.add(east);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const p = zipPoint(i / 24);
    pts.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 5), std(0x9aa4ad, { metal: 0.8, rough: 0.35 }));
  group.add(cable);
  // The handle: a pulley on the cable and a bar hanging from it, at arm's height at the start.
  const handle = new THREE.Group();
  const pulley = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.22), std(0xd8a22a, { metal: 0.6, rough: 0.4 }));
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), std(0x2b3036));
  rope.position.y = -0.62;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), std(0xd8a22a, { glow: 0.8 }));
  grip.rotation.z = Math.PI / 2;
  grip.position.y = -1.22;
  markBloom(grip);
  handle.add(pulley, rope, grip);
  handle.position.set(z.from.x, z.fromHeight, z.from.z);
  group.add(handle);

  // Floodlight masts at the yard's open spots.
  for (const [mx, mz] of [
    [6, 20],
    [48, 20],
    [26, 52],
    [88, 20],
    [120, 52],
    [96, 66],
    [20, 72],
    [118, 8],
  ] as const) {
    const m = mast();
    m.position.set(mx, 0, mz);
    group.add(m);
  }
  void cell;

  // The weather and the lights of each yard: the dock at night in the rain, with searchlights sweeping and a crane working overhead; the farm under its flare.
  const live: Array<(seconds: number, dt: number) => void> = [];
  if (farm) {
    const f = flare();
    f.group.position.set(134, 0, 78);
    group.add(f.group);
    live.push((t) => {
      const fl = 0.8 + 0.2 * Math.sin(t * 13) * Math.sin(t * 5.3);
      f.light.intensity = 220 * fl;
      f.flame.scale.set(1, 0.85 + 0.3 * fl, 1);
    });
    live.push((t) => {
      for (const s of steam) {
        const k = (t * 0.35 + s.phase) % 1;
        s.m.position.set(s.x + Math.sin(k * 6 + s.z) * 0.6, 1.2 + k * 5.5, s.z);
        s.m.scale.setScalar(0.6 + k * 1.8);
        (s.m.material as THREE.MeshBasicMaterial).opacity = 0.34 * Math.sin(k * Math.PI);
      }
    });
  } else {
    const r = rain(YARD_W, YARD_D);
    group.add(r.lines);
    live.push((_t, dt) => r.update(dt));
    const lights = [searchlight(Math.PI * 0.25, 0.7, 0), searchlight(Math.PI * 0.75, 0.7, 2.4)];
    lights[0]!.group.position.set(4, 0, 4);
    lights[1]!.group.position.set(YARD_W - 8, 0, YARD_D - 10);
    for (const l of lights) group.add(l.group);
    live.push((t) => l_update(lights, t));
    const c = crane(14, 120, 3);
    group.add(c.group);
    live.push((t) => c.update(t));
  }

  return {
    group,
    boxes,
    zip: { handle: { x: z.from.x, z: z.from.z }, land: { x: z.to.x + 0.8, z: z.to.z } },
    update(seconds, dt = 1 / 60) {
      waterMat.emissiveIntensity = 0.32 + 0.08 * Math.sin(seconds * 0.9);
      water.position.y = 0.06 + 0.012 * Math.sin(seconds * 1.3);
      for (const f of live) f(seconds, dt);
    },
  };
}
