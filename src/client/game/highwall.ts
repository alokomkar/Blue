// A tall wall, and hanging from it. Where an ordinary maze wall is 3 m and a dash up it ends lying flat along the top (wallclimb.ts), a TALL wall is twice that, with a shelf along its
// face at the height of an ordinary wall's top. The same wall run catches the shelf's edge with both hands, and the agent hangs there, feet on the wall, out over the floor: shimmying
// hand over hand, hopping along it quicker (and noisier), dropping straight down, or leaping backwards off it, onto a guard below if there is one. Pure geometry and timing,
// so it is unit-tested under Node; game.ts and player.ts play it, with the Universal Animation Library's sideways wall climb, jump and ledge pull-up (CC0, public/models/anims/ual_climb.glb, ual_jump.glb, retimed to the lengths below by player.ts).

import type { WallContact } from './wallclimb';

/** A tall wall's height, and how far its shelf stands proud of the face. */
export const TALL_WALL_H = 6;
export const LEDGE_OUT = 0.16;
/** The shelf's top: the height of an ordinary wall's top (WALL_H 3 m, plus its 0.07 cap), where the hands go. */
export const LEDGE_Y = 3.07;

/** A run of tall wall along one axis, its segments joined: the shelf goes the whole way. */
/** `top` and `toLevel` on a tower's climb wall: the shelf above the first is a ledge on that storey (hands `top` m up), not a second shelf of the wall. */
export type Run = { run: 'x' | 'z'; centre: number; lo: number; hi: number; thick: number; top?: number; toLevel?: number; single?: boolean };
type HighBox = { minX: number; maxX: number; minZ: number; maxZ: number; high?: boolean; top?: number; toLevel?: number; single?: boolean };

/** The tall walls among `boxes`, those that touch end to end made one. */
export function highRuns(boxes: readonly HighBox[]): Run[] {
  const runs: Run[] = [];
  for (const b of boxes) {
    if (!b.high) continue;
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const next: Run = alongX
      ? { run: 'x', centre: (b.minZ + b.maxZ) / 2, lo: b.minX, hi: b.maxX, thick: b.maxZ - b.minZ, ...(b.top !== undefined ? { top: b.top, toLevel: b.toLevel! } : {}), ...(b.single ? { single: true } : {}) }
      : { run: 'z', centre: (b.minX + b.maxX) / 2, lo: b.minZ, hi: b.maxZ, thick: b.maxX - b.minX, ...(b.top !== undefined ? { top: b.top, toLevel: b.toLevel! } : {}), ...(b.single ? { single: true } : {}) };
    const join = runs.find((r) => r.run === next.run && Math.abs(r.centre - next.centre) < 0.05 && next.lo <= r.hi + 0.05 && next.hi >= r.lo - 0.05);
    if (join) {
      join.lo = Math.min(join.lo, next.lo);
      join.hi = Math.max(join.hi, next.hi);
    } else runs.push(next);
  }
  return runs;
}

/** The run a contact (wallContact's, with the box it met flagged high) belongs to. */
export function runOf(runs: readonly Run[], c: WallContact): Run | null {
  if (!c.high) return null;
  return runs.find((r) => r.run === c.run && Math.abs(r.centre - c.centre) < 0.05 && c.lo >= r.lo - 0.05 && c.hi <= r.hi + 0.05) ?? null;
}

/** The second shelf, at the top of a tall wall: a second level to hang from, three metres above the first. There is nothing to mount: the wall's top is not climbed onto. */
export const LEDGE2_Y = TALL_WALL_H + 0.07;
/**
 * Over the top. From the top shelf, forward once more pulls the agent up onto the wall's top (the library's ledge pull-up, stretched to 1.17 s: crouched on the cap), where forward goes on over and back
 * comes down the side it came up. Going over: a turn on the spot (the far face is behind them now), then the same pull-up played backwards, down into a hang from the far side's top shelf.
 */
export const MOUNT_S = 1.1;
export const DISMOUNT_S = 1.1;
export const MOUNT_CLIP_S = 1.17;
export const OVER_TURN_S = 0.55;
/** How far out from the wall's face the hanging body is (the shelf's hold): game.ts's holdOnShelf. */
export const HANG_OUT = 0.55;

