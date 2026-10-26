// How far the player's noise carries, for enemies that hunt by ear
// (watchdogs). Measured along the corridors, not straight through walls —
// game.ts supplies the walking distance. Standing still is silent, sneaking
// only carries a few steps, walking carries a couple of cells, and a stun
// shot rings out for a moment. Camo does nothing for it. Pure, tested.

export const WALK_NOISE = 9;
export const SNEAK_NOISE = 3;
export const SHOT_NOISE = 12;
/** Crawling flat: a rustle a step away (posture.ts's PRONE_NOISE). */
export const PRONE_CRAWL_NOISE = 1;
/** Running flat out (dash.ts's DASH_NOISE): further than a walk. */
export const DASH_RUN_NOISE = 14;
/** A silent night (twists.ts): crouching still carries this far, and crawling this far: every step is heard. */
export const SILENT_SNEAK_NOISE = 8;
export const SILENT_CRAWL_NOISE = 3;
export const SHOT_NOISE_S = 0.5; // how long a shot stays audible

/** The player's noise radius this frame. `sinceShot` is seconds since the last shot fired (Infinity if none). */
export function noiseRadius(moving: boolean, sneaking: boolean, sinceShot = Infinity, prone = false, dashing = false, silentNight = false): number {
  const crawl = silentNight ? SILENT_CRAWL_NOISE : PRONE_CRAWL_NOISE;
  const creep = silentNight ? SILENT_SNEAK_NOISE : SNEAK_NOISE;
  const steps = moving ? (prone ? crawl : sneaking ? creep : dashing ? DASH_RUN_NOISE : WALK_NOISE) : 0;
  return sinceShot < SHOT_NOISE_S ? Math.max(steps, SHOT_NOISE) : steps;
}

/** Heard: some noise, and the listener is within its reach along the corridors. */
export function canHear(noise: number, soundDistance: number): boolean {
  return noise > 0 && soundDistance <= noise;
}
