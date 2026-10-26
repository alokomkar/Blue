// A guard's laser sight, made to matter. The red line (sights.ts) runs from the gun along the way the guard faces; when it lies on the agent long enough the guard takes notice: it
// does not know yet, so it creeps up crouched to see for itself, and if the agent is gone by the time it gets there it goes back to what it was doing. Pure geometry and timing, so it is
// unit-tested under Node; bots.ts plays it.

/** How far the line reaches (metres), and the little more, either side of where it points, that still counts as on the agent (radians, about 11 degrees). */
export const LASER_RANGE = 16;
export const LASER_WEDGE = 0.2;
/** Seconds on the agent before the guard takes notice. */
export const LASER_NOTICE_S = 5;
/** Seconds a guard that has taken notice keeps coming after the line has left the agent (it goes to where it last saw it), before it gives up and goes back. */
export const LASER_CONFIRM_S = 4;
/** The creep: this fraction of a walking pace. */
export const CREEP_PACE = 0.45;
/** How fast the time on the agent drains once the line is off them (times the real time): a guard's laser sweeps to and fro, so it has to forgive a little. */
export const DRAIN = 1.5;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Whether the agent at (px, pz) is in the laser of a guard at (gx, gz): within its reach, with nothing in the way (`clear`), and inside the wedge its line covers. A guard that stands
 * sweeping its gaze to and fro (a sentry on post, a patrol pausing to look round) passes the line over the whole arc `half` either side of `centre` again and again, so the agent
 * anywhere in that arc is in it (and one standing still in it, for as long as it lasts); a guard walking has no arc, only the line.
 */
export function laserIn(gx: number, gz: number, centre: number, half: number, px: number, pz: number, clear: boolean): boolean {
  if (!clear) return false;
  const rx = px - gx;
  const rz = pz - gz;
  const d = Math.hypot(rx, rz);
  if (d > LASER_RANGE || d < 0.5) return false;
  return Math.abs(wrap(Math.atan2(rx, rz) - centre)) <= half + LASER_WEDGE;
}

/** The seconds the line has been on the agent, a frame on: it builds while on, and drains (quicker than it built) once off, so a brush across the line does not add up. */
export function stepDwell(dwell: number, on: boolean, dt: number): number {
  return on ? dwell + dt : Math.max(0, dwell - dt * DRAIN);
}

/** How near the guard is to taking notice, 0 to 1 (the line shows it: it brightens). */
export function warning(dwell: number): number {
  return Math.min(1, dwell / LASER_NOTICE_S);
}
