// Watchdog packs: from job 8 a floor's dogs hunt together. They roam on
// their own, then every half minute or so the whole pack heads for a shared
// meeting point, a junction central to its ground, sniffs around there for a
// few seconds and splits up again. That rhythm is the player's opening: work
// out where they meet, set a trap there and take the whole pack in one blast.
// This file is the pure part: choosing the meeting point and the pack's
// clock. Type-only imports, so it's unit-tested under Node.

import type { MazeCells } from '../maze';

/** Roaming apart between regroups, in seconds. */
export const PACK_ROAM_S: readonly [number, number] = [25, 35];
/** The first regroup comes sooner, so a player can catch the rhythm early. */
export const PACK_FIRST_S: readonly [number, number] = [12, 20];
/** Gathered at the meeting point, sniffing around, before splitting up. */
export const PACK_HUDDLE_S = 6;
/** How long the pack waits for stragglers (one off chasing a noise) before huddling with whoever made it. */
export const PACK_GATHER_MAX_S = 20;
/** A pack's ground: its dogs roam within this many cells' walk of the meeting point, so a regroup never takes long. */
export const PACK_RANGE_CELLS = 10;
/** A dog that hears the player calls pack-mates within this many cells' walk to the same spot. */
export const PACK_CALL_CELLS = 8;

/** Roaming apart, heading for the meeting point, or gathered there. */
export type PackPhase = 'roam' | 'gather' | 'huddle';
export type PackState = { phase: PackPhase; timer: number };

const between = ([lo, hi]: readonly [number, number], rand: () => number): number => lo + rand() * (hi - lo);

export function startPack(rand: () => number = Math.random, first: readonly [number, number] = PACK_FIRST_S): PackState {
  return { phase: 'roam', timer: between(first, rand) };
}

/**
 * One step of the pack's clock. `arrived` is how many dogs are at the meeting
 * point, `active` how many are still in the fight.
 */
export function advancePack(
  s: PackState,
  dt: number,
  arrived: number,
  active: number,
  rand: () => number = Math.random,
  roamS: readonly [number, number] = PACK_ROAM_S
): PackState {
  const timer = s.timer - dt;
  const roam = (): PackState => ({ phase: 'roam', timer: between(roamS, rand) });
  const huddle: PackState = { phase: 'huddle', timer: PACK_HUDDLE_S };
  switch (s.phase) {
    case 'roam':
      return timer > 0 ? { phase: 'roam', timer } : { phase: 'gather', timer: PACK_GATHER_MAX_S };
    case 'gather':
      if (active === 0) return roam();
      if (arrived >= active) return huddle;
      if (timer <= 0) return arrived > 0 ? huddle : roam();
      return { phase: 'gather', timer };
    case 'huddle':
      return timer > 0 ? { phase: 'huddle', timer } : roam();
  }
}

function openSides(cells: MazeCells, cols: number, rows: number, x: number, y: number): number {
  const c = cells[y]![x]!;
  return (c.N && y > 0 ? 1 : 0) + (c.S && y < rows - 1 ? 1 : 0) + (c.W && x > 0 ? 1 : 0) + (c.E && x < cols - 1 ? 1 : 0);
}

function walkFrom(cells: MazeCells, cols: number, rows: number, sx: number, sy: number): number[][] {
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  dist[sy]![sx] = 0;
  const queue: Array<[number, number]> = [[sx, sy]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    const c = cells[y]![x]!;
    const d = dist[y]![x]!;
    for (const [open, nx, ny] of [
      [c.N, x, y - 1],
      [c.S, x, y + 1],
      [c.W, x - 1, y],
      [c.E, x + 1, y],
    ] as const) {
      if (!open || nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny]![nx]! >= 0) continue;
      dist[ny]![nx] = d + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

/**
 * Where a pack meets: the junction (three or more ways out, so they come in
 * from different sides) that every dog can reach, as central to them as
 * possible — the smallest longest walk, then the smallest total. Falls back
 * to any shared corridor cell when no junction qualifies; null when the dogs
 * can't all reach one another.
 */
export function meetingPoint(
  cells: MazeCells,
  cols: number,
  rows: number,
  starts: Array<{ x: number; y: number }>,
  avoid: (x: number, y: number) => boolean = () => false
): { x: number; y: number } | null {
  if (starts.length === 0) return null;
  const fields = starts.map((s) => walkFrom(cells, cols, rows, s.x, s.y));
  let best: { x: number; y: number; worst: number; total: number; junction: boolean } | null = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (avoid(x, y)) continue;
      const ds = fields.map((f) => f[y]![x]!);
      if (ds.some((d) => d < 0)) continue;
      const junction = openSides(cells, cols, rows, x, y) >= 3;
      const worst = Math.max(...ds);
      const total = ds.reduce((a, b) => a + b, 0);
      const better =
        !best ||
        (junction && !best.junction) ||
        (junction === best.junction && (worst < best.worst || (worst === best.worst && total < best.total)));
      if (better) best = { x, y, worst, total, junction };
    }
  }
  return best && { x: best.x, y: best.y };
}
