// The ceiling's 3D side (pipes.ts has the layout): a steel pipe along each
// line with a copper conduit beside it (the pulses run in the conduit),
// hanger rods up to the floor above, a junction box where lines cross,
// pendant lamps every few cells (a hanging agent is seen under one), and a
// lattice mast in each tower's cell, against its side wall, up to a
// platform under the pipe. Everything sits in the floor's own group, in
// floor-local coordinates; the masts also go into the floor's wall boxes, so
// no one walks through one.

import * as THREE from 'three';
import { markBloom } from './postfx';
import type { WallBox } from './scene';
import { PIPE_HEIGHT, crossing, lineCells, lineLength, pulseAlong, type PipePlan, type Tower } from './pipes';
import type { Dir } from './security';
import { blocking, stepFade, type Box3, type Vec3 } from './wallfade';

const PIPE_R = 0.13;
const CONDUIT_R = 0.045;
const CONDUIT_OFFSET = 0.24; // beside the pipe, the same side all along
const LAMP_EVERY = 3; // cells
/** The conduit's glow between pulses (pulses light it up brighter). */
export const CONDUIT_IDLE_GLOW = 0.18;
/** How fast the electric pulses run the conduits (m/s): a little faster than anyone shimmies (1.6), slow enough to see coming and keep ahead of. */
export const PULSE_SPEED = 1.8;
const LONG_LINE = 60; // metres: a line longer than this carries two pulses, half a round trip apart
const FADE_NEAR = 1.7; // on the floor this close under a line (across it), it fades so it doesn't hide you from the camera
const FADED = 0.1;
const FADE_RATE = 6;
const MAST_HALF = 0.36; // half the mast's footprint
const PLATFORM = 1.1;
/** The platform runs further along the corridor, away from the ladder's side, and out a little further, so an agent can lie flat on it facing any way (a body is 1.8 m long). */
const PLATFORM_WIDE = 2.2;
const PLATFORM_EXTRA_OUT = 0.3;
/** The platform's height: standing on it, the pipe is just in reach overhead. */
export const PERCH_HEIGHT = PIPE_HEIGHT - 2.3;
const CLIMB_OUT = 0.34; // how far out from the rungs the climber's feet are

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export type PipeRig = {
  group: THREE.Group;
  /** Cells with a lamp over them (a hanging agent there is lit). */
  lampCells: Set<string>;
  /** Each line's conduit material, for the pulse glow (pulses.ts). */
  conduits: THREE.MeshStandardMaterial[];
  /** Each line's own materials (pipe, conduit, lamps), so each line can fade on its own: fadeLines(). */
  lineMats: THREE.Material[][];
  /** Each tower's climb (plan.towers' order). */
  towers: ClimbTower[];
  /** The electric pulses running the conduits (movePulses()). */
  pulses: Pulse[];
  /** Each tower's platform and its rail, which ghost out when they stand between the camera and the agent below (fadeDecks()). */
  decks: Deck[];
};

export type Deck = { meshes: THREE.Mesh[]; /** Floor-local. */ box: Box3; fade: number };

/** A pulse on line `line`: where it is along it (metres from its first cell's centre) and which way it's heading. */
export type Pulse = { line: number; phase: number; along: number; dir: 1 | -1; mesh: THREE.Object3D };

/**
 * The pull up from the ladder onto the platform: the library's ClimbUp_1m
 * (ual.ts), whose own root motion (in the library's other version) carries
 * the body a metre up in a straight line over MANTLE_S (and 1.68 m forward:
 * cut here to fit on the platform). The game moves the agent along it.
 */
export const MANTLE_UP = 1.0;
export const MANTLE_FORWARD = 1.2;
export const MANTLE_S = 0.67;

/**
 * A tower's climb, floor-local: stepping up to the ladder at `foot`, climbing
 * straight up at `rungs` (facing the mast, `facing`) until the platform is
 * MANTLE_UP above the feet, pulling up onto it at `ledge` (over the mast),
 * and stepping out to `top`, under the pipe, turning to face `out`.
 */
export type ClimbTower = {
  foot: { x: number; z: number };
  rungs: { x: number; z: number };
  ledge: { x: number; z: number };
  top: { x: number; y: number; z: number };
  /** The middle of the platform (floor-local): where an agent lying flat on it has its middle, not at `top` under the pipe, near the edge. */
  lieAt: { x: number; z: number };
  facing: number;
  out: number;
};

