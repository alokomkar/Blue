import test from 'node:test';
import assert from 'node:assert/strict';
import { markerFor, pingGap, strongest, warnLevel, ROAM_RANGE, TRACK_RANGE } from './dogwarn.ts';

test('a dog on the trail warns from far and ever harder; one just roaming only from close and only softly', () => {
  assert.equal(warnLevel({ dist: TRACK_RANGE, tracking: true }), 0);
  assert.ok(warnLevel({ dist: 5, tracking: true }) > warnLevel({ dist: 20, tracking: true }));
  assert.ok(warnLevel({ dist: 0, tracking: true }) <= 1);
  assert.equal(warnLevel({ dist: ROAM_RANGE + 1, tracking: false }), 0);
  assert.ok(warnLevel({ dist: 1, tracking: false }) <= 0.45);
  assert.ok(warnLevel({ dist: 1, tracking: false }) < warnLevel({ dist: 1, tracking: true }));
});

test('the ping quickens as the warning grows', () => {
  assert.ok(pingGap(1) < pingGap(0.5));
  assert.ok(pingGap(0.5) < pingGap(0));
  assert.ok(pingGap(1) > 0);
});

test('a dog in view is marked where it is; one out of view is marked on the edge, pointing its way', () => {
  const on = markerFor(0.2, -0.1, false, 0.8, true, 9);
  assert.equal(on.onScreen, true);
  assert.ok(Math.abs(on.x - 0.6) < 1e-9 && Math.abs(on.y - 0.55) < 1e-9);
  const right = markerFor(3, 0, false, 0.8, true, 9);
  assert.equal(right.onScreen, false);
  assert.ok(right.x > 0.9 && right.x <= 1 && Math.abs(right.y - 0.5) < 1e-9);
  assert.ok(Math.abs(right.angle) < 1e-9);
  const behind = markerFor(0, 0.2, true, 0.8, true, 9); // behind the camera flips: it is below the middle
  assert.equal(behind.onScreen, false);
  assert.ok(behind.y > 0.5);
});

test('only the strongest few are marked, loudest first', () => {
  const dogs = [4, 8, 2, 16, 26, 29, 40].map((dist) => ({ x: 0, z: 0, dist, tracking: true }));
  const { picks, top } = strongest(dogs);
  assert.equal(picks.length, 4);
  assert.equal(top?.dog.dist, 2);
  assert.deepEqual(picks.map((p) => p.dog.dist), [2, 4, 8, 16]);
});
