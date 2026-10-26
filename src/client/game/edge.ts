// The edge of a level: what stands round the outside of the maze, so the
// boundary isn't a plain wall and then black. Each location has its own: a
// facade on the outside of the boundary walls (columns and lit windows, steel
// ribbing and pipes, masonry and brass, a glass curtain wall); on the ground
// floor, the ground beyond it with lamp posts standing in pools of light; and,
// far off, a skyline of what's round the building (a city's towers, a tank
// farm and its flare stack, the museum's dome and trees).
//
// All primitives and canvas textures, batched into instanced meshes, and none
// of it lights anything (lamps are glowing bulbs and additive pools, not point
// lights: the scene has a budget for those, lightbudget.ts). Nothing here goes
// nearer than the boundary wall's outside face plus the facade's depth, and
// nothing tall stands within reach of the chase camera, which sits about 8 m up
// and 8 m back, so it can't block the view or be clipped into.

import * as THREE from 'three';
import { markBloom } from './postfx';

export type EdgeKind = 'campus' | 'museum' | 'refinery' | 'bank' | 'warehouse' | 'lab';

/** How a floor's edge looks: which treatment, the ground's colour, the lamps' colour, and the colour of lit windows on the skyline. */
export type EdgeStyle = { kind: EdgeKind; ground: number; lamp: number; windows: number };

export type EdgeSpec = {
  cols: number;
  rows: number;
  cell: number;
  wallH: number;
  wallT: number;
  style: EdgeStyle;
  /** The ground floor also gets the ground, lamps and skyline; an upper floor only the facade. */
  ground: boolean;
  /** Whether cell (x, y)'s wall on side `dir` is there (so the facade doesn't cover a gap in it). */
  walled: (x: number, y: number, dir: 'N' | 'S' | 'E' | 'W') => boolean;
  /** A doorway in the outer wall (ways.ts): the long rails and pipes of the facade are cut where it is, so they don't run across the doors. */
  doorway?: { dir: 'N' | 'S' | 'E' | 'W'; cell: number } | undefined;
};

type Side = { dir: 'N' | 'S' | 'E' | 'W' };

const unit = new THREE.BoxGeometry(1, 1, 1);

/** Collects boxes of one material and makes them one InstancedMesh. */
class Batch {
  private readonly items: THREE.Matrix4[] = [];
  constructor(
    private readonly geo: THREE.BufferGeometry,
    readonly mat: THREE.Material
  ) {}
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): void {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz));
    this.items.push(m);
  }
  build(parent: THREE.Object3D, bloom = false): void {
    if (!this.items.length) return;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    this.items.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.userData.structure = true; // the building's own fabric: the takeover leaves it standing
    if (bloom) markBloom(mesh);
    parent.add(mesh);
  }
}

const std = (color: number, o: { rough?: number; metal?: number; emissive?: number; glow?: number } = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.05, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.glow ?? 0 });

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Lit windows on a dark facade, for the skyline. */
function windowTexture(lit: number, density: number): THREE.CanvasTexture {
  const css = `#${lit.toString(16).padStart(6, '0')}`;
  return canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 8) {
      for (let x = 4; x < 60; x += 8) {
        if (Math.random() > density) continue;
        ctx.fillStyle = css;
        ctx.globalAlpha = 0.45 + Math.random() * 0.55;
        ctx.fillRect(x, y, 4, 5);
      }
    }
    ctx.globalAlpha = 1;
  });
}

/** The ground beyond the walls: slabs, lines painted on it, or gravel, by location. */
function groundTexture(kind: EdgeKind, base: number): THREE.CanvasTexture {
  const css = (c: number, k = 1): string => {
    const r = Math.round(((c >> 16) & 255) * k);
    const g = Math.round(((c >> 8) & 255) * k);
    const b = Math.round((c & 255) * k);
    return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
  };
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, 256, 256);
    if (kind === 'museum' || kind === 'bank' || kind === 'lab') {
      // Paving slabs, a couple of tones.
      const s = kind === 'museum' ? 64 : 128;
      for (let y = 0; y < 256; y += s) {
        for (let x = 0; x < 256; x += s) {
          ctx.fillStyle = css(base, 0.9 + Math.random() * 0.22);
          ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        }
      }
    } else {
      // Tarmac or gravel: grain, and a painted line.
      for (let i = 0; i < 1800; i++) {
        ctx.fillStyle = css(base, 0.78 + Math.random() * 0.5);
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
      }
      ctx.fillStyle = kind === 'refinery' || kind === 'warehouse' ? '#c2b13a' : '#c9c9c0';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 124, 256, 4);
      ctx.globalAlpha = 1;
    }
  });
}

