// The dock yard as a run's first level (tasks/plan.md, Phase 4): where its clue systems stand, which of its containers can hold the dossier, and where each is opened from. Pure data over
// yardplan.ts, so it is unit-tested under Node; game.ts builds the consoles and the container markings from it and reads the run's seed to pick the container.

import type { ContainerSpec } from './yardplan';

/** What the yard's plan (yardplan.ts) says about its size, handed in so this file has no runtime imports. */
export type YardGeometry = { containers: readonly ContainerSpec[]; width: number; cell: number; cols: number; rows: number; height: number };

/** The yard's clue systems, in the order they are hacked: a console on a free cell of the west bank by the gate, one on the east bank by the bridge, one near the office. `facing` is the way the screen looks (the agent stands in front). */
export const YARD_CLUES: readonly { x: number; y: number; facing: number; name: string }[] = [
  { x: 3, y: 4, facing: 0, name: 'west bank, by the gate' },
  { x: 10, y: 8, facing: 0, name: 'east bank, past the bridge' },
  { x: 13, y: 4, facing: 0, name: 'yard by the port office' },
];

/** A container of the yard, as the run sees it: where it is, how it is turned (doors at its local +x end), its size, and the spot its doors are worked from. */
export type YardContainer = { id: string; index: number; cx: number; cz: number; yaw: number; len: number; depth: number; height: number; station: { x: number; z: number } };

const boxOf = (c: ContainerSpec, width: number): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  const w = c.width ?? width;
  const hx = (c.alongZ ? w : c.len) / 2;
  const hz = (c.alongZ ? c.len : w) / 2;
  return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz };
};

/** How far in front of the doors the agent works them from. */
export const DOOR_REACH = 1.2;

/** The containers the dossier may be in, and the ones that can be opened (all of these): one high, with a clear spot in front of the doors (east end, or north when it lies along z) inside the fence. */
export function yardOpenContainers(g: YardGeometry): YardContainer[] {
  const boxes = g.containers.map((c) => boxOf(c, g.width));
  const out: YardContainer[] = [];
  g.containers.forEach((c, i) => {
    if (c.stack !== 1 || c.shape === 'tank' || c.shape === 'rack') return;
    const dx = c.alongZ ? 0 : 1;
    const dz = c.alongZ ? -1 : 0;
    const station = { x: c.x + dx * (c.len / 2 + DOOR_REACH), z: c.z + dz * (c.len / 2 + DOOR_REACH) };
    const blocked = boxes.some((q, j) => j !== i && station.x > q.minX - 0.8 && station.x < q.maxX + 0.8 && station.z > q.minZ - 0.8 && station.z < q.maxZ + 0.8);
    const inside = station.x > 1 && station.x < g.cols * g.cell - 4 && station.z > 1 && station.z < g.rows * g.cell - 4;
    if (blocked || !inside) return;
    out.push({ id: `y:${out.length}`, index: i, cx: c.x, cz: c.z, yaw: c.alongZ ? Math.PI / 2 : 0, len: c.len, depth: g.width, height: g.height * c.stack, station });
  });
  return out;
}

/** Which of the `count` openable containers holds the dossier on this seed (the same one every time). */
export function yardDossierIndex(seed: number, count: number): number {
  if (count <= 0) return -1;
  let t = (seed * 31 + 17 + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * count);
}
