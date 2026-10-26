// Walking round things. Enemies route along the maze's cells (the nav grid knows the walls and the locked doors, but not what is standing in a cell: a pair of crates, a desk,
// a locker), so left alone they walk straight through the furniture. This is the steering that keeps a body out of the boxes: a step that would end inside one is turned a
// little to the side that is free, and a route point that lies inside one is moved out to the nearest free spot beside it. Pure, so it is unit-tested under Node.

export type Obstacle = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Whether a body of radius `r` at (x, z) overlaps the box. */
export function hitsBox(x: number, z: number, r: number, b: Obstacle): boolean {
  return x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ;
}

export function blockedAt(x: number, z: number, r: number, boxes: ReadonlyArray<Obstacle>): boolean {
  for (const b of boxes) if (hitsBox(x, z, r, b)) return true;
  return false;
}

const TURNS = [0.45, 0.9, 1.35, 1.57, 1.8, 2.3];
/** Held up this long with every way blocked, a body just goes on straight (it can't be left standing for ever against a box it can't get round). */
const STUCK_S = 1.2;

/** The steering state of one walker: which way it went round the last thing, and how long it has been held up. */
export class Avoider {
  private side: 1 | -1 = 1;
  private stuck = 0;

  /**
   * Where a body of radius `r` at (x, z), told to go `len` metres towards (tx, tz), ends up: there if clear, else turned aside. Already overlapping something (it was put there, or
   * a door shut on it) it just goes straight, so it can always leave.
   */
  step(x: number, z: number, tx: number, tz: number, len: number, r: number, boxes: ReadonlyArray<Obstacle>, dt: number): { x: number; z: number } {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || len <= 0) return { x, z };
    const step = Math.min(len, d);
    const base = Math.atan2(dx, dz);
    const at = (a: number): { x: number; z: number } => ({ x: x + Math.sin(a) * step, z: z + Math.cos(a) * step });
    const straight = at(base);
    if (blockedAt(x, z, r, boxes) || !blockedAt(straight.x, straight.z, r, boxes)) {
      this.stuck = 0;
      return straight;
    }
    // Stays on the side it went round last time through every turn before it tries the other, so it doesn't dither in front of a box.
    const sides: Array<1 | -1> = [this.side, this.side === 1 ? -1 : 1];
    for (const s of sides) {
      for (const turn of TURNS) {
        const c = at(base + s * turn);
        if (!blockedAt(c.x, c.z, r, boxes)) {
          this.side = s;
          this.stuck = 0;
          return c;
        }
      }
    }
    this.stuck += dt;
    return this.stuck > STUCK_S ? straight : { x, z };
  }
}

/**
 * The route point (x, z) if a body of radius `r` can stand there, else the nearest spot beside whatever it is inside (the pair of crates in the middle of a cell: a spot at
 * the side of them), the nearest to `near` of equally close ones.
 */
export function clearSpot(x: number, z: number, r: number, boxes: ReadonlyArray<Obstacle>, near: { x: number; z: number }): { x: number; z: number } {
  if (!blockedAt(x, z, r, boxes)) return { x, z };
  let best: { x: number; z: number; d: number } | null = null;
  for (let reach = 0.1; reach <= 2.4 && !best; reach += 0.1) {
    for (const [ox, oz] of [
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach],
    ] as const) {
      const cx = x + ox;
      const cz = z + oz;
      if (blockedAt(cx, cz, r, boxes)) continue;
      const d = Math.hypot(near.x - cx, near.z - cz);
      if (!best || d < best.d) best = { x: cx, z: cz, d };
    }
  }
  return best ? { x: best.x, z: best.z } : { x, z };
}
