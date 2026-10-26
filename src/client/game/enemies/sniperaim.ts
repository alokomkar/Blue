// The sniper's rules, pure so they are unit-tested under Node (sniper.ts plays them). A sniper stands on its post and sweeps a thin red laser to and fro. A look that stays on the agent for a
// moment makes it lock; from then on it tracks them, and 1.5 s of an unbroken line is the aim before the shot. Break the line (cover, low furniture when crouched or flat, smoke, a camo'd
// stand-still, a flash) for longer than a heartbeat and the aim starts over from nothing. The wall test and the smoke test are handed in (detection.ts's lineClearOver and smoke.ts's
// smokeBlocks), so this file imports nothing at run time.

import type { WallBox } from '../scene';

export type LineClear = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, boxes: WallBox[]) => boolean;
export type SmokeBlocks = (ax: number, az: number, bx: number, bz: number, smokes: ReadonlyArray<{ x: number; z: number; age: number }>) => boolean;

/** How far it sees a standing, walking agent, in metres: the length of a hall and a void. */
export const SNIPER_RANGE = 34;
/** Seconds of an unbroken line between the lock and the shot. */
export const AIM_S = 1.5;
/** The reload after a shot, before it can start another aim. */
export const RELOAD_S = 3;
/** The line may break this long (a step behind a pillar and out) without the aim starting over. */
export const LOSE_GRACE_S = 0.3;
/** Seconds of the sweeping laser on the agent before it locks on. */
export const ACQUIRE_S = 0.35;
/** Half angle the sweeping laser covers either side of its line of sight (radians, about 6 degrees): the width of the "look". */
export const LASER_HALF = 0.1;
/** Half angle, once locked, that the agent may be off its crosshair and still count (about 9 degrees), and how fast it turns to follow (radians a second). */
export const LOCK_HALF = 0.16;
export const TRACK_RATE = 1.3;
/** The sweep: how far each side of its post's facing the laser runs, and the seconds a full to-and-fro takes. */
export const SWEEP_HALF = 0.5;
export const SWEEP_PERIOD_S = 8;
/** The most the agent's feet may be above or below its own floor (metres) for it to see them, or for a stun shot to reach it: one storey is never one floor. */
export const Y_GATE = 1.8;
/** How a shot at the agent lands. The partner is harder to hit (it moves, and it ducks); a dodge is the game's own check on top of this. */
export const PLAYER_HIT = 0.9;
export const PARTNER_HIT = 0.45;
/** What a hit costs the agent: a guard's bolt is 30, a sniper's round is dearer. */
export const SNIPER_HIT_SUSPICION = 35;

export type Posture = { prone: boolean; crouched: boolean; running?: boolean };

/** How far it sees this posture: a runner a little further, a crouch a fifth less, flat on the floor under half (and `scale` is a dark corner's, game.ts's sightScale). */
export function sniperRange(p: Posture, scale = 1): number {
  const k = p.prone ? 0.45 : p.crouched ? 0.8 : p.running ? 1.1 : 1;
  return SNIPER_RANGE * k * scale;
}

/** How high above the floor it aims at: the chest of someone standing, hunched when crouched, a back lying flat. */
export function aimHeight(p: Posture): number {
  return p.prone ? 0.3 : p.crouched ? 0.85 : 1.3;
}

export type Mark = { x: number; z: number; /** Feet, world metres. */ y: number; hidden: boolean } & Posture;

export type Look = { sees: boolean; /** The bearing to the target (0 = +Z), so a lock can turn to it. */ bearing: number; dist: number };

export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Whether a sniper at (x, z), its eye `eyeY` above its floor at `floorY`, has a line to the mark: the mark not hidden (behind a crate pair, cloaked and still, shut in a locker), on its own
 * floor (the feet within Y_GATE of it), within its reach for that posture, with nothing in the way: the walls, desks, sofas and crates stop the line where it is lower than their tops, so
 * low furniture hides a crouched or lying agent and not one standing; a rail, a glass panel and a fence do not stop it ("see" boxes); a smoke cloud does. `centre` and `half` (when given) are
 * the cone the look is in, so a sweeping laser only sees what it lies on.
 */
export function look(
  x: number,
  z: number,
  eyeY: number,
  floorY: number,
  mark: Mark,
  boxes: WallBox[],
  deps: { lineClear: LineClear; smokeBlocks: SmokeBlocks },
  smokes: ReadonlyArray<{ x: number; z: number; age: number }> = [],
  scale = 1,
  centre?: number,
  half?: number
): Look {
  const dx = mark.x - x;
  const dz = mark.z - z;
  const dist = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, dz);
  const none = { sees: false, bearing, dist };
  if (mark.hidden || Math.abs(mark.y - floorY) > Y_GATE || dist < 0.3 || dist > sniperRange(mark, scale)) return none;
  if (centre !== undefined && half !== undefined && Math.abs(wrap(bearing - centre)) > half) return none;
  const solids = boxes.filter((b) => !b.see);
  if (!deps.lineClear(x, eyeY, z, mark.x, mark.y - floorY + aimHeight(mark), mark.z, solids)) return none;
  if (deps.smokeBlocks(x, z, mark.x, mark.z, smokes)) return none;
  return { sees: true, bearing, dist };
}

