// Alpha unit — a heavy robot dog (the boss concept's model, shrunk to a corridor) that hunts by ear and by scent, rears up and howls as it locks on, runs you down
// and goes off beside you: the blast ends the try on the spot (back to the last checkpoint). Shoot it before it is that close and it goes off where it stands, which is
// the point: its blast (ALPHA_BLAST_R) takes down every guard, dog, mine and drone in the radius, shorts out every camera in it, sets off any other alpha in it, and raises
// no suspicion at all. It also shoots: from the moment it senses you, while it has a clear line, it fires blue bursts and rattles (a hit costs suspicion, as a guard's does; a dodge makes it miss). An EMP is the quiet way: it shorts it out without a blast. It cannot be taken down by hand, and a flash grenade does nothing to it.
//
// The model is public/models/bosses/alpha.glb: pivoted legs, clips trot / idle / howl / lunge (tools/blender/detail_anim.py). Nothing shows until it has loaded.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markCharacter } from '../postfx';
import { nextTag } from '../signage';
import { tagPlate } from '../signrender';
import { hasLineOfSight } from '../detection';
import { CELL } from '../scene';
import { Walker } from './walker';
import { canHear } from './noise';
import type { Enemy, EnemyContext, HitResult, Tool } from './types';

const MODEL_URL = '/models/bosses/alpha.glb';
/** The boss model is about 5 m long: scaled to a corridor, about a metre and a half. */
const SCALE = 0.32;
const COLLAPSE_S = 0.6; // how long a shorted-out alpha takes to drop
/** How far its blast reaches, in metres (game.ts's alphaBlast does the work). */
export const ALPHA_BLAST_R = 5;
const PROWL_SPEED = 2.6;
const CHARGE_SPEED = 6.6; // slower than the agent's walk (7): it can be outrun, if you start in time
const LOCK_S = 0.95; // rears up and howls before it runs: the warning
const LUNGE_DIST = 2.3; // this close to the agent it crouches to spring: the fuse is lit
const FUSE_S = 0.42;
const SHOT_FUSE_S = 0.12; // a hit: the moment it takes to go off
const CHAIN_FUSE_S = 0.3; // set off by another's blast
const SENSE_NEAR = 3.6; // within this and reachable it knows you are there, even if you creep (not through a wall, not when hidden)
const HEAR_EVERY_S = 0.2;
const GIVE_UP_S = 8;
const REPATH_S = 0.25;
const DIRECT = 4;
const ROAM_PAUSE_S = [0.8, 2.2] as const;
/** It shoots from the moment it senses you: the first shot a beat after the howl starts, then this often, out to this far, while it has a clear line. */
export const ALPHA_FIRE_RANGE = 13;
const FIRST_SHOT_S = 0.35;
/** Two ways it fires, picked each time: a burst of three long tracers, or a quicker rattle of short darts (a lighter rhythm). Blue, whichever (game.ts draws them with the burst rifle's and the SMG's own shots). */
export type AlphaFire = 'burst' | 'rattle';
const FIRE_COOLDOWN_S: Record<AlphaFire, number> = { burst: 1.3, rattle: 0.8 };
const GLOW_CALM = 0x7cf3ff;
const GLOW_ANGRY = 0xff2a2a;

type State = 'prowl' | 'lock' | 'charge';
type ClipName = 'trot' | 'idle' | 'howl' | 'lunge';

let library: Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }> | null = null;
function loadModel(): Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  library ??= new GLTFLoader().loadAsync(MODEL_URL).then((g) => ({ scene: g.scene, clips: g.animations }));
  return library;
}

