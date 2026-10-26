// What the agent wears. Every body in the game is one of Quaternius's Universal
// Base Characters (CC0, quaternius.com): the classic look in a grey
// bodysuit with a short crop or long hair, the operative look in a bodysuit and
// hair of the player's choosing. Those come in their underwear, rigged like
// Unreal's mannequin ("upperarm_l"), so the skeleton is renamed on load to the
// Mixamo-style names the rest of the game uses ("mixamorigRightHand" for the
// gun, the arms for IK, the chest for the lamp: only a naming convention, no
// Mixamo file is in the game) and given the end point it lacks (the top of the
// head, which the game measures height from). They rest in a T-pose, which is
// what retarget.ts needs.
//
// The suit is paint, not clothes: every vertex of the body is tinted except
// the head's, told apart by how much the head bone moves it. The hair is one
// of the kit's hairstyles (rigged to the same skeleton), bound onto the
// agent's own bones, or none.

import * as THREE from 'three';
import type { Hairstyle, Look, SuitColour } from '../../shared/api';
import { BODY_MODELS, type Body } from './outfit';

export type Skin = {
  url: string;
  /** Unreal-mannequin names, renamed on load (adoptMixamoNames). */
  mannequin: boolean;
  /** The bodysuit's colour, painted over all but the head (paintSuit); null to leave the model as it comes. */
  suit: number | null;
  /** Hairstyle pieces to put on (attachHair). */
  hair: string[];
  /** Under a hairstyle, the scalp's colour (paintSuit), so it doesn't show as a bald patch; null to leave it skin. */
  scalp: number | null;
  /** Flat-painted: the body's texture dropped for the suit's colour all over, and the head this skin tone (paintSuit); null to tint the texture. */
  skinTone: number | null;
  /** The colour of armour plates to fit over the suit (outfit.ts's dressAgent, bare head); null for none. */
  armour: number | null;
};

/** The operative's dress: the suit's colour and the hair. */
export type Style = { suit: SuitColour; hair: Hairstyle };
export const DEFAULT_STYLE: Style = { suit: 'black', hair: 'bald' };

/** The suit colours, all dark: it's a stealth game. */
export const SUIT_SHADES: Record<SuitColour, { label: string; colour: number }> = {
  black: { label: 'Black', colour: 0x0c0e11 },
  charcoal: { label: 'Charcoal', colour: 0x2a2d33 },
  midnight: { label: 'Midnight', colour: 0x111a33 },
  olive: { label: 'Olive', colour: 0x222a17 },
  oxblood: { label: 'Oxblood', colour: 0x2e1215 },
  plum: { label: 'Plum', colour: 0x241631 },
};

const HAIR_DIR = '/models/skins/';
const HAIR_COLOUR = 0x3a281c;
// The scalp under a hairstyle (paintSuit), in metres from the head bone (at the jaw): the forehead's hairline
// this high up, the back of the skull this far behind the head's middle, the nape this high; each edge fades
// over SCALP_FADE either side, so there's no line.
const SCALP_HAIRLINE = 0.155;
const SCALP_BEHIND = 0.02;
const SCALP_NAPE = 0.05;
const SCALP_FADE = 0.015;
/** The hairstyles, as the pieces each needs on each body (the buzz cut comes in a man's and a woman's). */
export const HAIRSTYLE_PIECES: Record<Hairstyle, { label: string; pieces: Record<Body, string[]> }> = {
  bald: { label: 'Bald', pieces: { male: [], female: [] } },
  buzzed: { label: 'Buzzed', pieces: { male: ['hair_buzzed'], female: ['hair_buzzed_f'] } },
  parted: { label: 'Parted', pieces: { male: ['hair_parted'], female: ['hair_parted'] } },
  long: { label: 'Long', pieces: { male: ['hair_long'], female: ['hair_long'] } },
  buns: { label: 'Buns', pieces: { male: ['hair_buns'], female: ['hair_buns'] } },
};

/** The classic look: a steel-grey bodysuit painted flat over the whole body (the operative's paint tints the skin texture, so only dark shades read as a suit there), a buzz cut and long hair. */
const CLASSIC: { suit: number; skin: number; armour: number; hair: Record<Body, string[]> } = { suit: 0x33404c, skin: 0xb98562, armour: 0x6b7480, hair: { male: ['hair_buzzed'], female: ['hair_long'] } };

