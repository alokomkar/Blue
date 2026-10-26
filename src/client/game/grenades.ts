// The smoke and shock grenades as things in the scene (the rules are smoke.ts's and game.ts's): the throw, which is the flash grenade's short arc, and the smoke cloud, a few dozen
// soft sprites that burst out of the pop, hold and thin away. The shock grenade's flash and arcs are blasts.ts's.

import * as THREE from 'three';
import { rayToBoxes } from './detection';
import type { WallBox } from './scene';
import { SMOKE_S } from './smoke';

const THROW_DISTANCE = 7;
const WALL_MARGIN = 0.4;
const FLIGHT_S = 0.5;
const ARC_HEIGHT = 1.3;
const PUFFS = 56;
const SPREAD_S = 1.1;

export type Thrown = { update: (dt: number) => boolean };

/** A grenade thrown ahead of the agent in a short arc; `onLand` fires `fuseS` after it lands, with where it is. */
export function spawnThrown(
  scene: THREE.Scene,
  fromX: number,
  fromY: number,
  fromZ: number,
  facing: number,
  wallBoxes: WallBox[],
  color: number,
  fuseS: number,
  onLand: (x: number, y: number, z: number) => void,
  /** Thrown over a rail to a lower storey (the tower): where it comes down instead of ahead on this floor. */
  over?: { groundY: number; reach: number }
): Thrown {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const reach = over ? over.reach : Math.max(0.6, Math.min(THROW_DISTANCE, rayToBoxes(fromX, fromZ, dx, dz, THROW_DISTANCE + WALL_MARGIN, wallBoxes) - WALL_MARGIN));
  const groundY = over ? over.groundY : fromY + 0.12;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 }));
  scene.add(body);
  const place = (f: number): void => {
    const h = 4 * ARC_HEIGHT * f * (1 - f);
    body.position.set(fromX + dx * reach * f, (fromY + 1.2) * (1 - f) + groundY * f + h, fromZ + dz * reach * f);
    body.rotation.x = f * 11;
    body.rotation.z = f * 5;
  };
  place(0);
  let t = 0;
  return {
    update(dt: number): boolean {
      t += dt;
      const f = Math.min(1, t / FLIGHT_S);
      place(f);
      if (f >= 1) body.rotation.set(0, 0, Math.PI / 2);
      if (t >= FLIGHT_S + fuseS) {
        const at = body.position.clone();
        scene.remove(body);
        body.geometry.dispose();
        (body.material as THREE.Material).dispose();
        onLand(at.x, at.y, at.z);
        return false;
      }
      return true;
    },
  };
}

type Puff = { sprite: THREE.Sprite; start: THREE.Vector3; dest: THREE.Vector3; size: number; life: number; delay: number; wob: number };
type Cloud = { puffs: Puff[]; age: number };

/** Smoke clouds: pop one, and update every frame. */
export class SmokeClouds {
  private readonly clouds: Cloud[] = [];
  private readonly tex: THREE.CanvasTexture;

  constructor(private readonly scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
  }

  /** A pop at (x, y, z): the puffs fly out to their places over a second, then hang and thin. */
  pop(x: number, y: number, z: number): void {
    const start = new THREE.Vector3(x, y + 0.3, z);
    const puffs: Puff[] = [];
    for (let i = 0; i < PUFFS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 2.1;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0x9aa3ab, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      sprite.userData.fx = true;
      sprite.visible = false;
      sprite.scale.setScalar(1);
      this.scene.add(sprite);
      puffs.push({
        sprite,
        start,
        dest: new THREE.Vector3(x + Math.cos(a) * r, y + 0.6 + Math.random() * 2, z + Math.sin(a) * r),
        size: 2.6 + Math.random() * 2,
        life: SMOKE_S + (Math.random() - 0.7) * 1.5,
        delay: Math.random() * 0.25,
        wob: Math.random() * Math.PI * 2,
      });
    }
    this.clouds.push({ puffs, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]!;
      c.age += dt;
      let alive = false;
      for (const p of c.puffs) {
        const t = c.age - p.delay;
        if (t < 0) {
          alive = true;
          continue;
        }
        const k = t / p.life;
        if (k >= 1) {
          p.sprite.visible = false;
          continue;
        }
        alive = true;
        p.sprite.visible = true;
        const e = Math.min(1, t / SPREAD_S);
        const eased = 1 - (1 - e) ** 3;
        p.sprite.position.lerpVectors(p.start, p.dest, eased);
        p.sprite.position.x += Math.sin(c.age * 0.5 + p.wob) * 0.12;
        p.sprite.position.y += Math.min(t, 6) * 0.05;
        p.sprite.scale.setScalar(p.size * (0.4 + 0.6 * e));
        p.sprite.material.opacity = (k < 0.12 ? k / 0.12 : k > 0.78 ? (1 - k) / 0.22 : 1) * 0.55;
      }
      if (alive) continue;
      for (const p of c.puffs) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
      }
      this.clouds.splice(i, 1);
    }
  }

  dispose(): void {
    for (const c of this.clouds) for (const p of c.puffs) this.scene.remove(p.sprite);
    this.clouds.length = 0;
    this.tex.dispose();
  }
}
