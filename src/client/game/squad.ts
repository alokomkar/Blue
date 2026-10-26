// Guards as a team. What one guard does that the others notice or answer: stepping off one another instead of standing in the same spot, seeing a partner go down, shouting
// for help when it has the agent, and sending the second guard round the side. Pure geometry and rules (type-only imports), so it is unit-tested under Node; bots.ts and game.ts
// do the moving and the calling.

import type { MazeCells } from './maze';

/** Two guards closer than this are standing in one another (a body is BOT_RADIUS 0.34 across: this leaves a hand's breadth). */
export const PERSONAL_SPACE_M = 0.85;

/**
 * Where `self` is pushed to get clear of everyone it overlaps: half of each overlap along the line away from that other (the other pushes the same way back, so the two part by the
 * whole of it). Exactly on top of another (they were put there), it steps off to one side by a fixed amount instead of dividing by nothing.
 */
export function separationPush(self: { x: number; z: number }, others: ReadonlyArray<{ x: number; z: number }>, space: number = PERSONAL_SPACE_M): { x: number; z: number } {
  let px = 0;
  let pz = 0;
  for (const o of others) {
    const dx = self.x - o.x;
    const dz = self.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= space) continue;
    if (d < 1e-4) {
      px += space / 2;
      continue;
    }
    const push = (space - d) / 2;
    px += (dx / d) * push;
    pz += (dz / d) * push;
  }
  return { x: px, z: pz };
}

/** How far a guard sees a partner go down, and how wide its view is for that (wider than for the agent: a fall catches the eye). */
export const WITNESS_RANGE_M = 14;
export const WITNESS_HALF_ANGLE = 1.75;
/** Right beside it, a guard does not need to be looking. */
export const WITNESS_NEAR_M = 3.5;

/** Whether a guard at `w` facing `facing` (0 = +z) sees the spot (x, z) where a partner has gone down: near, or in its wide view, with nothing in the way (`clear`). */
export function sawItHappen(w: { x: number; z: number; facing: number }, spot: { x: number; z: number }, clear: boolean): boolean {
  const dx = spot.x - w.x;
  const dz = spot.z - w.z;
  const d = Math.hypot(dx, dz);
  if (d > WITNESS_RANGE_M || !clear) return false;
  if (d <= WITNESS_NEAR_M) return true;
  let diff = Math.atan2(dx, dz) - w.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= WITNESS_HALF_ANGLE;
}

/** How far a shout for help carries (guards this far off come), and how long one guard waits before it calls again. */
export const CALL_RANGE_M = 16;
export const CALL_EVERY_S = 4;

/** Who a caller at `from` reaches: the indices of `others` within CALL_RANGE_M. */
export function reachedBy(from: { x: number; z: number }, others: ReadonlyArray<{ x: number; z: number }>, range: number = CALL_RANGE_M): number[] {
  const out: number[] = [];
  others.forEach((o, i) => {
    if (Math.hypot(o.x - from.x, o.z - from.z) <= range) out.push(i);
  });
  return out;
}

const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Where a guard goes to come at the agent from the side: a cell three to six cells from the agent, at least 70 degrees round from the way the guard is coming (as seen from the
 * agent), that the guard can walk to (`dist`: walking distance in cells from the guard, -1 where there is no way), the nearest such to the guard. Null if there is none.
 */
export function flankCell(agent: { x: number; y: number }, guard: { x: number; y: number }, dist: number[][], cells: MazeCells): { x: number; y: number } | null {
  const gx = guard.x - agent.x;
  const gy = guard.y - agent.y;
  const gl = Math.hypot(gx, gy);
  if (gl < 1e-6) return null;
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const r = Math.hypot(dx, dy);
      if (r < 3 || r > 6) continue;
      const x = agent.x + dx;
      const y = agent.y + dy;
      const c = cells[y]?.[x];
      const d = dist[y]?.[x] ?? -1;
      if (!c || d < 0 || !STEP.some((_, k) => [c.E, c.W, c.S, c.N][k])) continue;
      const cos = (dx * gx + dy * gy) / (r * gl);
      if (cos > Math.cos((70 * Math.PI) / 180)) continue;
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}
