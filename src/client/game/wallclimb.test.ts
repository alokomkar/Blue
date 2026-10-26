import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIMB, CLIP_S, climbSeconds, faceAngle, faceStand, lieDirection, poseAt, riseNeeded, rollSides, runAngle, topPoint, wallContact } from './wallclimb.ts';

// A wall along x, 4 m long, 0.28 thick, centred on z = 0: x from -2 to 2.
const WALL = { minX: -2, maxX: 2, minZ: -0.14, maxZ: 0.14 };

test('a dash at the face of a wall meets it, with the normal back at the agent', () => {
  const c = wallContact([WALL], 0, 1, Math.PI, 1.2); // standing at z = 1 facing -z (angle pi), the face is at z = 0.14
  assert.ok(c);
  assert.equal(c.run, 'x');
  assert.equal(c.nz, 1);
  assert.equal(c.nx, 0);
  assert.ok(Math.abs(c.hit.z - 0.14) < 1e-9);
  const behind = wallContact([WALL], 0, -1, Math.PI, 1.2); // from the far side facing -z, walking away from it
  assert.equal(behind, null);
  const far = wallContact([WALL], 0, 3, Math.PI, 1.2);
  assert.equal(far, null);
});

test('it has to be square on, long enough and thin enough', () => {
  assert.equal(wallContact([WALL], 0, 1, Math.PI + 1.0, 1.2), null); // 57 degrees off square at least: past the limit
  assert.ok(wallContact([WALL], 0, 1, Math.PI + 0.3, 1.2));
  assert.equal(wallContact([{ minX: -0.5, maxX: 0.5, minZ: -0.14, maxZ: 0.14 }], 0, 1, Math.PI, 1.2), null); // a stub
  assert.equal(wallContact([{ minX: -2, maxX: 2, minZ: -1, maxZ: 1 }], 0, 2, Math.PI, 1.2), null); // a block
});

test('the nearest wall in reach wins', () => {
  const near = { minX: -2, maxX: 2, minZ: 0.5, maxZ: 0.78 };
  const c = wallContact([WALL, near], 0, 1.5, Math.PI, 1.9);
  assert.ok(c);
  assert.ok(Math.abs(c.centre - 0.64) < 1e-9);
});

test('the top point and the standing place keep the whole body on the wall and the agent against its face', () => {
  const c = wallContact([WALL], 1.9, 1, Math.PI, 1.2)!;
  assert.ok(topPoint(c, 1.9).x <= 2 - 0.9 + 1e-9);
  const stand = faceStand(c, 0, 0.25);
  assert.ok(Math.abs(stand.z - (0.14 + 0.25)) < 1e-9);
  assert.equal(stand.x, 0);
  assert.ok(Math.abs(Math.cos(faceAngle(c)) + 1) < 1e-9); // straight at the face: toward -z
  assert.ok(Math.abs(runAngle(c, 1) - Math.PI / 2) < 1e-9);
  assert.equal(lieDirection(c, 1.5, 0), -1); // near the +x end: the open way is toward -x
  assert.equal(lieDirection(c, 0, 1), 1);
});

test('a roll off has a floor point on each side, the climbed side first', () => {
  const c = wallContact([WALL], 0, 1, Math.PI, 1.2)!;
  const [first, second] = rollSides(c, 0, 0.7);
  assert.ok(first!.z > 0.14 && second!.z < -0.14);
});

test('the pop is two foot steps up the face while the body rises evenly; weights always sum to one and the hands reach the top', () => {
  const rise = riseNeeded(3.07);
  assert.ok(rise > 1.1 && rise < 1.3);
  const total = climbSeconds();
  let lastRise = 0;
  for (let t = 0; t <= total; t += 0.02) {
    const p = poseAt(t, rise);
    const sum = p.layers.reduce((s, l) => s + l.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights at ${t.toFixed(2)}: ${sum}`);
    for (const l of p.layers) assert.ok(l.time >= 0 && l.time <= CLIP_S[l.clip] + 1e-9, `${l.clip} time ${l.time}`);
    assert.ok(p.rise >= lastRise - 1e-9, 'the body only rises');
    lastRise = p.rise;
  }
  // the run up the face: the right foot goes on first and comes off as the left takes the weight, the hands stretch for the edge and let go of the reach once the ledge clip has them
  const early = poseAt(0.05, rise);
  const mid = poseAt(CLIMB.popS * 0.4, rise);
  const late = poseAt(CLIMB.popS * 0.9, rise);
  assert.equal(early.phase, 'pop');
  assert.ok(early.steps.right.w < 0.1 && early.steps.left.w === 0, 'still off the wall at the start');
  assert.ok(mid.steps.right.w > 0.9 && mid.steps.left.w < 0.2, 'the first foot is on the face');
  assert.ok(late.steps.left.w > 0.9 && late.steps.right.w < 0.1, 'the second foot has the weight');
  assert.ok(CLIMB.stepLeftH > CLIMB.stepRightH + 0.4, 'the second step is well above the first');
  assert.ok(late.reachW > 0.9 && early.reachW < 0.1);
  assert.ok(poseAt(CLIMB.popS + 0.05, rise).reachW < 1 && poseAt(CLIMB.popS + CLIMB.ledgeS + 0.01, rise).reachW === 0);
  assert.equal(poseAt(total + 1, rise).phase, 'done');
  assert.ok(Math.abs(poseAt(total - 0.001, rise).rise - rise) < 1e-9);
});

test('the body turns along the wall and settles onto its centre line only once it is over the top', () => {
  const rise = 1.2;
  const start = CLIMB.popS;
  assert.equal(poseAt(start + 0.05, rise).turn, 0);
  assert.equal(poseAt(start + 0.05, rise).layers.at(-1)!.clip, 'ClimbLedge');
  const later = poseAt(start + CLIMB.ledgeS + 0.3, rise);
  assert.ok(later.turn > 0.2 && later.turn < 1);
  assert.equal(later.settle, 0);
  assert.equal(poseAt(start + CLIMB.ledgeS + CLIMB.mountS - 0.01, rise).turn, 1);
});
