// The ceiling: on every job (difficulty.ts's `pipes`), a network of ducts and
// pipes runs across each floor PIPE_HEIGHT up, over the wall tops (the
// floors are taller for it, scene.ts's TALL_FLOOR_HEIGHT), and towers stand
// in a few dead ends to climb up to it. Up there the agent can see the whole
// floor, hang from the pipes and shimmy along them over the guards' heads,
// and drop onto one; electric pulses run the pipes to keep them from
// staying.
//
// A tower is a lattice mast stood against a side wall of a straight stretch
// of corridor, leaving the corridor walkable past it.
//
// The pipes run dead straight along a few whole rows and columns, one through
// each tower, alternating, so every row line crosses every column line and
// the network is one piece, with loops. Being straight they cross over the
// maze's walls: shortcuts the corridors don't give.
//
// Here: where the towers and pipe lines go, and the geometry the rest of the
// game asks about (which point of the network is nearest, what's joined to
// what). Type-only imports, so it's unit-tested under Node.

import type { MazeCells } from './maze';
import type { Dir } from './security';

/**
 * How high the pipes run above their floor, in metres: high enough that one
 * overhead doesn't cut across the chase camera's view of the hallway ahead
 * (it hides the floor well past the top of the screen), and the hanging
 * agent's feet are well clear of the 3 m wall tops.
 */
export const PIPE_HEIGHT = 6.4;

/**
 * A straight pipe across the floor: along x (a row, `at` its y) or along z
 * (a column, `at` its x), from cell `from` to cell `to` inclusive.
 */
export type PipeLine = { axis: 'x' | 'z'; at: number; from: number; to: number };

/** A tower: its cell (a straight stretch of corridor) and the side wall its mast stands against. */
export type Tower = { x: number; y: number; wall: Dir };

export type PipePlan = { towers: Tower[]; lines: PipeLine[] };

const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];
const EVERYWHERE = (): boolean => true;

/**
 * Up to `count` towers in free straight stretches of corridor (not in
 * `used`, at least three steps from the start, where `open` allows), spread
 * as far from each other as they'll go; a pipe line through each, rows and
 * columns taking turns. The tower cells are reserved in `used`.
 */
export function planPipes(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  used: Set<string>,
  count: number,
  open: (x: number, y: number) => boolean = EVERYWHERE
): PipePlan {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y]![x]!;
      if (used.has(`${x},${y}`) || !open(x, y) || dist[y]![x]! < 3) continue;
      if ((c.N && c.S && !c.E && !c.W) || (c.E && c.W && !c.N && !c.S)) candidates.push({ x, y });
    }
  }
  // Farthest-point spread: the first as far from the start as any, then each next as far from those as it can be,
  // preferring a row and a column no tower has yet (so each gets its own line).
  const towers: Tower[] = [];
  while (towers.length < count && candidates.length > 0) {
    let best = -1;
    let bestScore = -Infinity;
    candidates.forEach((c, i) => {
      const spread = towers.length === 0 ? dist[c.y]![c.x]! : Math.min(...towers.map((t) => Math.abs(t.x - c.x) + Math.abs(t.y - c.y)));
      const fresh = towers.some((t) => (towers.length % 2 === 0 ? t.y === c.y : t.x === c.x)) ? -100 : 0;
      if (spread + fresh > bestScore) {
        bestScore = spread + fresh;
        best = i;
      }
    });
    const c = candidates.splice(best, 1)[0]!;
    // Against one of its two side walls: the one on the outside of the building if it's on an edge.
    const cell = cells[c.y]![c.x]!;
    const sides = DIRS.filter((d) => !cell[d]);
    const edge = sides.find((d) => (d === 'N' && c.y === 0) || (d === 'S' && c.y === rows - 1) || (d === 'W' && c.x === 0) || (d === 'E' && c.x === cols - 1));
    towers.push({ x: c.x, y: c.y, wall: edge ?? sides[0]! });
    used.add(`${c.x},${c.y}`);
  }
  const lines: PipeLine[] = [];
  towers.forEach((t, i) => {
    const axis = i % 2 === 0 ? 'x' : 'z';
    const at = axis === 'x' ? t.y : t.x;
    if (!lines.some((l) => l.axis === axis && l.at === at)) lines.push({ axis, at, from: 0, to: (axis === 'x' ? cols : rows) - 1 });
  });
  return { towers, lines };
}

