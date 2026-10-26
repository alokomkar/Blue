import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveTwoBone } from './ik.ts';

test('elbow pole preserves limb lengths and reaches targets under rotated, scaled parents', () => {
  for (const scale of [0.5, 1, 1.22, 2])
    for (const yaw of [0, Math.PI / 2, Math.PI])
      for (const target of [
        new THREE.Vector3(0.1, -0.2, 0.3),
        new THREE.Vector3(0, 0, 3),
      ]) {
        const root = new THREE.Group();
        root.scale.setScalar(scale);
        root.rotation.y = yaw;
        const upper = new THREE.Bone(),
          lower = new THREE.Bone(),
          hand = new THREE.Bone();
        root.add(upper);
        upper.add(lower);
        lower.add(hand);
        lower.position.set(0.25, 0, 0);
        hand.position.set(0.25, 0, 0);
        root.updateMatrixWorld(true);
        const goal = root.localToWorld(target.clone());
        solveTwoBone(
          { joints: [upper, lower], endEffector: hand },
          goal,
          root.localToWorld(new THREE.Vector3(0, -1, -0.3))
        );
        const shoulder = upper.getWorldPosition(new THREE.Vector3()),
          elbow = lower.getWorldPosition(new THREE.Vector3()),
          wrist = hand.getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(elbow.distanceTo(shoulder) - 0.25 * scale) < 1e-6);
        assert.ok(Math.abs(wrist.distanceTo(elbow) - 0.25 * scale) < 1e-6);
        if (target.length() < 0.5) assert.ok(wrist.distanceTo(goal) < 1e-6);
        assert.ok(
          root.worldToLocal(elbow).y < 0,
          'elbow bends toward the lower pole'
        );
        assert.ok(hand.matrixWorld.elements.every(Number.isFinite));
      }
});

test('degenerate limbs, zero distance and collinear poles keep finite transforms', () => {
  for (const length of [0, 0.25]) {
    const root = new THREE.Bone(),
      lower = new THREE.Bone(),
      hand = new THREE.Bone();
    root.add(lower);
    lower.add(hand);
    lower.position.x = length;
    hand.position.x = length;
    root.updateMatrixWorld(true);
    const chain = { joints: [root, lower], endEffector: hand };
    for (const goal of [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]) {
      solveTwoBone(chain, goal, new THREE.Vector3(1, 0, 0));
      assert.ok(hand.matrixWorld.elements.every(Number.isFinite));
    }
    solveTwoBone(
      { joints: [], endEffector: hand },
      new THREE.Vector3(),
      new THREE.Vector3()
    );
  }
});
