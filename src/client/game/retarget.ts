// Moves an animation from one rig to another. Both rigs have the
// same bone names (the Mixamo-style names skins.ts gives the Universal Base
// Characters), but rigs that come through different pipelines can give those
// bones different local axes, so a clip's raw rotations can't just be copied
// across: the new rig could flip upside down.
//
// Instead, each sampled frame is measured as a turn away from the source's
// rest pose, in a body frame taken from the anatomy (up the spine, out
// through the toes), and that same turn is applied to the target's rest
// pose in its own body frame. It only needs both rigs to rest in the same
// pose (both are T-posed). Rotations are moved, and optionally how far the
// hips drop and rise (a crouch has to get lower, not just bend its knees),
// scaled to the target's legs. The game moves the body itself, so root
// motion across the floor is always dropped: a clip that walks off
// somewhere plays on the spot.
//
// Bones are matched by name, whatever the prefix: "mixamorig:", "mixamorig1:"
// or "mixamorig" (GLTFLoader drops the colon either way).

import * as THREE from 'three';

/** A bone's name without its Mixamo prefix: "mixamorig1:Hips" and "mixamorigHips" are both "Hips". */
const boneKey = (name: string): string => name.replace(/^mixamorig\d*:?/, '');

/** The rig's bones by prefix-free name (with `ends`, also the plain end-point nodes some rigs have, like LeftToe_End). */
const bones = (root: THREE.Object3D, ends = false): Map<string, THREE.Object3D> => {
  const out = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || (ends && o.name.startsWith('mixamorig'))) out.set(boneKey(o.name), o);
  });
  return out;
};

/** The rig's own frame: +Y up the spine, +Z the way it faces, +X its left. */
export function bodyFrame(root: THREE.Object3D): THREE.Quaternion {
  const rig = bones(root, true);
  const at = (name: string): THREE.Vector3 => rig.get(name)!.getWorldPosition(new THREE.Vector3());
  const up = at('Head').sub(at('Hips')).normalize();
  const forward = at('LeftToe_End').sub(at('LeftFoot'));
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  const left = new THREE.Vector3().crossVectors(up, forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, forward));
}

/**
 * Returns `clip` (made for the rig `source`) redone for the rig `target`.
 * Both must be in their rest (T) pose when this is called; `source` is
 * animated and put back in the process.
 */