/**
 * Runs a pipe over each of `spots` (cells: the rooms whose consoles should be workable from a grapple line) that
 * no line passes over yet, along whichever axis has fewer lines so far. Lines run the whole floor, so each crosses
 * the other axis's and the network stays one piece. Returns the plan with the extra lines.
 */
export function reachSpots(plan: PipePlan, spots: ReadonlyArray<{ x: number; y: number }>, cols: number, rows: number): PipePlan {
  const lines = [...plan.lines];
  for (const s of spots) {
    if (lines.some((l) => (l.axis === 'x' ? l.at === s.y : l.at === s.x))) continue;
    const xs = lines.filter((l) => l.axis === 'x').length;
    const zs = lines.length - xs;
    // A row crosses the columns and a column the rows: pick the axis with fewer, unless there's nothing for it to cross.
    const axis: 'x' | 'z' = xs === 0 ? 'x' : zs === 0 ? 'z' : xs <= zs ? 'x' : 'z';
    lines.push({ axis, at: axis === 'x' ? s.y : s.x, from: 0, to: (axis === 'x' ? cols : rows) - 1 });
  }
  return { ...plan, lines };
}

/** The cells a line passes over, in order. */
export function lineCells(line: PipeLine): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = line.from; i <= line.to; i++) out.push(line.axis === 'x' ? { x: i, y: line.at } : { x: line.at, y: i });
  return out;
}

/** Where two lines cross (cell coordinates), or null for parallel lines or ones that don't reach each other. */
export function crossing(a: PipeLine, b: PipeLine): { x: number; y: number } | null {
  if (a.axis === b.axis) return null;
  const row = a.axis === 'x' ? a : b;
  const col = a.axis === 'x' ? b : a;
  if (col.at < row.from || col.at > row.to || row.at < col.from || row.at > col.to) return null;
  return { x: col.at, y: row.at };
}

