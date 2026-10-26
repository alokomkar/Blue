// Which animation a guard plays: what it is doing (standing, pausing to look round, walking its beat, chasing) and how fast it
// is actually moving. The clips are the library's (ual.ts); the rate is the guard's real speed over the clip's own stride, so
// feet don't skate. Pure, so it's unit-tested under Node.

export type GuardPose = 'idle' | 'look' | 'torch' | 'aim' | 'walk' | 'jog' | 'sprint' | 'creep' | 'creepIdle' | 'backoff';

/** The library clip each pose plays (names as in ual.ts's UalClip). */
export const POSE_CLIP = {
  idle: 'Idle_Loop',
  look: 'Idle_LookAround_Loop',
  torch: 'Idle_Torch_Loop',
  aim: 'Pistol_Idle_Loop',
  walk: 'Walk_Formal_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  creep: 'Crouch_Fwd_Loop',
  creepIdle: 'Crouch_Idle_Loop',
  backoff: 'Crouch_Bwd_Loop',
} as const satisfies Record<GuardPose, string>;

/** How fast the clip itself travels, in world units a second, measured from the library's root-motion files. */
export const STRIDE: Readonly<Record<'walk' | 'jog' | 'sprint' | 'creep' | 'backoff', number>> = { walk: 0.97, jog: 5.36, sprint: 8.25, creep: 0.85, backoff: 0.85 };

/** A clip is never played slower or faster than this, whatever the guard's speed: slow-motion and fast-forward both look wrong. */
export const RATE_MIN = 0.6;
export const RATE_MAX = 2.7;

export type GuardState = {
  moving: boolean;
  /** It has the player in sight and is going for them. */
  chasing: boolean;
  /** A hunter sent by the alarm: sprints where a guard jogs. */
  hunter: boolean;
  /** Stopped at the end of a leg of its beat, scanning round. */
  scanning: boolean;
  /** Out looking for a noise or a flare, and standing where it was sent. */
  searching: boolean;
  /** Has the player in sight and is standing, not closing in: the gun comes up. */
  aiming: boolean;
  /** Its laser has been on the player: it creeps up crouched to see for itself (laser.ts). */
  cautious?: boolean;
  /** Giving ground from the agent, still facing them: it backs off crouched, gun on them, not turning its back. */
  backing?: boolean;
};

export function guardPose({ moving, chasing, hunter, scanning, searching, aiming, cautious, backing }: GuardState): GuardPose {
  if (backing && moving) return 'backoff';
  if (cautious && !chasing) return moving ? 'creep' : 'creepIdle';
  if (moving) return chasing ? (hunter ? 'sprint' : 'jog') : 'walk';
  if (aiming) return 'aim';
  if (searching) return 'torch';
  return scanning ? 'look' : 'idle';
}

/** The poses whose clip holds the gun itself, so the game's own arm hold (a fixed ready target) must leave the arm alone. */
export const holdsGun = (pose: GuardPose): boolean => pose === 'aim';

/** The playback rate that makes `pose`'s feet match a guard moving at `speed`; 1 for a pose that stays put. */
export function poseRate(pose: GuardPose, speed: number): number {
  if (pose !== 'walk' && pose !== 'jog' && pose !== 'sprint' && pose !== 'creep' && pose !== 'backoff') return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, speed / STRIDE[pose]));
}
