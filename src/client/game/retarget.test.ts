import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  retargetClip,
  retargetCrouchClip,
  retargetWalkClip,
} from './retarget.ts';

function rig(scale = 1): THREE.Group {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.y = 1;
  root.add(hips);
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.position.y = 1;
  hips.add(head);
  const foot = new THREE.Bone();
  foot.name = 'mixamorigLeftFoot';
  foot.position.set(0.1, -0.9, 0);
  hips.add(foot);
  const toe = new THREE.Bone();
  toe.name = 'mixamorigLeftToe_End';
  toe.position.z = 0.2;
  foot.add(toe);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  return root;
}

test('walking preserves scaled hip rise/fall without copying horizontal root travel', () => {
  for (const scale of [0.5, 1, 2]) {
    const source = rig();
    const target = rig(scale);
    const walk = new THREE.AnimationClip('walk', 1, [
      new THREE.VectorKeyframeTrack(
        'mixamorigHips.position',
        [0, 0.5, 1],
        [0, 1, 0, 3, 0.9, 5, 6, 1, 10]
      ),
    ]);
    const clip = retargetWalkClip(walk, source, target);
    const hipTrack = clip.tracks.find(
      (t) => t.name === 'mixamorigHips.position'
    );
    assert.ok(hipTrack, 'walk must animate the hips vertically');
    for (let i = 0; i < hipTrack.times.length; i++) {
      assert.equal(hipTrack.values[i * 3], 0);
      assert.equal(hipTrack.values[i * 3 + 2], 0);
    }
    assert.ok(Math.abs(hipTrack.values[15 * 3 + 1]! - 0.9) < 1e-6);
    assert.deepEqual(
      source.getObjectByName('mixamorigHips')?.position.toArray(),
      [0, 1, 0]
    );
    assert.deepEqual(
      target.getObjectByName('mixamorigHips')?.position.toArray(),
      [0, 1, 0]
    );
  }
});

test('stationary hips remain stationary and legacy rotation-only clips remain available', () => {
  const source = rig();
  const target = rig();
  const idle = new THREE.AnimationClip('idle', 1, [
    new THREE.QuaternionKeyframeTrack(
      'mixamorigHips.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1]
    ),
  ]);
  const corrected = retargetClip(idle, source, target, 30, true);
  const track = corrected.tracks.find((t) => t.name.endsWith('.position'));
  assert.ok(track);
  for (let i = 1; i < track.values.length; i += 3)
    assert.equal(track.values[i], 1);
  assert.ok(
    retargetClip(idle, source, target).tracks.every((t) =>
      t.name.endsWith('.quaternion')
    )
  );
});

function walkingRig(scale: number, angle: number): THREE.Group {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  root.rotation.y = angle;
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.y = 1;
  root.add(hips);
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.position.y = 0.7;
  hips.add(head);
  for (const [side, sign] of [
    ['Left', 1],
    ['Right', -1],
  ] as const) {
    const thigh = new THREE.Bone();
    thigh.name = `mixamorig${side}UpLeg`;
    thigh.position.set(sign * 0.13, -0.1, 0);
    hips.add(thigh);
    const shin = new THREE.Bone();
    shin.name = `mixamorig${side}Leg`;
    shin.position.y = -0.4;
    thigh.add(shin);
    const foot = new THREE.Bone();
    foot.name = `mixamorig${side}Foot`;
    foot.position.y = -0.4;
    shin.add(foot);
    const toe = new THREE.Bone();
    toe.name = `mixamorig${side}Toe_End`;
    toe.position.z = 0.16;
    foot.add(toe);
  }
  root.updateMatrixWorld(true);
  return root;
}

