// Sliding shelving (the Records Annex): a bank of shelves on a track that the agent, and only the agent, can slide one cell across its length, into the aisle beside it: to close a lane against a
// patrol, or to open one. This file is the pure part: where the bank is partway along its slide, what the guards' map says once it has moved, and whether anything stands in the way. game.ts
// holds the banks (their model, their collision box, their wheel to work) and plays it.

import type { MazeCells } from './maze';

export type Cell = { x: number; y: number };
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Seconds a bank takes to slide its cell. */
export const SLIDE_S = 1.6;

/** A smooth 0 to 1 as the slide goes from 0 to 1. */
export const slideEase = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** `box` moved `t` of the way through a slide of (dx, dy) cells of `cell` metres. */
export function shiftedBox(box: Box, dx: number, dy: number, t: number, cell = 4): Box {
  const sx = dx * cell * t;
  const sz = dy * cell * t;
  return { minX: box.minX + sx, maxX: box.maxX + sx, minZ: box.minZ + sz, maxZ: box.maxZ + sz };
}

/** Whether a point (an agent, a guard) is within `margin` metres of the box. */
export const nearBox = (b: Box, x: number, z: number, margin: number): boolean => x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin;

const SIDES = [
  { side: 'N', dx: 0, dy: -1, opposite: 'S' },
  { side: 'S', dx: 0, dy: 1, opposite: 'N' },
  { side: 'E', dx: 1, dy: 0, opposite: 'W' },
  { side: 'W', dx: -1, dy: 0, opposite: 'E' },
] as const;

/** The guards' map with `cells` shut: no way into them from any side (a bank stands there). */
export function closeCells(nav: MazeCells, cells: readonly Cell[]): void {
  for (const c of cells) {
    const cell = nav[c.y]?.[c.x];
    if (!cell) continue;
    for (const s of SIDES) {
      cell[s.side] = false;
      const next = nav[c.y + s.dy]?.[c.x + s.dx];
      if (next) next[s.opposite] = false;
    }
  }
}

/**
 * The guards' map with `cells` open again (a bank has left them): each opens onto every neighbour that is a space's cell and is not blocked (`blocked` says what is still shut, the cells of the
 * banks and furniture). The same rule the plan's map is drawn by: two cells that are both in a space are joined.
 */
export function openCells(nav: MazeCells, cells: readonly Cell[], inSpace: (x: number, y: number) => boolean, blocked: (x: number, y: number) => boolean): void {
  for (const c of cells) {
    const cell = nav[c.y]?.[c.x];
    if (!cell || !inSpace(c.x, c.y) || blocked(c.x, c.y)) continue;
    for (const s of SIDES) {
      const nx = c.x + s.dx;
      const ny = c.y + s.dy;
      const next = nav[ny]?.[nx];
      if (!next || !inSpace(nx, ny) || blocked(nx, ny)) continue;
      cell[s.side] = true;
      next[s.opposite] = true;
    }
  }
}
