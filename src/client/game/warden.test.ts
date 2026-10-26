import test from 'node:test';
import assert from 'node:assert/strict';
import { HACK_AT, WARDEN_HEALTH, afterHit, healthFraction, newWarden, wardenDamage } from './warden.ts';

test('the shield turns every shot aside, and a takedown never works', () => {
  for (const tool of ['stun', 'emp'] as const) for (const head of [false, true]) assert.equal(wardenDamage(tool, head, false, false), 0);
  assert.equal(wardenDamage('takedown', false, true, false), 0);
  assert.equal(wardenDamage('takedown', true, true, true), 0);
});

test('with the shield open a stun does one, a head shot two, an EMP three; while the hack holds him it is double', () => {
  assert.equal(wardenDamage('stun', false, true, false), 1);
  assert.equal(wardenDamage('stun', true, true, false), 2);
  assert.equal(wardenDamage('emp', false, true, false), 3);
  assert.equal(wardenDamage('stun', false, true, true), 2);
  assert.equal(wardenDamage('stun', true, true, true), 4);
  assert.equal(wardenDamage('emp', false, true, true), 6);
});

test('the hack locks his machine parts once, the first time his health falls to half, and not on the killing blow', () => {
  let s = newWarden();
  assert.equal(s.health, WARDEN_HEALTH);
  let r = afterHit(s, 3);
  assert.deepEqual([r.hack, r.down, r.state.health], [false, false, WARDEN_HEALTH - 3]);
  s = r.state;
  r = afterHit(s, WARDEN_HEALTH - 3 - HACK_AT + 1); // takes it to HACK_AT - 1 + ... under the line
  assert.equal(r.hack, true);
  s = r.state;
  assert.equal(afterHit(s, 1).hack, false, 'only once');
  assert.equal(afterHit({ health: 2, hacked: false }, 5).hack, false, 'a killing blow is not a hack');
  assert.equal(afterHit({ health: 2, hacked: false }, 5).down, true);
});

test('the hack comes in time: a long fight of stun shots reaches it, a single big blow from the top does not skip it past the end', () => {
  let s = newWarden();
  let hacks = 0;
  for (let i = 0; i < 30 && s.health > 0; i++) {
    const r = afterHit(s, 1);
    if (r.hack) hacks++;
    s = r.state;
  }
  assert.equal(hacks, 1);
  assert.equal(s.health, 0);
  assert.equal(healthFraction({ health: WARDEN_HEALTH / 2, hacked: true }), 0.5);
});