test('walk narrows lateral foot spacing while preserving stride, height, foot angle and bone lengths', () => {
  for (const scale of [0.5, 1, 2]) {
    for (const angle of [0, Math.PI / 2]) {
      const source = walkingRig(1, 0);
      const target = walkingRig(scale, angle);
      const tracks = [];
      for (const [side, sign] of [
        ['Left', 1],
        ['Right', -1],
      ] as const) {
        const values = [0.18, 0.08, 0.18].flatMap((spread) =>
          new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), sign * spread)
            .toArray()
        );
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `mixamorig${side}UpLeg.quaternion`,
            [0, 0.5, 1],
            values
          )
        );
      }
      const walk = new THREE.AnimationClip('walk', 1, tracks);
      const wide = retargetClip(walk, source, target, 30, true);
      const narrow = retargetWalkClip(walk, source, target);
      for (const track of narrow.tracks.filter((t) =>
        t.name.endsWith('.quaternion')
      )) {
        const first = new THREE.Quaternion()
          .fromArray(track.values, 0)
          .normalize();
        const last = new THREE.Quaternion()
          .fromArray(track.values, track.values.length - 4)
          .normalize();
        assert.ok(
          first.angleTo(last) < 1e-5,
          'the looping gait must have no seam'
        );
      }
      // Baking must not leave the target posed or modify the source clip.
      assert.equal(
        target
          .getObjectByName('mixamorigLeftUpLeg')!
          .quaternion.angleTo(new THREE.Quaternion()),
        0
      );
      assert.equal(walk.tracks.length, 2);
      const sample = (clip: THREE.AnimationClip, time: number) => {
        const mixer = new THREE.AnimationMixer(target);
        mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
        mixer.setTime(time);
        target.updateMatrixWorld(true);
        const world = (name: string) =>
          target
            .getObjectByName(`mixamorig${name}`)!
            .getWorldPosition(new THREE.Vector3());
        const values = (['Left', 'Right'] as const).map((side) => ({
          foot: world(`${side}Foot`).applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -angle
          ),
          q: target
            .getObjectByName(`mixamorig${side}Foot`)!
            .getWorldQuaternion(new THREE.Quaternion()),
          upper: world(`${side}UpLeg`).distanceTo(world(`${side}Leg`)),
          lower: world(`${side}Leg`).distanceTo(world(`${side}Foot`)),
          knee: world(`${side}Leg`).applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -angle
          ),
        }));
        mixer.stopAllAction();
        mixer.uncacheRoot(target);
        return values;
      };
      for (const time of [0, 0.25, 0.5, 0.75]) {
        const before = sample(wide, time);
        const after = sample(narrow, time);
        for (let i = 0; i < 2; i++) {
          assert.ok(
            Math.abs(after[i]!.foot.x - before[i]!.foot.x * 0.65) < 1e-5
          );
          assert.ok(Math.abs(after[i]!.foot.y - before[i]!.foot.y) < 1e-5);
          assert.ok(Math.abs(after[i]!.foot.z - before[i]!.foot.z) < 1e-5);
          assert.ok(after[i]!.q.angleTo(before[i]!.q) < 1e-5);
          assert.ok(Math.abs(after[i]!.upper - 0.4 * scale) < 1e-6);
          assert.ok(Math.abs(after[i]!.lower - 0.4 * scale) < 1e-6);
          assert.ok(
            after[i]!.knee.z >= -1e-6,
            'knees bend forwards, not outwards/backwards'
          );
        }
        assert.ok(after[0]!.foot.x > after[1]!.foot.x, 'feet must not cross');
      }
    }
  }
});

test('straight, zero-length and incomplete legs stay finite without stretching to unreachable steps', () => {
  for (const kind of ['straight', 'zero-length', 'incomplete'] as const) {
    const source = walkingRig(1, 0);
    const target = walkingRig(1, 0);
    if (kind === 'zero-length')
      target.getObjectByName('mixamorigLeftLeg')!.position.set(0, 0, 0);
    if (kind === 'incomplete')
      target.getObjectByName('mixamorigRightLeg')!.name = 'unmatchedShin';
    target.updateMatrixWorld(true);
    const idle = new THREE.AnimationClip('straight', 1, [
      new THREE.QuaternionKeyframeTrack(
        'mixamorigHips.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1]
      ),
    ]);
    const walk = retargetWalkClip(idle, source, target);
    for (const track of walk.tracks) {
      assert.ok(Array.from(track.values).every(Number.isFinite));
    }
    if (kind === 'straight') {
      const mixer = new THREE.AnimationMixer(target);
      mixer.clipAction(walk).play();
      mixer.setTime(0.5);
      target.updateMatrixWorld(true);
      for (const side of ['Left', 'Right']) {
        const foot = target
          .getObjectByName(`mixamorig${side}Foot`)!
          .getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(foot.y - 0.1) < 1e-6);
        assert.ok(
          Math.abs(Math.abs(foot.x) - 0.13) < 1e-6,
          'fully straight stance stays within reach'
        );
      }
      mixer.stopAllAction();
    }
  }
});

