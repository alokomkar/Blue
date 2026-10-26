// Cover to cover (Splinter Cell: Blacklist's way of moving through a room): from behind a desk, line up the next piece of furniture and dash to it, ending crouched behind it. The dash is
// aimed with the trap's aim (game.ts's dashToAim); here is the choice of where it ends: the standing spot behind the piece that is in front of the agent, in reach, with nothing in the
// way, on the side that hides them best from the guards who are up. Pure geometry, tested under Node.

import type { CoverSpot } from './cover';
import type { WallBox } from './scene';

/** How far a hop can go, and how far either side of straight ahead (radians) the piece may be. */
export const HOP_RANGE = 14;
export const HOP_CONE = 0.7;
/** Guards this far (metres) count when working out which side of a piece hides the agent. */
export const HOP_THREAT_RANGE = 24;
/** How far from a face the agent stands (cover.ts's HOP_STANDOFF: a test keeps the two equal). */
export const HOP_STANDOFF = 0.36;
/** Face ends the standing spot keeps off (the agent has a width). */
const END_MARGIN = 0.35;

export type Threat = { x: number; z: number };

/**
 * The best spot to hop to from (x, z) facing `yaw` (0 = +Z), or null: standing spots on the faces of the cover pieces in `boxes`, each scored by how well the piece hides the agent there
 * from `threats` (a guard on the far side of it doesn't see them over it), how near straight ahead it is and how near. `clearDist(x1, z1, x2, z2)` is how far a straight line gets from the
 * first point toward the second before it meets a wall or any furniture. `here` is the spot the agent is on now, never chosen again.
 */
export function hopSpot(
  boxes: readonly WallBox[],
  x: number,
  z: number,
  yaw: number,
  threats: readonly Threat[],
  clearDist: (x1: number, z1: number, x2: number, z2: number) => number,
  here: CoverSpot | null = null
): CoverSpot | null {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let best: { spot: CoverSpot; score: number } | null = null;
  for (const box of boxes) {
    if (!box.cover || box.see) continue;
    const faces = [
      { nx: 0, nz: -1, plane: box.minZ, lo: box.minX, hi: box.maxX },
      { nx: 0, nz: 1, plane: box.maxZ, lo: box.minX, hi: box.maxX },
      { nx: -1, nz: 0, plane: box.minX, lo: box.minZ, hi: box.maxZ },
      { nx: 1, nz: 0, plane: box.maxX, lo: box.minZ, hi: box.maxZ },
    ];
    for (const f of faces) {
      const alongZ = f.nx !== 0; // the face runs along Z when its normal is along X
      const stand = f.plane + (alongZ ? f.nx : f.nz) * HOP_STANDOFF;
      const mid = (f.lo + f.hi) / 2;
      // Where along the face to stand: as near the agent's own line as the face reaches (leaving the ends clear), so a hop goes straight on.
      const lateral0 = alongZ ? z : x;
      const room = Math.max(0, (f.hi - f.lo) / 2 - END_MARGIN);
      const lateral = Math.min(mid + room, Math.max(mid - room, lateral0));
      const px = alongZ ? stand : lateral;
      const pz = alongZ ? lateral : stand;
      const dx = px - x;
      const dz = pz - z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2 || dist > HOP_RANGE) continue;
      // In front of the agent.
      const ahead = (dx * fx + dz * fz) / dist;
      const off = Math.acos(Math.min(1, Math.max(-1, ahead)));
      if (off > HOP_CONE) continue;
      // Not onto the face of the piece, but the side this face is on: the agent is out from it.
      const out = alongZ ? (x - f.plane) * f.nx : (z - f.plane) * f.nz;
      const outerLine = alongZ ? (px - x) * f.nx : (pz - z) * f.nz;
      if (outerLine > 0.05 && out < -0.05) continue; // (the far face of a piece: the way there is through it)
      if (here && here.box === box && here.nx === f.nx && here.nz === f.nz) continue;
      // A clear way there.
      if (clearDist(x, z, px, pz) < dist - 0.1) continue;
      // How well the piece hides the agent here: a guard on the far side of it (against the face's normal) can't see over it.
      let exposed = 0;
      for (const t of threats) {
        const td = Math.hypot(t.x - px, t.z - pz);
        if (td > HOP_THREAT_RANGE) continue;
        const behind = ((t.x - px) * f.nx + (t.z - pz) * f.nz) / Math.max(0.01, td) < -0.35;
        if (!behind) exposed += 1 / (1 + td / 8);
      }
      const score = -exposed * 3 - off * 2 - dist * 0.04 + (box.cover === 'tall' ? 0.4 : 0);
      if (best && score <= best.score) continue;
      const spot: CoverSpot = alongZ
        ? { box, nx: f.nx, nz: 0, ax: stand, az: f.lo, bx: stand, bz: f.hi, px, pz, dist: HOP_STANDOFF }
        : { box, nx: 0, nz: f.nz, ax: f.lo, az: stand, bx: f.hi, bz: stand, px, pz, dist: HOP_STANDOFF };
      best = { spot, score };
    }
  }
  return best?.spot ?? null;
}
