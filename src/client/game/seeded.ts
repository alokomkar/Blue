// Seeded randomness, for building the Daily Heist: the same seed has to
// build the same building on every player's device. Everything that lays a
// job out (the maze, security, rooms, enemy posts, blackouts, decor) draws
// from Math.random, a few dozen call sites across a dozen modules, so rather
// than thread a generator through all of them, Math.random itself is swapped
// for a seeded one while the job is built and put back straight after.
// What happens once play starts (how guards wander, sparks, sounds) stays
// truly random: every player's run goes its own way from there anyway.

const nativeRandom = Math.random;

/** mulberry32: a small, fast generator with a 32-bit state, plenty for level layout. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Makes Math.random repeat the sequence `seed` gives, until restoreRandom(). */
export function seedRandom(seed: number): void {
  Math.random = mulberry32(seed);
}

/** Puts the browser's own Math.random back. Safe to call when it was never swapped. */
export function restoreRandom(): void {
  Math.random = nativeRandom;
}
