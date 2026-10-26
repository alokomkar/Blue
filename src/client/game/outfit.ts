// The agent's outfit: a body (male or female, Quaternius's Universal Base Characters,
// CC0, sharing one skeleton, so every animation plays on either) dressed in a flat-coloured
// suit, with armour plates fitted to it — helmet and visor, chest and back
// plates, pauldrons, bracers, a belt with pouches, knee pads and shin guards.
//
// The armour is built from primitives and parented to the rig's bones, so it
// moves with every animation. Sizes and offsets come from the rig itself —
// bone positions for lengths, and rays cast at the skinned mesh for where the
// body's surface actually is — so the same pieces fit either body without
// per-model numbers.
//
// Colours are the point: suit, armour and trim are separate, so each can be
// picked (or unlocked) on its own.

import * as THREE from 'three';
import { markBloom } from './postfx';

export type Body = 'male' | 'female';

export type Outfit = {
  body: Body;
  /** A flat colour over the whole body, or null to keep the character's own clothes. */
  suit: number | null;
  /** The armour plates' colour, or null for no armour. */
  armour: number | null;
  /** The visor and the glowing edge strips. */
  trim: number;
  /** False to leave the head bare (no helmet, visor or chin guard). */
  helmet?: boolean;
};

export const BODY_MODELS: Record<Body, string> = {
  male: '/models/skins/ubc_male.glb',
  female: '/models/skins/ubc_female_refined.glb',
};

export const DEFAULT_OUTFIT: Outfit = { body: 'male', suit: null, armour: 0x5b636c, trim: 0x6fe0ff };

const bone = (model: THREE.Object3D, name: string): THREE.Object3D => {
  const b = model.getObjectByName(`mixamorig${name}`);
  if (!b) throw new Error(`rig has no ${name} bone`);
  return b;
};

const worldPos = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());

/** Recolours every surface of the body flat, dropping its texture (the suit under the armour; a guard's whole body). */
export function dressSuit(model: THREE.Object3D, suit: number): void {
  const base = new THREE.Color(suit);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      const visor = /visor/i.test(m.name);
      const joints = /joint/i.test(m.name);
      m.map = null;
      m.color.copy(base).multiplyScalar(joints ? 0.6 : 1);
      m.roughness = visor ? 0.2 : 0.82;
      m.metalness = visor ? 0.6 : 0.05;
      m.needsUpdate = true;
    }
  });
}

/**
 * Dresses a freshly loaded rig. Call it before the model is animated (in its
 * bind pose) and before it's rotated or scaled into the scene, since the fit
 * is measured from the pose it's in.
 */
