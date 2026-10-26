// Pure line-of-sight and aim-check math for the patrol bot — kept separate
// from bots.ts (which needs Three.js/GLTFLoader for the actual Bot class
// and its rendering) purely so this logic can be unit tested directly under
// Node without pulling in that browser-only dependency chain.
//
// Bots see in a forward cone (VIEW_HALF_ANGLE either side of their facing)
// out to their detection radius, plus a small all-around awareness radius so
// the player can't brush straight past one. Walls block both.

import type { WallBox } from './scene';

export type Targetable = { worldX: number; worldZ: number; disabled: boolean };

export const DETECT_RADIUS = 10; // world units
export const SNEAK_DETECT_RADIUS = 5.5; // sneaking meaningfully shrinks how far a bot can spot you from
export const FIRE_RANGE = 14;
const FIRE_HALF_ANGLE = 0.24; // radians, ~13.7°
/** Aiming from cover with the crosshair: the shot goes where the crosshair is, so the cone is a lot tighter (~5.7°: a guard's width at 8 m). */
export const AIM_HALF_ANGLE = 0.1;
export const VIEW_HALF_ANGLE = (50 * Math.PI) / 180; // a 100° forward cone
export const AWARE_RADIUS = 2.2; // any direction — too close to slip past unnoticed
export const SNEAK_AWARE_RADIUS = 1.2;

/** Liang-Barsky clip of segment (x1,z1)→(x2,z2) against an AABB in the XZ plane: the entry parameter t in [0,1], or null if it misses. */
function segmentEntry(x1: number, z1: number, x2: number, z2: number, box: WallBox): number | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const p = [-dx, dx, -dz, dz];
  const q = [x1 - box.minX, box.maxX - x1, z1 - box.minZ, box.maxZ - z1];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const r = qi / pi;
      if (pi < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0;
}

function segmentIntersectsBox(x1: number, z1: number, x2: number, z2: number, box: WallBox): boolean {
  return segmentEntry(x1, z1, x2, z2, box) !== null;
}

/** Whether anything solid lies on the line. `overLowCover`: the line passes above low furniture (a standing player, a shot). */
function wallsBlock(x1: number, z1: number, x2: number, z2: number, wallBoxes: WallBox[], overLowCover = false): boolean {
  for (const box of wallBoxes) {
    if (overLowCover && box.cover === 'low') continue;
    if (box.see) continue; // a fence stops a body, not a look
    if (segmentIntersectsBox(x1, z1, x2, z2, box)) return true;
  }
  return false;
}

/** 360-degree, wall-occluded — no facing/blind-spot check, just range + a clear line. `radius` defaults to the normal detection range; pass SNEAK_DETECT_RADIUS while the player is sneaking. */
export function hasLineOfSight(bx: number, bz: number, px: number, pz: number, wallBoxes: WallBox[], radius = DETECT_RADIUS): boolean {
  if (Math.hypot(px - bx, pz - bz) > radius) return false;
  return !wallsBlock(bx, bz, px, pz, wallBoxes);
}

/** True if (px,pz) lies within `halfAngle` of the direction a bot at (bx,bz) is facing (same angle convention as the player: 0 = +Z). */
export function inViewCone(bx: number, bz: number, facing: number, px: number, pz: number, halfAngle = VIEW_HALF_ANGLE): boolean {
  const dx = px - bx;
  const dz = pz - bz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  return (dx / d) * Math.sin(facing) + (dz / d) * Math.cos(facing) >= Math.cos(halfAngle);
}

/**
 * A bot sees the player if they're in its forward cone within `radius`, or
 * anywhere within `awareRadius` — and nothing is in the way. Low furniture
 * only gets in the way of a player crouched behind it (`crouched`); a
 * standing player shows over the top.
 */
export function botCanSee(
  bx: number,
  bz: number,
  facing: number,
  px: number,
  pz: number,
  wallBoxes: WallBox[],
  radius = DETECT_RADIUS,
  awareRadius = AWARE_RADIUS,
  crouched = true,
  halfAngle = VIEW_HALF_ANGLE
): boolean {
  const d = Math.hypot(px - bx, pz - bz);
  if (d > radius) return false;
  if (d > awareRadius && !inViewCone(bx, bz, facing, px, pz, halfAngle)) return false;
  return !wallsBlock(bx, bz, px, pz, wallBoxes, !crouched);
}

