// Putting a body away: what it will fit in, and the steps it takes. Sizes are metres and come from the
// models: a guard (bots.ts: the male Universal Base Character, stood to BODY_LENGTH) is 1.83 m head to toe and about half
// a metre across the shoulders; a heavy is the same model scaled up. A staff locker (stealthprops.ts) is 0.64 × 0.55 inside and 1.96 tall, so a body
// fits it standing; a single 0.9 m crate is far too short, so crates are long ones, 1.9 m, in pairs that slide apart over a
// bay a body lies in; a vent grille is a 0.56 m tall slot and the body goes in feet first. Pure, tested.

export const BODY_LENGTH = 1.83;
export const BODY_WIDTH = 0.5;

export type Container = 'locker' | 'crates' | 'vent';

/** What a container offers a body: how long a body it takes (the way it lies in it) and how wide. */
export const ROOM: Record<Container, { length: number; width: number }> = {
  locker: { length: 1.96, width: 0.55 },
  crates: { length: 1.9, width: 0.8 },
  vent: { length: Infinity, width: 0.56 },
};

/** How much bigger than the standard guard a body is (1 for a guard, the heavy's scale for a heavy). */
export function fits(container: Container, scale: number): boolean {
  const room = ROOM[container];
  return BODY_LENGTH * scale <= room.length && BODY_WIDTH * scale <= room.width;
}

/** The first container in `options` the body fits, or null. */
export function firstThatFits(options: Container[], scale: number): Container | null {
  return options.find((c) => fits(c, scale)) ?? null;
}

/** When each step of putting a body away happens (seconds into it), and when it's all done. */
export type Timeline = { open: number; load: number; seal: number; done: number };

export const TIMELINE: Record<Container, Timeline> = {
  // Key in the lock, the door swings open, the body goes in, the door shuts.
  locker: { open: 0.5, load: 1.2, seal: 1.5, done: 2.1 },
  // The crates slide apart, the body is laid in the bay between them, they slide back together over it.
  crates: { open: 0.1, load: 1.0, seal: 1.4, done: 2.3 },
  // The grille is lifted off, the body is pushed in feet first, the grille goes back on.
  vent: { open: 0.4, load: 1.1, seal: 2.1, done: 2.7 },
};

/** 0 → 1 across [from, to] of `t`, eased. */
export function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** How open a container is at `t`: opening from `open` for `swing` seconds, closing again from `seal`. */
export function openness(c: Container, t: number, swing = 0.5): number {
  const tl = TIMELINE[c];
  return ramp(t, tl.open, tl.open + swing) * (1 - ramp(t, tl.seal, tl.seal + swing));
}
