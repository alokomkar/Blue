// Bullet time: while an enemy closes in, Space slows the world to a crawl for a few seconds while the agent keeps most of their own speed: room to move, aim, throw a grenade, get
// clear of a dog. A meter that drains while it is on and refills while it is off, so it cannot be held; it eases in and out (the world does not lurch to a stop). Pure, and tested under Node.

import type { EnemyKind } from './enemies/types';

/** Real seconds a full meter lasts. */
export const BULLET_MAX_S = 4;
/** Seconds to refill an empty meter while it is off. */
export const BULLET_RECHARGE_S = 26;
/** It will not start below this much. */
export const BULLET_MIN_START = 0.3;
/** The world's pace at full effect, and the agent's own: they are 3× faster than everything else. */
export const BULLET_WORLD = 0.22;
export const BULLET_PLAYER = 0.7;
/** How fast the effect eases in and out (per second: about a third of a second each way). */
export const BULLET_EASE = 3.2;
/** Automatic bullet time starts only with at least this much in the meter, and again only once nothing has been closing in for this many seconds. */
export const BULLET_AUTO_MIN = 0.5;
export const BULLET_REARM_S = 4;

/** An enemy this close and after the agent is a reason to offer it. */
export const BULLET_OFFER_M = 13;

export type BulletState = { energy: number; on: boolean; /** How far in: 0 normal, 1 full effect. */ k: number };

export const FULL_BULLET: BulletState = { energy: 1, on: false, k: 0 };

/** Space: on (with enough in the meter), or off. */
export function toggleBullet(s: BulletState): BulletState {
  if (s.on) return { ...s, on: false };
  return s.energy >= BULLET_MIN_START ? { ...s, on: true } : s;
}

/** One real frame: the meter drains or refills, the effect eases toward where it is going. */
export function tickBullet(s: BulletState, frameDt: number): BulletState {
  let { energy, on } = s;
  if (on) {
    energy = Math.max(0, energy - frameDt / BULLET_MAX_S);
    if (energy <= 0) on = false;
  } else {
    energy = Math.min(1, energy + frameDt / BULLET_RECHARGE_S);
  }
  const goal = on ? 1 : 0;
  const k = s.k + (goal - s.k) * Math.min(1, frameDt * BULLET_EASE);
  return { energy, on, k: Math.abs(k - goal) < 0.01 ? goal : k };
}

/** The pace of the world and of the agent, for the effect `k` (0 to 1): the multipliers for a real frame's seconds. */
export function bulletPace(k: number): { world: number; player: number } {
  return { world: 1 - (1 - BULLET_WORLD) * k, player: 1 - (1 - BULLET_PLAYER) * k };
}

export type Approacher = { kind: EnemyKind; alert: boolean; disabled: boolean; dist: number };

/** Whether something is closing in: an enemy after the agent, close enough that a few seconds matter (a mine or a drone counts too). */
export function approaching(enemies: ReadonlyArray<Approacher>): boolean {
  // (A sniper locked on is not closing in: slowing the world would stretch its aim, which is the thing to beat.)
  return enemies.some((e) => e.kind !== 'sniper' && e.alert && !e.disabled && e.dist <= BULLET_OFFER_M);
}