const SIDES: Side[] = [{ dir: 'N' }, { dir: 'S' }, { dir: 'W' }, { dir: 'E' }];

/** Builds the edge into `group`, floor-local like the rest of the floor. */
export function buildEdge(group: THREE.Group, spec: EdgeSpec): ((extra: Rect[]) => void) | null {
  const { cols, rows, cell, wallH, wallT, style } = spec;
  const W = (cols - 1) * cell; // centre-to-centre span across x
  const D = (rows - 1) * cell;
  const half = cell / 2;
  const out = wallT / 2;

  // --- the facade, on the outside of the boundary walls ---
  const stone = new Batch(unit, std(style.kind === 'lab' ? 0xe4eef2 : 0xcfc7b8, { rough: 0.7 }));
  const brass = new Batch(unit, std(0xb08d4a, { rough: 0.35, metal: 0.7 }));
  const dark = new Batch(unit, std(0x2a2d31, { rough: 0.7, metal: 0.3 }));
  const steel = new Batch(unit, std(0x6b7277, { rough: 0.55, metal: 0.5 }));
  const orange = new Batch(unit, std(0xc26a1a, { rough: 0.6, metal: 0.3 }));
  const hazard = new Batch(unit, std(0xc2b13a, { rough: 0.7 }));
  const glowWarm = new Batch(unit, std(0x2a1c10, { emissive: 0xffc98a, glow: 0.3 }));
  const glowAmber = new Batch(unit, std(0x2a1a0a, { emissive: 0xffb04a, glow: 0.8 }));
  const glowGlass = new Batch(unit, std(0x0d1a1c, { emissive: 0x6fd6f0, glow: 0.22, rough: 0.2, metal: 0.5 }));

  for (const side of SIDES) {
    const horizontal = side.dir === 'N' || side.dir === 'S';
    const count = horizontal ? cols : rows;
    const length = count * cell;
    // The side's centre line and outward direction, in floor-local metres.
    const nx = side.dir === 'E' ? 1 : side.dir === 'W' ? -1 : 0;
    const nz = side.dir === 'S' ? 1 : side.dir === 'N' ? -1 : 0;
    const base = horizontal ? (side.dir === 'N' ? -half : D + half) : side.dir === 'W' ? -half : W + half;
    const alongStart = -half;
    /** A box at `a` along the side, height `y`, `d` out from the wall's face; sizes along, up, out. */
    const door = spec.doorway && spec.doorway.dir === side.dir ? { from: spec.doorway.cell * cell + half - 1.1, to: spec.doorway.cell * cell + half + 1.1 } : null;
    const emit = (b: Batch, a: number, y: number, d: number, sa: number, sy: number, sd: number): void => {
      const along = alongStart + a;
      const off = base + (horizontal ? nz : nx) * (out + d);
      if (horizontal) b.add(along, y, off, sa, sy, sd);
      else b.add(off, y, along, sd, sy, sa);
    };
    const put = (b: Batch, a: number, y: number, d: number, sa: number, sy: number, sd: number): void => {
      // Anything low enough to cross a doorway is cut where the doorway is.
      if (door && y - sy / 2 < 2.7 && a - sa / 2 < door.to && a + sa / 2 > door.from) {
        const lo = a - sa / 2;
        const hi = a + sa / 2;
        if (lo < door.from) emit(b, (lo + door.from) / 2, y, d, door.from - lo, sy, sd);
        if (hi > door.to) emit(b, (door.to + hi) / 2, y, d, hi - door.to, sy, sd);
        return;
      }
      emit(b, a, y, d, sa, sy, sd);
    };
    const cellAt = (i: number): { x: number; y: number } => (horizontal ? { x: i, y: side.dir === 'N' ? 0 : rows - 1 } : { x: side.dir === 'W' ? 0 : cols - 1, y: i });
    const solid = (i: number): boolean => {
      const c = cellAt(i);
      return spec.walled(c.x, c.y, side.dir);
    };

    if (style.kind === 'museum') {
      put(stone, length / 2, wallH + 0.14, 0.3, length + 0.6, 0.28, 0.75); // a cornice along the top
      put(stone, length / 2, 0.16, 0.2, length + 0.4, 0.32, 0.5); // and a plinth along the foot
      for (let i = 0; i <= count; i++) {
        put(stone, i * cell, wallH / 2, 0.16, 0.55, wallH, 0.32); // pilasters between the bays
        put(stone, i * cell, 0.42, 0.22, 0.78, 0.2, 0.44);
        put(stone, i * cell, wallH - 0.18, 0.22, 0.78, 0.22, 0.44);
      }
      for (let i = 0; i < count; i++) {
        if (!solid(i)) continue;
        put(glowWarm, i * cell + half, 1.75, 0.03, 1.4, 1.9, 0.05); // a lit window in each bay
        put(brass, i * cell + half, 2.75, 0.06, 1.55, 0.07, 0.08);
        put(brass, i * cell + half, 0.78, 0.06, 1.55, 0.07, 0.08);
      }
    } else if (style.kind === 'refinery') {
      put(hazard, length / 2, 0.18, 0.05, length, 0.36, 0.06); // hazard band at the foot
      put(dark, length / 2, wallH + 0.06, 0.1, length + 0.3, 0.14, 0.4); // a dark coping
      for (let a = 0.35; a < length; a += 0.7) put(steel, a, wallH / 2, 0.07, 0.11, wallH, 0.14); // corrugated ribs
      put(steel, length / 2, 2.3, 0.42, length, 0.24, 0.24); // a pipe run,
      put(orange, length / 2, 1.05, 0.42, length, 0.2, 0.2); // and another
      for (let i = 0; i <= count; i++) {
        put(dark, i * cell, 1.65, 0.36, 0.14, 2.7, 0.1); // its supports
      }
      for (let i = 0; i < count; i += 2) put(glowAmber, i * cell + half, 2.72, 0.08, 0.5, 0.1, 0.06); // vent lamps
    } else if (style.kind === 'warehouse') {
      put(dark, length / 2, wallH + 0.08, 0.12, length + 0.3, 0.16, 0.4); // a dark eave
      for (let a = 0.3; a < length; a += 0.6) put(steel, a, wallH / 2, 0.05, 0.08, wallH, 0.1); // sheet ribs
      put(hazard, length / 2, 0.16, 0.06, length, 0.32, 0.07); // a safety-yellow kerb
      for (let i = 0; i < count; i++) {
        if (!solid(i)) continue;
        if (i % 3 === 1) {
          put(dark, i * cell + half, 1.25, 0.1, cell - 0.5, 2.5, 0.12); // a roller door,
          put(hazard, i * cell + half, 2.6, 0.17, cell - 0.4, 0.12, 0.08); // its hazard header
          put(glowAmber, i * cell + half, 2.9, 0.2, 0.4, 0.12, 0.06); // and a bay lamp above it
        } else put(glowWarm, i * cell + half, 2.45, 0.04, 1.1, 0.28, 0.05); // a clerestory slot
      }
    } else if (style.kind === 'lab') {
      put(stone, length / 2, wallH + 0.1, 0.14, length + 0.3, 0.2, 0.34); // a pale parapet
      put(stone, length / 2, 0.12, 0.1, length, 0.24, 0.2); // and a plinth
      for (let i = 0; i < count; i++) if (solid(i)) put(glowGlass, i * cell + half, 1.6, 0.04, cell - 0.18, 2.3, 0.05); // continuous glazing
      for (let i = 0; i <= count; i++) put(stone, i * cell, wallH / 2, 0.08, 0.1, wallH, 0.14); // white frames
      put(stone, length / 2, 1.0, 0.08, length, 0.07, 0.14);
    } else if (style.kind === 'bank') {
      for (const y of [0.5, 1.0, 1.5, 2.0, 2.5]) put(dark, length / 2, y, 0.02, length, 0.05, 0.03); // masonry courses
      put(brass, length / 2, wallH - 0.2, 0.08, length, 0.24, 0.12); // a brass fascia
      put(stone, length / 2, wallH + 0.14, 0.3, length + 0.5, 0.28, 0.7); // cornice
      for (let i = 0; i <= count; i += 2) {
        put(stone, i * cell, wallH / 2 + 0.1, 0.24, 0.7, wallH + 0.2, 0.5); // pillars
        put(brass, i * cell, 0.14, 0.26, 0.9, 0.28, 0.62);
        put(brass, i * cell, wallH + 0.04, 0.26, 0.9, 0.28, 0.62);
      }
      for (let i = 0; i < count; i++) {
        if (!solid(i) || i % 2 === 1) continue;
        put(glowAmber, i * cell + cell, 1.7, 0.03, 0.85, 1.7, 0.05); // narrow lit windows between the pillars
      }
    } else {
      // campus: a glass curtain wall.
      put(dark, length / 2, wallH + 0.1, 0.16, length + 0.3, 0.2, 0.4);
      for (let i = 0; i < count; i++) {
        if (solid(i)) put(glowGlass, i * cell + half, 1.75, 0.03, cell - 0.25, 2.2, 0.04);
      }
      for (let a = 0; a <= length; a += 1) put(dark, a, wallH / 2, 0.06, 0.06, wallH, 0.09); // mullions
      put(dark, length / 2, 2.9, 0.06, length, 0.06, 0.09);
      put(dark, length / 2, 0.6, 0.06, length, 0.06, 0.09);
    }
  }
  for (const b of [stone, brass, dark, steel, orange, hazard]) b.build(group);
  for (const b of [glowWarm, glowAmber, glowGlass]) b.build(group, true);

  if (!spec.ground) return null;

  // The ground, the lamps and the skyline live in a group of their own, so a second floor that reaches out past this one can have them
  // laid out again round both (the returned function).
  let outer = buildOuter(group, spec, []);
  return (extra) => {
    group.remove(outer);
    outer.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose();
    });
    outer = buildOuter(group, spec, extra);
  };
}

