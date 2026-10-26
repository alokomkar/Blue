// The trap's motion sensor: a blue laser tripwire through the trap, across the way it faces and as far as the walls (or the reach) allow. Anything that walks
// across it sets the trap off. Pure geometry, no rendering, so it is unit-tested under Node.

/** How far the beam runs each way from the trap, a little less than the blast (traps.ts's TRAP_RADIUS 3), so whatever trips it is in the blast. */
export const SENSOR_REACH = 2.7;
/** The shortest a beam is allowed to be each way: against a wall it is still a line, not a dot. */
export const SENSOR_MIN = 0.5;
/** Less than this much movement in a frame is standing still, not motion. */
export const SENSOR_MIN_MOVE = 0.012;
/** A body in the beam turning faster than this (radians a second) is motion too: a guard looking around moves its feet. */
export const SENSOR_MIN_TURN_RATE = 0.1;
/** More than this much in a frame is a jump (a restart, a lift), not a walk across the beam. */
export const SENSOR_MAX_MOVE = 3;
/** How long between the beam breaking and the blast: long enough for a second dog or guard following the first to walk into the blast too, short enough to catch whatever tripped it. */
export const SENSOR_FUSE_S = 0.45;
/** The least body a thing has for the beam: a thin dog still breaks it. */
export const SENSOR_MIN_BODY = 0.3;

export type Beam = { ax: number; az: number; bx: number; bz: number };

/** The beam through (x, z) across a trap facing `facing` (radians, 0 towards +Z), running `right` metres one way and `left` the other, as clear as the walls leave it. */
export function beamAcross(x: number, z: number, facing: number, left: number, right: number): Beam {
  const px = Math.cos(facing);
  const pz = -Math.sin(facing);
  const r = Math.min(SENSOR_REACH, Math.max(SENSOR_MIN, right));
  const l = Math.min(SENSOR_REACH, Math.max(SENSOR_MIN, left));
  return { ax: x + px * r, az: z + pz * r, bx: x - px * l, bz: z - pz * l };
}

type P = { x: number; z: number };

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function cross(o: P, a: P, b: P): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/** Whether the segments a-b and c-d cross. */
function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The least distance between the segments a-b and c-d. */
export function segmentDistance(a: P, b: P, c: P, d: P): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b));
}

/**
 * Whether something with a body of radius `radius` that went from `from` to `to` this frame broke the beam: it moved (not stood still, not jumped), and its path, with its
 * body, touched the beam; or it stayed put in the beam but turned (`turnRate`, radians a second): a guard sweeping its gaze shifts its feet.
 */
export function brokeBeam(beam: Beam, from: P, to: P, radius: number, turnRate = 0): boolean {
  const moved = Math.hypot(to.x - from.x, to.z - from.z);
  if (moved > SENSOR_MAX_MOVE) return false;
  const body = Math.max(radius, SENSOR_MIN_BODY);
  const a = { x: beam.ax, z: beam.az };
  const b = { x: beam.bx, z: beam.bz };
  if (moved >= SENSOR_MIN_MOVE) return segmentDistance(from, to, a, b) <= body;
  return Math.abs(turnRate) >= SENSOR_MIN_TURN_RATE && segmentDistance(to, to, a, b) <= body;
}
