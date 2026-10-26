// Fog-of-war memory — ported from blueprint/src/index.html:2918
// (freshVisited) and the `state.visited[ny][nx] = true` marking in
// tryMove() (index.html:4739): a cell is remembered once the player has
// actually stood in it, not merely because it passed within some radius.
// The 2D game re-marked this per discrete input step; movement here is
// continuous (see player.ts), so instead this recomputes which cells are
// currently lit every frame from the player's live position/facing.
//
// "Live" visibility (what's lit right now) went through two earlier passes
// before this one. First it wasn't tracked at all — the assumption was that
// it comes for free from the player's actual SpotLight lighting the
// geometry in real time. That broke once the floor got a real textured
// material (scene.ts's buildFloorTextures()): its albedo is well below the
// old flat white, so even the tile directly under the player's own torch
// rendered as almost black. Second pass tracked exactly two fixed cells
// (the player's own, and one AHEAD_DIST ahead) at one flat LIT_COLOR,
// fading between tiers — a big improvement, but reported as still feeling
// short-range and binary: "the range seems limited to next square... the
// light can shine beyond that, it should reveal the next tiles slowly too."
//
// This pass replaces the two fixed cells with a real cone: every cell
// within TORCH_RANGE and TORCH_HALF_ANGLE of the player's facing (and with
// a clear line — reusing detection.ts's hasLineOfSight, so light doesn't
// reveal a tile behind a wall) gets a brightness factor from 0 (edge of
// range/cone, or just past REVEAL_THRESHOLD) to 1 (right next to the
// player), blended between EXPLORED_COLOR and LIT_COLOR. Rather than
// fixed-duration fades between two known endpoints (the old Transition
// type), each tracked tile now *chases* its current target color with
// exponential smoothing (tickFloorTransitions' CHASE_TAU) — the right tool
// once the target itself keeps changing continuously as the player moves
// through the cone, not just at two discrete moments.
import * as THREE from 'three';
import { revealFloorCell, CELL, EXPLORED_COLOR, LIT_COLOR, type FloorRig, type WallBox } from './scene';
import { hasLineOfSight } from './detection';

export type ExploredGrid = boolean[][];
type LiveTile = { x: number; y: number; current: THREE.Color; factor: number };

export type VisionState = {
  explored: ExploredGrid;
  live: Map<string, LiveTile>;
};

const TORCH_RANGE = 8; // a touch under the real SpotLight's own 13-unit distance (player.ts) — how far the floor reveal reaches
const TORCH_HALF_ANGLE = (Math.PI / 5) * 1.2; // a little wider than the literal light cone, so the reveal feels generous rather than clipped
const OWN_CELL_RADIUS = 1.2; // within this distance, always fully revealed regardless of facing — matches the player's own footLight, which lights the ground underfoot regardless of which way they're facing
const DARK_RANGE = 4.5; // torch off: only the cells right around you show, dimly, whichever way you face
const DARK_BRIGHTNESS = 0.45;
const GOGGLES_RANGE = 9; // night vision: most of a torch's reach, all the way round
const GOGGLES_BRIGHTNESS = 0.8;

/** How the player is seeing: by torch (a cone ahead), bare-eyed in the dark (a little all round), or through night-vision goggles (further, all round). */
export type Sight = 'torch' | 'bare' | 'goggles';
const REVEAL_THRESHOLD = 0.05; // minimum brightness factor worth tracking/marking explored — filters out the cone's very faint fringe
const CHASE_TAU = 0.4; // seconds — how slowly a tile's displayed color chases its (possibly still-moving) target; bigger = a slower, more gradual sweep
const SCAN_RADIUS = Math.ceil(Math.max(TORCH_RANGE, GOGGLES_RANGE) / CELL) + 1; // cells checked each frame around the player; bounded so this stays cheap regardless of maze size

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 0 (unlit) to 1 (right at the player) — distance falloff × cone falloff, gated by TORCH_RANGE, TORCH_HALF_ANGLE and a clear line of sight. With the torch off, a short, dim reveal all round instead; through goggles, a longer one all round. */
function brightnessFactor(playerX: number, playerZ: number, facingAngle: number, cellX: number, cellZ: number, wallBoxes: WallBox[], sight: Sight): number {
  const dx = cellX - playerX;
  const dz = cellZ - playerZ;
  const dist = Math.hypot(dx, dz);
  if (sight === 'goggles') {
    if (dist > GOGGLES_RANGE) return 0;
    if (dist > OWN_CELL_RADIUS && !hasLineOfSight(playerX, playerZ, cellX, cellZ, wallBoxes, GOGGLES_RANGE)) return 0;
    return GOGGLES_BRIGHTNESS * Math.pow(1 - dist / GOGGLES_RANGE, 0.9);
  }
  if (sight === 'bare') {
    if (dist > DARK_RANGE) return 0;
    if (dist > OWN_CELL_RADIUS && !hasLineOfSight(playerX, playerZ, cellX, cellZ, wallBoxes, DARK_RANGE)) return 0;
    return DARK_BRIGHTNESS * Math.pow(1 - dist / DARK_RANGE, 0.8);
  }
  if (dist > TORCH_RANGE) return 0;

  let angleFactor = 1;
  if (dist > OWN_CELL_RADIUS) {
    const toCellAngle = Math.atan2(dx, dz);
    let diff = Math.abs(toCellAngle - facingAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > TORCH_HALF_ANGLE) return 0;
    angleFactor = 1 - diff / TORCH_HALF_ANGLE;
    if (!hasLineOfSight(playerX, playerZ, cellX, cellZ, wallBoxes, TORCH_RANGE)) return 0;
  }

  const distFactor = Math.pow(1 - dist / TORCH_RANGE, 1.4); // eased falloff — holds brighter near the player, drops off faster toward the edge
  return Math.max(0, Math.min(1, distFactor * angleFactor));
}

