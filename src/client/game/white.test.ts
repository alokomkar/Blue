import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARRY_MAX, KIT, SILVER, WHITE_ARMOUR, WHITE_WAVES, restock, whiteDamage, whitePixel, bloodPixel } from './white.ts';

test('a stun cracks one plate, a head shot or a dazed target one more, an EMP two', () => {
  assert.equal(whiteDamage('stun', false, false), 1);
  assert.equal(whiteDamage('stun', true, false), 2);
  assert.equal(whiteDamage('stun', false, true), 2);
  assert.equal(whiteDamage('stun', true, true), 3);
  assert.equal(whiteDamage('emp', false, false), 2);
  assert.equal(whiteDamage('emp', true, true), 2);
});

test('only a flash and the guns together are quick: six plates take two dazed head shots, six stuns on their own', () => {
  const shots = (head: boolean, dazed: boolean): number => Math.ceil(WHITE_ARMOUR / whiteDamage('stun', head, dazed));
  assert.equal(shots(false, false), 6);
  assert.equal(shots(true, true), 2);
  assert.ok(shots(false, true) < shots(false, false));
  assert.ok(Math.ceil(WHITE_ARMOUR / whiteDamage('emp', false, false)) > 1, 'an EMP alone does not drop one');
});

test('a kit gives flash grenades and an EMP, never past what can be carried, and says what it added', () => {
  assert.deepEqual(restock(0, 0), { flashes: KIT.flash, emps: KIT.emp, gotFlash: KIT.flash, gotEmp: KIT.emp });
  const full = restock(CARRY_MAX.flash, CARRY_MAX.emp);
  assert.equal(full.flashes, CARRY_MAX.flash);
  assert.equal(full.gotFlash + full.gotEmp, 0);
  assert.equal(restock(4, 0).flashes, CARRY_MAX.flash);
  assert.equal(restock(4, 0).gotFlash, 1);
});

test('three waves, each bigger than the last', () => {
  assert.equal(WHITE_WAVES.length, 3);
  assert.ok(WHITE_WAVES.every((n, i) => i === 0 || n > WHITE_WAVES[i - 1]!));
});

test('black becomes silver, light stays white, and a red band is kept', () => {
  const [r, g, b] = whitePixel(8, 8, 10);
  assert.ok(r > 255 * SILVER * 0.9 && g > 255 * SILVER * 0.9 && b > 255 * SILVER * 0.9, 'a black pixel is silver, not dark');
  assert.ok(Math.max(r, g, b) < 235, 'and not white');
  const light = whitePixel(240, 240, 240);
  assert.ok(light[0] > 240 && light[1] > 245, 'a light pixel stays white');
  assert.deepEqual(whitePixel(190, 30, 30), [190, 30, 30]);
  for (const v of [0, 60, 128, 200, 255]) assert.ok(whitePixel(v, v, v).every((c) => c >= 0 && c <= 255));
});

test('the visor\'s black becomes blood red: red clearly above green and blue, and never bright', () => {
  const [r, g, b] = bloodPixel(5, 5, 5);
  assert.ok(r > 60 && r < 200 && g < 20 && b < 30, `${r},${g},${b}`);
  assert.ok(bloodPixel(255, 255, 255).every((c) => c >= 0 && c <= 255));
});
