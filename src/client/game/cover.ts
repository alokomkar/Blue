// Taking cover: pressing up against a piece of furniture. The player snaps
// to the face of the nearest desk, crate, rack or locker they're standing
// by, facing it — looking over it at whatever is on the far side. While in
// cover they crouch, slide along the face, and can lean a little past
// either end to peek. Low cover only hides them crouched, which they always
// are in cover (detection.ts). Pure geometry, tested under Node.

import type { WallBox } from './scene';

export const COVER_REACH = 0.9; // how close to a face you have to be to take cover on it
export const COVER_STANDOFF = 0.36; // how far from the face the player stands (their radius plus a hair)
export const COVER_PEEK = 0.45; // how far past either end of the face they can lean out

/** Where to stand behind a piece of furniture: a line parallel to one face, and that face's outward normal. */
export type CoverSpot = {
  box: WallBox;
  /** Outward normal of the face — pointing from the furniture toward the player. */
  nx: number;
  nz: number;
  /** The standing line, from end A to end B. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The point on the line nearest the player right now. */
  px: number;
  pz: number;
  /** The player's distance from the face. */
  dist: number;
  /** How far past either end of the line the agent may lean (COVER_PEEK if absent). */
  peek?: number;
  /** A wall's open end at a corner, not furniture: where `px, pz` is the hug spot back from the corner, and `lean` where the agent stands to look round it. */
  corner?: boolean;
  lean?: { x: number; z: number };
};

/** The nearest furniture face within reach of (x, z), or null. Walls and other structure don't count. */
export function coverSpotNear(boxes: WallBox[], x: number, z: number, reach = COVER_REACH): CoverSpot | null {
  let best: CoverSpot | null = null;
  for (const box of boxes) {
    if (!box.cover) continue;
    const faces = [
      { nx: 0, nz: -1, plane: box.minZ, lo: box.minX, hi: box.maxX },
      { nx: 0, nz: 1, plane: box.maxZ, lo: box.minX, hi: box.maxX },
      { nx: -1, nz: 0, plane: box.minX, lo: box.minZ, hi: box.maxZ },
      { nx: 1, nz: 0, plane: box.maxX, lo: box.minZ, hi: box.maxZ },
    ];
    for (const f of faces) {
      const alongZ = f.nx !== 0; // the face runs along Z when its normal is along X
      const out = alongZ ? (x - f.plane) * f.nx : (z - f.plane) * f.nz;
      const lateral = alongZ ? z : x;
      if (out <= 0 || out > reach || lateral < f.lo - 0.2 || lateral > f.hi + 0.2) continue;
      if (best && out >= best.dist) continue;
      const stand = f.plane + (alongZ ? f.nx : f.nz) * COVER_STANDOFF;
      const clamped = Math.min(f.hi, Math.max(f.lo, lateral));
      best = alongZ
        ? { box, nx: f.nx, nz: 0, ax: stand, az: f.lo, bx: stand, bz: f.hi, px: stand, pz: clamped, dist: out }
        : { box, nx: 0, nz: f.nz, ax: f.lo, az: stand, bx: f.hi, bz: stand, px: clamped, pz: stand, dist: out };
    }
  }
  return best;
}

/** Holds a point on the standing line of `spot`, letting it lean up to `peek` (the spot's own, if it has one) past either end. */
export function clampToCover(spot: CoverSpot, x: number, z: number, peek = spot.peek ?? COVER_PEEK): { x: number; z: number } {
  if (spot.nx !== 0) return { x: spot.ax, z: Math.min(spot.bz + peek, Math.max(spot.az - peek, z)) };
  return { x: Math.min(spot.bx + peek, Math.max(spot.ax - peek, x)), z: spot.az };
}

/** The facing (0 = +Z) that looks at the face — over the furniture, at the far side. */
export function coverFacing(spot: CoverSpot): number {
  return Math.atan2(-spot.nx, -spot.nz);
}

// ---- Corners ----
//
// Where a wall ends at an opening (the side corridor of an L or a T meeting the long one, a doorway) the wall itself is cover: hugging its face a little back from the end,
// the agent is hidden from anything down the other way, and leans out past the end to look and shoot along it. It is the furniture model with a wall for the furniture:
// the agent faces into the wall's face, which is down the corridor it opens onto, and the lean (a spot past the end) is made on aiming and undone on ducking.

export const CORNER_REACH = 0.9; // as near the face as cover on furniture
export const CORNER_END_ZONE = 1.9; // how near the open end the agent must be to be offered it
export const CORNER_LOOK_M = 6; // how far clear the line from the end, down the way the face looks, must run to be worth a lean (a corridor, not a cupboard)
export const CORNER_HOME_BACK = 0.75; // the hug spot, back from the end
export const CORNER_PEEK = 0.8; // and how far past the end the lean goes

const solidAt = (boxes: WallBox[], x: number, z: number, except: WallBox, margin = 0.25): boolean =>
  boxes.some((b) => b !== except && x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin);

