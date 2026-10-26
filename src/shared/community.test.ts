import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communityLine, statsToast } from './community.ts';
import type { Community } from './api.ts';

const c = (o: Partial<Community> = {}): Community => ({ played: 12, trained: 9, cleared: 5, deep: 2, top: [], you: null, ...o });

test('the community line says how far people have got, plainly', () => {
  assert.equal(communityLine(c()), '12 agents have played · 9 trained · 5 have cleared a job · 2 got to job 3');
  assert.equal(communityLine(c({ played: 1, trained: 0, cleared: 1, deep: 0 })), '1 agent has played · 1 has cleared a job');
  assert.equal(communityLine(c({ played: 4, trained: 3, cleared: 0, deep: 0 })), '4 agents have played · 3 trained · none has cleared a job yet');
});

test('the moderator’s stats fit a toast and give the clear rate', () => {
  const t = statsToast(c(), { started: 3, cleared: 1 }, { started: 20, cleared: 5 });
  assert.match(t, /Agents 12 · trained 9 · cleared a job 5 · job 3\+ 2/);
  assert.match(t, /Daily today: 3 started, 1 cleared/);
  assert.match(t, /Last 7 days: 20 started, 5 cleared \(25%\)/);
  assert.ok(t.length < 260, `${t.length} characters`);
  assert.match(statsToast(c(), { started: 3, cleared: 1 }, { started: 20, cleared: 5 }, 'Training reached 1:4'), /5 cleared \(25%\)\. Training reached 1:4\.$/);
  assert.doesNotMatch(statsToast(c(), { started: 0, cleared: 0 }, { started: 0, cleared: 0 }), /%/, 'no rate with nobody to divide by');
});
