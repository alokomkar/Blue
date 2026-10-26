import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Trail, followInput, headingTo, holdProgress, shouldEngage, goInput, threatBearings, coverScore, shields, seenFor, sightOf, together, turnToward, GAP, TRAIL_STEP, TRAIL_MAX } from './companion.ts';

const leaderAt = (x: number, z: number, angle = 0, o: Partial<{ sneak: boolean; prone: boolean; dash: boolean; moving: boolean }> = {}) => ({ x, z, angle, sneak: false, prone: false, dash: false, moving: true, ...o });

test('the trail keeps a point every step and the spot behind is measured along the walked path', () => {
  const t = new Trail();
  for (let z = 0; z <= 10; z += 0.5) t.push(0, z);
  const p = t.pointBehind({ x: 0, z: 10 }, 3);
  assert.ok(Math.abs(p.z - 7) < 0.05 && Math.abs(p.x) < 1e-6);
  // Round a corner: the spot is back along the corner, not a straight line to the leader.
  const c = new Trail();
  for (let z = 0; z <= 5; z += 0.5) c.push(0, z);
  for (let x = 0.5; x <= 5; x += 0.5) c.push(x, 5);
  const q = c.pointBehind({ x: 5, z: 5 }, 7);
  assert.ok(Math.abs(q.x) < 1e-6 && Math.abs(q.z - 3) < 0.05, JSON.stringify(q));
});

test('the trail ignores tiny moves and is capped', () => {
  const t = new Trail();
  t.push(0, 0);
  t.push(TRAIL_STEP / 2, 0);
  assert.equal(t.points.length, 1);
  for (let i = 0; i < TRAIL_MAX * 3; i++) t.push(i, 0);
  assert.equal(t.points.length, TRAIL_MAX);
});

test('a short path gives its oldest point', () => {
  const t = new Trail();
  t.push(0, 0);
  t.push(0, 1);
  assert.deepEqual(t.pointBehind({ x: 0, z: 1 }, 20), { x: 0, z: 0 });
});

test('the turn input swings the heading toward the wanted one (a positive turn lowers the angle)', () => {
  assert.ok(turnToward(0, 1) < 0); // wants a bigger angle: negative input
  assert.ok(turnToward(1, 0) > 0);
  assert.equal(turnToward(0.5, 0.5), 0);
  assert.ok(Math.abs(turnToward(3.1, -3.1)) < 0.5); // wraps the short way
});

test('far behind, it turns, walks, and runs when well behind', () => {
  const t = new Trail();
  for (let z = 0; z <= 20; z += 0.5) t.push(0, z);
  const input = followInput({ x: 0, z: 0, angle: 0 }, leaderAt(0, 20), t);
  assert.ok(input.throttle > 0.5);
  assert.equal(input.dash, true);
  assert.equal(input.sneak, false);
});

test('it copies the leader’s posture and does not run when the leader is lying flat', () => {
  const t = new Trail();
  for (let z = 0; z <= 20; z += 0.5) t.push(0, z);
  const sneaking = followInput({ x: 0, z: 0, angle: 0 }, leaderAt(0, 20, 0, { sneak: true }), t);
  assert.equal(sneaking.sneak, true);
  const flat = followInput({ x: 0, z: 0, angle: 0 }, leaderAt(0, 20, 0, { prone: true }), t);
  assert.equal(flat.prone, true);
  assert.equal(flat.dash, false);
});

test('where it should be, it stops and turns its back to the way the leader looks', () => {
  const t = new Trail();
  for (let z = 0; z <= 10; z += 0.5) t.push(0, z);
  const me = { x: 0, z: 10 - GAP, angle: 0 };
  const input = followInput(me, leaderAt(0, 10, 0), t);
  assert.equal(input.throttle, 0);
  assert.ok(Math.abs(input.turn) > 0.9); // facing the leader's own heading: a half turn to go
});

test('hold progress fills in reach and drains out of it', () => {
  let p = 0;
  p = holdProgress(p, true, 1, 3);
  assert.ok(Math.abs(p - 1 / 3) < 1e-9);
  p = holdProgress(p, false, 1, 3);
  assert.equal(p, 0);
  assert.equal(holdProgress(0.9, true, 5, 3), 1);
});