/**
 * How exposed a player is to one guard, from 0 (out of its reach, or something solid in the way) to 1 (it has them): the number the
 * visibility meter shows. It is built from the very same rules botCanSee uses, with the same `radius` and `awareRadius` the bot
 * itself works out, so the meter can't say hidden while the guard is looking right at you. Short of being seen it rises as the
 * player nears the edge of the bot's sight, a little less if it isn't looking their way (it could turn), and never reaches
 * 1 until botCanSee says so.
 */
export function exposure(
  bx: number,
  bz: number,
  facing: number,
  px: number,
  pz: number,
  wallBoxes: WallBox[],
  radius = DETECT_RADIUS,
  awareRadius = AWARE_RADIUS,
  crouched = true,
  halfAngle = VIEW_HALF_ANGLE
): number {
  if (botCanSee(bx, bz, facing, px, pz, wallBoxes, radius, awareRadius, crouched, halfAngle)) return 1;
  const d = Math.hypot(px - bx, pz - bz);
  if (wallsBlock(bx, bz, px, pz, wallBoxes, !crouched)) return 0;
  const reach = Math.min(1, radius / Math.max(d, 0.001));
  const looking = d <= awareRadius || inViewCone(bx, bz, facing, px, pz, halfAngle);
  return Math.min(0.9, reach * (looking ? 1 : 0.6));
}

export const TAKEDOWN_RANGE = 1.8; // just past a sneaking player's all-round awareness radius (SNEAK_AWARE_RADIUS), so the window is real but tight
const TAKEDOWN_BLIND_MARGIN = (15 * Math.PI) / 180; // must be this far outside the view cone, not skimming its edge
const TAKEDOWN_FACING = Math.PI / 3; // the player has to be facing it, within 60°

/**
 * Whether the player can take an enemy down: it hasn't noticed them, they're
 * within TAKEDOWN_RANGE, behind it (well outside its forward view cone),
 * facing it, and nothing solid is in between.
 */
export function canTakedown(
  ex: number,
  ez: number,
  enemyFacing: number,
  enemyAlert: boolean,
  px: number,
  pz: number,
  playerFacing: number,
  wallBoxes: WallBox[]
): boolean {
  if (enemyAlert) return false;
  const dx = ex - px;
  const dz = ez - pz;
  const d = Math.hypot(dx, dz);
  if (d > TAKEDOWN_RANGE || d < 1e-6) return false;
  if (inViewCone(ex, ez, enemyFacing, px, pz, VIEW_HALF_ANGLE + TAKEDOWN_BLIND_MARGIN)) return false;
  if ((dx / d) * Math.sin(playerFacing) + (dz / d) * Math.cos(playerFacing) < Math.cos(TAKEDOWN_FACING)) return false;
  return !wallsBlock(px, pz, ex, ez, wallBoxes);
}

/** How far a ray from (ox,oz) along unit (dirX,dirZ) travels before hitting a box, capped at maxDist — clips a bot's floor vision cone against walls. */
export function rayToBoxes(ox: number, oz: number, dirX: number, dirZ: number, maxDist: number, boxes: WallBox[]): number {
  const ex = ox + dirX * maxDist;
  const ez = oz + dirZ * maxDist;
  let best = 1;
  for (const box of boxes) {
    const t = segmentEntry(ox, oz, ex, ez, box);
    if (t !== null && t < best) best = t;
  }
  return best * maxDist;
}

// ---- Shooting from up high ----
//
// From a platform the walls are not in the way the way they are on the floor: the shot comes down over them. But they still hide what is behind them: a guard just past a wall's far
// side is under its shadow. The line from the eye to the target is a real 3D line, and a wall (or desk, or crate) stops it only where the line is lower than its top.

/** How high each kind of solid reaches (scene.ts's WALL_H for a wall; furniture's cover class otherwise). */
export const WALL_TOP = 3;
export const TALL_COVER_TOP = 1.9;
export const LOW_COVER_TOP = 1.05;

const topOf = (box: WallBox): number => box.roof ?? box.h ?? (box.cover === 'low' ? LOW_COVER_TOP : box.cover === 'tall' ? TALL_COVER_TOP : WALL_TOP);

/** Whether the straight line from (x1, y1, z1) to (x2, y2, z2) passes clear over (or round) every box. Heights are metres off the same floor. */
export function lineClearOver(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, boxes: WallBox[]): boolean {
  for (const box of boxes) {
    const inT = segmentEntry(x1, z1, x2, z2, box);
    if (inT === null) continue;
    const back = segmentEntry(x2, z2, x1, z1, box);
    const outT = back === null ? 1 : 1 - back;
    // The line is straight, so its lowest point inside the box is at one of its two ends.
    const lowest = Math.min(y1 + (y2 - y1) * inT, y1 + (y2 - y1) * outT);
    if (lowest < topOf(box)) return false;
  }
  return true;
}

