// Crawler mine — a small six-legged spider-bot that lies dormant in a
// corridor, legs folded, red eye barely glowing. Come within a few steps
// (fewer while sneaking; not at all while cloaked, sneaking and still, or
// behind a crate) and it wakes, scuttles after you along the corridors,
// and detonates if it reaches you: a burst of suspicion that trips the
// alarm. One stun or an EMP stops it for good; it's too small to take
// down. Outrun it for a few seconds and it gives up and re-arms wherever
// it stopped.

import * as THREE from 'three';
import { markBloom, markCharacter } from '../postfx';
import { hasLineOfSight } from '../detection';
import { CELL } from '../scene';
import { Walker } from './walker';
import type { Enemy, EnemyContext, HitResult, Tool } from './types';

const WAKE = 3.2;
const WAKE_SNEAKING = 1.8;
const SPEED = 6.5;
const DETONATE = 0.6;
const GIVE_UP_S = 6;
const REPATH_S = 0.25;
const DIRECT = 3; // this close with a clear line, it skips the route and runs straight at you
const LEGS = 6;

export class Crawler implements Enemy {
  readonly kind = 'crawler';
  readonly stunImmune = false;
  readonly takedownable = false; // too small to grab
  readonly radius = 0; // skitters round your feet, doesn't block you
  disabled = false;
  private readonly walker: Walker;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly eye: THREE.MeshStandardMaterial;
  private readonly legs: THREE.Group[] = [];
  private state: 'dormant' | 'chase' = 'dormant';
  private chaseFor = 0;
  private repath = 0;
  private gait = 0;
  private curl = 0;
  private isMoving = false;
  private t = Math.random() * 10;

  constructor(scene: THREE.Scene, x: number, z: number, originX: number, originY: number, originZ: number) {
    this.walker = new Walker(x, z, originX, originY, originZ, 12);
    this.walker.angle = Math.random() * Math.PI * 2;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.45, metalness: 0.7 });
    this.eye = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2020, emissiveIntensity: 0.4 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.09, 12), metal);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dome.position.y = 0.04;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), this.eye);
    eye.position.set(0, 0.07, 0.15);
    markBloom(eye);
    this.body.add(disc, dome, eye);
    const legGeo = new THREE.CylinderGeometry(0.015, 0.012, 0.3, 5);
    legGeo.translate(0, -0.15, 0);
    for (let i = 0; i < LEGS; i++) {
      const leg = new THREE.Group();
      const a = (i / LEGS) * Math.PI * 2 + Math.PI / LEGS;
      leg.position.set(Math.sin(a) * 0.18, 0, Math.cos(a) * 0.18);
      leg.rotation.y = a;
      leg.add(new THREE.Mesh(legGeo, metal));
      this.body.add(leg);
      this.legs.push(leg);
    }
    this.root.add(this.body);
    scene.add(this.root);
    markCharacter(scene, this.root);
    this.pose(0);
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
    return this.isMoving && !this.disabled;
  }
  get alert(): boolean {
    return this.state === 'chase' && !this.disabled;
  }

  private exploded = false;

  setVisible(visible: boolean): void {
    this.root.visible = visible && !this.exploded;
  }

  calm(): void {
    if (this.state === 'chase') this.state = 'dormant';
  }

  hit(tool: Tool): HitResult {
    if (this.disabled || tool === 'takedown') return 'immune';
    this.disabled = true;
    this.eye.emissiveIntensity = 0;
    return 'disabled';
  }

  update(ctx: EnemyContext, dt: number): void {
    if (ctx.practiceTarget && !this.disabled) return;
    this.t += dt;
    if (this.disabled) {
      // Shorted out: legs curl up underneath it.
      if (this.curl < 1) {
        this.curl = Math.min(1, this.curl + dt / 0.4);
        this.pose(0);
      }
      return;
    }
    const w = this.walker;
    const d = Math.hypot(ctx.playerX - w.pos.x, ctx.playerZ - w.pos.z);

    if (this.state === 'dormant') {
      this.eye.emissiveIntensity = 0.25 + 0.2 * Math.sin(this.t * 1.5);
      const wake = ctx.sneaking ? WAKE_SNEAKING : WAKE;
      // Close by in a straight line, and not through a wall: reachable within about a cell of corridor
      // (the corridor distance only counts whole cells, so it can't carry the fine range itself).
      if (!ctx.hidden && !ctx.enclosed && d <= wake && ctx.soundDistance(w.pos.x, w.pos.z) <= CELL + 0.01) {
        this.state = 'chase';
        this.chaseFor = 0;
        this.repath = 0;
        this.eye.emissiveIntensity = 3;
      }
      this.isMoving = false;
      this.pose(0);
      return;
    }

    // Chasing.
    this.chaseFor += dt;
    if (d < DETONATE && !ctx.enclosed) {
      this.disabled = true;
      this.exploded = true;
      this.root.visible = false;
      ctx.onExplode(this);
      return;
    }
    if (this.chaseFor > GIVE_UP_S) {
      this.state = 'dormant';
      this.isMoving = false;
      this.pose(0);
      return;
    }
    this.repath -= dt;
    if (this.repath <= 0) {
      this.repath = REPATH_S;
      w.pathTo(ctx.playerX, ctx.playerZ, ctx.cells, ctx.cols, ctx.rows);
    }
    const direct = d < DIRECT && hasLineOfSight(w.pos.x, w.pos.z, ctx.playerX, ctx.playerZ, ctx.wallBoxes, DIRECT);
    this.isMoving = direct ? w.moveToward(ctx.playerX, ctx.playerZ, SPEED, dt) : w.follow(dt, SPEED) || w.moveToward(ctx.playerX, ctx.playerZ, SPEED * 0.5, dt);
    if (this.isMoving) this.gait += dt * 22;
    this.pose(1);
  }

  /** Places it and poses the legs: folded tight while dormant (or curled when dead), scuttling while it runs. */
  private pose(active: number): void {
    const w = this.walker;
    this.root.position.copy(w.pos);
    this.root.rotation.y = w.angle;
    this.body.position.y = active ? 0.2 : 0.07 * (1 - this.curl);
    this.legs.forEach((leg, i) => {
      const skitter = active && this.isMoving ? Math.sin(this.gait + (i % 2) * Math.PI) * 0.35 : 0;
      // Rotation about the leg's local X splays it out from the body (downward-outward when active).
      leg.rotation.x = this.curl > 0 ? -0.3 * this.curl : active ? 0.9 + skitter : 1.35;
    });
  }
}
