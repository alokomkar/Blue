// The flash grenade: what it does and when the game offers it. Thrown, it goes off with a crack and a white-out; every guard and dog with
// a clear line to it is blinded and deafened for about ten seconds (a heavy's armour halves that), long enough to get away and find
// somewhere to hide, and then goes to look at where it went off, not at where the agent went. It's loud: everyone else within earshot comes
// to see. It's offered when a guard or a dog has the agent (the prompt, and a beat of slow motion to reach it). Pure, and tested under Node.

import type { EnemyKind } from './enemies/types';

/** Flash grenades a job starts with. */
export const FLASH_START = 2;
/** Everything with a clear line to the bang this close is dazed, in metres. */
export const FLASH_RADIUS = 7;
export const DAZE_S = 10;
/** A heavy's visor and armour take the edge off. */
export const HEAVY_DAZE_S = 5;
/** Guards and dogs this many cells' walk away come to look at the bang (after it, not while the dazed ones stumble about). */
export const FLASH_NOISE_CELLS = 9;
/** What the agent's suspicion is brought down to if the flash dazes someone: out of the blind spot, but not scot-free. */
export const SUSPICION_AFTER = 55;
export const FLASH_COOLDOWN_S = 1.2;

/** How long this kind of enemy is dazed, or null when a flash does nothing to it (drones and mines aren't blinded or deafened). */
export function dazeFor(kind: EnemyKind): number | null {
  if (kind === 'drone' || kind === 'crawler') return null;
  return kind === 'heavy' ? HEAVY_DAZE_S : DAZE_S;
}

// ---- when it's offered ----

/** A guard this close and onto the agent (and the suspicion this high) is a chase worth a grenade; a dog onto the agent from a little further is too. */
export const PANIC_RADIUS = 7;
export const DOG_PANIC_RADIUS = 6;
export const PANIC_SUSPICION = 50;

export type Threat = { kind: EnemyKind; /** Onto the agent right now. */ alert: boolean; disabled: boolean; dist: number };

/** Whether the agent is about to be caught: a hunter close and suspicion high, or a dog on their trail close. */
export function panicking(threats: ReadonlyArray<Threat>, suspicion: number): boolean {
  return threats.some((t) => {
    if (!t.alert || t.disabled || dazeFor(t.kind) === null) return false;
    if (t.kind === 'watchdog') return t.dist <= DOG_PANIC_RADIUS;
    return t.dist <= PANIC_RADIUS && suspicion >= PANIC_SUSPICION;
  });
}

// ---- the beat of slow motion ----

/** The game runs at this share of its pace for SLOW_S real seconds the first moment a chase becomes a panic, so the button can be found. */
export const SLOW_SCALE = 0.25;
export const SLOW_S = 0.9;
/** A chase has to have been over this long before the next one gets a slow-motion beat of its own. */
export const PANIC_QUIET_S = 3;

export type Slow = { /** Real seconds of slow motion left. */ left: number; /** This chase has had its beat. */ used: boolean; /** Real seconds since the last panic. */ quiet: number };

export const NO_SLOW: Slow = { left: 0, used: false, quiet: 0 };

/** One real frame of it: `panic` is whether the agent is about to be caught, `grenades` how many are left. Returns the new state and the game's pace for the next frame. */
export function stepSlow(s: Slow, panic: boolean, grenades: number, frameDt: number): { state: Slow; scale: number } {
  let { left, used, quiet } = s;
  if (panic && grenades > 0) {
    quiet = 0;
    if (!used) {
      used = true;
      left = SLOW_S;
    }
  } else {
    quiet += frameDt;
    if (quiet >= PANIC_QUIET_S) used = false;
  }
  left = Math.max(0, left - frameDt);
  return { state: { left, used, quiet }, scale: left > 0 ? SLOW_SCALE : 1 };
}

/** Throwing it ends the slow motion at once. */
export function endSlow(s: Slow): Slow {
  return { ...s, left: 0 };
}