/**
 * The nearest target in the sights of a shooter at (x, eyeY, z) looking along `yaw` (0 = +Z) and `pitch` (up positive), within `halfAngle` of that line in both, in range and in
 * line of sight over the walls. `chestY` is how high above its own floor to aim at a target.
 */
export function tryFireAimed<T extends Targetable & { floorY: number }>(
  x: number,
  z: number,
  eyeY: number,
  yaw: number,
  pitch: number,
  targets: T[],
  boxes: WallBox[],
  halfAngle: number,
  range: number,
  chestY: number | ((t: T) => number) = 1.15
): T | null {
  let best: T | null = null;
  let bestDist = range;
  for (const t of targets) {
    if (t.disabled) continue;
    const dx = t.worldX - x;
    const dz = t.worldZ - z;
    const aimY = t.floorY + (typeof chestY === 'number' ? chestY : chestY(t));
    const dy = aimY - eyeY;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(flat, dy);
    if (dist < 0.3 || dist > bestDist) continue;
    let dyaw = Math.atan2(dx, dz) - yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = Math.atan2(dy, flat) - pitch;
    if (Math.hypot(dyaw * Math.max(0.2, Math.cos(pitch)), dpitch) > halfAngle) continue;
    if (!lineClearOver(x, eyeY, z, t.worldX, aimY, t.worldZ, boxes)) continue;
    best = t;
    bestDist = dist;
  }
  return best;
}

/** Raycast-ish aim check: nearest target within range, inside the aim cone, and not wall-blocked. */
export function tryFire<T extends Targetable>(playerX: number, playerZ: number, facingAngle: number, targets: T[], wallBoxes: WallBox[], halfAngle = FIRE_HALF_ANGLE, range = FIRE_RANGE): T | null {
  const fx = Math.sin(facingAngle);
  const fz = Math.cos(facingAngle);
  let best: T | null = null;
  let bestDist = range;
  for (const target of targets) {
    if (target.disabled) continue;
    const dx = target.worldX - playerX;
    const dz = target.worldZ - playerZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05 || dist > bestDist) continue;
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    const angleTo = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (angleTo > halfAngle) continue;
    if (wallsBlock(playerX, playerZ, target.worldX, target.worldZ, wallBoxes, true)) continue; // shots clear low furniture
    best = target;
    bestDist = dist;
  }
  return best;
}

export type AimPoint = { x: number; y: number; z: number };
export type HitZone = 'head' | 'body';
export type HitVolume<T> = AimPoint & { target: T; zone: HitZone; rx: number; ry: number; rz: number };
export type AimedHit<T> = { target: T; zone: HitZone; point: AimPoint; distance: number };

/** Exact ray/ellipsoid intersections: no angular aim assist that turns near misses into body hits. */
export function rayHitVolumes<T>(origin: AimPoint, direction: AimPoint, volumes: HitVolume<T>[], walls: WallBox[], range: number, floorY = 0): AimedHit<T> | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length <= 0 || range <= 0) return null;
  const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  let hit: AimedHit<T> | null = null;
  for (const v of volumes) {
    if (Math.min(v.rx, v.ry, v.rz) <= 0) continue;
    const ox = (origin.x - v.x) / v.rx, oy = (origin.y - v.y) / v.ry, oz = (origin.z - v.z) / v.rz;
    const dx = d.x / v.rx, dy = d.y / v.ry, dz = d.z / v.rz;
    const a = dx * dx + dy * dy + dz * dz;
    const b = ox * dx + oy * dy + oz * dz;
    const c = ox * ox + oy * oy + oz * oz - 1;
    const disc = b * b - a * c;
    if (disc < 0) continue;
    const near = (-b - Math.sqrt(disc)) / a;
    const far = (-b + Math.sqrt(disc)) / a;
    const distance = near >= 0 ? near : far;
    if (distance < 0 || distance > (hit?.distance ?? range)) continue;
    const point = { x: origin.x + d.x * distance, y: origin.y + d.y * distance, z: origin.z + d.z * distance };
    // (The walls' heights are off their own floor, so a line up on an upper storey is lowered by that floor's height.)
    if (!lineClearOver(origin.x, origin.y - floorY, origin.z, point.x, point.y - floorY, point.z, walls)) continue;
    hit = { target: v.target, zone: v.zone, point, distance };
  }
  return hit;
}
