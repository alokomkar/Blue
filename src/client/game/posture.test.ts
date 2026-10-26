import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTURE_MEMORY_S, PRONE_AWARE, PRONE_NOISE, PRONE_SIGHT, PRONE_SPEED_FACTOR, STANDING, isLow, nextPosture, press, pressSilent, type PostureState } from './posture.ts';

const run = (s: PostureState, times: number[]): PostureState => times.reduce((state, t) => press(state, t), s);

test('Shift from standing crouches, and a second quick press carries on to prone', () => {
  assert.equal(press(STANDING, 0).posture, 'crouch');
  assert.equal(run(STANDING, [0, 0.4]).posture, 'prone');
  assert.equal(run(STANDING, [0, POSTURE_MEMORY_S]).posture, 'prone', 'right at the memory’s edge still counts');
});

test('a press after a pause from a crouch stands up, as tapping Shift to stop sneaking always did', () => {
  assert.equal(run(STANDING, [0, POSTURE_MEMORY_S + 0.01]).posture, 'stand');
  assert.equal(run(STANDING, [0, 10]).posture, 'stand');
});

test('from prone, Shift goes up to a crouch first, and a quick second press stands', () => {
  const prone = run(STANDING, [0, 0.4]);
  const crouch = press(prone, 5);
  assert.equal(crouch.posture, 'crouch');
  assert.equal(press(crouch, 5.3).posture, 'stand', 'quick, coming up: it stands, it does not drop back down');
  assert.equal(press(crouch, 9).posture, 'stand', 'after a pause: stand too');
});

test('the full ladder runs stand, crouch, prone, crouch, stand', () => {
  const seq: string[] = [];
  let s = STANDING;
  [0, 0.3, 0.6, 0.9].forEach((t) => {
    s = press(s, t);
    seq.push(s.posture);
  });
  assert.deepEqual(seq, ['crouch', 'prone', 'crouch', 'stand']);
});

test('a crouch reached from prone is never sent back down by a quick press', () => {
  let s = run(STANDING, [0, 0.3]);
  s = press(s, 3);
  for (const dt of [0.1, 0.5, 1.4]) assert.equal(press(s, 3 + dt).posture, 'stand');
});

test('the indicator’s next step matches what a press does', () => {
  const s = press(STANDING, 0);
  assert.equal(nextPosture(s, 0.5), 'prone');
  assert.equal(nextPosture(s, 5), 'stand');
  assert.equal(nextPosture(STANDING, 0), 'crouch');
});

test('crouching and lying flat both count as low; standing does not', () => {
  assert.equal(isLow('stand'), false);
  assert.equal(isLow('crouch'), true);
  assert.equal(isLow('prone'), true);
});

test('prone is stealthier, quieter and slower than anything else', () => {
  assert.ok(PRONE_SIGHT < 0.5 && PRONE_AWARE < 1 && PRONE_SPEED_FACTOR < 0.45 && PRONE_NOISE < 3);
});

test('on a silent night the one key just swaps crouch and flat, whatever the pause between presses', () => {
  let s: PostureState = { posture: 'crouch', dir: 'down', at: 0 };
  s = pressSilent(s, 0.2);
  assert.equal(s.posture, 'prone');
  s = pressSilent(s, 9);
  assert.equal(s.posture, 'crouch');
  s = pressSilent(s, 9.1);
  assert.equal(s.posture, 'prone');
  for (let i = 0; i < 6; i++) assert.notEqual((s = pressSilent(s, 20 + i * 5)).posture, 'stand');
});
