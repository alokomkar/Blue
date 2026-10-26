// The player's stun gun: an arc pistol modelled from primitives (not an asset
// pulled from any external repo — github.com/chasergit/gear, which was
// checked for this, ships its models with no license file at all, meaning
// "all rights reserved" by default, so its assets aren't something we can
// legally reuse here) built from primitive geometry, the same approach
// already used for the ambush-bot's assembly-effect parts. See
// buildWeaponMesh() for the design.
//
// Also owns the tracer beam fired when the player shoots — a thin glowing
// cylinder, not a THREE.Line (WebGL caps line width at ~1px in most
// browsers regardless of the `linewidth` material property, so a real mesh
// is what actually reads as a visible "3D line" on screen).
//
// The gun exposes a `support` point (under the barrel) that player.ts's IK
// step (see ik.ts) aims the off-hand at each frame, so the character
// visibly holds the weapon with both hands rather than just having it
// stuck to one fist.
//
// equipEnemyWeapon() below builds the same shape with a different color
// scheme (dark body, warning-orange accent vs. the player's cyan) so a bot
// reads as visually distinct at a glance — a palette variant, not a new
// model. A from-scratch mesh has no licensing question to begin with. Explored using the Quake 2 MD2 demo's
// bundled weapon set for this instead, but those are unlicensed fan assets
// tied to id Software's Quake 2 IP (checked the model's own readme — no
// open license, "additional credits to id software"), so not something
// safe to bundle into a published game.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { giveLight, takeLight } from './pulselights';

const GUN_COLOR = 0x1d2227; // polymer frame
const SLIDE_COLOR = 0x8a939d; // brushed metal slide
const ACCENT_COLOR = 0x6fe0ff;
const ENEMY_GUN_COLOR = 0x2a1515;
const ENEMY_SLIDE_COLOR = 0x6b4a44;
const ENEMY_ACCENT_COLOR = 0xff5a3d;
// GLTFLoader strips the ':' out of "mixamorig:RightHand" when it builds
// each node's .name (the same sanitizing behavior confirmed for animation
// track paths in player.ts's loadSneakClip) — confirmed directly by
// dumping the loaded model's bone names, not guessed.
const HAND_BONE_NAME = 'mixamorigRightHand';
const EMP_PIPS = 3;
/** How much bigger than a real pistol the player's gun is drawn, so it reads from the game's camera. */
const GUN_SCALE = 1.35;
const GRIP_CENTRE = { y: -0.115, z: 0.05 }; // the middle of the grip in the gun's own frame (forward is -Z): below the slide, a little behind its origin
const GRIP_HOLLOW = 0.025; // how far the grip sits below the palm's surface, where the curled fingers close
const PALM = 0.55; // where the grip sits, from the wrist toward the middle knuckle

export type StunGun = {
  group: THREE.Group;
  tip: THREE.Object3D;
  support: THREE.Object3D;
  /** Shows the recharge on the gun itself: the cells glow brighter as it fills, and the arc lights once it's ready. */
  setCharge: (fraction: number, time: number) => void;
  /** Lights one pip on the back of the slide per EMP charge in hand. */
  setEmpCharges: (count: number) => void;
};

/** A flat side profile, (forward, up) in metres, extruded `width` wide and turned to point down -Z like the gun. */
function profile(points: Array<[number, number]>, width: number, holes: Array<Array<[number, number]>> = []): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const bevel = 0.0025;
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateY(Math.PI / 2); // profile forward (+x) → -Z, extrusion → +X
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}

/**
 * An arc pistol, built from primitives (a from-scratch mesh has no licensing
 * question). Origin at the top of the grip, where the hand closes on it;
 * the barrel points down -Z. A polymer frame and grip, a metal slide, a
 * muzzle shroud with two electrode prongs and the arc between them, energy
 * cells in either side that show the recharge, and EMP pips on the back.
 */
