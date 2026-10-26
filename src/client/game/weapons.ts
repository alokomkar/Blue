// The attack picks its own tool. An unaware enemy within reach from behind
// gets a silent takedown — the way the game wants you to play. Otherwise
// the gun fires a stun shot for anything a stun can drop, or an EMP pulse
// for anything it can't (watchdogs), as long as there's a charge; a watchdog
// with no charge left is still slowed by a stun, to buy a moment to get away. The Fire
// button's label shows the choice live, so nothing is spent by surprise.
// Holding Fire (or X) forces an EMP. Pure, so the rules are unit-testable
// under Node.

import type { Tool } from './enemies/types';

export const EMP_BLAST_RADIUS = 2.5; // world units around where the pulse lands

/** What the next press of Fire does: a tool, or nothing because an EMP is needed and there's none. */
export type FireChoice = Tool | 'none';

/**
 * Picks the attack. `takedown` is whether an enemy is within reach from
 * behind (detection.ts canTakedown) — that always comes first, unless an
 * EMP is being forced. Otherwise it's the gun, for whatever is in the sights
 * (`target` null = nothing there: the stun gun fires into the air).
 */
export function pickTool(target: { stunImmune: boolean; stunSlows?: boolean } | null, empCharges: number, forceEmp = false, takedown = false): FireChoice {
  if (forceEmp) return empCharges > 0 ? 'emp' : 'none';
  if (takedown) return 'takedown';
  if (target?.stunImmune) return empCharges > 0 ? 'emp' : target.stunSlows ? 'stun' : 'none';
  return 'stun';
}

/** The Fire button's face for that choice. */
export function fireLabel(choice: FireChoice, empCharges: number): string {
  if (choice === 'emp') return `EMP ×${empCharges}`;
  if (choice === 'none') return 'NO EMP';
  if (choice === 'takedown') return 'TAKEDOWN';
  return 'FIRE';
}

/** Everything the pulse catches: active targets within the blast radius of where it lands. */
export function empVictims<T extends { worldX: number; worldZ: number; disabled: boolean }>(targets: T[], x: number, z: number, radius = EMP_BLAST_RADIUS): T[] {
  return targets.filter((t) => !t.disabled && Math.hypot(t.worldX - x, t.worldZ - z) <= radius);
}
