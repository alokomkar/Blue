// Drone — a quad-rotor flying above the walls, straight from point to point
// across the floor with no regard for the maze below. Its searchlight casts
// a pool on the floor: stand in it for a moment without cover and it spots
// you, turns red, hovers over you and calls nearby bots in. Low furniture
// doesn't hide you from above — only a crate, a staff locker or standing
// cloaked, crouched and still does. Only an EMP brings one down.
//
// The searchlight is drawn (a floor pool and a faint beam), not a real
// light, so a few drones cost next to nothing on a phone.

import * as THREE from 'three';
import { markBloom, markCharacter } from '../postfx';
import { CELL } from '../scene';
import type { Enemy, EnemyContext, HitResult, Tool } from './types';

const HEIGHT = 4.5; // above the walls (3)
const SPEED = 3;
const TRACK_SPEED = 4.2; // following someone it has spotted — a walking player can outrun it
const POOL_R = 2.2;
const SPOT_S = 0.6; // in the light this long without cover and it has you
const TRACK_S = 3; // how long it hangs over you after spotting
const PAUSE_S = 1;
const FALL_S = 0.6;

const LIGHT = 0xd9ecff;
const ALARM = 0xff3a2a;

function fx(o: THREE.Object3D): void {
  o.userData.fx = true; // skipped by the bloom pass's dark-material render (postfx.ts)
}

export class Drone implements Enemy {
  readonly kind = 'drone';
  readonly stunImmune = true; // too high for the stun gun to matter
  readonly takedownable = false;
  readonly radius = 0;
  disabled = false;
  private readonly pos: THREE.Vector3;
  private angle = 0;
  private readonly root = new THREE.Group();
  private readonly craft = new THREE.Group();
  private readonly rotors: THREE.Mesh[] = [];
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly navMat: THREE.MeshStandardMaterial;
  private target: { x: number; z: number } | null = null;
  private pause = 0;
  private seen = 0;
  private tracking = 0;
  private fall = 0;
  private isMoving = false;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly cols: number;
  private readonly rows: number;
  /** The cells it keeps to (training's yard), or the whole floor. */
  private readonly area: ReadonlyArray<{ x: number; y: number }> | null;