export class Alpha implements Enemy {
  readonly kind = 'alpha';
  readonly stunImmune = false;
  readonly takedownable = false;
  readonly radius = 0.5;
  disabled = false;
  /** Gone off (or about to be removed): not drawn, not updated. */
  exploded = false;
  private readonly walker: Walker;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glows: THREE.MeshStandardMaterial[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  private state: State = 'prowl';
  private visible = true;
  private chargeFor = 0;
  private repath = 0;
  private hearTimer = Math.random() * HEAR_EVERY_S;
  private lockFor = 0;
  private pause = 0;
  private isMoving = false;
  private fuse = 0;
  /** 0 to 1: shorted out, it drops and rolls onto its side (the clips stop where they were, so the body is turned by hand). */
  private collapse = 1;
  /** A lit fuse that runs on toward the agent (the lunge), or stops it dead (a hit, or a neighbour's blast). */
  private fuseRuns = false;
  private fireCooldown = 0;
  /** How the last shot was fired (for game.ts to draw it). */
  fireMode: AlphaFire = 'burst';
  private t = Math.random() * 10;
  /** A section of its own to roam (the tower's): 0 inside it, -1 outside, by cell. A chase still takes it anywhere. */
  private zone: number[][] | null = null;

  constructor(scene: THREE.Scene, x: number, z: number, originX: number, originY: number, originZ: number) {
    this.walker = new Walker(x, z, originX, originY, originZ, 9);
    this.walker.angle = Math.random() * Math.PI * 2;
    this.root.add(this.body);
    // The blast radius on the floor: a faint ring while it prowls, a hot one once it is after you.
    this.ringMat = new THREE.MeshBasicMaterial({ color: GLOW_ANGRY, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(ALPHA_BLAST_R - 0.12, ALPHA_BLAST_R, 48), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.root.add(this.ring);
    scene.add(this.root);
    markCharacter(scene, this.body);
    void loadModel().then(({ scene: src, clips }) => {
      const model = src.clone(true);
      model.scale.setScalar(SCALE);
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
        if (m.name === 'glow' || m.name === 'eye') {
          const own = m.clone();
          o.material = own;
          this.glows.push(own);
        }
      });
      this.body.add(model);
      // Its model and serial on its back (the top of the body), red like the rest of its markings, small.
      // (Measured with the body at the origin, turned square, so the box is the model's own.)
      const savedAt = this.root.position.clone();
      const savedYaw = this.body.rotation.y;
      this.root.position.set(0, 0, 0);
      this.body.rotation.y = 0;
      this.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      this.root.position.copy(savedAt);
      this.body.rotation.y = savedYaw;
      this.root.updateMatrixWorld(true);
      const tag = tagPlate(nextTag('alpha'), Math.min(0.3, (box.max.x - box.min.x) * 0.5), 'rgba(214,92,80,0.78)');
      tag.rotation.x = -Math.PI / 2;
      tag.rotation.z = Math.PI;
      tag.position.set((box.max.x + box.min.x) / 2, box.max.y * 0.97, (box.max.z + box.min.z) / 2 - (box.max.z - box.min.z) * 0.12);
      this.body.add(tag);
      this.mixer = new THREE.AnimationMixer(model);
      for (const c of clips) this.actions.set(c.name as ClipName, this.mixer.clipAction(c));
      this.play('idle');
      this.setGlow(GLOW_CALM);
      markCharacter(scene, this.body);
    });
    this.sync();
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
  get facing(): number {
    return this.walker.angle;
  }
  get moving(): boolean {
    return this.isMoving && !this.disabled && !this.exploded;
  }
  /** Onto the agent: howling or running (the alert chirp and the heartbeat follow it). */
  get alert(): boolean {
    return this.state !== 'prowl' && !this.disabled && !this.exploded;
  }
  /** The lit fuse's seconds left (0 when none). */
  get fuseLeft(): number {
    return this.fuse;
  }
  setZone(zone: number[][] | null): void {
    this.zone = zone;
  }
  /** Where its shots come from: its back, a little above the shoulders and ahead. */
  get muzzleWorldPosition(): THREE.Vector3 {
    const a = this.walker.angle;
    return new THREE.Vector3(this.walker.pos.x + Math.sin(a) * 0.5, this.walker.pos.y + 1, this.walker.pos.z + Math.cos(a) * 0.5);
  }
  get model(): THREE.Object3D {
    return this.root;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.visible = visible && !this.exploded;
  }

  calm(): void {
    if (this.fuse > 0) return;
    this.state = 'prowl';
    this.pause = 1;
    this.setGlow(GLOW_CALM);
  }

  relocate(x: number, z: number): void {
    this.walker.place(x, z);
    this.state = 'prowl';
    this.fuse = 0;
    this.pause = 1;
    this.hearTimer = 3;
    this.setGlow(GLOW_CALM);
    this.sync();
  }

  /** Lights the fuse: it goes off in `seconds`, where it stands (a hit, or the blast of another alpha beside it). */
  ignite(seconds: number = SHOT_FUSE_S): void {
    if (this.disabled || this.exploded) return;
    if (this.fuse > 0 && this.fuse <= seconds) return;
    this.fuse = seconds;
    this.fuseRuns = false;
    this.setGlow(GLOW_ANGRY);
  }

  hit(tool: Tool): HitResult {
    if (this.disabled || this.exploded) return 'immune';
    if (tool === 'takedown') return 'immune';
    if (tool === 'emp') {
      // Shorted out before it can fire: it drops where it stands and does not go off.
      this.disabled = true;
      this.fuse = 0;
      this.mixer?.stopAllAction();
      this.setGlow(0x000000, 0);
      this.ringMat.opacity = 0;
      this.collapse = 0;
      return 'disabled';
    }
    this.ignite(SHOT_FUSE_S);
    return 'immune';
  }

  /** Set off by a neighbour's blast. */
  chain(): void {
    this.ignite(CHAIN_FUSE_S);
  }

  private setGlow(color: number, intensity = 2.2): void {
    for (const m of this.glows) {
      m.emissive.setHex(color);
      m.emissiveIntensity = intensity;
    }
  }

  private play(name: ClipName, rate = 1): void {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = rate;
    if (this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    a.reset().play();
    if (prev) a.crossFadeFrom(prev, 0.18, false);
    this.current = name;
  }

  private sync(): void {
    this.root.position.copy(this.walker.pos);
    this.body.rotation.y = this.walker.angle;
    // (the ring stays put, level, when the dog turns)
    this.root.visible = this.visible && !this.exploded;
  }

  /** Fires at the agent when it can see them (not hidden, not shut away) within range, at its own pace. */
  private shoot(ctx: EnemyContext, dt: number): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0 || ctx.harmless || ctx.hidden || ctx.enclosed) return;
    const w = this.walker;
    const d = Math.hypot(ctx.playerX - w.pos.x, ctx.playerZ - w.pos.z);
    if (d > ALPHA_FIRE_RANGE || !hasLineOfSight(w.pos.x, w.pos.z, ctx.playerX, ctx.playerZ, ctx.wallBoxes, ALPHA_FIRE_RANGE)) return;
    this.fireMode = Math.random() < 0.6 ? 'burst' : 'rattle';
    this.fireCooldown = FIRE_COOLDOWN_S[this.fireMode];
    ctx.onShot(this);
  }

  private explode(ctx: EnemyContext): void {
    this.exploded = true;
    this.disabled = true;
    this.root.visible = false;
    ctx.onExplode(this);
  }

  update(ctx: EnemyContext, dt: number): void {
    if (ctx.practiceTarget && !this.disabled) return;
    if (this.exploded) return;
    this.t += dt;
    this.mixer?.update(dt);
    this.walker.obstacles = ctx.wallBoxes;
    if (this.disabled) {
      if (this.collapse < 1) {
        this.collapse = Math.min(1, this.collapse + dt / COLLAPSE_S);
        const e = this.collapse * this.collapse * (3 - 2 * this.collapse);
        this.body.rotation.z = 1.5 * e;
        this.body.position.y = 0.2 * e;
      }
      return;
    }
    const w = this.walker;
    const d = Math.hypot(ctx.playerX - w.pos.x, ctx.playerZ - w.pos.z);
    const reachable = !ctx.enclosed && !ctx.unreachable;

    // A lit fuse: crouched to spring and still coming (it ran at you), or frozen and flashing (it was hit).
    if (this.fuse > 0) {
      this.fuse -= dt;
      this.ringMat.opacity = 0.35 + 0.25 * Math.sin(this.t * 40);
      if (this.fuseRuns) {
        this.shoot(ctx, dt);
        this.isMoving = w.moveToward(ctx.playerX, ctx.playerZ, CHARGE_SPEED, dt);
      } else this.isMoving = false;
      if (this.fuse <= 0) {
        this.explode(ctx);
        return;
      }
      this.sync();
      return;
    }

    // Prowling: listening, a few times a second. Heard along the corridors, or nose to nose with someone it can reach.
    if (this.state === 'prowl') {
      this.hearTimer -= dt;
      if (this.hearTimer <= 0) {
        this.hearTimer = HEAR_EVERY_S;
        const along = ctx.soundDistance(w.pos.x, w.pos.z);
        const heard = reachable && canHear(ctx.noise, along);
        const scent = reachable && !ctx.hidden && d <= SENSE_NEAR && along <= CELL * 1.3;
        if (heard || scent) {
          this.state = 'lock';
          this.lockFor = LOCK_S;
          this.fireCooldown = FIRST_SHOT_S;
          this.isMoving = false;
          this.setGlow(GLOW_ANGRY, 3);
          this.play('howl', 2.8);
        }
      }
    }

    if (this.state === 'lock') {
      this.lockFor -= dt;
      this.shoot(ctx, dt);
      w.faceToward(ctx.playerX, ctx.playerZ, dt);
      this.isMoving = false;
      this.ringMat.opacity = 0.18;
      if (this.lockFor <= 0) {
        this.state = 'charge';
        this.chargeFor = 0;
        this.repath = 0;
      }
      this.sync();
      return;
    }

    if (this.state === 'charge') {
      this.chargeFor += dt;
      if (!reachable || this.chargeFor > GIVE_UP_S) {
        this.state = 'prowl';
        this.pause = 1;
        this.hearTimer = 2;
        this.setGlow(GLOW_CALM);
        this.play('idle');
        this.ringMat.opacity = 0.05;
        this.isMoving = false;
        this.sync();
        return;
      }
      this.ringMat.opacity = 0.22 + 0.08 * Math.sin(this.t * 14);
      this.shoot(ctx, dt);
      if (d < LUNGE_DIST) {
        this.fuse = FUSE_S;
        this.fuseRuns = true;
        this.play('lunge', 3.5);
        this.sync();
        return;
      }
      this.repath -= dt;
      if (this.repath <= 0) {
        this.repath = REPATH_S;
        w.pathTo(ctx.playerX, ctx.playerZ, ctx.cells, ctx.cols, ctx.rows);
      }
      const direct = d < DIRECT && hasLineOfSight(w.pos.x, w.pos.z, ctx.playerX, ctx.playerZ, ctx.wallBoxes, DIRECT);
      this.isMoving = direct ? w.moveToward(ctx.playerX, ctx.playerZ, CHARGE_SPEED, dt) : w.follow(dt, CHARGE_SPEED) || w.moveToward(ctx.playerX, ctx.playerZ, CHARGE_SPEED * 0.5, dt);
      this.play(this.isMoving ? 'trot' : 'idle', 2.1);
      this.sync();
      return;
    }

    // Prowl: a trot to somewhere, a pause, another.
    if (this.pause > 0) {
      this.pause -= dt;
      this.isMoving = false;
      this.play('idle');
    } else if (w.routeDone) {
      this.pause = ROAM_PAUSE_S[0] + Math.random() * (ROAM_PAUSE_S[1] - ROAM_PAUSE_S[0]);
      w.roam(ctx.cells, ctx.cols, ctx.rows, 4, this.zone ? { dist: this.zone, max: 0 } : undefined);
      this.isMoving = false;
      this.play('idle');
    } else {
      this.isMoving = w.follow(dt, PROWL_SPEED);
      this.play(this.isMoving ? 'trot' : 'idle', 0.8);
    }
    this.ringMat.opacity = 0.05;
    this.sync();
  }
}
