// Scene/renderer/wall/floor setup — ported from
// blueprint/prototype-3d-thirdperson.html:323-378 (addWall, floor, exit
// marker, lighting rig). CELL/WALL_H/WALL_T match the prototype exactly so
// the collision math in player.ts lines up with the visible geometry.
//
// Fog-of-war (Phase 2): global ambient light is dimmed well below the
// original fully-lit scene — visibility mostly comes from the player's own
// torch (player.ts's SpotLight) plus scattered warm corridor light fixtures
// below, not from lighting the whole maze uniformly. (An earlier pass here
// went much darker, relying on the torch alone; that made ordinary
// navigation frustrating rather than atmospheric, so the ambient floor was
// raised and real light fixtures were added — a "night heist with security
// lighting" feel instead of "pitch black corridor.") The floor is one
// InstancedMesh tile per cell (not a single big plane) so vision.ts can
// brighten a cell's tile once it's been explored, giving a dim "remembered
// path" glow that persists after the torch moves on — walls get no such
// memory layer and simply go dark outside any light's reach, which reads as
// more atmospheric in third-person 3D than the 2D game's always-dim-visible
// wall outlines (a deliberate deviation, not an oversight).
//
// Wall color/lighting pass: inspired by two Three.js examples pointed at
// directly — webgl_animation_keyframes ("Littlest Tokyo," a richly, densely
// colored miniature night scene under natural sky lighting) suggested
// keeping the dark base but adding real pockets of saturated color rather
// than a flat uniform grey, so a small fraction of wall panels now draw
// from ACCENT_COLORS (below) with a faint emissive glow — like hazard
// markings/signage in an otherwise dark warehouse, not a redesign of the
// whole palette. webgl_lights_physical (measured light units, inverse-
// square falloff, PBR materials, tone-mapped exposure) suggested enabling
// real tone mapping so the scene's already-bright point lights compress
// more naturally instead of clipping to flat white — see toneMapping below.
//
// Floor pass: pointed at webgl_lights_physical again, specifically for its
// floor — a textured, bump-mapped MeshStandardMaterial (roughness 0.8,
// metalness 0.2) that catches its light source as a real specular
// highlight, instead of a flat solid color. buildFloorTextures() below
// generates an equivalent procedurally (a canvas-drawn texture + matching
// bump map, not a bundled image — avoids adding an external asset/license
// for something this simple).
//
// Office-compound reskin: direct request, pointed at an architectural-viz
// render of a modern house interior and asking for that feel, at night, but
// re-themed as breaking into a "highly secure office compound" (desks,
// server rooms, conference rooms, cafeteria) rather than a home. Matching
// that render's baked-GI photoreal quality isn't realistic in real-time
// WebGL on mobile — what's actually achievable, and what this pass does, is
// the material/lighting *mood*: swap the dark industrial-warehouse palette
// (dark steel walls, diamond-plate floor, warm sodium-bulb corridor lights)
// for a believable "office building at night" one (light drywall-toned
// walls that only read bright near an actual light source, a carpet-tile
// floor instead of diamond-plate steel, cool white/blue LED panel lighting
// instead of warm bulbs) while keeping the exact same dim-ambient/
// torch-and-fixture structure that already makes the stealth lighting work.
// Furniture (desks, servers, conference tables) and per-room theming
// (server room vs. cafeteria vs. bullpen) are deliberately NOT part of this
// pass — flagged to the user as a separate, bigger follow-up (new prop
// assets + a way to tag which generated maze regions get which room type),
// kept out here so this material/lighting swap stays a small, standalone,
// live-verifiable step, matching how every other phase in this project has
// been staged.
//
// Real bug caught after this shipped (reported as "the floor looks bad/is
// it even applied?"): the floor's material set `vertexColors: true`,
// left over from when it was a flat, mapless color — but that flag tells
// the shader to read a per-VERTEX `color` attribute on the *geometry*
// itself, which this floor never had (its fog-of-war tint is an
// InstancedMesh *instance* color, via setColorAt/.instanceColor, a
// completely separate mechanism that three.js already applies
// automatically whenever `instanceColor` exists — `vertexColors` on the
// material is not required for it and never was). With `vertexColors:
// true` but no matching geometry attribute bound, that shader path reads
// an unbound attribute — zero — and multiplies the entire diffuse color by
// it, rendering the floor black regardless of texture, lighting, or how
// bright the instance color was. Confirmed directly: toggling
// `vertexColors` to false at runtime, with nothing else changed, took the
// floor from solid black to fully lit and legible. The flat white
// material from before this pass likely had the exact same bug the whole
// time — it just wasn't as noticeable multiplying a plain white color
// against near-black fog tints, versus a textured material where "zeroed
// out" and "just dim" look identical. Fixed by simply not setting
// `vertexColors` on this material at all.

import * as THREE from 'three';
import { TALL_WALL_H, LEDGE_OUT } from './highwall';
import { behindFade, blocking, stepFade, wallBox, type Vec3 } from './wallfade';
import type { MazeCells } from './maze';
import { buildPostFX, edgesPreferred, renderPixelRatio, resizePostFX, markBloom, type PostFX } from './postfx';
import { buildEdge, type EdgeStyle, type Rect } from './edge';
import { FLOOR_THEMES } from './locations';
import { shadowsWanted, tagMeshes } from './shadows';
import { texturedWall } from './walltex';
import { buildFence } from './fence';
import type { RoomKind } from './security';

/**
 * How wide a corridor or a room cell is, in metres: four, as it has been since the game began. The dock yard (`?job=dock`, localhost only) is open air and asks for eight.
 * Read once, as the page loads: every module that is built from it sees the same size.
 */
function cellSize(): number {
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('job') === 'dock') return 8;
  } catch {
    // No window: the unit tests.
  }
  return 4;
}
export const CELL = cellSize();
export const WALL_H = 3;
export const WALL_T = 0.28;
// Vertical spacing between stacked floors (multi-floor building, see
// stairs.ts) — matches CELL for a clean 45° single-cell stair run, and sits
// just above WALL_H's wall tops so each floor's own floor tiles double as
// the floor below's implied ceiling, with no separate ceiling geometry
// needed.
export const FLOOR_HEIGHT = 4;
// From job 8 (difficulty.ts's `pipes`), floors are taller: room over the
// wall tops for a ceiling's worth of ducts and pipes to run above the
// corridors, under the floor above. A stair climbs it over two cells, about 41°.
export const TALL_FLOOR_HEIGHT = 7;

/**
 * A solid footprint on the floor. `cover` marks furniture: 'low' (desks,
 * tables, bins, crates) blocks a bot's view only while the player crouches
 * behind it; 'tall' (racks, lockers, vending machines) always does. Walls
 * and other structure leave it unset — full height, blocks everything.
 */
export type WallBox = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cover?: 'low' | 'tall';
  /** Stops a body, but not a line of sight: a chain-link fence. */
  see?: boolean;
  /** A space under a sofa or a desk: it stops anyone standing or crouching, and lets an agent lying flat crawl in (player.ts). */
  under?: boolean;
  /** With `under`: a duct (the bunker's) lets an agent crouched through too, not only one lying flat. */
  duct?: boolean;
  /** A container: the height of its roof, which can be climbed onto and walked on (the box itself is solid only from the floor; on the roof it is left out). */
  roof?: number;
  /** How high a tall wall stands, where it is not an ordinary wall's height: a shot from up high clears or hits it by this (detection.ts's lineClearOver). */
  h?: number;
  /** A tall wall: a dash up it ends in a hang from the shelf along its face, not a lie along the top (highwall.ts). */
  high?: boolean;
  /** A climb's wall (the tower's): the height of the hands on the ledge it ends in (m above its own storey's floor), and the storey that ledge is on. */
  top?: number;
  toLevel?: number;
  /** A tall wall with one shelf only (a storey high): nothing above the first to rise to. */
  single?: boolean;
};

