// How the agent holds themselves: standing, crouched (the old "sneak"), or prone (flat on the floor). One key does it all: Shift steps
// stand, crouch, prone and back, and the step it takes next depends on which way it was going when it was last pressed, with a short
// memory, so a second quick press carries on (stand to crouch to prone), and one after a pause goes back up (so tapping Shift to
// stop sneaking works as it always has). Prone is the stealthiest and slowest: guards see a prone player from a third of the
// distance, hear them from a step away, and they crawl at about a sixth of walking pace; the price is that nothing can be done from the floor.
// Pure, so it's unit-tested under Node.

export type Posture = 'stand' | 'crouch' | 'prone';
export type Direction = 'down' | 'up';
export type PostureState = { posture: Posture; /** Which way the last press was going. */ dir: Direction; /** When it was pressed (seconds on the job's clock). */ at: number };

/** A second press this soon after the last carries on the same way; after longer, from a crouch it means stand. */
export const POSTURE_MEMORY_S = 1.5;
/** How a guard's sight and all-round awareness shrink for a player lying flat. */
export const PRONE_SIGHT = 0.35;
export const PRONE_AWARE = 0.5;
/** How fast a prone player crawls, against walking pace. */
export const PRONE_SPEED_FACTOR = 0.16;
/** How far the noise of crawling carries, along the corridors (walking is 9, sneaking 3). */
export const PRONE_NOISE = 1;

export const STANDING: PostureState = { posture: 'stand', dir: 'up', at: -Infinity };

/** What Shift does now: one step along the stand, crouch, prone ladder. */
export function press(s: PostureState, now: number): PostureState {
  switch (s.posture) {
    case 'stand':
      return { posture: 'crouch', dir: 'down', at: now };
    case 'prone':
      return { posture: 'crouch', dir: 'up', at: now };
    case 'crouch': {
      const carryOn = s.dir === 'down' && now - s.at <= POSTURE_MEMORY_S;
      return carryOn ? { posture: 'prone', dir: 'down', at: now } : { posture: 'stand', dir: 'up', at: now };
    }
  }
}

/** A silent night (twists.ts): there is no standing, so the one key just swaps crouch and flat. */
export function pressSilent(s: PostureState, now: number): PostureState {
  return s.posture === 'prone' ? { posture: 'crouch', dir: 'up', at: now } : { posture: 'prone', dir: 'down', at: now };
}

/** Where the next press would take the agent, for the indicator. */
export function nextPosture(s: PostureState, now: number): Posture {
  return press(s, now).posture;
}

/** Crouched or flat: what the old "sneaking" meant (cover, takedowns, how far a guard sees and hears). */
export const isLow = (p: Posture): boolean => p !== 'stand';
