// What a spoken order does to the partner (docs/DESIGN.md section 4): the pure half. shared/orders.ts turns speech into a PartnerOrder; here an order becomes a plan for the
// partner code in game.ts, which already knows how to follow, take cover, shoot, regroup and wait: nothing here moves anyone. Kept apart from the scene so it is unit-tested under Node.
//
// The partner's standing instruction (a Directive) is one of:
//   free   follow along your path, back you up (the way it has always played; also what `follow` gives back)
//   hold   stay where it is until told otherwise, or until you are further than HOLD_LEAVE_M away (it never loses you for good)
//   cover  free, but a lookout: it shoots a guard that comes up on you, as it does while you work a console, for COVER_S seconds (longer while you are at a console)
//   lift   go to the exit lift and wait in the cab (the lift still takes both of you: the existing exit rules do not change)
// On top of that, `take` is a short engagement with one target, and `distract` a noise made where the partner stands, after which it holds.
// Under every directive it keeps its own judgement: it still shoots a guard that is on you or close to either of you (there is no "hold fire" order), it still takes cover when you do,
// and a downed partner takes no orders.

import type { PartnerOrder, TargetId } from '../../shared/orders';

export type Directive = { kind: 'free' } | { kind: 'hold' } | { kind: 'cover'; until: number } | { kind: 'lift' };

/** Further than this from the partner on its holding spot, you have gone off and it follows again (a generous leash: more than a whole row of a floor). */
export const HOLD_LEAVE_M = 30;
/** How long `cover me` lasts when you are not at a console. */
export const COVER_S = 30;
/** How long `take` keeps trying for a clear shot. */
export const TAKE_S = 5;
/** How far the partner will shoot a target it was told to take (further than its own backup shots reach). */
export const TAKE_RANGE = 12;
/** How far the lookout of `cover me` shoots. */
export const COVER_RANGE = 9;
/** A noise made by `distract` reaches guards this many cells of walking away. */
export const NOISE_CELLS = 9;

export type OrderPlan = {
  /** The new standing instruction; null leaves the current one. */
  directive: Directive | null;
  /** Start a short engagement with this target; null starts none. */
  engage: TargetId | null;
  /** Clears an engagement in progress (any order but `take` does). */
  dropEngage: boolean;
  /** Make a noise where the partner stands. */
  noise: boolean;
  /** Put the partner back beside you (the `regroup` blink). */
  regroup: boolean;
  /** Why nothing happened, as a line for the HUD. */
  refuse: string | null;
};

const NOTHING: OrderPlan = { directive: null, engage: null, dropEngage: false, noise: false, regroup: false, refuse: null };

/** What an order asks for. `down`: the partner is down; `canLift`: there is an exit to go to. */
export function planOrder(order: PartnerOrder, now: number, state: { down: boolean; canLift: boolean }): OrderPlan {
  if (order.order === 'none') return NOTHING;
  if (state.down) return { ...NOTHING, refuse: 'I am down. Get to me.' };
  switch (order.order) {
    case 'hold':
      return { ...NOTHING, directive: { kind: 'hold' }, dropEngage: true };
    case 'follow':
      return { ...NOTHING, directive: { kind: 'free' }, dropEngage: true };
    case 'cover_me':
      return { ...NOTHING, directive: { kind: 'cover', until: now + COVER_S }, dropEngage: true };
    case 'take':
      return { ...NOTHING, engage: order.target ?? 'nearest_guard' };
    case 'distract':
      return { ...NOTHING, noise: true, directive: { kind: 'hold' }, dropEngage: true };
    case 'wait_at_lift':
      return state.canLift ? { ...NOTHING, directive: { kind: 'lift' }, dropEngage: true } : { ...NOTHING, refuse: 'No lift here.' };
    case 'regroup':
      return { ...NOTHING, directive: { kind: 'free' }, regroup: true, dropEngage: true };
  }
}

/** Whether a hold is over: you have gone more than HOLD_LEAVE_M off (or to another floor), or are in the exit lift, where the partner must join you. */
export function holdOver(distance: number, sameFloor: boolean, inExit: boolean): boolean {
  return inExit || !sameFloor || distance > HOLD_LEAVE_M;
}

/** Whether the lookout of `cover me` is on: its time has not run out, or you are working a console (which keeps it up). */
export function coverActive(d: Directive, now: number, working: boolean): boolean {
  return d.kind === 'cover' && (working || now < d.until);
}

/** A cover order renewed while you work: the end moves on so it does not lapse the moment you finish. */
export function coverRenewed(d: Directive, now: number, working: boolean): Directive {
  return d.kind === 'cover' && working && d.until < now + 5 ? { kind: 'cover', until: now + 5 } : d;
}

export type Candidate = { id: number; kind: 'guard' | 'dog' | 'alpha' | 'other'; distance: number; visible: boolean; downed: boolean };

/**
 * The one to take: the nearest of the kind asked for that the partner can see within TAKE_RANGE. `nearest_dog` takes a watchdog (an alpha is left to you: a hit sets it off), the guard
 * orders take guards; `next_guard` skips the one it took last (`last`) so a second "take the next one" moves on; a compass target (north...) is read as the nearest guard, as the partner cannot act on a bearing yet. Null when nothing qualifies.
 */
export function pickTarget(want: TargetId, candidates: readonly Candidate[], last: number | null): Candidate | null {
  const kind = want === 'nearest_dog' ? 'dog' : 'guard';
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c.kind !== kind || c.downed || !c.visible || c.distance > TAKE_RANGE) continue;
    if (want === 'next_guard' && c.id === last) continue;
    if (!best || c.distance < best.distance) best = c;
  }
  return best;
}

/** The partner pill's words for what it is doing (the HUD names the order that is in force). */
export function directiveLabel(d: Directive, now: number, working: boolean): string | null {
  switch (d.kind) {
    case 'hold':
      return 'holding';
    case 'cover':
      return coverActive(d, now, working) ? 'covering you' : null;
    case 'lift':
      return 'waiting at the lift';
    case 'free':
      return null;
  }
}
