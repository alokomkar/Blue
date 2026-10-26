// The boss of the exit level: a heavy, shielded guard. The rules of the fight, pure so they are unit-tested under Node; bots.ts plays the body (a white guard grown larger), game.ts the arena
// and the bar.
//
// The shield turns every shot aside. A flash grenade (the blinding that stops any white guard) opens it for a while, and only then do shots count: a stun one, a head shot more,
// an EMP the most (his machine parts). Halfway down, a hack locks his machine parts for a few seconds: he stands frozen with the shield open and takes double. A takedown never works.

import type { Tool } from './enemies/types';

export const WARDEN_HEALTH = 14;
/** How long a flash grenade holds the shield open (a white guard is dazed for 5 s; he is the harder case, and the longer the window the more the guns can do). */
export const SHIELD_OPEN_S = 7;
/** The hack locks his machine parts when his health first falls to this, and holds him for `HACK_S` seconds. */
export const HACK_AT = 7;
export const HACK_S = 5;
/** The fire rate of his two guns, between shots in seconds (a white guard's is 0.7). */
export const WARDEN_FIRE_COOLDOWN_S = 0.5;

/** The damage one hit does to the boss: nothing while the shield is up; with it open a stun one, a head shot or an EMP more; double while the hack holds him. */
export function wardenDamage(tool: Tool, head: boolean, open: boolean, frozen: boolean): number {
  if (!open || tool === 'takedown') return 0;
  const base = tool === 'emp' ? 3 : 1 + (head ? 1 : 0);
  return frozen ? base * 2 : base;
}

export type WardenState = { health: number; hacked: boolean };

export const newWarden = (): WardenState => ({ health: WARDEN_HEALTH, hacked: false });

/** The state after `damage`, and whether the hack begins now (the first time his health is at or under HACK_AT, and not if the hit finished him). */
export function afterHit(state: WardenState, damage: number): { state: WardenState; hack: boolean; down: boolean } {
  const health = Math.max(0, state.health - damage);
  const hack = !state.hacked && health > 0 && health <= HACK_AT;
  return { state: { health, hacked: state.hacked || hack }, hack, down: health === 0 };
}

/** The bar's fill, 0 to 1. */
export const healthFraction = (state: WardenState): number => state.health / WARDEN_HEALTH;