// Split from a single do-everything buildScene() into a "root" (the parts
// genuinely shared across every floor — scene graph, camera, renderer,
// ambient/sun lighting) and a "floor" (one maze layer's own walls/floor
// tiles/fixtures, positioned at its own world offset). This is
// what makes true multi-floor stacking possible without a portal-style
// scene swap: multiple floors' geometry all lives in the same THREE.Scene
// simultaneously, each in its own Group at its own (originX, floorY,
// originZ) — see stairs.ts's floor-alignment trick for how a floor's origin
// is chosen. Collision stays simple too: WallBox itself never needed a Y
// component, since only the floor the player is *currently on* ever has its
// wallBoxes checked (game.ts picks which floor's list to pass into
// player.tick() each frame) — far less invasive than adding Y-ranges to
// every collision check across player.ts/bots.ts/detection.ts/hiding.ts/
// lasers.ts/rooms.ts for the same result.
export type SceneRoot = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ambientLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  postfx: PostFX;
};

/** Also ghosts out every wall on the camera's side of the agent (the near half of the picture, which tall walls would fill), within `radius` metres of them, down to `to` of the way to gone. */
export type WallsBehind = { x: number; z: number; radius: number; to: number; /** Within this many metres of the agent such a wall is fully faded; the fade eases out to nothing at `radius`. */ near?: number };

export type FloorRig = {
  group: THREE.Group;
  theme: FloorTheme;
  /** Per-cell callbacks run whenever that cell's fog tint changes (revealFloorCell), so floor markings/overlays fade in and out with the tile under them instead of giving the layout away in the dark. Keyed by y*cols+x. */
  decor: Map<number, Array<(color: THREE.Color) => void>>;
  /** Ceiling fixtures (a point light + its glowing bulb), for effects.ts's occasional flicker. */
  fixtures: Array<{ light: THREE.PointLight; mesh: THREE.Mesh }>;
  wallBoxes: WallBox[];
  /** The maze's own walls (not doors, furniture or fences), world frame like wallBoxes: the ones a dash into can climb (wallclimb.ts). */
  climbBoxes: WallBox[];
  floorTiles: THREE.InstancedMesh;
  cols: number;
  rows: number;
  /** Lays the ground, lamps and skyline out again round this floor and the footprints (floor-local metres) of floors that reach past it; null on an upper floor. */
  relayoutEdge: ((extra: Rect[]) => void) | null;
  /** Each cell's colour, by y*cols+x: the zone it is in (a patch of corridor and rooms in one hue), tinting its floor and the walls round it. */
  zones: THREE.Color[];
  /** Gives these cells (a room's) one hue, and re-tints the walls round them. */
  setZone: (cells: ReadonlyArray<{ x: number; y: number }>, hue: number) => void;
  /** Fades the walls that stand between `camera` and any of the `seen` points (world space: the parts of the agent that must be in view) to a ghost, easing each over `dt`; with none (another floor) every wall eases back. */
  fadeWalls: (camera: THREE.Vector3, seen: readonly Vec3[] | null, dt: number, behind?: WallsBehind) => void;
  /** How far the wall at a floor-local point has faded to a ghost, 0 solid to 1 gone (0 where there is no wall): what writing on the wall should follow. */
  wallFadeAt: (x: number, z: number) => number;
};

/** How far a zone's hue pulls a tile and a wall towards itself: enough to read at a glance, not so much the place turns to a neon sign. */
export const ZONE_MIX = 0.62;

/** The hues a location's zones are drawn from. */
const ZONE_PALETTES: Record<EdgeStyle['kind'], number[]> = {
  campus: [0x2aa9d8, 0x7a5cff, 0x24c9a0, 0xd23fb5, 0x4a7dff],
  museum: [0xd89a3a, 0xb0384f, 0x2fa07a, 0x4a52c4, 0xc86a3a],
  refinery: [0xe0702a, 0xd8b02a, 0xc83a2a, 0x3a86c4, 0x6ab04a],
  bank: [0xc9a23a, 0x1f9a6a, 0x9a2a4a, 0x2a5ac0, 0x8a6ad0],
  warehouse: [0xd8a22a, 0x2a86c8, 0xc8402a, 0x4aa86a, 0x8a6ad0],
  lab: [0x2ac9c0, 0x4a8aff, 0x8a6ad0, 0x6ac86a, 0xd24a9a],
};

/** A patch of the floor for each of a few seeds, every cell in the hue of the nearest one: corridors in bands of colour, not a single tone. */
function zoneField(cols: number, rows: number, palette: readonly number[]): THREE.Color[] {
  const n = Math.min(6, Math.max(3, Math.round((cols * rows) / 26)));
  const seeds: Array<{ x: number; y: number; hue: number }> = [];
  const order = [...palette].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    // Spread out: of a few tries, the cell furthest from the seeds so far.
    let best = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    let bestD = -1;
    for (let t = 0; t < 8; t++) {
      const c = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      const d = seeds.reduce((m, sd) => Math.min(m, Math.abs(sd.x - c.x) + Math.abs(sd.y - c.y)), 99);
      if (d > bestD) {
        best = c;
        bestD = d;
      }
    }
    seeds.push({ ...best, hue: order[i % order.length]! });
  }
  const out: THREE.Color[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let nearest = seeds[0]!;
      let nd = Infinity;
      for (const sd of seeds) {
        const d = Math.abs(sd.x - x) + Math.abs(sd.y - y) * 1.3;
        if (d < nd) {
          nd = d;
          nearest = sd;
        }
      }
      out.push(new THREE.Color(nearest.hue));
    }
  }
  return out;
}

const tintTmp = new THREE.Color();
const hueTmp = new THREE.Color();
/** `color` (a tile's fog tint) pulled towards `hue`, keeping its brightness: dark where unexplored-ish, brighter where lit. Not allocating: for every live tile, every frame. */
function zoned(color: THREE.Color, hue: THREE.Color): THREE.Color {
  const lum = color.r * 0.3 + color.g * 0.55 + color.b * 0.15;
  hueTmp.copy(hue).multiplyScalar(lum * 1.5 + 0.04);
  return tintTmp.copy(color).lerp(hueTmp, ZONE_MIX);
}

// Unexplored tiles are near-black (invisible against the fog); explored
// ones hold roughly the old single-floor color so a remembered path still
// reads once the torch moves past it, under the now-dim ambient light.
// LIT_COLOR is a third, much brighter tier for whichever single tile the
// player currently stands on (see vision.ts) — added because the floor's
// new textured material (buildFloorTextures() below) has a noticeably
// lower albedo than the old flat white one, so under EXPLORED_COLOR's dim
// tint alone even the tile directly under the player's own torch read as
// almost black. LIT_COLOR is what actually makes the panel/diamond-stud
// detail legible where a light source is genuinely hitting it — the closer
// analog to webgl_lights_physical's own floor, which is only bright in the
// bulb's immediate pool and fades to black everywhere else.
const UNEXPLORED_COLOR = new THREE.Color(0x020304);
export const EXPLORED_COLOR = new THREE.Color(0x20262e);
export const LIT_COLOR = new THREE.Color(0xe4e8ec);

