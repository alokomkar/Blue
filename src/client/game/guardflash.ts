// A guard's flash grenade. A guard that has had the agent in sight for a moment, from too far to rush and not so far that the throw is a guess, may throw one at them: it goes off
// about a second later, where the agent was, and the agent caught in its light (a clear line to it, not shut away) is blinded, the screen white and fading back over a few seconds, and
// stumbles for a moment. Breaking the line to the bang is the answer. Only the agent is flashed (the guards are assumed to look away), and few guards carry one, one each, so it is
// a surprise, not a barrage. Pure, and tested under Node; game.ts does the throwing.

/** Of the guards, this share carries a flash grenade. */
export const FLASH_CARRIERS = 0.35;
/** It throws from at least this far (closer, it goes for the agent) and at most this far. */
export const GUARD_FLASH_MIN_M = 6;
export const GUARD_FLASH_MAX_M = 14;
/** It has to have been in the fight, the agent in its sights, this long before it reaches for a grenade. */
export const GUARD_FLASH_SIGHT_S = 1;
/** Between two throws on a floor, whoever throws. */
export const GUARD_FLASH_GAP_S = 12;
/** Caught in the light this close to the bang, in metres (a clear line only). */
export const GUARD_FLASH_RADIUS = 9;
/** The white-out takes this long to clear, and the agent stumbles at the start of it. */
export const BLIND_FADE_S = 2.8;
export const STUMBLE_S = 1.1;
/** How much of their pace and turn the agent has left while they stumble. */
export const STUMBLE_PACE = 0.35;

export type ThrowChance = {
  /** Seconds the guard has had the agent in sight, unbroken. */
  seenFor: number;
  /** Metres, guard to agent. */
  dist: number;
  /** A clear line, guard to agent, and the agent on the guard's level (not up on a roof). */
  clear: boolean;
  /** Grenades it has left. */
  stock: number;
  /** Seconds since this guard last threw, and since anyone on the floor did. */
  sinceOwn: number;
  sinceAny: number;
  /** Hunters and heavies rush; a dazed or downed guard does nothing. */
  rusher: boolean;
  down: boolean;
};

/** Whether the guard throws a flash now. */
export function throwsFlash(c: ThrowChance): boolean {
  if (c.stock <= 0 || c.rusher || c.down || !c.clear) return false;
  if (c.seenFor < GUARD_FLASH_SIGHT_S || c.dist < GUARD_FLASH_MIN_M || c.dist > GUARD_FLASH_MAX_M) return false;
  return c.sinceOwn >= GUARD_FLASH_GAP_S && c.sinceAny >= GUARD_FLASH_GAP_S;
}

/** Whether a given guard carries one (a share of them, picked by a draw in 0..1 made once for it). */
export const carries = (draw: number): boolean => draw < FLASH_CARRIERS;

/**
 * How much of the bang the agent catches (0 to 1, for the white-out), or null for none: out of range or without a clear line to it, up on another level, or shut away in a locker.
 * Nearer is whiter.
 */
export function flashStrength(c: { dist: number; dy: number; clear: boolean; shutAway: boolean }): number | null {
  if (c.shutAway || !c.clear || c.dy > 3 || c.dist > GUARD_FLASH_RADIUS) return null;
  return Math.max(0.55, Math.min(0.95, 1 - c.dist * 0.04));
}

/** The seconds of stumble left after `dt`. */
export const stumbleLeft = (left: number, dt: number): number => Math.max(0, left - dt);
