import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insideSmoke, smokeBlocks, smokeRadius, SMOKE_MAX_R, SMOKE_S } from './smoke.ts';

test('the cloud spreads, holds, thins and is gone', () => {
  assert.ok(smokeRadius(0) < 0.5);
  assert.equal(smokeRadius(2), SMOKE_MAX_R);
  assert.equal(smokeRadius(SMOKE_S / 2), SMOKE_MAX_R);
  assert.ok(smokeRadius(SMOKE_S - 1) < SMOKE_MAX_R);
  assert.equal(smokeRadius(SMOKE_S), 0);
  assert.equal(smokeRadius(-1), 0);
});

test('a line through the cloud is blocked, one that misses it is not, and a thin puff blocks nothing', () => {
  const thick = [{ x: 0, z: 0, age: 3 }];
  assert.equal(smokeBlocks(-6, 0, 6, 0, thick), true);
  assert.equal(smokeBlocks(-6, 5, 6, 5, thick), false);
  assert.equal(smokeBlocks(-6, 0, -3, 0, thick), false, 'stopping short of it');
  assert.equal(smokeBlocks(-6, 0, 6, 0, [{ x: 0, z: 0, age: 0 }]), false);
  assert.equal(smokeBlocks(-6, 0, 6, 0, [{ x: 0, z: 0, age: SMOKE_S + 1 }]), false);
});

test('standing in it', () => {
  const s = [{ x: 2, z: 2, age: 4 }];
  assert.equal(insideSmoke(2.5, 2, s), true);
  assert.equal(insideSmoke(8, 2, s), false);
  assert.equal(insideSmoke(2, 2, [{ x: 2, z: 2, age: SMOKE_S + 1 }]), false);
});

test('smoke is offered for a guard that has the agent, a shock for a dog, and neither for what is down or blinded', async () => {
  const { grenadeOffer } = await import('./smoke.ts');
  const guard = { kind: 'patrol', alert: true, disabled: false, dazed: false, dist: 6 };
  const dog = { kind: 'watchdog', alert: true, disabled: false, dazed: false, dist: 6 };
  assert.deepEqual(grenadeOffer([guard], 2, 2, false), { smoke: true, shock: false });
  assert.deepEqual(grenadeOffer([dog], 2, 2, false), { smoke: false, shock: true });
  assert.deepEqual(grenadeOffer([guard, dog], 2, 2, false), { smoke: true, shock: true });
  assert.deepEqual(grenadeOffer([guard, dog], 0, 1, false), { smoke: false, shock: true }, 'none left');
  assert.deepEqual(grenadeOffer([guard], 2, 2, true), { smoke: false, shock: false }, 'already in a cloud');
  assert.deepEqual(grenadeOffer([{ ...guard, kind: 'sniper', dist: 30 }], 2, 2, false), { smoke: true, shock: false }, 'a sniper locked on is a reason for smoke from as far as it can see');
  assert.deepEqual(grenadeOffer([{ ...guard, kind: 'sniper', dist: 40 }], 2, 2, false), { smoke: false, shock: false });
  assert.deepEqual(grenadeOffer([{ ...guard, dist: 20 }, { ...dog, dazed: true }, { ...guard, disabled: true }, { ...guard, alert: false }], 2, 2, false), { smoke: false, shock: false });
});
