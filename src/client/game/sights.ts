// Laser sights (the mockup's fourth section): a thin green line from the agent's gun to where the shot will land, and a red one from the gun of the guards near the agent,
// so what a guard is looking down can be read. A core line with a soft halo, a dot where it ends, brighter and whiter when it is on the agent.

import * as THREE from 'three';
import { traceEndWith } from './traceend';
import { lineClearOver } from './detection';
import type { WallBox } from './scene';

/** Where a line from `from` along `dir` first meets a wall (or the floor of its storey, `floorY`), no further than `range` (traceend.ts). */
export const traceEnd = (from: THREE.Vector3, dir: THREE.Vector3, range: number, walls: WallBox[], floorY: number): THREE.Vector3 => traceEndWith(lineClearOver, from, dir, range, walls, floorY);

const PLAYER_COLOR = 0x4cff8a;
const ENEMY_COLOR = 0xff3b2e;
const LOCK_CORE = 0xffd2c8;
const LOCK_HALO = 0xff6a50;
const MAX_ENEMY_BEAMS = 5;
const UP = new THREE.Vector3(0, 1, 0);

class Beam {
  readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly dot: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    private readonly color: number,
    dotTex: THREE.Texture
  ) {
    const mat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true), mat(0.95));
    this.halo = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 10, 1, true), mat(0.13));
    this.dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    for (const o of [this.group, this.core, this.halo, this.dot]) o.userData.fx = true;
    this.group.add(this.core, this.halo);
    this.group.visible = false;
    this.dot.visible = false;
    scene.add(this.group, this.dot);
  }

  set(from: THREE.Vector3, to: THREE.Vector3, bright: number, lock: boolean): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.05) {
      this.show(false);
      return;
    }
    this.show(true);
    this.group.position.copy(from).addScaledVector(dir, 0.5);
    this.group.scale.set(1, len, 1);
    this.group.quaternion.setFromUnitVectors(UP, dir.normalize());
    (this.core.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.9 * bright);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.13 * bright + (bright > 1 ? 0.12 : 0);
    (this.core.material as THREE.MeshBasicMaterial).color.setHex(lock ? LOCK_CORE : this.color);
    (this.halo.material as THREE.MeshBasicMaterial).color.setHex(lock ? LOCK_HALO : this.color);
    this.dot.position.copy(to);
    this.dot.scale.setScalar(0.07 + 0.04 * bright);
  }

  show(on: boolean): void {
    this.group.visible = on;
    this.dot.visible = on;
  }
}

function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type EnemySight = { from: THREE.Vector3; to: THREE.Vector3; lock: boolean; /** The guard is after the agent: its line burns brighter. */ alert: boolean; /** How near the guard is to taking notice of the line on the agent, 0 to 1 (laser.ts): it brightens. */ warn?: number };

export class Sights {
  private readonly tex = dotTexture();
  private readonly mine: Beam;
  private readonly theirs: Beam[];
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.mine = new Beam(scene, PLAYER_COLOR, this.tex);
    this.theirs = Array.from({ length: MAX_ENEMY_BEAMS }, () => new Beam(scene, ENEMY_COLOR, this.tex));
  }

  /** The agent's laser, or `null` to put it out. */
  player(line: { from: THREE.Vector3; to: THREE.Vector3 } | null, dt: number): void {
    this.t += dt;
    if (!line) {
      this.mine.show(false);
      return;
    }
    this.mine.set(line.from, line.to, 1.15 + Math.sin(this.t * 30) * 0.05, false);
  }

  /** Red lines, one per gun that is up (the nearest few if there are more than there are beams). */
  enemies(lines: EnemySight[]): void {
    this.theirs.forEach((b, i) => {
      const l = lines[i];
      if (!l) b.show(false);
      else b.set(l.from, l.to, l.lock ? 1.4 + 0.7 * (l.warn ?? 0) : l.alert ? 1.1 : 0.6 + 0.45 * (l.warn ?? 0), l.lock);
    });
  }
}
