// What a shot looks like, gun by gun (bigguns.ts). The hit itself is still decided on the instant the trigger is pulled (game.ts handleFire); a projectile is the picture of it
// travelling, so each gun reads differently: a pulse pistol's single bolt, the SMG's three darts, the burst rifle's long tracers and the sniper's lingering rail beam.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { spawnTracer, type Tracer } from './weapon';
import type { BigGun } from './bigguns';
import type { SoundKind } from './audio';

const UP = new THREE.Vector3(0, 1, 0);
const basic = (color: number, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });

/** A glowing capsule (a bolt or a tracer) pointing along `dir`, `length` long. */
function streak(color: number, length: number, radius: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 6);
  const m = new THREE.Mesh(geo, basic(color));
  markBloom(m);
  return m;
}

function orient(mesh: THREE.Object3D, dir: THREE.Vector3): void {
  mesh.quaternion.setFromUnitVectors(UP, dir);
}

/** One or several streaks that fly from `from` to `to` at `speed`, each starting `delay` seconds after the last, then are gone. */
function flyers(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, o: { count: number; gap: number; speed: number; length: number; radius: number; color: number; spread: number }): Tracer {
  const delta = new THREE.Vector3().subVectors(to, from);
  const dist = Math.max(0.01, delta.length());
  const dir = delta.clone().normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const items: Array<{ mesh: THREE.Mesh; start: number; off: THREE.Vector3; done: boolean }> = [];
  for (let i = 0; i < o.count; i++) {
    const mesh = streak(o.color, o.length, o.radius);
    mesh.visible = false;
    orient(mesh, dir);
    scene.add(mesh);
    items.push({ mesh, start: i * o.gap, off: side.clone().multiplyScalar((i - (o.count - 1) / 2) * o.spread).add(new THREE.Vector3(0, (i % 2 ? 1 : -1) * o.spread * 0.4, 0)), done: false });
  }
  let t = 0;
  return {
    update(dt: number): boolean {
      t += dt;
      let alive = false;
      for (const it of items) {
        if (it.done) continue;
        const travelled = (t - it.start) * o.speed;
        if (travelled < 0) {
          alive = true;
          continue;
        }
        if (travelled - o.length > dist) {
          scene.remove(it.mesh);
          it.mesh.geometry.dispose();
          (it.mesh.material as THREE.Material).dispose();
          it.done = true;
          continue;
        }
        alive = true;
        it.mesh.visible = true;
        const head = Math.min(travelled, dist);
        const tail = Math.max(0, travelled - o.length);
        const mid = (head + tail) / 2;
        it.mesh.scale.y = Math.max(0.01, (head - tail) / o.length);
        it.mesh.position.copy(from).addScaledVector(dir, mid).add(it.off);
      }
      return alive;
    },
  };
}

/** The rail sniper: a thin white beam the whole way at once that burns out slowly, with a ring where it lands. */
type RailLook = { core: number; glow: number; ring: number; life: number; thick: number };
function railBeam(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, look: RailLook): Tracer {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(0.01, delta.length());
  const dir = delta.clone().normalize();
  const mid = from.clone().addScaledVector(dir, length / 2);
  const core = streak(look.core, length, 0.018 * look.thick);
  const glow = streak(look.glow, length, 0.07 * look.thick);
  (glow.material as THREE.MeshBasicMaterial).transparent = true;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 24), basic(look.ring, 0.9));
  ring.position.copy(to);
  ring.lookAt(from);
  markBloom(ring);
  for (const m of [core, glow]) {
    m.position.copy(mid);
    orient(m, dir);
    scene.add(m);
  }
  scene.add(ring);
  let t = 0;
  const LIFE = look.life;
  return {
    update(dt: number): boolean {
      t += dt;
      const f = Math.min(1, t / LIFE);
      (core.material as THREE.MeshBasicMaterial).color.set(look.core).multiplyScalar(1 - f * 0.4);
      core.scale.x = core.scale.z = Math.max(0.05, 1 - f);
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - f);
      glow.scale.x = glow.scale.z = 1 + f * 0.8;
      ring.scale.setScalar(1 + f * 5);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      if (f < 1) return true;
      for (const m of [core, glow, ring]) {
        scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      return false;
    },
  };
}

/** The picture of a shot from `gun` (null: the plain pistol) from the muzzle to where it lands. `color` is a plain shot's tint (an enemy's own). */
export function spawnShot(scene: THREE.Scene, gun: BigGun | null, from: THREE.Vector3, to: THREE.Vector3, color?: number): Tracer {
  switch (gun) {
    case 'Pistol_1':
      return flyers(scene, from, to, { count: 1, gap: 0, speed: 70, length: 0.7, radius: 0.045, color: color ?? 0x7ff0d8, spread: 0 });
    case 'SMG_1':
      return flyers(scene, from, to, { count: 3, gap: 0.045, speed: 95, length: 0.45, radius: 0.022, color: color ?? 0xd7ff5a, spread: 0.05 });
    case 'AR_4':
      return flyers(scene, from, to, { count: 3, gap: 0.07, speed: 130, length: 1.8, radius: 0.028, color: color ?? 0xffd7a0, spread: 0.07 });
    case 'Sniper_2':
      return railBeam(scene, from, to, { core: 0xffffff, glow: 0x7fd8ff, ring: 0xbff0ff, life: 0.55, thick: 1 });
    default:
      return color === undefined ? spawnTracer(scene, from, to) : spawnTracer(scene, from, to, color);
  }
}

/** The sound of a shot from `gun` (null: the plain pistol's). */
export function shotSound(gun: BigGun | null): SoundKind {
  switch (gun) {
    case 'SMG_1':
      return 'shotSmg';
    case 'AR_4':
      return 'shotBurst';
    case 'Sniper_2':
      return 'shotRail';
    default:
      return 'shot';
  }
}
