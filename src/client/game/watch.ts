// The control room's side of the floor (docs/GAMEPLAY.md, sections 1 and 2): the glue between the rules (radio.ts: check-ins and misses; habits.ts: the counters to what the player keeps doing) and the
// game. Every frame it hands the agent's floor's guards to the radio and does what comes back (a line on the feed, two guards sent to a silent guard's last place, the alert up a step); it keeps the
// tally of how the run is being won, and when a tactic has been leaned on too often it carries out the one answer it is allowed: a reused hiding place is opened as guards pass, a corner used for
// takedowns gets a pair, a busy lane gets a guard waiting on it, the cloak draws a close light sweep. It uses only what a guard already can do (investigate, alertTo, setBeat, stopInvestigating).
// game.ts builds one per level (so everything starts clean) and calls the few notes below from the places the player's own actions happen: the partner's never count towards the habits.

import { Bot } from './bots';
import type { MazeCells } from './maze';
import { Habits, type Place, type Tactic } from './habits';
import { Radio, missLine, type RadioEvent, type RadioGuard } from './radio';
import { pushRadio } from './radiofeed';

/** An EMP discharge on a floor silences its radio for this long. */
export const EMP_JAM_S = 20;
/** How far a guard must come to a flagged hiding place to open it, how often it can be opened, and how long a guard sent to a corner or a lane stays there. */
export const OPEN_REACH_M = 1.8;
export const OPEN_EVERY_S = 15;
export const HOLD_CORNER_S = 40;
export const HOLD_LANE_S = 45;
/** After the cloak has drawn its counter, a guard this close with a clear look breaks it, for this long. */
export const SWEEP_WINDOW_S = 60;
export const SWEEP_REACH_M = 3.2;
/** How often the counters and their standing effects are looked at, in seconds. */
const LOOK_EVERY_S = 0.25;
/** When no guard could carry a counter out, the next try is this many seconds on. */
const RETRY_S = 4;
/** The cell size, in metres (scene.ts's CELL). */
const CELL_M = 4;

export type WatchFloor = {
  enemies: readonly unknown[];
  nav: MazeCells;
  cols: number;
  rows: number;
  origin: { x: number; z: number };
  /** Blackout cells, and cells whose breaker is cut now: a guard standing in one has a dead radio. */
  dark: readonly (readonly boolean[])[];
  powerCut: readonly (readonly boolean[])[];
};

export type WatchHost = {
  /** The level's seed: the radio's jitter and the counters' gaps are drawn from it. */
  seed: number;
  /** Off in training, the exit level and anywhere else the radio has no place. */
  enabled: boolean;
  floorCount(): number;
  floor(i: number): WatchFloor;
  activeFloor(): number;
  /** The agent is standing on their floor (not half way up a stair). */
  onFloor(): boolean;
  player(): { x: number; z: number };
  /** The level's clock, in seconds (it stops when the game is paused). */
  now(): number;
  /** A guard found this body: the control room knows already. */
  bodyFound(b: Bot): boolean;
  /** The second missed check-in: raise the floor a step if the level has a rung to raise (returns the words for the feed), or say 'ALL UNITS CONVERGE' for the guards to go to the place. */
  escalate(): string;
  /** Where the agent is hiding (in a locker, behind crates, under furniture), or null. */
  hiding(): Place | null;
  /** The agent stands at the open end of a wall: a corner. */
  nearCorner(): boolean;
  /** Where the agent is, for the lane count; null off the ground, in a lift, or near where every run starts. */
  lane(): Place | null;
  /** A guard opens the locker or crate at this place: the door, the sound. */
  openSpot(place: Place): void;
  /** The agent was in it: out they come, and it costs. */
  exposeHider(): void;
  camoActive(): boolean;
  breakCamo(): void;
  /** The guard has a clear look at the agent. */
  canSee(b: Bot): boolean;
};

export type WatchLogEntry = { t: number; floor: number; kind: string; text: string };

