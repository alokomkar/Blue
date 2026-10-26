import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFor, easeAxis, type KeyMap } from './controls-keyboard.ts';

test('smoothed turning climbs to full speed over a fraction of a second, and falls back the same way', () => {
  let a = 0;
  let t = 0;
  while (a < 1) {
    a = easeAxis(a, 1, 1 / 60);
    t += 1 / 60;
    assert.ok(t < 1, 'it gets there');
  }
  assert.ok(t > 0.1 && t < 0.3, `${t.toFixed(2)} s`);
  assert.equal(a, 1, 'and stops at the target, not past it');
  let back = a;
  for (let i = 0; i < 60 && back > 0; i++) back = easeAxis(back, 0, 1 / 60);
  assert.equal(back, 0);
});

test('a long frame moves the axis no further than its target, and a negative step does nothing', () => {
  assert.equal(easeAxis(0, 1, 5), 1);
  assert.equal(easeAxis(0, -1, 5), -1);
  assert.equal(easeAxis(0.5, 1, -1), 0.5);
  assert.equal(easeAxis(1, -1, 1 / 60) < 1, true, 'reversing passes back through zero rather than jumping');
});

const keys: KeyMap = { forward: 'KeyW', back: 'KeyS', turnLeft: 'KeyA', turnRight: 'KeyD', interact: 'Space', controls: 'KeyH', torch: 'KeyT' };

test('a key does the action it is bound to', () => {
  assert.equal(actionFor(keys, 'KeyT'), 'torch');
  assert.equal(actionFor(keys, 'KeyW'), 'forward');
  assert.equal(actionFor(keys, 'KeyJ'), null);
});

test('the arrow keys, Enter and ? keep their old jobs unless the key has been given another', () => {
  assert.equal(actionFor(keys, 'ArrowUp'), 'forward');
  assert.equal(actionFor(keys, 'ArrowLeft'), 'turnLeft');
  assert.equal(actionFor(keys, 'Enter'), 'interact');
  assert.equal(actionFor(keys, 'Slash', true), 'controls');
  assert.equal(actionFor(keys, 'Slash', false), null);
  // Torch moved onto the up arrow: it torches, and no longer moves forward.
  assert.equal(actionFor({ ...keys, torch: 'ArrowUp', forward: 'KeyY' }, 'ArrowUp'), 'torch');
  assert.equal(actionFor({ ...keys, interact: 'KeyJ' }, 'Enter'), 'interact', 'Enter still interacts: nothing else can be bound to it');
  assert.equal(actionFor({ ...keys, interact: 'KeyJ' }, 'Space'), null, 'Space is free once interact has moved');
});

test('the aim key is / by default, and Shift + / (the ?) is still the controls sheet', () => {
  assert.equal(actionFor({ ...keys, aim: 'Slash' }, 'Slash', false), 'aim');
  assert.equal(actionFor({ ...keys, aim: 'Slash' }, 'Slash', true), 'controls');
  assert.equal(actionFor({ ...keys, aim: 'KeyK' }, 'Slash', true), 'controls');
});