function buildWeaponMesh(frameColor: number, slideColor: number, accentColor: number): StunGun {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.72, metalness: 0.1 });
  const slideMat = new THREE.MeshStandardMaterial({ color: slideColor, roughness: 0.38, metalness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.5, metalness: 0.6 });
  const glowMat = (intensity: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x0b0d10, emissive: accentColor, emissiveIntensity: intensity, roughness: 0.3 });

  // Frame and grip in one profile, with the trigger guard cut through.
  const frame = new THREE.Mesh(
    profile(
      [
        [-0.07, -0.004],
        [0.134, -0.004],
        [0.14, -0.022],
        [0.058, -0.026],
        [0.052, -0.058],
        [0.006, -0.062],
        [0.0, -0.04],
        [-0.026, -0.124],
        [-0.07, -0.13],
        [-0.074, -0.1],
        [-0.058, -0.03],
        [-0.082, -0.01],
      ],
      0.03,
      [
        [
          [0.044, -0.03],
          [0.04, -0.052],
          [0.013, -0.055],
          [0.01, -0.034],
        ],
      ]
    ),
    frameMat
  );
  group.add(frame);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.006), darkMat);
  trigger.position.set(0, -0.042, -0.024);
  trigger.rotation.x = -0.3;
  group.add(trigger);
  // Ridged grip panels on either side, raked back with the grip.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.034), darkMat);
      const y = -0.05 - i * 0.015;
      ridge.position.set(side * 0.0158, y, 0.036 + (y + 0.05) * -0.33);
      ridge.rotation.x = 0.32;
      group.add(ridge);
    }
  }

  // The slide, chamfered at the nose, with a glowing line down each side.
  const slide = new THREE.Mesh(
    profile(
      [
        [-0.074, -0.004],
        [0.152, -0.004],
        [0.166, 0.01],
        [0.158, 0.029],
        [-0.062, 0.029],
        [-0.076, 0.016],
      ],
      0.026
    ),
    slideMat
  );
  group.add(slide);
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.004, 0.13), glowMat(1.3));
    line.position.set(side * 0.0135, 0.019, -0.05);
    markBloom(line);
    group.add(line);
    // Grip serrations at the back of the slide.
    for (let i = 0; i < 4; i++) {
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.022, 0.0025), darkMat);
      cut.position.set(side * 0.0132, 0.012, 0.045 + i * 0.007);
      group.add(cut);
    }
  }
  // Sights: a front blade and a notched rear block (the EMP pips sit in its back face).
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.008), darkMat);
  front.position.set(0, 0.032, -0.15);
  group.add(front);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.007, 0.01), darkMat);
  rear.position.set(0, 0.032, 0.072);
  group.add(rear);

  // Muzzle shroud and the two electrode prongs.
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.026, 14), darkMat);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.012, -0.176);
  group.add(shroud);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0018, 6, 20), glowMat(1.5));
  ring.position.set(0, 0.012, -0.1895);
  markBloom(ring);
  group.add(ring);
  for (const side of [-1, 1]) {
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.022, 6), slideMat);
    prong.rotation.x = Math.PI / 2;
    prong.position.set(side * 0.009, 0.012, -0.194);
    group.add(prong);
  }
  const arcMat = glowMat(2.4);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 4, 12, Math.PI), arcMat);
  arc.position.set(0, 0.012, -0.204);
  markBloom(arc);
  group.add(arc);

  // Energy cells, one in each side of the frame above the trigger.
  const cellMat = glowMat(1.6);
  for (const side of [-1, 1]) {
    const cell = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.04, 4, 8), cellMat);
    cell.rotation.x = Math.PI / 2;
    cell.position.set(side * 0.0155, -0.016, -0.075);
    markBloom(cell);
    group.add(cell);
  }

  // EMP pips across the back of the slide.
  const pipMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < EMP_PIPS; i++) {
    const mat = glowMat(1.8);
    const pip = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.0045, 0.002), mat);
    pip.position.set((i - (EMP_PIPS - 1) / 2) * 0.006, 0.032, 0.0775);
    markBloom(pip);
    group.add(pip);
    pipMats.push(mat);
  }

  const tip = new THREE.Object3D();
  tip.position.set(0, 0.012, -0.22);
  group.add(tip);

  // Where the off (support) hand's IK target aims for — under the front of
  // the frame, ahead of the grip, where a two-handed hold cups it.
  const support = new THREE.Object3D();
  support.position.set(0, -0.02, -0.1);
  group.add(support);

  return {
    group,
    tip,
    support,
    setCharge(fraction, time) {
      const ready = fraction >= 1;
      cellMat.emissiveIntensity = 0.2 + 1.4 * fraction + (ready ? 0.25 * Math.sin(time * 4) : 0);
      arc.visible = ready;
      arcMat.emissiveIntensity = 1.8 + 1.2 * Math.abs(Math.sin(time * 23));
    },
    setEmpCharges(count) {
      pipMats.forEach((m, i) => (m.emissiveIntensity = i < count ? 1.8 : 0.05));
    },
  };
}