export function dressAgent(model: THREE.Object3D, outfit: Outfit): void {
  if (outfit.suit !== null) dressSuit(model, outfit.suit);
  if (outfit.armour === null) return;
  model.updateMatrixWorld(true);

  const plate = new THREE.MeshStandardMaterial({ color: outfit.armour, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(outfit.armour).multiplyScalar(0.45), roughness: 0.6, metalness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: outfit.trim, emissiveIntensity: 1.8, roughness: 0.3 });
  // Most pieces are open shells (a slice of a cylinder or sphere), seen from either side.
  for (const m of [plate, dark, glow]) m.side = THREE.DoubleSide;

  const skinned: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skinned.push(o);
  });
  // Raycasting a skinned mesh reads its bone matrices, which are only filled in at the first render.
  for (const m of skinned) m.skeleton.update();

  const hips = worldPos(bone(model, 'Hips'));
  const top = worldPos(bone(model, 'HeadTop_End'));
  const toe = worldPos(bone(model, 'LeftToe_End'));
  const foot = worldPos(bone(model, 'LeftFoot'));
  const height = top.y - Math.min(toe.y, foot.y);
  const up = new THREE.Vector3(0, 1, 0);
  // Which way the body faces: from the heel toward the toes.
  const forward = toe.clone().sub(foot).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(up, forward).normalize(); // the body's left

  /** How far out from `at` the body's surface is, looking along `dir` (a ray cast back in from outside). */
  const ray = new THREE.Raycaster();
  const surface = (at: THREE.Vector3, dir: THREE.Vector3, fallback: number): number => {
    ray.set(at.clone().addScaledVector(dir, height), dir.clone().negate());
    ray.far = height;
    const hit = ray.intersectObjects(skinned, false)[0];
    return hit ? height - hit.distance : fallback;
  };

  /** Adds a piece built in world space (at `pos`, turned so its +Z faces `faceDir`), then hands it to `boneName`, keeping where it is. */
  const put = (boneName: string, mesh: THREE.Object3D, pos: THREE.Vector3, faceDir: THREE.Vector3, upDir = up): void => {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), faceDir.clone().negate(), upDir);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.copy(pos);
    // Built in world space, handed straight to the bone (attach keeps where it is, whatever the rig's scale).
    mesh.updateMatrixWorld(true);
    bone(model, boneName).attach(mesh);
  };
  /** Points a piece's +Y along `dir`. */
  const along = (mesh: THREE.Object3D, from: THREE.Vector3, dir: THREE.Vector3, at: number): THREE.Object3D => {
    mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
    mesh.position.copy(from).addScaledVector(dir, at);
    return mesh;
  };
  const hand = (boneName: string, mesh: THREE.Object3D): void => {
    mesh.updateMatrixWorld(true);
    bone(model, boneName).attach(mesh);
  };
  const glowing = (mesh: THREE.Mesh): THREE.Mesh => {
    markBloom(mesh);
    return mesh;
  };

  // ---- torso: chest and back plates, following the body's real depth ----
  const chestAt = worldPos(bone(model, 'Spine2'));
  const neck = worldPos(bone(model, 'Neck'));
  const spine1 = worldPos(bone(model, 'Spine1'));
  const shoulderSpan = worldPos(bone(model, 'LeftArm')).distanceTo(worldPos(bone(model, 'RightArm')));
  const chestFront = surface(chestAt, forward, height * 0.07);
  const chestBack = surface(chestAt, forward.clone().negate(), height * 0.07);
  const chestH = neck.y - spine1.y + height * 0.03;
  const chestW = shoulderSpan * 0.62;
  const chestMid = new THREE.Vector3(chestAt.x, (neck.y + spine1.y) / 2, chestAt.z);
  const plateGeo = (w: number, h: number): THREE.BufferGeometry => {
    // A shallow curved shell: a slice of a cylinder, wrapping round the torso.
    const r = w * 0.9;
    const arc = 2 * Math.asin(Math.min(0.99, w / 2 / r));
    const g = new THREE.CylinderGeometry(r, r * 0.92, h, 16, 1, true, -arc / 2, arc);
    g.translate(0, 0, -r); // the shell's front at z = 0
    return g;
  };
  const chest = new THREE.Mesh(plateGeo(chestW, chestH), plate);
  put('Spine2', chest, chestMid.clone().addScaledVector(forward, chestFront + height * 0.012), forward);
  const back = new THREE.Mesh(plateGeo(chestW * 0.95, chestH * 0.95), plate);
  put('Spine2', back, chestMid.clone().addScaledVector(forward, -(chestBack + height * 0.012)), forward.clone().negate());
  // A glowing strip across the chest plate, and one down the back.
  const stripe = glowing(new THREE.Mesh(new THREE.BoxGeometry(chestW * 0.5, height * 0.008, height * 0.006), glow));
  put('Spine2', stripe, chestMid.clone().addScaledVector(up, chestH * 0.22).addScaledVector(forward, chestFront + height * 0.02), forward);
  const spineLight = glowing(new THREE.Mesh(new THREE.BoxGeometry(height * 0.008, chestH * 0.6, height * 0.006), glow));
  put('Spine2', spineLight, chestMid.clone().addScaledVector(forward, -(chestBack + height * 0.02)), forward.clone().negate());

  // ---- belt with pouches, at the hips ----
  const beltAt = hips.clone().addScaledVector(up, height * 0.035);
  const hipFront = surface(beltAt, forward, height * 0.06);
  const hipSide = surface(beltAt, side, height * 0.09);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height * 0.035, 24, 1, true), dark);
  belt.scale.set(hipSide + height * 0.008, 1, hipFront + height * 0.008);
  // Scaled in the body's own frame: build it facing forward.
  put('Hips', belt, beltAt, forward);
  for (const s of [-1, 1]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(height * 0.05, height * 0.045, height * 0.028), dark);
    const at = beltAt
      .clone()
      .addScaledVector(side, s * hipSide * 0.72)
      .addScaledVector(forward, hipFront * 0.55)
      .addScaledVector(up, -height * 0.01);
    put('Hips', pouch, at, forward.clone().addScaledVector(side, s * 0.8).normalize());
  }

  // ---- helmet and visor ----
  const head = worldPos(bone(model, 'Head'));
  const headH = top.y - head.y;
  const headMid = head.clone().addScaledVector(up, headH * 0.5);
  if (outfit.helmet !== false) {
    const headR = (surface(headMid, forward, headH * 0.45) + surface(headMid, side, headH * 0.42)) / 2 + height * 0.01;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(headR, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), plate);
    put('Head', helmet, headMid.clone().addScaledVector(up, headH * 0.08), forward);
    const visor = glowing(
      new THREE.Mesh(new THREE.CylinderGeometry(headR * 1.02, headR * 1.02, headH * 0.16, 20, 1, true, -Math.PI * 0.36, Math.PI * 0.72), glow)
    );
    // Cylinder angle 0 points along +Z: the face.
    put('Head', visor, headMid.clone().addScaledVector(up, headH * 0.02), forward);
    const chin = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.95, headR * 0.8, headH * 0.22, 20, 1, true, -Math.PI * 0.42, Math.PI * 0.84), dark);
    put('Head', chin, headMid.clone().addScaledVector(up, -headH * 0.2), forward);
  }

  // ---- limbs: pauldrons, bracers, knee pads and shin guards, both sides ----
  for (const s of ['Left', 'Right'] as const) {
    const arm = worldPos(bone(model, `${s}Arm`));
    const fore = worldPos(bone(model, `${s}ForeArm`));
    const wrist = worldPos(bone(model, `${s}Hand`));
    const upperDir = fore.clone().sub(arm);
    // The arm's thickness, front to back (from above, the male rig's own shoulder pads get in the way).
    const armR = Math.min(surface(arm.clone().lerp(fore, 0.35), forward, height * 0.03), height * 0.04);
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(armR * 1.45, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), plate);
    // A cap over the shoulder, tipped out along the arm.
    const capAt = arm.clone().addScaledVector(upperDir, 0.12).addScaledVector(up, armR * 0.25);
    const capTurn = new THREE.Quaternion().setFromUnitVectors(up, up.clone().addScaledVector(upperDir.clone().normalize(), 0.45).normalize());
    pauldron.position.copy(capAt);
    pauldron.quaternion.copy(capTurn);
    hand(`${s}Arm`, pauldron);
    // A glowing ring round its rim (set up in world space too: the pauldron's own transform is bone-local now).
    const trimRing = glowing(new THREE.Mesh(new THREE.TorusGeometry(armR * 1.42, height * 0.0035, 6, 20), glow));
    trimRing.position.copy(capAt);
    trimRing.quaternion.copy(capTurn).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    hand(`${s}Arm`, trimRing);

    const foreDir = wrist.clone().sub(fore);
    const foreR = surface(fore.clone().lerp(wrist, 0.55), up, height * 0.025);
    const bracer = new THREE.Mesh(new THREE.CylinderGeometry(foreR * 1.25, foreR * 1.45, foreDir.length() * 0.5, 12), plate);
    hand(`${s}ForeArm`, along(bracer, fore, foreDir, 0.62));

    const hip = worldPos(bone(model, `${s}UpLeg`));
    const knee = worldPos(bone(model, `${s}Leg`));
    const ankle = worldPos(bone(model, `${s}Foot`));
    const shinDir = ankle.clone().sub(knee);
    const kneeFront = surface(knee, forward, height * 0.03);
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(kneeFront * 0.95, 12, 10, -Math.PI * 0.5, Math.PI, 0, Math.PI), plate);
    put(`${s}Leg`, kneePad, knee.clone().addScaledVector(forward, kneeFront * 0.35), forward);
    const shinR = surface(knee.clone().lerp(ankle, 0.45), forward, height * 0.028);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(shinR * 1.2, shinR * 1.05, shinDir.length() * 0.62, 14, 1, true, -Math.PI * 0.45, Math.PI * 0.9), plate);
    // A front half-shell (the cylinder's arc is centred on +Z), running up the shin.
    put(`${s}Leg`, shin, knee.clone().addScaledVector(shinDir, 0.5), forward, shinDir.clone().negate().normalize());
    // Thigh plate on the outside of each leg.
    const thighDir = knee.clone().sub(hip);
    const sideDir = side.clone().multiplyScalar(s === 'Left' ? 1 : -1);
    const thighOut = surface(hip.clone().lerp(knee, 0.4), sideDir, height * 0.04);
    const thigh = new THREE.Mesh(plateGeo(height * 0.07, thighDir.length() * 0.42), plate);
    put(`${s}UpLeg`, thigh, hip.clone().lerp(knee, 0.4).addScaledVector(sideDir, thighOut + height * 0.006), sideDir);
  }
}

