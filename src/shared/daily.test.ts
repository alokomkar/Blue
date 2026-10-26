import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_EPOCH,
  currentStreak,
  dailyLevel,
  dailyNumber,
  dailyPostTitle,
  dailySeed,
  dayKey,
  isDayKey,
  NO_STREAK,
  parseDailyResult,
  previousDay,
  recordPlay,
  shareLine,
  type DailyResult,
} from './daily.ts';

test('days are UTC dates, numbered from the first daily', () => {
  assert.equal(dayKey(new Date('2026-09-27T23:59:59Z')), '2026-09-27');
  assert.equal(dayKey(new Date('2026-09-28T00:00:00Z')), '2026-09-28');
  assert.equal(dailyNumber(DAILY_EPOCH), 1);
  assert.equal(dailyNumber('2026-10-26'), 31);
  assert.equal(previousDay('2026-10-01'), '2026-09-30');
  assert.equal(previousDay('2027-01-01'), '2026-12-31');
  assert.ok(isDayKey('2026-02-28'));
  assert.ok(!isDayKey('2026-02-30'));
  assert.ok(!isDayKey('yesterday'));
});

test('the daily post is titled with its number, weekday, job and what that job brings', () => {
  assert.equal(dailyPostTitle('2026-09-27'), 'Daily Heist #2 · Sunday: Job 8, watchdog packs');
  assert.equal(dailyPostTitle('2026-09-29'), 'Daily Heist #4 · Tuesday: Job 3, watchdogs');
});

test('everyone gets the same seed for a day, and a different one the next', () => {
  assert.equal(dailySeed('2026-09-27'), dailySeed('2026-09-27'));
  assert.notEqual(dailySeed('2026-09-27'), dailySeed('2026-09-28'));
  assert.ok(Number.isInteger(dailySeed('2026-09-27')) && dailySeed('2026-09-27') >= 0);
});

test('the job rises through the week: Monday job 2 up to Sunday job 8', () => {
  // 2026-09-28 is a Monday.
  const week = Array.from({ length: 7 }, (_, i) => dailyLevel(dayKey(new Date(Date.parse('2026-09-28T00:00:00Z') + i * 86_400_000))));
  assert.deepEqual(week, [2, 3, 4, 5, 6, 7, 8]);
});

const good: DailyResult = {
  day: '2026-09-27',
  cleared: true,
  points: 540,
  grade: 'A',
  seconds: 401,
  documents: 4,
  totalDocuments: 4,
  spotted: 1,
  takedowns: 2,
};

test('results are checked for the impossible before they count', () => {
  assert.deepEqual(parseDailyResult(good), good);
  const caught = { ...good, cleared: false, points: 0, grade: null, documents: 2 };
  assert.deepEqual(parseDailyResult(caught), caught);
  for (const bad of [
    null,
    { ...good, day: 'today' },
    { ...good, documents: 5 },
    { ...good, documents: 3 }, // cleared without every document
    { ...good, points: -1 },
    { ...good, seconds: 0 },
    { ...good, grade: 'Z' },
    { ...caught, points: 50 }, // points on a failed run
    { ...caught, grade: 'A' },
    { ...good, takedowns: 1.5 },
  ]) {
    assert.equal(parseDailyResult(bad), null, JSON.stringify(bad));
  }
});

test('the share line gives the daily, the grade, a square per document and the time', () => {
  assert.equal(shareLine(good), 'Blueprint Job · Daily #2 (Job 8) · Grade A · 🟩🟩🟩🟩 · 6:41 · spotted 1×');
  assert.equal(
    shareLine({ ...good, cleared: false, points: 0, grade: null, documents: 1, seconds: 65 }),
    'Blueprint Job · Daily #2 (Job 8) · Caught · 🟩⬛⬛⬛ · 1:05'
  );
});

test('a streak counts days in a row played, starts over after a gap, and remembers the best', () => {
  let s = recordPlay(NO_STREAK, '2026-09-27');
  assert.deepEqual(s, { last: '2026-09-27', count: 1, best: 1 });
  assert.equal(recordPlay(s, '2026-09-27'), s, 'playing twice in a day counts once');
  s = recordPlay(recordPlay(s, '2026-09-28'), '2026-09-29');
  assert.deepEqual(s, { last: '2026-09-29', count: 3, best: 3 });
  s = recordPlay(s, '2026-10-02');
  assert.deepEqual(s, { last: '2026-10-02', count: 1, best: 3 });
  // Still alive the day after; broken once a whole day goes by.
  assert.equal(currentStreak(s, '2026-10-03'), 1);
  assert.equal(currentStreak(s, '2026-10-04'), 0);
});