const smooth = (lo: number, hi: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

/** How far out from the face the root is `k` (0 hanging, 1 crouched on the top) of the way up: still while the body rises, then in over the cap to the wall's centre line. */
export function mountOut(k: number, thick: number): number {
  return HANG_OUT - (HANG_OUT + thick / 2) * smooth(0.45, 1, k);
}

/** How much of the way the hands still hold the edge at `k` of the pull-up (1 holding, 0 let go). */
export function mountGrip(k: number): number {
  return 1 - smooth(0.45, 0.8, k);
}

/** The hands' height for a level (1 or 2). */
export const ledgeY = (level: 1 | 2): number => (level === 1 ? LEDGE_Y : LEDGE2_Y);
/** Forward alone on the lower shelf: the wall run again, up to the second; back alone on the second: let go and drop to the first. One press does it (this long, to tell it from the start of a hop, which is forward with a side); a key still held from the climb before must be let go of first. */
export const LEVEL_HOLD_S = 0.06;
/** The run up to the second shelf takes this long (the wall run's pop stretched to fit three metres), and the drop back to the first. */
export const RISE_S = 0.525; // (twice the speed of the first version's 1.05 s)
export const LOWER_S = 0.55;
/** How long the hang eases into the run up from the pose it was in. */
export const RISE_BLEND_S = 0.12;

/** The run-up a dash needs to go up a tall wall: further than an ordinary wall's (wallclimb.ts's MIN_RUN_UP), for the longer leap. */
export const HIGH_RUN_UP = 2.4;

/** How far from a run's ends the hands keep: the whole body hangs there. */
export const END_MARGIN = 0.7;

export function clampAlong(r: Run, along: number): number {
  return Math.min(r.hi - END_MARGIN, Math.max(r.lo + END_MARGIN, along));
}

/** Where the hands go: on the shelf's top edge at `along`, on the side the face looks to (`nx`, `nz`). */
export function handsPoint(r: Run, nx: number, nz: number, along: number): { x: number; z: number } {
  const off = r.thick / 2 + LEDGE_OUT - 0.04;
  return r.run === 'x' ? { x: along, z: r.centre + nz * off } : { x: r.centre + nx * off, z: along };
}

/** The point on the floor straight out from the wall (`out` metres from its face) at `along`. */
export function floorPoint(r: Run, nx: number, nz: number, along: number, out: number): { x: number; z: number } {
  const off = r.thick / 2 + out;
  return r.run === 'x' ? { x: along, z: r.centre + nz * off } : { x: r.centre + nx * off, z: along };
}

// ---- timing: the length each hang clip is played at (player.ts stretches the library's sideways climb, fall and jump to these) ----

/** A shimmy cycle covers 0.55 m in 1.17 s; the hang moves at this speed, hand over hand, the clip played to match. */
export const SHIMMY_CLIP_M = 0.55;
export const SHIMMY_CLIP_S = 1.17;
export const SHIMMY_SPEED = 0.6;
/** A hop sideways: two and a half metres in under a second, the clip played a good deal quicker, with the pose eased in and out of the hang at either end; held, the hops run on one into the next. */
export const HOP_M = 2.5;
export const HOP_S = 0.95;
/** How long the hop eases from the hanging pose at its start and back into it at its end, seconds. */
export const HOP_BLEND_S = 0.14;
export const HOP_CLIP_S = { left: 1.5, right: 1.67 } as const;
/** Straight down: the clip's length. */
export const DROP_S = 0.9;
/** Leaping backwards: how far out it carries from the face, and the clip's length played this long. */
export const JUMP_OUT = 2.1;
export const JUMP_S = 1.1;
export const JUMP_CLIP_S = 1.27;
/** A guard this close (across the floor, from the hands) can be dropped on, or leapt on. */
export const DROP_REACH = 1.9;
export const JUMP_REACH = 3.0;
/** A hop is heard by the guards this many cells away; a shimmy by none. */
export const HOP_HEARD_CELLS = 2;

/** Which way along the run (+1 or -1) the agent's left lies, facing the wall at `facing` (0 = +z, as everywhere). */
export function leftAlong(r: Run, facing: number): 1 | -1 {
  // The agent's right is (-cos, sin) of its facing: left is the opposite.
  const right = r.run === 'x' ? -Math.cos(facing) : Math.sin(facing);
  return right >= 0 ? -1 : 1;
}

/** Where a hop of `dir` (+1 along the run, -1 back) from `along` lands: a full hop, shortened to the run's end, or null when there is less than a handspan left. */
export function hopTarget(r: Run, along: number, dir: 1 | -1): number | null {
  const to = clampAlong(r, along + dir * HOP_M);
  return Math.abs(to - along) < 0.4 ? null : to;
}

// ---- round a corner, and across a gap ----

/** Where the agent hangs: a run, the face's outward normal (toward the agent), and the point along the run. */
export type Hang = { run: Run; nx: number; nz: number; along: number };

/**
 * The way on round a corner. Hanging on face (`nx`, `nz`) of run `r` and shimmying toward its end in `dir` (+1 toward `hi`, -1 toward `lo`): if a wall meets that end at a right angle,
 * the hang goes on along it. Where that wall reaches out on the agent's own side it is an inner corner: the face just ahead is the next wall's, turning the other way. Where it reaches
 * out only on the far side it is an outer corner: the hang wraps round the end of this wall onto the next one's face. `dir` is the way along the new run the agent goes on in (`along`
 * is where on it they start, kept a body's width from its end); null where no wall meets this one.
 */
export function cornerAt(runs: readonly Run[], r: Run, nx: number, nz: number, dir: 1 | -1): (Hang & { dir: 1 | -1; convex: boolean }) | null {
  const end = dir > 0 ? r.hi : r.lo;
  const s = r.run === 'x' ? Math.sign(nz) : Math.sign(nx);
  if (s === 0) return null;
  for (const q of runs) {
    if (q.run === r.run) continue;
    // q stands at r's end: its centre line is half its thickness in from the end (the walls' ends overlap in the corner), and it reaches r's centre line.
    if (Math.abs(q.centre - (end - (dir * q.thick) / 2)) > 0.2) continue;
    if (q.lo > r.centre + 0.2 || q.hi < r.centre - 0.2) continue;
    const reachPos = q.hi - (r.centre + r.thick / 2);
    const reachNeg = r.centre - r.thick / 2 - q.lo;
    const mine = s > 0 ? reachPos : reachNeg;
    const other = s > 0 ? reachNeg : reachPos;
    if (mine > 0.5) {
      const p = r.centre + s * (r.thick / 2 + END_MARGIN);
      return { run: q, nx: r.run === 'x' ? -dir : 0, nz: r.run === 'x' ? 0 : -dir, along: clampAlong(q, p), dir: s as 1 | -1, convex: false };
    }
    if (other > 0.5) {
      const p = r.centre + s * (r.thick / 2);
      return { run: q, nx: r.run === 'x' ? dir : 0, nz: r.run === 'x' ? 0 : dir, along: clampAlong(q, p), dir: -s as 1 | -1, convex: true };
    }
  }
  return null;
}

/** How far the jump across reaches to another tall wall's shelf, and the least that is a gap worth crossing. */
export const CROSS_REACH = 4.25;
export const CROSS_MIN = 1.2;

/**
 * The tall wall to jump to from hanging at (`x`, `z`) on `from` (any other run): the nearest face that looks toward the agent, within CROSS_REACH of their hands, with the point on
 * it straight across (clamped to the wall). Null if there is none.
 */
export function crossTarget(runs: readonly Run[], from: Run, x: number, z: number): Hang | null {
  let best: { hang: Hang; d: number } | null = null;
  for (const q of runs) {
    if (q === from) continue;
    const across = q.run === 'x' ? z : x;
    const alongPlayer = q.run === 'x' ? x : z;
    for (const sigma of [1, -1] as const) {
      // The face on this side, and only if the agent is on that side of the wall.
      if (sigma * (across - q.centre) <= q.thick / 2) continue;
      const nx = q.run === 'x' ? 0 : sigma;
      const nz = q.run === 'x' ? sigma : 0;
      const along = clampAlong(q, alongPlayer);
      const h = handsPoint(q, nx, nz, along);
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < CROSS_MIN || d > CROSS_REACH) continue;
      // Nothing tall in the way: the line goes over no wall (a wall between is six metres high, a good deal above the shelf).
      if (runs.some((o) => o !== q && segmentHitsRun(o, x, z, h.x, h.z))) continue;
      if (!best || d < best.d) best = { hang: { run: q, nx, nz, along }, d };
    }
  }
  return best?.hang ?? null;
}

/** Whether the segment (x1, z1)-(x2, z2) passes through run `r`'s wall (a thin rectangle). */
export function segmentHitsRun(r: Run, x1: number, z1: number, x2: number, z2: number): boolean {
  const half = r.thick / 2;
  const minX = r.run === 'x' ? r.lo : r.centre - half;
  const maxX = r.run === 'x' ? r.hi : r.centre + half;
  const minZ = r.run === 'x' ? r.centre - half : r.lo;
  const maxZ = r.run === 'x' ? r.centre + half : r.hi;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-(x2 - x1), x1 - minX], [x2 - x1, maxX - x1], [-(z2 - z1), z1 - minZ], [z2 - z1, maxZ - z1]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) return false;
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 <= t1;
}