test('a guard needs a clear view for a while, and sees a crouched or flat partner less far', () => {
  let s = 0;
  s = seenFor(s, true, 1.5);
  s = seenFor(s, false, 1);
  assert.ok(s > 0.9 && s < 1.1);
  assert.ok(sightOf(10, false, false) > sightOf(10, true, false));
  assert.ok(sightOf(10, true, false) > sightOf(10, true, true));
});

test('together needs a free partner close by', () => {
  assert.equal(together('free', { x: 0, z: 0 }, { x: 2, z: 0 }), true);
  assert.equal(together('free', { x: 0, z: 0 }, { x: 5, z: 0 }), false);
  assert.equal(together('down', { x: 0, z: 0 }, { x: 1, z: 0 }), false);
  assert.equal(together('held', { x: 0, z: 0 }, { x: 1, z: 0 }), false);
});

test('headingTo uses the game’s angle (0 faces +Z)', () => {
  assert.ok(Math.abs(headingTo({ x: 0, z: 0 }, { x: 0, z: 5 })) < 1e-9);
  assert.ok(Math.abs(headingTo({ x: 0, z: 0 }, { x: 5, z: 0 }) - Math.PI / 2) < 1e-9);
});

test('it shoots a guard that is onto you at once, and an unaware one only when close', () => {
  assert.equal(shouldEngage({ alerted: true, nearest: 8, kind: 'patrol' }, false, false), true);
  assert.equal(shouldEngage({ alerted: false, nearest: 8, kind: 'hunter' }, true, true), true);
  assert.equal(shouldEngage({ alerted: false, nearest: 5, kind: 'patrol' }, false, false), true);
  assert.equal(shouldEngage({ alerted: false, nearest: 8, kind: 'patrol' }, false, false), false);
});

test('it holds its fire at an unaware guard while you sneak, until it is very close', () => {
  assert.equal(shouldEngage({ alerted: false, nearest: 5, kind: 'patrol' }, true, false), false);
  assert.equal(shouldEngage({ alerted: false, nearest: 3, kind: 'patrol' }, true, false), true);
  assert.equal(shouldEngage({ alerted: false, nearest: 3, kind: 'patrol' }, false, true), false);
});

test('goInput turns to the point, walks, and reports arrival', () => {
  const far = goInput({ x: 0, z: 0, angle: 0 }, { x: 0, z: 6 }, { sneak: false, prone: false });
  assert.equal(far.arrived, false);
  assert.ok(far.throttle >= 0.3);
  const side = goInput({ x: 0, z: 0, angle: 0 }, { x: 6, z: 0 }, { sneak: false, prone: false });
  assert.ok(side.throttle < 0.3 && side.turn !== 0);
  const here = goInput({ x: 0, z: 0, angle: 0 }, { x: 0.2, z: 0.1 }, { sneak: true, prone: false });
  assert.equal(here.arrived, true);
  assert.equal(here.throttle, 0);
});

const guard = (x: number, z: number, o: Partial<{ facing: number; alert: boolean; moving: boolean; kind: string }> = {}) => ({ x, z, facing: 0, alert: false, moving: false, kind: 'patrol', ...o });

test('a guard walking toward you counts for more than one walking away, and alert ones most', () => {
  const me = { x: 0, z: 0 };
  // Guard at +z; facing 0 looks along +z (away), facing PI looks back at you.
  const toward = threatBearings(me, [guard(0, 8, { facing: Math.PI })]);
  const away = threatBearings(me, [guard(0, 8, { facing: 0 })]);
  const alert = threatBearings(me, [guard(0, 8, { facing: Math.PI, alert: true })]);
  assert.ok(toward[0]!.w > away[0]!.w);
  assert.ok(alert[0]!.w > toward[0]!.w * 2.5);
});

test('guards in much the same direction merge, others stay apart, strongest first', () => {
  const b = threatBearings({ x: 0, z: 0 }, [guard(0, 6), guard(1, 7), guard(-9, 0, { alert: true })]);
  assert.equal(b.length, 2);
  assert.ok(b[0]!.w >= b[1]!.w);
  assert.equal(threatBearings({ x: 0, z: 0 }, [guard(0, 40)]).length, 0, 'out of range');
});