/** A rectangle on the floor-local ground (metres), where something else stands: another floor's footprint. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Lays the edge out again once the rest of the building is known: `extra` are the footprints of floors that reach past this one. */
export type Relayout = (extra: Rect[]) => void;

/** The ground beyond the walls, the lamp posts and the skyline, round this floor and any `extra` footprints. */
function buildOuter(group: THREE.Group, spec: EdgeSpec, extra: readonly Rect[]): THREE.Group {
  const outerGroup = new THREE.Group();
  outerGroup.userData.structure = true;
  group.add(outerGroup);
  const { cols, rows, cell, wallT, style } = spec;
  const W = (cols - 1) * cell;
  const D = (rows - 1) * cell;
  const half = cell / 2;
  const out = wallT / 2;
  // Everything the outside has to clear: this floor, and wherever another one spreads to.
  const bounds = { minX: -half, maxX: W + half, minZ: -half, maxZ: D + half };
  for (const r of extra) {
    bounds.minX = Math.min(bounds.minX, r.minX);
    bounds.maxX = Math.max(bounds.maxX, r.maxX);
    bounds.minZ = Math.min(bounds.minZ, r.minZ);
    bounds.maxZ = Math.max(bounds.maxZ, r.maxZ);
  }
  const inExtra = (x: number, z: number, pad: number): boolean => extra.some((r) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad);
  const group_ = outerGroup;

  // --- the ground beyond the walls ---
  const margin = 34;
  const gw = bounds.maxX - bounds.minX + margin * 2;
  const gd = bounds.maxZ - bounds.minZ + margin * 2;
  const tex = groundTexture(style.kind, style.ground);
  tex.repeat.set(gw / 8, gd / 8);
  // (Cut into 6 m squares: depth interpolated across one huge quad is not exact, and the edge pass (postfx.ts) reads it as a crease every few pixels.)
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd, Math.ceil(gw / 6), Math.ceil(gd / 6)), new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.96 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set((bounds.minX + bounds.maxX) / 2, -0.04, (bounds.minZ + bounds.maxZ) / 2);
  group_.add(apron);

  // --- lamp posts, each in a pool of light ---
  const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: style.lamp, emissive: style.lamp, emissiveIntensity: 2.4 });
  const poolTex = canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const poolMat = new THREE.MeshBasicMaterial({ color: style.lamp, map: poolTex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const posts = new Batch(unit, std(0x1a1d21, { rough: 0.6, metal: 0.5 }));
  const lamps: THREE.Matrix4[] = [];
  const pools: THREE.Matrix4[] = [];
  const tall = style.kind === 'refinery' ? 5.4 : style.kind === 'warehouse' ? 6.2 : style.kind === 'bank' ? 3.9 : 3.5;
  const gap = 3.4; // from the wall's outside face
  const lampAt = (x: number, z: number): void => {
    if (inExtra(x, z, 4)) return; // not under another floor that reaches out here
    posts.add(x, tall / 2, z, 0.12, tall, 0.12);
    lamps.push(new THREE.Matrix4().makeTranslation(x, tall + 0.05, z));
    pools.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(7.5, 7.5, 1)));
  };
  const step = 12;
  for (let a = 0; a <= W + cell; a += step) {
    lampAt(-half + a, -half - out - gap);
    lampAt(-half + a, D + half + out + gap);
  }
  for (let a = step; a < D + cell; a += step) {
    lampAt(-half - out - gap, -half + a);
    lampAt(W + half + out + gap, -half + a);
  }
  posts.build(group_);
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
  lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
  lampMesh.frustumCulled = false;
  markBloom(lampMesh);
  group_.add(lampMesh);
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMat, pools.length);
  pools.forEach((m, i) => poolMesh.setMatrixAt(i, m));
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 1;
  poolMesh.userData.fx = true; // a glow, not a surface
  group_.add(poolMesh);

  // --- the skyline ---
  buildSkyline(group_, spec, bounds);
  return outerGroup;
}

