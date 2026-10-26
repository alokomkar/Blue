import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTool, fireLabel, empVictims } from './weapons.ts';

const bot = { stunImmune: false };
const dog = { stunImmune: true };

test('a stunnable target gets the stun gun, whatever the EMP count', () => {
  assert.equal(pickTool(bot, 0), 'stun');
  assert.equal(pickTool(bot, 3), 'stun');
});

test('a stun-immune target gets an EMP if there is a charge, otherwise nothing', () => {
  assert.equal(pickTool(dog, 1), 'emp');
  assert.equal(pickTool(dog, 0), 'none');
});

test('with nothing in the sights the stun gun still fires', () => {
  assert.equal(pickTool(null, 2), 'stun');
});

test('forcing an EMP uses one on anything, or nothing when out of charges', () => {
  assert.equal(pickTool(bot, 1, true), 'emp');
  assert.equal(pickTool(null, 1, true), 'emp');
  assert.equal(pickTool(bot, 0, true), 'none');
});

test('the Fire label shows what the next press will do', () => {
  assert.equal(fireLabel('stun', 2), 'FIRE');
  assert.equal(fireLabel('emp', 2), 'EMP ×2');
  assert.equal(fireLabel('none', 0), 'NO EMP');
});

test('the EMP catches every active target in the blast, and nothing outside it or already down', () => {
  const targets = [
    { id: 'near', worldX: 1, worldZ: 0, disabled: false },
    { id: 'edge', worldX: 0, worldZ: 2.5, disabled: false },
    { id: 'far', worldX: 4, worldZ: 0, disabled: false },
    { id: 'down', worldX: 0.5, worldZ: 0, disabled: true },
  ];
  assert.deepEqual(
    empVictims(targets, 0, 0).map((t) => t.id),
    ['near', 'edge']
  );
});

test('a takedown within reach comes before any shot', () => {
  assert.equal(pickTool(bot, 0, false, true), 'takedown');
  assert.equal(pickTool(dog, 2, false, true), 'takedown');
  assert.equal(pickTool(null, 0, false, true), 'takedown');
  assert.equal(fireLabel('takedown', 0), 'TAKEDOWN');
});

test('forcing an EMP still overrides a takedown', () => {
  assert.equal(pickTool(bot, 1, true, true), 'emp');
});

test('a watchdog gets an EMP when there is one, and a slowing stun when there is not; a drone still needs the charge', () => {
  const slowable = { stunImmune: true, stunSlows: true };
  assert.equal(pickTool(slowable, 1), 'emp');
  assert.equal(pickTool(slowable, 0), 'stun');
  assert.equal(pickTool(dog, 0), 'none');
  assert.equal(pickTool(slowable, 0, true), 'none', 'forcing an EMP with none left still fails');
});