// Cool white/blue LED panel fixtures placed every few cells along the
// corridors — the office-reskin swap for the old warm sodium-bulb color
// (a cool, slightly blue-white reads as overnight security/emergency
// lighting in an office building, where the old warm amber read as
// warehouse sodium lamps). Same structural role as before: real, periodic
// pools of light to navigate by on top of the player's own torch, without
// flattening the dark/moody baseline back to "everything lit." Spacing is a
// tuning knob: fewer/dimmer if this turns out too bright, tighter if any
// stretch still feels too dark; also worth watching on a real phone —
// ~40-50 simultaneous point lights on the largest maze size is untested for
// mobile GPU performance.
const CORRIDOR_LIGHT_SPACING = 6;

// A sparse fraction of walls get a small signage plaque mounted on their
// face in one of these colors (see addWall's plaque logic below) instead of
// the base wall color — saturated but not bright, with a faint emissive
// kick so the color itself stays legible in the dark rather than depending
// on being directly lit. Reads as corporate signage/branding accents (a
// safety-red fire panel, caution-amber striping, corporate teal/blue)
// rather than the old hazard-warehouse palette it replaced. Kept rare (see
// ACCENT_CHANCE) so the dark stealth baseline stays dominant — small
// pockets of color, not a repaint (an earlier version recolored the whole
// wall panel, which looked fine as a rare accent but turned into a jarring
// solid-color wall when a player faced one head-on down a long corridor —
// see addWall's header comment for the full diagnosis).
const ACCENT_CHANCE = 0.1;

/**
 * Each floor of the building gets its own look, so climbing the stairs
 * lands somewhere recognisably different: palette, floor surface, fixture
 * colour, sign colours, floor-tape colour, and which decorative rooms show
 * up (security.ts's decorKinds).
 */
export type FloorTheme = {
  name: string;
  wall: number;
  cap: number;
  floor: 'carpet' | 'raised' | 'marble' | 'grating' | 'parquet' | 'concrete' | 'tile';
  fixture: number;
  accents: number[];
  marking: number;
  decorKinds: RoomKind[];
  /** Trim running along every wall, both faces (a baseboard, a picture rail, a hazard stripe): heights up the wall, and how far it stands proud. */
  bands?: WallBand[];
  /** What stands round the outside of the level (edge.ts). */
  edge: EdgeStyle;
  /** Open air: the boundary is a chain-link fence you can see through, not a wall with a facade (the dock yard). */
  fence?: boolean;
  /** The hues its zones are drawn from, in place of the place's own palette (a hall in one family of colours). */
  zones?: number[];
};

export type WallBand = { y0: number; y1: number; color: number; out: number; metal?: boolean };

export { FLOOR_THEMES };

/**
 * Procedurally draws an office carpet-tile floor panel (diffuse + matching
 * bump map) — the office-reskin replacement for the old diamond-plate steel
 * pattern, same generation approach (canvas-drawn, no bundled image/asset
 * license needed) and same overall base brightness (so it still works
 * correctly multiplied against the fog-of-war instance-color tint, see the
 * header comment's "Floor pass" note) — just carpet instead of steel: a
 * muted blue-grey base, a visible tile grid (real carpet tiles read as
 * distinct squares, unlike a continuous industrial floor), and a fine
 * heathered fleck instead of raised metal studs. The bump map is
 * correspondingly much flatter than the old one — carpet has nowhere near
 * a diamond-plate's specular relief, so a low-amplitude noise bump (just
 * enough to avoid a perfectly flat, plasticky look under a point light) is
 * more honest than reusing raised studs would be.
 */
function buildFloorTextures(style: FloorTheme['floor']): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  if (style === 'raised') return buildRaisedFloorTextures();
  if (style === 'marble') return buildMarbleFloorTextures();
  if (style === 'grating') return buildGratingFloorTextures();
  if (style === 'parquet') return buildParquetFloorTextures();
  if (style === 'concrete') return buildConcreteFloorTextures();
  if (style === 'tile') return buildTileFloorTextures();
  const SIZE = 256;
  const TILE = SIZE / 4; // four carpet tiles per maze-cell tile

  const diffuseCanvas = document.createElement('canvas');
  diffuseCanvas.width = diffuseCanvas.height = SIZE;
  const dctx = diffuseCanvas.getContext('2d')!;
  // Noticeably lighter than a "true" dark carpet grey — this diffuse map is
  // itself only one multiplicative factor against the vertex-color fog tint
  // (scene.ts's UNEXPLORED/EXPLORED/LIT_COLOR, applied in vision.ts): a
  // realistically dark base color here compounds with that dim tint into
  // something far darker than intended, reading as "black, not textured"
  // even on the brightly-tinted LIT_COLOR tile. Brightened here specifically
  // to keep that compounding in check — same reasoning as the steel floor
  // this replaces, just a cooler office-carpet hue.
  dctx.fillStyle = '#767c88';
  dctx.fillRect(0, 0, SIZE, SIZE);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = SIZE;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, SIZE, SIZE);

  // Tile seams — carpet tiles read as distinct squares, unlike a continuous
  // industrial sheet floor.
  dctx.strokeStyle = '#4c505a';
  bctx.strokeStyle = '#707070';
  dctx.lineWidth = bctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * TILE;
    dctx.beginPath();
    dctx.moveTo(p, 0);
    dctx.lineTo(p, SIZE);
    dctx.moveTo(0, p);
    dctx.lineTo(SIZE, p);
    dctx.stroke();
    bctx.beginPath();
    bctx.moveTo(p, 0);
    bctx.lineTo(p, SIZE);
    bctx.moveTo(0, p);
    bctx.lineTo(SIZE, p);
    bctx.stroke();
  }

  // Fine heathered fleck — small flecks of slightly lighter/darker thread,
  // the way real commercial carpet tile reads up close, instead of the old
  // floor's raised metal studs.
  const FLECK_COUNT = 900;
  for (let i = 0; i < FLECK_COUNT; i++) {
    const x = Math.random() * SIZE;
    const y = Math.random() * SIZE;
    const shade = Math.random() < 0.5 ? '#8a9098' : '#5c6169';
    dctx.fillStyle = shade;
    dctx.fillRect(x, y, 1.4, 1.4);
  }

  // Fine luminance-only grain so it doesn't read as a flat vector pattern.
  const imgData = dctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    imgData.data[i] = (imgData.data[i] ?? 0) + n;
    imgData.data[i + 1] = (imgData.data[i + 1] ?? 0) + n;
    imgData.data[i + 2] = (imgData.data[i + 2] ?? 0) + n;
  }
  dctx.putImageData(imgData, 0, 0);

  // Very shallow bump noise — just enough to avoid a perfectly flat,
  // plasticky look under a point light; carpet has nowhere near a
  // diamond-plate floor's specular relief.
  const bumpImgData = bctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < bumpImgData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    bumpImgData.data[i] = (bumpImgData.data[i] ?? 0) + n;
    bumpImgData.data[i + 1] = (bumpImgData.data[i + 1] ?? 0) + n;
    bumpImgData.data[i + 2] = (bumpImgData.data[i + 2] ?? 0) + n;
  }
  bctx.putImageData(bumpImgData, 0, 0);

  const map = new THREE.CanvasTexture(diffuseCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bumpMap };
}

