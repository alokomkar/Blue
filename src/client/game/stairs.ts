// Stairs — the first floor-connector for the multi-floor building
// direction (elevator is a deliberate later follow-up, see the plan). A
// stair occupies one whole maze cell (the same "clean straight-through
// corridor" shape as a laser trap, see maze.ts's placeStair()), replacing
// its normal flat floor with a ramp: walking through it along the
// corridor's own open axis smoothly raises worldPos.y from one floor's
// height to the next, in either direction — there's no separate "up" vs
// "down" mechanic, just a height field the player's own position drives.
//
// Deliberately not a wall-collision object: the cell's own pre-existing
// side walls (from ordinary maze generation, since a clean straight-through
// cell already has real walls on its two closed sides) already box the
// stair in — only the height field itself (stairGroundHeight) is new,
// consulted directly by player.ts's tick() alongside the normal X/Z
// collision, not routed through the wallBoxes/laserBoxes list at all.
//
// This pass connects exactly floor 0 (always at world origin) to floor 1,
// so a stair's own (x, y) cell coordinates are used directly as world
// coordinates (x*cellSize, y*cellSize) below, the same way every other
// floor-0-only placement (laser traps, room zones, hiding spots) already
// does.
//
// stairGroundHeight() deliberately takes `cellSize` as an explicit
// parameter instead of importing scene.ts's CELL constant, unlike every
// other module here — kept genuinely dependency-free (same reasoning
// detection.ts is: "dependency-free of Three.js so it's unit-testable
// under Node") specifically so it can be unit-tested directly. Every other
// module's plain `import { CELL } from './scene'` has simply never been
// exercised through the Node test runner before (nothing that imports one
// was ever unit-tested), which would hit the same "Node's native ESM
// resolution needs an explicit file extension for a real runtime import,
// unlike TypeScript's bundler-mode resolution" gap this sidesteps.
// buildStairMesh (never unit-tested — it's a Three.js scene builder, not a
// pure function) still takes the real scene.ts CELL as its own parameter
// too, for consistency, rather than mixing calling conventions.

import * as THREE from 'three';
import type { Stair } from './maze';

const STEPS_PER_CELL = 8;
const MAX_STEP_RISE = 0.2; // m: the tallest a tread is drawn
const STEP_COLOR = 0x6b7178;
const STEP_SIDE_PAD = 0.3; // keeps each tread a hair narrower than the full cell so it doesn't visually clip into the corridor's side walls
const STEP_THICKNESS_PAD = 0.02; // a touch of overlap between consecutive treads so there's no visible gap/seam

/** How a stair is dressed: the treads' colour (a hall's stair is timber, the heist's is grey stone). */
export type StairLook = { tread?: number };

/**
 * A simple stepped staircase (not a smooth ramp — steps read more clearly as "stairs") spanning its whole run (stair.run cells), climbing from stair.fromFloorY to stair.toFloorY.
 * One that descends along its axis (toFloorY below fromFloorY) is the same flight walked the other way: it is drawn from its lower end.
 */
export function buildStairMesh(stair: Stair, cellSize: number, look: StairLook = {}): THREE.Object3D {
  const group = new THREE.Group();
  const low = Math.min(stair.fromFloorY, stair.toFloorY);
  group.position.set(stair.x * cellSize, low, stair.y * cellSize);

  const width = stair.width ?? 1;
  // Treads no higher than a real step's: more of them on a tall climb, however short the run.
  const N_STEPS = Math.max(STEPS_PER_CELL * stair.run, Math.ceil(Math.abs(stair.toFloorY - stair.fromFloorY) / MAX_STEP_RISE));
  const rising = stair.toFloorY >= stair.fromFloorY;
  const stepRise = Math.abs(stair.toFloorY - stair.fromFloorY) / N_STEPS;
  const stepRun = (cellSize * stair.run) / N_STEPS;
  const mat = new THREE.MeshStandardMaterial({ color: look.tread ?? STEP_COLOR, roughness: 0.8 });
  const treadGeo = new THREE.BoxGeometry(1, 1, 1);
  const across = cellSize * width - STEP_SIDE_PAD;
  const acrossMid = ((width - 1) * cellSize) / 2; // the first cell is the stair's centre line; a wider one spreads from it

  for (let i = 0; i < N_STEPS; i++) {
    const treadTopY = stepRise * (i + 1);
    const treadThickness = stepRise + STEP_THICKNESS_PAD;
    const j = rising ? i : N_STEPS - 1 - i; // where along the run this tread sits
    const alongRun = -cellSize / 2 + stepRun * (j + 0.5); // from the first cell's near edge
    const tread = new THREE.Mesh(treadGeo, mat);
    if (stair.spanX) {
      tread.scale.set(across, treadThickness, stepRun);
      tread.position.set(acrossMid, treadTopY - treadThickness / 2, alongRun);
    } else {
      tread.scale.set(stepRun, treadThickness, across);
      tread.position.set(alongRun, treadTopY - treadThickness / 2, acrossMid);
    }
    group.add(tread);
  }

  return group;
}

/**
 * The player's ground height while standing anywhere within the stair's
 * footprint (its first cell and the `run - 1` after it along the axis) —
 * `null` outside it (normal per-floor collision/height applies instead).
 * Interpolates linearly along the corridor's own open axis (`spanX` ? Z :
 * X, same convention as laser traps) from `fromFloorY` at the first cell's
 * near edge to `toFloorY` at the last cell's far edge;
 * position across the *other* axis (the corridor's width) doesn't affect
 * height, so the whole walkable width of the corridor climbs together, not
 * just a narrow centerline.
 */
export function stairGroundHeight(stair: Stair, worldX: number, worldZ: number, cellSize: number): number | null {
  const cx = stair.x * cellSize;
  const cz = stair.y * cellSize;
  const half = cellSize / 2;
  const length = cellSize * stair.run;
  const wide = cellSize * (stair.width ?? 1);
  const maxX = stair.spanX ? cx - half + wide : cx - half + length;
  const maxZ = stair.spanX ? cz - half + length : cz - half + wide;
  if (worldX < cx - half || worldX > maxX || worldZ < cz - half || worldZ > maxZ) return null;
  const t = stair.spanX ? (worldZ - (cz - half)) / length : (worldX - (cx - half)) / length;
  const clampedT = Math.max(0, Math.min(1, t));
  return stair.fromFloorY + clampedT * (stair.toFloorY - stair.fromFloorY);
}