/** Whether every line is joined to every other through crossings. */
export function connected(plan: PipePlan): boolean {
  if (plan.lines.length <= 1) return true;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    plan.lines.forEach((l, j) => {
      if (!seen.has(j) && crossing(plan.lines[i]!, l)) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === plan.lines.length;
}

/**
 * The nearest point on the network to (px, pz), floor-local metres: which
 * line, and how far along it (metres from its first cell's centre), and the
 * distance to it. `cell` is the cell size.
 */
export function nearestOnPipes(plan: PipePlan, px: number, pz: number, cell: number): { line: number; along: number; distance: number } | null {
  let best: { line: number; along: number; distance: number } | null = null;
  plan.lines.forEach((l, i) => {
    const start = l.from * cell;
    const end = l.to * cell;
    const across = l.at * cell;
    const u = l.axis === 'x' ? px : pz;
    const v = l.axis === 'x' ? pz : px;
    const t = Math.min(end, Math.max(start, u));
    const d = Math.hypot(u - t, v - across);
    if (!best || d < best.distance) best = { line: i, along: t - start, distance: d };
  });
  return best;
}

/**
 * Where a grapple fired from (px, pz), floor-local metres, facing (fx, fz) would take hold: the pipe within
 * `range` metres that's nearest, favouring the way the agent faces and never one behind (a line right over the
 * agent counts as ahead). The grip faces along the line, whichever way is closer to the way the agent faces.
 */
export function hookPoint(plan: PipePlan, px: number, pz: number, facing: { x: number; z: number }, cell: number, range: number): { grip: Grip; distance: number } | null {
  let best: { grip: Grip; distance: number; score: number } | null = null;
  for (const [i, l] of plan.lines.entries()) {
    const start = l.from * cell;
    const end = l.to * cell;
    const across = l.at * cell;
    const u = l.axis === 'x' ? px : pz;
    const v = l.axis === 'x' ? pz : px;
    const t = Math.min(end, Math.max(start, u));
    const d = Math.hypot(u - t, v - across);
    if (d > range) continue;
    // Which way the point lies from the agent, as (x, z).
    const dx = l.axis === 'x' ? t - u : across - v;
    const dz = l.axis === 'x' ? across - v : t - u;
    const ahead = d < 0.5 ? 1 : (dx * facing.x + dz * facing.z) / d;
    if (ahead < -0.2) continue;
    const score = d * (1.7 - ahead);
    const along = l.axis === 'x' ? facing.x : facing.z;
    if (!best || score < best.score) best = { grip: { line: i, along: t - start, dir: along >= 0 ? 1 : -1 }, distance: d, score };
  }
  return best ? { grip: best.grip, distance: best.distance } : null;
}

/** A point on line `i`, `along` metres from its first cell's centre, in floor-local metres (x, z). */
export function pointOnLine(plan: PipePlan, i: number, along: number, cell: number): { x: number; z: number } {
  const l = plan.lines[i]!;
  const u = l.from * cell + along;
  return l.axis === 'x' ? { x: u, z: l.at * cell } : { x: l.at * cell, z: u };
}

/** How long line `i` is, in metres (centre of its first cell to centre of its last). */
export function lineLength(plan: PipePlan, i: number, cell: number): number {
  const l = plan.lines[i]!;
  return (l.to - l.from) * cell;
}

/**
 * Where a hanging agent is: on line `line`, `along` metres from its first
 * cell's centre, facing `dir` along it (+1 toward its last cell).
 */
export type Grip = { line: number; along: number; dir: 1 | -1 };

/** How far past its end cells' centres a line can be hung from: short of the outer walls it runs into. */
const END_REACH = 1.3;

/** Which way a grip faces, as (x, z) in floor space. */
export function gripFacing(plan: PipePlan, grip: Grip): { x: number; z: number } {
  return plan.lines[grip.line]!.axis === 'x' ? { x: grip.dir, z: 0 } : { x: 0, z: grip.dir };
}

/** Hand over hand along the line, `dist` metres ahead (behind, negative), stopping at its ends. */
export function shimmy(plan: PipePlan, grip: Grip, dist: number, cell: number): Grip {
  const along = Math.min(lineLength(plan, grip.line, cell) + END_REACH, Math.max(-END_REACH, grip.along + dist * grip.dir));
  return { ...grip, along };
}

/**
 * At a crossing (within `near` metres of it), turning `side` (+1 right, -1
 * left, the way the agent faces) swings onto the crossing line, facing that
 * way along it. Null away from a crossing. Right of facing (x, z) is (-z, x),
 * player.ts's convention.
 */
export function turnOnto(plan: PipePlan, grip: Grip, side: 1 | -1, cell: number, near = 0.6): Grip | null {
  const here = plan.lines[grip.line]!;
  const f = gripFacing(plan, grip);
  const right = { x: -f.z * side, z: f.x * side };
  for (let i = 0; i < plan.lines.length; i++) {
    const other = plan.lines[i]!;
    const c = crossing(here, other);
    if (!c) continue;
    const at = ((here.axis === 'x' ? c.x : c.y) - here.from) * cell;
    if (Math.abs(at - grip.along) > near) continue;
    const dir = (other.axis === 'x' ? right.x : right.z) > 0 ? 1 : -1;
    return { line: i, along: ((other.axis === 'x' ? c.x : c.y) - other.from) * cell, dir };
  }
  return null;
}

/** Grabbing the pipe over tower `tower`: whichever line through it, and way along it, is nearest where the agent faces ((x, z)). */
export function gripAtTower(plan: PipePlan, tower: number, facing: { x: number; z: number }, cell: number): Grip | null {
  const t = plan.towers[tower]!;
  let best: Grip | null = null;
  let bestDot = -Infinity;
  plan.lines.forEach((l, i) => {
    if (!(l.axis === 'x' ? l.at === t.y && t.x >= l.from && t.x <= l.to : l.at === t.x && t.y >= l.from && t.y <= l.to)) return;
    for (const dir of [1, -1] as const) {
      const d = l.axis === 'x' ? facing.x * dir : facing.z * dir;
      if (d > bestDot) {
        bestDot = d;
        best = { line: i, along: ((l.axis === 'x' ? t.x : t.y) - l.from) * cell, dir };
      }
    }
  });
  return best;
}

/** The tower under a grip (its index), if the grip is within `near` metres of one's cell centre; -1 if none. */
export function towerUnder(plan: PipePlan, grip: Grip, cell: number, near = 0.6): number {
  const p = pointOnLine(plan, grip.line, grip.along, cell);
  return plan.towers.findIndex((t) => Math.hypot(t.x * cell - p.x, t.y * cell - p.z) <= near);
}

/**
 * Where a pulse is along its line `t` seconds in: from `from` to `to`
 * (metres along it) and back, over and over, at `speed` m/s, starting
 * `phase` metres into the round trip. `dir` is which way it's heading.
 */
export function pulseAlong(from: number, to: number, speed: number, phase: number, t: number): { along: number; dir: 1 | -1 } {
  const span = to - from;
  const u = (((phase + t * speed) % (2 * span)) + 2 * span) % (2 * span);
  return u < span ? { along: from + u, dir: 1 } : { along: to - (u - span), dir: -1 };
}
