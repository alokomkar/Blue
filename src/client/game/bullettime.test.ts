import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approaching, bulletPace, BULLET_MAX_S, BULLET_MIN_START, BULLET_PLAYER, BULLET_WORLD, FULL_BULLET, tickBullet, toggleBullet } from './bullettime.ts';

test('it starts with enough in the meter, and not without', () => {
  assert.equal(toggleBullet(FULL_BULLET).on, true);
  assert.equal(toggleBullet({ ...FULL_BULLET, energy: BULLET_MIN_START - 0.01 }).on, false);
  assert.equal(toggleBullet({ ...FULL_BULLET, on: true }).on, false);
});

test('it eases in, drains while on, switches itself off when empty, and refills while off', () => {
  let s = toggleBullet(FULL_BULLET);
  for (let i = 0; i < 30; i++) s = tickBullet(s, 1 / 30);
  assert.ok(s.k > 0.95);
  assert.ok(s.energy < 1 && s.energy > 0.7);
  for (let i = 0; i < BULLET_MAX_S * 30 + 5; i++) s = tickBullet(s, 1 / 30);
  assert.equal(s.on, false);
  assert.ok(s.energy < 0.1);
  for (let i = 0; i < 30 * 5; i++) s = tickBullet(s, 1 / 30);
  assert.equal(s.k, 0);
  assert.ok(s.energy > 0.1);
});

test('the world slows more than the agent', () => {
  assert.deepEqual(bulletPace(0), { world: 1, player: 1 });
  const full = bulletPace(1);
  assert.ok(Math.abs(full.world - BULLET_WORLD) < 1e-9);
  assert.ok(Math.abs(full.player - BULLET_PLAYER) < 1e-9);
  assert.ok(full.player / full.world > 3);
});

test('an enemy after the agent and near is a reason to offer it', () => {
  assert.equal(approaching([{ kind: 'watchdog', alert: true, disabled: false, dist: 8 }]), true);
  assert.equal(approaching([{ kind: 'watchdog', alert: false, disabled: false, dist: 8 }]), false);
  assert.equal(approaching([{ kind: 'patrol', alert: true, disabled: true, dist: 4 }]), false);
  assert.equal(approaching([{ kind: 'patrol', alert: true, disabled: false, dist: 30 }]), false);
});
