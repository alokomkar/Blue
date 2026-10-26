// Security cameras, as data and rules: a head on a wall mount that sweeps back and forth across an angle, with a view cone like a guard's. Seeing the agent for long enough
// is being spotted (suspicion, and the guards on that storey come to look). The tower's balcony has three; a console in the security room loops the feed and blinds them for a while.
// Pure (the sight test is detection.ts's botCanSee, handed in, so this file imports no code), so it is unit-tested under Node; tower.ts builds the heads and cones.

import type { botCanSee } from './detection';
import type { WallBox } from './scene';

export type CameraPlan = {
  level: number;
  /** The mount, world metres. */
  x: number;
  z: number;
  /** The way the middle of its sweep faces (0 is +z south, a quarter turn is east), radians. */
  face: number;
  /** Radians either side of `face` it sweeps. */
  sweep: number;
  /** Seconds for a full sweep there and back. */
  period: number;
  /** Where in the sweep it is at time 0, 0 to 1. */
  phase: number;
  /** How far it sees, metres. */
  range: number;
  /** Half the width of its cone, radians. */
  half: number;
  /** Which way the wall it is bracketed to lies from the mount (default: the nearest outer wall). */
  wall?: 'N' | 'S' | 'E' | 'W';
  /** Its panel is up on the wall, over a tall wall with a shelf (highwall.ts): out of reach from the floor, and not to be shot out: it is switched off by hanging from the shelf beside it. */
  high?: boolean;
  /** How high the head hangs (default: a wall bracket's height): the bunker's, on top of its double-height walls. */
  mountY?: number;
};

/** The way the camera faces `t` seconds in. */
export function cameraYaw(c: CameraPlan, t: number): number {
  return c.face + c.sweep * Math.sin(2 * Math.PI * (t / c.period + c.phase));
}

/** Whether the camera, at `t`, has a clear look at the agent: in its cone, in range, nothing solid between (low furniture hides a crouched or lying agent). */
export function cameraSees(c: CameraPlan, t: number, px: number, pz: number, walls: WallBox[], crouched: boolean, see: typeof botCanSee): boolean {
  return see(c.x, c.z, cameraYaw(c, t), px, pz, walls, c.range, 0, crouched, c.half);
}

/** How long the camera must keep the agent in view to spot them, and how long it then stays quiet before it can spot them again. */
export const CAMERA_SPOT_S = 0.9;
export const CAMERA_COOLDOWN_S = 5;
/** How long the console's looped feed blinds the cameras. */
export const CAMERAS_OFF_S = 45;
/** How long one camera's own panel, on the wall under it, blinds that camera. */
export const CAMERA_PANEL_OFF_S = 60; // (the panel used to blind a camera for this long; it now switches it off for good: the tower's objective)

/** The time spent seen, after `dt` more seconds of the agent being in view or not: it fills, and drains twice as fast when they are out of view. */
export function spotMeter(seen: number, inView: boolean, dt: number): number {
  return inView ? seen + dt : Math.max(0, seen - dt * 2);
}

/**
 * How far the camera sees along each of `n + 1` rays fanned across its cone at `yaw`, clipped by the solid boxes that stop a look (walls and tall furniture: not a fence, and not low
 * furniture, which only hides a crouched agent), so the cone drawn on the floor stops at a wall.
 */
export function coneRadii(c: CameraPlan, yaw: number, walls: readonly WallBox[], n: number): number[] {
  const out: number[] = [];
  // Only what can stop a look (and is within its range) matters: a storey is thick with furniture, and the cone is redrawn every frame.
  const solids = walls.filter((b) => !b.see && b.cover !== 'low' && b.maxX > c.x - c.range && b.minX < c.x + c.range && b.maxZ > c.z - c.range && b.minZ < c.z + c.range);
  for (let k = 0; k <= n; k++) {
    const a = yaw - c.half + (2 * c.half * k) / n;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let best = c.range;
    for (const b of solids) {
      // Slab test of the ray (x, z) + t (dx, dz) against the box.
      let t0 = 0;
      let t1 = best;
      let hit = true;
      for (const [o, d, lo, hi] of [[c.x, dx, b.minX, b.maxX], [c.z, dz, b.minZ, b.maxZ]] as const) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) hit = false;
        } else {
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) hit = false;
        }
        if (!hit) break;
      }
      if (hit && t0 < best) best = t0;
    }
    out.push(best);
  }
  return out;
}