export class Watch {
  private readonly host: WatchHost;
  private readonly habits: Habits;
  private readonly radios = new Map<number, Radio>();
  private readonly ids = new WeakMap<Bot, number>();
  private nextId = 1;
  private readonly empJam = new Map<number, number>();
  private readonly openSpots: Array<Place & { lastOpen: number; told?: boolean }> = [];
  private sweepUntil = -Infinity;
  private hideDwell = 0;
  private hideCounted = false;
  private look = 0;
  private retryAt = -Infinity;
  private tried = false;
  /** What was said and done, in order (a debug and test aid). */
  readonly log: WatchLogEntry[] = [];

  constructor(host: WatchHost) {
    this.host = host;
    this.habits = new Habits(host.seed);
  }

  /** The habit tally, what is waiting and what has been answered (a debug and test aid). */
  habitState(): { tally: Record<Tactic, number>; waiting: readonly Tactic[]; done: readonly Tactic[]; openSpots: number; sweeping: boolean } {
    return { tally: this.habits.tally(), waiting: this.habits.waiting, done: this.habits.done, openSpots: this.openSpots.length, sweeping: this.host.now() < this.sweepUntil };
  }

  /** The channel a guard reports on, once the radio has heard of it (a debug and test aid). */
  channelOf(b: Bot): number | null {
    const id = this.ids.get(b);
    if (id === undefined) return null;
    for (const r of this.radios.values()) {
      const c = r.channelOf(id);
      if (c !== null) return c;
    }
    return null;
  }

  /** The radio of a floor, once it has been on (a debug and test aid). */
  radioOf(floor: number): Radio | undefined {
    return this.radios.get(floor);
  }

  private say(floor: number, kind: string, text: string, feed: Parameters<typeof pushRadio>[1]): void {
    this.log.push({ t: +this.host.now().toFixed(2), floor, kind, text });
    if (this.log.length > 400) this.log.shift();
    pushRadio(text, feed);
  }

  // ---- what the player does (their own actions only) ----

  /** A stun shot downed a guard `distance` metres off. */
  noteStun(distance: number): void {
    if (this.host.enabled) this.habits.noteStun(distance);
  }

  /** A takedown from behind just now, at the agent's feet: it counts when it was done at a corner. */
  noteTakedown(): void {
    if (!this.host.enabled || !this.host.nearCorner()) return;
    const p = this.host.player();
    this.habits.notePlace('corner', { x: p.x, z: p.z, floor: this.host.activeFloor() });
  }

  /** The cloak went on. */
  noteCamo(): void {
    if (this.host.enabled) this.habits.noteCamo();
  }

  /** A blast or a pulse on `floor` knocked out electronics: the radio there is down for a while. */
  empDischarge(floor: number): void {
    if (!this.host.enabled) return;
    this.empJam.set(floor, this.host.now() + EMP_JAM_S);
  }

  // ---- every frame ----

