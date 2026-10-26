// The hostage rescue's partner (the other agent): the pure rules for it, kept apart from the scene so they are unit-tested under Node. Freed, it is your
// backup. It never leads: it follows the path you actually walked, copies how you move (sneaking, crouching, flat, dashing), stops a little behind you and watches your back,
// and stands in when you work a console. What it does with a gun is done by game.ts with these numbers.
//
// Angles are the game's: 0 faces +Z, and a positive turn input swings the heading round to a smaller angle (player.ts tick: angle -= turn).

/** Where the partner stands: held in a cell, free and backing you up, or down (stunned by a guard that saw it). */
export type PartnerState = 'held' | 'free' | 'down';

export const RESCUE_S = 3; // holding Interact beside the cell to cut the partner loose
export const RESCUE_REACH = 2.2; // how close to the partner to do it
export const REVIVE_S = 2.5; // and to bring a downed partner round
export const DOWN_FAIL_S = 45; // a partner left down this long is lost: the job ends
export const LEAVE_DOWNED_S = 4; // standing in the open exit this long with the partner still down: the lift takes you without them
export const SEEN_DOWN_S = 3; // a guard with a clear view of the partner for this long puts it down
export const GAP = 1.7; // how far behind you, along your path, it keeps
export const STOP = 0.35; // it is there when nearer than this to the spot
export const CATCH_UP = 4; // further behind than this (straight line) and it dashes to catch up
export const TRAIL_STEP = 0.4; // a breadcrumb every this far
export const TRAIL_MAX = 600; // (240 m of path: a partner left far behind still has your whole route to follow)
export const BACKUP_COOLDOWN_S = 2.4; // between its own shots
export const BACKUP_RANGE = 9; // how far it will shoot a guard
export const AUTO_COOLDOWN_S = 1.6; // between shots it takes on its own
export const ENGAGE_CLOSE = 6.5; // an unaware guard this near either of you gets shot...
export const ENGAGE_CLOSE_STEALTH = 3.5; // ...or only this near while you are sneaking (a shot gives you both away)
export const LOOKOUT_RANGE = 7; // and stun one that comes up on you while you are working a console

export type Pt = { x: number; z: number };

/** The path the leader has walked, newest last, as a thinned list of points. */
export class Trail {
  readonly points: Pt[] = [];

  push(x: number, z: number): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(x - last.x, z - last.z) < TRAIL_STEP) return;
    this.points.push({ x, z });
    if (this.points.length > TRAIL_MAX) this.points.shift();
  }

  clear(): void {
    this.points.length = 0;
  }

  /** The point `gap` metres back along the path from where the leader is now (the oldest point if the path is shorter). */
  pointBehind(leader: Pt, gap: number): Pt {
    let from: Pt = leader;
    let left = gap;
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i]!;
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= left) {
        const t = d === 0 ? 0 : left / d;
        return { x: from.x + (p.x - from.x) * t, z: from.z + (p.z - from.z) * t };
      }
      left -= d;
      from = p;
    }
    return from;
  }

  /**
   * Where to head when well behind: not straight at the spot by the leader (through whatever walls lie between) but along the path itself, from the breadcrumb nearest `me` on to the one a
   * few steps further on; near the end of the path, the spot `gap` behind the leader as usual.
   */
  waypoint(me: Pt, leader: Pt, gap: number): Pt {
    const pts = this.points;
    if (pts.length < 2) return this.pointBehind(leader, gap);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i]!.x - me.x, pts[i]!.z - me.z);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    // The path still to go from there to the leader.
    let left = Math.hypot(leader.x - pts[pts.length - 1]!.x, leader.z - pts[pts.length - 1]!.z);
    for (let i = nearest; i < pts.length - 1; i++) left += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.z - pts[i]!.z);
    if (left <= gap + 1.5) return this.pointBehind(leader, gap);
    return pts[Math.min(pts.length - 1, nearest + 3)]!;
  }
}

const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** The heading that faces from `a` to `b`. */
export const headingTo = (a: Pt, b: Pt): number => Math.atan2(b.x - a.x, b.z - a.z);

/** A turn input (-1..1) that swings `angle` toward `want`: more the further off, none when near. */
export function turnToward(angle: number, want: number): number {
  const diff = wrap(want - angle);
  return Math.max(-1, Math.min(1, -diff * 2.4)) + 0; // + 0 turns a -0 into 0
}

