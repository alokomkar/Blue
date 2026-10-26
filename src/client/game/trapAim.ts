// The trap's aim, drawn on the floor while the player lines up a roll: a
// dashed path from their feet to where the trap will come to rest
// (trapRoll.ts), and a ring there the size of its blast. Amber while it will
// stop against a wall or run out of roll, green when it will settle into a
// pack's meeting point or a sentry's post. game.ts moves it every frame as
// the player turns.

import * as THREE from 'three';
import { BEAM_COLOUR, TRAP_RADIUS } from './traps';
import type { Beam } from './trapSensor';

const DASH_LEN = 0.34;
const DASH_GAP = 0.26;
const DASH_W = 0.1;
const MAX_DASHES = 16;
const LIFT = 0.04; // above the floor, clear of its surface
const AIMING = 0xffb347;
const SNAPPED = 0x4ee08a;

export type TrapAim = {
  /** Shows the path from (fromX, fromZ) to the stop at (toX, toZ) on a floor at height `y`; `snapped`: it settles into a slot. */
  show: (fromX: number, fromZ: number, toX: number, toZ: number, y: number, snapped: boolean, beam?: Beam) => void;
  hide: () => void;
  dispose: () => void;
};

export function buildTrapAim(scene: THREE.Scene): TrapAim {
  const group = new THREE.Group();
  group.visible = false;
  const mat = new THREE.MeshBasicMaterial({ color: AIMING, transparent: true, opacity: 0.85, depthWrite: false });
  const fill = new THREE.MeshBasicMaterial({ color: AIMING, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const dashGeo = new THREE.PlaneGeometry(DASH_W, DASH_LEN);
  dashGeo.rotateX(-Math.PI / 2);
  const dashes = Array.from({ length: MAX_DASHES }, () => {
    const m = new THREE.Mesh(dashGeo, mat);
    group.add(m);
    return m;
  });
  const ringGeo = new THREE.RingGeometry(TRAP_RADIUS - 0.07, TRAP_RADIUS, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, mat);
  const discGeo = new THREE.CircleGeometry(TRAP_RADIUS - 0.07, 48);
  discGeo.rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, fill);
  const dotGeo = new THREE.CircleGeometry(0.22, 20);
  dotGeo.rotateX(-Math.PI / 2);
  const dot = new THREE.Mesh(dotGeo, mat);
  // The trap's motion sensor, as it would lie across the stop: a blue line, whatever the colour of the rest.
  const wireMat = new THREE.MeshBasicMaterial({ color: BEAM_COLOUR, transparent: true, opacity: 0.8, depthWrite: false });
  const wireGeo = new THREE.PlaneGeometry(1, 0.07);
  wireGeo.rotateX(-Math.PI / 2);
  const wire = new THREE.Mesh(wireGeo, wireMat);
  wire.visible = false;
  group.add(ring, disc, dot, wire);
  for (const o of group.children) o.renderOrder = 2;
  scene.add(group);

  return {
    show(fromX, fromZ, toX, toZ, y, snapped, beam) {
      group.visible = true;
      const c = snapped ? SNAPPED : AIMING;
      mat.color.setHex(c);
      fill.color.setHex(c);
      const dx = toX - fromX;
      const dz = toZ - fromZ;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      // Dashes from just ahead of the feet up to the stop, the last one ending short of the dot.
      const start = 0.45;
      dashes.forEach((d, i) => {
        const along = start + i * (DASH_LEN + DASH_GAP) + DASH_LEN / 2;
        d.visible = along + DASH_LEN / 2 < len - 0.2;
        if (!d.visible) return;
        d.position.set(fromX + (dx / len) * along, y + LIFT, fromZ + (dz / len) * along);
        d.rotation.y = yaw;
      });
      for (const m of [ring, disc, dot]) m.position.set(toX, y + LIFT, toZ);
      wire.visible = beam !== undefined;
      if (beam) {
        wire.position.set((beam.ax + beam.bx) / 2, y + LIFT + 0.01, (beam.az + beam.bz) / 2);
        wire.scale.x = Math.max(0.1, Math.hypot(beam.ax - beam.bx, beam.az - beam.bz));
        wire.rotation.y = Math.atan2(-(beam.az - beam.bz), beam.ax - beam.bx);
      }
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      group.removeFromParent();
      for (const g of [dashGeo, ringGeo, discGeo, dotGeo, wireGeo]) g.dispose();
      wireMat.dispose();
      mat.dispose();
      fill.dispose();
    },
  };
}
