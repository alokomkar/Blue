import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardPose, holdsGun, poseRate, POSE_CLIP, RATE_MAX, RATE_MIN } from './guard-pose.ts';

const base = { moving: false, chasing: false, hunter: false, scanning: false, searching: false, aiming: false };

test('standing, pausing, walking, jogging and sprinting each get their own pose', () => {
  assert.equal(guardPose(base), 'idle');
  assert.equal(guardPose({ ...base, scanning: true }), 'look');
  assert.equal(guardPose({ ...base, moving: true }), 'walk');
  assert.equal(guardPose({ ...base, moving: true, chasing: true }), 'jog');
  assert.equal(guardPose({ ...base, moving: true, chasing: true, hunter: true }), 'sprint');
});

test('standing with the player in sight raises the gun; searching holds the torch up', () => {
  assert.equal(guardPose({ ...base, aiming: true, scanning: true }), 'aim');
  assert.equal(guardPose({ ...base, searching: true }), 'torch');
  assert.equal(guardPose({ ...base, aiming: true, moving: true, chasing: true }), 'jog');
  assert.equal(holdsGun('aim'), true);
  assert.equal(holdsGun('idle'), false);
});

test('a guard that has taken notice of the laser creeps up crouched, until it is chasing', () => {
  assert.equal(guardPose({ ...base, cautious: true, moving: true }), 'creep');
  assert.equal(guardPose({ ...base, cautious: true }), 'creepIdle');
  assert.equal(guardPose({ ...base, cautious: true, moving: true, chasing: true }), 'jog');
  assert.ok(poseRate('creep', 1.44) > RATE_MIN);
});

test('a guard that stops giving chase stands, it does not jog on the spot', () => {
  assert.equal(guardPose({ ...base, chasing: true }), 'idle');
});

test('the rate follows the guard\'s speed and stays within bounds', () => {
  assert.equal(poseRate('idle', 3), 1);
  assert.equal(poseRate('look', 3), 1);
  assert.ok(Math.abs(poseRate('jog', 4.6) - 4.6 / 5.36) < 1e-9);
  assert.equal(poseRate('walk', 100), RATE_MAX);
  assert.equal(poseRate('sprint', 0), RATE_MIN);
});

test('every pose names a library clip', () => {
  for (const clip of Object.values(POSE_CLIP)) assert.match(clip, /^[A-Za-z0-9_]+$/);
});

test('a guard giving ground from the agent backs off crouched, facing them, whatever else it is doing', () => {
  assert.equal(guardPose({ ...base, backing: true, moving: true, chasing: true }), 'backoff');
  assert.equal(guardPose({ ...base, backing: true, moving: true, chasing: true, hunter: true }), 'backoff');
  assert.equal(guardPose({ ...base, backing: true, aiming: true }), 'aim');
  assert.equal(POSE_CLIP.backoff, 'Crouch_Bwd_Loop');
  assert.ok(poseRate('backoff', 1.2) > RATE_MIN);
});
