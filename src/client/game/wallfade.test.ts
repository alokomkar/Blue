import test from 'node:test';
import assert from 'node:assert/strict';
import { blocking, bodySamples, segmentHitsBox, stepFade, wallBox } from './wallfade.ts';

const WALL = wallBox(0, 0, 4, true, 0.28, 3, 0);

test('a line from the camera down to the agent through a wall hits it; one over or beside it does not', () => {
  // The camera above and behind (+z), the agent beyond the wall (-z), at chest height.
  assert.equal(segmentHitsBox({ x: 0, y: 2.2, z: 3 }, { x: 0, y: 1, z: -3 }, WALL), true);
  // The camera so high the line clears the 3 m wall where it crosses.
  assert.equal(segmentHitsBox({ x: 0, y: 12, z: 1 }, { x: 0, y: 4, z: -3 }, WALL), false);
  // Off to the side of the wall's end.
  assert.equal(segmentHitsBox({ x: 5, y: 2, z: 3 }, { x: 5, y: 1, z: -3 }, WALL), false);
  // Both ends on the same side.
  assert.equal(segmentHitsBox({ x: 0, y: 8, z: 3 }, { x: 0, y: 1, z: 1 }, WALL), false);
});

test('a wall with a margin goes too when the line only grazes it', () => {
  const grazed = { x: 2.4, y: 1.5, z: 3 };
  const to = { x: 2.4, y: 1.5, z: -3 };
  assert.equal(segmentHitsBox(grazed, to, WALL), false);
  assert.equal(segmentHitsBox(grazed, to, wallBox(0, 0, 4, true, 0.28, 3, 0.6)), true);
});

test('the fade eases to its goal and settles there', () => {
  let f = 0;
  for (let i = 0; i < 60; i++) f = stepFade(f, 1, 1 / 60);
  assert.equal(f, 1);
  assert.ok(stepFade(0, 1, 0.016) > 0 && stepFade(0, 1, 0.016) < 1);
  assert.equal(stepFade(1, 0, 5), 0);
});

test('the agent counts as seen only if the view reaches every part of them: a wall hiding just their feet still fades', () => {
  const cam = { x: 0, y: 8, z: 7 };
  const stand = { x: 0, y: 0, z: 1.5 };
  const wall = wallBox(0, 0, 4, true, 0.28, 3, 0.1);
  // the agent far enough from the wall that the sight line clears it: seen, nothing fades
  assert.deepEqual(blocking(cam, bodySamples(cam, { x: 0, y: 0, z: 4 }), [wall]), [false]);
  // close behind it: the line to the feet is cut by the wall, so it fades
  assert.deepEqual(blocking(cam, bodySamples(cam, { x: 0, y: 0, z: -0.8 }), [wall]), [true]);
  // a wall off to one side of the line of sight is left alone, however near
  const aside = wallBox(6, 0, 4, true, 0.28, 3, 0.1);
  assert.deepEqual(blocking(cam, bodySamples(cam, stand), [aside]), [false]);
});

test('walls on the camera\'s side fade with how near the agent is, and ease out with distance', async () => {
  const { behindFade } = await import('./wallfade.ts');
  assert.equal(behindFade(1, 5, 2.5, 14), 1, 'close and well toward the camera: all the way');
  assert.equal(behindFade(14, 5, 2.5, 14), 0, 'at the radius: nothing');
  const mid = behindFade(8, 5, 2.5, 14);
  assert.ok(mid > 0.2 && mid < 0.8, `a ramp between (${mid})`);
  assert.ok(behindFade(5, 5, 2.5, 14) > behindFade(9, 5, 2.5, 14), 'nearer fades more');
  assert.equal(behindFade(3, 0.4, 2.5, 14), 0, 'not on the camera\'s side');
  assert.ok(behindFade(3, 1.2, 2.5, 14) < behindFade(3, 4, 2.5, 14), 'only just on the camera\'s side fades less');
});
