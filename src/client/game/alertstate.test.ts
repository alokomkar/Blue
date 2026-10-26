import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAUTION_OFF, CAUTION_ON, decayedSuspicion, EVASION_AFTER_S, EVASION_S, QUIET, standsDown, stepAlert } from './alertstate.ts';

const calm = { alarm: false, suspicion: 0, hunted: false };

test('quiet until suspicion climbs, then caution, which holds until it falls well back', () => {
  let s = stepAlert(QUIET, calm, 0.1);
  assert.equal(s.phase, 'quiet');
  s = stepAlert(s, { ...calm, suspicion: CAUTION_ON }, 0.1);
  assert.equal(s.phase, 'caution');
  s = stepAlert(s, { ...calm, suspicion: CAUTION_ON - 5 }, 0.1);
  assert.equal(s.phase, 'caution', 'no flicker just under the mark');
  s = stepAlert(s, { ...calm, suspicion: CAUTION_OFF - 1 }, 0.1);
  assert.equal(s.phase, 'quiet');
});

test('with the alarm up it is alert while something is after the agent, and evasion once nothing has been for a few seconds', () => {
  let s = stepAlert(QUIET, { alarm: true, suspicion: 80, hunted: true }, 0.1);
  assert.equal(s.phase, 'alert');
  for (let t = 0; t < EVASION_AFTER_S - 0.5; t += 0.5) s = stepAlert(s, { alarm: true, suspicion: 80, hunted: false }, 0.5);
  assert.equal(s.phase, 'alert');
  s = stepAlert(s, { alarm: true, suspicion: 80, hunted: false }, 1);
  assert.equal(s.phase, 'evasion');
  s = stepAlert(s, { alarm: true, suspicion: 80, hunted: true }, 0.1);
  assert.equal(s.phase, 'alert', 'seen again');
});

test('the alarm clearing drops to caution or quiet by what suspicion is left', () => {
  const s0 = stepAlert(QUIET, { alarm: true, suspicion: 80, hunted: false }, 5);
  assert.equal(s0.phase, 'evasion');
  assert.equal(stepAlert(s0, { alarm: false, suspicion: 40, hunted: false }, 0.1).phase, 'caution');
  assert.equal(stepAlert(s0, { alarm: false, suspicion: 5, hunted: false }, 0.1).phase, 'quiet');
});

test('the search runs its course, and is restarted by being seen again', () => {
  let s = QUIET;
  const searching = { alarm: true, suspicion: 80, hunted: false };
  for (let t = 0; t < EVASION_AFTER_S + EVASION_S - 3; t++) s = stepAlert(s, searching, 1);
  assert.equal(s.phase, 'evasion');
  assert.equal(standsDown(s), false);
  s = stepAlert(s, searching, 2);
  assert.equal(standsDown(s), true);
  const seen = stepAlert(s, { ...searching, hunted: true }, 0.1);
  assert.equal(seen.phase, 'alert');
  assert.equal(seen.evasionFor, 0);
});

test('suspicion eases off only while nothing is after the agent and the alarm is down', () => {
  assert.ok(decayedSuspicion(30, 'caution', false, 1) < 30);
  assert.ok(decayedSuspicion(30, 'caution', false, 1) < decayedSuspicion(30, 'quiet', false, 1));
  assert.equal(decayedSuspicion(30, 'caution', true, 1), 30);
  assert.equal(decayedSuspicion(80, 'alert', false, 1), 80);
  assert.equal(decayedSuspicion(80, 'evasion', false, 1), 80);
  assert.equal(decayedSuspicion(0.1, 'quiet', false, 5), 0);
});