/** The model, suit and hair for `body` in `look` (the operative in `style`). */
export function skinFor(body: Body, look: Look, style: Style = DEFAULT_STYLE): Skin {
  const hair = (look === 'classic' ? CLASSIC.hair[body] : HAIRSTYLE_PIECES[style.hair].pieces[body]).map((p) => `${HAIR_DIR}${p}.glb`);
  if (look === 'classic') return { url: BODY_MODELS[body], mannequin: true, suit: CLASSIC.suit, hair, scalp: HAIR_COLOUR, skinTone: CLASSIC.skin, armour: CLASSIC.armour };
  return {
    url: BODY_MODELS[body],
    mannequin: true,
    suit: SUIT_SHADES[style.suit].colour,
    hair,
    scalp: hair.length > 0 ? HAIR_COLOUR : null,
    skinTone: null,
    armour: null,
  };
}

/** Unreal-mannequin bone names to Mixamo's, per side (`_l` / `_r`). */
const SIDED: Record<string, string> = {
  clavicle: 'Shoulder',
  upperarm: 'Arm',
  lowerarm: 'ForeArm',
  hand: 'Hand',
  thigh: 'UpLeg',
  calf: 'Leg',
  foot: 'Foot',
  ball: 'ToeBase',
  ball_leaf: 'Toe_End',
  ...Object.fromEntries(
    ['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((f) =>
      [1, 2, 3, 4].map((k) => [`${f}_0${k}${k === 4 ? '_leaf' : ''}`, `Hand${f[0]!.toUpperCase()}${f.slice(1)}${k}`])
    )
  ),
};
const CENTRE: Record<string, string> = { pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head' };

/** Mixamo's name for an Unreal-mannequin bone ("upperarm_l" is "mixamorigLeftArm"), or null for one it has no match for. */
export function mixamoName(name: string): string | null {
  if (CENTRE[name]) return `mixamorig${CENTRE[name]}`;
  const sided = /^(.+)_([lr])$/.exec(name);
  const m = sided && SIDED[sided[1]!];
  return m ? `mixamorig${sided[2] === 'l' ? 'Left' : 'Right'}${m}` : null;
}

/**
 * Readies a Universal Base Character for the game: its bones renamed to
 * Mixamo's, and the top of its head added as an end point. Call it on the
 * freshly loaded scene, in its rest pose.
 */
export function adoptMixamoNames(model: THREE.Object3D): void {
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const m = mixamoName(o.name);
    if (m) o.name = m;
  });
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('mixamorigHead');
  if (!head) return;
  const top = head.getWorldPosition(new THREE.Vector3());
  top.y = new THREE.Box3().setFromObject(model).max.y;
  const end = new THREE.Object3D();
  end.name = 'mixamorigHeadTop_End';
  head.add(end);
  end.position.copy(head.worldToLocal(top));
  end.updateMatrixWorld(true);
}

/**
 * Paints the body in a bodysuit of colour `suit`: every vertex the head bone
 * doesn't carry goes that colour, fading back to the skin over the neck, so
 * the face and head keep their own. With a `scalp` colour (under a
 * hairstyle), the top and back of the head go that colour too, so no bald
 * patch shows between the strands; the face stays skin. Hair, eyes and brows
 * are left alone. With a `skinTone` the whole body is flat (its texture dropped): the suit's colour from the neck down, the head's this tone.
 * Works on the renamed skeleton (adoptMixamoNames first).
 */