/** Where the laser points, `t` seconds in: the post's facing plus the to-and-fro of the sweep. */
export function sweepAngle(facing: number, t: number, phase = 0): number {
  return facing + SWEEP_HALF * Math.sin((t / SWEEP_PERIOD_S) * Math.PI * 2 + phase);
}

/** Turns `from` toward `to` by at most `rate * dt` radians, the short way round. */
export function turnToward(from: number, to: number, rate: number, dt: number): number {
  const d = wrap(to - from);
  const step = Math.min(Math.abs(d), rate * dt);
  return wrap(from + Math.sign(d) * step);
}

export type Phase = 'scan' | 'lock' | 'reload';

export type AimState = {
  phase: Phase;
  /** Seconds the sweeping laser has been on a target (scan), and of the aim (lock). */
  dwell: number;
  aim: number;
  /** Seconds the line has been broken while locked. */
  lost: number;
  /** Seconds of the reload left. */
  reload: number;
};

export const START: AimState = { phase: 'scan', dwell: 0, aim: 0, lost: 0, reload: 0 };

export type AimStep = { state: AimState; /** The shot goes off this frame. */ fire: boolean; /** It has just locked on. */ locked: boolean; /** It has just lost the lock: the aim is gone. */ dropped: boolean };

/**
 * One frame of the sniper's mind. `onBeam`: the sweeping laser lies on a target with a clear line (scan); `onLock`: a locked sniper still has its target in the crosshair with a clear line.
 * Scanning, the time on a target builds and (quicker than it builds) drains; at ACQUIRE_S it locks. Locked, a clear line builds the aim; a broken one counts a grace and then drops the lock
 * for good, the aim starting from nothing next time. At AIM_S it fires and reloads. Reloading, the laser is dim and nothing builds.
 */
export function stepAim(s: AimState, onBeam: boolean, onLock: boolean, dt: number): AimStep {
  if (s.phase === 'reload') {
    const reload = s.reload - dt;
    return { state: reload > 0 ? { ...s, reload } : { ...START }, fire: false, locked: false, dropped: false };
  }
  if (s.phase === 'scan') {
    const dwell = onBeam ? s.dwell + dt : Math.max(0, s.dwell - dt * 1.5);
    if (dwell >= ACQUIRE_S) return { state: { phase: 'lock', dwell: 0, aim: 0, lost: 0, reload: 0 }, fire: false, locked: true, dropped: false };
    return { state: { ...s, dwell }, fire: false, locked: false, dropped: false };
  }
  // locked
  if (!onLock) {
    const lost = s.lost + dt;
    if (lost > LOSE_GRACE_S) return { state: { ...START }, fire: false, locked: false, dropped: true };
    return { state: { ...s, lost }, fire: false, locked: false, dropped: false };
  }
  const aim = s.aim + dt;
  if (aim >= AIM_S) return { state: { phase: 'reload', dwell: 0, aim: 0, lost: 0, reload: RELOAD_S }, fire: true, locked: false, dropped: false };
  return { state: { ...s, aim, lost: 0 }, fire: false, locked: false, dropped: false };
}

/** The share of the aim done, 0 to 1 (the laser brightens with it). */
export const aimed = (s: AimState): number => (s.phase === 'lock' ? Math.min(1, s.aim / AIM_S) : 0);

/** Whether a roll in [0, 1) lands a shot on the player, or on the partner. */
export const lands = (roll: number, at: 'player' | 'partner'): boolean => roll < (at === 'player' ? PLAYER_HIT : PARTNER_HIT);

/** Whether the agent's stun shot or takedown can reach a sniper: on the same floor, not through the one above or below. */
export const reachable = (sniperFloorY: number, agentY: number): boolean => Math.abs(sniperFloorY - agentY) <= Y_GATE;

/**
 * Whom a sniper aims at, the agent first: the target it can see now, or null. (The partner is only the target when the agent is out of its sights.)
 */
export function pickTarget<T extends { sees: boolean }>(player: T | null, partner: T | null): { who: 'player' | 'partner'; look: T } | null {
  if (player?.sees) return { who: 'player', look: player };
  if (partner?.sees) return { who: 'partner', look: partner };
  return null;
}
