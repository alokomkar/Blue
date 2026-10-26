// Watchdog — a four-legged security robot that hunts by ear, not by sight.
// It roams the corridors sniffing; the moment it hears the player (noise.ts:
// walking carries a couple of cells along the corridors, sneaking a few
// steps, standing still nothing, and camo doesn't help) it runs to where the
// sound came from, and if it reaches the player the job is over. A stun
// shot doesn't drop it — only an EMP does — but it slows it for a few
// seconds, enough to get out of earshot. Sneak away from where it
// heard you, lure it with a flare, or spend a charge.
//
// From job 8 dogs hunt in packs (pack.ts, dogpack.ts): every so often the
// pack heads for a shared meeting point and sniffs around there together,
// and a dog that hears the player calls the pack-mates near it to the spot.
//
// Built from primitives (no external asset): a bevelled wedge chassis with
// an armoured back plate, hazard stripes and flank vents; a wedge sensor
// head with stereo cameras and a visor that shows its mood (amber roaming,
// bright amber sniffing, red on your trail); a blinking tail antenna; and
// four legs (actuator, thigh with a piston, knee, shin, rubber foot)
// driven by a diagonal trot.

import * as THREE from 'three';
import { markBloom, markCharacter } from '../postfx';
import { nextTag } from '../signage';
import { tagPlate } from '../signrender';
import { hasLineOfSight } from '../detection';
import type { MazeCells } from '../maze';
import { Walker } from './walker';
import { canHear } from './noise';
import { PACK_CALL_CELLS, PACK_RANGE_CELLS } from './pack';
import type { Enemy, EnemyContext, HitResult, Tool } from './types';

const ROAM_SPEED = 3.5;
const REGROUP_SPEED = 4.6; // a purposeful trot to the meeting point
const SLOWED_S = 6; // a stun shot slows it this long...
const SLOWED_TO = 0.45; // ...to this much of its speed
const TRACK_SPEED = 6.2; // outruns a sneaking player, not a walking one — but walking is loud
const CATCH_DIST = 0.9;
const CHARGE_DIST = 4; // this close with a clear line, it stops following the route and goes straight for you
const HEAR_EVERY_S = 0.2;
const SNIFF_S = 3; // at the spot it heard you, nosing around before giving up
const ROAM_PAUSE_S = [0.8, 2] as const;
const COLLAPSE_S = 0.5;
const GAIT_RATE = 3.1; // stride cycles per world unit travelled

const BODY_COLOR = 0x262b31;
const PLATE_COLOR = 0x4a525c;
const ACCENT_COLOR = 0xe0873a; // hazard orange
const VISOR = { roam: 0xff9a3c, regroup: 0xff9a3c, sniff: 0xffc15a, track: 0xff2a2a } as const;
const AT_SPOT = 0.6; // this close to its place at the meeting point counts as there

/** Roaming alone, heading for (or gathered at) the pack's meeting point, sniffing where it heard something, or on the player's trail. */
type State = 'roam' | 'regroup' | 'sniff' | 'track';

/** What a dog knows of its pack (dogpack.ts): whether it's time to meet, where to stand, and how to call the others. */
export type PackLink = {
  readonly gathering: boolean;
  readonly meetX: number;
  readonly meetZ: number;
  /** Walking distance in cells from the meeting point: the pack's ground. */
  readonly territory: number[][];
  /** This dog's own place in the huddle, around the meeting point. */
  meetSpot(dog: Watchdog): { x: number; z: number };
  /** `from` heard the player at (x, z): the pack-mates near enough come running too. */
  call(from: Watchdog, x: number, z: number, ctx: EnemyContext): void;
};
type Leg = { hip: THREE.Group; knee: THREE.Group; phase: number; side: number };