/**
 * Attaches a weapon to a loaded character's right-hand bone, so it follows
 * the hand through idle/walk animation automatically (any object parented
 * under an animated THREE.Bone moves with it — the mixer updates bone
 * transforms, Three.js propagates them to children each frame). Mixamo
 * bones can carry their own accumulated scale from the rig itself, unrelated
 * to the visible model's overall size, so the weapon's scale is compensated
 * against the hand's actual world scale rather than assumed to be 1.
 */
function attachWeapon(characterRoot: THREE.Object3D, frameColor: number, slideColor: number, accentColor: number): StunGun | null {
  const hand = characterRoot.getObjectByName(HAND_BONE_NAME);
  if (!hand) return null;
  const gun = buildWeaponMesh(frameColor, slideColor, accentColor);
  const handWorldScale = new THREE.Vector3();
  hand.getWorldScale(handWorldScale);
  gun.group.scale.set(1 / handWorldScale.x, 1 / handWorldScale.y, 1 / handWorldScale.z);
  // Verified via a temporary 4x-scale render that attachment/parenting is
  // correct (the gun sits right at the hand and follows it through
  // animation) — this small an offset is a reasonable "gripped in the
  // fist" placement without floating away from the hand.
  gun.group.position.set(0, -0.01, 0.02);
  gun.group.rotation.set(0, Math.PI, 0);
  hand.add(gun.group);
  return gun;
}

export function equipStunGun(characterRoot: THREE.Object3D): StunGun | null {
  return attachWeapon(characterRoot, GUN_COLOR, SLIDE_COLOR, ACCENT_COLOR);
}

/**
 * Puts the stun gun in `character`'s right fist, fitted to that hand's own
 * bones rather than a fixed offset (characters from different sources give
 * the hand bone different axes): the barrel runs along the hand, wrist to
 * knuckles, like a pistol held out at arm's length; the grip runs down
 * through the fist from the index-finger side to the little-finger side;
 * and the slide sits on top, at the index knuckle. Call it in the rest
 * pose, before any animation plays.
 */
export function equipStunGunInFist(character: THREE.Object3D): StunGun | null {
  return equipWeaponInFist(character, GUN_COLOR, SLIDE_COLOR, ACCENT_COLOR);
}

function equipWeaponInFist(character: THREE.Object3D, frameColor: number, slideColor: number, accentColor: number): StunGun | null {
  const at = (name: string): THREE.Vector3 | null => character.getObjectByName(`mixamorigRightHand${name}`)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const hand = character.getObjectByName(HAND_BONE_NAME);
  const wrist = at('');
  const middle = at('Middle1');
  const index = at('Index1');
  const pinky = at('Pinky1');
  if (!hand || !wrist || !middle || !index || !pinky) return attachWeapon(character, frameColor, slideColor, accentColor);
  character.updateMatrixWorld(true);

  const forward = middle.clone().sub(wrist).normalize(); // the barrel's way
  const up = index.clone().sub(pinky); // from the little finger to the index finger
  up.addScaledVector(forward, -up.dot(forward)).normalize();
  const right = new THREE.Vector3().crossVectors(up, forward.clone().negate()).normalize();
  // The gun's own axes: +X right, +Y up, -Z out of the barrel.
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward.clone().negate()));

  const gun = buildWeaponMesh(frameColor, slideColor, accentColor);
  gun.group.quaternion.copy(turn);
  // A touch bigger than life: at the size of a real pistol it all but disappears in the model's hand from the game's high camera.
  gun.group.scale.setScalar(GUN_SCALE);
  // The middle of the grip goes where the fingers close: in the hollow of the palm (the rest pose's palm faces down), with the rest of the gun laid out from there.
  const hollow = wrist.clone().lerp(middle, PALM).addScaledVector(new THREE.Vector3(0, -1, 0), GRIP_HOLLOW);
  gun.group.position.copy(hollow).addScaledVector(forward, GRIP_CENTRE.z * GUN_SCALE).addScaledVector(up, -GRIP_CENTRE.y * GUN_SCALE);
  gun.group.updateMatrixWorld(true);
  hand.attach(gun.group);
  return gun;
}

