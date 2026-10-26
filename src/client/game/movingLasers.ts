// Moving lasers, for later jobs: they make you duck and take cover rather
// than just wait for a gap.
//
// A sweeper spins in the middle of a junction, a single beam at chest height
// going round and round: sneak and you're under it; walk through upright and
// it catches you unless you time it. A slider is a laser curtain, full
// height, running up and down a straight stretch of corridor: nothing ducks
// it, so you step into a side passage (there's always one along its run)
// and let it go by. A fast one outruns a walk: follow one in and it catches
// you coming back, unless you duck aside and then dash (game.ts) for the end. Either way a cloak slips through, as it does the fixed
// beams (lasers.ts); being caught costs suspicion and brings guards to look.
//
// Here: where they go, where they are at a given moment, and whether they
// have the player. Type-only imports, so it's unit-tested under Node.

import type { MazeCells } from './maze';

/** A sweeper's beam: this far out from its post either way, this high. */
export const SWEEP_REACH = 1.8;
export const SWEEP_HEIGHT = 1.35;
/** Radians per second a sweeper turns. */
export const SWEEP_SPEED = 1.6;
/** Metres per second a slider runs, and a fast one: quicker than the agent walks (7), slower than a dash (11). */
export const SLIDE_SPEED = 1.3;
export const FAST_SLIDE_SPEED = 8;
/** How far short of its end cells' far edges a slider turns back. */
const SLIDE_END_GAP = 0.45;

/** A sweeper in junction cell (x, y); `phase` its angle at time 0, `dir` which way it turns. */
export type Sweeper = { x: number; y: number; phase: number; dir: 1 | -1 };

/**
 * A slider: running along `axis` ('x', a row: `at` is its y; 'z', a column:
 * `at` is its x) between cells `from` and `to` inclusive, the curtain
 * spanning the corridor across it. `phase` is how far into its round trip
 * it is at time 0 (0–1); `speed`, metres per second.
 */
export type Slider = { axis: 'x' | 'z'; at: number; from: number; to: number; phase: number; speed: number };

function openings(c: { N: boolean; S: boolean; E: boolean; W: boolean }): number {
  return (c.N ? 1 : 0) + (c.S ? 1 : 0) + (c.E ? 1 : 0) + (c.W ? 1 : 0);
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Up to `count` sweepers, in junctions (three or four ways out) at least three steps from the start, not in `used`; their cells are reserved. */
export function placeSweepers(cells: MazeCells, cols: number, rows: number, dist: number[][], used: Set<string>, count: number): Sweeper[] {
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (used.has(`${x},${y}`) || dist[y]![x]! < 3 || openings(cells[y]![x]!) < 3) continue;
      spots.push({ x, y });
    }
  }
  const out: Sweeper[] = [];
  for (const s of shuffle(spots)) {
    if (out.length >= count) break;
    // Not right next to another: two in a row would be one long wait.
    if (out.some((o) => Math.abs(o.x - s.x) + Math.abs(o.y - s.y) < 3)) continue;
    used.add(`${s.x},${s.y}`);
    out.push({ ...s, phase: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1 });
  }
  return out;
}

/**
 * Up to `count` sliders, each on a straight stretch of `length` cells (or
 * one shorter, if none that long will do) with a way out to the side
 * somewhere along it, none of its cells in `used` or within two steps of the
 * start; their cells are reserved. The first `fast` of them run fast.
 */
export function placeSliders(cells: MazeCells, cols: number, rows: number, dist: number[][], used: Set<string>, count: number, length = 4, fast = 0): Slider[] {
  const out: Slider[] = [];
  for (const len of [length, length - 1]) {
    const runs: Slider[] = [];
    for (const axis of ['x', 'z'] as const) {
      const lines = axis === 'x' ? rows : cols;
      const span = axis === 'x' ? cols : rows;
      for (let at = 0; at < lines; at++) {
        for (let from = 0; from + len <= span; from++) {
          const run = Array.from({ length: len }, (_, i) => (axis === 'x' ? { x: from + i, y: at } : { x: at, y: from + i }));
          const ok = run.every((c, i) => {
            const cell = cells[c.y]![c.x]!;
            if (used.has(`${c.x},${c.y}`) || dist[c.y]![c.x]! < 2) return false;
            // Joined to the next cell along.
            return i === len - 1 || (axis === 'x' ? cell.E : cell.S);
          });
          const aside = run.some((c) => {
            const cell = cells[c.y]![c.x]!;
            return axis === 'x' ? cell.N || cell.S : cell.E || cell.W;
          });
          if (ok && aside) runs.push({ axis, at, from, to: from + len - 1, phase: 0, speed: SLIDE_SPEED });
        }
      }
    }
    for (const r of shuffle(runs)) {
      if (out.length >= count) break;
      const cellsOf = Array.from({ length: r.to - r.from + 1 }, (_, i) => (r.axis === 'x' ? `${r.from + i},${r.at}` : `${r.at},${r.from + i}`));
      if (cellsOf.some((k) => used.has(k))) continue;
      for (const k of cellsOf) used.add(k);
      out.push({ ...r, phase: Math.random(), speed: out.length < fast ? FAST_SLIDE_SPEED : SLIDE_SPEED });
    }
    if (out.length >= count) break;
  }
  return out;
}

/** How far a slider travels one way (metres), with cells `cell` apart. */
function slideSpan(s: Slider, cell: number): number {
  return (s.to - s.from + 1) * cell - 2 * SLIDE_END_GAP;
}

/** A sweeper's beam angle at `t` seconds (radians, from +x toward +z). */
export function sweepAngle(s: Sweeper, t: number): number {
  return s.phase + s.dir * SWEEP_SPEED * t;
}

/** Where a slider's curtain is at `t` seconds: its floor-local coordinate along its axis. */
export function slidePosition(s: Slider, t: number, cell: number): number {
  const span = slideSpan(s, cell);
  const u = (((s.phase * 2 * span + t * s.speed) % (2 * span)) + 2 * span) % (2 * span);
  const start = s.from * cell - cell / 2 + SLIDE_END_GAP;
  return start + (u < span ? u : 2 * span - u);
}

/** Whether a sweeper's beam at `t` seconds crosses someone of radius `r` standing at floor-local (px, pz). */
export function sweeperHits(s: Sweeper, t: number, px: number, pz: number, cell: number, r: number): boolean {
  const dx = px - s.x * cell;
  const dz = pz - s.y * cell;
  if (Math.hypot(dx, dz) > SWEEP_REACH + r) return false;
  const a = sweepAngle(s, t);
  // Distance from the beam's line (through the post, both ways).
  return Math.abs(dx * Math.sin(a) - dz * Math.cos(a)) < r;
}

/** Whether a slider's curtain at `t` seconds crosses someone of radius `r` at floor-local (px, pz). */
export function sliderHits(s: Slider, t: number, px: number, pz: number, cell: number, r: number): boolean {
  const along = s.axis === 'x' ? px : pz;
  const across = s.axis === 'x' ? pz : px;
  if (Math.abs(across - s.at * cell) > cell / 2) return false;
  return Math.abs(along - slidePosition(s, t, cell)) < r;
}