/** Builds `plan`'s pipes, lamps and towers into `group` (floor-local), adding the masts to `wallBoxes` (world: `origin` added). */
export function buildPipes(
  group: THREE.Group,
  plan: PipePlan,
  cell: number,
  floorHeight: number,
  wallBoxes: WallBox[],
  origin: { x: number; z: number }
): PipeRig {
  const rig = new THREE.Group();
  group.add(rig);
  const steel = new THREE.MeshStandardMaterial({ color: 0xa7b0ba, roughness: 0.4, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.6, metalness: 0.4 });
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff1c9, emissiveIntensity: 2.2 });
  const lampPool = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending });
  const conduits: THREE.MeshStandardMaterial[] = [];
  const lineMats: THREE.Material[][] = [];
  const lampCells = new Set<string>();
  const crossings = new Set<string>();
  plan.lines.forEach((a, i) => plan.lines.slice(i + 1).forEach((b) => {
    const c = crossing(a, b);
    if (c) crossings.add(`${c.x},${c.y}`);
  }));

  for (const line of plan.lines) {
    // From the first cell's outer edge to the last's: into the outer walls at both ends.
    const start = line.from * cell - cell / 2;
    const length = (line.to - line.from + 1) * cell;
    const mid = start + length / 2;
    const across = line.at * cell;
    const along = (m: THREE.Object3D, u: number, v: number, y: number): void => {
      if (line.axis === 'x') m.position.set(u, y, across + v);
      else m.position.set(across + v, y, u);
    };
    const tube = (r: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 12), mat);
      m.rotation.set(line.axis === 'z' ? Math.PI / 2 : 0, 0, line.axis === 'x' ? Math.PI / 2 : 0);
      return m;
    };
    const pipeMat = steel.clone();
    const shadeMat = dark.clone();
    const bulbMat = lampGlow.clone();
    const pipe = tube(PIPE_R, pipeMat);
    along(pipe, mid, 0, PIPE_HEIGHT);
    rig.add(pipe);
    // Faintly lit even between pulses, so the network reads from above as a line of light.
    const conduitMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.5, metalness: 0.5, emissive: 0x4fc3ff, emissiveIntensity: CONDUIT_IDLE_GLOW });
    conduits.push(conduitMat);
    lineMats.push([pipeMat, conduitMat, shadeMat, bulbMat]);
    const conduit = tube(CONDUIT_R, conduitMat);
    along(conduit, mid, CONDUIT_OFFSET, PIPE_HEIGHT + 0.05);
    markBloom(conduit);
    rig.add(conduit);

    lineCells(line).forEach((c, k) => {
      const u = (line.axis === 'x' ? c.x : c.y) * cell;
      // A hanger up to the floor above at every cell's edge.
      const rodH = floorHeight - PIPE_HEIGHT - 0.05;
      if (rodH > 0.1) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, rodH, 6), dark);
        along(rod, u - cell / 2, 0, PIPE_HEIGHT + rodH / 2);
        rig.add(rod);
      }
      const key = `${c.x},${c.y}`;
      if (crossings.has(key)) {
        if (line.axis === 'x') {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.62), dark);
          box.position.set(c.x * cell, PIPE_HEIGHT + 0.02, c.y * cell);
          rig.add(box);
          const tell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb04a, emissiveIntensity: 1.8 }));
          tell.position.set(c.x * cell + 0.32, PIPE_HEIGHT + 0.1, c.y * cell);
          markBloom(tell);
          rig.add(tell);
        }
        return;
      }
      if (k % LAMP_EVERY !== 1) return;
      // A lamp slung tight under the pipe (hanging lower, it would loom in front of the camera), and the pool it throws.
      lampCells.add(key);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 14, 1, true), shadeMat);
      along(shade, u, 0, PIPE_HEIGHT - 0.24);
      rig.add(shade);
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.2, 14), bulbMat);
      bulb.rotation.x = Math.PI / 2;
      along(bulb, u, 0, PIPE_HEIGHT - 0.35);
      markBloom(bulb);
      rig.add(bulb);
      // Its light on the floor below: a soft pool, like a drone's.
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), lampPool);
      pool.rotation.x = -Math.PI / 2;
      along(pool, u, 0, 0.04);
      pool.userData.fx = true;
      rig.add(pool);
    });
  }

  // The pulses: a white-hot spark in a cyan halo, riding each conduit.
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xe6fbff });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const pulses: Pulse[] = [];
  plan.lines.forEach((line, i) => {
    const count = lineLength(plan, i, cell) > LONG_LINE ? 2 : 1;
    const round = 2 * (lineLength(plan, i, cell) + cell);
    for (let k = 0; k < count; k++) {
      const mesh = new THREE.Group();
      const spark = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), sparkMat);
      markBloom(spark);
      const halo = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 10), haloMat);
      halo.userData.fx = true;
      mesh.add(spark, halo);
      // Lying along the line.
      if (line.axis === 'x') mesh.rotation.z = Math.PI / 2;
      else mesh.rotation.x = Math.PI / 2;
      rig.add(mesh);
      pulses.push({ line: i, phase: (Math.random() + k) * (round / count), along: 0, dir: 1, mesh });
    }
  });

  const towers: ClimbTower[] = [];
  const decks: Deck[] = [];
  for (const t of plan.towers) {
    const { mast, climb, deck } = buildMast(t, cell, steel, dark);
    rig.add(mast);
    towers.push(climb);
    rig.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    for (const m of deck) bb.expandByObject(m);
    decks.push({ meshes: deck, box: { minX: bb.min.x - 0.1, maxX: bb.max.x + 0.1, minY: bb.min.y - 0.1, maxY: bb.max.y + 0.1, minZ: bb.min.z - 0.1, maxZ: bb.max.z + 0.1 }, fade: 0 });
    const mx = mast.position.x;
    const mz = mast.position.z;
    wallBoxes.push({ minX: origin.x + mx - MAST_HALF, maxX: origin.x + mx + MAST_HALF, minZ: origin.z + mz - MAST_HALF, maxZ: origin.z + mz + MAST_HALF, cover: 'tall' });
  }
  return { group: rig, lampCells, conduits, lineMats, towers, pulses, decks };
}

