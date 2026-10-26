// A shoulder lamp: a small housing strapped high on the chest by the left
// shoulder, lens facing forward. The player's torch light shines from it;
// guards wear one too, whose beam shows where they're looking. Placed from
// the rig's own anatomy (its body frame and bone positions), so it sits
// right on any Mixamo character, and parented to the chest bone so it rides
// every animation.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { bodyFrame } from './retarget';

export type ShoulderLamp = {
  /** At the lens: where the light (or beam) comes from. */
  anchor: THREE.Object3D;
  setOn: (on: boolean) => void;
};

/** Straps a lamp onto `model`, which must be in its rest (T) pose and not yet animated. */
export function strapLamp(model: THREE.Object3D, color: number): ShoulderLamp | null {
  const chest = model.getObjectByName('mixamorigSpine2');
  const shoulder = model.getObjectByName('mixamorigLeftShoulder');
  const head = model.getObjectByName('mixamorigHeadTop_End');
  const toe = model.getObjectByName('mixamorigLeftToe_End');
  if (!chest || !shoulder || !head || !toe) return null;
  model.updateMatrixWorld(true);
  const height = head.getWorldPosition(new THREE.Vector3()).y - toe.getWorldPosition(new THREE.Vector3()).y;
  const s = height / 1.8; // everything sized for a 1.8 m body, scaled to this one
  const frame = bodyFrame(model);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);

  const group = new THREE.Group();
  const housing = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.5, metalness: 0.6 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 2.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.05 * s, 0.07 * s), housing);
  group.add(box);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019 * s, 14), lensMat);
  lens.position.z = 0.036 * s;
  markBloom(lens);
  group.add(lens);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.012 * s, 0.09 * s, 0.03 * s), housing);
  strap.position.set(0, 0.05 * s, -0.01 * s);
  group.add(strap);
  const anchor = new THREE.Object3D();
  anchor.position.z = 0.04 * s;
  group.add(anchor);

  // Just below and in front of the collarbone, facing the way the body does.
  group.position
    .copy(shoulder.getWorldPosition(new THREE.Vector3()))
    .addScaledVector(forward, 0.13 * s)
    .addScaledVector(up, -0.04 * s);
  group.quaternion.copy(frame);
  group.updateMatrixWorld(true);
  chest.attach(group);

  return {
    anchor,
    setOn(on) {
      lensMat.emissiveIntensity = on ? 2.4 : 0.05;
    },
  };
}
