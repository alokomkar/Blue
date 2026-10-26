import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCK_MAP, parseTraining } from './tutorial.ts';
import { bfs } from './maze.ts';
import {
  BRIDGE_ROW,
  CANAL_COL,
  CONTAINER_W,
  DOCK_CONTAINERS,
  DOCK_CRATES,
  DOCK_DOGS,
  DOCK_GUARDS,
  DOCK_PATROLS,
  DOCK_ZIPLINE,
  EXIT_CELL,
  OFFICE,
  YARD_CELL,
  YARD_COLS,
  YARD_ROWS,
  zipPoint,
} from './yardplan.ts';

const layout = parseTraining(DOCK_MAP);
const at = (cx: number, cy: number): { x: number; z: number } => ({ x: cx * YARD_CELL, z: cy * YARD_CELL });
const box = (c: (typeof DOCK_CONTAINERS)[number]): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  const hx = (c.alongZ ? CONTAINER_W : c.len) / 2;
  const hz = (c.alongZ ? c.len : CONTAINER_W) / 2;
  return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz };
};
const inside = (p: { x: number; z: number }, b: ReturnType<typeof box>, pad = 0): boolean => p.x > b.minX - pad && p.x < b.maxX + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad;

test('the yard map is the size the plan says, with the gate, the office room and the truck marked', () => {
  assert.equal(layout.cols, YARD_COLS);
  assert.equal(layout.rows, YARD_ROWS);
  assert.deepEqual(layout.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(layout.marks.$, OFFICE.room);
  assert.deepEqual(layout.marks.X, EXIT_CELL);
});

test('from the gate you can reach the office room and the truck, and only by the bridge: the canal has no other way over', () => {
  const dist = bfs(layout.cells, layout.cols, layout.rows, 0, 0);
  assert.ok(dist[OFFICE.room.y]![OFFICE.room.x]! >= 0, 'the office');
  assert.ok(dist[EXIT_CELL.y]![EXIT_CELL.x]! >= 0, 'the truck');
  // The water itself is unreachable, and so is every cell of the canal column but the bridge row.
  for (let y = 0; y < BRIDGE_ROW; y++) assert.equal(dist[y]![CANAL_COL]!, -1, `canal row ${y} is water`);
  assert.ok(dist[BRIDGE_ROW]![CANAL_COL]! >= 0, 'the bridge is dry');
  // Closing the bridge cuts the east bank off entirely.
  const cut = layout.cells.map((row) => row.map((c) => ({ ...c })));
  cut[BRIDGE_ROW]![CANAL_COL]!.E = false;
  cut[BRIDGE_ROW]![CANAL_COL + 1]!.W = false;
  assert.equal(bfs(cut, layout.cols, layout.rows, 0, 0)[EXIT_CELL.y]![EXIT_CELL.x]!, -1, 'without the bridge, the east bank is out of reach on foot');
});

test('the truck sits in a dead end, the office room opens south, and the canal is walled on both banks', () => {
  const t = layout.cells[EXIT_CELL.y]![EXIT_CELL.x]!;
  assert.deepEqual([t.N, t.S, t.E, t.W], [false, false, false, true], 'the truck is entered from the west only');
  const r = layout.cells[OFFICE.room.y]![OFFICE.room.x]!;
  assert.deepEqual([r.N, r.S, r.E, r.W], [false, true, false, false]);
  for (let y = 0; y < BRIDGE_ROW; y++) {
    assert.equal(layout.cells[y]![CANAL_COL]!.E || layout.cells[y]![CANAL_COL]!.W, false, `canal row ${y}`);
  }
});

test('containers stay in the yard, off the gate, the truck, the zipline and each other', () => {
  const w = YARD_COLS * YARD_CELL;
  const d = YARD_ROWS * YARD_CELL;
  for (const c of DOCK_CONTAINERS) {
    const b = box(c);
    assert.ok(b.minX > -YARD_CELL / 2 && b.maxX < w - YARD_CELL / 2 && b.minZ > -YARD_CELL / 2 && b.maxZ < d - YARD_CELL / 2, `container at ${c.x},${c.z} inside the fence`);
    // Not in the water.
    assert.ok(!(b.maxX > (CANAL_COL - 0.5) * YARD_CELL && b.minX < (CANAL_COL + 0.5) * YARD_CELL && b.minZ < (BRIDGE_ROW - 0.5) * YARD_CELL), `container at ${c.x},${c.z} is on the canal`);
    for (const p of [at(0, 0), at(EXIT_CELL.x, EXIT_CELL.y), DOCK_ZIPLINE.from, DOCK_ZIPLINE.to, zipPoint(0), zipPoint(1)]) assert.ok(!inside(p, b, 2.2), `container at ${c.x},${c.z} crowds ${p.x},${p.z}`);
  }
  for (let i = 0; i < DOCK_CONTAINERS.length; i++)
    for (let j = i + 1; j < DOCK_CONTAINERS.length; j++) {
      const a = box(DOCK_CONTAINERS[i]!);
      const b = box(DOCK_CONTAINERS[j]!);
      assert.ok(!(a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ), `containers ${i} and ${j} overlap`);
    }
});

test('nobody starts inside a container, and the people stand on dry ground', () => {
  const boxes = DOCK_CONTAINERS.map(box);
  const cells = [...DOCK_GUARDS, ...DOCK_PATROLS, ...DOCK_DOGS, ...DOCK_CRATES];
  for (const c of cells) {
    assert.ok(layout.cells[c.y]?.[c.x] && (layout.cells[c.y]![c.x]!.N || layout.cells[c.y]![c.x]!.S || layout.cells[c.y]![c.x]!.E || layout.cells[c.y]![c.x]!.W), `cell ${c.x},${c.y} is a place`);
    assert.ok(!(c.x === CANAL_COL && c.y < BRIDGE_ROW), `${c.x},${c.y} is not in the water`);
    const p = at(c.x, c.y);
    for (const b of boxes) assert.ok(!inside(p, b, 0.6), `${c.x},${c.y} is inside a container`);
  }
});

test('the zipline runs west to east over the whole canal, downhill, and ends a body-length clear of the water', () => {
  const z = DOCK_ZIPLINE;
  assert.ok(z.from.x < (CANAL_COL - 0.5) * YARD_CELL - 2, 'it starts clear of the west quay');
  assert.ok(z.to.x > (CANAL_COL + 0.5) * YARD_CELL + 2, 'and ends clear of the east');
  assert.ok(z.fromHeight > z.toHeight);
  assert.deepEqual([zipPoint(0).x, zipPoint(1).x], [z.from.x, z.to.x]);
  assert.ok(zipPoint(0.5).y < (z.fromHeight + z.toHeight) / 2, 'a little sag in the middle');
  assert.ok(zipPoint(0.5).y > 3, 'but high enough to hang from, above the quay fence');
});
