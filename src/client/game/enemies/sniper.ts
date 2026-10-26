// The sniper — the tower's signature threat (docs/GAMEPLAY.md, section 3). It stands on a post on an upper storey (sniperposts.ts picks them), a rail sentry with a rifle: its thin red laser
// sweeps a long, narrow lane (across the atrium, over a rail, down a hall) and tells you where it is looking. A look that stays on the agent makes it lock; it then tracks them for the aim,
// 1.5 s, and fires: a hit costs what a guard's does and a little more (game.ts's onShot), a dodge makes it miss. Break the line for more than a heartbeat and the aim starts over from nothing
// (the rules are sniperaim.ts's): cover, low furniture when crouched or lying flat, a smoke cloud, a flash, a cloaked stand-still. It looks along its own floor only: nothing it sees is on
// another storey, and a stun shot or a takedown reaches it only from its own. From behind it can be taken down; a stun shot or an EMP drops it, for good (an EMP shorts out its scope).
// It shoots the AI partner too, with a lower chance to hit. Built from primitives, like the watchdog, with the Quaternius rail sniper (public/models/guns) in its hands; the guards' body
// (bots.ts) is not reused, as it would mean changing that file.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markBloom, markCharacter } from '../postfx';
import { lineClearOver } from '../detection';
import { smokeBlocks } from '../smoke';
import { traceEndWith } from '../traceend';
import type { WallBox } from '../scene';
import { LASER_HALF, LOCK_HALF, START, TRACK_RATE, aimed, lands, look, pickTarget, stepAim, sweepAngle, turnToward, type AimState, type Mark } from './sniperaim';
import type { Enemy, EnemyContext, HitResult, Tool } from './types';

const RIFLE_URL = '/models/guns/Sniper_2.gltf';
const RIFLE_LENGTH = 1.25;
/** Fractions along the rifle's box (the pack's guns lie along +X): where the hands hold it (bigguns.ts's spec for this gun). */
const RIFLE_GRIP: readonly [number, number] = [0.38, 0.2];
const EYE_Y = 1.55;
const MUZZLE = { forward: 1.0, up: 1.34 };
const FALL_S = 0.55;
const RECOIL_S = 0.5;
const LASER = 0xff2a1e;
const LASER_HOT = 0xffd0c4;
const LONG = 60;

let rifle: Promise<THREE.Group> | null = null;
const loadRifle = (): Promise<THREE.Group> => (rifle ??= new GLTFLoader().loadAsync(RIFLE_URL).then((g) => g.scene));

const fx = (o: THREE.Object3D): void => {
  o.userData.fx = true; // skipped by the bloom pass's dark-material render (postfx.ts)
};

export class Sniper implements Enemy {
  readonly kind = 'sniper';
  readonly stunImmune = false;
  readonly takedownable = true;
  readonly radius = 0.34;
  disabled = false;
  private readonly post: { x: number; z: number; facing: number };
  private readonly phase: number;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly stand: THREE.Group;
  private readonly visorMat: THREE.MeshStandardMaterial;
  private readonly beam = new THREE.Group();
  private readonly beamCore: THREE.Mesh;
  private readonly beamHalo: THREE.Mesh;
  private readonly dot: THREE.Mesh;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly dotMat: THREE.MeshBasicMaterial;
  private readonly y: number;
  private angle: number;
  private state: AimState = { ...START };
  private lockedOn: 'player' | 'partner' | null = null;
  private visible = true;
  private t = 0;
  private fall = 0;
  private recoil = 0;
  private dazed = 0;
  private beamOn = true;

