import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAZE_S, DOG_PANIC_RADIUS, HEAVY_DAZE_S, NO_SLOW, PANIC_QUIET_S, PANIC_RADIUS, PANIC_SUSPICION, SLOW_S, SLOW_SCALE, dazeFor, endSlow, panicking, stepSlow } from './flash.ts';

test('guards and dogs are dazed for about ten seconds, a heavy for half of it, and drones and mines not at all', () => {
  assert.equal(dazeFor('patrol'), DAZE_S);
  assert.equal(dazeFor('sentry'), DAZE_S);
  assert.equal(dazeFor('hunter'), DAZE_S);
  assert.equal(dazeFor('watchdog'), DAZE_S);
  assert.equal(dazeFor('heavy'), HEAVY_DAZE_S);
  assert.ok(HEAVY_DAZE_S < DAZE_S);
  assert.equal(dazeFor('drone'), null);
  assert.equal(dazeFor('crawler'), null);
  assert.equal(DAZE_S, 10);
});

test('a guard onto the agent and close, with suspicion high, is a panic; a guard far off or suspicion low is not', () => {
  const guard = { kind: 'patrol' as const, alert: true, disabled: false, dist: PANIC_RADIUS - 1 };
  assert.equal(panicking([guard], PANIC_SUSPICION), true);
  assert.equal(panicking([guard], PANIC_SUSPICION - 1), false);
  assert.equal(panicking([{ ...guard, dist: PANIC_RADIUS + 1 }], 90), false);
  assert.equal(panicking([{ ...guard, alert: false }], 90), false);
  assert.equal(panicking([{ ...guard, disabled: true }], 90), false);
});

test('a dog on the agent’s trail is a panic from further off and whatever the suspicion, since dogs maul without it', () => {
  const dog = { kind: 'watchdog' as const, alert: true, disabled: false, dist: DOG_PANIC_RADIUS - 0.5 };
  assert.equal(panicking([dog], 0), true);
  assert.equal(panicking([{ ...dog, dist: DOG_PANIC_RADIUS + 0.5 }], 100), false);
});

test('a drone or a mine onto the agent is not something a flash helps with, so it is no panic', () => {
  assert.equal(panicking([{ kind: 'drone', alert: true, disabled: false, dist: 2 }], 100), false);
  assert.equal(panicking([{ kind: 'crawler', alert: true, disabled: false, dist: 2 }], 100), false);
});

test('the first moment of a panic gets a beat of slow motion, once, and only with a grenade to throw', () => {
  const first = stepSlow(NO_SLOW, true, 2, 0.016);
  assert.equal(first.scale, SLOW_SCALE);
  assert.ok(first.state.left > SLOW_S - 0.05);
  // It runs out on its own, in real time.
  let s = first.state;
  let scale = first.scale;
  for (let t = 0; t < SLOW_S + 0.2; t += 0.05) ({ state: s, scale } = stepSlow(s, true, 2, 0.05));
  assert.equal(scale, 1);
  // Still panicking: no second beat in the same chase.
  assert.equal(stepSlow(s, true, 2, 0.016).scale, 1);
  // No grenade, no slow motion.
  assert.equal(stepSlow(NO_SLOW, true, 0, 0.016).scale, 1);
});

test('after the chase has been over a while the next one gets its own beat; a short lull does not', () => {
  let s = stepSlow(NO_SLOW, true, 2, 0.016).state;
  s = stepSlow(s, false, 2, PANIC_QUIET_S - 1).state;
  assert.equal(s.used, true);
  s = stepSlow(s, false, 2, 1.1).state;
  assert.equal(s.used, false);
  assert.equal(stepSlow(s, true, 2, 0.016).scale, SLOW_SCALE);
});

test('throwing it ends the slow motion at once', () => {
  const s = endSlow(stepSlow(NO_SLOW, true, 2, 0.016).state);
  assert.equal(stepSlow(s, true, 2, 0.016).scale, 1);
});
