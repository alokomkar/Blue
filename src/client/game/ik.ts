// Lightweight CCD (Cyclic Coordinate Descent) two-joint IK — bends the
// player's support (left) arm each frame so it looks like it's actually
// holding the gun's foregrip, layered on top of the stock Mixamo walk/idle
// animation, which has no weapon-holding pose of its own (confirmed even
// the reference third-person-shooter asset the player asked about had to
// hand-modify its Mixamo animations for exactly this reason — a stock clip
// alone doesn't produce a believable two-handed grip).
//
// CCD (rather than an analytic law-of-cosines solve) was chosen because it
// operates in world space via quaternions without needing to know this
// rig's specific per-bone rest-axis conventions — the same kind of
// sanitized/undocumented rig detail that already caused two separate bugs
// this session (the ':' GLTFLoader strips from bone names, and not knowing
// the hand bone's local axis convention for the weapon attachment).

import * as THREE from 'three';

export type IKChain = {
  /** Root-to-tip-adjacent order, e.g. [upperArm, foreArm] — the hand itself isn't included, it's the end effector. */
  joints: THREE.Object3D[];
  endEffector: THREE.Object3D;
};

const ITERATIONS = 8;
const MIN_ANGLE = 1e-4;

/**
 * Sum of the chain's bone lengths, measured from its *current* world pose —
 * the fixed reach a two-joint chain can actually cover. A target placed
 * beyond this forces the chain fully straight (no elbow bend at all), which
 * reads as a stiff, sticking-out arm rather than a held pose — the exact
 * bug reported after the first version of this IK shipped with a blindly
 * guessed target position. Reusable both to size a target sensibly up
 * front and to clamp one that drifts out of reach at runtime.
 */
export function chainReach(chain: IKChain): number {
  const a = chain.joints[0]!.getWorldPosition(new THREE.Vector3());
  let total = 0;
  let prev = a;
  for (let i = 1; i < chain.joints.length; i++) {
    const p = chain.joints[i]!.getWorldPosition(new THREE.Vector3());
    total += prev.distanceTo(p);
    prev = p;
  }
  total += prev.distanceTo(
    chain.endEffector.getWorldPosition(new THREE.Vector3())
  );
  return total;
}

/** Pulls `target` back onto a sphere of `maxReach * safety` around `origin` if it's further than that — keeps a two-joint IK chain visibly bent instead of forced ramrod-straight. */
export function clampToReach(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  maxReach: number,
  safety = 0.92
): THREE.Vector3 {
  const delta = new THREE.Vector3().subVectors(target, origin);
  const limit = maxReach * safety;
  if (delta.length() <= limit) return target;
  return origin.clone().addScaledVector(delta.normalize(), limit);
}

export function solveCCD(chain: IKChain, targetWorld: THREE.Vector3): void {
  const jointWorldPos = new THREE.Vector3();
  const endWorldPos = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const jointWorldQuat = new THREE.Quaternion();
  const parentWorldQuat = new THREE.Quaternion();
  const worldDelta = new THREE.Quaternion();

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = chain.joints.length - 1; i >= 0; i--) {
      const joint = chain.joints[i]!;
      joint.getWorldPosition(jointWorldPos);
      chain.endEffector.getWorldPosition(endWorldPos);

      toEnd.subVectors(endWorldPos, jointWorldPos).normalize();
      toTarget.subVectors(targetWorld, jointWorldPos).normalize();

      const dot = THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1);
      const angle = Math.acos(dot);
      if (angle < MIN_ANGLE) continue;

      axis.crossVectors(toEnd, toTarget);
      if (axis.lengthSq() < 1e-8) continue;
      axis.normalize();

      worldDelta.setFromAxisAngle(axis, angle);
      joint.getWorldQuaternion(jointWorldQuat);
      const newWorldQuat = worldDelta.multiply(jointWorldQuat);

      const parent = joint.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(parentWorldQuat);
      const newLocalQuat = parentWorldQuat.invert().multiply(newWorldQuat);
      joint.quaternion.copy(newLocalQuat);
      joint.updateMatrixWorld(true);
    }
  }
}

/** Two-bone solve with an explicit elbow pole; prevents a folded-back weapon wrist. */
export function solveTwoBone(
  chain: IKChain,
  target: THREE.Vector3,
  pole: THREE.Vector3
): void {
  const upper = chain.joints[0],
    lower = chain.joints[1];
  if (!upper || !lower) return;
  const at = (bone: THREE.Object3D) =>
    bone.getWorldPosition(new THREE.Vector3());
  const shoulder = at(upper),
    elbow = at(lower),
    wrist = at(chain.endEffector);
  const a = shoulder.distanceTo(elbow),
    b = elbow.distanceTo(wrist);
  if (a < 1e-8 || b < 1e-8) return;
  const direction = target.clone().sub(shoulder);
  if (direction.lengthSq() < 1e-8) return;
  const distance = THREE.MathUtils.clamp(
    direction.length(),
    Math.abs(a - b) + 1e-6,
    a + b - 1e-6
  );
  direction.normalize();
  const bend = pole.clone().sub(shoulder);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-8) return;
  bend.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const elbowTarget = shoulder
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(bend, height);
  const wristTarget = shoulder.clone().addScaledVector(direction, distance);
  const turn = (
    bone: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3
  ) => {
    const delta = new THREE.Quaternion().setFromUnitVectors(
      from.normalize(),
      to.normalize()
    );
    const desired = delta.multiply(
      bone.getWorldQuaternion(new THREE.Quaternion())
    );
    const parent =
      bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
      new THREE.Quaternion();
    bone.quaternion.copy(parent.invert().multiply(desired));
    bone.updateMatrixWorld(true);
  };
  turn(upper, elbow.clone().sub(shoulder), elbowTarget.clone().sub(shoulder));
  turn(lower, at(chain.endEffector).sub(at(lower)), wristTarget.sub(at(lower)));
}
