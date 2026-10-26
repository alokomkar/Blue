// Line lasers: single beams across a corridor that move, alone or two or three in a row. A horizontal one rises and falls (it comes all the way down to the floor and goes up to
// above a crouched head), so you cross it lying flat or crouched while it is above you, never standing. A vertical one hangs from the ceiling and sweeps from one wall to the other,
// its lower end well off the floor: lie flat (or, for a high one, crouch) and crawl under. A cloak does nothing against either (they measure you, like the gates, evade.ts);
// being caught costs suspicion and brings guards to look, as the other moving lasers do (game.ts's tripLaser). Pure (type-only imports): unit-tested under Node.

import type { MazeCells } from './maze';
import type { Posture } from './evade';

/** How high the agent is in each posture: evade.ts's POSTURE_HEIGHT (copied: a runtime import would not load under Node's type stripping, and the test below holds the two together). */
export const BODY_HEIGHT: Record<Posture, number> = { stand: 1.85, crouch: 1.25, prone: 0.45 };

export type LineOrient = 'h' | 'v';

/**
 * A group of `count` (1-3) lines in the straight corridor cell (x, y), spaced `LINE_SPACING` apart along the corridor, each a little behind the one before in its cycle.
 * `spanX`: the corridor runs north-south, so the beams run along x (lasers.ts's convention). `gap`: a vertical line's lower end (metres off the floor).
 */
export type LineLaser = { x: number; y: number; spanX: boolean; orient: LineOrient; count: 1 | 2 | 3; phase: number; gap: number };

/** Metres between the lines of a group along the corridor. */
export const LINE_SPACING = 1.25;
/** A horizontal line's lowest and highest (the top above a crouched head, under a standing one's), and the seconds one rise and fall takes. */
export const LINE_LOW = 0.08;
export const LINE_HIGH = 1.55;
export const LINE_PERIOD_S = 5.2;
/** A vertical line's sweep: the margin it keeps from each wall, and the seconds for a one-way sweep. */
export const LINE_MARGIN = 0.35;
export const LINE_SWEEP_S = 3.4;
/** A vertical line's lower end: high enough to crawl under, or to crouch under. */
export const GAP_PRONE = 0.62;
export const GAP_CROUCH = 1.4;
/** How far either side of its plane a beam catches someone, besides their own radius. */
const LINE_THICKNESS = 0.08;

/** Where along the cycle line `i` of a group is: each follows the one before by a third of a cycle, so the gaps do not line up. */
const lagOf = (g: LineLaser, i: number): number => g.phase + i / 3;

/** A triangle wave of `u` (cycles): 0 up to 1 and back, smoothed at the ends. */
function wave(u: number): number {
  const f = ((u % 1) + 1) % 1;
  const tri = f < 0.5 ? f * 2 : 2 - f * 2;
  return tri * tri * (3 - 2 * tri);
}

/** Where line `i` of group `g` sits along the corridor, relative to the cell's middle. */
export function lineOffset(g: LineLaser, i: number): number {
  return (i - (g.count - 1) / 2) * LINE_SPACING;
}

/** A horizontal line's height at `t` seconds. */
export function lineHeight(g: LineLaser, i: number, t: number): number {
  return LINE_LOW + (LINE_HIGH - LINE_LOW) * wave(lagOf(g, i) + t / LINE_PERIOD_S);
}

/** A vertical line's place across the corridor at `t` seconds, relative to the cell's middle: from one wall's margin to the other's. */
export function lineSide(g: LineLaser, i: number, t: number, cell: number): number {
  const reach = cell / 2 - LINE_MARGIN;
  return (wave(lagOf(g, i) + t / (2 * LINE_SWEEP_S)) * 2 - 1) * reach;
}

/** Whether any line of `g` has someone of radius `r` at floor-local (px, pz), in `posture`, at `t` seconds. */
export function lineHits(g: LineLaser, t: number, px: number, pz: number, cell: number, r: number, posture: Posture): boolean {
  const along = g.spanX ? pz - g.y * cell : px - g.x * cell;
  const across = g.spanX ? px - g.x * cell : pz - g.y * cell;
  if (Math.abs(across) > cell / 2) return false;
  const body = BODY_HEIGHT[posture];
  for (let i = 0; i < g.count; i++) {
    if (Math.abs(along - lineOffset(g, i)) > r + LINE_THICKNESS) continue;
    if (g.orient === 'h') {
      if (lineHeight(g, i, t) < body) return true;
    } else if (g.gap < body && Math.abs(across - lineSide(g, i, t, cell)) < r + LINE_THICKNESS) return true;
  }
  return false;
}

export const LINE_HINT: Record<LineOrient, string> = {
  h: 'A LASER LINE THAT RISES AND FALLS · CAMO WON’T HELP · LIE FLAT OR CROUCH AND CROSS WHILE IT’S ABOVE YOU, NEVER STANDING',
  v: 'A LASER LINE SWEEPING ACROSS THE CORRIDOR, HIGH OFF THE FLOOR · CAMO WON’T HELP · LIE FLAT (OR CROUCH, IF IT HANGS HIGH) AND CRAWL UNDER IT',
};

export const LINE_NOTE = {
  title: 'Laser lines',
  text: 'Some beams are single lines that move: one that rises and falls, one that sweeps across the corridor, sometimes two or three in a row. They measure you, cloak or not. Cross a rising one lying flat or crouched while it is above you; crawl under a sweeping one. Catch one and the guards come to look.',
};

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Up to `count` groups in clean straight-through corridor cells (one pair of opposite openings), none in `used` or within two steps of the start, none within three cells of
 * another; their cells are reserved. The first group has `size` lines, the others one fewer (at least one); the groups alternate between the two kinds, the horizontal first.
 */
export function placeLines(cells: MazeCells, cols: number, rows: number, dist: number[][], used: Set<string>, count: number, size: 1 | 2 | 3 = 1): LineLaser[] {
  if (count <= 0) return [];
  const spots: Array<{ x: number; y: number; spanX: boolean }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (used.has(`${x},${y}`) || dist[y]![x]! < 2) continue;
      const c = cells[y]![x]!;
      const ns = c.N && c.S && !c.E && !c.W;
      const ew = c.E && c.W && !c.N && !c.S;
      if (ns || ew) spots.push({ x, y, spanX: ns });
    }
  }
  const out: LineLaser[] = [];
  for (const s of shuffle(spots)) {
    if (out.length >= count) break;
    if (out.some((o) => Math.abs(o.x - s.x) + Math.abs(o.y - s.y) < 3)) continue;
    used.add(`${s.x},${s.y}`);
    const orient: LineOrient = out.length % 2 === 0 ? 'h' : 'v';
    const n = Math.max(1, size - out.length) as 1 | 2 | 3;
    out.push({ ...s, orient, count: n, phase: Math.random(), gap: Math.random() < 0.5 ? GAP_PRONE : GAP_CROUCH });
  }
  return out;
}
