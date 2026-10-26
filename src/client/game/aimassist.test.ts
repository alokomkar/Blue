import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSIST_HOLDOFF_S, ASSIST_RATE, assistPitch, crosshairNote, headPitch } from './aimassist.ts';

test('the tilt to a head is the angle up to it', () => {
  assert.ok(Math.abs(headPitch(1.2, 2.0, 7) - Math.atan2(0.8, 7)) < 1e-12);
  assert.ok(headPitch(1.2, 2.0, 12) < headPitch(1.2, 2.0, 7));
  assert.ok(headPitch(1.2, 1.0, 7) < 0);
});

test('the assist eases up to the head at a steady rate and then stays put', () => {
  const want = 0.1;
  let p = 0;
  p = assistPitch(p, want, 5, 0.05);
  assert.ok(Math.abs(p - ASSIST_RATE * 0.05) < 1e-12);
  for (let i = 0; i < 20; i++) p = assistPitch(p, want, 5, 0.05);
  assert.equal(p, want);
  assert.equal(assistPitch(want, want, 5, 0.05), want);
});

test('it keeps out of the way for a moment after the player tilts by hand, and eases down as well as up', () => {
  assert.equal(assistPitch(0.02, 0.1, ASSIST_HOLDOFF_S - 0.01, 0.05), 0.02);
  assert.ok(assistPitch(0.02, 0.1, ASSIST_HOLDOFF_S + 0.01, 0.05) > 0.02);
  assert.ok(assistPitch(0.2, 0.1, 5, 0.05) < 0.2);
});

test('the crosshair says head, or that a heavy’s body is armour', () => {
  assert.equal(crosshairNote('head', true), 'HEAD');
  assert.equal(crosshairNote('body', true), 'ARMOUR · AIM HIGHER');
  assert.equal(crosshairNote('body', false), '');
  assert.equal(crosshairNote(null, true), '');
});