/** Standing heights the bodies are scaled to, in metres: characters come from different sources at different scales. */
export const BODY_HEIGHT: Record<Body, number> = { male: 1.8, female: 1.72 };

/** Scales a freshly loaded rig to stand `height` tall (head top to toes, measured from its bones). */
export function standTall(model: THREE.Object3D, height: number): void {
  model.updateMatrixWorld(true);
  const top = worldPos(bone(model, 'HeadTop_End')).y;
  const toe = Math.min(worldPos(bone(model, 'LeftToe_End')).y, worldPos(bone(model, 'LeftFoot')).y);
  model.scale.multiplyScalar(height / (top - toe));
  model.updateMatrixWorld(true);
}

/**
 * Darkens a band round the hips of a body painted flat (dressSuit): trunks, so a flat-coloured body is not bare (the model's own
 * underwear is in the texture dressSuit drops). The band is cut by height in the bind pose, from the upper thighs to the
 * hips bone; call it after dressSuit, before the model is scaled or animated.
 */
export function paintTrunks(model: THREE.Object3D, shade = 0.2): void {
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => /hair|brow|eye/i.test(m.name))) return;
    const hips = o.skeleton.bones.findIndex((b) => b.name === 'mixamorigHips');
    const position = o.geometry.getAttribute('position');
    if (hips < 0 || !position) return;
    const p = new THREE.Vector3();
    const heights: number[] = [];
    let low = Infinity;
    let high = -Infinity;
    for (let v = 0; v < position.count; v++) {
      const y = p.fromBufferAttribute(position, v).applyMatrix4(o.bindMatrix).y;
      heights.push(y);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    const body = high - low;
    const hipsY = new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[hips]!.clone().invert()).y;
    const colours = new Float32Array(position.count * 3);
    for (let v = 0; v < position.count; v++) {
      const rel = (heights[v]! - hipsY) / body;
      // Inside the band [-0.15, +0.005] of the body's height from the hips bone, easing in and out over 0.015.
      const t = THREE.MathUtils.smoothstep(rel, -0.15 - 0.015, -0.15) * (1 - THREE.MathUtils.smoothstep(rel, 0.005, 0.005 + 0.015));
      colours.fill(1 + (shade - 1) * t, v * 3, v * 3 + 3);
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      m.vertexColors = true;
      m.needsUpdate = true;
    }
  });
}

