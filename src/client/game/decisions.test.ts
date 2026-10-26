import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockerOutcome, stockLockers, RIGGED_CHANCE } from './decisions.ts';

test('lockerOutcome: a document locker yields a document and nothing else', () => {
  const o = lockerOutcome('document');
  assert.equal(o.document, true);
  assert.equal(o.scoreDelta, 0);
  assert.equal(o.suspicionDelta, 0);
  assert.equal(o.ambush, false);
});

test('lockerOutcome: loot is +15 score, -5 suspicion, no ambush', () => {
  const o = lockerOutcome('loot');
  assert.deepEqual([o.scoreDelta, o.suspicionDelta, o.ambush, o.document], [15, -5, false, false]);
});

test('lockerOutcome: some loot lockers also hold an EMP charge; documents and rigged ones never do', () => {
  assert.equal(lockerOutcome('loot', () => 0.1).emp, 1);
  assert.equal(lockerOutcome('loot', () => 0.9).emp, 0);
  assert.equal(lockerOutcome('document', () => 0).emp, 0);
  assert.equal(lockerOutcome('rigged', () => 0).emp, 0);
});

test('lockerOutcome: rigged is -10 score and lights the fuse; the suspicion comes with the alarm, not the opening', () => {
  const o = lockerOutcome('rigged');
  assert.deepEqual([o.scoreDelta, o.suspicionDelta, o.ambush, o.document], [-10, 0, true, false]);
});

test('stockLockers: exactly `docs` documents in 2–3 lockers, never more than 3', () => {
  for (let i = 0; i < 500; i++) {
    const docs = 1 + (i % 3);
    const lockers = stockLockers(docs);
    assert.equal(lockers.filter((c) => c === 'document').length, docs);
    assert.ok(lockers.length >= 2 && lockers.length <= 3, `got ${lockers.length} lockers`);
  }
});

test('stockLockers: extra lockers are rigged at roughly RIGGED_CHANCE', () => {
  let extras = 0;
  let rigged = 0;
  for (let i = 0; i < 4000; i++) {
    for (const c of stockLockers(1)) {
      if (c === 'document') continue;
      extras++;
      if (c === 'rigged') rigged++;
    }
  }
  assert.ok(Math.abs(rigged / extras - RIGGED_CHANCE) < 0.04, `rigged share ${(rigged / extras).toFixed(3)}`);
});
