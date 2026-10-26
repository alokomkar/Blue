// Laser trip-beams — a corridor hazard that blocks the player's way unless
// their camo is on (camo.ts): the beam can't register a cloaked body. It
// always recharges, so a beam never makes a job unwinnable. Deliberately a real
// physical block rather than a "walk through it and get penalized" trap —
// simpler to read at a glance (a glowing red beam across the corridor is
// self-explanatory; no separate toast/tell is needed the way a hidden
// pressure-plate trap would need one), and unambiguously forces the
// intended behavior instead of just discouraging the alternative.
//
// Only placed at a clean straight-through corridor cell (exactly one pair
// of opposite openings, same shape as the "pass-through" cells counted in
// maze.test.ts's corridor-bias check) so there's never any ambiguity about
// which way the beam should face — see maze.ts's placeLaserTraps().
//
// Deliberately NOT added to the scene's shared wallBoxes list: a beam is
// thin, not a solid wall, so it shouldn't block a bot's line of sight
// (detection.ts) or the torch's floor-reveal cone (vision.ts) the way a
// real wall does — only player.ts's own movement treats it specially, via
// tick()'s separate laserBoxes param.

import * as THREE from 'three';
import { CELL, type WallBox } from './scene';
import { markBloom } from './postfx';
import { GATE_BEAMS, pulseState, type Gate, type GateKind } from './evade';
import { LINE_HIGH, lineHeight, lineOffset, lineSide, type LineLaser } from './linelasers';
import { SLIDE_SPEED, SWEEP_HEIGHT, SWEEP_REACH, slidePosition, sweepAngle, type Slider, type Sweeper } from './movingLasers';

const LASER_COLOR = 0xff2e3d;
const BEAM_HEIGHTS = [0.85, 1.25]; // two beams read as a real "laser grid," not a single trip-wire
const BEAM_LENGTH = CELL - 0.4;

export type LaserTrap = { x: number; y: number; spanX: boolean };

/** Two glowing beams spanning the corridor's actual open direction, plus a matching point light so the danger reads from further down the hall. */
export function buildLaserMesh(t: LaserTrap): THREE.Object3D {
  const group = new THREE.Group();
  group.position.set(t.x * CELL, 0, t.y * CELL);

  const mat = new THREE.MeshStandardMaterial({ color: LASER_COLOR, emissive: LASER_COLOR, emissiveIntensity: 2.4, roughness: 0.3 });
  for (const h of BEAM_HEIGHTS) {
    const geo = new THREE.CylinderGeometry(0.025, 0.025, BEAM_LENGTH, 6);
    const mesh = new THREE.Mesh(geo, mat);
    // CylinderGeometry runs along Y by default; rotate it flat and onto
    // whichever horizontal axis the corridor actually opens along.
    if (t.spanX) mesh.rotation.z = Math.PI / 2;
    else mesh.rotation.x = Math.PI / 2;
    mesh.position.y = h;
    group.add(mesh);
  }
  const glow = new THREE.PointLight(LASER_COLOR, 10, 5);
  glow.userData.keepInDark = true; // a laser runs on its own power: it still glows in a blackout
  group.add(glow);
  markBloom(group);
  return group;
}

/** The cell's full footprint — a laser trap blocks the whole cell (while standing), not just a thin strip, since a straight-through cell only has the two opposite openings to begin with. */
export function laserTrapBox(t: LaserTrap): WallBox {
  const wx = t.x * CELL;
  const wz = t.y * CELL;
  const half = CELL / 2 - 0.15;
  return { minX: wx - half, maxX: wx + half, minZ: wz - half, maxZ: wz + half };
}

/** A moving laser's 3D side: its group (floor-local), moved to where it is at `t` seconds by update(). */
export type MovingLaserRig = { group: THREE.Group; update: (t: number) => void; /** Where its hum comes from, floor-local, as of the last update. */ hum: THREE.Vector3 };

function laserMaterial(color = LASER_COLOR): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.3 });
}