/** How round a rig's helmet is, measured once per kind of body (`key`): every guard is the same body. */
const helmetRadius = new Map<string, number>();

/**
 * A guard's helmet and visor, fitted to the head bone of a freshly loaded rig (still in its bind pose, already scaled and turned
 * into place): a dome over the skull in `shell`, and a band across the eyes in `visor` (`glow` is its emissive colour, if it has
 * one). Far cheaper than the agent's full armour (dressAgent): two meshes a guard, which matters with dozens on a floor.
 */
export function fitHelmet(model: THREE.Object3D, key: string, shell: number, visor: number, glow: number | null = null): void {
  model.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0);
  const top = worldPos(bone(model, 'HeadTop_End'));
  const head = worldPos(bone(model, 'Head'));
  const toe = worldPos(bone(model, 'LeftToe_End'));
  const foot = worldPos(bone(model, 'LeftFoot'));
  const height = top.y - Math.min(toe.y, foot.y);
  const forward = toe.clone().sub(foot).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(up, forward).normalize();
  const headH = top.y - head.y;
  const headMid = head.clone().addScaledVector(up, headH * 0.5);
  let radius = helmetRadius.get(key);
  if (radius === undefined) {
    const skinned: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skinned.push(o);
    });
    for (const m of skinned) m.skeleton.update();
    const ray = new THREE.Raycaster();
    const surface = (dir: THREE.Vector3, fallback: number): number => {
      ray.set(headMid.clone().addScaledVector(dir, height), dir.clone().negate());
      ray.far = height;
      const hit = ray.intersectObjects(skinned, false)[0];
      return hit ? height - hit.distance : fallback;
    };
    radius = (surface(forward, headH * 0.45) + surface(side, headH * 0.42)) / 2 + height * 0.012;
    helmetRadius.set(key, radius);
  }
  const plate = new THREE.MeshStandardMaterial({ color: shell, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: visor, roughness: 0.2, metalness: 0.6, side: THREE.DoubleSide });
  if (glow !== null) {
    glass.emissive.setHex(glow);
    glass.emissiveIntensity = 1.4;
  }
  const faceDown = new THREE.Matrix4().lookAt(new THREE.Vector3(), forward.clone().negate(), up);
  const put = (mesh: THREE.Mesh, at: THREE.Vector3): void => {
    mesh.quaternion.setFromRotationMatrix(faceDown);
    mesh.position.copy(at);
    mesh.updateMatrixWorld(true);
    bone(model, 'Head').attach(mesh);
  };
  put(new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), plate), headMid.clone().addScaledVector(up, headH * 0.08));
  // Cylinder angle 0 points along +Z: the face.
  put(
    new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, headH * 0.16, 18, 1, true, -Math.PI * 0.36, Math.PI * 0.72), glass),
    headMid.clone().addScaledVector(up, headH * 0.02)
  );
}