export function freshExplored(cols: number, rows: number): VisionState {
  const explored: ExploredGrid = [];
  for (let y = 0; y < rows; y++) explored.push(new Array(cols).fill(false));
  return { explored, live: new Map() };
}

/**
 * Recomputes every nearby cell's brightness factor from the player's live
 * position/facing and updates the tracked "live" set accordingly — cells
 * newly within the torch's cone start being tracked (and get marked
 * explored), cells that were tracked but are no longer in range/cone get
 * their target factor dropped to 0 so tickFloorTransitions() fades them
 * back out. Call once per frame; the actual color animation happens in
 * tickFloorTransitions().
 */
export function updateVision(floor: FloorRig, state: VisionState, worldX: number, worldZ: number, facingAngle: number, wallBoxes: WallBox[], sight: Sight = 'torch'): void {
  const rows = state.explored.length;
  const cols = state.explored[0]?.length ?? 0;
  // Floor-local cell coordinates (the grid always starts at its own (0,0)),
  // but brightness/line-of-sight math below needs to compare against the
  // player's *world* position and the (world-space) wallBoxes — so cell
  // centers are converted to world space via the floor Group's own offset
  // (see scene.ts's buildFloor/FloorRig) rather than assuming the floor
  // sits at the world origin, which only floor 0 actually does.
  const originX = floor.group.position.x;
  const originZ = floor.group.position.z;
  const pcx = Math.round((worldX - originX) / CELL);
  const pcz = Math.round((worldZ - originZ) / CELL);

  const touched = new Set<string>();
  for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
    for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      if (cx < 0 || cx >= cols || cz < 0 || cz >= rows) continue;
      const factor = brightnessFactor(worldX, worldZ, facingAngle, originX + cx * CELL, originZ + cz * CELL, wallBoxes, sight);
      if (factor < REVEAL_THRESHOLD) continue;
      const key = cellKey(cx, cz);
      touched.add(key);
      state.explored[cz]![cx] = true;
      let tile = state.live.get(key);
      if (!tile) {
        const current = new THREE.Color();
        floor.floorTiles.getColorAt(cz * floor.cols + cx, current);
        tile = { x: cx, y: cz, current, factor };
        state.live.set(key, tile);
      } else {
        tile.factor = factor;
      }
    }
  }

  // Anything still tracked but not touched this frame (out of range/cone,
  // or the player moved past the scan window) fades back toward the dim
  // memory tier instead of being dropped outright.
  for (const [key, tile] of state.live) {
    if (!touched.has(key)) tile.factor = 0;
  }
}

/**
 * Seen from above (the top of a tower, pipes.ts): every cell within
 * `radius` metres of (worldX, worldZ), over the walls, marked explored and
 * lit, brightest nearest (`factor` at the centre). Instead of
 * updateVision() while it lasts; anything else still lit fades back to
 * memory, as it would there.
 */
export function revealAround(floor: FloorRig, state: VisionState, worldX: number, worldZ: number, radius: number, factor: number): void {
  const originX = floor.group.position.x;
  const originZ = floor.group.position.z;
  const touched = new Set<string>();
  state.explored.forEach((row, cz) =>
    row.forEach((_, cx) => {
      const d = Math.hypot(originX + cx * CELL - worldX, originZ + cz * CELL - worldZ);
      if (d > radius) return;
      const f = factor * Math.sqrt(1 - d / radius);
      if (f < REVEAL_THRESHOLD) return;
      row[cx] = true;
      const key = cellKey(cx, cz);
      touched.add(key);
      const tile = state.live.get(key);
      if (tile) tile.factor = f;
      else {
        const current = new THREE.Color();
        floor.floorTiles.getColorAt(cz * floor.cols + cx, current);
        state.live.set(key, { x: cx, y: cz, current, factor: f });
      }
    })
  );
  for (const [key, tile] of state.live) if (!touched.has(key)) tile.factor = 0;
}

/** Lets everything lit on `state` fade back to memory (nothing's lighting it any more). */
export function dimLive(state: VisionState): void {
  for (const tile of state.live.values()) tile.factor = 0;
}

const SETTLE_EPSILON = 0.01;

function colorSettled(a: THREE.Color, b: THREE.Color): boolean {
  return Math.abs(a.r - b.r) < SETTLE_EPSILON && Math.abs(a.g - b.g) < SETTLE_EPSILON && Math.abs(a.b - b.b) < SETTLE_EPSILON;
}

/** Chases every tracked tile's displayed color toward its current factor-blended target, dropping tiles once they've faded all the way back down to the memory tier. Call once per frame, alongside updateVision(). */
export function tickFloorTransitions(floor: FloorRig, state: VisionState, dt: number): void {
  if (state.live.size === 0) return;
  const alpha = 1 - Math.exp(-dt / CHASE_TAU);
  const target = new THREE.Color();
  for (const [key, tile] of state.live) {
    target.copy(EXPLORED_COLOR).lerp(LIT_COLOR, tile.factor);
    tile.current.lerp(target, alpha);
    revealFloorCell(floor, tile.x, tile.y, tile.current);
    if (tile.factor === 0 && colorSettled(tile.current, EXPLORED_COLOR)) state.live.delete(key);
  }
}