/** Two matched canvases (diffuse and bump) drawn by `draw`, made into repeating textures. */
function floorTexturePair(draw: (d: CanvasRenderingContext2D, b: CanvasRenderingContext2D, size: number) => void): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const SIZE = 256;
  const dc = document.createElement('canvas');
  dc.width = dc.height = SIZE;
  const bc = document.createElement('canvas');
  bc.width = bc.height = SIZE;
  const d = dc.getContext('2d')!;
  const b = bc.getContext('2d')!;
  b.fillStyle = '#808080';
  b.fillRect(0, 0, SIZE, SIZE);
  draw(d, b, SIZE);
  const map = new THREE.CanvasTexture(dc);
  const bumpMap = new THREE.CanvasTexture(bc);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bumpMap };
}

/** The museum's floor: big stone squares in two tones, laid as a check, veined, with dark seams. Same brightness band as the carpet, a touch lighter. */
function buildMarbleFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  return floorTexturePair((d, b, SIZE) => {
    const TILE = SIZE / 2;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        d.fillStyle = (tx + ty) % 2 === 0 ? '#9d978c' : '#858076';
        d.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        // Veins: a few long, faint wandering lines.
        d.strokeStyle = 'rgba(70,66,60,0.35)';
        d.lineWidth = 1.2;
        for (let v = 0; v < 3; v++) {
          d.beginPath();
          let x = tx * TILE + Math.random() * TILE;
          let y = ty * TILE + Math.random() * TILE;
          d.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (Math.random() - 0.4) * 28;
            y += (Math.random() - 0.4) * 28;
            d.lineTo(Math.min(tx * TILE + TILE, Math.max(tx * TILE, x)), Math.min(ty * TILE + TILE, Math.max(ty * TILE, y)));
          }
          d.stroke();
        }
      }
    }
    d.strokeStyle = '#4f4b44';
    d.lineWidth = 3;
    b.strokeStyle = '#606060';
    b.lineWidth = 3;
    for (const p of [0, TILE]) {
      for (const c of [d, b]) {
        c.beginPath();
        c.moveTo(p, 0);
        c.lineTo(p, SIZE);
        c.moveTo(0, p);
        c.lineTo(SIZE, p);
        c.stroke();
      }
    }
  });
}

/** The refinery's floor: steel grating, a grid of dark openings between light bars, with a solid diamond-plate square here and there. */
function buildGratingFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  return floorTexturePair((d, b, SIZE) => {
    d.fillStyle = '#6d757d';
    d.fillRect(0, 0, SIZE, SIZE);
    const STEP = 32;
    for (let y = 0; y < SIZE; y += STEP) {
      for (let x = 0; x < SIZE; x += STEP) {
        d.fillStyle = '#23282d';
        d.fillRect(x + 5, y + 5, STEP - 10, STEP - 10);
        b.fillStyle = '#101010';
        b.fillRect(x + 5, y + 5, STEP - 10, STEP - 10);
        // A bright edge on each bar.
        d.fillStyle = '#8a929a';
        d.fillRect(x + 2, y + 2, STEP - 4, 2);
        d.fillRect(x + 2, y + 2, 2, STEP - 4);
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(Math.random() * 4) * 64;
      const y = Math.floor(Math.random() * 4) * 64;
      d.fillStyle = '#727a82';
      d.fillRect(x + 2, y + 2, 60, 60);
      d.strokeStyle = '#5a6168';
      d.lineWidth = 1;
      for (let k = -64; k < 64; k += 8) {
        d.beginPath();
        d.moveTo(x + 2 + k, y + 62);
        d.lineTo(x + 62 + k, y + 2);
        d.stroke();
      }
      b.fillStyle = '#909090';
      b.fillRect(x + 2, y + 2, 60, 60);
    }
  });
}

/** The bank's floor: dark wood laid in a basket weave, each plank its own shade. */
function buildParquetFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  return floorTexturePair((d, b, SIZE) => {
    const BLOCK = 64;
    const PLANK = BLOCK / 4;
    for (let by = 0; by < SIZE / BLOCK; by++) {
      for (let bx = 0; bx < SIZE / BLOCK; bx++) {
        const across = (bx + by) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const shade = 0.82 + Math.random() * 0.34;
          d.fillStyle = `rgb(${Math.round(138 * shade)},${Math.round(104 * shade)},${Math.round(72 * shade)})`;
          const x = bx * BLOCK + (across ? 0 : k * PLANK);
          const y = by * BLOCK + (across ? k * PLANK : 0);
          const w = across ? BLOCK : PLANK;
          const h = across ? PLANK : BLOCK;
          d.fillRect(x, y, w, h);
          d.strokeStyle = '#3d2a1b';
          d.lineWidth = 1.5;
          d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          b.strokeStyle = '#606060';
          b.lineWidth = 1.5;
          b.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
      }
    }
  });
}

/** The warehouse's floor: sealed concrete in slabs with expansion joints, oil stains and a painted lane line. */
function buildConcreteFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  return floorTexturePair((d, b, SIZE) => {
    d.fillStyle = '#7d8084';
    d.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 2600; i++) {
      const v = 0.78 + Math.random() * 0.4;
      d.fillStyle = `rgb(${Math.round(125 * v)},${Math.round(128 * v)},${Math.round(132 * v)})`;
      d.fillRect(Math.random() * SIZE, Math.random() * SIZE, 1.5, 1.5);
    }
    // Oil: a few dark soft blotches.
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * SIZE;
      const y = Math.random() * SIZE;
      const g = d.createRadialGradient(x, y, 2, x, y, 14 + Math.random() * 16);
      g.addColorStop(0, 'rgba(30,32,36,0.5)');
      g.addColorStop(1, 'rgba(30,32,36,0)');
      d.fillStyle = g;
      d.fillRect(x - 40, y - 40, 80, 80);
    }
    // A painted lane line along one slab edge, and the expansion joints.
    d.fillStyle = '#c9a824';
    d.globalAlpha = 0.55;
    d.fillRect(0, SIZE / 2 - 3, SIZE, 6);
    d.globalAlpha = 1;
    d.fillStyle = '#4a4d51';
    d.fillRect(0, 0, SIZE, 2);
    d.fillRect(0, 0, 2, SIZE);
    b.fillStyle = '#505050';
    b.fillRect(0, 0, SIZE, 3);
    b.fillRect(0, 0, 3, SIZE);
    for (let i = 0; i < 40; i++) {
      b.fillStyle = Math.random() < 0.5 ? '#8c8c8c' : '#747474';
      b.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
    }
  });
}

/** The lab's floor: glossy pale tile in a grid of fine grout, a faint blue cast, and the odd scuff. */
function buildTileFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  return floorTexturePair((d, b, SIZE) => {
    const T = SIZE / 4;
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const v = 0.92 + Math.random() * 0.1;
        d.fillStyle = `rgb(${Math.round(176 * v)},${Math.round(190 * v)},${Math.round(196 * v)})`;
        d.fillRect(tx * T, ty * T, T, T);
        const sheen = d.createLinearGradient(tx * T, ty * T, tx * T + T, ty * T + T);
        sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
        d.fillStyle = sheen;
        d.fillRect(tx * T, ty * T, T, T);
        d.strokeStyle = '#6b7880';
        d.lineWidth = 2;
        d.strokeRect(tx * T + 1, ty * T + 1, T - 2, T - 2);
        b.strokeStyle = '#505050';
        b.lineWidth = 2;
        b.strokeRect(tx * T + 1, ty * T + 1, T - 2, T - 2);
      }
    }
    for (let i = 0; i < 10; i++) {
      d.strokeStyle = 'rgba(90,100,106,0.25)';
      d.lineWidth = 1;
      d.beginPath();
      const x = Math.random() * SIZE;
      const y = Math.random() * SIZE;
      d.moveTo(x, y);
      d.lineTo(x + 8 + Math.random() * 14, y + (Math.random() - 0.5) * 6);
      d.stroke();
    }
  });
}