/** A side profile — (forward, up) points — extruded `width` wide and bevelled, centred, pointing down +Z. */
function sideProfile(points: Array<[number, number]>, width: number): THREE.ExtrudeGeometry {
  const bevel = 0.018;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v))), {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  g.rotateY(-Math.PI / 2); // profile forward (+x) → +Z, extrusion → -X
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export class Watchdog implements Enemy {
  readonly kind = 'watchdog';
  readonly stunImmune = true;
  readonly stunSlows = true;
  private slowedFor = 0;
  /** Blinded and deafened by a flash grenade: seconds left, and where it went off (where it goes to sniff afterwards). */
  private dazedFor = 0;
  private dazeSpot: { x: number; z: number } | null = null;
  readonly takedownable = false; // it hears you coming
  readonly radius = 0.4;
  disabled = false;
  private readonly walker: Walker;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly visor: THREE.MeshStandardMaterial;
  /** The glowing strip along its back, in the visor's colour — how you spot one coming down a dark corridor. */
  private readonly strip: THREE.MeshStandardMaterial;
  /** A small pool of light it carries on the floor around it. */
  private readonly glow: THREE.PointLight;
  private readonly legs: Leg[] = [];
  private readonly tailTip: THREE.MeshStandardMaterial;
  private t = Math.random() * 10;
  private state: State = 'roam';
  private target = { x: 0, z: 0 };
  private hearTimer = Math.random() * HEAR_EVERY_S;
  private stateTimer = 0;
  private gait = 0;
  private collapse = 0;
  private isMoving = false;
  private pack: PackLink | null = null;
  /** A section of its own to roam (the tower's): 0 inside it, -1 outside, by cell. */
  private zone: number[][] | null = null;
  private atMeet = false;
  /** Couldn't find a way to the meeting point this time round (the pack's ground is split by a locked door). */
  private cantMeet = false;

  constructor(scene: THREE.Scene, x: number, z: number, originX: number, originY: number, originZ: number) {
    this.walker = new Walker(x, z, originX, originY, originZ, 8);
    this.walker.angle = Math.random() * Math.PI * 2;

    const metal = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.38, metalness: 0.7 });
    const plate = new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.5, metalness: 0.45 });
    const hazard = new THREE.MeshStandardMaterial({ color: ACCENT_COLOR, roughness: 0.55, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.7, metalness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.9, metalness: 0 });
    this.strip = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: VISOR.roam, emissiveIntensity: 0.7 });
    this.visor = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: VISOR.roam, emissiveIntensity: 1.6 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x6fe0ff, emissiveIntensity: 1.4, roughness: 0.2 });
    this.tailTip = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: VISOR.track, emissiveIntensity: 2 });

    // The chassis: a wedge seen from the side, raised at the chest, bevelled all round.
    const chassis = new THREE.Mesh(
      sideProfile(
        [
          [-0.47, -0.08],
          [-0.47, 0.05],
          [-0.4, 0.11],
          [0.28, 0.13],
          [0.45, 0.07],
          [0.47, -0.05],
          [0.4, -0.12],
          [-0.4, -0.12],
        ],
        0.34
      ),
      metal
    );
    this.body.add(chassis);
    // An armoured plate along the back with a hazard stripe down it, and the glowing strip set into it.
    this.body.add(part(new THREE.BoxGeometry(0.26, 0.035, 0.62), plate, 0, 0.14, -0.03));
    // Its model and serial, small, across the rump of the back plate.
    const tag = tagPlate(nextTag('dog'), 0.24, 'rgba(176,184,188,0.7)');
    tag.rotation.x = -Math.PI / 2;
    tag.rotation.z = Math.PI;
    tag.position.set(0, 0.162, -0.3);
    this.body.add(tag);
    for (const side of [-1, 1]) this.body.add(part(new THREE.BoxGeometry(0.025, 0.037, 0.62), hazard, side * 0.1, 0.142, -0.03));
    const strip = part(new THREE.BoxGeometry(0.04, 0.02, 0.5), this.strip, 0, 0.165, -0.05);
    markBloom(strip);
    this.body.add(strip);
    // Dark vent panels on the flanks, and a sensor bar across the chest.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) this.body.add(part(new THREE.BoxGeometry(0.01, 0.07, 0.035), dark, side * 0.183, 0.0, -0.1 + i * 0.06));
    }
    const chestBar = part(new THREE.BoxGeometry(0.22, 0.025, 0.012), this.strip, 0, 0.04, 0.472);
    markBloom(chestBar);
    this.body.add(chestBar);

    // A short neck to a wedge-shaped sensor head: stereo cameras, the mood visor, two sensor fins and a jaw plate.
    const neck = part(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10), dark, 0, 0.14, 0.42);
    neck.rotation.x = 0.7;
    this.body.add(neck);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.29, 0.54);
    this.head.add(
      new THREE.Mesh(
        sideProfile(
          [
            [-0.13, -0.07],
            [-0.13, 0.07],
            [0.06, 0.09],
            [0.2, 0.02],
            [0.21, -0.04],
            [0.12, -0.08],
          ],
          0.2
        ),
        metal
      )
    );
    this.head.add(part(new THREE.BoxGeometry(0.16, 0.03, 0.18), plate, 0, 0.085, 0.0));
    const jaw = part(new THREE.BoxGeometry(0.14, 0.03, 0.14), dark, 0, -0.085, 0.07);
    jaw.rotation.x = -0.12;
    this.head.add(jaw);
    const visor = part(new THREE.BoxGeometry(0.19, 0.03, 0.02), this.visor, 0, 0.035, 0.155);
    visor.rotation.x = -0.45;
    markBloom(visor);
    this.head.add(visor);
    for (const side of [-1, 1]) {
      const lens = part(new THREE.CircleGeometry(0.018, 12), lensMat, side * 0.045, -0.015, 0.205);
      markBloom(lens);
      this.head.add(lens);
      const fin = part(new THREE.BoxGeometry(0.02, 0.1, 0.08), hazard, side * 0.075, 0.12, -0.07);
      fin.rotation.set(-0.35, 0, side * 0.3);
      this.head.add(fin);
    }
    this.body.add(this.head);

    // A tail antenna, its tip blinking.
    const tail = part(new THREE.CylinderGeometry(0.01, 0.014, 0.34, 5), dark, 0, 0.26, -0.5);
    tail.rotation.x = -0.5;
    this.body.add(tail);
    const tip = part(new THREE.SphereGeometry(0.022, 8, 6), this.tailTip, 0, 0.41, -0.585);
    markBloom(tip);
    this.body.add(tip);

    this.body.position.y = 0.6;
    this.root.add(this.body);

    // Legs: an actuator housing at each corner, a tapered thigh with a hydraulic piston along it, a knee joint,
    // and a shin ending in a rubber foot — knees bent back like a real quadruped robot.
    const upperGeo = new THREE.BoxGeometry(0.07, 0.3, 0.09);
    upperGeo.translate(0, -0.15, 0);
    const lowerGeo = new THREE.CylinderGeometry(0.03, 0.022, 0.32, 8);
    lowerGeo.translate(0, -0.16, 0);
    const pistonGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6);
    pistonGeo.translate(0, -0.13, 0);
    const actuatorGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 14);
    actuatorGeo.rotateZ(Math.PI / 2);
    const jointGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12);
    jointGeo.rotateZ(Math.PI / 2);
    for (const [sx, sz, phase] of [
      [1, 1, 0],
      [-1, -1, 0],
      [-1, 1, Math.PI],
      [1, -1, Math.PI],
    ] as const) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.21, -0.05, sz * 0.34);
      hip.add(part(actuatorGeo, plate, sx * 0.01, 0, 0));
      hip.add(new THREE.Mesh(upperGeo, metal));
      hip.add(part(pistonGeo, dark, 0, -0.02, -0.055));
      const knee = new THREE.Group();
      knee.position.y = -0.3;
      knee.add(part(jointGeo, dark, 0, 0, 0));
      knee.add(new THREE.Mesh(lowerGeo, metal));
      knee.add(part(new THREE.SphereGeometry(0.04, 8, 6), rubber, 0, -0.33, 0));
      hip.add(knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, phase, side: sx });
    }

    this.glow = new THREE.PointLight(VISOR.roam, 2.2, 4.5);
    this.glow.position.set(0, 0.9, 0.3);
    this.root.add(this.glow);

    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    markCharacter(scene, this.root);
    this.sync(0);
  }

  get worldX(): number {
    return this.walker.pos.x;
  }
  get worldZ(): number {
    return this.walker.pos.z;
  }
  get floorY(): number {
    return this.walker.pos.y;
  }
  get moving(): boolean {
    return this.isMoving && !this.disabled;
  }
  get facing(): number {
    return this.walker.angle;
  }
  get alert(): boolean {
    return this.state === 'track' && !this.disabled;
  }

  /** At its place in the pack's huddle. */
  get atMeetingPoint(): boolean {
    return !this.disabled && this.state === 'regroup' && this.atMeet;
  }

  /** Keeps the dog to a part of the floor: `zone` is 0 in the cells it roams and -1 elsewhere (a chase still takes it anywhere). */
  setZone(zone: number[][] | null): void {
    this.zone = zone;
  }

  joinPack(pack: PackLink): void {
    this.pack = pack;
  }

  /** A pack-mate heard the player at (x, z): run there too, if it's close enough to matter. */
  answerCall(x: number, z: number, ctx: EnemyContext): void {
    if (this.disabled || this.state === 'track') return;
    const d = this.walker.stepsTo(x, z, ctx.cells, ctx.cols, ctx.rows);
    if (d < 0 || d > PACK_CALL_CELLS) return;
    this.hunt(x, z, ctx);
  }

  /** Blinded and deafened right now (a flash or a shock grenade). */
  get dazed(): boolean {
    return this.dazedFor > 0;
  }

  /** The model, for infrared (infrared.ts) to redraw as a silhouette. */
  get model(): THREE.Object3D {
    return this.root;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  hit(tool: Tool): HitResult {
    if (this.disabled) return 'immune';
    if (tool === 'stun') {
      this.slowedFor = SLOWED_S;
      return 'slowed';
    }
    if (tool !== 'emp') return 'immune';
    this.disabled = true;
    this.visor.emissiveIntensity = 0;
    this.strip.emissiveIntensity = 0;
    this.glow.intensity = 0;
    this.tailTip.emissiveIntensity = 0;
    return 'disabled';
  }

  /** Blinded and deafened by a flash grenade at (x, z): it loses the trail and staggers about, then goes to sniff at where it went off. */
  daze(seconds: number, x: number, z: number): boolean {
    if (this.disabled) return false;
    this.dazedFor = Math.max(this.dazedFor, seconds);
    this.dazeSpot = { x, z };
    this.setState('roam');
    this.stateTimer = 0;
    return true;
  }

  relocate(x: number, z: number): void {
    this.walker.place(x, z);
    this.setState('roam');
    this.stateTimer = 0;
    this.dazedFor = 0;
    this.dazeSpot = null;
    this.hearTimer = 3;
    this.sync(0);
  }

  calm(): void {
    this.slowedFor = SLOWED_S;
    this.hearTimer = 2;
    if (this.state === 'track' || this.state === 'sniff') this.setState('roam');
    this.stateTimer = 0;
  }

  /** Noises (a flare landing) pull it over from further than a patrol bot would come. */
  investigate(x: number, z: number, seconds: number, cells: MazeCells, cols: number, rows: number, maxCells: number): boolean {
    if (this.disabled || this.state === 'track') return false;
    const d = this.walker.pathTo(x, z, cells, cols, rows);
    if (d < 0 || d > maxCells * 2) return false;
    this.setState('track');
    this.target = { x, z };
    this.stateTimer = seconds;
    return true;
  }

  private hunt(x: number, z: number, ctx: EnemyContext): void {
    this.target = { x, z };
    this.walker.pathTo(x, z, ctx.cells, ctx.cols, ctx.rows);
    this.setState('track');
    this.stateTimer = 0;
  }

  /** Off to somewhere new: anywhere for a lone dog, within the pack's ground for one in a pack. */
  private wander(ctx: EnemyContext): void {
    this.walker.roam(ctx.cells, ctx.cols, ctx.rows, 4, this.pack ? { dist: this.pack.territory, max: PACK_RANGE_CELLS } : this.zone ? { dist: this.zone, max: 0 } : undefined);
  }

  /** Sets off for its place at the meeting point. */
  private regroup(ctx: EnemyContext): void {
    const spot = this.pack!.meetSpot(this);
    this.atMeet = false;
    if (this.walker.pathTo(spot.x, spot.z, ctx.cells, ctx.cols, ctx.rows) < 0) {
      this.cantMeet = true;
      this.wander(ctx);
      return;
    }
    this.setState('regroup');
  }

  private setState(state: State): void {
    this.state = state;
    this.visor.emissive.setHex(VISOR[state]);
    this.visor.emissiveIntensity = state === 'track' ? 3 : state === 'sniff' ? 2.2 : 1.6;
    this.strip.emissive.setHex(VISOR[state]);
    this.strip.emissiveIntensity = state === 'track' ? 1.6 : 0.7;
    this.glow.color.setHex(VISOR[state]);
    this.glow.intensity = state === 'track' ? 5 : 2.2;
  }

  update(ctx: EnemyContext, dt: number): void {
    if (ctx.practiceTarget && !this.disabled) return;
    this.walker.obstacles = ctx.wallBoxes;
    if (this.disabled) {
      // Shorts out: the legs splay and it drops onto its belly.
      if (this.collapse < 1) {
        this.collapse = Math.min(1, this.collapse + dt / COLLAPSE_S);
        const e = this.collapse * this.collapse;
        this.body.position.y = 0.6 - 0.42 * e;
        this.head.rotation.x = 0.7 * e;
        for (const leg of this.legs) {
          leg.hip.rotation.set(0, 0, leg.side * 1.25 * e);
          leg.knee.rotation.x = 0;
        }
      }
      return;
    }

    this.t += dt;
    // Blinded and deafened by a flash: no hearing, no mauling; it staggers about until it comes round.
    if (this.dazedFor > 0) {
      this.dazedFor = Math.max(0, this.dazedFor - dt);
      this.walker.angle += Math.sin(this.t * 3.1) * dt * 3;
      this.isMoving = false;
      this.sync(0);
      if (this.dazedFor === 0 && this.dazeSpot) {
        const spot = this.dazeSpot;
        this.dazeSpot = null;
        this.investigate(spot.x, spot.z, 6, ctx.cells, ctx.cols, ctx.rows, 99);
      }
      return;
    }
    this.slowedFor = Math.max(0, this.slowedFor - dt);
    const slow = this.slowedFor > 0 ? SLOWED_TO : 1;
    this.tailTip.emissiveIntensity = Math.sin(this.t * (this.state === 'track' ? 12 : 3)) > 0.6 ? 2.6 : 0.15;
    const w = this.walker;
    const toPlayer = Math.hypot(ctx.playerX - w.pos.x, ctx.playerZ - w.pos.z);
    if (toPlayer < CATCH_DIST && !ctx.enclosed && !ctx.unreachable) {
      // A silent night: a dog that brushes against an agent holding perfectly still has nothing to hear, so it stops and sniffs nose to nose, and the round goes
      // on. One step, and it has you.
      if (ctx.silentNight && ctx.noise === 0 && this.state !== 'track') {
        if (this.state !== 'sniff') {
          this.setState('sniff');
          this.stateTimer = SNIFF_S;
        }
      } else {
        ctx.onCaught(this, 'Mauled by a watchdog', 'A watchdog heard you and ran you down.');
        return;
      }
    }

    // Listening, a few times a second: hearing the player puts it on their trail.
    this.hearTimer -= dt;
    if (this.hearTimer <= 0) {
      this.hearTimer = HEAR_EVERY_S;
      if (canHear(ctx.noise, ctx.soundDistance(w.pos.x, w.pos.z))) {
        const fresh = this.state !== 'track';
        this.hunt(ctx.playerX, ctx.playerZ, ctx);
        if (fresh) this.pack?.call(this, ctx.playerX, ctx.playerZ, ctx);
      }
    }

    let moved = false;
    let speed = 0;
    if (this.state === 'track') {
      speed = TRACK_SPEED * slow;
      const tgt = this.target;
      const nearTarget = Math.hypot(tgt.x - w.pos.x, tgt.z - w.pos.z);
      if (nearTarget < CHARGE_DIST && hasLineOfSight(w.pos.x, w.pos.z, tgt.x, tgt.z, ctx.wallBoxes, CHARGE_DIST)) {
        moved = w.moveToward(tgt.x, tgt.z, speed, dt);
      } else {
        moved = w.follow(dt, speed);
        if (w.routeDone && !moved) moved = w.moveToward(tgt.x, tgt.z, speed, dt);
      }
      if (nearTarget < 0.3) {
        this.setState('sniff');
        this.stateTimer = SNIFF_S;
      }
    } else if (this.state === 'sniff') {
      this.stateTimer -= dt;
      w.angle += Math.sin(this.stateTimer * 2.4) * dt * 2;
      if (this.stateTimer <= 0) {
        this.setState('roam');
        if (this.pack?.gathering && !this.cantMeet) this.regroup(ctx);
        else this.wander(ctx);
      }
    } else if (this.state === 'regroup') {
      const pack = this.pack!;
      if (!pack.gathering) {
        // Splitting up again.
        this.setState('roam');
        this.atMeet = false;
        this.wander(ctx);
      } else {
        const spot = pack.meetSpot(this);
        const d = Math.hypot(spot.x - w.pos.x, spot.z - w.pos.z);
        this.atMeet = d < AT_SPOT;
        if (d > 0.15) {
          speed = REGROUP_SPEED * slow;
          moved = w.follow(dt, speed);
          if (w.routeDone && !moved) moved = w.moveToward(spot.x, spot.z, speed, dt);
        } else {
          // Gathered: nose toward the middle of the huddle, sniffing about.
          w.faceToward(pack.meetX + Math.sin(this.t * 0.9) * 1.5, pack.meetZ + Math.cos(this.t * 0.9) * 1.5, dt * 0.4);
        }
      }
    } else if (this.pack?.gathering && !this.cantMeet) {
      this.regroup(ctx);
    } else {
      if (!this.pack?.gathering) this.cantMeet = false;
      speed = ROAM_SPEED * slow;
      moved = w.follow(dt, speed);
      if (w.routeDone) {
        // A pause to sniff the air between legs of its round.
        if (this.stateTimer <= 0) this.stateTimer = ROAM_PAUSE_S[0] + Math.random() * (ROAM_PAUSE_S[1] - ROAM_PAUSE_S[0]);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.wander(ctx);
      }
    }
    this.isMoving = moved;
    if (moved) this.gait += speed * dt * GAIT_RATE;
    this.sync(moved ? Math.min(1, speed / TRACK_SPEED + 0.35) : 0);
  }

  /** Places the model and poses the legs: a diagonal trot while moving (`stride` 0–1), standing square when still. */
  private sync(stride: number): void {
    const w = this.walker;
    this.root.position.copy(w.pos);
    this.root.rotation.y = w.angle;
    this.body.position.y = 0.6 + (stride > 0 ? Math.abs(Math.sin(this.gait)) * 0.03 : 0);
    for (const leg of this.legs) {
      // Hip swings the leg fore and aft; the knee only lifts the foot on the forward (swing) half.
      const swing = Math.sin(this.gait + leg.phase) * stride;
      const lift = Math.max(0, Math.cos(this.gait + leg.phase)) * stride;
      leg.hip.rotation.x = 0.28 - swing * 0.38;
      leg.knee.rotation.x = -0.5 - lift * 0.45;
    }
    this.head.rotation.y =
      this.state === 'sniff' ? Math.sin(this.stateTimer * 5) * 0.5 : this.atMeetingPoint && stride === 0 ? Math.sin(this.t * 3.2) * 0.45 : 0;
  }
}
