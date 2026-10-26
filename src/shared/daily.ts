// The Daily Heist: one building a day, the same for everyone, with one
// scored attempt and a daily leaderboard, on top of the normal job ladder
// (which stays unlimited). Plus a streak of days played, where any play
// counts: the ladder, the daily or training. Days run on UTC. Shared by the
// client (which builds the day's job from its seed) and the server (which
// keeps the attempts, the board and the streaks); pure, so it's tested
// under Node.

import type { Grade } from './api';
import type { ContractId } from './contracts';

/** Daily Heist #1. */
export const DAILY_EPOCH = '2026-09-26';

/**
 * The job each weekday plays (index 0 = Sunday), rising through the week:
 * Monday is a gentle start (job 2), and each day after is the chapter that
 * brings something in — Tuesday's watchdogs, Wednesday's blackouts, and so
 * on to Sunday's watchdog packs. Kept low on purpose: a daily is one scored
 * try, so it has to be one most players can clear.
 */
export const DAILY_LEVELS: readonly number[] = [8, 2, 3, 4, 5, 6, 7];

const DAY_MS = 86_400_000;
const GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];

/** The UTC day `date` falls on, as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Whether `day` is a real YYYY-MM-DD date. */
export function isDayKey(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && dayKey(new Date(dayMs(day))) === day;
}

export function previousDay(day: string): string {
  return dayKey(new Date(dayMs(day) - DAY_MS));
}

export function nextDay(day: string): string {
  return dayKey(new Date(dayMs(day) + DAY_MS));
}

/** The days of `day`'s week (Monday to Sunday, UTC) before it: Monday gives none, Sunday six. */
export function weekSoFar(day: string): string[] {
  const out: string[] = [];
  for (let d = previousDay(day); ; d = previousDay(d)) {
    if (new Date(dayMs(d)).getUTCDay() === 0) break; // back to last Sunday: the week before
    out.unshift(d);
  }
  return out;
}

/** Everything about a day the story needs (story.ts's Day). */
export function dayInfo(day: string): { day: string; number: number; level: number; seed: number } {
  return { day, number: dailyNumber(day), level: dailyLevel(day), seed: dailySeed(day) };
}

/** Which Daily Heist `day` is: #1 on DAILY_EPOCH. */
export function dailyNumber(day: string): number {
  return Math.round((dayMs(day) - dayMs(DAILY_EPOCH)) / DAY_MS) + 1;
}