/** How far a platform goes at most: about a quarter solid. */
const DECK_FADE_TO = 0.78;

/**
 * A tower's platform stands between the chase camera and an agent walking under it and hides them: while it is in the way of any part of the agent (`seen`, floor-local, as are `camera`
 * and the decks), it ghosts out, and it comes back when it is not. `seen` null (on a platform, another floor, a fly-over) brings them all back.
 */
export function fadeDecks(rig: PipeRig, camera: Vec3, seen: readonly Vec3[] | null, dt: number): void {
  const inTheWay = seen ? blocking(camera, seen, rig.decks.map((d) => d.box)) : null;
  rig.decks.forEach((d, i) => {
    const goal = inTheWay?.[i] ? 1 : 0;
    if (d.fade === goal && goal === 0) return;
    d.fade = stepFade(d.fade, goal, dt);
    for (const m of d.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const solid = d.fade === 0;
      const transparent = !solid;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = 1 - DECK_FADE_TO * d.fade;
      mat.depthWrite = d.fade < 0.35;
    }
  });
}

/**
 * A lattice mast against the tower cell's side wall (`wall`), a platform out
 * from its top to under the pipe, and rungs up its side (along the corridor,
 * so neither the platform nor the mast hides the climber from the camera
 * above).
 */
function buildMast(t: Tower, cell: number, steel: THREE.Material, dark: THREE.Material): { mast: THREE.Group; climb: ClimbTower; deck: THREE.Mesh[] } {
  const [wx, wz] = DELTA[t.wall];
  const ox = -wx; // out from the wall, into the corridor
  const oz = -wz;
  const back = cell / 2 - MAST_HALF - 0.2; // from the cell's centre, toward the wall
  const mast = new THREE.Group();
  mast.position.set(t.x * cell - ox * back, 0, t.y * cell - oz * back);
  // Mast-local: `s` out from the mast's centre into the corridor, `w` along the corridor.
  const place = (m: THREE.Object3D, s: number, y: number, w: number): void => {
    m.position.set(ox * s + oz * w, y, oz * s + ox * w);
  };
  const box = (s: number, w: number, h: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(ox ? s : w, h, oz ? s : w), mat);
  const height = PERCH_HEIGHT;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, height, 0.07), steel);
    post.position.set(sx * MAST_HALF, height / 2, sz * MAST_HALF);
    mast.add(post);
  }
  for (let y = 0.5; y < height; y += 0.9) {
    for (const [s, w, ps, pw] of [
      [MAST_HALF * 2, 0.05, 0, MAST_HALF],
      [MAST_HALF * 2, 0.05, 0, -MAST_HALF],
      [0.05, MAST_HALF * 2, MAST_HALF, 0],
      [0.05, MAST_HALF * 2, -MAST_HALF, 0],
    ] as const) {
      const bar = box(s, w, 0.05, dark);
      place(bar, ps, y, pw);
      mast.add(bar);
    }
  }
  // Rungs up the side facing along the corridor.
  const face = MAST_HALF + 0.04;
  for (let y = 0.35; y < height; y += 0.32) {
    const rung = box(MAST_HALF * 1.6, 0.04, 0.035, steel);
    place(rung, 0, y, face);
    mast.add(rung);
  }
  // The platform: from the back of the mast out past the pipe, and a rail along the back, against the wall.
  const inner = -MAST_HALF - 0.2;
  const outer = back + PLATFORM / 2 + PLATFORM_EXTRA_OUT;
  // Wider away from the ladder's side (the rungs are at +w): the added width is all on the -w side, so the way up onto it is as it was.
  const wMid = -(PLATFORM_WIDE - PLATFORM) / 2;
  // (Their own materials, so this platform can ghost out without the rest.)
  const platform = box(outer - inner, PLATFORM_WIDE, 0.08, dark.clone());
  place(platform, (inner + outer) / 2, height - 0.04, wMid);
  mast.add(platform);
  const rail = box(0.04, PLATFORM_WIDE, 0.5, steel.clone());
  place(rail, inner, height + 0.25, wMid);
  mast.add(rail);
  const at = (s: number, w: number): { x: number; z: number } => ({ x: mast.position.x + ox * s + oz * w, z: mast.position.z + oz * s + ox * w });
  return {
    mast,
    deck: [platform, rail],
    climb: {
      foot: at(0.15, face + 0.75),
      rungs: at(0, face + CLIMB_OUT),
      ledge: at(0, face + CLIMB_OUT - MANTLE_FORWARD),
      top: { x: t.x * cell, y: height, z: t.y * cell },
      lieAt: at((inner + outer) / 2, wMid),
      facing: Math.atan2(-oz, -ox), // toward the mast, along the corridor
      out: Math.atan2(ox, oz), // out over the corridor, from the platform
    },
  };
}

