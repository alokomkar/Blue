import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseFor, caseLine, carryOver, outcomeOf, easeFor, mergeCarry, describeCarry, NO_CARRY, EASE_AFTER, FIGURES, CASE_EPOCH } from './campaign.ts';
import { dailyLevel, nextDay, weekSoFar, type DailyResult } from './daily.ts';

test('a case runs Monday to Sunday, one route a week, rotating through them all', () => {
  assert.deepEqual(caseFor(CASE_EPOCH), { number: 1, figure: FIGURES[0], night: 0 });
  assert.equal(caseFor('2026-09-27'), null, 'no case before the first');
  assert.equal(caseFor('2026-10-04')!.night, 6, 'Sunday is the last night');
  assert.equal(caseFor('2026-10-05')!.number, 2, 'Monday opens the next case');
  assert.equal(caseFor('2026-10-05')!.night, 0);
  const seen = new Set<string>();
  let day = CASE_EPOCH;
  for (let i = 0; i < 7 * FIGURES.length; i++, day = nextDay(day)) seen.add(caseFor(day)!.figure.name);
  assert.equal(seen.size, FIGURES.length);
});

test('the case climbs with the week: Monday is the easiest daily job, Sunday the hardest', () => {
  let day = '2026-09-28';
  const levels: number[] = [];
  for (let i = 0; i < 7; i++, day = nextDay(day)) levels.push(dailyLevel(day));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
});

test('the daily post names the case and the night', () => {
  assert.equal(caseLine(CASE_EPOCH), 'The Harbour Route, night 1 of 7');
  assert.equal(caseLine('2026-10-04'), 'The Harbour Route, night 7 of 7');
  assert.equal(caseLine('2026-09-27'), null);
});

test('every route has seven nights, each with a site and files', () => {
  for (const f of FIGURES) {
    assert.equal(f.nights.length, 7);
    for (const n of f.nights) assert.ok(n.site.name && n.site.what && n.files, `${f.name}: an empty night`);
  }
});

test('the week so far is Monday up to the day before', () => {
  assert.deepEqual(weekSoFar('2026-09-28'), []);
  assert.deepEqual(weekSoFar('2026-09-30'), ['2026-09-28', '2026-09-29']);
  assert.equal(weekSoFar('2026-10-04').length, 6);
});

const run = (r: Partial<DailyResult>): DailyResult => ({
  day: '2026-09-28',
  cleared: true,
  points: 100,
  grade: 'A',
  seconds: 200,
  documents: 3,
  totalDocuments: 3,
  spotted: 0,
  takedowns: 0,
  ...r,
});

test('a night is clean, noisy, burned, caught, unfinished or missed', () => {
  assert.equal(outcomeOf(false, null), 'missed');
  assert.equal(outcomeOf(true, null), 'unfinished');
  assert.equal(outcomeOf(true, run({ cleared: false, grade: null, points: 0 })), 'caught');
  assert.equal(outcomeOf(true, run({ burned: true })), 'burned');
  assert.equal(outcomeOf(true, run({ alarms: 2 })), 'noisy');
  assert.equal(outcomeOf(true, run({ alarms: 0, burned: false })), 'clean');
  assert.equal(outcomeOf(true, run({})), 'clean', 'an older result without the fields reads as clean');
});

test('a clean night buys a perk; a loud one puts guards on edge; a burned or caught one puts the sites on alert', () => {
  const perk = carryOver('clean');
  assert.equal(perk.kind, 'perk');
  assert.ok(perk.extraEmp > 0 && perk.markNetwork);
  assert.ok(carryOver('noisy').reactionS < 0);
  for (const bad of ['burned', 'caught'] as const) {
    const c = carryOver(bad);
    assert.equal(c.kind, 'alert');
    assert.ok(c.reactionS < 0 && c.logWindowS < 0);
  }
  // Missing a night isn't punished, and without an account nothing carries.
  const missed = carryOver('missed', ['clean', 'missed']);
  assert.equal(missed.kind, 'missed');
  assert.equal(carryOver('missed', []).kind, 'none', 'nothing to say on a case’s first night, or to someone new');
  assert.equal(carryOver('missed', ['missed']).kind, 'none');
  assert.deepEqual([missed.reactionS, missed.logWindowS, missed.extraEmp, missed.markNetwork], [0, 0, 0, false]);
  assert.equal(carryOver(null).kind, 'none');
});

test('a job gives nothing until it has beaten you twice, then a little more each try, holding after the fifth', () => {
  assert.deepEqual([easeFor(0), easeFor(EASE_AFTER - 1)], [{}, {}]);
  const tries = [2, 3, 4, 5, 9].map((n) => mergeCarry(NO_CARRY, easeFor(n)));
  for (const c of tries) assert.ok(c.eased && c.reactionS > 0 && c.logWindowS > 0 && c.extraEmp >= 1);
  for (let i = 1; i < tries.length; i++) {
    assert.ok(tries[i]!.reactionS >= tries[i - 1]!.reactionS && tries[i]!.logWindowS >= tries[i - 1]!.logWindowS && tries[i]!.extraEmp >= tries[i - 1]!.extraEmp);
  }
  assert.deepEqual(tries[3], tries[4], 'it stops growing');
  assert.equal(mergeCarry(NO_CARRY, {}).eased, false);
});

test('the help says what it does, in the good tone', () => {
  const lines = describeCarry(mergeCarry(NO_CARRY, easeFor(3)));
  assert.ok(lines.every((l) => l.tone === 'good'));
  assert.ok(lines.some((l) => /slower/.test(l.text)) && lines.some((l) => /later/.test(l.text)) && lines.some((l) => /EMP/.test(l.text)));
});

test('help stacks on last night\'s carry without cancelling it', () => {
  const both = mergeCarry(carryOver('noisy'), easeFor(2));
  assert.equal(both.kind, 'watch');
  assert.ok(both.eased && both.reactionS > 0);
});
