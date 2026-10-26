// Ways in. Every building can be entered three ways, and the player picks
// one on the briefing:
//
//   Loading dock   — the freight lift on the ground floor: the usual way in.
//   Rooftop        — a hatch at the far end of the upper floor, somewhere
//                    quiet, beside the junction where the uplink's line
//                    can be cut; but the exit is all the way downstairs.
//   Service tunnel — a grate deep in the ground floor, closer to the exit,
//                    in the pitch dark, with a watchdog prowling nearby.
//
// All three spots are reserved in every building whichever is picked, so a
// Daily Heist's building is the same for everyone. Here: which ways in a
// job offers, and where the hatch and the grate go. Type-only imports, so
// it's unit-tested under Node.

import type { MazeCells } from './maze';
import type { Dir } from './security';

export type EntryId = 'dock' | 'roof' | 'tunnel';

export const ENTRIES: Record<EntryId, { title: string; blurb: string }> = {
  dock: { title: 'Loading dock', blurb: 'The freight lift, on the ground floor with the uplink. The usual way in, and the guards know it.' },
  roof: {
    title: 'Rooftop',
    blurb: 'A hatch on the quiet far side of the upper floor, where you can cut the link’s line yourself. The exit is all the way downstairs.',
  },
  tunnel: { title: 'Service tunnel', blurb: 'A grate deep in the ground floor, nearer the exit. Pitch dark down there, and something prowls it.' },
};

/** The ways in job `job` offers: the dock from the first, the roof from job 2, the tunnel from job 3; the Daily Heist all three. */
export function entriesFor(job: number, daily: boolean): EntryId[] {
  if (daily || job >= 3) return ['dock', 'roof', 'tunnel'];
  return job >= 2 ? ['dock', 'roof'] : ['dock'];
}

/** No guard or dog starts within this many cells' walk of the roof hatch: the quiet way in. */
export const ROOF_QUIET_CELLS = 2;

const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function openings(cells: MazeCells, x: number, y: number): Dir[] {
  return DIRS.filter((d) => cells[y]![x]![d]);
}

/** A cell's one opening, for a dead end: the way someone arriving there faces. */
export function facingOut(cells: MazeCells, x: number, y: number): Dir {
  return openings(cells, x, y)[0] ?? 'S';
}

/** Every cell: for a floor with no locked doors, or before they're known. */
const ANYWHERE = (): boolean => true;

/**
 * The roof hatch on the upper floor: the free dead end farthest from the
 * stair landing (walking distance `dist`), so coming in from the roof really
 * is coming in from the other side. `open`: cells no locked door seals off
 * (security.ts's section -1) — a hatch inside a locked section would shut
 * the agent in, since a door's terminal is always outside what it seals.
 */
export function roofHatch(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  used: ReadonlySet<string>,
  open: (x: number, y: number) => boolean = ANYWHERE
): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (used.has(`${x},${y}`) || !open(x, y) || openings(cells, x, y).length !== 1) continue;
      const d = dist[y]![x]!;
      if (d > 0 && (!best || d > best.d)) best = { x, y, d };
    }
  }
  return best && { x: best.x, y: best.y };
}

/**
 * The tunnel grate on the ground floor: a free dead end well into the
 * building, as near as can be to 60% of the way from the start to the exit
 * (`exitDist` steps), and never within a few steps of either; like the
 * hatch, only where no locked door seals it off (`open`).
 */
export function tunnelGrate(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  used: ReadonlySet<string>,
  exitDist: number,
  open: (x: number, y: number) => boolean = ANYWHERE
): { x: number; y: number } | null {
  const want = exitDist * 0.6;
  let best: { x: number; y: number; off: number } | null = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const d = dist[y]![x]!;
      if (used.has(`${x},${y}`) || !open(x, y) || openings(cells, x, y).length !== 1 || d < 4 || d > exitDist - 3) continue;
      const off = Math.abs(d - want);
      if (!best || off < best.off) best = { x, y, off };
    }
  }
  return best && { x: best.x, y: best.y };
}

/** Every cell within `steps` of (x, y) by walking, (x, y) included. */
export function withinSteps(cells: MazeCells, cols: number, rows: number, x: number, y: number, steps: number): Array<{ x: number; y: number }> {
  const seen = new Set([`${x},${y}`]);
  let frontier = [{ x, y }];
  const out = [{ x, y }];
  for (let s = 0; s < steps; s++) {
    const next: Array<{ x: number; y: number }> = [];
    for (const c of frontier) {
      for (const d of openings(cells, c.x, c.y)) {
        const nx = c.x + DELTA[d][0];
        const ny = c.y + DELTA[d][1];
        const k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(k)) continue;
        seen.add(k);
        next.push({ x: nx, y: ny });
      }
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}