export type StepInput = { turn: number; throttle: number; sneak: boolean; prone: boolean; dash: boolean };
export type Leader = Pt & { angle: number; sneak: boolean; prone: boolean; dash: boolean; moving: boolean };

/** The spot the partner heads for: `GAP` behind the leader on their path, or when well behind, along the path itself (Trail.waypoint). */
export function followTarget(me: Pt, leader: Pt, trail: Trail): Pt {
  const farBehind = Math.hypot(leader.x - me.x, leader.z - me.z) > GAP * 2.2;
  return farBehind ? trail.waypoint(me, leader, GAP) : trail.pointBehind(leader, GAP);
}

/**
 * The partner's input for one frame: toward the spot `GAP` behind the leader on the leader's own path, at the leader's own posture. Close enough, it stops and faces the way
 * the leader's back is turned (round behind them). Too far behind (a door held it up), it runs.
 */
export function followInput(me: Pt & { angle: number }, leader: Leader, trail: Trail): StepInput {
  const spot = followTarget(me, leader, trail);
  const dist = Math.hypot(spot.x - me.x, spot.z - me.z);
  const away = Math.hypot(leader.x - me.x, leader.z - me.z);
  const stance = { sneak: leader.sneak, prone: leader.prone };
  if (dist < STOP && away < GAP * 2) {
    // There, or near enough: watch the back, the way opposite to where the leader looks.
    return { turn: turnToward(me.angle, leader.angle + Math.PI), throttle: 0, ...stance, dash: false };
  }
  const want = headingTo(me, spot);
  const off = Math.abs(wrap(want - me.angle));
  const turn = turnToward(me.angle, want);
  // Walk once roughly facing the spot, slower as it closes in; fall further behind than a leash and it runs.
  const far = away > CATCH_UP && !leader.prone;
  const throttle = off > 1.1 ? 0.15 : Math.max(0.25, Math.min(1, (dist - STOP) / 0.8 + 0.25));
  return { turn, throttle, ...stance, dash: far || (leader.dash && dist > 1) };
}

/** Progress of holding Interact on the partner (to free it, or to bring it round): fills while in reach, drains twice as fast when out of it. */
export function holdProgress(progress: number, inReach: boolean, dt: number, seconds: number): number {
  return Math.max(0, Math.min(1, progress + (inReach ? dt / seconds : (-2 * dt) / seconds)));
}

/** Seconds a guard has had a clear view of the partner: counts up while seen (less if the partner is crouched or flat), ebbs while not. */
export function seenFor(seen: number, inView: boolean, dt: number): number {
  return Math.max(0, seen + (inView ? dt : -dt * 0.5));
}

/** How far a guard sees the partner, given its stance (the leader's own: copied). */
export function sightOf(range: number, sneak: boolean, prone: boolean): number {
  return range * (prone ? 0.35 : sneak ? 0.6 : 1);
}

/** Both of you in the lift: the partner free (not down) and within `reach` of the leader. */
export function together(state: PartnerState, leader: Pt, partner: Pt, reach = 3.2): boolean {
  return state === 'free' && Math.hypot(leader.x - partner.x, leader.z - partner.z) <= reach;
}

/**
 * Whether the partner takes a shot at a guard on its own: any guard that is onto you (alert, a hunter, a heavy within range) at once, and one that has not noticed you only when it
 * is close to either of you (nearer still while you are sneaking, or lying flat, so a quiet job is not blown by a shot at a guard that would have walked past).
 */
export function shouldEngage(g: { alerted: boolean; nearest: number; kind: string }, sneak: boolean, prone: boolean): boolean {
  if (g.alerted || g.kind === 'hunter') return true;
  const close = prone ? ENGAGE_CLOSE_STEALTH * 0.7 : sneak ? ENGAGE_CLOSE_STEALTH : ENGAGE_CLOSE;
  return g.nearest <= close;
}

/** Input to walk to a point (not along the leader's path): turn toward it, walk, ease off as it closes; `arrived` inside `stopAt`. */
export function goInput(me: Pt & { angle: number }, target: Pt, stance: { sneak: boolean; prone: boolean }, stopAt = 0.35, hurry = false): StepInput & { arrived: boolean } {
  const dist = Math.hypot(target.x - me.x, target.z - me.z);
  if (dist <= stopAt) return { turn: 0, throttle: 0, ...stance, dash: false, arrived: true };
  const want = headingTo(me, target);
  const off = Math.abs(wrap(want - me.angle));
  // Well off the heading it turns on the spot (a little forward drift while turning walked it in circles round the point it was meant to reach).
  const throttle = off > 1.1 ? 0 : Math.max(0.3, Math.min(1, dist / 1.2));
  return { turn: turnToward(me.angle, want), throttle, ...stance, dash: hurry && !stance.prone && dist > 2 && off < 0.5, arrived: false };
}

