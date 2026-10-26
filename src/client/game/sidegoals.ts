// A side goal: an optional extra on a job, on top of its contract and its twist. It asks for a cleaner or faster run (no alarm, never seen, no body found,
// under par, the stun gun holstered, no kit) and pays a bonus when the job is cleared with it intact. The campaign deals one from the third job, going round
// the list; the Daily Heist draws one from the day's seed. Here: the goals, how a job is dealt one, and what counts as having broken it. Pure, so it's unit-tested
// under Node.

import type { TwistId } from './twists';

export type SideGoalId = 'ghost' | 'unseen' | 'tidy' | 'swift' | 'quiet' | 'bare';

/** `brief` is the short line for the HUD; `ask` is the plain-words version for the briefing: exactly what has to hold from the way in to the way out. */
export type SideGoal = { id: SideGoalId; name: string; brief: string; ask: string };

export const SIDE_GOALS: Record<SideGoalId, SideGoal> = {
  ghost: { id: 'ghost', name: 'No alarms', brief: 'NOT ONE ALARM, FROM THE WAY IN TO THE WAY OUT', ask: 'Do not set off a single alarm, from the moment you walk in to the moment you walk out. One alarm and the bonus is gone.' },
  unseen: { id: 'unseen', name: 'Never spotted', brief: 'NO GUARD HOLDS YOU IN SIGHT LONG ENOUGH TO BE SURE', ask: 'Never let a guard or a dog hold you in sight long enough to be sure of you. If anyone gets a proper look at you, the bonus is gone.' },
  tidy: { id: 'tidy', name: 'No body found', brief: 'NO GUARD COMES ACROSS A BODY: STASH WHAT YOU DROP', ask: 'No guard may come across a body. Anyone you put down has to be stashed or hidden before a patrol walks past. One body found and the bonus is gone.' },
  swift: { id: 'swift', name: 'Under par', brief: 'CLEAR THE JOB IN PAR TIME OR LESS', ask: 'Be back out within the job’s par time (a minute, plus a little for every cell of the building). The exact figure comes up on your screen once you are inside.' },
  quiet: { id: 'quiet', name: 'Gun holstered', brief: 'NOT A SINGLE STUN SHOT FIRED', ask: 'Do not fire the stun gun, not once. Takedowns from behind, traps and the dark are all fine; one shot and the bonus is gone.' },
  bare: { id: 'bare', name: 'Bare hands', brief: 'NO TRAPS, NO FLASH GRENADES AND NO EMP USED', ask: 'Use no traps, no flash grenades and no EMP. Your hands, your wits and your feet only. Use any one of them and the bonus is gone.' },
};

export const SIDE_GOAL_IDS = Object.keys(SIDE_GOALS) as SideGoalId[];

/** The bonus a side goal pays on top of the heist points when the job is cleared with it intact. */
export const SIDE_BONUS = 250;

/** The first job with a side goal. */
export const FIRST_SIDE_JOB = 3;

const ROTATION: readonly SideGoalId[] = ['ghost', 'quiet', 'tidy', 'swift', 'unseen', 'bare'];

/** Goals that mean nothing under a twist: with no kit to begin with, "bare hands" is free. */
const POINTLESS: ReadonlyArray<readonly [TwistId, SideGoalId]> = [
  ['lightkit', 'bare'],
  // No guards: nobody to stumble on a body or to see you.
  ['silent', 'tidy'],
  ['silent', 'unseen'],
  // Half the pace: par time isn't the point of a night spent creeping.
  ['silent', 'swift'],
];
const allowed = (id: SideGoalId, twists: readonly TwistId[]): boolean => !POINTLESS.some(([t, g]) => g === id && twists.includes(t));

/** The campaign: job `level`'s side goal (none before the third job), going round the list, skipping one the twist makes pointless. */
export function storySideGoal(level: number, twists: readonly TwistId[] = []): SideGoalId | null {
  if (level < FIRST_SIDE_JOB) return null;
  const start = (Math.floor(level) - FIRST_SIDE_JOB) % ROTATION.length;
  for (let k = 0; k < ROTATION.length; k++) {
    const id = ROTATION[(start + k) % ROTATION.length]!;
    if (allowed(id, twists)) return id;
  }
  return null;
}

/** A Daily's side goal, drawn with `rnd` (the day's seeded random) from those that make sense under its twists. */
export function dailySideGoal(rnd: () => number, twists: readonly TwistId[] = []): SideGoalId {
  const pool = ROTATION.filter((id) => allowed(id, twists));
  return pool[Math.floor(rnd() * pool.length)]!;
}

export type SideStats = {
  alarms: number;
  timesSpotted: number;
  bodiesFound: number;
  shotsFired: number;
  empsUsed: number;
  trapsSet: number;
  flashesUsed: number;
  seconds: number;
  /** The job's par time, in seconds (report.ts). */
  parS: number;
};

/** Whether the goal is already lost: a run that has broken it can't get it back, so the HUD can say so as it happens. */
export function sideBroken(id: SideGoalId, s: SideStats): boolean {
  switch (id) {
    case 'ghost':
      return s.alarms > 0;
    case 'unseen':
      return s.timesSpotted > 0;
    case 'tidy':
      return s.bodiesFound > 0;
    case 'swift':
      return s.seconds > s.parS;
    case 'quiet':
      return s.shotsFired > 0;
    case 'bare':
      return s.trapsSet + s.flashesUsed + s.empsUsed > 0;
  }
}
