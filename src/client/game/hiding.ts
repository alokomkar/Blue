// Hiding spots — crates scattered through the maze the player can duck near
// to break a patrol bot's detection outright (bots.ts's `playerHidden`
// param), regardless of line of sight or distance. Ported in spirit from
// blueprint/src/index.html's placeHidingSpots() (placement only — the 2D
// game's hiding mechanic was tied to its own bot-pathing/pinpoint system,
// which works differently here now that movement is continuous; see the
// plan's Phase 4 notes on that).

import * as THREE from 'three';
import { CELL, type WallBox } from './scene';
import { markBloom } from './postfx';
import type { HideSkin } from './hideouts';

const HIDE_RADIUS = 1.4; // how close the player needs to be to count as concealed
const CRATE_COLOR = 0x4a4030;
const STRIPE_COLOR = 0xe0bd6c; // matches the game's existing amber accent, doubles as a "cover" cue
const CRATE_L = 1.9; // one long crate, along X: as long as the pair is wide, so a body lies along the bay between them
const CRATE_D = 0.6; // and across it (Z)
const SLIDE = 0.4; // how far each crate slides out when the pair opens: the bay between is 0.8 m wide, room for a lying body

/** Two long crates side by side. Opened, they slide apart (toward ±Z) over a bay a body lies in, then slide back. */
export type CratePairRig = {
  group: THREE.Group;
  /** 0 shut, 1 slid apart. */
  setOpen: (amount: number) => void;
  /** Floor-local centre of the bay between them. */
  center: { x: number; z: number };
};

export function buildHidingSpotMesh(x: number, y: number, skin?: HideSkin['crates']): CratePairRig {
  const group = new THREE.Group();
  group.position.set(x * CELL, 0, y * CELL);

  const stripeColor = skin?.stripe ?? STRIPE_COLOR;
  const stripeMat = new THREE.MeshStandardMaterial({ color: stripeColor, emissive: stripeColor, emissiveIntensity: skin ? 0.12 : 0.35, roughness: 0.6 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });
  const halves = [-1, 1].map((side) => {
    const half = new THREE.Group();
    half.position.z = (side * CRATE_D) / 2;
    const crateMat = new THREE.MeshStandardMaterial({ color: side < 0 ? (skin?.body ?? CRATE_COLOR) : (skin?.body2 ?? skin?.body ?? CRATE_COLOR), roughness: skin?.ribs ? 0.6 : 0.85, metalness: skin?.ribs ? 0.3 : 0 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(CRATE_L, 0.85, CRATE_D - 0.02), crateMat);
    crate.position.y = 0.425;
    half.add(crate);
    if (skin?.ribs) {
      // Corrugated sides, like a shipping container or a steel skid.
      for (let r = 0; r < 9; r++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.74, CRATE_D), ribMat);
        rib.position.set(-CRATE_L / 2 + 0.2 + r * 0.2, 0.425, 0);
        half.add(rib);
      }
    }
    if (skin?.corners) {
      // The corner pieces stand proud of the case on every side (and of the stripe), by a couple of centimetres: flush with its end and top, their faces and the case's lay in the
      // same plane and the two fought over each pixel, flickering gold and cream along the edges as the camera moved.
      const capMat = new THREE.MeshStandardMaterial({ color: skin.corners, roughness: 0.3, metalness: 0.8 });
      for (const cx of [-1, 1]) for (const cy of [0.06, 0.79]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, CRATE_D + 0.06), capMat);
        cap.position.set(cx * (CRATE_L / 2 - 0.05), cy + (cy > 0.4 ? 0.01 : -0.01), 0);
        half.add(cap);
      }
    }
    // (Proud of the case and of the ribs by a couple of centimetres, so none of their faces share a plane.)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CRATE_L + 0.04, 0.08, CRATE_D + 0.04), stripeMat);
    stripe.position.y = 0.72;
    markBloom(stripe);
    half.add(stripe);
    group.add(half);
    return half;
  });

  return {
    group,
    center: { x: x * CELL, z: y * CELL },
    setOpen(amount: number) {
      halves[0]!.position.z = -CRATE_D / 2 - amount * SLIDE;
      halves[1]!.position.z = CRATE_D / 2 + amount * SLIDE;
    },
  };
}

/** The pair's real AABB footprint — pushed into the shared wallBoxes list so the player (and,
 *  via the same list, bot line-of-sight) can't pass straight through it. The whole pair, open or shut. */
export function hidingSpotWallBox(spot: { x: number; y: number }): WallBox {
  const wx = spot.x * CELL;
  const wz = spot.y * CELL;
  return { minX: wx - CRATE_L / 2, maxX: wx + CRATE_L / 2, minZ: wz - CRATE_D, maxZ: wz + CRATE_D, cover: 'low' };
}

/** True if the player's current position counts as concealed by any hiding spot. */
export function isPlayerHidden(spots: Array<{ x: number; y: number }>, playerWorldX: number, playerWorldZ: number): boolean {
  for (const spot of spots) {
    if (Math.hypot(spot.x * CELL - playerWorldX, spot.y * CELL - playerWorldZ) <= HIDE_RADIUS) return true;
  }
  return false;
}