// ---- taking cover on purpose: which way will they come from? ----

export type ThreatIn = { x: number; z: number; facing: number; alert: boolean; moving: boolean; kind: string };
/** A direction (unit, from the leader) the guards are likely to come from, and how much that matters. */
export type Bearing = { dx: number; dz: number; w: number };
export const THREAT_RANGE = 18;
const MERGE_DOT = Math.cos((50 * Math.PI) / 180);

/**
 * The directions to expect trouble from, strongest first. Each awake guard counts by how near it is, whether it is already onto you, whether it is a hunter or a heavy, whether
 * it is walking, and whether it is facing your way (a patrol heading toward you will arrive; one walking off will not). Guards in much the same direction are merged.
 */
export function threatBearings(leader: Pt, threats: readonly ThreatIn[]): Bearing[] {
  const out: Bearing[] = [];
  for (const t of threats) {
    const d = Math.hypot(t.x - leader.x, t.z - leader.z);
    if (d < 0.5 || d > THREAT_RANGE) continue;
    const ux = (t.x - leader.x) / d;
    const uz = (t.z - leader.z) / d;
    // Is it facing you? Its facing is the angle from +Z, so its look direction is (sin, cos).
    const toward = -(Math.sin(t.facing) * ux + Math.cos(t.facing) * uz);
    let w = 1 / (1 + d / 8);
    if (t.alert) w *= 3;
    if (t.kind === 'hunter' || t.kind === 'heavy') w *= 2;
    if (t.moving) w *= 1.3;
    w *= toward > 0.3 ? 1.8 : toward < -0.3 ? 0.5 : 1;
    const hit = out.find((b) => b.dx * ux + b.dz * uz > MERGE_DOT);
    if (hit) {
      const nx = hit.dx * hit.w + ux * w;
      const nz = hit.dz * hit.w + uz * w;
      const len = Math.hypot(nx, nz) || 1;
      hit.dx = nx / len;
      hit.dz = nz / len;
      hit.w += w;
    } else out.push({ dx: ux, dz: uz, w });
  }
  return out.sort((a, b) => b.w - a.w);
}

/** Whether furniture whose face looks along (nx, nz) (toward whoever stands behind it) is between them and something in direction `b`. */
export const shields = (nx: number, nz: number, b: Bearing): boolean => b.dx * nx + b.dz * nz < -0.25;

/**
 * How good a spot is to take cover at (lower is better): shield the directions that matter, the ones the leader's own cover does not shield counting most, so the two of you
 * do not both face the same way when something else is coming; with nothing to go on, take the leader's own side. Near the leader, and not far to walk.
 */
export function coverScore(spot: { px: number; pz: number; nx: number; nz: number }, me: Pt, leader: Pt, leaderFace: { nx: number; nz: number } | null, bearings: readonly Bearing[]): number {
  const walk = Math.hypot(spot.px - me.x, spot.pz - me.z);
  const near = Math.hypot(spot.px - leader.x, spot.pz - leader.z);
  let value = 0;
  if (bearings.length === 0) {
    value = leaderFace ? Math.max(0, spot.nx * leaderFace.nx + spot.nz * leaderFace.nz) * 3 : 0;
  } else {
    const total = bearings.reduce((n, b) => n + b.w, 0) || 1;
    for (const b of bearings) {
      if (!shields(spot.nx, spot.nz, b)) continue;
      const leaderHas = leaderFace ? shields(leaderFace.nx, leaderFace.nz, b) : false;
      value += (b.w / total) * (leaderHas ? 0.6 : 1.5);
    }
    value *= 7;
  }
  return walk * 0.5 + near * 1.0 - value;
}

/** Whether the exit takes the agent without a partner who is down: the agent has waited in the open cab long enough for them. A downed partner must not keep the agent in (a fuse running, hunters coming). */
export function mayLeaveWithout(state: PartnerState, waitedInCab: number): boolean {
  return state === 'down' && waitedInCab >= LEAVE_DOWNED_S;
}
