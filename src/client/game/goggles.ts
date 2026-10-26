// Night-vision goggles, on a rechargeable battery. Worn, they show the
// scene amplified in green without the torch, so a guard has no beam on the
// floor to notice. game.ts switches the torch off when they go on (and the
// goggles off when the torch comes back on). They drain while worn and
// recharge while off, and won't switch on with a nearly flat battery. Pure,
// so the rules are unit-testable under Node.

export const GOGGLES_DRAIN_S = 45; // a full battery lasts this long worn
export const GOGGLES_RECHARGE_S = 60; // empty to full, while off
export const GOGGLES_MIN_START = 0.15; // too flat to switch on below this

export type GogglesState = { energy: number; on: boolean };

export const FULL_GOGGLES: GogglesState = { energy: 1, on: false };

/** The goggles key/button: off if on; on only with enough charge. */
export function toggleGoggles(s: GogglesState): GogglesState {
  if (s.on) return { ...s, on: false };
  return s.energy >= GOGGLES_MIN_START ? { ...s, on: true } : s;
}

/** Drains while worn (switching off when flat), recharges while off. */
export function tickGoggles(s: GogglesState, dt: number): GogglesState {
  if (s.on) {
    const energy = Math.max(0, s.energy - dt / GOGGLES_DRAIN_S);
    return { energy, on: energy > 0 };
  }
  return { energy: Math.min(1, s.energy + dt / GOGGLES_RECHARGE_S), on: false };
}
