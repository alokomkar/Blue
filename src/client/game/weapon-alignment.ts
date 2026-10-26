import * as THREE from 'three';

/** Level a weapon attached to a hand without moving its grip out of the palm. */
export function alignWeaponHand(
  hand: THREE.Object3D,
  weaponInHand: THREE.Quaternion,
  forward: THREE.Vector3
): boolean {
  if (!forward.toArray().every(Number.isFinite) || forward.lengthSq() < 1e-8)
    return false;
  const back = forward.clone().normalize().negate();
  const right = new THREE.Vector3(0, 1, 0).cross(back);
  if (right.lengthSq() < 1e-8) return false;
  right.normalize();
  const up = back.clone().cross(right).normalize();
  const desired = new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back))
    .multiply(weaponInHand.clone().invert());
  const parent =
    hand.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
    new THREE.Quaternion();
  hand.quaternion.copy(parent.invert().multiply(desired));
  hand.updateMatrixWorld(true);
  return true;
}

/** Move axial roll into the forearm, retaining the solved wrist position and hand aim. */
export function relaxWrist(hand: THREE.Object3D, rest: THREE.Quaternion): void {
  const forearm = hand.parent;
  if (!forearm?.parent) return;
  const desired = hand.getWorldQuaternion(new THREE.Quaternion());
  const axis = hand.position.clone().normalize();
  if (axis.lengthSq() < 1e-8) return;
  const delta = hand.quaternion.clone().multiply(rest.clone().invert());
  const amount = new THREE.Vector3(delta.x, delta.y, delta.z).dot(axis);
  const twist = new THREE.Quaternion(
    axis.x * amount,
    axis.y * amount,
    axis.z * amount,
    delta.w
  );
  if (twist.lengthSq() < 1e-8) return;
  forearm.quaternion.multiply(twist.normalize());
  forearm.updateMatrixWorld(true);
  hand.quaternion.copy(
    forearm
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(desired)
  );
  hand.updateMatrixWorld(true);
}

/** Capture anatomical hand axes before animation, independent of imported bone axes. */
export function weaponWrist(
  hand: THREE.Object3D,
  weaponInHand?: THREE.Quaternion
) {
  const rest = hand.quaternion.clone();
  let frame = weaponInHand?.clone();
  if (!frame) {
    const middle = hand.getObjectByName(`${hand.name}Middle1`);
    const index = hand.getObjectByName(`${hand.name}Index1`);
    const pinky = hand.getObjectByName(`${hand.name}Pinky1`);
    if (!middle || !index || !pinky) return () => {};
    const forward = middle
      .getWorldPosition(new THREE.Vector3())
      .sub(hand.getWorldPosition(new THREE.Vector3()))
      .normalize();
    const up = index
      .getWorldPosition(new THREE.Vector3())
      .sub(pinky.getWorldPosition(new THREE.Vector3()));
    up.addScaledVector(forward, -up.dot(forward)).normalize();
    const back = forward.negate();
    const right = up.clone().cross(back).normalize();
    frame = hand
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(right, up, back)
        )
      );
  }
  const local = frame;
  return (forward: THREE.Vector3) => {
    if (alignWeaponHand(hand, local, forward)) relaxWrist(hand, rest);
  };
}