  /** Which guards the radio hears on a floor: patrols and sentries (not hunters, heavies, dogs or drones). */
  private guardsOf(f: WatchFloor): { list: RadioGuard[]; bots: Map<number, Bot> } {
    const list: RadioGuard[] = [];
    const bots = new Map<number, Bot>();
    for (const e of f.enemies) {
      if (!(e instanceof Bot) || (e.kind !== 'patrol' && e.kind !== 'sentry')) continue;
      let id = this.ids.get(e);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(e, id);
      }
      const cx = Math.round((e.worldX - f.origin.x) / CELL_M);
      const cy = Math.round((e.worldZ - f.origin.z) / CELL_M);
      list.push({
        id,
        x: e.worldX,
        z: e.worldZ,
        active: !e.disabled,
        deadZone: f.dark[cy]?.[cx] === true || f.powerCut[cy]?.[cx] === true,
        sentry: e.isSentry,
        canDispatch: this.free(e),
        known: e.disabled && this.host.bodyFound(e),
      });
      bots.set(id, e);
    }
    return { list, bots };
  }

  /** A patrol that is free to be sent: up, on its feet, not in a fight, not on a post, not up on the container roofs. */
  private free(b: Bot): boolean {
    return !b.disabled && !b.stashed && !b.alert && !b.dazed && b.kind === 'patrol' && !b.isSentry && !b.onRoofLayer;
  }

  private freePatrols(f: WatchFloor, near: { x: number; z: number }): Bot[] {
    return f.enemies
      .filter((e): e is Bot => e instanceof Bot && this.free(e))
      .sort((a, b) => Math.hypot(a.worldX - near.x, a.worldZ - near.z) - Math.hypot(b.worldX - near.x, b.worldZ - near.z));
  }

  /**
   * Sends the guards in `order` (up to `n`) to look at (x, z) for `seconds`; how many took it up. Where nobody can walk to the very spot (a body lying on a container's roof, a place behind a
   * shut door) they are sent to the nearest place they can: a ring of spots round it, a cell out and then two.
   */
  private dispatch(f: WatchFloor, order: readonly Bot[], at: { x: number; z: number }, n: number, seconds: number): Bot[] {
    const sent: Bot[] = [];
    const rings: Array<{ x: number; z: number }> = [at];
    for (const r of [CELL_M, 2 * CELL_M]) for (let k = 0; k < 8; k++) rings.push({ x: at.x + Math.cos((k * Math.PI) / 4) * r, z: at.z + Math.sin((k * Math.PI) / 4) * r });
    for (const b of order) {
      if (sent.length >= n) break;
      if (rings.some((spot) => b.investigate(spot.x, spot.z, seconds, f.nav, f.cols, f.rows, 999))) sent.push(b);
    }
    return sent;
  }

  /** Sends the nearest free patrols (up to `n`) to look at (x, z) for `seconds`. */
  private send(f: WatchFloor, at: { x: number; z: number }, n: number, seconds: number): Bot[] {
    return this.dispatch(f, this.freePatrols(f, at), at, n, seconds);
  }

  tick(dt: number): void {
    const h = this.host;
    if (!h.enabled || !h.onFloor()) return;
    const fi = h.activeFloor();
    if (fi < 0 || fi >= h.floorCount()) return;
    const f = h.floor(fi);
    const now = h.now();

    // The radio.
    let radio = this.radios.get(fi);
    if (!radio) {
      radio = new Radio((h.seed ^ Math.imul(fi + 1, 0x9e3779b1)) >>> 0);
      this.radios.set(fi, radio);
    }
    const { list, bots } = this.guardsOf(f);
    const jammed = now < (this.empJam.get(fi) ?? -Infinity);
    for (const e of radio.step(dt, list, jammed, 'ESCALATE')) this.heard(fi, f, e, bots);

    // The habits: the lane the agent keeps walking, the place they keep hiding in.
    this.habits.stepRoute(h.lane(), now);
    const hid = h.hiding();
    if (hid) {
      this.hideDwell += dt;
      if (!this.hideCounted && this.hideDwell >= 1.5) {
        this.hideCounted = true;
        this.habits.notePlace('hide', hid);
      }
    } else {
      this.hideDwell = 0;
      this.hideCounted = false;
    }

    this.look += dt;
    if (this.look < LOOK_EVERY_S) return;
    this.look = 0;
    if (now >= this.retryAt) {
      this.tried = false;
      const counter = this.habits.due(now, (t, at) => this.carryOut(f, fi, t, at, now));
      if (counter) this.say(fi, 'counter', counter.line, 'counter');
      else if (this.tried) this.retryAt = now + RETRY_S; // (nobody could do it just now: try again in a few seconds, not every frame)
    }
    this.standing(f, fi, now);
  }

  private heard(fi: number, f: WatchFloor, e: RadioEvent, bots: Map<number, Bot>): void {
    if (e.type === 'report') {
      this.say(fi, 'report', e.line, 'routine');
    } else if (e.type === 'jam' || e.type === 'restored') {
      this.say(fi, e.type, e.line, 'static');
    } else if (e.n < 2) {
      // The first miss: the two nearest guards go to where it was last known.
      const order = e.candidates.map((id) => bots.get(id)).filter((b): b is Bot => b !== undefined && this.free(b));
      const sent = this.dispatch(f, order, e.at, 2, 10).length;
      this.say(fi, 'miss1', missLine(e.channel, 1, sent, ''), 'miss');
    } else {
      // The second: the floor goes up a step (or, where there is no rung to climb, everyone comes).
      const words = this.host.escalate();
      if (words === 'ALL UNITS CONVERGE') this.send(f, e.at, 99, 12);
      this.say(fi, 'miss2', missLine(e.channel, 2, 0, words), 'alert');
    }
  }

  /** Does the guards' answer to a tactic, and says whether it could be done: nobody to send is a no. */
  private carryOut(f: WatchFloor, fi: number, tactic: Tactic, at: Place | null, now: number): boolean {
    if (tactic === 'stun') return false; // (no existing guard behaviour for "visors": see the report)
    if (at && at.floor !== fi) return false;
    const p = this.host.player();
    this.tried = true;
    if (tactic === 'hide' && at) {
      // (The place stays flagged: a guard that comes by opens it. One is sent now, too, if there is one that can walk there.)
      this.openSpots.push({ ...at, lastOpen: -Infinity });
      this.send(f, at, 1, 8);
      return true;
    }
    if (tactic === 'corner' && at) {
      const pair = this.send(f, at, 2, HOLD_CORNER_S);
      // (A patrol on a beat now has the corner as one of its stops, too.)
      const cell = { x: Math.round((at.x - f.origin.x) / CELL_M), y: Math.round((at.z - f.origin.z) / CELL_M) };
      for (const b of pair) {
        const beat = b.getBeat();
        if (beat.length > 0) b.setBeat([...beat, cell]);
      }
      return pair.length > 0;
    }
    if (tactic === 'route' && at) return this.send(f, at, 1, HOLD_LANE_S).length > 0;
    if (tactic === 'camo') {
      this.sweepUntil = now + SWEEP_WINDOW_S;
      this.send(f, p, 1, 10);
      return this.freePatrols(f, p).length > 0;
    }
    return false;
  }

  /** What stays in force after a counter: flagged hiding places are opened by guards that come by, and for a while a guard close by with a clear look breaks the cloak. */
  private standing(f: WatchFloor, fi: number, now: number): void {
    const h = this.host;
    const p = h.player();
    if (this.openSpots.length > 0) {
      for (const spot of this.openSpots) {
        if (spot.floor !== fi || now - spot.lastOpen < OPEN_EVERY_S) continue;
        const guard = f.enemies.find((e): e is Bot => e instanceof Bot && this.free(e) && Math.hypot(e.worldX - spot.x, e.worldZ - spot.z) <= OPEN_REACH_M);
        if (!guard) continue;
        spot.lastOpen = now;
        h.openSpot(spot);
        const inside = h.hiding();
        if (inside && inside.floor === fi && Math.hypot(inside.x - spot.x, inside.z - spot.z) <= 3) {
          h.exposeHider();
          guard.alertTo(p.x, p.z);
          this.say(fi, 'opened', 'A GUARD OPENED YOUR HIDING PLACE', 'miss');
        } else {
          guard.stopInvestigating(f.nav, f.cols, f.rows);
          // (said once per place: a guard who keeps passing it is not news)
          if (!spot.told) this.say(fi, 'opened', 'A GUARD CHECKED THE LOCKER · EMPTY', 'routine');
          spot.told = true;
        }
      }
    }
    if (now < this.sweepUntil && h.camoActive()) {
      for (const b of f.enemies) {
        if (!(b instanceof Bot) || !this.free(b) || Math.hypot(b.worldX - p.x, b.worldZ - p.z) > SWEEP_REACH_M || !h.canSee(b)) continue;
        h.breakCamo();
        b.investigate(p.x, p.z, 6, f.nav, f.cols, f.rows, 999);
        this.sweepUntil = now;
        this.say(fi, 'sweep', 'A GUARD SWEPT A LIGHT OVER YOU · CAMO BROKEN', 'miss');
        break;
      }
    }
  }
}
