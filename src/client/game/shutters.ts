// Timed shutters: a roller shutter across a straight corridor, opened for a
// moment by hacking a panel on the wall, then coming down again. The panel
// sits one cell back from it, so the cell beyond is one full dash away
// (game.ts's dash, player.ts's dashTo): walk from the panel and it's half
// down by the time you get there, too low to get under; dash, and the dash's
// slide carries you under it. A second panel, on the far side, opens it from
// there.
//
// Here: where they go, and the timeline once one's unlocked. Type-only
// imports, so it's unit-tested under Node.

import type { MazeCells } from './maze';
import type { Dir } from './security';

/** A shutter: across the passage from cell (x, y) through `dir`; its panels, the near one (`panels[0]`, one cell back) and the far one. */
export type ShutterPlan = {
  x: number;
  y: number;
  dir: Dir;
  panels: [{ x: number; y: number; wall: Dir }, { x: number; y: number; wall: Dir }];
};

/** How long hacking a panel takes: a moment, not a terminal's full hack. */
export const SHUTTER_HACK_S = 1.2;
/** Once unlocked: rising, then held open, then coming down (seconds). */
export const SHUTTER_RISE_S = 0.3;
export const SHUTTER_HOLD_S = 0.4;
export const SHUTTER_CLOSE_S = 1.5;
/** How far down it can be (0 open, 1 shut) and still let someone under: upright, or sliding. */
export const SHUTTER_UPRIGHT_GAP = 0.4;
export const SHUTTER_LOW_GAP = 0.85;

const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const SIDES: Record<'x' | 'z', [Dir, Dir]> = { x: ['S', 'N'], z: ['E', 'W'] };

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Up to `count` shutters, each on a passage between two cells of a straight
 * run of three (the panel's cell, then the two either side of the shutter),
 * all straight-through corridor cells, none in `used` or within three steps
 * of the start, the shutter facing away from it (its near side the one closer
 * to the start). Their cells are reserved.
 */
export function placeShutters(cells: MazeCells, cols: number, rows: number, dist: number[][], used: Set<string>, count: number): ShutterPlan[] {
  const straight = (x: number, y: number, axis: 'x' | 'z'): boolean => {
    const c = cells[y]?.[x];
    if (!c) return false;
    return axis === 'x' ? c.E && c.W && !c.N && !c.S : c.N && c.S && !c.E && !c.W;
  };
  const found: ShutterPlan[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      for (const dir of ['E', 'S', 'W', 'N'] as Dir[]) {
        const [dx, dy] = DELTA[dir];
        const axis = dx !== 0 ? 'x' : 'z';
        const run = [
          { x: x - dx, y: y - dy }, // the panel's
          { x, y }, // this side of the shutter
          { x: x + dx, y: y + dy }, // beyond it
        ];
        if (!run.every((c) => straight(c.x, c.y, axis) && !used.has(`${c.x},${c.y}`))) continue;
        if (dist[run[0]!.y]![run[0]!.x]! < 3) continue;
        // Facing away from the start: walking in from the start, you come to the panel first.
        if (!(dist[run[0]!.y]![run[0]!.x]! < dist[y]![x]! && dist[y]![x]! < dist[run[2]!.y]![run[2]!.x]!)) continue;
        const [wall] = SIDES[axis];
        found.push({ x, y, dir, panels: [{ ...run[0]!, wall }, { ...run[2]!, wall }] });
      }
    }
  }
  const out: ShutterPlan[] = [];
  for (const s of shuffle(found)) {
    if (out.length >= count) break;
    const [dx, dy] = DELTA[s.dir];
    const cellsOf = [`${s.x - dx},${s.y - dy}`, `${s.x},${s.y}`, `${s.x + dx},${s.y + dy}`];
    if (cellsOf.some((k) => used.has(k))) continue;
    for (const k of cellsOf) used.add(k);
    out.push(s);
  }
  return out;
}

/** How far down it is (0 open, 1 shut), `t` seconds after it was unlocked (null: never, or long since: shut). */
export function shutterClosure(t: number | null): number {
  if (t === null || t < 0) return 1;
  if (t < SHUTTER_RISE_S) return 1 - t / SHUTTER_RISE_S;
  const down = t - SHUTTER_RISE_S - SHUTTER_HOLD_S;
  if (down <= 0) return 0;
  return Math.min(1, down / SHUTTER_CLOSE_S);
}

/** How long, from unlocking, until it's shut again. */
export const SHUTTER_OPEN_S = SHUTTER_RISE_S + SHUTTER_HOLD_S + SHUTTER_CLOSE_S;

/** Whether a shutter `closure` of the way down stops someone, upright or `low` (sliding). */
export function shutterBlocks(closure: number, low: boolean): boolean {
  return closure > (low ? SHUTTER_LOW_GAP : SHUTTER_UPRIGHT_GAP);
}
