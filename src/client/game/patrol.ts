// Where a patrolling guard walks next. Wandering to random cells spreads
// guards thinly over the whole building, so encounters are rare and happen
// in corners the player has no reason to visit. Instead most legs of a
// patrol go to a beat point: outside a storage room (where the documents
// are), a server or terminal room, the stairs, or the exit lift. Those are
// the places the player has to go, so that's where guards should be. And
// there they stop and look around for a while, rather than walking straight
// on, so a doorway or the stairs is somewhere you have to time your way
// past. Pure, so it's unit-tested under Node.

/** How often a patrol leg heads for a beat point rather than anywhere at all. */
export const BEAT_CHANCE = 0.65;
/** A beat point this close (cells walked) doesn't count: it's where the guard already is. */
const MIN_BEAT_CELLS = 3;

/**
 * The beat point for the next leg, or null to wander anywhere. `dist` is
 * walking distance in cells from the guard (-1 unreachable); only beat
 * points it can reach, and isn't already standing at, are chosen.
 */
export function beatTarget(
  dist: number[][],
  beat: ReadonlyArray<{ x: number; y: number }>,
  rand: () => number = Math.random
): { x: number; y: number } | null {
  if (rand() >= BEAT_CHANCE) return null;
  const reachable = beat.filter((p) => (dist[p.y]?.[p.x] ?? -1) >= MIN_BEAT_CELLS);
  if (reachable.length === 0) return null;
  return reachable[Math.floor(rand() * reachable.length)]!;
}

/** At the end of an ordinary leg: a short pause, glancing side to side. */
export const LEG_PAUSE_S: readonly [number, number] = [1.2, 2.6];
export const LEG_LOOK = 0.7; // radians either side
/** At a beat point: a longer stop, looking right round the doorway or landing. */
export const BEAT_PAUSE_S: readonly [number, number] = [4, 6.5];
export const BEAT_LOOK = 1.3;

/** How long a guard stops at the end of a leg, and how far either side it looks while it's there. */
export function legPause(atBeat: boolean, rand: () => number = Math.random): { seconds: number; look: number } {
  const [lo, hi] = atBeat ? BEAT_PAUSE_S : LEG_PAUSE_S;
  return { seconds: lo + rand() * (hi - lo), look: atBeat ? BEAT_LOOK : LEG_LOOK };
}

/**
 * Lingering: some stops are beside a place the agent can hide (a staff locker, a crate pair, a sofa or desk to crawl under). The guard stops there with its back to the hiding
 * place, longer than at any beat, so a hider has a real chance to come out behind it and take it down in silence. When the agent is in hiding, the stop nearest to where they are is
 * the one a guard is most likely to pick.
 */
export type Linger = { x: number; y: number; facing: number };
/** How often a leg heads for a lingering stop (any, when one is in reach). */
export const LINGER_CHANCE = 0.3;
/** ... and when the agent is hiding within LINGER_NEAR cells of one. */
export const LINGER_CHANCE_HIDER = 0.7;
export const LINGER_NEAR = 8;
/** How long it stays, and how far either side of straight away from the hiding place it looks. */
export const LINGER_PAUSE_S: readonly [number, number] = [6, 9];
export const LINGER_LOOK = 0.3;
const MIN_LINGER_CELLS = 2;

/**
 * The lingering stop for the next leg, or null to carry on as usual. `dist` is walking distance in cells from the guard; `hider` is the cell the agent hides in, if they are hiding.
 */
export function lingerTarget(dist: number[][], spots: readonly Linger[], hider: { x: number; y: number } | null = null, rand: () => number = Math.random): Linger | null {
  const reachable = spots.filter((p) => (dist[p.y]?.[p.x] ?? -1) >= MIN_LINGER_CELLS);
  if (reachable.length === 0) return null;
  const near = hider ? reachable.filter((p) => Math.abs(p.x - hider.x) + Math.abs(p.y - hider.y) <= LINGER_NEAR) : [];
  if (near.length > 0) {
    if (rand() >= LINGER_CHANCE_HIDER) return null;
    // The one closest to the hider: that is where this guard stops.
    return near.reduce((a, b) => (Math.abs(a.x - hider!.x) + Math.abs(a.y - hider!.y) <= Math.abs(b.x - hider!.x) + Math.abs(b.y - hider!.y) ? a : b));
  }
  if (rand() >= LINGER_CHANCE) return null;
  return reachable[Math.floor(rand() * reachable.length)]!;
}

/** How long a guard lingers. */
export function lingerPause(rand: () => number = Math.random): number {
  return LINGER_PAUSE_S[0] + rand() * (LINGER_PAUSE_S[1] - LINGER_PAUSE_S[0]);
}

/**
 * A guard's glances while it stands looking round: not a pendulum, but a look to one side, a hold, a look to the other, each a different size and a different length, eased in and out.
 * Each guard has its own, so two guards standing side by side do not turn their heads together. Pure given `rand`.
 */
export class Glance {
  private from = 0;
  private to = 0;
  private t = 0;
  private dur = 1;
  private side = 1;

  constructor(rand: () => number = Math.random) {
    this.side = rand() < 0.5 ? -1 : 1;
    this.next(0.7, rand);
    this.t = rand() * this.dur;
  }

  private next(look: number, rand: () => number): void {
    this.from = this.to;
    this.side = -this.side;
    this.to = this.side * look * (0.35 + 0.65 * rand());
    this.dur = 0.9 + rand() * 1.6;
    this.t = 0;
  }

  /** The offset from where it was facing, in radians, `dt` seconds on, glancing up to `look` either side. */
  step(dt: number, look: number, rand: () => number = Math.random): number {
    this.t += dt;
    if (this.t >= this.dur) this.next(look, rand);
    const k = Math.min(1, this.t / this.dur);
    const e = k * k * (3 - 2 * k);
    return this.from + (this.to - this.from) * e;
  }
}
