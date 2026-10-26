// Where a wave of guards comes down in the exit level: each on a spot of its own, spread round the agent, so they close in from different sides instead of landing in a heap. Pure, so it is
// unit-tested under Node.

export type Cell = { x: number; y: number };

/** The angle from `from` to `to`, in radians. */
const bearing = (from: Cell, to: Cell): number => Math.atan2(to.x - from.x, to.y - from.y);

/** The smallest angle between two bearings, 0 to PI. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/**
 * `n` spots out of `candidates` (cells round the agent at `player`), as spread out as can be: the first is any, and each next is the one farthest from those taken (by the walk between
 * them, and by which side of the agent it is on, so two do not come from one direction). With fewer candidates than `n`, the spots go round again, so the list is always `n` long (or empty
 * with no candidate).
 */
export function spreadSpots(candidates: readonly Cell[], n: number, player: Cell, rnd: () => number = Math.random): Cell[] {
  if (candidates.length === 0 || n <= 0) return [];
  const chosen: Cell[] = [candidates[Math.floor(rnd() * candidates.length)]!];
  const left = candidates.filter((c) => c !== chosen[0]);
  while (chosen.length < n && left.length > 0) {
    let best = 0;
    let bestScore = -Infinity;
    left.forEach((c, i) => {
      const gap = Math.min(...chosen.map((s) => Math.hypot(s.x - c.x, s.y - c.y)));
      const side = Math.min(...chosen.map((s) => apart(bearing(player, s), bearing(player, c))));
      const score = gap + side * 4 + rnd() * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    chosen.push(left.splice(best, 1)[0]!);
  }
  for (let i = 0; chosen.length < n; i++) chosen.push(chosen[i % chosen.length]!);
  return chosen;
}

/** `n` bearings round the agent, evenly apart (so at least 360 / n degrees from one another), the first at `offset`. */
export function evenBearings(n: number, offset: number): number[] {
  return Array.from({ length: n }, (_, i) => offset + (i * Math.PI * 2) / Math.max(1, n));
}

/**
 * The cell, among `candidates`, that lies nearest to the bearing `bearing` from `player`, `minR` to `maxR` cells off: where one guard of a wave heads for, so that the wave comes in on
 * different lines instead of all down the agent's own. Null when no cell is in that ring.
 */
export function ringCell(candidates: readonly Cell[], player: Cell, bearing: number, minR = 1.2, maxR = 2.4): Cell | null {
  let best: Cell | null = null;
  let bestArc = Infinity;
  for (const c of candidates) {
    const r = Math.hypot(c.x - player.x, c.y - player.y);
    if (r < minR || r > maxR) continue;
    const a = Math.atan2(c.x - player.x, c.y - player.y);
    let arc = Math.abs(a - bearing) % (Math.PI * 2);
    if (arc > Math.PI) arc = Math.PI * 2 - arc;
    if (arc < bestArc) {
      bestArc = arc;
      best = c;
    }
  }
  return best;
}
