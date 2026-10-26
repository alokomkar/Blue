// Radio check-ins (docs/GAMEPLAY.md, section 1). Every patrol and sentry guard on the agent's floor reports in to the control room every 30 to 45 seconds, and the report shows as a short line
// on the HUD ("CH 3: clear"). A guard that is down, carried off or put away stops reporting: at the first missed check-in the control room sends the two nearest guards to where it was last
// known, and at the second the floor's alert goes up a step. A blackout (a dark cell) or an EMP discharge silences the radio for as long as it lasts: a guard in a dead zone is not heard and not
// missed, and with the whole floor jammed the check-in clock does not run at all.
// Pure (no imports), so it is unit-tested under Node; game.ts feeds it the floor's guards each frame and does what it says (the dispatch, the alert, the feed).

/** Seconds between one check-in and the next, per guard: a seeded draw in this range. */
export const CHECK_MIN_S = 30;
export const CHECK_MAX_S = 45;
/** The first check-in of a guard falls anywhere in this range (so a floor's guards do not speak together, and a silent takedown always has a clock on it). */
export const FIRST_MIN_S = 8;
export const FIRST_MAX_S = CHECK_MAX_S;
/** A guard in a dead zone (a blackout) is asked again this much later; nothing is counted against it. */
export const DEAD_ZONE_RETRY_S = 3;
/** Two nearest guards answer the first miss. */
export const DISPATCH_N = 2;
/** The misses it takes to raise the alert; a guard that has missed this many is not asked after again. */
export const ALERT_AT_MISS = 2;

export type RadioGuard = {
  /** Stable for the guard's life on the floor. */
  id: number;
  x: number;
  z: number;
  /** Alive, standing, and still on its feet where it can speak: not down, not stashed, not carried off. */
  active: boolean;
  /** In a blackout cell: its radio is dead for as long as it stays there. */
  deadZone: boolean;
  sentry: boolean;
  /** A patrol that is free to go and look (not in a chase, not a sentry on its post): who the control room may send. */
  canDispatch: boolean;
  /** The body has been found by a guard: the control room already knows, so there is nothing left to miss. */
  known: boolean;
};

export type RadioEvent =
  | { type: 'report'; id: number; channel: number; line: string }
  | { type: 'miss'; id: number; channel: number; n: number; at: { x: number; z: number }; candidates: number[]; line: string }
  | { type: 'jam'; line: string }
  | { type: 'restored'; line: string };

type Slot = { id: number; channel: number; due: number; last: { x: number; z: number }; misses: number; sent: number; retired: boolean };