test('furniture shields from what is on its far side', () => {
  // The normal points to your side: standing south (+z side) of it, a guard to the north (-z) is behind it.
  assert.equal(shields(0, 1, { dx: 0, dz: -1, w: 1 }), true);
  assert.equal(shields(0, 1, { dx: 0, dz: 1, w: 1 }), false);
});

test('with a second direction the leader does not cover, it takes the spot that faces that one', () => {
  const leader = { x: 0, z: 0 };
  const leaderFace = { nx: 0, nz: 1 }; // the leader is south of its crate: covers guards to the north
  const bearings = threatBearings(leader, [guard(0, -9, { facing: 0, alert: true }), guard(9, 0, { facing: -Math.PI / 2, moving: true })]);
  // Two spots about equally near: one that faces north (shields -z), one that faces east (a crate to the east, you behind it on its west side: normal -x).
  const north = { px: 1.5, pz: 0, nx: 0, nz: 1 };
  const east = { px: -1.5, pz: 0, nx: -1, nz: 0 };
  const me = { x: 0, z: 1 };
  assert.ok(coverScore(east, me, leader, leaderFace, bearings) < coverScore(north, me, leader, leaderFace, bearings));
});

test('with only the direction the leader already covers, it covers the same one, and stays near', () => {
  const leader = { x: 0, z: 0 };
  const leaderFace = { nx: 0, nz: 1 };
  const bearings = threatBearings(leader, [guard(0, -9, { alert: true })]);
  const same = { px: 2, pz: 0, nx: 0, nz: 1 };
  const other = { px: -2, pz: 0, nx: -1, nz: 0 };
  assert.ok(coverScore(same, { x: 0, z: 1 }, leader, leaderFace, bearings) < coverScore(other, { x: 0, z: 1 }, leader, leaderFace, bearings));
  const far = { px: 14, pz: 0, nx: 0, nz: 1 };
  assert.ok(coverScore(same, { x: 0, z: 1 }, leader, leaderFace, bearings) < coverScore(far, { x: 0, z: 1 }, leader, leaderFace, bearings));
});

test('with nothing to go on it takes the leader’s own side', () => {
  const leader = { x: 0, z: 0 };
  const leaderFace = { nx: 0, nz: 1 };
  const mine = { px: 2, pz: 0, nx: 0, nz: 1 };
  const other = { px: 2, pz: 0, nx: 1, nz: 0 };
  assert.ok(coverScore(mine, { x: 0, z: 1 }, leader, leaderFace, []) < coverScore(other, { x: 0, z: 1 }, leader, leaderFace, []));
});

test('far behind, the partner follows the path round the corner, not a straight line through the wall to the leader', () => {
  const t = new Trail();
  // Down a corridor to x = 20, then round a corner down to z = 20.
  for (let x = 0; x <= 20; x += TRAIL_STEP) t.push(x, 0);
  for (let z = TRAIL_STEP; z <= 20; z += TRAIL_STEP) t.push(20, z);
  const leader = { x: 20, z: 20 };
  const wp = t.waypoint({ x: 1, z: 0 }, leader, GAP);
  assert.ok(wp.z < 0.1 && wp.x > 1 && wp.x < 4, `a step or two along the corridor: ${wp.x},${wp.z}`);
  // Nearly there, it takes the usual spot behind the leader.
  const near = t.waypoint({ x: 20, z: 17.5 }, leader, GAP);
  assert.deepEqual(near, t.pointBehind(leader, GAP));
  // And the follow input heads for the crumb, not for the wall.
  const me = { x: 1, z: 0, angle: Math.PI / 2 };
  const step = followInput(me, { ...leader, angle: 0, sneak: false, prone: false, dash: false, moving: true }, t);
  assert.ok(Math.abs(step.turn) < 0.2, 'already facing along the corridor');
});

test('a downed partner keeps the agent in only a few seconds: the exit then takes them alone', async () => {
  const { mayLeaveWithout, LEAVE_DOWNED_S } = await import('./companion.ts');
  assert.equal(mayLeaveWithout('down', 0), false);
  assert.equal(mayLeaveWithout('down', LEAVE_DOWNED_S - 0.1), false);
  assert.equal(mayLeaveWithout('down', LEAVE_DOWNED_S), true);
  assert.equal(mayLeaveWithout('free', 99), false); // a partner on their feet is waited for, not left
});
