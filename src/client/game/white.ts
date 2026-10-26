// The white guards (the heavy elite of the exit level) and the weapons kit that restocks the agent for them. Pure, so it is unit-tested under Node; bots.ts draws and
// plays the guard, game.ts the kit.
//
// A white guard is a heavy in white: six plates, a quicker gait and a rapid fire. A stun cracks one plate and does not stagger it (its fire goes on); a head shot or a dazed target takes
// more; an EMP takes two. A flash grenade is what opens it: dazed, it stops firing, a stun does double, and a takedown is allowed, so the flash and the guns together bring one down.

import type { Tool } from './enemies/types';

export const WHITE_ARMOUR = 6;
export const WHITE_SPEED = 0.9;
export const WHITE_FIRE_COOLDOWN_S = 0.7;

/** The plates one hit takes from a white guard: a stun one, a head shot or a dazed target one more each, an EMP two. */
export function whiteDamage(tool: Tool, head: boolean, dazed: boolean): number {
  if (tool === 'emp') return 2;
  return 1 + (head ? 1 : 0) + (dazed ? 1 : 0);
}

/** What one weapons kit gives, and the most the agent can carry of each. */
export const KIT = { flash: 3, emp: 1 } as const;
export const CARRY_MAX = { flash: 5, emp: 3 } as const;

/** The stock after taking a kit: capped at what can be carried, and what it added (so a full agent is told the kit was no use). */
export function restock(flashes: number, emps: number): { flashes: number; emps: number; gotFlash: number; gotEmp: number } {
  const f = Math.min(CARRY_MAX.flash, flashes + KIT.flash);
  const e = Math.min(CARRY_MAX.emp, emps + KIT.emp);
  return { flashes: f, emps: e, gotFlash: f - flashes, gotEmp: e - emps };
}

/** The sizes of the three waves of white guards in the exit level (a wave does not come before the last is down, or `WAVE_MAX_WAIT_S` has gone). */
export const WHITE_WAVES: readonly number[] = [2, 3, 4];
export const WAVE_MAX_WAIT_S = 45;

/** One pixel of the model's body texture painted white: the dark parts become silver and the light parts stay white, and a strongly coloured detail (the red bands) is kept as it is. */
export function whitePixel(r: number, g: number, b: number): [number, number, number] {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (hi > 0 && (hi - lo) / hi > 0.45 && lum > 0.12) return [r, g, b];
  const t = Math.min(1, Math.max(0, (lum - 0.15) / 0.6));
  const k = t * t * (3 - 2 * t);
  const v = SILVER + (1 - SILVER) * k;
  return [Math.round(255 * v * 0.97), Math.round(255 * v), Math.round(255 * Math.min(1, v * 1.03))];
}
/** How bright the silver is (the darkest a white guard gets), 0 to 1. */
export const SILVER = 0.74;

/** One pixel of the visor's texture for a white guard: its dark, blood red (the lighter parts a lighter red). */
export function bloodPixel(r: number, g: number, b: number): [number, number, number] {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const v = Math.min(1.4, 0.55 + 1.1 * lum);
  return [Math.min(255, Math.round(150 * v)), Math.round(8 * v), Math.round(16 * v)];
}
/** The name of the model's visor material (the helmet's dark face), which is what turns blood red. */
export const VISOR_MATERIAL = 'Vanguard_VisorMat';