/** How each floor surface takes the light: bump depth, roughness, metalness. */
const FLOOR_LOOK: Record<FloorTheme['floor'], { bump: number; rough: number; metal: number }> = {
  carpet: { bump: 0.06, rough: 0.92, metal: 0.02 },
  raised: { bump: 0.06, rough: 0.92, metal: 0.02 },
  marble: { bump: 0.03, rough: 0.42, metal: 0.05 },
  grating: { bump: 0.12, rough: 0.55, metal: 0.55 },
  parquet: { bump: 0.05, rough: 0.55, metal: 0.03 },
  concrete: { bump: 0.08, rough: 0.8, metal: 0.02 },
  tile: { bump: 0.02, rough: 0.28, metal: 0.04 },
};

/** Data-center raised-floor panels: a 4×4 grid of square access tiles per cell with bevelled seams, every few tiles perforated for airflow. Same brightness band as the carpet so the fog-of-war tint multiplies it the same way. */
function buildRaisedFloorTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const SIZE = 256;
  const TILE = SIZE / 4;
  const dc = document.createElement('canvas');
  dc.width = dc.height = SIZE;
  const d = dc.getContext('2d')!;
  const bc = document.createElement('canvas');
  bc.width = bc.height = SIZE;
  const b = bc.getContext('2d')!;
  d.fillStyle = '#7b818b';
  d.fillRect(0, 0, SIZE, SIZE);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, SIZE, SIZE);
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      // Bevel: lighter top-left edge, darker bottom-right, like a real panel lip.
      d.fillStyle = '#8c929c';
      d.fillRect(x0 + 2, y0 + 2, TILE - 4, 2);
      d.fillRect(x0 + 2, y0 + 2, 2, TILE - 4);
      d.fillStyle = '#5f646d';
      d.fillRect(x0 + 2, y0 + TILE - 4, TILE - 4, 2);
      d.fillRect(x0 + TILE - 4, y0 + 2, 2, TILE - 4);
      if ((tx + ty * 2) % 3 === 0) {
        for (let py = 0; py < 7; py++) {
          for (let px = 0; px < 7; px++) {
            const cx = x0 + 10 + px * 7.3;
            const cy = y0 + 10 + py * 7.3;
            d.fillStyle = '#50555d';
            d.fillRect(cx, cy, 2.4, 2.4);
            b.fillStyle = '#5a5a5a';
            b.fillRect(cx, cy, 2.4, 2.4);
          }
        }
      }
    }
  }
  d.strokeStyle = '#3f434a';
  b.strokeStyle = '#4a4a4a';
  d.lineWidth = b.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    const p = i * TILE;
    for (const ctx of [d, b]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
  }
  const map = new THREE.CanvasTexture(dc);
  const bumpMap = new THREE.CanvasTexture(bc);
  map.wrapS = map.wrapT = bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bumpMap };
}

/** The shared scene graph/camera/renderer/lighting — built once per job, regardless of how many floors it ends up with. */
export function buildSceneRoot(canvas: HTMLCanvasElement): SceneRoot {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.024);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.3, 200) // (0.3, not 0.1: depth precision, for the edge pass in postfx.ts);
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(renderPixelRatio(edgesPreferred()));
  // Filmic falloff for the scene's already-bright point lights (torch,
  // corridor fixtures, flares) instead of clipping straight to flat white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // Shadows (shadows.ts): updated once a frame by hand (renderPostFX), not by every render of the scene (the bloom pass renders it too).
  renderer.shadowMap.enabled = shadowsWanted();
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  // Dimmed well below the original fully-lit scene, but not so far that
  // ordinary geometry is invisible outside the torch/corridor lights below.
  const ambientLight = new THREE.HemisphereLight(0x8fa8bf, 0x1a1510, 0.4);
  scene.add(ambientLight);
  const sunLight = new THREE.DirectionalLight(0xcbd8e0, 0.18);
  sunLight.position.set(6, 14, -4);
  scene.add(sunLight);

  const postfx = buildPostFX(renderer, scene, camera);
  return { scene, camera, renderer, ambientLight, sunLight, postfx };
}

/**
 * Builds one floor's walls/floor-tiles/corridor-fixtures into its own Group
 * at (originX, floorY, originZ), added to the shared root scene. (The exit
 * is a lift built by game.ts — see elevator.ts.)
 */
