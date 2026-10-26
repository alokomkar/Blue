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
  // (Well behind a leader who is sneaking, it runs to catch up rather than creeping after them: a sneak cannot dash.)
  const catching = away > CATCH_UP && !leader.prone;
  const stance = { sneak: leader.sneak && !catching, prone: leader.prone };
  if (dist < STOP && away < GAP * 2) {
    // There, or near enough: watch the back, the way opposite to where the leader looks.
    return { turn: turnToward(me.angle, leader.angle + Math.PI), throttle: 0, ...stance, dash: false };
  }
  const want = headingTo(me, spot);
  const off = Math.abs(wrap(want - me.angle));
  const turn = turnToward(me.angle, want);
  // Walk once roughly facing the spot, slower as it closes in; fall further behind than a leash and it runs.
  const far = catching;
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

// ---- following between floors, and when you are somewhere it cannot walk ----

/** A way between two floors the partner can use on its own: a flight of stairs, or a lift (it rides it where you would). */
export type FloorLink = { a: number; b: number; kind: 'stair' | 'lift'; ref: number; /** Usable only from `a` to `b` (the bunker's flights: one each way, walled at the far end the other way). */ oneWay?: boolean };

/**
 * The first link to take, from floor `from`, to get to floor `to` by the shortest chain of links (each one goes either way); null when there is no way (a climb, a shaft or a
 * drop took you there), or when it is already there.
 */
export function nextLink<T extends FloorLink>(links: readonly T[], from: number, to: number): T | null {
  if (from === to) return null;
  const first = new Map<number, T>(); // floor -> the first link of the way to it
  const queue: number[] = [from];
  const seen = new Set<number>([from]);
  for (let qi = 0; qi < queue.length; qi++) {
    const at = queue[qi]!;
    for (const l of links) {
      const other = l.a === at ? l.b : l.b === at && !l.oneWay ? l.a : null;
      if (other === null || seen.has(other)) continue;
      seen.add(other);
      first.set(other, at === from ? l : first.get(at)!);
      if (other === to) return first.get(other)!;
      queue.push(other);
    }
  }
  return null;
}

/** A flight as the game keeps it (maze.ts's Stair, the part this needs). */
export type FlightGeom = { x: number; y: number; spanX: boolean; run: number; fromFloorY: number; toFloorY: number };

/**
 * Where to walk to use a flight, in world metres: `foot` is the middle of the cell before its first step (the end at `fromFloorY`), `head` the middle of the cell past its last (the
 * end at `toFloorY`). Walk from one to the other, straight along the flight.
 */
export function flightEnds(s: FlightGeom, cell: number): { foot: Pt; head: Pt; footCell: { x: number; y: number }; headCell: { x: number; y: number } } {
  const dx = s.spanX ? 0 : 1;
  const dz = s.spanX ? 1 : 0;
  const footCell = { x: s.x - dx, y: s.y - dz };
  const headCell = { x: s.x + dx * s.run, y: s.y + dz * s.run };
  return { foot: { x: footCell.x * cell, z: footCell.y * cell }, head: { x: headCell.x * cell, z: headCell.y * cell }, footCell, headCell };
}

/**
 * Of the cells a walker can reach (`dist` >= 0, a floor's distance field), the one nearest (straight line) to the cell (tx, ty); null if there is none. `usable` (optional) leaves out
 * cells that will not do (one on the other side of a wall from where the walker stands).
 */
export function nearestOpenCell(dist: readonly (readonly number[])[], tx: number, ty: number, usable?: (x: number, y: number) => boolean): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < dist.length; y++) {
    const row = dist[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x]! < 0 || (usable && !usable(x, y))) continue;
      const d = Math.hypot(x - tx, y - ty);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

export const UP_HOLD_REACH = 2.2; // while you are somewhere it cannot follow, it waits this near the spot under you (or the nearest place it can get to)
export const NO_WAY_S = 6; // on another floor with no stairs or lift to you for this long: it is put back beside you
export const WEDGED_S = 2.4; // trying to walk on your floor and getting nowhere for this long: put back on your path
export const WEDGED_FAR_S = 3; // the same, on another floor
export const LOST_FAR_M = 22; // further than this from you on your floor...
export const LOST_FAR_S = 8; // ...for this long: put back on your path

/**
 * Whether a walker that has been trying to move but has not got anywhere should be put back beside the leader: it has stood within `0.35` of the same spot for longer than the limit
 * (shorter on the leader's floor, where the way is short, than on another). `stuckFor` is how long that has been.
 */
export function wedged(stuckFor: number, sameFloor: boolean): boolean {
  return stuckFor > (sameFloor ? WEDGED_S : WEDGED_FAR_S);
}

export const NAV_FAR = 9; // further than this from you on your floor, it goes by the corridors to you (not along your path)...
export const NAV_NEAR = 5; // ...and goes on doing so until it is nearer than this (so it does not dither between the two at the edge)

/** Whether the partner goes to you by the corridors (true) or along your path (false), given how it was going and how far it now is. */
export function byCorridors(was: boolean, reach: number): boolean {
  return was ? reach > NAV_NEAR : reach > NAV_FAR;
}
