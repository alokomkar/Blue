import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverPitch, coverBackAction, aimInput } from './cover-aim.ts';

test('cover aiming tilts both ways and clamps extreme input', () => {
  assert.ok(coverPitch(0, 1, 0, 1, 0.1) > 0);
  assert.ok(coverPitch(0, -1, 0, 1, 0.1) < 0);
  assert.ok(coverPitch(0, 0, -10, 1, 0.1) > 0);
  assert.equal(coverPitch(0, 0, 0, 1, 0), 0);
  assert.equal(coverPitch(0, 1, -10000, 1, 1), 0.8);
  assert.equal(coverPitch(0, -1, 10000, 1, 1), -0.8);
});
test('back tilts while aiming, exits only while ducked and released since duck', () => {
  {
    assert.equal(coverBackAction(true, false, -1), 'none');
    assert.equal(coverBackAction(false, true, -1), 'none');
    assert.equal(coverBackAction(false, false, -1), 'leave');
    assert.equal(coverBackAction(false, false, -0.5), 'none');
  }
});

test('mobile aiming reduces both directions by fifteen percent, desktop stays unchanged', () => {
  for (const input of [-1, -0.4, 0, 0.4, 1]) {
    assert.equal(aimInput(input, true), input * 0.85);
    assert.equal(aimInput(input, false), input);
  }
});

test('configurable aim multiplier affects both desktop and touch without changing defaults', () => {
  for (const touch of [false, true]) for (const axis of [-1, 0, 1]) {
    assert.equal(aimInput(axis, touch, 0.5), aimInput(axis, touch) * 0.5);
    assert.equal(aimInput(axis, touch, 2), aimInput(axis, touch) * 2);
  }
});
