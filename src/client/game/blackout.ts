// Blackouts: from job 4 part of each floor has lost its power. Its ceiling
// lights are dead and, while the player is inside, the building's ambient
// glow fades out too, leaving only what a torch, a flare, a guard's lamp or
// night vision shows. Guards see less far into the dark, unless your torch
// is on. Here is where the blackouts go: patches of connected cells grown
// from seeds well away from where the player arrives. Pure (type-only
// imports), so it's unit-tested under Node.

import type { MazeCells } from './maze';

/** Cells from the arrival lift a blackout keeps clear of, so a job never opens in the dark. */
export const BLACKOUT_CLEAR_OF_SPAWN = 5;
const SEED_TRIES = 8;

/**
 * Up to `count` blackouts of about `size` cells each, as a grid of dark
 * cells. Each grows outward through open passages from a seed at least
 * BLACKOUT_CLEAR_OF_SPAWN from the spawn (by `dist`, the walking distance),
 * never into a cell `avoid` rules out, and never touching another blackout.
 */
export function planBlackouts(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  count: number,
  size: number,
  avoid: (x: number, y: number) => boolean = () => false,
  rand: () => number = Math.random
): boolean[][] {
  const dark = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const usable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < cols && y < rows && !dark[y]![x] && (dist[y]![x] ?? -1) >= BLACKOUT_CLEAR_OF_SPAWN && !avoid(x, y);
  // A cell next to an earlier blackout would merge the two into one.
  let earlier = new Set<string>();
  const touchesEarlier = (x: number, y: number): boolean =>
    earlier.has(`${x},${y - 1}`) || earlier.has(`${x},${y + 1}`) || earlier.has(`${x - 1},${y}`) || earlier.has(`${x + 1},${y}`);

  /** Grows a patch from `seed`, up to `size` cells, without claiming it yet. */
  const grow = (seed: { x: number; y: number }): Set<string> => {
    const mine = new Set<string>();
    const frontier = [seed];
    while (frontier.length > 0 && mine.size < size) {
      // Growing from a random edge cell (not strictly breadth-first) gives a blob that follows the corridors.
      const { x, y } = frontier.splice(Math.floor(rand() * frontier.length), 1)[0]!;
      if (!usable(x, y) || touchesEarlier(x, y) || mine.has(`${x},${y}`)) continue;
      mine.add(`${x},${y}`);
      const c = cells[y]![x]!;
      if (c.N) frontier.push({ x, y: y - 1 });
      if (c.S) frontier.push({ x, y: y + 1 });
      if (c.W) frontier.push({ x: x - 1, y });
      if (c.E) frontier.push({ x: x + 1, y });
    }
    return mine;
  };

  for (let zone = 0; zone < count; zone++) {
    const seeds: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (usable(x, y) && !touchesEarlier(x, y)) seeds.push({ x, y });
    if (seeds.length === 0) break;
    // A seed can land in a small pocket (a dead-end branch hemmed in by the spawn's clear zone): try a few, keep the biggest.
    let best = new Set<string>();
    for (let tries = 0; tries < SEED_TRIES && best.size < size; tries++) {
      const patch = grow(seeds[Math.floor(rand() * seeds.length)]!);
      if (patch.size > best.size) best = patch;
    }
    for (const key of best) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      dark[y]![x] = true;
    }
    earlier = new Set([...earlier, ...best]);
  }
  return dark;
}