export function dailyLevel(day: string): number {
  return DAILY_LEVELS[new Date(dayMs(day)).getUTCDay()]!;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** What each daily job is known for: the chapter it opens (difficulty.ts). */
const DAILY_THEMES: Record<number, string> = {
  2: 'a gentle start',
  3: 'watchdogs',
  4: 'blackouts',
  5: 'crawler mines',
  6: 'sweeping lasers',
  7: 'drones',
  8: 'watchdog packs',
};

/** The daily post's title, e.g. "Daily Heist #2 · Sunday: Job 8, watchdog packs". */
export function dailyPostTitle(day: string): string {
  const level = dailyLevel(day);
  const theme = DAILY_THEMES[level];
  return `Daily Heist #${dailyNumber(day)} · ${WEEKDAYS[new Date(dayMs(day)).getUTCDay()]}: Job ${level}${theme ? `, ${theme}` : ''}`;
}

/** The day's random seed: the same for everyone (FNV-1a over the date). */
export function dailySeed(day: string): number {
  let h = 0x811c9dc5;
  for (const ch of `blueprint-job-daily:${day}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---- results ----

/** How a daily attempt went, as the client reports it. */
export type DailyResult = {
  day: string;
  cleared: boolean;
  /** Heist points (0 if caught). */
  points: number;
  /** Null if caught. */
  grade: Grade | null;
  seconds: number;
  documents: number;
  totalDocuments: number;
  spotted: number;
  takedowns: number;
  /** The access logs got away (campaign.ts: a burned night). Left out by older clients. */
  burned?: boolean;
  /** Alarms raised (campaign.ts: a loud night). Left out by older clients. */
  alarms?: number;
  /** Which contract the night was (contracts.ts), and the pages it adds to the case (fallout.ts). Left out by older clients. */
  contract?: ContractId;
  pages?: number;
};

const MAX_POINTS = 10_000;
const MAX_SECONDS = 4 * 3600;

/** Kept in step with shared/contracts.ts's CONTRACT_IDS (a test checks): a value import of it would not run under Node's test runner. */
const CONTRACT_LIST: readonly ContractId[] = ['records', 'sabotage', 'vault', 'hit', 'blackout', 'extract', 'swap', 'shipment'];
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/**
 * Validates an untrusted result. Scores are reported by the player's own
 * browser, so this can only reject the impossible (negative counts, more
 * documents than there were, points on a failed run), not a determined
 * cheat.
 */
export function parseDailyResult(body: unknown): DailyResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isDayKey(b.day) || typeof b.cleared !== 'boolean') return null;
  if (!int(b.seconds, 1, MAX_SECONDS) || !int(b.totalDocuments, 1, 20) || !int(b.documents, 0, b.totalDocuments as number)) return null;
  if (!int(b.spotted, 0, 10_000) || !int(b.takedowns, 0, 1000) || !int(b.points, 0, MAX_POINTS)) return null;
  if (b.burned !== undefined && typeof b.burned !== 'boolean') return null;
  if (b.alarms !== undefined && !int(b.alarms, 0, 1000)) return null;
  if (b.contract !== undefined && !CONTRACT_LIST.includes(b.contract as ContractId)) return null;
  if (b.pages !== undefined && !int(b.pages, 0, 12)) return null;
  if (b.cleared) {
    if (!GRADES.includes(b.grade as Grade) || b.documents !== b.totalDocuments) return null;
  } else if (b.grade !== null || b.points !== 0) {
    return null;
  }
  return {
    day: b.day,
    cleared: b.cleared,
    points: b.points as number,
    grade: (b.grade as Grade | null) ?? null,
    seconds: b.seconds as number,
    documents: b.documents as number,
    totalDocuments: b.totalDocuments as number,
    spotted: b.spotted as number,
    takedowns: b.takedowns as number,
    ...(b.burned !== undefined ? { burned: b.burned as boolean } : {}),
    ...(b.alarms !== undefined ? { alarms: b.alarms as number } : {}),
    ...(b.contract !== undefined ? { contract: b.contract as ContractId } : {}),
    ...(b.pages !== undefined ? { pages: b.pages as number } : {}),
  };
}

/** The line a player copies to share their run (Wordle-style: a square per document, found or not). */
export function shareLine(r: DailyResult): string {
  const squares = '🟩'.repeat(r.documents) + '⬛'.repeat(r.totalDocuments - r.documents);
  const time = `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}`;
  const head = `Blueprint Job · Daily #${dailyNumber(r.day)} (Job ${dailyLevel(r.day)})`;
  const outcome = r.cleared ? `Grade ${r.grade}` : 'Caught';
  const spotted = r.cleared ? ` · spotted ${r.spotted}×` : '';
  return `${head} · ${outcome} · ${squares} · ${time}${spotted}`;
}

// ---- streaks ----

/** Days in a row the player has played anything, and the longest run so far. */
export type Streak = { last: string | null; count: number; best: number };

export const NO_STREAK: Streak = { last: null, count: 0, best: 0 };

/** Counts a play on `day`: the streak goes on if they last played the day before, and starts over after a gap. */
export function recordPlay(s: Streak, day: string): Streak {
  if (s.last === day) return s;
  const count = s.last === previousDay(day) ? s.count + 1 : 1;
  return { last: day, count, best: Math.max(s.best, count) };
}

/** The streak as it stands on `today`: still alive if they played today or yesterday, broken otherwise. */
export function currentStreak(s: Streak, today: string): number {
  return s.last === today || s.last === previousDay(today) ? s.count : 0;
}
