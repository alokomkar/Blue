// A skylight in the upper floor (the mockup's third section): one cell of the upper floor is glass, over a corridor of the ground floor where the guards pass. Lie on it, break it and come
// down on whoever is underneath. `pickSkylight` is pure (unit-tested under Node: which cell, from the two mazes); `buildSkylight` is the pane, its cracks and its frame.

import * as THREE from 'three';
import type { MazeCells } from './maze';

export type SkylightPick = { x1: number; y1: number; x0: number; y0: number };

const DIRS = ['N', 'E', 'S', 'W'] as const;
const openings = (cells: MazeCells, x: number, y: number): number => DIRS.filter((d) => cells[y]![x]![d]).length;

/**
 * The upper floor's cell (x1, y1) for the skylight and the ground floor's cell (x0, y0) straight below it. Only corridors and junctions that hold nothing, the upper one in the always-open part (the ground below may be a locked section: a door opens from the inside, as it does for the grapple), preferring a ground-floor junction (the guards cross those). `rand` picks among the best.
 */
export function pickSkylight(o: {
  cells1: MazeCells;
  section1: number[][];
  cols1: number;
  rows1: number;
  taken1: ReadonlySet<string>;
  cells0: MazeCells;
  cols0: number;
  rows0: number;
  taken0: ReadonlySet<string>;
  /** The upper floor's origin in the ground floor's cells (they line up on the grid). */
  offX: number;
  offY: number;
  rand: () => number;
}): SkylightPick | null {
  const junctions: SkylightPick[] = [];
  const corridors: SkylightPick[] = [];
  for (let y1 = 0; y1 < o.rows1; y1++) {
    for (let x1 = 0; x1 < o.cols1; x1++) {
      const x0 = x1 + o.offX;
      const y0 = y1 + o.offY;
      if (x0 < 0 || y0 < 0 || x0 >= o.cols0 || y0 >= o.rows0) continue;
      if (o.taken1.has(`${x1},${y1}`) || o.taken0.has(`${x0},${y0}`)) continue;
      if (o.section1[y1]![x1] !== -1) continue;
      const up = openings(o.cells1, x1, y1);
      const down = openings(o.cells0, x0, y0);
      if (up < 2 || down < 2) continue;
      (down >= 3 ? junctions : corridors).push({ x1, y1, x0, y0 });
    }
  }
  const pool = junctions.length ? junctions : corridors;
  return pool.length ? pool[Math.floor(o.rand() * pool.length)]! : null;
}

export type Skylight = {
  group: THREE.Group;
  /** Intact (glass you can walk on), cracking (the lines spreading), or broken (an open hole). */
  state: 'intact' | 'cracking' | 'broken';
  /** Starts the cracks; `onBreak` is called when they have spread. */
  crack: (onBreak: () => void) => void;
  /** Steps the cracks. */
  update: (dt: number) => void;
};

const CRACK_S = 0.9;

/** The pane over one cell of `size` metres, centred on the group's origin: glass with a frame, a few panel lines, and cracks that spread from the middle. */
export function buildSkylight(size: number): Skylight {
  const group = new THREE.Group();
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false })
  );
  pane.rotation.x = -Math.PI / 2;
  pane.position.y = 0.02;
  pane.userData.fx = true;
  group.add(pane);
  // The grid of panels (2 x 2) and the frame round the edge.
  const h = size / 2;
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-h, 0.03, 0), new THREE.Vector3(h, 0.03, 0), new THREE.Vector3(0, 0.03, -h), new THREE.Vector3(0, 0.03, h),
      new THREE.Vector3(-h, 0.03, -h), new THREE.Vector3(h, 0.03, -h), new THREE.Vector3(h, 0.03, -h), new THREE.Vector3(h, 0.03, h),
      new THREE.Vector3(h, 0.03, h), new THREE.Vector3(-h, 0.03, h), new THREE.Vector3(-h, 0.03, h), new THREE.Vector3(-h, 0.03, -h),
    ]),
    new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.55 })
  );
  grid.userData.fx = true;
  group.add(grid);
  // Cracks: nine lines of four jagged segments out from the middle, drawn on as the time runs.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    let prev = new THREE.Vector3(0, 0.04, 0);
    for (let s = 1; s <= 5; s++) {
      const ang = a + (Math.random() - 0.5) * 0.36;
      const next = new THREE.Vector3(Math.cos(ang) * s * (size / 11), 0.04, Math.sin(ang) * s * (size / 11));
      pts.push(prev, next);
      prev = next;
    }
  }
  const crackGeo = new THREE.BufferGeometry().setFromPoints(pts);
  crackGeo.setDrawRange(0, 0);
  const cracks = new THREE.LineSegments(crackGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
  cracks.userData.fx = true;
  group.add(cracks);

  let age = 0;
  let onBreak: (() => void) | null = null;
  const sky: Skylight = {
    group,
    state: 'intact',
    crack(cb) {
      if (sky.state !== 'intact') return;
      sky.state = 'cracking';
      age = 0;
      onBreak = cb;
    },
    update(dt) {
      if (sky.state === 'cracking') {
        age += dt;
        crackGeo.setDrawRange(0, Math.floor((pts.length * Math.min(1, age / CRACK_S)) / 2) * 2);
        // The glass flexes as it goes.
        pane.position.y = 0.02 - Math.sin(age * 40) * 0.01;
        if (age >= CRACK_S + 0.15) {
          sky.state = 'broken';
          group.visible = false;
          onBreak?.();
          onBreak = null;
        }
      }
    },
  };
  return sky;
}
