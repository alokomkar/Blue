import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { alignWeaponHand } from './weapon-alignment.ts';

test('gun stays level and follows facing under rotated, scaled guard parents', () => {
  for (const scale of [0.5, 1, 1.22, 2])
    for (const yaw of [0, 0.8, Math.PI, -Math.PI / 2]) {
      const root = new THREE.Group();
      root.scale.setScalar(scale);
      root.rotation.set(0.2, yaw, 0.3);
      const hand = new THREE.Bone();
      hand.position.set(0.2, 1, 0.4);
      root.add(hand);
      const gun = new THREE.Group();
      gun.rotation.set(0.3, -0.9, 0.7);
      gun.position.set(0.01, 0.03, -0.02);
      hand.add(gun);
      root.updateMatrixWorld(true);
      const local = gun.quaternion.clone(),
        offset = gun.position.clone();
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      for (const pitch of [0, 0.3, -0.4]) {
        const forward = new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch)
        );
        assert.equal(alignWeaponHand(hand, local, forward), true);
        const q = gun.getWorldQuaternion(new THREE.Quaternion());
        assert.ok(
          new THREE.Vector3(0, 0, -1).applyQuaternion(q).distanceTo(forward) <
            1e-6
        );
        assert.ok(
          Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(q).y) < 1e-6,
          'no sideways roll'
        );
        assert.ok(
          hand.getWorldPosition(new THREE.Vector3()).distanceTo(wrist) < 1e-6,
          'wrist stays placed'
        );
        assert.deepEqual(gun.position, offset, 'grip attachment stays fixed');
      }
    }
});

test('invalid and straight-up directions leave the wrist unchanged, including no parent', () => {
  const hand = new THREE.Bone();
  hand.rotation.set(0.1, 0.2, 0.3);
  const rest = hand.quaternion.clone();
  for (const dir of [
    new THREE.Vector3(),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(NaN, 0, 1),
    new THREE.Vector3(Infinity, 0, 1),
  ]) {
    assert.equal(alignWeaponHand(hand, new THREE.Quaternion(), dir), false);
    assert.deepEqual(hand.quaternion.toArray(), rest.toArray());
  }
  assert.equal(
    alignWeaponHand(hand, new THREE.Quaternion(), new THREE.Vector3(1, 0, 0)),
    true
  );
});

test('forearm absorbs wrist roll without moving the hand or changing weapon aim', async () => {
  const { relaxWrist } = await import('./weapon-alignment.ts');
  for (const scale of [0.5, 1, 1.22, 2])
    for (const roll of [-Math.PI, -1.2, 0, 1.2, Math.PI]) {
      const root = new THREE.Group();
      root.rotation.set(0.4, 0.7, -0.2);
      root.scale.setScalar(scale);
      const forearm = new THREE.Bone();
      const hand = new THREE.Bone();
      root.add(forearm);
      forearm.add(hand);
      hand.position.set(0, 0.3, 0);
      const rest = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.2, 0, -0.1)
      );
      hand.quaternion.copy(
        new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll)
          .multiply(rest)
      );
      root.updateMatrixWorld(true);
      const position = hand.getWorldPosition(new THREE.Vector3());
      const orientation = hand.getWorldQuaternion(new THREE.Quaternion());
      relaxWrist(hand, rest);
      assert.ok(
        hand.getWorldPosition(new THREE.Vector3()).distanceTo(position) < 1e-7
      );
      assert.ok(
        hand.getWorldQuaternion(new THREE.Quaternion()).angleTo(orientation) <
          1e-7
      );
      assert.ok(
        hand.quaternion.angleTo(rest) < 1e-7,
        'roll is removed from the wrist'
      );
    }
  const orphan = new THREE.Bone();
  relaxWrist(orphan, new THREE.Quaternion());
  assert.deepEqual(orphan.quaternion.toArray(), [0, 0, 0, 1]);
});