/** What's round the building, far off: a ring of towers, tanks or low halls, with lit windows. */
function buildSkyline(group: THREE.Group, spec: EdgeSpec, bounds: Rect): void {
  const { style } = spec;
  const kind = style.kind;
  const tex = windowTexture(style.windows, kind === 'refinery' ? 0.16 : kind === 'warehouse' ? 0.1 : kind === 'museum' ? 0.4 : 0.55);
  const body = (color: number, glow = 0.85): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow });
  const block = new Batch(unit, body(kind === 'bank' ? 0x10141a : 0x0c1016));
  const drums: Array<{ m: THREE.Matrix4; tall: boolean }> = [];
  const trees: THREE.Matrix4[] = [];
  const beacons: THREE.Matrix4[] = [];
  const domes: THREE.Matrix4[] = [];

  // A point on a rectangle round the building, `d` metres out, at fraction `t` (0-1) of the way round.
  const perim = bounds.maxX - bounds.minX + (bounds.maxZ - bounds.minZ);
  const ring = (t: number, d: number): { x: number; z: number } => {
    let s = (t % 1) * 2 * perim;
    const x0 = bounds.minX - d;
    const x1 = bounds.maxX + d;
    const z0 = bounds.minZ - d;
    const z1 = bounds.maxZ + d;
    if (s < x1 - x0) return { x: x0 + s, z: z0 };
    s -= x1 - x0;
    if (s < z1 - z0) return { x: x1, z: z0 + s };
    s -= z1 - z0;
    if (s < x1 - x0) return { x: x1 - s, z: z1 };
    s -= x1 - x0;
    return { x: x0, z: z1 - s };
  };
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
  const COUNT = kind === 'bank' ? 46 : kind === 'refinery' ? 30 : kind === 'warehouse' ? 40 : 36;
  // The warehouse looks out on a container yard: stacks of boxes in faded colours, and gantry cranes standing over them.
  const boxes = [0xa83a2a, 0x2a5f8a, 0x3f7a4a, 0xc08a2a, 0x6a6f74].map((c) => new Batch(unit, std(c, { rough: 0.7, metal: 0.25 })));
  const frames = new Batch(unit, std(0x2a2f33, { rough: 0.5, metal: 0.6 }));
  for (let i = 0; i < COUNT; i++) {
    const t = (i + Math.random() * 0.6) / COUNT;
    const near = kind === 'museum' ? 20 : kind === 'refinery' ? 20 : kind === 'warehouse' ? 18 : 24;
    const p = ring(t, near + Math.random() * 12);
    if (kind === 'refinery') {
      const r = rnd(3.5, 6);
      const h = rnd(5, 9);
      const drum = new THREE.Matrix4().compose(new THREE.Vector3(p.x, h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(r, h, r));
      drums.push({ m: drum, tall: false });
      if (Math.random() < 0.3) {
        const q = ring(t + 0.013, near + 10 + Math.random() * 10);
        const th = rnd(18, 28);
        drums.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(q.x, th / 2, q.z), new THREE.Quaternion(), new THREE.Vector3(1.3, th, 1.3)), tall: true });
        beacons.push(new THREE.Matrix4().makeTranslation(q.x, th + 0.4, q.z));
      }
    } else if (kind === 'museum') {
      const w = rnd(9, 15);
      const h = rnd(6, 10);
      block.add(p.x, h / 2, p.z, w, h, rnd(7, 11));
      if (Math.random() < 0.25) domes.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, h, p.z), new THREE.Quaternion(), new THREE.Vector3(4.2, 4.2, 4.2)));
      // Tall trees in the grounds, nearer in.
      const tp = ring(t + 0.006, 9 + Math.random() * 5);
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(tp.x, 2.6, tp.z), new THREE.Quaternion(), new THREE.Vector3(1.5, 5.2, 1.5)));
    } else if (kind === 'warehouse') {
      // A stack of containers, one to three high, each its own colour; now and then a gantry crane over the top.
      const stack = 1 + Math.floor(Math.random() * 3);
      const yaw = Math.random() < 0.5 ? 0 : Math.PI / 2;
      for (let k = 0; k < stack; k++) boxes[Math.floor(Math.random() * boxes.length)]!.add(p.x, 1.3 + k * 2.6, p.z, 12.2, 2.6, 2.5, yaw);
      if (Math.random() < 0.22) {
        const h = rnd(14, 20);
        for (const dx of [-5, 5]) frames.add(p.x + dx, h / 2, p.z, 0.5, h, 0.5);
        frames.add(p.x, h, p.z, 11, 0.7, 0.7);
        beacons.push(new THREE.Matrix4().makeTranslation(p.x, h + 0.6, p.z));
      }
    } else if (kind === 'lab') {
      // Low white halls and a few slender towers; domes (an observatory, a dish) and trees in the grounds.
      const w = rnd(8, 14);
      const h = Math.random() < 0.25 ? rnd(16, 26) : rnd(5, 11);
      block.add(p.x, h / 2, p.z, Math.random() < 0.25 ? 5 : w, h, rnd(6, 10));
      if (Math.random() < 0.2) domes.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, h, p.z), new THREE.Quaternion(), new THREE.Vector3(3.2, 3.2, 3.2)));
      const tp = ring(t + 0.006, 9 + Math.random() * 5);
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(tp.x, 2.2, tp.z), new THREE.Quaternion(), new THREE.Vector3(1.4, 4.4, 1.4)));
    } else if (kind === 'bank') {
      const w = rnd(6, 10);
      const h = rnd(22, 48);
      block.add(p.x, h / 2, p.z, w, h, rnd(6, 9));
      if (Math.random() < 0.3) beacons.push(new THREE.Matrix4().makeTranslation(p.x, h + 0.4, p.z));
    } else {
      const w = rnd(7, 12);
      const h = rnd(12, 28);
      block.add(p.x, h / 2, p.z, w, h, rnd(7, 11));
    }
  }
  block.build(group);
  for (const b of boxes) b.build(group);
  frames.build(group);

  if (drums.length) {
    const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 14), body(0x14181c, 0.35), drums.length);
    drums.forEach((d, i) => tanks.setMatrixAt(i, d.m));
    tanks.frustumCulled = false;
    group.add(tanks);
  }
  if (domes.length) {
    const dm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x1c2229, { rough: 0.5, metal: 0.4, emissive: 0xffd9a0, glow: 0.12 }), domes.length);
    domes.forEach((m, i) => dm.setMatrixAt(i, m));
    dm.frustumCulled = false;
    group.add(dm);
  }
  if (trees.length) {
    const tr = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), std(0x0d1a12, { rough: 1 }), trees.length);
    trees.forEach((m, i) => tr.setMatrixAt(i, m));
    tr.frustumCulled = false;
    group.add(tr);
  }
  if (beacons.length) {
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 6, 5), new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 3 }), beacons.length);
    beacons.forEach((m, i) => bm.setMatrixAt(i, m));
    bm.frustumCulled = false;
    markBloom(bm);
    group.add(bm);
  }
  if (kind === 'refinery') {
    // The flare stack: a thin tower with a flame at its head, off past one corner.
    const at = { x: bounds.maxX + 30, z: bounds.minZ - 26 };
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 30, 8), std(0x16191c, { rough: 0.6, metal: 0.5 }));
    stack.position.set(at.x, 15, at.z);
    group.add(stack);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff7a1a, emissiveIntensity: 3.5, transparent: true, opacity: 0.9 }));
    flame.position.set(at.x, 32, at.z);
    markBloom(flame);
    group.add(flame);
  }
}