  constructor(
    scene: THREE.Scene,
    x: number,
    z: number,
    originX: number,
    originY: number,
    originZ: number,
    cols: number,
    rows: number,
    area: ReadonlyArray<{ x: number; y: number }> | null = null
  ) {
    this.pos = new THREE.Vector3(x, originY, z);
    this.originX = originX;
    this.originZ = originZ;
    this.cols = cols;
    this.rows = rows;
    this.area = area && area.length > 0 ? area : null;

    const shell = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.6 });
    this.navMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: LIGHT, emissiveIntensity: 1.5 });
    this.craft.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.46), shell));
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.navMat);
    pod.position.y = -0.1;
    markBloom(pod);
    this.craft.add(pod);
    const rotorGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.01, 14);
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.45, roughness: 0.3 });
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.42), shell);
      arm.position.set(sx * 0.2, 0.02, sz * 0.2);
      arm.rotation.y = sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4;
      this.craft.add(arm);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(sx * 0.34, 0.07, sz * 0.34);
      this.craft.add(rotor);
      this.rotors.push(rotor);
    }
    this.craft.position.y = HEIGHT;
    this.root.add(this.craft);

    // The searchlight: a faint beam down from the craft, and the pool it throws on the floor.
    this.beamMat = new THREE.MeshBasicMaterial({ color: LIGHT, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(POOL_R, HEIGHT - 0.2, 24, 1, true), this.beamMat);
    beam.position.y = (HEIGHT - 0.2) / 2;
    fx(beam);
    this.root.add(beam);
    this.poolMat = new THREE.MeshBasicMaterial({ color: LIGHT, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_R, 32), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = 0.05;
    fx(this.pool);
    this.root.add(this.pool);

    scene.add(this.root);
    markCharacter(scene, this.root);
    this.place();
  }

  get worldX(): number {
    return this.pos.x;
  }
  get worldZ(): number {
    return this.pos.z;
  }
  get floorY(): number {
    return this.pos.y;
  }
  get facing(): number {
    return this.angle;
  }
  get moving(): boolean {
    return this.isMoving && !this.disabled;
  }
  get alert(): boolean {
    return this.tracking > 0 && !this.disabled;
  }

  /** Where it flies, for its rotor hum. */
  get airPosition(): { x: number; y: number; z: number } {
    return { x: this.pos.x, y: this.pos.y + this.craft.position.y, z: this.pos.z };
  }

  calm(): void {
    this.tracking = 0;
    this.target = null;
  }

  hit(tool: Tool): HitResult {
    if (this.disabled || tool !== 'emp') return 'immune';
    this.disabled = true;
    this.navMat.emissiveIntensity = 0;
    this.pool.visible = false;
    this.beamMat.opacity = 0;
    return 'disabled';
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(ctx: EnemyContext, dt: number): void {
    for (const r of this.rotors) r.rotation.y += dt * (this.disabled ? 2 * (1 - this.fall) : 40);
    if (this.disabled) {
      // Falls out of the air and lies on the floor.
      if (this.fall < 1) {
        this.fall = Math.min(1, this.fall + dt / FALL_S);
        this.craft.position.y = HEIGHT - (HEIGHT - 0.12) * this.fall * this.fall;
        this.craft.rotation.z = 0.5 * this.fall;
      }
      return;
    }

    if (ctx.practiceTarget) return;
    const toPlayer = Math.hypot(ctx.playerX - this.pos.x, ctx.playerZ - this.pos.z);
    const inLight = toPlayer <= POOL_R && (!ctx.hidden || ctx.overWalls === true) && !ctx.enclosed;
    this.seen = inLight ? this.seen + dt : Math.max(0, this.seen - dt * 2);
    if (this.seen >= SPOT_S) {
      this.seen = 0;
      if (this.tracking <= 0) ctx.onSpotted(this);
      this.tracking = TRACK_S;
    }

    let moved = false;
    if (this.tracking > 0) {
      this.tracking = Math.max(0, this.tracking - dt);
      const over = this.keepToArea(ctx.playerX, ctx.playerZ);
      moved = this.flyToward(over.x, over.z, TRACK_SPEED, dt);
      if (this.tracking === 0) this.target = null;
    } else if (this.pause > 0) {
      this.pause -= dt;
    } else {
      if (!this.target) this.target = this.randomPoint();
      moved = this.flyToward(this.target.x, this.target.z, SPEED, dt);
      if (!moved) {
        this.target = null;
        this.pause = PAUSE_S;
      }
    }
    this.isMoving = moved;
    const alarmed = this.tracking > 0;
    this.poolMat.color.setHex(alarmed ? ALARM : LIGHT);
    this.beamMat.color.setHex(alarmed ? ALARM : LIGHT);
    this.navMat.emissive.setHex(alarmed ? ALARM : LIGHT);
    this.poolMat.opacity = 0.22 + (this.seen / SPOT_S) * 0.2;
    this.place();
  }

  private randomPoint(): { x: number; z: number } {
    if (this.area) {
      const c = this.area[Math.floor(Math.random() * this.area.length)]!;
      return { x: c.x * CELL + this.originX, z: c.y * CELL + this.originZ };
    }
    const cx = Math.floor(Math.random() * this.cols);
    const cy = Math.floor(Math.random() * this.rows);
    return { x: cx * CELL + this.originX, z: cy * CELL + this.originZ };
  }

  /** A point to fly to, pulled back inside its area's cell centres when it has one (it won't follow you out). */
  private keepToArea(x: number, z: number): { x: number; z: number } {
    if (!this.area) return { x, z };
    const xs = this.area.map((c) => c.x * CELL + this.originX);
    const zs = this.area.map((c) => c.y * CELL + this.originZ);
    return {
      x: Math.min(Math.max(x, Math.min(...xs)), Math.max(...xs)),
      z: Math.min(Math.max(z, Math.min(...zs)), Math.max(...zs)),
    };
  }

  private flyToward(x: number, z: number, speed: number, dt: number): boolean {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) return false;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.angle = Math.atan2(dx, dz);
    return true;
  }

  private place(): void {
    this.root.position.copy(this.pos);
    this.craft.rotation.y = this.angle;
    this.craft.rotation.x = this.isMoving ? 0.12 : 0; // leaning into the flight
  }
}
