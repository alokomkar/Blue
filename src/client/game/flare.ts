// Flare — thrown ahead of the player in a short arc, landing up to
// THROW_DISTANCE away or just short of the first wall in the way. It lights
// up the corridor for a while, then fades out. On landing it reports where
// it came down (`onLand`), which game.ts uses to draw nearby bots over to
// investigate — the way to pull a sentry off the door it guards.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { rayToBoxes } from './detection';
import type { WallBox } from './scene';
import { giveLight, takeLight } from './pulselights';

const THROW_DISTANCE = 7;
const WALL_MARGIN = 0.4;
const FLIGHT_S = 0.45;
const ARC_HEIGHT = 1.4;
const DURATION_S = 9;
const FADE_S = 2.5; // last portion of DURATION_S spent dimming out
const FLARE_COLOR = 0xff8a3d;
const BASE_INTENSITY = 55;

export type Flare = { update: (dt: number) => boolean };

export function spawnFlare(
  scene: THREE.Scene,
  playerWorldX: number,
  playerWorldY: number,
  playerWorldZ: number,
  facingAngle: number,
  wallBoxes: WallBox[],
  onLand: (x: number, z: number, burnSeconds: number) => void,
  /** Thrown over a rail to a lower storey (the tower): where it comes down instead of ahead on this floor. */
  over?: { groundY: number; reach: number }
): Flare {
  const dx = Math.sin(facingAngle);
  const dz = Math.cos(facingAngle);
  const reach = over ? over.reach : Math.max(0.6, Math.min(THROW_DISTANCE, rayToBoxes(playerWorldX, playerWorldZ, dx, dz, THROW_DISTANCE + WALL_MARGIN, wallBoxes) - WALL_MARGIN));
  const x = playerWorldX + dx * reach;
  const z = playerWorldZ + dz * reach;
  // Offset by the player's own worldY — on a stacked floor a fixed absolute
  // Y would land it back down near floor 0 (same bug class as the torch).
  const groundY = over ? over.groundY : playerWorldY + 0.15;

  const light = takeLight(scene, FLARE_COLOR, 11);
  light.intensity = BASE_INTENSITY;
  const mat = new THREE.MeshStandardMaterial({ color: FLARE_COLOR, emissive: FLARE_COLOR, emissiveIntensity: 2.2 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), mat);
  markBloom(mesh);
  scene.add(mesh);

  const place = (f: number): void => {
    const h = 4 * ARC_HEIGHT * f * (1 - f);
    mesh.position.set(playerWorldX + dx * reach * f, (playerWorldY + 1.2) * (1 - f) + groundY * f + h, playerWorldZ + dz * reach * f);
    mesh.rotation.x = f * 9;
    light.position.set(mesh.position.x, mesh.position.y + 0.9, mesh.position.z);
  };
  place(0);

  let t = 0;
  let landed = false;
  return {
    update(dt: number): boolean {
      t += dt;
      if (!landed) {
        const f = Math.min(1, t / FLIGHT_S);
        place(f);
        if (f >= 1) {
          landed = true;
          mesh.rotation.set(Math.PI / 2, 0, facingAngle);
          onLand(x, z, DURATION_S - t);
        }
      }
      if (t >= DURATION_S) {
        giveLight(scene, light);
        scene.remove(mesh);
        mat.dispose();
        return false;
      }
      const fadeStart = DURATION_S - FADE_S;
      if (t > fadeStart) {
        const fade = 1 - (t - fadeStart) / FADE_S;
        light.intensity = BASE_INTENSITY * fade;
        mat.emissiveIntensity = 2.2 * fade;
      }
      return true;
    },
  };
}