export function buildFloor(
  root: SceneRoot,
  cells: MazeCells,
  cols: number,
  rows: number,
  originX: number,
  originZ: number,
  floorY: number,
  theme: FloorTheme = FLOOR_THEMES[0]!,
  /** A doorway in the outer wall at this cell's side (ways.ts): the facade leaves it clear. */
  doorway?: { dir: 'N' | 'S' | 'E' | 'W'; cell: number },
  /** Edges (by the cell and the side, N or W) that are a fence, not a wall, though they are inside the level: a quay's rail (the dock yard's canal). */
  railing?: (x: number, y: number, dir: 'N' | 'W') => boolean,
  /** Walls that stand TALL_WALL_H high, with a shelf along their faces: asked of each wall by its two ends (floor-local metres). */
  tall?: (x1: number, z1: number, x2: number, z2: number) => boolean,
  /** How high those walls stand: TALL_WALL_H, or a storey's height (a tower's: then only the one shelf, at an ordinary wall's height). */
  tallHeight = TALL_WALL_H,
  /** No walls between two cells nobody can be in (the bunker's solid mass): they are never seen, and each is a mesh, a collision box and a fade test every frame. */
  hollow = false
): FloorRig {
  const group = new THREE.Group();
  group.position.set(originX, floorY, originZ);
  root.scene.add(group);
  const scene = group; // local alias so the geometry-building code below (unchanged from buildScene) can stay parented here instead of the root scene

  // One instance per maze cell, colored per-instance so vision.ts's
  // revealFloorCell() can brighten just that tile once explored/lit,
  // without touching the shared geometry/material — via InstancedMesh's
  // own instanceColor (setColorAt below), which three.js applies
  // automatically. No `vertexColors` flag on the material for this: that
  // flag is for a per-vertex geometry attribute this floor doesn't have,
  // and setting it anyway silently zeroed out the whole floor (see the
  // header comment's "Real bug" note) rather than doing nothing.
  const floorGeo = new THREE.PlaneGeometry(CELL, CELL);
  floorGeo.rotateX(-Math.PI / 2);
  const { map: floorMap, bumpMap: floorBumpMap } = buildFloorTextures(theme.floor);
  const look = FLOOR_LOOK[theme.floor];
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorMap,
    bumpMap: floorBumpMap,
    bumpScale: look.bump, // carpet has nowhere near a diamond-plate floor's specular relief — kept low so the point lights don't catch it as a shiny highlight
    roughness: look.rough, // matte carpet, not brushed metal
    metalness: look.metal, // carpet isn't metallic — near-zero rather than the old steel floor's 0.18
  });
  const floorTiles = new THREE.InstancedMesh(floorGeo, floorMat, cols * rows);
  floorTiles.userData.floor = true; // (shadows.ts: it receives shadows, never casts)
  const m = new THREE.Matrix4();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      m.setPosition(x * CELL, 0, y * CELL);
      floorTiles.setMatrixAt(i, m);
      floorTiles.setColorAt(i, UNEXPLORED_COLOR);
    }
  }
  floorTiles.instanceMatrix.needsUpdate = true;
  if (floorTiles.instanceColor) floorTiles.instanceColor.needsUpdate = true;
  floorTiles.userData.floorTiles = true;
  floorTiles.userData.structure = true; // the maze security protocol (takeover.ts) leaves the building's own fabric standing
  scene.add(floorTiles);

  // Light drywall-toned wall instead of the old dark industrial-steel grey —
  // an office building's walls are genuinely light-colored, they just read
  // dim under this scene's low ambient and only turn properly visible near
  // an actual light source (a fixture, the torch, an open doorway),
  // matching how an office looks at night lit only by security lighting
  // rather than making the whole maze uniformly bright.
  const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.92 });
  const caps: Array<{ x: number; z: number; sx: number; sz: number }> = [];
  const accentMats = theme.accents.map(
    (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.6 })
  );
  const wallGeo = new THREE.BoxGeometry(1, WALL_H, 1);
  const plaqueGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallBoxes: WallBox[] = [];
  const climbBoxes: WallBox[] = [];
  /** Every wall, for the trim bands that run along them (theme.bands). */
  const wallRuns: Array<{ x: number; z: number; len: number; horizontal: boolean }> = [];
  /** The cell each wall (in `caps` and `wallRuns` order) belongs to, for its hue. */
  const wallCells: number[] = [];
  const wallMeshes: THREE.Mesh[] = [];
  /** Each wall's height, in `wallRuns` order. */
  const wallHeights: number[] = [];
  const ledgeMat = new THREE.MeshStandardMaterial({ color: theme.cap, roughness: 0.6, metalness: 0.25 });
  /** The signage plaques on each wall (in `wallMeshes` order), which go with it when it fades. */
  const wallPlaques: THREE.Mesh[][] = [];
  // The floor's zones: patches of one hue (rooms get their own, game.ts's setZone), tinting the floor, the wall faces, their tops and their trim.
  // (Open air is one stretch of concrete, not patches of hue like a building's departments.)
  const zones = zoneField(cols, rows, theme.fence ? [0x9aa0a8] : theme.zones ?? ZONE_PALETTES[theme.edge.kind]);
  const wallMats = new Map<number, THREE.MeshStandardMaterial>();
  const wallMatFor = (hue: THREE.Color): THREE.MeshStandardMaterial => {
    const key = hue.getHex();
    let m = wallMats.get(key);
    if (!m) {
      m = texturedWall(wallMat.clone(), theme.edge.kind);
      m.color.set(theme.wall).lerp(hue, 0.24);
      wallMats.set(key, m);
    }
    return m;
  };

  // Real bug report ("odd colors showing up"), reproduced and diagnosed live
  // rather than guessed at: this used to recolor the ENTIRE wall panel on an
  // accent roll, which read fine as a rare "pocket of color" back when
  // corridors were short/twisty and walls were dark — but the corridor-bias
  // fix (longer straight runs, so a player looks straight down a hallway at
  // its far wall far more often) plus the office reskin's lighter wall base
  // color combined to make a torch-lit accent wall look like a jarring solid
  // block filling the whole frame, not the "hazard markings/signage" the
  // header comment always described. Confirmed live: dumping wall materials
  // found a single, correctly-placed, non-duplicated accent wall exactly
  // where a screen-filling blue panel was reported — a real legibility
  // issue, not a rendering bug (no overlapping meshes). Fixed by actually
  // building a small signage plaque (PLAQUE_W × PLAQUE_H) mounted on the
  // wall face instead of recoloring the wall itself — the wall mesh now
  // always uses the plain wallMat, and an accent roll adds a small emissive
  // plaque on both faces (so it reads whichever side the player approaches
  // from) instead.
  const PLAQUE_W = 1.4;
  const PLAQUE_H = 0.85;
  const PLAQUE_T = 0.05;
  const PLAQUE_Y = 1.6;

  function addWall(x1: number, z1: number, x2: number, z2: number): void {
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const len = Math.hypot(x2 - x1, z2 - z1) + WALL_T;
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const cell = Math.min(rows - 1, Math.max(0, Math.floor((midZ + CELL / 2) / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((midX + CELL / 2) / CELL)));
    const mesh = new THREE.Mesh(wallGeo, wallMatFor(zones[cell]!));
    wallMeshes.push(mesh);
    const plaques: THREE.Mesh[] = [];
    wallPlaques.push(plaques);
    mesh.userData.structure = true;
    mesh.userData.wall = true; // takeover.ts sinks and re-lays the walls
    const isTall = tall?.(x1, z1, x2, z2) === true;
    const height = isTall ? tallHeight : WALL_H;
    wallHeights.push(height);
    mesh.scale.set(horizontal ? len : WALL_T, height / WALL_H, horizontal ? WALL_T : len);
    mesh.position.set(midX, height / 2, midZ);
    scene.add(mesh);
    const hx = (horizontal ? len : WALL_T) / 2;
    const hz = (horizontal ? WALL_T : len) / 2;
    // A tall wall's shelf: the cap at an ordinary wall's height, widened to stand proud of the face, on a slab under it (it fades with the wall, as a plaque does).
    const pad = isTall ? LEDGE_OUT * 2 : 0.06;
    caps.push({ x: midX, z: midZ, sx: hx * 2 + (horizontal ? 0.06 : pad), sz: hz * 2 + (horizontal ? pad : 0.06) });
    if (isTall) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 1), ledgeMat);
      slab.scale.set(horizontal ? len : WALL_T + pad, 1, horizontal ? WALL_T + pad : len);
      slab.position.set(midX, WALL_H - 0.07, midZ);
      slab.userData.structure = true;
      slab.userData.trim = true;
      scene.add(slab);
      plaques.push(slab);
      // The second shelf, at the wall's top: a slab and a cap, as the first's (the cap here is a mesh of its own, the instanced caps being for the first). A storey-high wall has none.
      if (tallHeight >= WALL_H + 2) {
      const slab2 = slab.clone();
      slab2.position.y = TALL_WALL_H - 0.07;
      scene.add(slab2);
      plaques.push(slab2);
      const cap2 = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 1), new THREE.MeshStandardMaterial({ color: theme.cap, roughness: 0.5, metalness: 0.35 }));
      cap2.scale.set(horizontal ? len + 0.06 : WALL_T + pad, 1, horizontal ? WALL_T + pad : len + 0.06);
      cap2.position.set(midX, TALL_WALL_H + 0.035, midZ);
      cap2.userData.structure = true;
      cap2.userData.trim = true;
      scene.add(cap2);
      plaques.push(cap2);
      }
    }
    wallRuns.push({ x: midX, z: midZ, len, horizontal });
    wallCells.push(cell);
    // World-space, not local: player collision (player.ts's tick()) checks
    // wallBoxes against worldX/worldZ, so a wall built inside a Y-offset
    // floor Group still needs its collision box expressed in the same world
    // frame the player moves in — mesh positions above stay local (the
    // Group's own transform handles rendering them correctly).
    const box = { minX: originX + midX - hx, maxX: originX + midX + hx, minZ: originZ + midZ - hz, maxZ: originZ + midZ + hz };
    wallBoxes.push(isTall ? { ...box, h: height } : box);
    climbBoxes.push(isTall ? { ...box, high: true, ...(tallHeight < WALL_H + 2 ? { single: true } : {}) } : box);

    if (Math.random() < ACCENT_CHANCE) {
      const mat = accentMats[Math.floor(Math.random() * accentMats.length)]!;
      for (const side of [-1, 1]) {
        const plaque = new THREE.Mesh(plaqueGeo, mat);
        markBloom(plaque);
        plaque.userData.structure = true;
        plaque.userData.trim = true;
        if (horizontal) {
          plaque.scale.set(PLAQUE_W, PLAQUE_H, PLAQUE_T);
          plaque.position.set(midX, PLAQUE_Y, midZ + side * (WALL_T / 2 + PLAQUE_T / 2 + 0.01));
        } else {
          plaque.scale.set(PLAQUE_T, PLAQUE_H, PLAQUE_W);
          plaque.position.set(midX + side * (WALL_T / 2 + PLAQUE_T / 2 + 0.01), PLAQUE_Y, midZ);
        }
        scene.add(plaque);
        plaques.push(plaque);
      }
    }
  }

  // Open air: the boundary is a chain-link fence (a gate, if the way in is cut through it, is just left out).
  const fenced = theme.fence === true;
  const fence = fenced ? buildFence() : null;
  const addBoundary = (x1: number, z1: number, x2: number, z2: number): void => {
    if (!fence) return addWall(x1, z1, x2, z2);
    fence.add(scene, x1, z1, x2, z2);
    const hx = Math.abs(x2 - x1) / 2 + WALL_T / 2;
    const hz = Math.abs(z2 - z1) / 2 + WALL_T / 2;
    wallBoxes.push({ minX: originX + (x1 + x2) / 2 - hx, maxX: originX + (x1 + x2) / 2 + hx, minZ: originZ + (z1 + z2) / 2 - hz, maxZ: originZ + (z1 + z2) / 2 + hz, see: true });
  };
  const solidAt = (x: number, y: number): boolean => {
    const o = cells[y]?.[x];
    return !o || !(o.N || o.S || o.E || o.W);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y]![x]!;
      const wx = x * CELL;
      const wz = y * CELL;
      // (Between two solid cells there is nothing to wall; an edge with an open cell on one side is a wall, wherever it is added from.)
      const hideN = hollow && solidAt(x, y) && solidAt(x, y - 1);
      const hideW = hollow && solidAt(x, y) && solidAt(x - 1, y);
      const hideEdge = hollow && solidAt(x, y);
      if (!c.N && !hideN) (y === 0 || railing?.(x, y, 'N') ? addBoundary : addWall)(wx - CELL / 2, wz - CELL / 2, wx + CELL / 2, wz - CELL / 2);
      if (!c.W && !hideW) (x === 0 || railing?.(x, y, 'W') ? addBoundary : addWall)(wx - CELL / 2, wz - CELL / 2, wx - CELL / 2, wz + CELL / 2);
      if (!c.S && y === rows - 1 && !hideEdge) addBoundary(wx - CELL / 2, wz + CELL / 2, wx + CELL / 2, wz + CELL / 2);
      if (!c.E && x === cols - 1) addBoundary(wx + CELL / 2, wz - CELL / 2, wx + CELL / 2, wz + CELL / 2);
    }
  }

  // Wall-top trim: the top-down chase camera mostly sees wall tops, which
  // otherwise read as flat dark slabs — a slightly wider, lighter cap gives
  // every wall a crisp edge. One InstancedMesh for the whole floor.
  const capMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.07, 1),
    new THREE.MeshStandardMaterial({ color: theme.cap, roughness: 0.5, metalness: 0.35 }),
    caps.length
  );
  const bandMeshes: THREE.InstancedMesh[] = [];
  const bandSpecs: Array<NonNullable<typeof theme.bands>[number]> = [];
  const capMatrix = new THREE.Matrix4();
  caps.forEach((c, i) => {
    capMatrix.makeScale(c.sx, 1, c.sz);
    capMatrix.setPosition(c.x, WALL_H + 0.035, c.z);
    capMesh.setMatrixAt(i, capMatrix);
  });
  capMesh.instanceMatrix.needsUpdate = true;
  capMesh.userData.structure = true;
  capMesh.userData.trim = true;
  scene.add(capMesh);

  /** The wall tops and the trim take their cell's hue too (and the wall faces, which swap to that hue's material). */
  const capPaint = new THREE.Color();
  function paintWalls(): void {
    wallCells.forEach((cell, i) => {
      const hue = zones[cell]!;
      capPaint.set(0xffffff).lerp(hue, 0.85);
      capMesh.setColorAt(i, capPaint);
      for (const b of bandMeshes) b.setColorAt(i, capPaint);
      wallMeshes[i]!.material = wallMatFor(hue);
    });
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
    for (const b of bandMeshes) if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }

  // Trim along every wall, both faces: one InstancedMesh per band.
  for (const band of theme.bands ?? []) {
    const bandMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: band.color, roughness: band.metal ? 0.35 : 0.75, metalness: band.metal ? 0.7 : 0.05 }),
      wallRuns.length
    );
    const bm = new THREE.Matrix4();
    wallRuns.forEach((w, i) => {
      const thick = WALL_T + band.out * 2;
      bm.makeScale(w.horizontal ? w.len : thick, band.y1 - band.y0, w.horizontal ? thick : w.len);
      bm.setPosition(w.x, (band.y0 + band.y1) / 2, w.z);
      bandMesh.setMatrixAt(i, bm);
    });
    bandMesh.instanceMatrix.needsUpdate = true;
    bandMesh.userData.structure = true;
    bandMesh.userData.trim = true;
    scene.add(bandMesh);
    bandMeshes.push(bandMesh);
    bandSpecs.push(band);
  }
  paintWalls();

  // The edge of the level: a facade on the outside of the boundary walls and, on the ground floor, what stands round it (edge.ts).
  const relayoutEdge = buildEdge(group, {
    cols,
    rows,
    cell: CELL,
    wallH: WALL_H,
    wallT: WALL_T,
    style: theme.edge,
    ground: floorY === 0,
    // A fenced level has no facade to put on its boundary.
    walled: (x, y, dir) => !cells[y]![x]![dir] && !(fenced && ((dir === 'N' && y === 0) || (dir === 'W' && x === 0) || (dir === 'S' && y === rows - 1) || (dir === 'E' && x === cols - 1))),
    doorway,
  });

  // Corridor light fixtures — see the CORRIDOR_LIGHT_SPACING comment above.
  const fixtureGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const fixtures: Array<{ light: THREE.PointLight; mesh: THREE.Mesh }> = [];
  // (Open air has no ceiling to hang them from: the yard has its own floodlight masts.)
  for (let y = 0; y < rows; y += CORRIDOR_LIGHT_SPACING) {
    for (let x = 0; x < cols && !fenced; x += CORRIDOR_LIGHT_SPACING) {
      const fixturePos = new THREE.Vector3(x * CELL, WALL_H - 0.3, y * CELL);
      const light = new THREE.PointLight(theme.fixture, 38, 10);
      light.position.copy(fixturePos);
      scene.add(light);
      // Own material per fixture so effects.ts can flicker one without the rest.
      const fixture = new THREE.Mesh(fixtureGeo, new THREE.MeshStandardMaterial({ color: theme.fixture, emissive: theme.fixture, emissiveIntensity: 2.2 }));
      fixtures.push({ light, mesh: fixture });
      markBloom(fixture);
      fixture.position.copy(fixturePos);
      scene.add(fixture);
    }
  }

  // Walls in the way of the view (wallfade.ts): each ghosts out while the line from the camera to the agent passes through it, on a see-through copy of its material, with its cap, trim and
  // plaques put away while it's faint.
  const FADE_MARGIN = 0.1; // just enough that a wall the sight line skims by doesn't flicker
  const FADE_TO = 0.68; // how far a wall goes at most: 1 would be gone, this leaves it about a third solid (semi-transparent)
  const wallFades = new Float32Array(wallRuns.length);
  const ghostMats: Array<THREE.MeshStandardMaterial | null> = wallRuns.map(() => null);
  const tuckedAway = new Uint8Array(wallRuns.length);
  const wallBoxes3 = wallRuns.map((w, i) => wallBox(w.x, w.z, w.len, w.horizontal, WALL_T, wallHeights[i]!, FADE_MARGIN));
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  function tuck(i: number, away: boolean): void {
    if ((tuckedAway[i] === 1) === away) return;
    tuckedAway[i] = away ? 1 : 0;
    const w = wallRuns[i]!;
    const c = caps[i]!;
    const m = new THREE.Matrix4();
    if (away) capMesh.setMatrixAt(i, zeroMatrix);
    else capMesh.setMatrixAt(i, m.makeScale(c.sx, 1, c.sz).setPosition(c.x, WALL_H + 0.035, c.z));
    capMesh.instanceMatrix.needsUpdate = true;
    bandMeshes.forEach((bandMesh, k) => {
      const band = bandSpecs[k]!;
      const thick = WALL_T + band.out * 2;
      if (away) bandMesh.setMatrixAt(i, zeroMatrix);
      else bandMesh.setMatrixAt(i, m.makeScale(w.horizontal ? w.len : thick, band.y1 - band.y0, w.horizontal ? thick : w.len).setPosition(w.x, (band.y0 + band.y1) / 2, w.z));
      bandMesh.instanceMatrix.needsUpdate = true;
    });
    for (const plaque of wallPlaques[i]!) plaque.visible = !away;
  }
  const fadeWalls = (camera: THREE.Vector3, seen: readonly Vec3[] | null, dt: number, behind?: WallsBehind): void => {
    // Is the agent in view from here? Each wall is asked whether it stands in the way of any part of them (feet, hips, chest, head, either side); those that do ghost out.
    const cam = { x: camera.x - group.position.x, y: camera.y - group.position.y, z: camera.z - group.position.z };
    const local = seen?.map((p) => ({ x: p.x - group.position.x, y: p.y - group.position.y, z: p.z - group.position.z }));
    const inTheWay = local ? blocking(cam, local, wallBoxes3) : null;
    // The walls behind the agent, as the camera sees them: on its side of a line across the agent, near enough to matter.
    let pull: { x: number; z: number; dx: number; dz: number } | null = null;
    if (behind && local) {
      const px = behind.x - group.position.x;
      const pz = behind.z - group.position.z;
      const d = Math.hypot(cam.x - px, cam.z - pz);
      if (d > 0.01) pull = { x: px, z: pz, dx: (cam.x - px) / d, dz: (cam.z - pz) / d };
    }
    // How much each wall on the camera's side fades, from how near the agent is to it and how far toward the camera it lies: it follows their walking, not a switch.
    const nearSide = (i: number): number => {
      if (!pull || !behind) return 0;
      const w = wallRuns[i]!;
      const hl = w.len / 2;
      let most = 0;
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const x = w.x + (w.horizontal ? k * hl : 0);
        const z = w.z + (w.horizontal ? 0 : k * hl);
        const side = (x - pull.x) * pull.dx + (z - pull.z) * pull.dz;
        most = Math.max(most, behindFade(Math.hypot(x - pull.x, z - pull.z), side, behind.near ?? 2.5, behind.radius));
      }
      return most;
    };
    const fadeTo = pull && behind ? behind.to : FADE_TO;
    for (let i = 0; i < wallRuns.length; i++) {
      const goal = inTheWay?.[i] ? 1 : nearSide(i);
      if (wallFades[i] === goal && goal === 0) continue;
      wallFades[i] = stepFade(wallFades[i]!, goal, dt);
      const f = wallFades[i]!;
      const mesh = wallMeshes[i]!;
      if (f > 0) {
        let ghost = ghostMats[i];
        const base = wallMatFor(zones[wallCells[i]!]!);
        if (!ghost) {
          ghost = base.clone();
          ghost.transparent = true;
          ghostMats[i] = ghost;
        }
        ghost.color.copy(base.color);
        ghost.opacity = 1 - fadeTo * f;
        ghost.depthWrite = f < 0.35;
        mesh.material = ghost;
        tuck(i, f > 0.15);
      } else {
        mesh.material = wallMatFor(zones[wallCells[i]!]!);
        ghostMats[i]?.dispose();
        ghostMats[i] = null;
        tuck(i, false);
      }
    }
  };

  const wallFadeAt = (x: number, z: number): number => {
    for (let i = 0; i < wallRuns.length; i++) {
      const w = wallRuns[i]!;
      const hl = w.len / 2 + 0.15;
      if (w.horizontal ? Math.abs(z - w.z) <= 0.4 && Math.abs(x - w.x) <= hl : Math.abs(x - w.x) <= 0.4 && Math.abs(z - w.z) <= hl) return wallFades[i]!;
    }
    return 0;
  };

  const setZone = (cells: ReadonlyArray<{ x: number; y: number }>, hue: number): void => {
    for (const c of cells) zones[c.y * cols + c.x]?.set(hue);
    paintWalls();
  };
  tagMeshes(group);
  return { group, theme, decor: new Map(), fixtures, wallBoxes, climbBoxes, floorTiles, cols, rows, relayoutEdge, zones, setZone, fadeWalls, wallFadeAt };
}

