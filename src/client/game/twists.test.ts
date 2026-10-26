import test from 'node:test';
import assert from 'node:assert/strict';
import { TWISTS, TWIST_IDS, TWIST_NOTES, SILENT_DOGS, SILENT_MAX_COLS, SILENT_MAX_ROWS, fitsContract, storyTwist, dailyTwists, mayShare, timedTwists, applyTwists, chipText, DAILY_BUDGET, FIRST_TWIST_JOB, TIMER_S } from './twists.ts';
import { CONTRACT_IDS } from '../../shared/contracts.ts';

test('story mode gives no twist before the fourth job, then one, going round the list with no repeat running', () => {
  for (let n = 1; n < FIRST_TWIST_JOB; n++) assert.deepEqual(storyTwist(n), []);
  let last: string | null = null;
  const seen = new Set<string>();
  for (let n = FIRST_TWIST_JOB; n < FIRST_TWIST_JOB + 12; n++) {
    const t = storyTwist(n);
    assert.equal(t.length, 1);
    assert.notEqual(t[0], last);
    last = t[0]!;
    seen.add(last);
  }
  assert.equal(seen.size, TWIST_IDS.length, 'every twist comes round');
});

test('a silent night comes round, never on a sabotage, and its floor is a small one', () => {
  const nights: number[] = [];
  for (let n = FIRST_TWIST_JOB; n < FIRST_TWIST_JOB + 14; n++) if (storyTwist(n)[0] === 'silent') nights.push(n);
  assert.ok(nights.length >= 2, 'it comes round twice in fourteen jobs');
  for (let n = FIRST_TWIST_JOB; n < FIRST_TWIST_JOB + 14; n++) assert.notEqual(storyTwist(n, 'sabotage')[0], 'silent');
  assert.equal(fitsContract('silent', 'sabotage'), false);
  assert.equal(fitsContract('silent', 'extract'), true);
  assert.ok(SILENT_MAX_COLS <= 10 && SILENT_MAX_ROWS <= 7);
});

test('every twist has a note for the briefing', () => {
  for (const id of TWIST_IDS) assert.ok(TWIST_NOTES[id].title.length > 2 && TWIST_NOTES[id].text.length > 30, id);
});

test('a Daily gets two twists within the budget, never a clashing pair, and the same two for the same seed', () => {
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pairs = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const t = dailyTwists(rnd);
    assert.ok(t.length >= 1 && t.length <= 2);
    assert.ok(!t.includes('silent') || !(t.includes('timer') || t.includes('shiftchange') || t.includes('reinforcements')), `${t.join('+')}: nothing to shift, reinforce or race`);
    if (t.length === 2) {
      assert.ok(mayShare(t[0]!, t[1]!), `${t.join('+')} clash`);
      assert.ok(TWISTS[t[0]!].cost + TWISTS[t[1]!].cost <= DAILY_BUDGET);
      pairs.add([...t].sort().join('+'));
    }
  }
  assert.ok(pairs.size >= 6, `only ${pairs.size} different pairs come up`);
  const a = dailyTwists(((): (() => number) => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })());
  const b = dailyTwists(((): (() => number) => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })());
  assert.deepEqual(a, b);
});

test('the timed twists have a moment, and the clock has a generous window for every contract', () => {
  assert.deepEqual(timedTwists(['shiftchange', 'lightkit']).map((t) => t.id), ['shiftchange']);
  const lock = timedTwists(['lockdown'])[0]!;
  assert.ok(lock.at > 30 && lock.lasts >= 10 && lock.lasts <= 30, 'a lockdown that starts after the first minute and is over in half');
  for (const c of CONTRACT_IDS) assert.ok(TIMER_S[c] >= 300, `${c}: ${TIMER_S[c]} s is too short`);
});

test('twists change the counts they say they do, and nothing else', () => {
  const base = { guards: 3, watchdogs: 1, blackouts: 1, blackoutCells: 14, trapsAtStart: 2 };
  assert.deepEqual(applyTwists(base, []), { ...base, flashes: null });
  assert.equal(applyTwists(base, ['lightsout']).blackouts, 3);
  assert.equal(applyTwists(base, ['reinforcements']).guards, 4);
  assert.equal(applyTwists(base, ['reinforcements']).watchdogs, 2);
  const light = applyTwists(base, ['lightkit']);
  assert.equal(light.trapsAtStart, 0);
  assert.equal(light.flashes, 0);
  assert.equal(light.guards, 3);
  assert.equal(chipText(['lockdown', 'lightkit']), 'LOCKDOWN · LIGHT KIT');
  const silent = applyTwists(base, ['silent']);
  assert.equal(silent.guards, 0);
  assert.equal(silent.watchdogs, SILENT_DOGS);
  assert.equal(applyTwists({ ...base, watchdogs: 5 }, ['silent']).watchdogs, 5, 'never fewer dogs than the job had');
});

test('a Daily on a sabotage is never a silent night', () => {
  let seed = 99;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < 300; i++) assert.ok(!dailyTwists(rnd, 'sabotage').includes('silent'));
});
