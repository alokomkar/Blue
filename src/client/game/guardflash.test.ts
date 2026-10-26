import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLIND_FADE_S, FLASH_CARRIERS, GUARD_FLASH_GAP_S, GUARD_FLASH_RADIUS, carries, flashStrength, stumbleLeft, throwsFlash, type ThrowChance } from './guardflash.ts';

const ready: ThrowChance = { seenFor: 1.5, dist: 11, clear: true, stock: 1, sinceOwn: 99, sinceAny: 99, rusher: false, down: false };

test('a guard with the agent in sight at a throwing distance, a grenade and no recent throw, throws', () => {
  assert.equal(throwsFlash(ready), true);
});

test('it does not throw too close, too far, without a clear line, before it has really seen them, or with none left', () => {
  assert.equal(throwsFlash({ ...ready, dist: 4 }), false);
  assert.equal(throwsFlash({ ...ready, dist: 20 }), false);
  assert.equal(throwsFlash({ ...ready, clear: false }), false);
  assert.equal(throwsFlash({ ...ready, seenFor: 0.3 }), false);
  assert.equal(throwsFlash({ ...ready, stock: 0 }), false);
});

test('hunters, heavies and the downed do not throw, and throws on a floor are spaced out', () => {
  assert.equal(throwsFlash({ ...ready, rusher: true }), false);
  assert.equal(throwsFlash({ ...ready, down: true }), false);
  assert.equal(throwsFlash({ ...ready, sinceAny: GUARD_FLASH_GAP_S - 1 }), false);
  assert.equal(throwsFlash({ ...ready, sinceOwn: GUARD_FLASH_GAP_S - 1 }), false);
});

test('few carry one', () => {
  assert.equal(carries(FLASH_CARRIERS - 0.01), true);
  assert.equal(carries(FLASH_CARRIERS + 0.01), false);
});

test('the agent is flashed only with a clear line, near, on the level, and not shut away; nearer is whiter', () => {
  const near = flashStrength({ dist: 2, dy: 0, clear: true, shutAway: false })!;
  const far = flashStrength({ dist: 8, dy: 0, clear: true, shutAway: false })!;
  assert.ok(near > far && far >= 0.55 && near <= 0.95);
  assert.equal(flashStrength({ dist: 2, dy: 0, clear: false, shutAway: false }), null, 'a wall in the way');
  assert.equal(flashStrength({ dist: GUARD_FLASH_RADIUS + 1, dy: 0, clear: true, shutAway: false }), null);
  assert.equal(flashStrength({ dist: 2, dy: 6, clear: true, shutAway: false }), null, 'on another level');
  assert.equal(flashStrength({ dist: 2, dy: 0, clear: true, shutAway: true }), null, 'in a locker');
});

test('the stumble runs down to nothing', () => {
  assert.equal(stumbleLeft(1, 0.4), 0.6);
  assert.equal(stumbleLeft(0.2, 1), 0);
  assert.ok(BLIND_FADE_S > 2);
});
