// Laser gates: beams across a corridor that a cloak does nothing about. The fixed grids (lasers.ts) shut a corridor and only camo gets you through; a
// gate is the other kind, beaten on your feet: duck under a high beam (crouch), crawl beneath a low one (flat on the floor), or wait for a pulsing
// curtain to blink off and step through the gap. Camo, being invisible to enemies, means nothing to a beam that simply measures you. Catching one costs
// suspicion and brings guards to look, as a moving laser does (game.ts's tripLaser).
// Here: where gates go, what a posture clears, when a pulse is on, and whether one has the player. Pure (type-only imports), so it's unit-tested under Node.

import type { MazeCells } from './maze';

export type GateKind = 'duck' | 'crawl' | 'pulse';

/** A gate in the straight corridor cell (x, y). `spanX`: its beams run along x, so the corridor runs north-south (lasers.ts's convention). `phase`: 0-1, where a pulse is in its cycle at time 0. */
export type Gate = { x: number; y: number; spanX: boolean; kind: GateKind; phase: number };

export type Posture = 'stand' | 'crouch' | 'prone';

/** Metres off the floor of each beam, bottom to top. A duck gate's lowest is above a crouched head and below a standing one; a crawl gate's is above a flat body. */
export const GATE_BEAMS: Record<GateKind, readonly number[]> = {
  duck: [1.4, 1.7],
  crawl: [0.55, 0.9, 1.25, 1.6],
  pulse: [0.3, 0.75, 1.2, 1.65],
};

/** How high the agent is in each posture (posture.ts's stand, crouch, flat). */
export const POSTURE_HEIGHT: Record<Posture, number> = { stand: 1.85, crouch: 1.25, prone: 0.45 };

/** A pulsing gate: on this long, then off this long, and a flicker for the last of the off before it comes back. */
export const PULSE_ON_S = 1.4;
export const PULSE_OFF_S = 1.9;
export const PULSE_WARN_S = 0.45;
export const PULSE_PERIOD_S = PULSE_ON_S + PULSE_OFF_S;

/** How far either side of its plane a beam catches someone, besides their own radius. */
const GATE_THICKNESS = 0.12;

/** Where a pulse is at `t` seconds: whether it burns, and whether it is about to. */
export function pulseState(phase: number, t: number): { on: boolean; warn: boolean } {
  const u = (((phase * PULSE_PERIOD_S + t) % PULSE_PERIOD_S) + PULSE_PERIOD_S) % PULSE_PERIOD_S;
  if (u < PULSE_ON_S) return { on: true, warn: false };
  return { on: false, warn: u > PULSE_PERIOD_S - PULSE_WARN_S };
}

/** Whether a gate of `kind` stops someone in `posture` at `t` seconds (before where they stand is considered). */
export function gateBlocks(kind: GateKind, phase: number, t: number, posture: Posture): boolean {
  const lowest = GATE_BEAMS[kind][0]!;
  if (kind === 'pulse') return pulseState(phase, t).on;
  return POSTURE_HEIGHT[posture] > lowest;
}

/** Whether a gate catches someone of radius `r` standing at floor-local (px, pz) in `posture` at `t` seconds. `cell`: the cell size. */
export function gateHits(g: Gate, t: number, px: number, pz: number, cell: number, r: number, posture: Posture): boolean {
  // Along the way through the gate: z when the beams run along x.
  const along = g.spanX ? pz - g.y * cell : px - g.x * cell;
  const across = g.spanX ? px - g.x * cell : pz - g.y * cell;
  if (Math.abs(across) > cell / 2) return false;
  if (Math.abs(along) > r + GATE_THICKNESS) return false;
  return gateBlocks(g.kind, g.phase, t, posture);
}

/** The first line of the hint said the first time you come near each kind. */
export const GATE_HINT: Record<GateKind, string> = {
  duck: 'LASER BEAMS HIGH ACROSS THE CORRIDOR · CAMO WON’T HELP · CROUCH UNDER THEM',
  crawl: 'A LOW BEAM · CAMO WON’T HELP · GET FLAT ON THE FLOOR AND CRAWL UNDER IT',
  pulse: 'A PULSING CURTAIN · CAMO WON’T HELP · STEP THROUGH WHILE IT’S OFF, AFTER THE FLICKER STOPS',
};

/** What the briefing says about gates in the letter. */
export const GATE_NOTE = {
  title: 'Laser gates',
  text: 'Some beams here ignore your cloak: they measure you, not what the cameras see. A high beam: crouch and walk under it. A low one: get flat on the floor and crawl beneath. A pulsing curtain: wait for it to blink off and cross in the gap. Catch one and the guards come to look.',
};

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Up to `count` gates in clean straight-through corridor cells (one pair of opposite openings, so the beams' direction is never in doubt), none in `used`
 * or within two steps of the start, and none within three cells of another; their cells are reserved. `kinds` is what they may be, dealt out in turn from
 * a shuffle so a job with several has a mix.
 */
export function placeGates(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  used: Set<string>,
  count: number,
  kinds: readonly GateKind[] = ['duck', 'crawl', 'pulse']
): Gate[] {
  if (count <= 0 || kinds.length === 0) return [];
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
  const order = shuffle([...kinds]);
  const out: Gate[] = [];
  for (const s of shuffle(spots)) {
    if (out.length >= count) break;
    if (out.some((o) => Math.abs(o.x - s.x) + Math.abs(o.y - s.y) < 3)) continue;
    used.add(`${s.x},${s.y}`);
    out.push({ ...s, kind: order[out.length % order.length]!, phase: Math.random() });
  }
  return out;
}
