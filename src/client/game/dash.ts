// The dash: tap forward twice and hold the second tap (or double-touch the joystick and hold), and the agent runs faster than a walk for as
// long as the energy lasts. It's fast, loud, and easy to see: noise carries further and guards see a runner from further off, which the
// visibility meter shows. The energy is short, a second and a half, and refills while the agent isn't dashing; once it's spent the
// dash needs a fresh double-tap (holding on doesn't start it again). Pure, so it's unit-tested under Node.

/** How much faster than walking (player.ts's MOVE_SPEED is 7): about 10. */
export const DASH_SPEED_FACTOR = 10 / 7;
/** How far a dashing agent's noise carries along the corridors (walking is 9, sneaking 3). */
export const DASH_NOISE = 14;
/** How much further a guard sees a runner, against a walker. */
export const DASH_SIGHT = 1.2;
/** Seconds a full energy lasts, seconds to refill it from empty, and the least that can start a dash. */
export const DASH_MAX_S = 1.5;
export const DASH_RECHARGE_S = 4;
export const DASH_MIN_START = 0.3;
/** The second press must follow the first within this long (keyboard), or this long for a touch of the joystick. */
export const DOUBLE_TAP_MS = 280;
export const TOUCH_DOUBLE_TAP_MS = 320;

export type DashState = { energy: number; active: boolean; /** Ran dry while the gesture was still held: it waits for the next one. */ spent: boolean };

export const FULL_DASH: DashState = { energy: 1, active: false, spent: false };

/** Whether a press at `now` follows the last at `previous` closely enough to be the second of a double-tap. */
export function isDoubleTap(previous: number, now: number, windowMs: number): boolean {
  return now - previous <= windowMs;
}

/**
 * One step: `wants` is the gesture being held (a double-tap whose second press is still down, with forward pushed). Starts a dash when
 * there's enough energy, drains while it runs, stops when the gesture is let go or the energy runs out, and refills otherwise.
 */
export function tickDash(s: DashState, wants: boolean, dt: number): { state: DashState; started: boolean } {
  if (!wants) {
    const energy = s.active ? s.energy : Math.min(1, s.energy + dt / DASH_RECHARGE_S);
    return { state: { energy, active: false, spent: false }, started: false };
  }
  if (!s.active) {
    if (s.spent || s.energy < DASH_MIN_START) return { state: { ...s, energy: Math.min(1, s.energy + dt / DASH_RECHARGE_S) }, started: false };
    return { state: { energy: s.energy - dt / DASH_MAX_S, active: true, spent: false }, started: true };
  }
  const energy = s.energy - dt / DASH_MAX_S;
  return energy > 0 ? { state: { energy, active: true, spent: false }, started: false } : { state: { energy: 0, active: false, spent: true }, started: false };
}