/** How far round from straight ahead a target may be, from the lean, for the corner to be worth taking for it (radians), and how far off. */
export const CORNER_AIM_YAW = 1.75;
export const CORNER_TARGET_RANGE = 14;

/** Whether a straight line from (ax, az) to (bx, bz) is clear of the walls (low furniture doesn't stop a shot or a look). */
function lineClear(boxes: WallBox[], ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  for (let d = 0.1; d < len; d += 0.1) {
    const t = d / len;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    if (boxes.some((b) => b.cover !== 'low' && px > b.minX - 0.05 && px < b.maxX + 0.05 && pz > b.minZ - 0.05 && pz < b.maxZ + 0.05)) return false;
  }
  return true;
}

/**
 * The open end of a plain wall (not furniture) near (x, z) that can be leaned out round to look down a clear way, or null. A wall is also worth hugging when it is only a short way
 * that is clear, if something in `targets` (a guard at a door, say) can be seen from the lean and shot at from there.
 */
export function cornerSpotNear(boxes: WallBox[], x: number, z: number, reach = CORNER_REACH, targets: ReadonlyArray<{ x: number; z: number }> = []): CoverSpot | null {
  let best: CoverSpot | null = null;
  for (const box of boxes) {
    if (box.cover) continue;
    const faces = [
      { nx: 0, nz: -1, plane: box.minZ, lo: box.minX, hi: box.maxX },
      { nx: 0, nz: 1, plane: box.maxZ, lo: box.minX, hi: box.maxX },
      { nx: -1, nz: 0, plane: box.minX, lo: box.minZ, hi: box.maxZ },
      { nx: 1, nz: 0, plane: box.maxX, lo: box.minZ, hi: box.maxZ },
    ];
    for (const f of faces) {
      const alongZ = f.nx !== 0; // the face runs along Z when its normal is along X
      const out = alongZ ? (x - f.plane) * f.nx : (z - f.plane) * f.nz;
      const lateral = alongZ ? z : x;
      if (out <= 0 || out > reach || lateral < f.lo - 0.2 || lateral > f.hi + 0.2) continue;
      if (best && out >= best.dist) continue;
      const stand = f.plane + (alongZ ? f.nx : f.nz) * COVER_STANDOFF;
      const at = (along: number, back = 0): { x: number; z: number } => (alongZ ? { x: stand - f.nx * back, z: along } : { x: along, z: stand - f.nz * back });
      for (const end of [-1, 1] as const) {
        const e = end < 0 ? f.lo : f.hi;
        if (Math.abs(lateral - e) > CORNER_END_ZONE) continue;
        // Open past the end, and clear a good way down the way the face looks, from there.
        const beyond = at(e + end * 0.9);
        if (solidAt(boxes, beyond.x, beyond.z, box)) continue;
        let clear = true;
        for (let d = 0.3; d <= CORNER_LOOK_M && clear; d += 0.3) {
          const px = beyond.x - (alongZ ? f.nx : 0) * d;
          const pz = beyond.z - (alongZ ? 0 : f.nz) * d;
          if (solidAt(boxes, px, pz, box)) clear = false;
        }
        const home = at(Math.min(f.hi, Math.max(f.lo, e - end * CORNER_HOME_BACK)));
        const lean = at(e + end * CORNER_PEEK);
        // The way from the hug to the lean must be walkable (not through a wall that meets this one at its end).
        let walkable = true;
        for (let t = 0; t <= 1.0001 && walkable; t += 0.1) {
          if (solidAt(boxes, home.x + (lean.x - home.x) * t, home.z + (lean.z - home.z) * t, box, 0.3)) walkable = false;
        }
        if (!walkable) continue;
        if (!clear) {
          // Not a long clear way, but a target in sight from the lean, round enough to the front.
          const facing = Math.atan2(-(alongZ ? f.nx : 0), -(alongZ ? 0 : f.nz));
          const sees = targets.some((t) => {
            const d = Math.hypot(t.x - lean.x, t.z - lean.z);
            if (d > CORNER_TARGET_RANGE || d < 0.5) return false;
            let off = Math.atan2(t.x - lean.x, t.z - lean.z) - facing;
            off = Math.atan2(Math.sin(off), Math.cos(off));
            return Math.abs(off) <= CORNER_AIM_YAW && lineClear(boxes, lean.x, lean.z, t.x, t.z);
          });
          if (!sees) continue;
        }
        best = alongZ
          ? { box, nx: f.nx, nz: 0, ax: stand, az: f.lo, bx: stand, bz: f.hi, px: home.x, pz: home.z, dist: out, peek: CORNER_PEEK, corner: true, lean }
          : { box, nx: 0, nz: f.nz, ax: f.lo, az: stand, bx: f.hi, bz: stand, px: home.x, pz: home.z, dist: out, peek: CORNER_PEEK, corner: true, lean };
      }
    }
  }
  return best;
}
