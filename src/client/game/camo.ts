// Camo — an optical cloak on a rechargeable battery. While it's on, laser
// beams don't register the player (player.ts lets them walk through), and a
// player who is also holding still can't be seen by any enemy, until one
// walks right into them, which breaks the cloak. Standing still, it drains
// at half speed. Pure, so the rules are unit-testable under Node.

export const CAMO_DRAIN_S = 8; // a full battery lasts this long
export const CAMO_RECHARGE_S = 16; // empty to full, while off
export const CAMO_MIN_START = 0.25; // can't flick it on with a nearly flat battery
export const CAMO_STILL_DRAIN = 0.5; // standing still, it drains this much as fast
export const BUMP_MARGIN = 0.15; // an enemy this close past touching has walked into you

export type CamoState = { energy: number; active: boolean };

export const FULL_CAMO: CamoState = { energy: 1, active: false };

/** The camo key/button: switches off if on; switches on only with enough charge. */
export function toggleCamo(s: CamoState): CamoState {
  if (s.active) return { ...s, active: false };
  return s.energy >= CAMO_MIN_START ? { ...s, active: true } : s;
}

/** Drains while on (more slowly standing still; switching off when empty), recharges while off. */
export function tickCamo(s: CamoState, dt: number, still = false): CamoState {
  if (s.active) {
    const energy = Math.max(0, s.energy - (dt / CAMO_DRAIN_S) * (still ? CAMO_STILL_DRAIN : 1));
    return { energy, active: energy > 0 };
  }
  return { energy: Math.min(1, s.energy + dt / CAMO_RECHARGE_S), active: false };
}

/** Invisible to enemies: cloaked and not moving. */
export function camoConceals(active: boolean, moving: boolean): boolean {
  return active && !moving;
}

/** Whether any of `enemies` (position and body radius) has walked into a player of radius `playerR` at (x, z). */
export function bumpedInto(x: number, z: number, playerR: number, enemies: Array<{ x: number; z: number; r: number }>): boolean {
  return enemies.some((e) => Math.hypot(e.x - x, e.z - z) <= e.r + playerR + BUMP_MARGIN);
}
