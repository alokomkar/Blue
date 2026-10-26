import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threatLevel, heartPace, easeBpm, CALM_BPM, PANIC_BPM } from './heart.ts';

test('threatLevel is 0 with no bot around and 1 with one right on top of you', () => {
  assert.equal(threatLevel(Infinity, false), 0);
  assert.equal(threatLevel(40, false), 0);
  assert.equal(threatLevel(1, false), 1);
});

test('threatLevel rises as the nearest bot closes in', () => {
  let last = -1;
  for (let d = 16; d >= 2; d -= 1) {
    const t = threatLevel(d, false);
    assert.ok(t >= last, `threat fell as the bot got closer (d=${d})`);
    last = t;
  }
});

test('being chased keeps the threat high even from far away', () => {
  assert.ok(threatLevel(Infinity, true) >= 0.85);
  assert.equal(threatLevel(1, true), 1);
});

test('heartPace spans calm to panic', () => {
  assert.equal(heartPace(0).bpm, CALM_BPM);
  assert.equal(heartPace(1).bpm, PANIC_BPM);
  assert.ok(heartPace(0).volume < heartPace(1).volume);
});

test('easeBpm quickens faster than it settles', () => {
  const up = easeBpm(CALM_BPM, PANIC_BPM, 0.5) - CALM_BPM;
  const down = PANIC_BPM - easeBpm(PANIC_BPM, CALM_BPM, 0.5);
  assert.ok(up > down * 2);
  // Held long enough, it reaches the target.
  let bpm = CALM_BPM;
  for (let i = 0; i < 300; i++) bpm = easeBpm(bpm, PANIC_BPM, 1 / 60);
  assert.ok(Math.abs(bpm - PANIC_BPM) < 1);
});
