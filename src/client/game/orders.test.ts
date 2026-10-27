import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PartnerOrder } from '../../shared/orders.ts';
import { COVER_S, NOISE_CELLS, HOLD_LEAVE_M, TAKE_RANGE, coverActive, coverRenewed, directiveLabel, holdOver, pickTarget, planOrder, type Candidate } from './orders.ts';

const o = (order: PartnerOrder['order'], target?: PartnerOrder['target']): PartnerOrder => ({ order, ...(target ? { target } : {}), say: 'x' });
const up = { down: false, canLift: true };

test('hold: stay put until told; it ends any engagement', () => {
  const p = planOrder(o('hold'), 10, up);
  assert.deepEqual(p.directive, { kind: 'hold' });
  assert.equal(p.dropEngage, true);
  assert.equal(p.regroup, false);
});

test('follow: back to free', () => {
  assert.deepEqual(planOrder(o('follow'), 10, up).directive, { kind: 'free' });
});

test('cover me: a lookout for COVER_S seconds from now', () => {
  assert.deepEqual(planOrder(o('cover_me'), 10, up).directive, { kind: 'cover', until: 10 + COVER_S });
});

test('regroup: free, and blinked beside you', () => {
  const p = planOrder(o('regroup'), 10, up);
  assert.deepEqual(p.directive, { kind: 'free' });
  assert.equal(p.regroup, true);
});

test('wait at the lift: go there; refused when the level has no exit lift to go to', () => {
  assert.deepEqual(planOrder(o('wait_at_lift'), 0, up).directive, { kind: 'lift' });
  const no = planOrder(o('wait_at_lift'), 0, { down: false, canLift: false });
  assert.equal(no.directive, null);
  assert.ok(no.refuse);
});

test('take: engages, keeping the standing instruction; a guard unless told otherwise', () => {
  const p = planOrder(o('take'), 0, up);
  assert.equal(p.engage, 'nearest_guard');
  assert.equal(p.directive, null, 'a hold or a follow stays as it was');
  assert.equal(p.dropEngage, false);
  assert.equal(planOrder(o('take', 'nearest_dog'), 0, up).engage, 'nearest_dog');
  assert.equal(planOrder(o('take', 'next_guard'), 0, up).engage, 'next_guard');
});

test('distract: a noise where it stands, then it holds there', () => {
  const p = planOrder(o('distract', 'nearest_guard'), 0, up);
  assert.equal(p.noise, true);
  assert.deepEqual(p.directive, { kind: 'hold' });
  assert.ok(NOISE_CELLS > 0);
});

test('none changes nothing; a downed partner takes no orders', () => {
  const none = planOrder(o('none'), 0, up);
  assert.deepEqual({ ...none }, { directive: null, engage: null, dropEngage: false, noise: false, regroup: false, refuse: null });
  for (const id of ['hold', 'follow', 'cover_me', 'take', 'distract', 'wait_at_lift', 'regroup'] as const) {
    const p = planOrder(o(id), 0, { down: true, canLift: true });
    assert.equal(p.directive, null, id);
    assert.equal(p.engage, null, id);
    assert.equal(p.noise, false, id);
    assert.equal(p.regroup, false, id);
    assert.ok(p.refuse, id);
  }
  assert.equal(planOrder(o('none'), 0, { down: true, canLift: true }).refuse, null, 'chatter is not an order, so there is nothing to refuse');
});

test('a hold ends when you are far off, on another floor, or in the exit lift', () => {
  assert.equal(holdOver(5, true, false), false);
  assert.equal(holdOver(HOLD_LEAVE_M, true, false), false);
  assert.equal(holdOver(HOLD_LEAVE_M + 0.1, true, false), true);
  assert.equal(holdOver(5, false, false), true);
  assert.equal(holdOver(5, true, true), true);
  assert.ok(HOLD_LEAVE_M >= 20, 'generous: at least five maze cells');
});

test('cover lasts until its time is up, and longer while you work a console', () => {
  const c = planOrder(o('cover_me'), 100, up).directive!;
  assert.equal(coverActive(c, 100 + COVER_S - 1, false), true);
  assert.equal(coverActive(c, 100 + COVER_S + 1, false), false);
  assert.equal(coverActive(c, 100 + COVER_S + 1, true), true, 'working keeps the lookout up');
  assert.equal(coverActive({ kind: 'hold' }, 0, true), false);
  const renewed = coverRenewed({ kind: 'cover', until: 101 }, 100, true);
  assert.deepEqual(renewed, { kind: 'cover', until: 105 });
  assert.deepEqual(coverRenewed({ kind: 'cover', until: 200 }, 100, true), { kind: 'cover', until: 200 });
  assert.deepEqual(coverRenewed({ kind: 'cover', until: 101 }, 100, false), { kind: 'cover', until: 101 });
});

const cand = (id: number, kind: Candidate['kind'], distance: number, visible = true, downed = false): Candidate => ({ id, kind, distance, visible, downed });

test('pickTarget: the nearest guard it can see in range', () => {
  const list = [cand(1, 'guard', 8), cand(2, 'guard', 4), cand(3, 'guard', 2, false), cand(4, 'dog', 1), cand(5, 'guard', 3, true, true)];
  assert.equal(pickTarget('nearest_guard', list, null)?.id, 2);
  assert.equal(pickTarget('nearest_dog', list, null)?.id, 4);
});

test('pickTarget: out of range, out of sight, down already, or an alpha: nothing', () => {
  assert.equal(pickTarget('nearest_guard', [cand(1, 'guard', TAKE_RANGE + 1)], null), null);
  assert.equal(pickTarget('nearest_guard', [cand(1, 'guard', 3, false)], null), null);
  assert.equal(pickTarget('nearest_guard', [cand(1, 'guard', 3, true, true)], null), null);
  assert.equal(pickTarget('nearest_dog', [cand(1, 'alpha', 3)], null), null, 'an alpha is left to you');
  assert.equal(pickTarget('nearest_guard', [cand(1, 'other', 3)], null), null);
  assert.equal(pickTarget('nearest_guard', [], null), null);
});

test('pickTarget: next_guard moves on from the one it took last', () => {
  const list = [cand(1, 'guard', 3), cand(2, 'guard', 6)];
  assert.equal(pickTarget('next_guard', list, 1)?.id, 2);
  assert.equal(pickTarget('next_guard', list, null)?.id, 1);
  assert.equal(pickTarget('nearest_guard', list, 1)?.id, 1, 'nearest does not skip it');
  assert.equal(pickTarget('next_guard', [cand(1, 'guard', 3)], 1), null);
});

test('the HUD words for each standing instruction', () => {
  assert.equal(directiveLabel({ kind: 'hold' }, 0, false), 'holding');
  assert.equal(directiveLabel({ kind: 'lift' }, 0, false), 'waiting at the lift');
  assert.equal(directiveLabel({ kind: 'free' }, 0, false), null);
  assert.equal(directiveLabel({ kind: 'cover', until: 10 }, 5, false), 'covering you');
  assert.equal(directiveLabel({ kind: 'cover', until: 10 }, 15, false), null);
});
