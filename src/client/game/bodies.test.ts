import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyVisibility, lightAt, noticeRange, noticeRate, foundSuspicion, callsOthers, NOTICE_FULL_S, BODY_HIDDEN_PCT, BODY_MIN_NOTICE } from './bodies.ts';

const lamps = [
  { x: 0, y: 0, lit: true },
  { x: 6, y: 0, lit: false },
];

test('a body under a working light is plainly visible, and less so the further it lies from one', () => {
  assert.equal(bodyVisibility(lightAt(0, 0, lamps, false), false), 100);
  const near = bodyVisibility(lightAt(1, 0, lamps, false), false);
  const far = bodyVisibility(lightAt(2, 0, lamps, false), false);
  assert.ok(near < 100 && far < near, `${near} then ${far}`);
});

test('a switched-off or blacked-out stretch is pitch dark: a body there is hard to see, but never invisible', () => {
  const offLamp = bodyVisibility(lightAt(6, 0, lamps, false), false);
  const blackout = bodyVisibility(lightAt(0, 0, lamps, true), false);
  assert.equal(offLamp, 10);
  assert.equal(blackout, 10);
  assert.ok(offLamp <= BODY_HIDDEN_PCT);
});

test('inside a room a body is less visible than in the corridor under the same light', () => {
  const light = lightAt(0, 0, lamps, false);
  assert.ok(bodyVisibility(light, true) < bodyVisibility(light, false));
  assert.ok(bodyVisibility(light, true) > BODY_HIDDEN_PCT, 'a lit room still shows it');
  assert.ok(bodyVisibility(0, true) < bodyVisibility(0, false));
});

test('a guard notices a body from its full sight range at 100%, and only close up when it is hidden', () => {
  assert.equal(noticeRange(100, 10), 10);
  assert.equal(noticeRange(50, 10), 5);
  assert.equal(noticeRange(5, 10), BODY_MIN_NOTICE);
});

test('noticing a body builds over time, in proportion to how visible it is', () => {
  // Fully lit: a guard looking at it for NOTICE_FULL_S has it.
  assert.ok(Math.abs(noticeRate(100) * NOTICE_FULL_S - 1) < 1e-9);
  // At 10% it takes ten times as long, so a guard walking past (a second or two in range) doesn't notice it.
  assert.ok(Math.abs(1 / noticeRate(10) - 10 * NOTICE_FULL_S) < 1e-9);
  assert.ok(noticeRate(10) * 2 < 0.4, 'two seconds of looking at a hidden body is nowhere near enough');
  assert.equal(noticeRate(0), 0, 'a body nobody could see is never noticed');
  assert.equal(noticeRate(150), noticeRate(100));
});

test('a found body costs less suspicion the better it was hidden, and only a plain one calls the others', () => {
  assert.equal(foundSuspicion(100), 25);
  assert.ok(foundSuspicion(10) < 12 && foundSuspicion(10) >= 8);
  for (let v = 0; v < 100; v += 5) assert.ok(foundSuspicion(v) <= foundSuspicion(v + 5));
  assert.equal(callsOthers(100), true);
  assert.equal(callsOthers(40), false);
  assert.equal(callsOthers(10), false);
});