export function retargetClip(clip: THREE.AnimationClip, source: THREE.Object3D, target: THREE.Object3D, fps = 30, withHipsHeight = false): THREE.AnimationClip {
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const src = bones(source);
  const dst = bones(target);
  const names = [...dst.keys()].filter((n) => src.has(n));

  const worldQ = (o: THREE.Object3D): THREE.Quaternion => o.getWorldQuaternion(new THREE.Quaternion());
  const srcRest = new Map(names.map((n) => [n, worldQ(src.get(n)!)]));
  const dstRest = new Map(names.map((n) => [n, worldQ(dst.get(n)!)]));
  const srcFrame = bodyFrame(source);
  const dstFrame = bodyFrame(target);
  const srcFrameInv = srcFrame.clone().invert();
  const dstFrameInv = dstFrame.clone().invert();
  // Parents that aren't animated keep their rest turn.
  const dstParentRest = new Map(names.map((n) => [n, worldQ(dst.get(n)!.parent!)]));

  const restLocal = new Map([...src.values()].map((b) => [b, b.quaternion.clone()]));
  const restPos = new Map([...src.values()].map((b) => [b, b.position.clone()]));
  // The hips' height, measured along each rig's own up, and scaled from the source's legs to the target's.
  const hipsSrc = src.get('Hips');
  const hipsDst = dst.get('Hips');
  const upSrc = new THREE.Vector3(0, 1, 0).applyQuaternion(srcFrame);
  const upDst = new THREE.Vector3(0, 1, 0).applyQuaternion(dstFrame);
  const srcEnds = bones(source, true);
  const dstEnds = bones(target, true);
  const height = (rig: Map<string, THREE.Object3D>, up: THREE.Vector3): number =>
    rig.get('Hips')!.getWorldPosition(new THREE.Vector3()).sub(rig.get('LeftToe_End')!.getWorldPosition(new THREE.Vector3())).dot(up);
  const hips = withHipsHeight && hipsSrc && hipsDst && srcEnds.has('LeftToe_End') && dstEnds.has('LeftToe_End');
  const hipsSrcRest = hipsSrc?.getWorldPosition(new THREE.Vector3());
  const hipsDstRest = hipsDst?.getWorldPosition(new THREE.Vector3());
  const legScale = hips ? height(dstEnds, upDst) / height(srcEnds, upSrc) : 1;
  const hipsValues = hips ? new Float32Array(frames(clip, fps) * 3) : null;
  const at = new THREE.Vector3();

  const mixer = new THREE.AnimationMixer(source);
  // Played once and held, so the last frame sampled is the clip's last (a looping action wraps back to its first at the very end).
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const count = frames(clip, fps);
  const times = new Float32Array(count);
  const values = new Map(names.map((n) => [n, new Float32Array(count * 4)]));
  const world = new Map<string, THREE.Quaternion>();
  const turn = new THREE.Quaternion();
  const local = new THREE.Quaternion();
  for (let f = 0; f < count; f++) {
    const t = Math.min(clip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t);
    source.updateMatrixWorld(true);
    world.clear();
    for (const n of names) {
      // The turn away from rest, in world space, restated in the target's body frame.
      turn.copy(worldQ(src.get(n)!)).multiply(srcRest.get(n)!.clone().invert());
      turn.premultiply(srcFrameInv).multiply(srcFrame);
      turn.premultiply(dstFrame).multiply(dstFrameInv);
      world.set(n, turn.clone().multiply(dstRest.get(n)!));
    }
    for (const n of names) {
      const parent = dst.get(n)!.parent!;
      const parentWorld = world.get(boneKey(parent.name)) ?? dstParentRest.get(n)!;
      local.copy(parentWorld).invert().multiply(world.get(n)!);
      local.toArray(values.get(n)!, f * 4);
    }
    if (hipsValues) {
      // Straight up or down from the target's rest, as far as the source's hips moved along its up, in proportion.
      const drop = hipsSrc!.getWorldPosition(at).sub(hipsSrcRest!).dot(upSrc) * legScale;
      at.copy(hipsDstRest!).addScaledVector(upDst, drop);
      hipsDst!.parent!.worldToLocal(at).toArray(hipsValues, f * 3);
    }
  }

  action.stop();
  mixer.uncacheRoot(source);
  for (const [b, q] of restLocal) b.quaternion.copy(q);
  for (const [b, p] of restPos) b.position.copy(p);
  source.updateMatrixWorld(true);

  const tracks: THREE.KeyframeTrack[] = names.map((n) => new THREE.QuaternionKeyframeTrack(`${dst.get(n)!.name}.quaternion`, times, values.get(n)!));
  if (hipsValues) tracks.push(new THREE.VectorKeyframeTrack(`${hipsDst!.name}.position`, times, hipsValues));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Keep pelvis rise/fall, then bake a narrower foot path without stretching
 * the rig. Horizontal travel still belongs to gameplay. */
export function retargetWalkClip(clip: THREE.AnimationClip, source: THREE.Object3D, target: THREE.Object3D): THREE.AnimationClip {
  const walk = retargetClip(clip, source, target, 30, true);
  return narrowWalkStance(walk, target);
}

/** The crouched torso can lean while the face stays level towards the aim.
 * Split the counter-rotation across neck/head to avoid a single sharp bend. */
export function retargetCrouchClip(clip: THREE.AnimationClip, source: THREE.Object3D, target: THREE.Object3D): THREE.AnimationClip {
  return faceForward(retargetClip(clip, source, target, 30, true), target);
}

/** `clip`, already made for `target`, with its head held to the body's own forward (see retargetCrouchClip). */
export function faceForward(crouch: THREE.AnimationClip, target: THREE.Object3D): THREE.AnimationClip {
  const rig = bones(target);
  const head = rig.get('Head');
  const neck = rig.get('Neck');
  if (!head) return crouch;
  const forwardHead = head.getWorldQuaternion(new THREE.Quaternion());
  const modified = neck ? [neck, head] : [head];
  return bakeRotations(crouch, target, modified, () => {
    if (neck) {
      const correction = forwardHead.clone().multiply(head.getWorldQuaternion(new THREE.Quaternion()).invert());
      const partial = new THREE.Quaternion().slerp(correction, 0.45);
      const world = partial.multiply(neck.getWorldQuaternion(new THREE.Quaternion()));
      const parent = neck.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      neck.quaternion.copy(parent.invert().multiply(world));
      neck.updateMatrixWorld(true);
    }
    const parent = head.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    head.quaternion.copy(parent.invert().multiply(forwardHead));
  });
}

/** `clip` stretched or squeezed to run for `duration` seconds (a clip made for one pace, played at the one a piece of gameplay is timed to). */
export function retimeClip(clip: THREE.AnimationClip, duration: number, name = clip.name): THREE.AnimationClip {
  const k = duration / clip.duration;
  const tracks = clip.tracks.map((t) => t.clone().scale(k));
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Bake the stance into rotations once at load time. Moving bone positions or
 * scaling the legs would stretch the rig; a two-bone solve preserves lengths. */
export function narrowWalkStance(clip: THREE.AnimationClip, target: THREE.Object3D, stanceWidth = 0.65): THREE.AnimationClip {
  const rig = bones(target);
  const hips = rig.get('Hips');
  const legs = (['Left', 'Right'] as const).flatMap((side) => {
    const thigh = rig.get(`${side}UpLeg`);
    const shin = rig.get(`${side}Leg`);
    const foot = rig.get(`${side}Foot`);
    if (!thigh || !shin || !foot) return [];
    return [{ thigh, shin, foot }];
  });
  if (!hips || !legs.length || !clip.tracks.length) return clip;
  const frame = bodyFrame(target);
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(frame);
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
  const modified = legs.flatMap(({ thigh, shin, foot }) => [thigh, shin, foot]);
  const position = (bone: THREE.Object3D): THREE.Vector3 => bone.getWorldPosition(new THREE.Vector3());
  const turn = (bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void => {
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    bone.quaternion.copy(parent.invert().multiply(world));
    bone.updateMatrixWorld(true);
  };
  return bakeRotations(clip, target, modified, () => {
    for (const { thigh, shin, foot } of legs) {
      const hipAt = position(thigh);
      const kneeAt = position(shin);
      const footAt = position(foot);
      const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
      const goal = footAt.clone().addScaledVector(left, (stanceWidth - 1) * footAt.clone().sub(position(hips)).dot(left));
      const upper = hipAt.distanceTo(kneeAt);
      const lower = kneeAt.distanceTo(footAt);
      // Clamp lateral travel to the leg's reachable sphere without moving
      // the foot vertically or forwards, including fully straight legs.
      const rel = goal.clone().sub(hipAt);
      const lateral = rel.dot(left);
      const perpendicular = rel.clone().addScaledVector(left, -lateral).lengthSq();
      const reach = Math.sqrt(Math.max(0, (upper + lower) ** 2 - perpendicular));
      goal.addScaledVector(left, THREE.MathUtils.clamp(lateral, -reach, reach) - lateral);
      const direction = goal.clone().sub(hipAt);
      const distance = direction.length();
      if (distance > Math.abs(upper - lower) + 1e-8 && upper > 0 && lower > 0) {
        direction.divideScalar(distance);
        // Bend towards the body's forward plane rather than out to the
        // side: bringing an abducted straight leg in must not bow its knee.
        const pole = ahead.clone().addScaledVector(direction, -ahead.dot(direction));
        if (pole.lengthSq() < 1e-10) {
          pole.copy(kneeAt).sub(hipAt);
          pole.addScaledVector(direction, -pole.dot(direction));
        }
        pole.normalize();
        const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
        const bend = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
        const kneeGoal = hipAt.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
        turn(thigh, kneeAt.clone().sub(hipAt), kneeGoal.clone().sub(hipAt));
        const newKnee = position(shin);
        turn(shin, position(foot).sub(newKnee), goal.clone().sub(newKnee));
        foot.quaternion.copy(shin.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footQ));
      }
    }
  });
}

/**
 * `clip` (made for `target`) with the torso leaned: `spine` radians over the spine's three bones, and `head` more at the neck and head, positive
 * leaning forward, negative back. Fixes a library clip's posture to the one the game wants (a crouch with the chest up, a ready stance leaning
 * into the gun) without touching the legs.
 */
export function leanClip(clip: THREE.AnimationClip, target: THREE.Object3D, lean: { spine?: number; head?: number }): THREE.AnimationClip {
  const rig = bones(target);
  const chain: Array<[THREE.Object3D, number]> = [];
  for (const n of ['Spine', 'Spine1', 'Spine2']) {
    const b = rig.get(n);
    if (b && lean.spine) chain.push([b, lean.spine / 3]);
  }
  for (const n of ['Neck', 'Head']) {
    const b = rig.get(n);
    if (b && lean.head) chain.push([b, lean.head / 2]);
  }
  if (chain.length === 0) return clip;
  // The body's left, from the rest pose: turning about it by a positive angle tips the head forward.
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyFrame(target));
  return bakeRotations(clip, target, chain.map(([b]) => b), () => {
    for (const [bone, angle] of chain) {
      const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const world = new THREE.Quaternion().setFromAxisAngle(left, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(parent.invert().multiply(world));
      bone.updateMatrixWorld(true);
    }
  });
}

/**
 * The pose between two clips made for the same rig: `b` at `weight` of the way from `a` (0 is all of `a`), sampled over `a`'s length, `b` running `phase` seconds
 * ahead of `a` and stretched to `a`'s length. Two loops of the same gait blend into a gait between them (a walk and a crouched walk make a half-crouched one).
 */
export function blendClips(a: THREE.AnimationClip, b: THREE.AnimationClip, weight: number, name = a.name, phase = 0, fps = 30): THREE.AnimationClip {
  const count = frames(a, fps);
  const times = Float32Array.from({ length: count }, (_, f) => Math.min(a.duration, f / fps));
  const interpolant = (t: THREE.KeyframeTrack): THREE.Interpolant => (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
  const other = new Map(b.tracks.map((t) => [t.name, interpolant(t)]));
  const tracks = a.tracks.map((ta) => {
    const ib = other.get(ta.name);
    const ia = interpolant(ta);
    const size = ta.getValueSize();
    const values = new Float32Array(count * size);
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    for (let f = 0; f < count; f++) {
      const t = times[f]!;
      const va = ia.evaluate(t);
      if (!ib) {
        values.set(va, f * size);
        continue;
      }
      const tb = (((t + phase) * (b.duration / a.duration)) % b.duration + b.duration) % b.duration;
      const vb = ib.evaluate(tb);
      if (size === 4) {
        qa.fromArray(va as ArrayLike<number> as number[]);
        qb.fromArray(vb as ArrayLike<number> as number[]);
        qa.slerp(qb, weight).toArray(values, f * 4);
      } else {
        for (let k = 0; k < size; k++) values[f * size + k] = va[k]! + (vb[k]! - va[k]!) * weight;
      }
    }
    return size === 4 ? new THREE.QuaternionKeyframeTrack(ta.name, times, values) : new THREE.VectorKeyframeTrack(ta.name, times, values);
  });
  return new THREE.AnimationClip(name, a.duration, tracks);
}

/** Bake only the chosen rotations; the rest of the clip stays byte-for-byte
 * intact. Restore the rig after every sample and on exit for safe reuse. */
function bakeRotations(clip: THREE.AnimationClip, target: THREE.Object3D, modified: THREE.Object3D[], correct: () => void): THREE.AnimationClip {
  if (!clip.tracks.length) return clip;
  const times = clip.tracks[0]!.times;
  const rotations = new Map(modified.map((bone) => [bone, new Float32Array(times.length * 4)]));
  const saved = new Map([...bones(target).values()].map((bone) => [bone, { q: bone.quaternion.clone(), p: bone.position.clone() }]));
  const mixer = new THREE.AnimationMixer(target);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    for (let f = 0; f < times.length; f++) {
      mixer.setTime(times[f]!);
      target.updateMatrixWorld(true);
      // The mixer may skip stationary tracks: undo our edits between samples
      // so corrections cannot accumulate in its value cache.
      const authored = new Map(modified.map((bone) => [bone, bone.quaternion.clone()]));
      correct();
      for (const bone of modified) {
        bone.quaternion.toArray(rotations.get(bone)!, f * 4);
        bone.quaternion.copy(authored.get(bone)!);
      }
      target.updateMatrixWorld(true);
    }
  } finally {
    action.stop();
    mixer.uncacheRoot(target);
    for (const [bone, rest] of saved) {
      bone.quaternion.copy(rest.q);
      bone.position.copy(rest.p);
    }
    target.updateMatrixWorld(true);
  }
  const replacements = new Map(modified.map((bone) => [
    `${bone.name}.quaternion`, new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations.get(bone)!),
  ]));
  const tracks = clip.tracks.map((track) => replacements.get(track.name) ?? track);
  for (const [name, track] of replacements) {
    // A target neck (or leg joint) may have no matching source track. Its
    // correction still needs a track rather than disappearing on playback.
    if (!clip.tracks.some((original) => original.name === name)) tracks.push(track);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function frames(clip: THREE.AnimationClip, fps: number): number {
  return Math.max(2, Math.round(clip.duration * fps) + 1);
}
