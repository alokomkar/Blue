import { weaponWrist } from './weapon-alignment';
import * as THREE from 'three';
import { chainReach, clampToReach, solveTwoBone, type IKChain } from './ik';

const CURLS: Record<string, readonly number[]> = {
  Index: [0.45, 0.55, 0.25],
  Middle: [1.15, 1.35, 0.9],
  Ring: [1.2, 1.4, 0.95],
  Pinky: [1.2, 1.4, 0.95],
};

/** Capture the resting hands once, then layer a two-handed weapon hold after animation. */
export function guardWeaponHold(
  model: THREE.Object3D,
  gun: { group: THREE.Object3D; support: THREE.Object3D }
) {
  model.updateMatrixWorld(true);
  // A pistol uses a support palm around the firing grip, not a distant rifle foregrip.
  gun.support.position.set(-0.06, -0.115, 0.05);
  const chain = (side: string): IKChain | null => {
    const arm = model.getObjectByName(`mixamorig${side}Arm`);
    const forearm = model.getObjectByName(`mixamorig${side}ForeArm`);
    const hand = model.getObjectByName(`mixamorig${side}Hand`);
    return arm && forearm && hand
      ? { joints: [arm, forearm], endEffector: hand }
      : null;
  };
  const primary = chain('Right'),
    support = chain('Left');
  const primaryReach = primary ? chainReach(primary) : 0;
  const supportReach = support ? chainReach(support) : 0;
  const supportMiddle = model.getObjectByName('mixamorigLeftHandMiddle1');
  const palmLength =
    support && supportMiddle
      ? support.endEffector
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(supportMiddle.getWorldPosition(new THREE.Vector3())) *
        0.55
      : 0;
  const supportTarget = (forward: THREE.Vector3) =>
    gun.support
      .getWorldPosition(new THREE.Vector3())
      .addScaledVector(forward.clone().normalize(), -palmLength);
  const fingers = ['Right', 'Left'].map((side) => ({
    side,
    index: model.getObjectByName(`mixamorig${side}HandIndex1`),
    pinky: model.getObjectByName(`mixamorig${side}HandPinky1`),
    joints: Object.entries(CURLS).flatMap(([finger, curls]) =>
      curls.flatMap((curl, i) => {
        const bone = model.getObjectByName(
          `mixamorig${side}Hand${finger}${i + 1}`
        );
        return bone ? [{ bone, curl, rest: bone.quaternion.clone() }] : [];
      })
    ),
  }));
  const primaryWrist = primary
    ? weaponWrist(primary.endEffector, gun.group.quaternion)
    : null;
  const supportWrist = support ? weaponWrist(support.endEffector) : null;
  function worldTurn(bone: THREE.Object3D, delta: THREE.Quaternion) {
    const parent =
      bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
      new THREE.Quaternion();
    bone.quaternion.premultiply(
      parent.clone().invert().multiply(delta).multiply(parent)
    );
    bone.updateMatrixWorld(true);
  }
  let elbowBack = new THREE.Vector3(0, 0, -1);
  function reach(arm: IKChain, target: THREE.Vector3, length: number) {
    const shoulder = arm.joints[0]!.getWorldPosition(new THREE.Vector3());
    const pole = shoulder
      .clone()
      .addScaledVector(elbowBack, length * 0.35)
      .add(new THREE.Vector3(0, -length, 0));
    solveTwoBone(arm, clampToReach(shoulder, target, length), pole);
  }
  /** `forwardIn` is where the muzzle points: level along the guard's facing, or tipped up or down at whoever it has in its sights. */
  return (target: THREE.Vector3, forwardIn: THREE.Vector3) => {
    if (!primary || forwardIn.lengthSq() < 1e-8) return;
    const forward = forwardIn;
    // (The elbows stay behind the hands on the floor plane, however the muzzle tips.)
    elbowBack = forward.clone().setY(0).normalize().negate();
    // Anchor the hold to the animated shoulders, including the forward lean of a jog.
    // A fixed world-space hand target can wind up behind the elbows.
    const rightShoulder = primary.joints[0]!.getWorldPosition(
      new THREE.Vector3()
    );
    const chest = support
      ? rightShoulder
          .clone()
          .add(support.joints[0]!.getWorldPosition(new THREE.Vector3()))
          .multiplyScalar(0.5)
      : rightShoulder.clone();
    const lateral = forward
      .clone()
      .cross(new THREE.Vector3(0, 1, 0))
      .normalize();
    const ready = chest
      .addScaledVector(forward.clone().normalize(), primaryReach * 0.5)
      .addScaledVector(lateral, primaryReach * 0.17);
    ready.y -= Math.min(
      primaryReach * 0.4,
      Math.max(primaryReach * 0.3, rightShoulder.y - target.y)
    );
    reach(primary, ready, primaryReach);
    primaryWrist?.(forward);
    if (support) {
      // Bring the whole hold back toward the chest when the foregrip would
      // force the support arm straight. Never move the gun independently of its hand.
      for (let step = 0; step < 5; step++) {
        const grip = supportTarget(forward);
        const shoulder = support.joints[0]!.getWorldPosition(
          new THREE.Vector3()
        );
        const correction = clampToReach(shoulder, grip, supportReach, 0.85).sub(
          grip
        );
        if (correction.lengthSq() < 1e-6) break;
        reach(
          primary,
          primary.endEffector
            .getWorldPosition(new THREE.Vector3())
            .add(correction),
          primaryReach
        );
        primaryWrist?.(forward);
      }
      reach(support, supportTarget(forward), supportReach);
    }
    supportWrist?.(forward);
    for (const finger of fingers) {
      if (!finger.index || !finger.pinky) continue;
      const axis = finger.index
        .getWorldPosition(new THREE.Vector3())
        .sub(finger.pinky.getWorldPosition(new THREE.Vector3()))
        .normalize();
      for (const { bone, curl, rest } of finger.joints) {
        bone.quaternion.copy(rest);
        bone.updateMatrixWorld(true);
        worldTurn(
          bone,
          new THREE.Quaternion().setFromAxisAngle(
            axis,
            curl * (finger.side === 'Right' ? 1 : -0.8)
          )
        );
      }
    }
  };
}