export function paintSuit(model: THREE.Object3D, suit: number, scalp: number | null = null, skinTone: number | null = null): void {
  const tint = new THREE.Color(suit);
  const under = new THREE.Color(scalp ?? 0xffffff);
  // What the head keeps: the texture as it is, or, flat, one skin colour.
  const bare = new THREE.Color(skinTone ?? 0xffffff);
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => /hair|brow|eye/i.test(m.name))) return;
    const bones = o.skeleton.bones;
    const head = bones.findIndex((b) => b.name === 'mixamorigHead');
    const geo = o.geometry;
    const index = geo.getAttribute('skinIndex');
    const weight = geo.getAttribute('skinWeight');
    const position = geo.getAttribute('position');
    if (head < 0 || !index || !weight) return;
    // The bind pose, in the space the vertices are skinned in: where the head is, which way is up and which is ahead.
    const bindAt = (name: string): THREE.Vector3 | null => {
      const i = bones.findIndex((b) => b.name === `mixamorig${name}`);
      return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i]!.clone().invert());
    };
    const headAt = bindAt('Head');
    const hips = bindAt('Hips');
    const foot = bindAt('LeftFoot');
    const toe = bindAt('LeftToe_End');
    const shaved = scalp !== null && headAt && hips && foot && toe;
    const up = shaved ? headAt.clone().sub(hips).normalize() : new THREE.Vector3(0, 1, 0);
    const ahead = shaved ? toe.clone().sub(foot) : new THREE.Vector3(0, 0, 1);
    ahead.addScaledVector(up, -ahead.dot(up)).normalize();
    const p = new THREE.Vector3();
    // How far back the skull goes and forward the face comes, to find the head's middle (front to back).
    let back = Infinity;
    let front = -Infinity;
    const heads: number[] = [];
    for (let v = 0; v < index.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (index.getComponent(v, k) === head) w += weight.getComponent(v, k);
      heads.push(w);
      if (!shaved || w < 0.5) continue;
      const f = p.fromBufferAttribute(position, v).applyMatrix4(o.bindMatrix).sub(headAt).dot(ahead);
      back = Math.min(back, f);
      front = Math.max(front, f);
    }
    const middle = (back + front) / 2;
    const colours = new Float32Array(index.count * 3);
    for (let v = 0; v < index.count; v++) {
      // Mostly the head's: skin. Barely: suit. The neck between blends.
      const skin = THREE.MathUtils.smoothstep(heads[v]!, 0.35, 0.8);
      // Under a hairstyle, the scalp goes dark (the hair's own colour), so no skin shows through between strands:
      // above the forehead's hairline, and the back of the skull above the nape. The face keeps its skin.
      let hidden = 0;
      if (shaved && skin > 0) {
        const rel = p.fromBufferAttribute(position, v).applyMatrix4(o.bindMatrix).sub(headAt);
        const height = rel.dot(up);
        const forward = rel.dot(ahead) - middle;
        const crown = THREE.MathUtils.smoothstep(height, SCALP_HAIRLINE - SCALP_FADE, SCALP_HAIRLINE + SCALP_FADE);
        const nape = THREE.MathUtils.smoothstep(-forward, SCALP_BEHIND - SCALP_FADE, SCALP_BEHIND + SCALP_FADE) * THREE.MathUtils.smoothstep(height, 0, SCALP_NAPE);
        hidden = Math.max(crown, nape);
      }
      const r = bare.r + (under.r - bare.r) * hidden;
      const g = bare.g + (under.g - bare.g) * hidden;
      const b = bare.b + (under.b - bare.b) * hidden;
      colours[v * 3] = tint.r + (r - tint.r) * skin;
      colours[v * 3 + 1] = tint.g + (g - tint.g) * skin;
      colours[v * 3 + 2] = tint.b + (b - tint.b) * skin;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      m.vertexColors = true;
      if (skinTone !== null) m.map = null;
      m.needsUpdate = true;
    }
  });
}

/**
 * Puts a hairstyle piece (loaded from its own file, skinned to the same kind
 * of skeleton) on `model`: its meshes move over to the model and are bound to
 * the model's own bones, found by name, keeping the piece's bind pose, so it
 * sits on this head and follows it. Works on the renamed skeleton
 * (adoptMixamoNames first).
 */
export function attachHair(model: THREE.Object3D, piece: THREE.Object3D): void {
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  piece.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  piece.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    const mine = mesh.skeleton.bones.map((b) => bones.get(mixamoName(b.name) ?? b.name));
    if (mine.some((b) => !b)) continue;
    const world = mesh.matrixWorld.clone();
    mesh.removeFromParent();
    model.add(mesh);
    world.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.bind(new THREE.Skeleton(mine as THREE.Bone[], mesh.skeleton.boneInverses), mesh.bindMatrix);
    mesh.frustumCulled = false; // its bounds are from the pose it came in
    // The kit's hair textures are neutral grey, meant to be tinted: a dark brown.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m instanceof THREE.MeshStandardMaterial) m.color.setHex(HAIR_COLOUR);
    }
  }
}
