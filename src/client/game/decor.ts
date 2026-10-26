// Environment dressing that makes corridors read as places rather than
// identical grey tubes, all procedural (canvas textures + primitives):
//
// - Floor markings: safety tape along straight corridors, emergency-route
//   chevrons at junctions pointing toward the way out (the exit on the
//   ground floor, the stairs down upstairs), hazard stripes at security
//   doors and laser traps, stencilled room labels at doorways, and a
//   distinct floor mat inside each room.
// - Clutter against corridor walls (plants, bins, boxes), with small
//   colliders so they're solid.
// - Windows on some outer walls: a night-city view, with a pale moonlight
//   patch on the floor beneath.
//
// Everything painted on the floor registers with the cell it sits on
// (FloorRig.decor), so scene.ts's revealFloorCell() tints it exactly like
// the tile under it — markings never give the layout away through fog.
// Clutter and windows are lit geometry like the walls, so they follow the
// same "only visible when lit" rule the walls already do.

import * as THREE from 'three';
import { CELL, WALL_T, type FloorRig, type WallBox } from './scene';
import { bfs, type MazeCells } from './maze';
import { DIR_DELTA, KEY_COLORS, keyLabel, type Dir, type Door, type Room } from './security';

const MARK_Y = 0.012;
const CLUTTER_CHANCE = 0.16;
const WINDOW_CHANCE = 0.22;
const MAX_WINDOWS = 14;
const ROUTE_GREEN = 0x3ecf6a;
const DIRS: Dir[] = ['N', 'S', 'E', 'W'];
const UNSEEN = new THREE.Color(0x020304);

type Cell = { x: number; y: number };

function openDirs(cells: MazeCells, cols: number, rows: number, x: number, y: number): Dir[] {
  return DIRS.filter((d) => {
    if (!cells[y]![x]![d]) return false;
    const nx = x + DIR_DELTA[d][0];
    const ny = y + DIR_DELTA[d][1];
    return nx >= 0 && nx < cols && ny >= 0 && ny < rows;
  });
}

// Yaw that turns local +Z toward `d` (Three.js rotation.y maps +Z to (sin a, cos a)).
const YAW: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

