import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inLandscapeFrame, rotateHintWanted, shouldEnterLandscape } from './orientation.ts';

test('the landscape card shows on a touch screen held upright, until it is put away or the game is already in the frame', () => {
  const base = { touch: true, portrait: true, inFrame: false, dismissed: false };
  assert.equal(rotateHintWanted(base), true);
  assert.equal(rotateHintWanted({ ...base, portrait: false }), false, 'already sideways');
  assert.equal(rotateHintWanted({ ...base, touch: false }), false, 'a desktop window');
  assert.equal(rotateHintWanted({ ...base, dismissed: true }), false, 'put away');
  assert.equal(rotateHintWanted({ ...base, inFrame: true }), false, 'in the frame it is landscape already');
});

test('the game hands over to the landscape page only when it was chosen, on a touch screen, and not from inside the frame', () => {
  assert.equal(shouldEnterLandscape({ chosen: true, touch: true, inFrame: false }), true);
  assert.equal(shouldEnterLandscape({ chosen: false, touch: true, inFrame: false }), false);
  assert.equal(shouldEnterLandscape({ chosen: true, touch: false, inFrame: false }), false);
  assert.equal(shouldEnterLandscape({ chosen: true, touch: true, inFrame: true }), false, 'or it would hand over to itself, forever');
});

test('the game knows it is the frame’s copy from the frame’s name or its address, and from having a page above it', () => {
  assert.equal(inLandscapeFrame('', 'mazeLandscape', true), true, 'the name alone is enough: the address may be rewritten');
  assert.equal(inLandscapeFrame('?inner=1', '', true), true);
  assert.equal(inLandscapeFrame('?job=3&inner=1', '', true), true);
  assert.equal(inLandscapeFrame('?inner=1', 'mazeLandscape', false), false, 'opened on its own');
  assert.equal(inLandscapeFrame('', '', true), false, 'just inside Reddit');
});