/** A sweeper: a post in the middle of the junction with a head turning a single beam round at chest height. */
export function buildSweeperMesh(s: Sweeper): MovingLaserRig {
  const group = new THREE.Group();
  group.position.set(s.x * CELL, 0, s.y * CELL);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, SWEEP_HEIGHT - 0.08, 10), metal);
  post.position.y = (SWEEP_HEIGHT - 0.08) / 2;
  group.add(post);
  const spinner = new THREE.Group();
  spinner.position.y = SWEEP_HEIGHT;
  group.add(spinner);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), metal);
  spinner.add(head);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, SWEEP_REACH * 2, 6), laserMaterial());
  beam.rotation.z = Math.PI / 2; // along the spinner's x
  markBloom(beam);
  spinner.add(beam);
  const glow = new THREE.PointLight(LASER_COLOR, 8, 5);
  glow.userData.keepInDark = true;
  glow.position.y = SWEEP_HEIGHT;
  group.add(glow);
  const hum = new THREE.Vector3(s.x * CELL, SWEEP_HEIGHT, s.y * CELL);
  // three's rotation.y turns +x toward -z; the sweep angle turns +x toward +z.
  return { group, hum, update: (t) => void (spinner.rotation.y = -sweepAngle(s, t)) };
}

const CURTAIN_HEIGHTS = [0.3, 0.75, 1.2, 1.65];

const FAST_LASER_COLOR = 0xff7a2e; // a fast curtain burns hotter: it reads apart from a slow one at a glance

/** A slider: a rail along either wall of its stretch, and a curtain of beams between two emitters riding them. */
export function buildSliderMesh(s: Slider): MovingLaserRig {
  const fast = s.speed > SLIDE_SPEED;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 });
  const alongX = s.axis === 'x';
  const across = s.at * CELL;
  const start = s.from * CELL - CELL / 2;
  const length = (s.to - s.from + 1) * CELL;
  const inset = CELL / 2 - 0.22; // the rails, just off the side walls
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : 0.08, 0.05, alongX ? 0.08 : length), metal);
    if (alongX) rail.position.set(start + length / 2, 0.03, across + side * inset);
    else rail.position.set(across + side * inset, 0.03, start + length / 2);
    group.add(rail);
  }
  const curtain = new THREE.Group();
  group.add(curtain);
  const span = CELL - 0.44;
  for (const side of [-1, 1]) {
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), metal);
    if (alongX) emitter.position.set(0, 0.95, side * inset);
    else emitter.position.set(side * inset, 0.95, 0);
    curtain.add(emitter);
  }
  const mat = laserMaterial(fast ? FAST_LASER_COLOR : LASER_COLOR);
  for (const h of CURTAIN_HEIGHTS) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, span, 6), mat);
    if (alongX) beam.rotation.x = Math.PI / 2; // across the corridor, along z
    else beam.rotation.z = Math.PI / 2;
    beam.position.y = h;
    markBloom(beam);
    curtain.add(beam);
  }
  const glow = new THREE.PointLight(fast ? FAST_LASER_COLOR : LASER_COLOR, 8, 5);
  glow.userData.keepInDark = true;
  glow.position.y = 1;
  curtain.add(glow);
  const hum = new THREE.Vector3();
  return {
    group,
    hum,
    update: (t) => {
      const u = slidePosition(s, t, CELL);
      if (alongX) curtain.position.set(u, 0, across);
      else curtain.position.set(across, 0, u);
      hum.set(curtain.position.x, 1, curtain.position.z);
    },
  };
}

const GATE_COLORS: Record<GateKind, number> = { duck: 0xff2e3d, crawl: 0xff2ea6, pulse: 0xffc23a }; // red to duck, magenta to crawl, amber to wait out

/** A gate's 3D side: posts either side of the corridor, the beams between them, and a stripe on the floor in the same colour. A pulsing one blinks, and flickers before it comes back on. */
export type GateRig = { group: THREE.Group; update: (t: number) => void };

