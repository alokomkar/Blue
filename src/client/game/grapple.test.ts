import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepStrength, strainState, HOLD_S, HOVER_S, SHIMMY_HOLD_S, REGAIN_FLOOR_S, REGAIN_PERCH_S, MIN_TO_HOOK, HAUL_COST } from './grapple.ts';
import { hookPoint, type PipePlan } from './pipes.ts';

test('hanging still lasts HOLD_S from full, shimmying is quicker, and it never goes past either end', () => {
  let s = 1;
  for (let t = 0; t < HOLD_S; t += 0.1) s = stepStrength(s, 'hold', 0.1);
  assert.ok(s < 0.02);
  s = 1;
  for (let t = 0; t < SHIMMY_HOLD_S; t += 0.1) s = stepStrength(s, 'shimmy', 0.1);
  assert.ok(s < 0.02);
  assert.equal(stepStrength(0, 'hold', 5), 0);
  assert.equal(stepStrength(1, 'perch', 5), 1);
});

test('hovering lowered tires the arms faster than hanging, slower than shimmying', () => {
  assert.ok(HOVER_S < HOLD_S && HOVER_S > SHIMMY_HOLD_S);
  assert.ok(stepStrength(1, 'hover', 1) < stepStrength(1, 'hold', 1));
});

test('strength comes back faster on a platform than on the floor', () => {
  assert.ok(REGAIN_PERCH_S < REGAIN_FLOOR_S);
  assert.ok(stepStrength(0.2, 'perch', 1) > stepStrength(0.2, 'ground', 1));
});

test('a grapple can be fired again once enough is back, and a full grip gets you a real hang after the haul', () => {
  assert.ok(MIN_TO_HOOK + 0 < 1 - HAUL_COST, 'a haul leaves something to hang on with');
  assert.equal(strainState(1), 'fresh');
  assert.equal(strainState(0.2), 'tired');
  assert.equal(strainState(0), 'spent');
});

const plan: PipePlan = { towers: [], lines: [{ axis: 'x', at: 2, from: 0, to: 6 }, { axis: 'z', at: 4, from: 0, to: 5 }] };

test('the hook takes the pipe ahead, not the one behind, and none out of range', () => {
  // At (8, 8) [cell 4 m] facing +x: the row (at z = 8) runs right through; the column at x = 16 is 8 m ahead.
  const ahead = hookPoint(plan, 8, 6, { x: 1, z: 0 }, 4, 9)!;
  assert.equal(ahead.grip.line, 0);
  assert.equal(ahead.grip.dir, 1);
  assert.equal(hookPoint(plan, 8, 40, { x: 0, z: 1 }, 4, 9), null);
  // Facing away from the column with only it in reach: the row behind is favoured over nothing, the column behind is refused.
  const behind = hookPoint({ towers: [], lines: [{ axis: 'z', at: 0, from: 0, to: 5 }] }, 8, 8, { x: 1, z: 0 }, 4, 9);
  assert.equal(behind, null);
});

import { HOVER_HANDS_IN, HOVER_HIPS_BACK, HOVER_SWING_M, hoverPose, nearestTarget, strainChanged, strainView } from './grapple.ts';

test('the grip meter is up while hanging or hauling, and gone the moment the agent lets go, however tired they still are', () => {
  assert.equal(strainView(1, false), null);
  assert.equal(strainView(0.2, false), null, 'tired arms, on the ground: no meter');
  assert.equal(strainView(0, false), null);
  assert.deepEqual(strainView(1, true), { fill: 1, state: 'fresh' }, 'hanging on full arms still shows it');
  assert.equal(strainView(0.1, true)!.state, 'tired');
  assert.equal(strainView(0, true)!.state, 'spent');
});

test('the HUD is told when the meter appears, moves enough to see, and goes', () => {
  const hanging = strainView(0.6, true);
  assert.equal(strainChanged(null, hanging), true, 'it appears');
  assert.equal(strainChanged(hanging, strainView(0.601, true)), false, 'a tiny move is not worth telling');
  assert.equal(strainChanged(hanging, strainView(0.5, true)), true);
  assert.equal(strainChanged(hanging, strainView(0.6, false)), true, 'it goes the moment they let go');
  assert.equal(strainChanged(null, null), false);
});

test('a flat hover needs a console within reach of the line: the nearest one, and none means upright', () => {
  const grip = { x: 10, z: 10 };
  assert.equal(nearestTarget(grip, []), null);
  assert.equal(nearestTarget(grip, [{ x: 10 + HOVER_SWING_M + 0.5, z: 10 }]), null, 'out of reach');
  const near = nearestTarget(grip, [{ x: 13, z: 10 }, { x: 11, z: 11 }, { x: 10, z: 40 }])!;
  assert.deepEqual([near.x, near.z], [11, 11]);
  assert.ok(Math.abs(near.d - Math.SQRT2) < 1e-9);
  // Half a cell (2 m) either way is always inside the swing, so a pipe over a console's cell always reaches it.
  assert.ok(Math.hypot(2, 2) <= HOVER_SWING_M + 1e-9 || HOVER_SWING_M >= 2);
});

test('the agent faces the console the way a standing agent would, hands over its near edge', () => {
  // A console 0.9 m ahead of the standing spot, which faces +z: the hover faces +z too, hips just behind the spot's hands' reach.
  const pose = hoverPose({ x: 3, z: -2 }, { x: 0, z: 0, facing: 0 }, 1.234);
  assert.equal(pose.angle, 0, 'the console’s own facing, not the line’s or the approach’s');
  assert.ok(Math.abs(pose.x) < 1e-9 && Math.abs(pose.z - (HOVER_HANDS_IN - HOVER_HIPS_BACK)) < 1e-9);
  // Facing -x: the hips are put the same short distance along that way.
  const west = hoverPose({ x: 0, z: 0 }, { x: 5, z: 5, facing: -Math.PI / 2 }, 0);
  assert.ok(Math.abs(west.angle + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.hypot(west.x - 5, west.z - 5) - Math.abs(HOVER_HANDS_IN - HOVER_HIPS_BACK)) < 1e-9);
  // No facing known: toward the console from the line's point, or the line's own facing when right over it.
  assert.ok(Math.abs(hoverPose({ x: 0, z: 0 }, { x: 0, z: 2 }, 1.2).angle) < 1e-9);
  assert.equal(hoverPose({ x: 1, z: 1 }, { x: 1.1, z: 1 }, 0.7).angle, 0.7);
});

test('a console’s facing travels with it when it is picked as the target', () => {
  const t = nearestTarget({ x: 0, z: 0 }, [{ x: 1, z: 1, facing: 2.5 }, { x: 5, z: 5, facing: 0 }])!;
  assert.equal(t.facing, 2.5);
});
