import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDE_GOALS, storySideGoal, dailySideGoal, sideBroken, FIRST_SIDE_JOB, SIDE_BONUS, type SideStats, type SideGoalId } from './sidegoals.ts';

const clean: SideStats = { alarms: 0, timesSpotted: 0, bodiesFound: 0, shotsFired: 0, empsUsed: 0, trapsSet: 0, flashesUsed: 0, seconds: 100, parS: 300 };

test('story mode gives a side goal from the third job, going round the list with none repeated running', () => {
  assert.equal(storySideGoal(1), null);
  assert.equal(storySideGoal(2), null);
  const seen = new Set<string>();
  let last: string | null = null;
  for (let n = FIRST_SIDE_JOB; n < FIRST_SIDE_JOB + 12; n++) {
    const g = storySideGoal(n);
    assert.ok(g);
    assert.notEqual(g, last);
    last = g;
    seen.add(g!);
  }
  assert.equal(seen.size, Object.keys(SIDE_GOALS).length);
});

test('a goal the twist makes pointless is skipped, and a Daily draws a sensible one', () => {
  for (let n = FIRST_SIDE_JOB; n < FIRST_SIDE_JOB + 12; n++) assert.notEqual(storySideGoal(n, ['lightkit']), 'bare');
  let s = 99;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const g = dailySideGoal(rnd, ['lightkit']);
    assert.notEqual(g, 'bare');
    seen.add(g);
  }
  assert.ok(seen.size >= 4);
});

test('a clean run breaks none of them, and each is broken by the thing it names', () => {
  for (const id of Object.keys(SIDE_GOALS) as SideGoalId[]) assert.equal(sideBroken(id, clean), false, id);
  assert.equal(sideBroken('ghost', { ...clean, alarms: 1 }), true);
  assert.equal(sideBroken('unseen', { ...clean, timesSpotted: 1 }), true);
  assert.equal(sideBroken('tidy', { ...clean, bodiesFound: 1 }), true);
  assert.equal(sideBroken('swift', { ...clean, seconds: 301 }), true);
  assert.equal(sideBroken('swift', { ...clean, seconds: 300 }), false);
  assert.equal(sideBroken('quiet', { ...clean, shotsFired: 1 }), true);
  assert.equal(sideBroken('bare', { ...clean, flashesUsed: 1 }), true);
  assert.equal(sideBroken('bare', { ...clean, trapsSet: 1 }), true);
  assert.equal(sideBroken('bare', { ...clean, empsUsed: 1 }), true);
  assert.equal(sideBroken('ghost', { ...clean, shotsFired: 5, timesSpotted: 3 }), false, 'only the alarm breaks "no alarms"');
  assert.ok(SIDE_BONUS > 0);
});
