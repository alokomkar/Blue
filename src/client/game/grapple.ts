// The grapple: a hook to the pipes overhead and a haul up the line, hand over hand. It runs on the agent's own
// strength, which the hang eats away (more when shimmying) and which comes back on the floor, and quicker on a
// tower's platform. Out of strength, the grip opens: the agent falls, and a fall like that is loud. Here: the
// numbers and the rules; game.ts does the hauling, the hanging and the falling. Pure, so it's unit-tested under Node.

/** How far a grapple reaches from the agent to a pipe overhead, in metres of floor. */
export const HOOK_RANGE = 9;
/** How long the haul up the line takes. */
export const HAUL_S = 1.1;
/** What the haul itself costs the arms (of a full 1). */
export const HAUL_COST = 0.12;
/** The least strength left to fire a grapple with. */
export const MIN_TO_HOOK = 0.35;
/** Seconds a full grip lasts hanging still, and shimmying. */
export const HOLD_S = 20;
export const SHIMMY_HOLD_S = 15;
/** Seconds a full grip lasts hovering on the line, lowered to just above the floor (the arms take all the weight, and you're working). */
export const HOVER_S = 16;
/** How high the feet hover when lowered, in metres above the floor, and how fast the line pays out, m/s. */
export const HOVER_HEIGHT = 0.9;
export const LOWER_SPEED = 2.4;
/** Seconds to get all of it back on the floor, and on a tower's platform. */
export const REGAIN_FLOOR_S = 14;
export const REGAIN_PERCH_S = 4;
/** Below this the arms are shaking (and the sweat is about to fall). */
export const TIRED = 0.3;
/** Suspicion a fall from exhaustion costs: the thud is heard by everyone near. */
export const HARD_LAND_SUSPICION = 20;

export type Effort = 'ground' | 'perch' | 'hold' | 'shimmy' | 'hover';

/** Strength (0 to 1) `dt` seconds on. */
export function stepStrength(strength: number, effort: Effort, dt: number): number {
  const rate = { ground: 1 / REGAIN_FLOOR_S, perch: 1 / REGAIN_PERCH_S, hold: -1 / HOLD_S, shimmy: -1 / SHIMMY_HOLD_S, hover: -1 / HOVER_S }[effort];
  return Math.min(1, Math.max(0, strength + rate * dt));
}

/** What the strength meter shows: how full, and whether it's a warning. */
export function strainState(strength: number): 'fresh' | 'tired' | 'spent' {
  return strength <= 0.001 ? 'spent' : strength < TIRED ? 'tired' : 'fresh';
}

/** What the grip meter shows, or null when it should be gone: up only while the agent is hanging or hauling on the line, and gone the moment they let go (the arms recover out of sight). */
export type StrainView = { fill: number; state: 'fresh' | 'tired' | 'spent' };

export function strainView(strength: number, hanging: boolean): StrainView | null {
  return hanging ? { fill: strength, state: strainState(strength) } : null;
}

/** Whether the HUD needs telling about a new view: it has appeared or gone, or the fill moved enough to see, or the warning changed. */
export function strainChanged(shown: StrainView | null, next: StrainView | null, step = 0.004): boolean {
  if ((shown === null) !== (next === null)) return true;
  if (!shown || !next) return false;
  return Math.abs(shown.fill - next.fill) > step || shown.state !== next.state;
}

// ---- hovering over a console ----
// Lowered on the line the agent hangs flat over a console, hands down on it, but only where there is one to work: a terminal to hack, a workstation, the uplink or the log server.
// Anywhere else the hover stays upright, as it always was (to drop on a guard). Pipes run along cell centres, so a console is never more than half a cell from one that
// passes over its cell; the agent swings in on the cable the rest of the way, to hang right over it, turned to face it.

/** How far from the line's own point a console can be, and still be swung to (metres): half a cell and some, so a pipe over a console's cell always reaches it. */
export const HOVER_SWING_M = 2.4;

/** When flat, the hands are this far ahead of the hips (the shoulders are), so the hips hang this far short of the console. */
export const HOVER_HIPS_BACK = 0.5;

/** A console to work: the spot the agent stands at, and (when known) which way they face there, toward the console. */
export type Spot = { x: number; z: number; facing?: number };

/** The nearest of `targets` to `from` within `max` metres, or null: nothing there to work, so no flat hover. */
export function nearestTarget(from: Spot, targets: readonly Spot[], max = HOVER_SWING_M): (Spot & { d: number }) | null {
  let best: (Spot & { d: number }) | null = null;
  for (const t of targets) {
    const d = Math.hypot(t.x - from.x, t.z - from.z);
    if (d <= max && (!best || d < best.d)) best = { x: t.x, z: t.z, ...(t.facing !== undefined ? { facing: t.facing } : {}), d };
  }
  return best;
}

/** The hands go this far from the standing spot toward the console (about where the standing agent's hands rest on it). */
export const HOVER_HANDS_IN = 0.45;

/**
 * Where the hips should hang, and which way to face, for the hands to be over the console at `target` (a standing spot): facing the way the standing agent would, toward
 * the console, head leading, so the agent lies along that line the way a person would stand to it. `grip` is the line's own point and `lineAngle` its facing, used only
 * when the console's own facing isn't known (0 faces +z).
 */
export function hoverPose(grip: Spot, target: Spot, lineAngle: number): { x: number; z: number; angle: number } {
  const dx = target.x - grip.x;
  const dz = target.z - grip.z;
  const angle = target.facing ?? (Math.hypot(dx, dz) >= 0.25 ? Math.atan2(dx, dz) : lineAngle);
  const reach = HOVER_HANDS_IN - HOVER_HIPS_BACK;
  return { x: target.x + Math.sin(angle) * reach, z: target.z + Math.cos(angle) * reach, angle };
}