/** A number in [0, 1) from three integers: the same inputs always give the same draw (an integer hash), so the jitter belongs to the seed and not to the order things happen in. */
export function unit(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export const REPORT_LINES = ['clear', 'all quiet', 'nothing to report', 'holding', 'sector clear', 'no movement'] as const;
export const SENTRY_LINES = ['post clear', 'eyes on the hall', 'holding post', 'post quiet'] as const;

/** The check-in a guard makes: "CH 3: clear". Which words is the seed's. */
export function reportLine(seed: number, channel: number, nth: number, sentry: boolean): string {
  const words = sentry ? SENTRY_LINES : REPORT_LINES;
  return `CH ${channel}: ${words[Math.floor(unit(seed, channel, 1000 + nth) * words.length)]}`;
}

/** The control room's line at a miss: the first sends units, the second raises the floor. `escalation` is what "a step up" is on this level (the alert rung, or every unit converging). */
export function missLine(channel: number, n: number, sent: number, escalation: string): string {
  if (n < ALERT_AT_MISS) return sent > 0 ? `CH ${channel}: NO ANSWER · ${sent} UNIT${sent === 1 ? '' : 'S'} SENT` : `CH ${channel}: NO ANSWER`;
  return `CH ${channel}: STILL SILENT · ${escalation}`;
}

export const JAM_LINE = 'RADIO: STATIC · NO CHECK-INS';
export const RESTORED_LINE = 'RADIO: BACK UP';

/** The nearest guards that may be sent to (x, z): by straight distance, ties by id; never the guard itself or one that cannot go. */
export function pickDispatch(guards: readonly RadioGuard[], at: { x: number; z: number }, exclude: number): number[] {
  return guards
    .filter((g) => g.active && g.canDispatch && g.id !== exclude)
    .map((g) => ({ id: g.id, d: Math.hypot(g.x - at.x, g.z - at.z) }))
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .map((g) => g.id);
}

export class Radio {
  private clock = 0;
  private readonly slots = new Map<number, Slot>();
  private nextChannel = 1;
  private jammed = false;

  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Seconds of radio time that have run (the clock stops while the floor is jammed). */
  get time(): number {
    return this.clock;
  }

  /** The channel a guard reports on, once it has been heard of. */
  channelOf(id: number): number | null {
    return this.slots.get(id)?.channel ?? null;
  }

  /** When a guard's next check-in is due, in radio time (null: not heard of, or no longer asked after). For tests and the debug hook. */
  dueOf(id: number): number | null {
    const s = this.slots.get(id);
    return s && !s.retired ? s.due : null;
  }

  private interval(id: number, k: number): number {
    return CHECK_MIN_S + unit(this.seed, id, k) * (CHECK_MAX_S - CHECK_MIN_S);
  }

  /**
   * One frame: `dt` seconds on the agent's floor, the floor's guards, and whether the whole floor's radio is jammed (an EMP discharge). Returns what was said and done, in order.
   * A guard is registered the first time it is seen, with its first check-in already drawn. `escalation` is the second miss's wording on this level.
   */
  step(dt: number, guards: readonly RadioGuard[], jammed: boolean, escalation = 'ALERT RAISED'): RadioEvent[] {
    const out: RadioEvent[] = [];
    if (jammed !== this.jammed) {
      this.jammed = jammed;
      out.push(jammed ? { type: 'jam', line: JAM_LINE } : { type: 'restored', line: RESTORED_LINE });
    }
    // Where each guard last was while it could still speak: where the control room sends people if it goes quiet.
    for (const g of guards) {
      let s = this.slots.get(g.id);
      if (!s) {
        s = { id: g.id, channel: this.nextChannel++, due: this.clock + FIRST_MIN_S + unit(this.seed, g.id, 0) * (FIRST_MAX_S - FIRST_MIN_S), last: { x: g.x, z: g.z }, misses: 0, sent: 0, retired: false };
        this.slots.set(g.id, s);
      }
      if (g.active && !s.retired) s.last = { x: g.x, z: g.z };
    }
    if (jammed) return out;
    this.clock += dt;
    for (const g of guards) {
      const s = this.slots.get(g.id)!;
      if (s.retired || this.clock < s.due) continue;
      if (g.deadZone) {
        s.due = this.clock + DEAD_ZONE_RETRY_S;
        continue;
      }
      if (g.active) {
        s.sent++;
        out.push({ type: 'report', id: g.id, channel: s.channel, line: reportLine(this.seed, s.channel, s.sent, g.sentry) });
        s.misses = 0;
        s.due = this.clock + this.interval(g.id, s.sent);
        continue;
      }
      if (g.known) {
        s.retired = true;
        continue;
      }
      s.misses++;
      const candidates = s.misses < ALERT_AT_MISS ? pickDispatch(guards, s.last, g.id) : [];
      out.push({ type: 'miss', id: g.id, channel: s.channel, n: s.misses, at: { ...s.last }, candidates, line: missLine(s.channel, s.misses, Math.min(DISPATCH_N, candidates.length), escalation) });
      if (s.misses >= ALERT_AT_MISS) s.retired = true;
      else s.due = this.clock + this.interval(g.id, 500 + s.misses);
    }
    return out;
  }
}
