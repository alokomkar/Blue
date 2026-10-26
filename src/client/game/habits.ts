// Counters to the player's habits (docs/GAMEPLAY.md, section 2). A tally per level of how the run is being won: stun shots from range, takedowns at one corner, the same hiding spot, the cloak, the
// same route walked over and over. When a tactic passes its threshold the guards answer with ONE counter, at most one every 60 to 90 seconds, and never twice for the same tactic in a level;
// each counter is announced on the radio so it is fair and readable. This is the rules only (thresholds, the cooldown, which counter is next); game.ts feeds the tallies and carries out the answers.
// Pure (no imports), so it is unit-tested under Node. One `Habits` per level: it starts empty, so the tally resets with the level.

export type Tactic = 'stun' | 'corner' | 'hide' | 'camo' | 'route';
export const TACTICS: readonly Tactic[] = ['stun', 'corner', 'hide', 'camo', 'route'];

/** How many times the tactic has to be used (in one place, for the places) before the guards answer. */
export const THRESHOLD: Record<Tactic, number> = { stun: 4, corner: 2, hide: 2, camo: 3, route: 5 };
/** Uses within this many metres of each other count as the same place (corner, hiding spot, lane). Stun and camo are not about a place. */
export const SAME_PLACE_M: Record<Tactic, number> = { stun: Infinity, corner: 6, hide: 2.5, camo: Infinity, route: 4.5 };
/** A stun shot from this far off counts as a stun "from range". */
export const STUN_RANGE_M = 4;
/** A lane counts as walked again only after the agent has been away from it this long (standing about in it is one pass). */
export const ROUTE_AWAY_S = 10;
/** Between two counters, a seeded draw in this range, in seconds. */
export const GAP_MIN_S = 60;
export const GAP_MAX_S = 90;

/** What the control room says as the counter goes out ("check the lockers"). */
export const ANNOUNCE: Record<Tactic, string> = {
  stun: 'CONTROL: VISORS ON · STUN SHOTS WILL NOT SLOW THEM',
  corner: 'CONTROL: DOUBLE UP ON THE CORNERS',
  hide: 'CONTROL: CHECK THE LOCKERS',
  camo: 'CONTROL: LIGHTS UP · SWEEP CLOSE',
  route: 'CONTROL: HOLD THE MAIN LANE',
};

export type Place = { x: number; z: number; floor: number };
export type Counter = { tactic: Tactic; at: Place | null; line: string };

type Cluster = Place & { n: number; inside: boolean; leftAt: number };

/** A number in [0, 1) from three integers: the same inputs always give the same draw (an integer hash). */
export function draw(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export class Habits {
  private readonly seed: number;
  private readonly clusters: Record<Tactic, Cluster[]> = { stun: [], corner: [], hide: [], camo: [], route: [] };
  private readonly counts: Record<'stun' | 'camo', number> = { stun: 0, camo: 0 };
  private readonly pending: Array<{ tactic: Tactic; at: Place | null }> = [];
  private readonly answered = new Set<Tactic>();
  private lastAt: number | null = null;
  private gap = 0;
  private fired = 0;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** The tactics already answered this level: each is answered once. */
  get done(): readonly Tactic[] {
    return [...this.answered];
  }

  /** The tally, for the debug hook and the tests: the biggest count per tactic. */
  tally(): Record<Tactic, number> {
    const top = (t: Tactic): number => this.clusters[t].reduce((m, c) => Math.max(m, c.n), 0);
    return { stun: this.counts.stun, camo: this.counts.camo, corner: top('corner'), hide: top('hide'), route: top('route') };
  }

  /** Tactics that have passed their threshold and are waiting their turn. */
  get waiting(): readonly Tactic[] {
    return this.pending.map((p) => p.tactic);
  }

  private cross(tactic: Tactic, at: Place | null): void {
    if (this.answered.has(tactic) || this.pending.some((p) => p.tactic === tactic)) return;
    this.pending.push({ tactic, at });
  }

  /** A stun shot that downed a guard from `distance` metres off: only the ones from range count. */
  noteStun(distance: number): void {
    if (distance < STUN_RANGE_M) return;
    if (++this.counts.stun >= THRESHOLD.stun) this.cross('stun', null);
  }

  /** The cloak switched on. */
  noteCamo(): void {
    if (++this.counts.camo >= THRESHOLD.camo) this.cross('camo', null);
  }

  /** A takedown from behind at `at` (the corner it was done at), or a hide in the spot at `at`: the same place twice is a habit. */
  notePlace(tactic: 'corner' | 'hide', at: Place): void {
    const list = this.clusters[tactic];
    let c = list.find((k) => k.floor === at.floor && Math.hypot(k.x - at.x, k.z - at.z) <= SAME_PLACE_M[tactic]);
    if (!c) {
      c = { ...at, n: 0, inside: false, leftAt: -Infinity };
      list.push(c);
    }
    if (++c.n >= THRESHOLD[tactic]) this.cross(tactic, { x: c.x, z: c.z, floor: c.floor });
  }

  /**
   * Where the agent is, every frame (null: off the ground, or not somewhere that counts, such as the arrival lift's doorstep). A lane is a patch of floor the agent keeps coming back to:
   * each return after ROUTE_AWAY_S away is a pass, and the lane that gets THRESHOLD.route passes is the busy one. `now` is the level's clock.
   */
  stepRoute(at: Place | null, now: number): void {
    const list = this.clusters.route;
    let inAny = false;
    for (const c of list) {
      const near = at !== null && c.floor === at.floor && Math.hypot(c.x - at.x, c.z - at.z) <= SAME_PLACE_M.route;
      if (near) {
        inAny = true;
        if (!c.inside) {
          c.inside = true;
          if (now - c.leftAt >= ROUTE_AWAY_S && ++c.n >= THRESHOLD.route) this.cross('route', { x: c.x, z: c.z, floor: c.floor });
        }
      } else if (c.inside) {
        c.inside = false;
        c.leftAt = now;
      }
    }
    // A patch of floor not in any lane yet starts one (its first pass).
    if (at && !inAny) list.push({ ...at, n: 1, inside: true, leftAt: -Infinity });
  }

  /**
   * The counter to send now, or null: one that has passed its threshold, has not been answered this level, the cooldown since the last one is over, and `carryOut` did it (it is called with the
   * tactic and the place, and says whether the guards could do it: a guard sent, a spot flagged). One that could not be carried out stays waiting, and costs nothing: the cooldown starts when a counter
   * goes out, and then the next waits 60 to 90 seconds. A counter that is sent is used up: it is not sent again this level.
   */
  due(now: number, carryOut: (tactic: Tactic, at: Place | null) => boolean = () => true): Counter | null {
    if (this.lastAt !== null && now - this.lastAt < this.gap) return null;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i]!;
      if (!carryOut(p.tactic, p.at)) continue;
      this.pending.splice(i, 1);
      this.answered.add(p.tactic);
      this.lastAt = now;
      this.gap = GAP_MIN_S + draw(this.seed, this.fired++, 77) * (GAP_MAX_S - GAP_MIN_S);
      return { tactic: p.tactic, at: p.at, line: ANNOUNCE[p.tactic] };
    }
    return null;
  }
}