test('crouching looks horizontally forward while keeping the crouch and sharing correction with the neck', () => {
  for (const angle of [0, Math.PI / 2]) {
    for (const [sourceHasNeck, withNeck] of [
      [true, true],
      [false, false],
      [false, true],
    ] as const) {
      const source = walkingRig(1, 0);
      const target = walkingRig(1.5, angle);
      for (const root of [source, target]) {
        if (root === source ? !sourceHasNeck : !withNeck) continue;
        const hips = root.getObjectByName('mixamorigHips')!;
        const head = root.getObjectByName('mixamorigHead')!;
        const neck = new THREE.Bone();
        neck.name = 'mixamorigNeck';
        neck.position.y = 0.5;
        hips.add(neck);
        neck.add(head);
        head.position.y = 0.2;
        root.updateMatrixWorld(true);
      }
      const pitch = (degrees: number) =>
        new THREE.Quaternion()
          .setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            (degrees * Math.PI) / 180
          )
          .toArray();
      const crouch = new THREE.AnimationClip('crouch', 1, [
        new THREE.QuaternionKeyframeTrack(
          'mixamorigHips.quaternion',
          [0, 0.5, 1],
          [...pitch(35), ...pitch(45), ...pitch(35)]
        ),
        new THREE.QuaternionKeyframeTrack(
          'mixamorigHead.quaternion',
          [0, 0.5, 1],
          [...pitch(15), ...pitch(20), ...pitch(15)]
        ),
        new THREE.VectorKeyframeTrack(
          'mixamorigHips.position',
          [0, 0.5, 1],
          [0, 0.85, 0, 0, 0.8, 0, 0, 0.85, 0]
        ),
      ]);
      const baseline = retargetClip(crouch, source, target, 30, true);
      const fixed = retargetCrouchClip(crouch, source, target);
      for (const track of baseline.tracks) {
        if (/mixamorig(Head|Neck)\.quaternion/.test(track.name)) continue;
        const actual = fixed.tracks.find((t) => t.name === track.name);
        assert.deepEqual(
          actual?.values,
          track.values,
          'only head/neck rotation may change'
        );
      }
      const head = target.getObjectByName('mixamorigHead')!;
      const restQ = head.getWorldQuaternion(new THREE.Quaternion());
      assert.ok(
        head.quaternion.angleTo(new THREE.Quaternion()) < 1e-6,
        'baking restores the rest pose'
      );
      const mixer = new THREE.AnimationMixer(target);
      mixer.clipAction(fixed).play();
      for (const time of [0, 0.2, 0.5, 0.8]) {
        mixer.setTime(time);
        target.updateMatrixWorld(true);
        assert.ok(
          head.getWorldQuaternion(new THREE.Quaternion()).angleTo(restQ) < 1e-5,
          'head must face the standing forward direction'
        );
        if (withNeck) {
          const neck = target.getObjectByName('mixamorigNeck')!;
          const bend = neck.quaternion.angleTo(new THREE.Quaternion());
          assert.ok(
            bend > 0.1 && bend < Math.PI / 3,
            'neck shares a moderate part of the correction'
          );
        }
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(target);
      assert.ok(
        source
          .getObjectByName('mixamorigHead')!
          .quaternion.angleTo(new THREE.Quaternion()) < 1e-6
      );
    }
  }
});

test('retimeClip stretches a clip to a new length, keeping its poses', async () => {
  const { retimeClip } = await import('./retarget.ts');
  const track = new THREE.VectorKeyframeTrack('a.position', [0, 0.5, 1], [0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const clip = new THREE.AnimationClip('x', 1, [track]);
  const slow = retimeClip(clip, 2, 'slow');
  assert.equal(slow.name, 'slow');
  assert.equal(slow.duration, 2);
  assert.deepEqual([...slow.tracks[0]!.times], [0, 1, 2]);
  assert.deepEqual([...slow.tracks[0]!.values], [...track.values]);
  assert.deepEqual([...clip.tracks[0]!.times], [0, 0.5, 1], 'the original is left alone');
});
