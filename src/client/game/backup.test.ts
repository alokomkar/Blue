import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_GAP_S, BACKUP_MAX, DROP_AGENT_MIN_M, SEARCH_FUZZ_CELLS, mayCallBackup, pickDropCell, searchCell, type DropCandidate } from './backup.ts';

const cell = (o: Partial<DropCandidate>): DropCandidate => ({ x: 0, y: 0, fromBody: 5, seesBody: false, fromAgent: 20, seenByAgent: false, ...o });

test('the backup comes down round a corner from the body: a few cells off, with no line to it', () => {
  const near = cell({ x: 1, fromBody: 1 });
  const far = cell({ x: 2, fromBody: 9 });
  const inView = cell({ x: 3, seesBody: true });
  const round = cell({ x: 4 });
  assert.equal(pickDropCell([near, far, inView, round], 0.5)?.x, 4);
  assert.equal(pickDropCell([near, far, inView], 0.5), null, 'nowhere fit');
});

test('not in the agent\'s face, and out of their sight when it can be', () => {
  const close = cell({ x: 1, fromAgent: DROP_AGENT_MIN_M - 1 });
  const seen = cell({ x: 2, seenByAgent: true });
  const unseen = cell({ x: 3 });
  assert.equal(pickDropCell([close, seen, unseen], 0)?.x, 3);
  assert.equal(pickDropCell([close, seen], 0)?.x, 2, 'the agent sees every cell that fits: one is used all the same');
});

test('the draw picks among the fitting cells', () => {
  const a = cell({ x: 1 });
  const b = cell({ x: 2 });
  assert.equal(pickDropCell([a, b], 0)?.x, 1);
  assert.equal(pickDropCell([a, b], 0.99)?.x, 2);
});

test('calls for backup are spaced out and capped', () => {
  assert.equal(mayCallBackup(BACKUP_GAP_S, 0), true);
  assert.equal(mayCallBackup(BACKUP_GAP_S - 1, 0), false);
  assert.equal(mayCallBackup(BACKUP_GAP_S, BACKUP_MAX), false);
});

test('it looks for the agent a few cells off from where they are', () => {
  for (const [a, b] of [[0, 0], [0.25, 1], [0.6, 0.5], [0.9, 1]] as const) {
    const c = searchCell({ x: 10, y: 10 }, a, b);
    assert.ok(Math.hypot(c.x - 10, c.y - 10) <= SEARCH_FUZZ_CELLS + 0.71);
  }
  assert.deepEqual(searchCell({ x: 4, y: 7 }, 0.3, 0), { x: 4, y: 7 });
});