/** Same shape, palette-swapped (dark body, warning-orange accent) so a bot's weapon reads as distinct from the player's at a glance. */
export function equipEnemyWeapon(characterRoot: THREE.Object3D): StunGun | null {
  return equipWeaponInFist(characterRoot, ENEMY_GUN_COLOR, ENEMY_SLIDE_COLOR, ENEMY_ACCENT_COLOR);
}

/** A second pistol for the other hand (the exit levels' two-gun loadout): the same gun, at the same size, not in any hand: player.ts hangs it by the agent's side and holds it with the left arm. */
export function buildOffhandGun(): StunGun {
  const gun = buildWeaponMesh(GUN_COLOR, SLIDE_COLOR, ACCENT_COLOR);
  gun.group.scale.setScalar(GUN_SCALE);
  return gun;
}

export type Tracer = { update: (dt: number) => boolean };

const TRACER_DURATION_S = 0.16;
const TRACER_RADIUS = 0.02;

/** A brief glowing beam from `from` to `to` — the visible "shot fired" cue. `color` defaults to the player's own weapon accent; pass ENEMY_TRACER_COLOR (below) for a bot's shot, so which direction a shot came from is legible at a glance. */
export const ENEMY_TRACER_COLOR = ENEMY_ACCENT_COLOR;

export function spawnTracer(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, color: number = ACCENT_COLOR): Tracer {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(0.01, delta.length());
  const geo = new THREE.CylinderGeometry(TRACER_RADIUS, TRACER_RADIUS, length, 6, 1, true);
  geo.translate(0, length / 2, 0); // local origin at the base, so positioning at `from` is direct
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  markBloom(mesh);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  scene.add(mesh);

  let t = 0;
  return {
    update(dt: number): boolean {
      t += dt;
      if (t >= TRACER_DURATION_S) {
        scene.remove(mesh);
        geo.dispose();
        mat.dispose();
        return false;
      }
      mat.opacity = 0.95 * (1 - t / TRACER_DURATION_S);
      return true;
    },
  };
}

export const EMP_COLOR = 0x6fe0ff;
const EMP_FLIGHT_S = 0.16;
const EMP_BURST_S = 0.55;

/**
 * The EMP: a bright orb that flies to `to`, then bursts into a shock ring
 * spreading across the floor out to `radius`, with a cyan flash. `floorY`
 * is the floor height at the impact point, where the ring spreads.
 */
export function spawnEmpPulse(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, radius: number, floorY: number): Tracer {
  const orbMat = new THREE.MeshBasicMaterial({ color: EMP_COLOR });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), orbMat);
  markBloom(orb);
  orb.position.copy(from);
  scene.add(orb);
  const ringMat = new THREE.MeshBasicMaterial({ color: EMP_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), ringMat);
  markBloom(ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(to.x, floorY + 0.06, to.z);
  ring.visible = false;
  scene.add(ring);
  const light = takeLight(scene, EMP_COLOR, radius * 3);
  light.position.copy(to);

  let t = 0;
  return {
    update(dt: number): boolean {
      t += dt;
      if (t < EMP_FLIGHT_S) {
        orb.position.lerpVectors(from, to, t / EMP_FLIGHT_S);
        return true;
      }
      const b = (t - EMP_FLIGHT_S) / EMP_BURST_S;
      if (b >= 1) {
        for (const o of [orb, ring]) scene.remove(o);
        giveLight(scene, light);
        orb.geometry.dispose();
        orbMat.dispose();
        ring.geometry.dispose();
        ringMat.dispose();
        return false;
      }
      orb.position.copy(to);
      orb.scale.setScalar(1 + b * 3);
      orbMat.color.setHex(EMP_COLOR).multiplyScalar(1 - b);
      ring.visible = true;
      ring.scale.setScalar(0.2 + (radius - 0.2) * (1 - Math.pow(1 - b, 3)));
      ringMat.opacity = 0.9 * (1 - b);
      light.intensity = 60 * (1 - b);
      return true;
    },
  };
}