/**
 * Fades the lines the agent is standing right under (floor-local (x, z)),
 * all but `keep`, and brings the rest back: from the chase camera, a pipe
 * running the way you walk would hide you. `down` false (up off the
 * floor) brings them all back.
 */
export function fadeLines(rig: PipeRig, plan: PipePlan, cell: number, x: number, z: number, down: boolean, dt: number): void {
  plan.lines.forEach((l, i) => {
    const across = Math.abs((l.axis === 'x' ? z : x) - l.at * cell);
    const want = down && across < FADE_NEAR ? FADED : 1;
    for (const mat of rig.lineMats[i]!) {
      const opacity = mat.opacity + (want - mat.opacity) * Math.min(1, dt * FADE_RATE);
      const next = Math.abs(opacity - want) < 0.01 ? want : opacity;
      const transparent = next < 1;
      if (transparent !== mat.transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = next;
      // A glow doesn't fade with opacity alone (the bloom still picks it up): it dims with it.
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.userData.glow ??= mat.emissiveIntensity;
        mat.emissiveIntensity = (mat.userData.glow as number) * next;
      }
    }
  });
}

/** Moves every pulse to where it is `t` seconds into the job: up and down its line, into the walls at either end and back. */
export function movePulses(rig: PipeRig, plan: PipePlan, cell: number, t: number): void {
  for (const p of rig.pulses) {
    const line = plan.lines[p.line]!;
    const at = pulseAlong(-cell / 2, lineLength(plan, p.line, cell) + cell / 2, PULSE_SPEED, p.phase, t);
    p.along = at.along;
    p.dir = at.dir;
    const u = line.from * cell + at.along;
    const across = line.at * cell + CONDUIT_OFFSET;
    if (line.axis === 'x') p.mesh.position.set(u, PIPE_HEIGHT + 0.05, across);
    else p.mesh.position.set(across, PIPE_HEIGHT + 0.05, u);
    const flicker = 0.8 + 0.4 * Math.abs(Math.sin(t * 47 + p.phase));
    p.mesh.scale.set(flicker, 1, flicker);
  }
}
