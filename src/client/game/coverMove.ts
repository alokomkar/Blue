// Fighting from cover: where a guard that has seen the agent goes to get behind something (a crate, a desk, a locker), and where it steps out to look and shoot from. Pure
// geometry over the floor's boxes, so it is unit-tested under Node; bots.ts runs the sequence (run to cover, wait, lean out, fall back, then on to the next one).

import type { Obstacle } from './avoid';

/** Whether a body of radius `r` at (x, z) overlaps any box (avoid.ts's blockedAt: repeated so this file's only imports are types, which Node's test runner can load). */
function blockedAt(x: number, z: number, r: number, boxes: ReadonlyArray<Obstacle>): boolean {
  return boxes.some((b) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ);
}

/** A box something can hide behind (its `cover` is set); walls have none. */
export type CoverBox = Obstacle & { cover?: 'low' | 'tall' };

export type Point = { x: number; z: number };
export type CoverPick = { box: CoverBox; /** Behind it, as seen from the agent. */ hide: Point; /** At its end, where the agent can see and be seen. */ peek: Point };

/** The body's radius for standing room. */
const R = 0.3;
/** How far behind a box a guard stands, beyond its edge and its own body. */
const BEHIND = 0.25;
/** How far past the box's end a guard stands to look round it, beyond its own body. */
const BESIDE = 0.3;

/** Whether the segment a-b passes through the box (Liang-Barsky). */
export function segmentHitsBox(a: Point, b: Point, box: Obstacle): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dz, a.z - box.minZ],
    [dz, box.maxZ - a.z],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) return false;
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 <= t1;
}

/** Whether anything in `boxes` is between a and b. */
export function lineBlocked(a: Point, b: Point, boxes: ReadonlyArray<Obstacle>): boolean {
  return boxes.some((box) => segmentHitsBox(a, b, box));
}

export type CoverOptions = {
  /** The cover must be at least this much nearer the agent than the guard is now: it goes forward, not just aside. */
  minProgress?: number;
  /** The longest run to cover. */
  maxRun?: number;
  /** Cover closer to the agent than this is no cover: it is a fight. */
  minFromAgent?: number;
};

/**
 * The best cover for a guard at `from` to take against an agent at `agent`: the nearest box it can get behind, that brings it nearer the agent, with a free spot behind it
 * (hidden from the agent) and a free spot at its end to lean out to (not hidden). Null if there is none.
 */
export function pickCover(from: Point, agent: Point, boxes: ReadonlyArray<CoverBox>, options: CoverOptions = {}): CoverPick | null {
  const { minProgress = 1, maxRun = 10, minFromAgent = 2.5 } = options;
  const here = Math.hypot(from.x - agent.x, from.z - agent.z);
  let best: { pick: CoverPick; score: number } | null = null;
  for (const box of boxes) {
    if (!box.cover) continue;
    const hw = (box.maxX - box.minX) / 2;
    const hd = (box.maxZ - box.minZ) / 2;
    if (hw > 2.4 || hd > 2.4) continue; // a wall of a thing, not a thing to crouch behind
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const dx = cx - agent.x;
    const dz = cz - agent.z;
    const dl = Math.hypot(dx, dz);
    if (dl < minFromAgent) continue;
    const nx = dx / dl;
    const nz = dz / dl;
    const reach = Math.abs(nx) * hw + Math.abs(nz) * hd + R + BEHIND;
    const hide = { x: cx + nx * reach, z: cz + nz * reach };
    if (blockedAt(hide.x, hide.z, R, boxes) || !lineBlocked(agent, hide, [box])) continue;
    const run = Math.hypot(hide.x - from.x, hide.z - from.z);
    const progress = here - Math.hypot(hide.x - agent.x, hide.z - agent.z);
    if (run > maxRun || progress < minProgress) continue;
    // Out at the end of the box, to either side: free, and in the agent's sight.
    const px = -nz;
    const pz = nx;
    const side = Math.abs(px) * hw + Math.abs(pz) * hd + R + BESIDE;
    let peek: Point | null = null;
    for (const s of [1, -1]) {
      const c = { x: hide.x + px * s * side, z: hide.z + pz * s * side };
      if (blockedAt(c.x, c.z, R, boxes) || lineBlocked(agent, c, boxes)) continue;
      if (!peek || Math.hypot(c.x - from.x, c.z - from.z) < Math.hypot(peek.x - from.x, peek.z - from.z)) peek = c;
    }
    if (!peek) continue;
    const score = run + 0.5 * Math.hypot(hide.x - agent.x, hide.z - agent.z);
    if (!best || score < best.score) best = { pick: { box, hide, peek }, score };
  }
  return best?.pick ?? null;
}
