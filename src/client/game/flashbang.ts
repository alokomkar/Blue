// The flash grenade as a thing in the scene (the rules are flash.ts's): thrown ahead of the agent in a short arc like a flare, it lands,
// blinks for a moment, and goes off: a flood of white light and a ring that swells and fades. `onBang` fires the instant it does, and
// game.ts dazes whoever has a clear line to it. Also the little ring of stars that circles a dazed guard's or dog's head.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { rayToBoxes } from './detection';
import type { WallBox } from './scene';
import { giveLight, takeLight } from './pulselights';

const THROW_DISTANCE = 7;
const WALL_MARGIN = 0.4;
const FLIGHT_S = 0.5;
const FUSE_S = 0.55;
const ARC_HEIGHT = 1.3;
const BANG_S = 0.55;

export type Flashbang = { update: (dt: number) => boolean };

export function spawnFlashbang(
  scene: THREE.Scene,
  fromX: number,
  fromY: number,
  fromZ: number,
  facing: number,
  wallBoxes: WallBox[],
  onBang: (x: number, y: number, z: number) => void,
  /** Thrown over a rail to a lower storey (the tower): where it comes down instead of ahead on this floor. */
  over?: { groundY: number; reach: number }
): Flashbang {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const reach = over ? over.reach : Math.max(0.6, Math.min(THROW_DISTANCE, rayToBoxes(fromX, fromZ, dx, dz, THROW_DISTANCE + WALL_MARGIN, wallBoxes) - WALL_MARGIN));
  const groundY = over ? over.groundY : fromY + 0.12;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.5, metalness: 0.6 }));
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), ledMat);
  led.position.y = 0.11;
  markBloom(led);
  body.add(led);
  scene.add(body);

  const light = takeLight(scene, 0xffffff, 22);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), ringMat);
  ring.visible = false;
  scene.add(ring);

  const place = (f: number): void => {
    const h = 4 * ARC_HEIGHT * f * (1 - f);
    body.position.set(fromX + dx * reach * f, (fromY + 1.2) * (1 - f) + groundY * f + h, fromZ + dz * reach * f);
    body.rotation.x = f * 11;
    body.rotation.z = f * 5;
  };
  place(0);

  let t = 0;
  let banged = -1;
  return {
    update(dt: number): boolean {
      t += dt;
      if (banged < 0) {
        const f = Math.min(1, t / FLIGHT_S);
        place(f);
        if (f >= 1) {
          body.rotation.set(0, 0, Math.PI / 2);
          // Blinking faster as the fuse runs down.
          const left = FLIGHT_S + FUSE_S - t;
          ledMat.emissiveIntensity = Math.sin(t * (left < 0.25 ? 60 : 24)) > 0 ? 3 : 0.1;
        }
        if (t >= FLIGHT_S + FUSE_S) {
          banged = 0;
          body.visible = false;
          ring.position.copy(body.position);
          ring.visible = true;
          light.position.set(body.position.x, body.position.y + 0.8, body.position.z);
          onBang(body.position.x, body.position.y, body.position.z);
        }
        return true;
      }
      banged += dt;
      const k = Math.min(1, banged / BANG_S);
      light.intensity = 900 * Math.pow(1 - k, 2);
      ring.scale.setScalar(0.3 + 7 * (1 - (1 - k) * (1 - k)));
      ringMat.opacity = 0.75 * (1 - k);
      if (k >= 1) {
        scene.remove(body, ring);
        giveLight(scene, light);
        body.geometry.dispose();
        ring.geometry.dispose();
        ringMat.dispose();
        return false;
      }
      return true;
    },
  };
}

export type DazeStars = { update: (dt: number) => boolean };

/** Three small bright stars circling over `where()` (a head) for `seconds`, then gone: the sign a guard or a dog is seeing stars. */
export function spawnDazeStars(scene: THREE.Scene, where: () => { x: number; y: number; z: number }, seconds: number): DazeStars {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, toneMapped: false });
  const stars = [0, 1, 2].map(() => {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), mat);
    markBloom(s);
    group.add(s);
    return s;
  });
  scene.add(group);
  let t = 0;
  return {
    update(dt: number): boolean {
      t += dt;
      const p = where();
      group.position.set(p.x, p.y, p.z);
      stars.forEach((s, i) => {
        const a = t * 3.2 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.34, Math.sin(t * 5 + i) * 0.05, Math.sin(a) * 0.34);
        s.rotation.y = t * 4;
        // They fade as the daze runs out.
        s.scale.setScalar(Math.min(1, (seconds - t) / 1.5));
      });
      if (t >= seconds) {
        scene.remove(group);
        stars.forEach((s) => s.geometry.dispose());
        mat.dispose();
        return false;
      }
      return true;
    },
  };
}
