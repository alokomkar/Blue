import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySuspicion, isCaught } from './suspicion.ts';

test('applySuspicion clamps to [0, 100]', () => {
  assert.equal(applySuspicion(0, -20), 0);
  assert.equal(applySuspicion(95, 30), 100);
  assert.equal(applySuspicion(50, -5), 45);
  assert.equal(applySuspicion(50, 5), 55);
});

test('isCaught is only true at 100 or above', () => {
  assert.equal(isCaught(99), false);
  assert.equal(isCaught(100), true);
});
