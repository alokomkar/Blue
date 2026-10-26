// End-of-job report — the numbers game.ts tallies over a job, the stealth
// grade they earn, and the heist points that grade is worth on the
// leaderboard. Pure (type-only imports), so it's unit-testable under Node.

import type { Grade } from '../../shared/api';

export type JobStats = {
  level: number;
  cleared: boolean;
  /** Time in play, excluding time spent with the blueprint open. */
  seconds: number;
  /** Maze cells across every floor — sets the par time. */
  cells: number;
  documents: number;
  totalDocuments: number;
  /** What a unit of the job is called on the card (a contract's own, contracts.ts); files when not given. A contract job has no access logs, so that row goes. */
  unitLabel?: string;
  /** The access logs: wiped before they went out, sent (burned), or never queued. */
  logs: 'wiped' | 'burned' | 'none';
  /** Enemies taken down, by stun or EMP. */
  botsStunned: number;
  empsUsed: number;
  /** Silent takedowns from behind. */
  takedowns: number;
  /** Stun shots fired — loud, and they cost the stealth grade. */
  shotsFired: number;
  /** Times suspicion tripped the global alarm. */
  alarms: number;
  /** A bot held you in sight long enough to raise the alarm. */
  timesSpotted: number;
  /** Shot by a bot. */
  timesHit: number;
  lockersOpened: number;
  riggedLockers: number;
  gridsPowered: number;
  /** Stunned bots dragged out of sight behind a crate. */
  /** Bodies a guard came across. */
  bodiesFound: number;
  /** Locker score for the job (loot minus rigged). */
  score: number;
};

const PAR_BASE_S = 60;
const PAR_PER_CELL_S = 1.2;
const SPOTTED_COST = 15;
const HIT_COST = 20;
const MAX_TIME_COST = 25;
const SHOT_COST = 4;
const MAX_SHOT_COST = 20;
const BURNED_COST = 25; // the access logs went out: the target knows what was read
const TAKEDOWN_POINTS = 10;

const GRADE_FLOORS: Array<[Grade, number]> = [
  ['S', 95],
  ['A', 80],
  ['B', 60],
  ['C', 35],
];
const GRADE_MULTIPLIER: Record<Grade, number> = { S: 2, A: 1.6, B: 1.3, C: 1.1, D: 1 };

/** Par time for a job: a minute, plus a little per cell to explore. */
export function parSeconds(cells: number): number {
  return Math.round(PAR_BASE_S + cells * PAR_PER_CELL_S);
}

/** 0–100: starts perfect, loses points for being spotted, being shot, firing the stun gun, and running long past par. */
export function stealthRating(s: JobStats): number {
  const over = s.seconds / parSeconds(s.cells) - 1;
  const timeCost = Math.min(MAX_TIME_COST, Math.max(0, Math.round(over * MAX_TIME_COST)));
  const shotCost = Math.min(MAX_SHOT_COST, s.shotsFired * SHOT_COST);
  return Math.max(0, 100 - s.timesSpotted * SPOTTED_COST - s.timesHit * HIT_COST - shotCost - timeCost - (s.logs === 'burned' ? BURNED_COST : 0));
}

export function gradeFor(rating: number): Grade {
  for (const [grade, floor] of GRADE_FLOORS) if (rating >= floor) return grade;
  return 'D';
}

/** Leaderboard points for a cleared job: bigger jobs and cleaner grades are worth more, plus any locker score and a bonus per takedown. */
export function heistPoints(level: number, grade: Grade, score: number, takedowns = 0): number {
  return Math.round(100 * level * GRADE_MULTIPLIER[grade]) + Math.max(0, score) + takedowns * TAKEDOWN_POINTS;
}

/** The report card's rows, in reading order. */
export function reportRows(s: JobStats): Array<[string, string]> {
  return [
    ['Time', `${formatTime(s.seconds)} / par ${formatTime(parSeconds(s.cells))}`],
    [s.unitLabel ?? 'Files captured', `${s.documents} / ${s.totalDocuments}`],
    ...(s.unitLabel && s.logs === 'none' ? [] : [['Access logs', s.logs === 'burned' ? 'Sent · burned' : s.logs === 'wiped' ? 'Wiped' : 'None queued'] as [string, string]]),
    ['Times spotted', String(s.timesSpotted)],
    ['Times hit', String(s.timesHit)],
    ['Alarms raised', String(s.alarms)],
    ['Takedowns', String(s.takedowns)],
    ['Shots fired', String(s.shotsFired)],
    ['Enemies disabled', String(s.botsStunned)],
    ['EMPs used', String(s.empsUsed)],
    ['Lockers opened', s.riggedLockers ? `${s.lockersOpened} · ${s.riggedLockers} rigged` : String(s.lockersOpened)],
    ['Grids powered', String(s.gridsPowered)],
    ['Bodies found', String(s.bodiesFound)],
    ['Locker score', s.score > 0 ? `+${s.score}` : String(s.score)],
  ];
}

/** "4:07" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
