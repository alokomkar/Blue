// Heartbeat pacing — how fast and loud the player's heart runs, from how
// close the nearest active bot is. Pure, so it's unit-testable under Node;
// audio.ts plays the beats and game.ts eases between paces each frame.

export const CALM_BPM = 62;
export const PANIC_BPM = 150;
const NEAR = 3; // world units — at or inside this, the heart is racing
const FAR = 14; // beyond this, calm — a little past a bot's DETECT_RADIUS (10)
const HUNTED_THREAT = 0.85; // a bot chasing you keeps the heart near its peak wherever it is
const CALM_VOLUME = 0.25; // audible under the ambience, but not something you notice until it quickens

/** 0 (nothing near) → 1 (a bot right on top of you, or giving chase). */
export function threatLevel(nearestBotDist: number, hunted: boolean): number {
  const byDistance = Math.min(1, Math.max(0, (FAR - nearestBotDist) / (FAR - NEAR)));
  return hunted ? Math.max(byDistance, HUNTED_THREAT) : byDistance;
}

export function heartPace(threat: number): { bpm: number; volume: number } {
  return { bpm: CALM_BPM + (PANIC_BPM - CALM_BPM) * threat, volume: CALM_VOLUME + (1 - CALM_VOLUME) * threat };
}

/**
 * Eases the current rate toward the target: it quickens quickly (adrenaline)
 * and settles slowly, so a bot walking past leaves the heart racing a while.
 */
export function easeBpm(current: number, target: number, dt: number): number {
  const tau = target > current ? 0.6 : 2.5;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}
