import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DASH_MAX_S, DASH_MIN_START, DASH_NOISE, DASH_RECHARGE_S, DASH_SIGHT, DASH_SPEED_FACTOR, DOUBLE_TAP_MS, FULL_DASH, TOUCH_DOUBLE_TAP_MS, isDoubleTap, tickDash, type DashState } from './dash.ts';

const run = (s: DashState, wants: boolean, seconds: number, dt = 1 / 60): { state: DashState; startedCount: number } => {
  let state = s;
  let startedCount = 0;
  for (let t = 0; t < seconds; t += dt) {
    const r = tickDash(state, wants, dt);
    state = r.state;
    if (r.started) startedCount++;
  }
  return { state, startedCount };
};

test('a second press soon after the first is a double-tap, and a slow one is not', () => {
  assert.equal(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS, DOUBLE_TAP_MS), true);
  assert.equal(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1, DOUBLE_TAP_MS), false);
  assert.ok(TOUCH_DOUBLE_TAP_MS >= DOUBLE_TAP_MS, 'a thumb gets a touch more time');
});

test('holding the gesture starts a dash at once, once, and drains the energy over a second and a half', () => {
  const first = tickDash(FULL_DASH, true, 1 / 60);
  assert.equal(first.started, true);
  assert.equal(first.state.active, true);
  const mid = run(first.state, true, 1);
  assert.equal(mid.state.active, true);
  assert.equal(mid.startedCount, 0, 'it starts once, not every frame');
  assert.ok(mid.state.energy > 0.2 && mid.state.energy < 0.5, `${mid.state.energy}`);
});

test('the dash stops when the energy is gone, and holding on does not start it again', () => {
  const spent = run(tickDash(FULL_DASH, true, 1 / 60).state, true, DASH_MAX_S + 0.5);
  assert.equal(spent.state.active, false);
  assert.equal(spent.state.energy < DASH_MIN_START, true);
  assert.equal(spent.startedCount, 0);
  const later = run(spent.state, true, DASH_RECHARGE_S + 1);
  assert.equal(later.state.active, false, 'still held: still no dash');
  assert.equal(later.startedCount, 0);
});

test('letting go refills the energy, and a fresh gesture then dashes again', () => {
  const spent = run(tickDash(FULL_DASH, true, 1 / 60).state, true, DASH_MAX_S + 0.5).state;
  const rested = run(spent, false, DASH_RECHARGE_S + 0.5).state;
  assert.equal(rested.energy, 1);
  assert.equal(tickDash(rested, true, 1 / 60).started, true);
});

test('a dash can’t start on a nearly flat battery, but can once it has the minimum back', () => {
  const low: DashState = { energy: DASH_MIN_START - 0.05, active: false, spent: false };
  assert.equal(tickDash(low, true, 1 / 60).started, false);
  const ok: DashState = { energy: DASH_MIN_START + 0.01, active: false, spent: false };
  assert.equal(tickDash(ok, true, 1 / 60).started, true);
});

test('a short dash then a release keeps what is left and refills from there', () => {
  const burst = run(tickDash(FULL_DASH, true, 1 / 60).state, true, 0.5).state;
  assert.ok(burst.energy < 1 && burst.energy > 0.5);
  const after = tickDash(burst, false, 1 / 60).state;
  assert.equal(after.active, false);
  assert.ok(after.energy >= burst.energy);
});

test('the dash is faster than a walk, louder than one, and seen from further', () => {
  assert.ok(DASH_SPEED_FACTOR > 1.3 && DASH_SPEED_FACTOR < 1.6);
  assert.ok(DASH_NOISE > 9, 'walking carries 9');
  assert.ok(DASH_SIGHT > 1 && DASH_SIGHT <= 1.3);
});
