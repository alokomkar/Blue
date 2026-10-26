// A guard can't get at a player who is up out of reach (on a tower's platform, the pipes, a grapple line). If it could see them,
// it used to walk straight to the spot beneath them and stand there for good, as if waiting for a drop. Now it holds back at a
// stand-off, looking up. Pure, so it's unit-tested under Node.

/** How far (world units) from a player above its reach a guard stops: well short of underneath, still inside its firing range. */
export const STANDOFF_R = 5;

/** Whether a guard heading for (targetX, targetZ) has come close enough to stop there: only when the player is out of reach. */
export function holdsBack(unreachable: boolean, botX: number, botZ: number, targetX: number, targetZ: number): boolean {
  return unreachable && Math.hypot(targetX - botX, targetZ - botZ) <= STANDOFF_R;
}

// ---- the firing distance: a guard that has seen the agent comes into range and shoots from there, instead of closing until it is on top of them ----

/** Where a guard that is fighting holds, in world units: nearer than `min` it backs off, farther than `max` it comes on, between them it stands and shoots. All inside a guard's firing range (8). */
export type HoldRange = { min: number; max: number };
export const HOLD_RANGE = {
  guard: { min: 4.6, max: 7.2 },
  hunter: { min: 3.8, max: 6.2 },
  heavy: { min: 4.2, max: 6.6 },
  white: { min: 5, max: 7.4 },
} as const satisfies Record<string, HoldRange>;

export type RangeStep = 'close' | 'hold' | 'back';

/** What a guard `d` from the agent does: come on (too far to shoot), stand and shoot (in the band), or back off (too near; only when it can see them). */
export function rangeStep(d: number, range: HoldRange, seen: boolean): RangeStep {
  if (d > range.max) return 'close';
  if (d < range.min && seen) return 'back';
  return 'hold';
}

/** The spot a guard backs off to: on the line from the agent through it, `range.min + 1.2` out from them. */
export function backOffSpot(agent: { x: number; z: number }, guard: { x: number; z: number }, range: HoldRange): { x: number; z: number } {
  const dx = guard.x - agent.x;
  const dz = guard.z - agent.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = range.min + 1.2;
  return { x: agent.x + (dx / d) * out, z: agent.z + (dz / d) * out };
}

// ---- different angles: guards in a fight do not all come at the agent along the same line ----

/** How far apart (radians) two attackers' bearings from the agent must be: 30 degrees, with a little margin. */
export const MIN_ATTACK_ARC = (32 * Math.PI) / 180;

/** The smallest angle between two bearings, 0 to PI. */
export function bearingApart(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Bearing from `from` to `to` (radians; 0 is +z). */
export const bearingTo = (from: { x: number; z: number }, to: { x: number; z: number }): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * The bearing round the agent a guard should attack from: its own (`mine`, where it is now) when no other attacker is within `minApart` of it, otherwise the nearest one to it, either
 * way round, that is at least `minApart` from every other attacker's. With no such gap anywhere (more attackers than the circle holds), its own.
 */
export function pickBearing(mine: number, others: readonly number[], minApart: number = MIN_ATTACK_ARC): number {
  const free = (b: number): boolean => others.every((o) => bearingApart(b, o) >= minApart);
  if (free(mine)) return mine;
  const step = (5 * Math.PI) / 180;
  for (let k = 1; k * step <= Math.PI; k++) {
    // (the side with the nearer gap first, so a guard goes round the short way)
    const a = mine + k * step;
    const b = mine - k * step;
    const nearA = others.reduce((m, o) => Math.min(m, bearingApart(a, o)), Infinity);
    const nearB = others.reduce((m, o) => Math.min(m, bearingApart(b, o)), Infinity);
    const first = nearA >= nearB ? a : b;
    const second = first === a ? b : a;
    if (free(first)) return first;
    if (free(second)) return second;
  }
  return mine;
}
