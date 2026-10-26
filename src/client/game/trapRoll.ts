// Where a rolled trap comes to rest. The player rolls a remote trap along the
// floor ahead of them instead of setting it at their feet, so they can put
// one where the guards and dogs will be without walking up to them (a
// watchdog hears you coming). It rolls up to ROLL_DISTANCE, stops short of
// the first wall or furniture in the way, and settles into a "slot" it
// passes close by on the way: a watchdog pack's meeting point, or the spot a
// sentry holds. Pure (type-only imports), so it's unit-tested under Node.

/** How far a trap rolls on open floor (world units: two cells). */
export const ROLL_DISTANCE = 8;
/** It stops this far short of what it would hit. */
export const ROLL_WALL_MARGIN = 0.35;
/** A slot this far either side of its line catches it. */
const SLOT_CATCH = 1.3;
/** Nearer than this, a slot is under your feet rather than ahead: the roll goes on past it. */
const SLOT_MIN_AHEAD = 0.8;

export type RollStop = { x: number; z: number; slot: 'pack' | 'sentry' | null };

/**
 * Where a trap rolled from (x, z) toward `facing` (0 = +Z) comes to rest.
 * `clear`: how far ahead the way is clear before the first wall or
 * furniture (detection.ts's rayToBoxes, out to ROLL_DISTANCE + ROLL_WALL_MARGIN).
 */
export function rollStop(x: number, z: number, facing: number, clear: number, slots: ReadonlyArray<{ x: number; z: number; kind: 'pack' | 'sentry' }>): RollStop {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const reach = Math.max(0, Math.min(ROLL_DISTANCE, clear - ROLL_WALL_MARGIN));
  let best: { t: number; kind: 'pack' | 'sentry' } | null = null;
  for (const s of slots) {
    const t = (s.x - x) * dx + (s.z - z) * dz;
    const side = Math.abs((s.x - x) * dz - (s.z - z) * dx);
    if (t < SLOT_MIN_AHEAD || t > reach + 0.3 || side > SLOT_CATCH) continue;
    if (!best || t < best.t) best = { t, kind: s.kind };
  }
  // A slot catches it on its line, level with the slot: never off to the side, where a wall could be.
  const t = best ? Math.min(best.t, reach) : reach;
  return { x: x + dx * t, z: z + dz * t, slot: best?.kind ?? null };
}