export function buildGateMesh(g: Gate): GateRig {
  const group = new THREE.Group();
  group.position.set(g.x * CELL, 0, g.y * CELL);
  const color = GATE_COLORS[g.kind];
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 });
  const mat = laserMaterial(color);
  const inset = CELL / 2 - 0.22;
  const span = CELL - 0.44;
  const top = g.kind === 'crawl' ? 1.9 : g.kind === 'duck' ? 2.05 : 1.9;
  const beams: THREE.Mesh[] = [];
  // Beams run across the corridor: along x when the corridor runs north-south (spanX), else along z.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, top, 0.12), metal);
    if (g.spanX) post.position.set(side * inset, top / 2, 0);
    else post.position.set(0, top / 2, side * inset);
    group.add(post);
  }
  for (const h of GATE_BEAMS[g.kind]) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, span, 6), mat);
    if (g.spanX) beam.rotation.z = Math.PI / 2;
    else beam.rotation.x = Math.PI / 2;
    beam.position.y = h;
    markBloom(beam);
    group.add(beam);
    beams.push(beam);
  }
  const stripeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(g.spanX ? span : 0.16, 0.02, g.spanX ? 0.16 : span), stripeMat);
  stripe.position.y = 0.02;
  group.add(stripe);
  const glow = new THREE.PointLight(color, 5, 4);
  glow.userData.keepInDark = true;
  glow.position.y = 1.1;
  group.add(glow);
  return {
    group,
    update: (t) => {
      if (g.kind !== 'pulse') return;
      const { on, warn } = pulseState(g.phase, t);
      // Off but about to come back: flicker, so the gap is never a surprise.
      const flick = warn && Math.floor(t * 14) % 2 === 0;
      for (const b of beams) b.visible = on || flick;
      stripeMat.opacity = on ? 0.7 : warn ? 0.45 : 0.15;
      glow.intensity = on ? 5 : flick ? 3 : 0;
    },
  };
}

const LINE_TOP = 2.35; // where a vertical line hangs from: the ceiling track
const LINE_VERTICAL_COLOR = 0xff8a2e; // a sweeping line burns orange, a rising one red

/** A group of line lasers (linelasers.ts): each a single beam across the corridor, riding up and down on a post at either wall (horizontal) or hanging from a ceiling track and sliding from wall to wall (vertical). */
export function buildLineMesh(g: LineLaser): MovingLaserRig {
  const group = new THREE.Group();
  group.position.set(g.x * CELL, 0, g.y * CELL);
  const color = g.orient === 'h' ? LASER_COLOR : LINE_VERTICAL_COLOR;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.5 });
  const mat = laserMaterial(color);
  const inset = CELL / 2 - 0.22;
  const span = CELL - 0.44;
  // Along the corridor is z when the beams run along x (spanX), else x: `place` puts something at (across, y, along).
  const place = (o: THREE.Object3D, across: number, y: number, along: number): void => void o.position.set(g.spanX ? across : along, y, g.spanX ? along : across);
  const lines: Array<(t: number) => void> = [];
  for (let i = 0; i < g.count; i++) {
    const along = lineOffset(g, i);
    if (g.orient === 'h') {
      // A post up each wall and a small emitter riding it, the beam between the two emitters.
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, LINE_HIGH + 0.2, 0.06), metal);
        place(post, side * inset, (LINE_HIGH + 0.2) / 2, along);
        group.add(post);
      }
      const emitters = [-1, 1].map(() => {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), metal);
        group.add(e);
        return e;
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, span, 6), mat);
      if (g.spanX) beam.rotation.z = Math.PI / 2;
      else beam.rotation.x = Math.PI / 2;
      markBloom(beam);
      group.add(beam);
      lines.push((t) => {
        const h = lineHeight(g, i, t);
        place(beam, 0, h, along);
        emitters.forEach((e, k) => place(e, (k === 0 ? -1 : 1) * inset, h, along));
      });
    } else {
      // A track across the ceiling, a head sliding on it, and a beam hanging from the head to its lower end.
      const track = new THREE.Mesh(new THREE.BoxGeometry(g.spanX ? span + 0.2 : 0.06, 0.06, g.spanX ? 0.06 : span + 0.2), metal);
      place(track, 0, LINE_TOP, along);
      group.add(track);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), metal);
      group.add(head);
      const length = LINE_TOP - g.gap;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, length, 6), mat);
      markBloom(beam);
      group.add(beam);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
      markBloom(tip);
      group.add(tip);
      lines.push((t) => {
        const s = lineSide(g, i, t, CELL);
        place(head, s, LINE_TOP, along);
        place(beam, s, g.gap + length / 2, along);
        place(tip, s, g.gap, along);
      });
    }
  }
  const glow = new THREE.PointLight(color, 5, 4);
  glow.userData.keepInDark = true;
  glow.position.y = 1.1;
  group.add(glow);
  const hum = new THREE.Vector3(g.x * CELL, 1, g.y * CELL);
  return { group, hum, update: (t) => lines.forEach((u) => u(t)) };
}
