// Where a laser sight's line ends: pure, so it is unit-tested under Node (sights.ts draws it). The wall test (detection.ts's lineClearOver) is handed in.

import * as THREE from 'three';
import type { WallBox } from './scene';

export type LineClear = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, boxes: WallBox[]) => boolean;

/**
 * Where a line from `from` along `dir` first meets a wall (or the floor), no further than `range`. `from` is in the world; `floorY` is the height of the floor the walls stand on: the
 * wall tests are in heights off that floor (lineClearOver), so on an upper floor the line is lowered by it, or it would pass over every wall.
 */
export function traceEndWith(lineClear: LineClear, from: THREE.Vector3, dir: THREE.Vector3, range: number, walls: WallBox[], floorY: number): THREE.Vector3 {
  let len = range;
  if (dir.y < -0.01) len = Math.min(len, Math.max(0.2, (from.y - floorY) / -dir.y));
  const at = (t: number): THREE.Vector3 => from.clone().addScaledVector(dir, t);
  const clear = (p: THREE.Vector3): boolean => lineClear(from.x, from.y - floorY, from.z, p.x, p.y - floorY, p.z, walls);
  const far = at(len);
  if (clear(far)) return far;
  let lo = 0;
  let hi = len;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (clear(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo);
}
