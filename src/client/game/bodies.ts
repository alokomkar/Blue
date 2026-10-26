// Bodies left lying around. A guard who's been put down stays where it fell
// until the player drags it somewhere; how easily another guard notices it
// depends on how visible it is: lying under a working light it's plain to
// see, in a dim stretch less so, in a pitch-dark one or tucked inside a room
// hardly at all. The HUD shows that as a percentage over the body, and it's
// up to the player how low is low enough. Pure (type-only imports), so it's
// unit-tested under Node.

/** A light, by the maze cell it hangs in, and whether it's on. */
export type LampSpot = { x: number; y: number; lit: boolean };

/** Light that reaches a spot with no working lamp near: the glow of the building at night. */
const AMBIENT = 0.1;
/** A working lamp lights its own cell fully, fading out over this many cells. */
const LAMP_REACH_CELLS = 2.5;
/** Inside a room a body is out of the corridor's sightlines: it counts this much as visible. */
const ROOM_FACTOR = 0.6;
/** However well hidden, a guard all but stepping on a body notices it (world units). */
export const BODY_MIN_NOTICE = 1.6;
/** Training's "hide the body": at or under this, it counts as hidden. */
export const BODY_HIDDEN_PCT = 40;

/**
 * How much light falls at (x, y), in cells (fractional: a body lies between
 * cell centres), from 0 to 1. `dark`: the spot is blacked out or its circuit
 * cut, so nothing lights it.
 */
export function lightAt(x: number, y: number, lamps: readonly LampSpot[], dark: boolean): number {
  if (dark) return 0;
  let light = 0;
  for (const l of lamps) {
    if (!l.lit) continue;
    light = Math.max(light, 1 - Math.hypot(l.x - x, l.y - y) / LAMP_REACH_CELLS);
  }
  return Math.max(0, light);
}

/** A body's visibility, 0–100: how much light is on it, and whether it's inside a room. */
export function bodyVisibility(light: number, inRoom: boolean): number {
  const v = (AMBIENT + (1 - AMBIENT) * Math.max(0, Math.min(1, light))) * (inRoom ? ROOM_FACTOR : 1);
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

/**
 * How long a guard has to look at a fully visible body to notice it, in seconds. Noticing builds up while a guard
 * can see the body, in proportion to how visible it is: a body at 10% takes ten times as long, so a guard walking
 * past one in the dark doesn't find it, and one standing beside it for a while does. It fades if nobody's looking.
 */
export const NOTICE_FULL_S = 0.6;
export const NOTICE_DECAY_PER_S = 0.5;

/** How fast a guard's noticing of a body builds, per second (1 = noticed), for a body this visible (0-100). */
export function noticeRate(visibility: number): number {
  return Math.max(0, Math.min(100, visibility)) / 100 / NOTICE_FULL_S;
}

/** Suspicion a found body costs: little if it was well hidden, the full 25 if it was lying in plain sight. */
export function foundSuspicion(visibility: number): number {
  return Math.round(8 + (17 * Math.max(0, Math.min(100, visibility))) / 100);
}

/** Only a body in plain sight calls every guard nearby; a hidden one is only the finder's business. */
export const CALLS_OTHERS_ABOVE = 40;
export const callsOthers = (visibility: number): boolean => visibility > CALLS_OTHERS_ABOVE;

/** How close a guard looking its way has to be to notice a body this visible: its full sight range at 100%. */
export function noticeRange(visibility: number, sightRange: number): number {
  return Math.max(BODY_MIN_NOTICE, (sightRange * visibility) / 100);
}