function register(rig: FloorRig, x: number, y: number, apply: (c: THREE.Color) => void): void {
  const i = y * rig.cols + x;
  const list = rig.decor.get(i);
  if (list) list.push(apply);
  else rig.decor.set(i, [apply]);
  apply(UNSEEN);
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function flatPlane(w: number, d: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** An instanced floor decal whose per-instance colour follows the fog tint of the cell it sits on. */
function decalLayer(rig: FloorRig, geo: THREE.BufferGeometry, mat: THREE.Material, items: Array<{ cell: Cell; x: number; z: number; yaw: number }>): void {
  if (items.length === 0) return;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.yaw);
    m.compose(new THREE.Vector3(it.x, MARK_Y, it.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    register(rig, it.cell.x, it.cell.y, (c) => {
      mesh.setColorAt(i, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 1;
  rig.group.add(mesh);
}

function decalMaterial(map: THREE.Texture | null, color: number, transparent = true): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map,
    transparent,
    alphaTest: transparent ? 0.3 : 0,
    roughness: 0.7,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

const chevronTexture = (label: string): THREE.CanvasTexture =>
  canvasTexture(128, 192, (ctx) => {
    ctx.fillStyle = '#ffffff';
    for (const y0 of [24, 64]) {
      ctx.beginPath();
      ctx.moveTo(64, y0);
      ctx.lineTo(112, y0 + 36);
      ctx.lineTo(96, y0 + 46);
      ctx.lineTo(64, y0 + 22);
      ctx.lineTo(32, y0 + 46);
      ctx.lineTo(16, y0 + 36);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 64, 160);
  });

const hazardTexture = (): THREE.CanvasTexture => {
  const t = canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e8b422';
    for (let x = -64; x < 256 + 64; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x + 16, 64);
      ctx.lineTo(x + 16 + 64, 0);
      ctx.lineTo(x + 64, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
  return t;
};

const stencilCache = new Map<string, THREE.CanvasTexture>();
function stencilTexture(text: string): THREE.CanvasTexture {
  let t = stencilCache.get(text);
  if (!t) {
    t = canvasTexture(256, 64, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 34);
    });
    stencilCache.set(text, t);
  }
  return t;
}

const cityTexture = (): THREE.CanvasTexture =>
  canvasTexture(256, 160, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 160);
    sky.addColorStop(0, '#060a16');
    sky.addColorStop(1, '#14203a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 256, 160);
    // Distant towers: dark blocks with a scatter of lit windows.
    for (let i = 0; i < 14; i++) {
      const w = 12 + Math.random() * 26;
      const h = 40 + Math.random() * 100;
      const x = Math.random() * 256;
      ctx.fillStyle = '#0a1020';
      ctx.fillRect(x, 160 - h, w, h);
      for (let wy = 160 - h + 4; wy < 156; wy += 7) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (Math.random() < 0.3) {
            ctx.fillStyle = Math.random() < 0.7 ? '#ffd58a' : '#9fd4ff';
            ctx.fillRect(wx, wy, 2, 3);
          }
        }
      }
    }
    // A low moon.
    const moon = ctx.createRadialGradient(200, 30, 2, 200, 30, 26);
    moon.addColorStop(0, 'rgba(230,238,255,0.95)');
    moon.addColorStop(0.35, 'rgba(200,215,255,0.35)');
    moon.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = moon;
    ctx.fillRect(160, 0, 80, 70);
  });

const ROOM_MAT: Record<Room['kind'], number> = {
  terminal: 0x4b3a2e,
  office: 0x4b3a2e,
  server: 0x1d2126,
  rack: 0x1d2126,
  storage: 0x3a3f36,
  uplink: 0x1d2126,
  logs: 0x1d2126,
  conference: 0x5a4632,
  cafeteria: 0x6e6a60,
  gallery: 0x5a4a3c,
  exhibit: 0x4a4038,
  boiler: 0x33302c,
  control: 0x2b3036,
  teller: 0x3d2c22,
  deposit: 0x2d3238,
  shelving: 0x3a4a5a,
  dock: 0x3a3f44,
  bench: 0x4a5a62,
  specimen: 0x2a3a40,
};

const ROOM_LABEL: Record<Room['kind'], string> = {
  terminal: 'TERMINAL',
  server: 'SERVER',
  storage: 'RECORDS',
  uplink: 'NETWORK',
  logs: 'LOGS',
  office: 'OFFICE',
  conference: 'CONF',
  cafeteria: 'CAFE',
  rack: 'RACKS',
  gallery: 'GALLERY',
  exhibit: 'EXHIBIT',
  boiler: 'BOILERS',
  control: 'CONTROL',
  teller: 'TELLERS',
  deposit: 'DEPOSIT',
  shelving: 'RACKING',
  dock: 'LOADING',
  bench: 'LAB',
  specimen: 'SPECIMENS',
};

export type DecorInput = {
  rig: FloorRig;
  cells: MazeCells;
  cols: number;
  rows: number;
  /** Cells already holding content (items, rooms, doors, stairs…) — no clutter or windows there. */
  used: Set<string>;
  doors: Door[];
  rooms: Room[];
  lasers: Array<{ x: number; y: number; spanX: boolean }>;
  /** Where emergency-route arrows lead: the exit, or the stair landing on upper floors. */
  routeTarget: Cell;
  routeLabel: string;
  /** Cells holding a lift (elevator.ts): no markings, clutter or windows there, like a room. */
  lifts?: Cell[];
  /** A hall that dresses itself (the tower's): no tape, chevrons, hazard stripes, windows or clutter. */
  plain?: boolean;
};

/** A piece of corridor clutter (a plant, bin or boxes) — a stun shot knocks it over as a lure. */
export type ClutterProp = { group: THREE.Group; box: WallBox; x: number; z: number };

/** Dresses one floor. Returns the clutter it placed, each with its floor-local collider. */
export function decorateFloor(input: DecorInput): ClutterProp[] {
  if (input.plain) return [];
  const { rig, cells, cols, rows, used, doors, rooms, lasers } = input;
  const key = (x: number, y: number): string => `${x},${y}`;
  const roomCells = new Set<string>();
  for (const r of rooms) for (const c of r.cells) roomCells.add(key(c.x, c.y));
  for (const c of input.lifts ?? []) roomCells.add(key(c.x, c.y));

  // Safety tape along straight corridors.
  const tapeItems: Array<{ cell: Cell; x: number; z: number; yaw: number }> = [];
  const inset = CELL / 2 - WALL_T / 2 - 0.22;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (roomCells.has(key(x, y))) continue;
      const open = openDirs(cells, cols, rows, x, y);
      const ns = open.length === 2 && open.includes('N') && open.includes('S');
      const ew = open.length === 2 && open.includes('E') && open.includes('W');
      if (!ns && !ew) continue;
      for (const side of [-1, 1]) {
        tapeItems.push({
          cell: { x, y },
          x: x * CELL + (ns ? side * inset : 0),
          z: y * CELL + (ew ? side * inset : 0),
          yaw: ns ? 0 : Math.PI / 2,
        });
      }
    }
  }
  decalLayer(rig, flatPlane(0.08, CELL), decalMaterial(null, rig.theme.marking, false), tapeItems);

  // Emergency-route chevrons at junctions, pointing one step closer to the way out.
  const toTarget = bfs(cells, cols, rows, input.routeTarget.x, input.routeTarget.y);
  const chevrons: Array<{ cell: Cell; x: number; z: number; yaw: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (roomCells.has(key(x, y))) continue;
      const open = openDirs(cells, cols, rows, x, y);
      if (open.length < 3 || toTarget[y]![x]! <= 0) continue;
      const step = open.find((d) => toTarget[y + DIR_DELTA[d][1]]![x + DIR_DELTA[d][0]]! === toTarget[y]![x]! - 1);
      if (!step) continue;
      chevrons.push({ cell: { x, y }, x: x * CELL + DIR_DELTA[step][0] * 0.9, z: y * CELL + DIR_DELTA[step][1] * 0.9, yaw: YAW[step] + Math.PI });
    }
  }
  decalLayer(rig, flatPlane(0.9, 1.35), decalMaterial(chevronTexture(input.routeLabel), ROUTE_GREEN), chevrons);

  // Hazard stripes either side of every security door and across laser traps.
  const hazard: Array<{ cell: Cell; x: number; z: number; yaw: number }> = [];
  for (const d of doors) {
    const [dx, dz] = DIR_DELTA[d.dir];
    for (const side of [-0.55, 0.55]) {
      const cell = side < 0 ? { x: d.x, y: d.y } : { x: d.x + dx, y: d.y + dz };
      hazard.push({ cell, x: d.x * CELL + dx * (CELL / 2 + side), z: d.y * CELL + dz * (CELL / 2 + side), yaw: dz !== 0 ? 0 : Math.PI / 2 });
    }
  }
  for (const t of lasers) {
    // spanX: the corridor runs N-S and the beam spans X.
    for (const side of [-1.1, 1.1]) {
      hazard.push({ cell: { x: t.x, y: t.y }, x: t.x * CELL + (t.spanX ? 0 : side), z: t.y * CELL + (t.spanX ? side : 0), yaw: t.spanX ? 0 : Math.PI / 2 });
    }
  }
  const hazardGeo = flatPlane(CELL - WALL_T - 0.1, 0.5);
  decalLayer(rig, hazardGeo, decalMaterial(hazardTexture(), 0xffffff, false), hazard);

  // Rooms: a floor mat over each room cell, and a stencilled label just inside the doorway.
  for (const r of rooms) {
    const matMaterial = decalMaterial(null, ROOM_MAT[r.kind], false);
    for (const c of r.cells) {
      decalLayer(rig, flatPlane(CELL - WALL_T - 0.3, CELL - WALL_T - 0.3), matMaterial, [{ cell: c, x: c.x * CELL, z: c.y * CELL, yaw: 0 }]);
    }
    const mouth = r.cells[r.cells.length - 1]!;
    const [odx, odz] = DIR_DELTA[r.openDir];
    const text = r.keyId === null ? ROOM_LABEL[r.kind] : `${ROOM_LABEL[r.kind]} ${keyLabel(r.keyId)}`;
    const color = r.keyId === null ? rig.theme.marking : KEY_COLORS[r.keyId]!;
    decalLayer(rig, flatPlane(1.7, 0.42), decalMaterial(stencilTexture(text), color), [
      // Reads upright to someone walking in: the text's top points into the room.
      { cell: mouth, x: mouth.x * CELL + odx * 1.05, z: mouth.y * CELL + odz * 1.05, yaw: YAW[r.openDir] },
    ]);
  }

  // Clutter against the closed walls of plain corridor cells.
  const props: ClutterProp[] = [];
  const potMat = new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a4a, roughness: 0.8 });
  const binMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.3 });
  const cardMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
  const againstWall = CELL / 2 - WALL_T / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = key(x, y);
      if (used.has(k) || roomCells.has(k) || Math.random() > CLUTTER_CHANCE) continue;
      const open = openDirs(cells, cols, rows, x, y);
      if (open.length !== 2) continue;
      const closed = DIRS.filter((d) => !open.includes(d));
      const wall = closed[Math.floor(Math.random() * closed.length)]!;
      const [wx, wz] = DIR_DELTA[wall];
      const along = (Math.random() - 0.5) * 1.8;
      const kind = Math.floor(Math.random() * 3);
      const half = kind === 2 ? 0.3 : 0.24;
      const px = x * CELL + wx * (againstWall - half - 0.04) + (wz !== 0 ? along : 0);
      const pz = y * CELL + wz * (againstWall - half - 0.04) + (wx !== 0 ? along : 0);
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      if (kind === 0) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 10), potMat);
        pot.position.y = 0.21;
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 0), leafMat);
        leaves.position.y = 0.78;
        leaves.rotation.y = Math.random() * Math.PI;
        g.add(pot, leaves);
      } else if (kind === 1) {
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.62, 12), binMat);
        bin.position.y = 0.31;
        g.add(bin);
      } else {
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.5), cardMat);
        a.position.y = 0.2;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.4), cardMat);
        b.position.set(0.04, 0.56, -0.02);
        b.rotation.y = 0.3;
        g.add(a, b);
      }
      rig.group.add(g);
      props.push({ group: g, box: { minX: px - half, maxX: px + half, minZ: pz - half, maxZ: pz + half, cover: 'low' }, x: px, z: pz });
    }
  }

  // Windows on outer walls, with moonlight on the floor beneath.
  const city = cityTexture();
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1222, emissive: 0xffffff, emissiveMap: city, emissiveIntensity: 0.85, roughness: 0.15, metalness: 0.6 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.4 });
  const moonMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  let windows = 0;
  const edge: Array<{ x: number; y: number; d: Dir }> = [];
  for (let x = 0; x < cols; x++) edge.push({ x, y: 0, d: 'N' }, { x, y: rows - 1, d: 'S' });
  for (let y = 0; y < rows; y++) edge.push({ x: 0, y, d: 'W' }, { x: cols - 1, y, d: 'E' });
  for (const e of edge) {
    if (windows >= MAX_WINDOWS || Math.random() > WINDOW_CHANCE) continue;
    if (roomCells.has(key(e.x, e.y)) || cells[e.y]![e.x]![e.d]) continue; // rooms keep their back wall; skip any opening (the stair landing)
    const [dx, dz] = DIR_DELTA[e.d];
    const g = new THREE.Group();
    g.position.set(e.x * CELL + dx * (CELL / 2 - WALL_T / 2 - 0.02), 0, e.y * CELL + dz * (CELL / 2 - WALL_T / 2 - 0.02));
    g.rotation.y = YAW[e.d] + Math.PI; // face into the room
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4), glassMat);
    pane.position.set(0, 1.75, 0.01);
    g.add(pane);
    for (const [w, h, fx, fy] of [
      [2.46, 0.08, 0, 2.49],
      [2.46, 0.08, 0, 1.01],
      [0.08, 1.46, -1.19, 1.75],
      [0.08, 1.46, 1.19, 1.75],
      [0.05, 1.4, 0, 1.75],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), frameMat);
      bar.position.set(fx, fy, 0.03);
      g.add(bar);
    }
    rig.group.add(g);
    // Moonlight falling through the window onto the floor, fading with fog like other markings.
    const patch = new THREE.Mesh(flatPlane(2.0, 1.4), moonMat.clone());
    patch.position.set(e.x * CELL - dx * 0.35, MARK_Y + 0.002, e.y * CELL - dz * 0.35);
    patch.rotation.y = YAW[e.d];
    patch.renderOrder = 2;
    rig.group.add(patch);
    const patchMat = patch.material as THREE.MeshBasicMaterial;
    const base = new THREE.Color(0x9fb8ff);
    register(rig, e.x, e.y, (c) => {
      patchMat.color.copy(base).multiply(c);
    });
    windows++;
  }

  return props;
}