  /** `roll`: where its rolls to hit come from (a seeded stream keeps a job's shots repeatable; the default is Math.random). */
  constructor(scene: THREE.Scene, x: number, z: number, floorY: number, facing: number, phase = 0, private readonly roll: () => number = Math.random) {
    this.post = { x, z, facing };
    this.phase = phase;
    this.y = floorY;
    this.angle = facing;

    const suit = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.8 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x3a3f33, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7, metalness: 0.2 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x1a0c0c, emissive: LASER, emissiveIntensity: 1.6, roughness: 0.3 });
    const box = (w: number, h: number, d: number, m: THREE.Material, px: number, py: number, pz: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      return mesh;
    };
    // A standing figure, 1.8 m: legs, torso with a vest and a pack, a helmet with a red visor.
    this.stand = new THREE.Group();
    this.stand.add(box(0.15, 0.85, 0.2, suit, -0.11, 0.425, 0), box(0.15, 0.85, 0.2, suit, 0.11, 0.425, 0));
    this.stand.add(box(0.44, 0.6, 0.26, suit, 0, 1.15, 0), box(0.46, 0.4, 0.3, vest, 0, 1.2, 0.01), box(0.34, 0.42, 0.14, dark, 0, 1.2, -0.2));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10), suit);
    head.position.set(0, 1.63, 0.01);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), dark);
    helmet.position.copy(head.position);
    const visor = box(0.2, 0.05, 0.05, this.visorMat, 0, 1.64, 0.115);
    markBloom(visor);
    this.stand.add(head, helmet, visor);
    // Arms forward to the rifle, shoulder-high.
    for (const sx of [-1, 1] as const) {
      const arm = box(0.09, 0.09, 0.5, suit, sx * 0.24, 1.34, 0.26);
      arm.rotation.x = 0.12;
      arm.rotation.y = -sx * 0.18;
      this.stand.add(arm);
    }
    this.body.add(this.stand);

    // The rifle: a plain barrel and scope until the model has loaded.
    const stub = new THREE.Group();
    stub.add(box(0.06, 0.09, 1.0, dark, 0, 0, 0.5), box(0.05, 0.05, 0.22, dark, 0, 0.08, 0.35));
    this.gun.add(stub);
    this.gun.position.set(0.09, 1.3, 0.12);
    this.body.add(this.gun);
    void loadRifle().then((src) => {
      const model = src.clone(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const bounds = new THREE.Box3().setFromObject(model);
      const k = RIFLE_LENGTH / Math.max(0.01, size.x);
      const grip = new THREE.Vector3(bounds.min.x + RIFLE_GRIP[0] * size.x, bounds.min.y + RIFLE_GRIP[1] * size.y, (bounds.min.z + bounds.max.z) / 2);
      model.position.set(-grip.x, -grip.y, -grip.z);
      const holder = new THREE.Group();
      holder.add(model);
      holder.scale.setScalar(k);
      holder.rotation.y = -Math.PI / 2; // the muzzle to +Z
      holder.position.set(0, 0, 0.36);
      this.gun.remove(stub);
      this.gun.add(holder);
    });
    this.root.add(this.body);

    // The laser: a thin core with a soft halo, and the dot where it ends.
    const mat = (opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: LASER, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.coreMat = mat(0.9);
    this.haloMat = mat(0.12);
    this.dotMat = mat(0.9);
    this.beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 6, 1, true), this.coreMat);
    this.beamHalo = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10, 1, true), this.haloMat);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.dotMat);
    for (const o of [this.beam, this.beamCore, this.beamHalo, this.dot]) fx(o);
    this.beam.add(this.beamCore, this.beamHalo);
    this.beam.visible = false;
    this.dot.visible = false;
    scene.add(this.root, this.beam, this.dot);
    markCharacter(scene, this.body);
    this.place();
  }

  get worldX(): number {
    return this.post.x;
  }
  get worldZ(): number {
    return this.post.z;
  }
  get floorY(): number {
    return this.y;
  }
  get facing(): number {
    return this.angle;
  }
  /** Standing at its post: never walks. */
  get moving(): boolean {
    return false;
  }
  /** Locked on (aiming): the alert chirp, the heartbeat and the hint follow it. */
  get alert(): boolean {
    return this.state.phase === 'lock' && !this.disabled;
  }
  /** Who it has locked on, for the game to read. */
  get lockedWho(): 'player' | 'partner' | null {
    return this.alert ? this.lockedOn : null;
  }
  /** How far the aim has got, 0 to 1. */
  get aim(): number {
    return aimed(this.state);
  }
  /** Where its round leaves: the rifle's muzzle. */
  get muzzleWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.post.x + Math.sin(this.angle) * MUZZLE.forward, this.y + MUZZLE.up, this.post.z + Math.cos(this.angle) * MUZZLE.forward);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.visible = visible;
    this.syncBeam();
  }

  /** The agent slipped away (a checkpoint): the lock goes and it is back to sweeping. */
  calm(): void {
    this.state = { ...START };
    this.lockedOn = null;
  }

  /** Blinded and deafened by a flash: the laser goes out, and it sees nothing for `seconds`. */
  daze(seconds: number): boolean {
    if (this.disabled) return false;
    this.dazed = Math.max(this.dazed, seconds);
    this.state = { ...START };
    this.lockedOn = null;
    return true;
  }

  /** Dropped by a stun shot, a takedown or an EMP (which shorts the scope): for good. */
  hit(tool: Tool): HitResult {
    if (this.disabled) return 'immune';
    void tool;
    this.disabled = true;
    this.state = { ...START };
    this.lockedOn = null;
    this.visorMat.emissiveIntensity = 0;
    this.beamOn = false;
    this.syncBeam();
    return 'disabled';
  }

  update(ctx: EnemyContext, dt: number): void {
    this.t += dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt / RECOIL_S);
    if (this.disabled) {
      this.fall = Math.min(1, this.fall + dt / FALL_S);
      this.place();
      return;
    }
    if (this.dazed > 0) {
      this.dazed = Math.max(0, this.dazed - dt);
      this.beamOn = false;
      this.visorMat.emissiveIntensity = 0.2;
      this.syncBeam();
      this.place();
      return;
    }
    this.visorMat.emissiveIntensity = 1.6;
    this.beamOn = true;

    // Whom it can look at: the agent and the partner, when they are on its floor.
    const sameStorey = ctx.floorY === undefined || Math.abs(ctx.floorY - this.y) < 0.5;
    const idle = ctx.practiceTarget === true || ctx.harmless === true;
    const marks: Record<'player' | 'partner', Mark | null> = {
      player: sameStorey && !idle ? { x: ctx.playerX, z: ctx.playerZ, y: ctx.playerY ?? this.y, hidden: ctx.hidden || ctx.enclosed, prone: ctx.prone === true, crouched: ctx.sneaking, running: ctx.running === true } : null,
      partner: sameStorey && !idle && ctx.partner ? { x: ctx.partner.x, z: ctx.partner.z, y: ctx.partner.y, hidden: ctx.partner.hidden, prone: ctx.partner.prone, crouched: ctx.partner.crouched } : null,
    };
    const walls = ctx.occluders ?? ctx.wallBoxes;
    const deps = { lineClear: lineClearOver, smokeBlocks };
    const smokes = ctx.smokes ?? [];
    const see = (m: Mark | null, centre: number, half: number): ReturnType<typeof look> | null => (m ? look(this.post.x, this.post.z, EYE_Y, this.y, m, walls, deps, smokes, ctx.sightScale, centre, half) : null);

    if (this.state.phase === 'lock') {
      const m = this.lockedOn ? marks[this.lockedOn] : null;
      const l = see(m, this.angle, LOCK_HALF);
      // Follow them: the crosshair swings after the agent as fast as it can.
      if (m) this.angle = turnToward(this.angle, Math.atan2(m.x - this.post.x, m.z - this.post.z), TRACK_RATE, dt);
      const step = stepAim(this.state, false, l?.sees === true, dt);
      this.state = step.state;
      if (step.fire && this.lockedOn) this.shoot(ctx, this.lockedOn);
      if (step.dropped) this.lockedOn = null;
    } else {
      // Sweeping (or reloading, the laser dim): the line goes to and fro about its post's facing; the agent in it long enough is locked.
      const want = this.state.phase === 'reload' ? this.angle : sweepAngle(this.post.facing, this.t, this.phase);
      this.angle = turnToward(this.angle, want, 1.4, dt);
      const pick = this.state.phase === 'scan' ? pickTarget(see(marks.player, this.angle, LASER_HALF), see(marks.partner, this.angle, LASER_HALF)) : null;
      const step = stepAim(this.state, pick !== null, false, dt);
      this.state = step.state;
      if (step.locked && pick) this.lockedOn = pick.who;
    }
    this.draw(walls, marks);
    this.place();
  }

  /** The round: a roll on whom it was at, and the game plays the rest (the tracer, the cost or the partner going down). */
  private shoot(ctx: EnemyContext, who: 'player' | 'partner'): void {
    this.recoil = 1;
    const hit = lands(this.roll(), who);
    this.lockedOn = null;
    if (ctx.onSniperShot) ctx.onSniperShot(this, who, hit);
    else if (who === 'player' && hit) ctx.onShot(this);
  }

  /** The laser: to the target's chest when locked, else level along where it points to the first wall. */
  private draw(walls: WallBox[], marks: Record<'player' | 'partner', Mark | null>): void {
    if (!this.beamOn || !this.visible) {
      this.syncBeam();
      return;
    }
    const from = this.muzzleWorldPosition;
    const solids = walls.filter((b) => !b.see);
    const dir = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle));
    let to: THREE.Vector3;
    const m = this.state.phase === 'lock' && this.lockedOn ? marks[this.lockedOn] : null;
    if (m) {
      const chest = new THREE.Vector3(m.x, m.y + (m.prone ? 0.3 : m.crouched ? 0.85 : 1.3), m.z);
      dir.copy(chest).sub(from);
      const len = dir.length();
      dir.normalize();
      to = traceEndWith(lineClearOver, from, dir, len, solids, this.y);
    } else to = traceEndWith(lineClearOver, from, dir, LONG, solids, this.y);
    const warn = aimed(this.state);
    const locked = this.state.phase === 'lock';
    const reloading = this.state.phase === 'reload';
    const bright = reloading ? 0.25 : locked ? 1.2 + 0.9 * warn + 0.35 * Math.sin(this.t * (14 + 30 * warn)) : 0.55 + 0.25 * Math.min(1, this.state.dwell / 0.35);
    const delta = to.clone().sub(from);
    const len = delta.length();
    this.beam.position.copy(from).addScaledVector(delta, 0.5);
    this.beam.scale.set(1, Math.max(0.05, len), 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    this.coreMat.opacity = Math.min(1, 0.85 * bright);
    this.haloMat.opacity = 0.12 * bright + (locked ? 0.1 * warn : 0);
    this.coreMat.color.setHex(locked ? LASER_HOT : LASER);
    this.haloMat.color.setHex(locked ? 0xff6a50 : LASER);
    this.dot.position.copy(to);
    this.dot.scale.setScalar(locked ? 1 + 0.6 * warn : 0.7);
    this.dotMat.opacity = Math.min(1, 0.7 * bright);
    this.dotMat.color.setHex(locked ? LASER_HOT : LASER);
    this.syncBeam();
  }

  private syncBeam(): void {
    const on = this.beamOn && this.visible && !this.disabled && this.dazed <= 0;
    this.beam.visible = on;
    this.dot.visible = on;
  }

  private place(): void {
    this.root.position.set(this.post.x, this.y, this.post.z);
    this.body.rotation.y = this.angle;
    // The scope to its eye while it aims; the rifle kicks back and up on a shot.
    this.gun.rotation.x = -0.05 * this.recoil;
    this.gun.position.z = 0.12 - 0.12 * this.recoil;
    if (this.disabled) {
      const e = this.fall * this.fall * (3 - 2 * this.fall);
      this.body.rotation.x = -1.45 * e;
      this.body.position.y = 0.12 * e;
      this.gun.visible = this.fall < 0.4;
    }
  }
}