/** Sets one cell's floor tile to `color` — used for both the dim "explored" memory tier and the bright "currently lit" tier (see vision.ts). */
export function revealFloorCell(floor: FloorRig, x: number, y: number, color: THREE.Color = EXPLORED_COLOR): void {
  const i = y * floor.cols + x;
  const hue = floor.zones[i];
  if (hue) color = zoned(color, hue);
  floor.floorTiles.setColorAt(i, color);
  if (floor.floorTiles.instanceColor) floor.floorTiles.instanceColor.needsUpdate = true;
  const decor = floor.decor.get(i);
  if (decor) for (const apply of decor) apply(color);
}

const CAUGHT_FLASH_MS = 900;

/** Briefly floods the scene with light — the "you've been spotted" dramatic beat, then restores normal levels. Lighting is shared across every floor (SceneRoot), so this affects the whole building at once, not just the player's current floor. */
export function flashCaughtLights(root: SceneRoot): void {
  const baseAmbient = root.ambientLight.intensity;
  const baseSun = root.sunLight.intensity;
  root.ambientLight.intensity = 3.4;
  root.sunLight.intensity = 2.6;
  window.setTimeout(() => {
    root.ambientLight.intensity = baseAmbient;
    root.sunLight.intensity = baseSun;
  }, CAUGHT_FLASH_MS);
}

export function handleResize(root: SceneRoot): void {
  root.camera.aspect = window.innerWidth / window.innerHeight;
  root.camera.updateProjectionMatrix();
  root.renderer.setSize(window.innerWidth, window.innerHeight);
  resizePostFX(root.postfx, window.innerWidth, window.innerHeight);
}
