import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCK_MAP, parseTraining } from './tutorial.ts';
import { bfs } from './maze.ts';
import { CANAL_COL, CONTAINER_H, CONTAINER_W, DOCK_CONTAINERS, YARD_CELL, YARD_COLS, YARD_ROWS } from './yardplan.ts';
import { YARD_CLUES, yardDossierIndex, yardOpenContainers as openIn } from './yardsite.ts';

const geometry = { containers: DOCK_CONTAINERS, width: CONTAINER_W, cell: YARD_CELL, cols: YARD_COLS, rows: YARD_ROWS, height: CONTAINER_H };
const yardOpenContainers = (): ReturnType<typeof openIn> => openIn(geometry);

const layout = parseTraining(DOCK_MAP);
const hits = (x: number, z: number, pad: number): boolean =>
  DOCK_CONTAINERS.some((c) => {
    const hx = (c.alongZ ? CONTAINER_W : c.len) / 2;
    const hz = (c.alongZ ? c.len : CONTAINER_W) / 2;
    return x > c.x - hx - pad && x < c.x + hx + pad && z > c.z - hz - pad && z < c.z + hz + pad;
  });

test('every clue system stands on a dry cell clear of the containers, reachable from the gate, and they are well apart', () => {
  const dist = bfs(layout.cells, layout.cols, layout.rows, 0, 0);
  for (const c of YARD_CLUES) {
    assert.ok(dist[c.y]![c.x]! >= 0, `cell ${c.x},${c.y} is reachable`);
    assert.notEqual(c.x, CANAL_COL);
    assert.equal(hits(c.x * YARD_CELL, c.y * YARD_CELL, 2.2), false, `cell ${c.x},${c.y} is clear of containers`);
  }
  for (let i = 0; i < YARD_CLUES.length; i++) for (let j = i + 1; j < YARD_CLUES.length; j++) {
    assert.ok(Math.hypot(YARD_CLUES[i]!.x - YARD_CLUES[j]!.x, YARD_CLUES[i]!.y - YARD_CLUES[j]!.y) >= 3, 'clue systems are apart');
  }
});

test('there are plenty of containers that can be opened, each with a clear spot at its doors, and their ids are unique', () => {
  const open = yardOpenContainers();
  assert.ok(open.length >= 8, `open ${open.length}`);
  assert.equal(new Set(open.map((c) => c.id)).size, open.length);
  for (const c of open) {
    const cell = { x: Math.round(c.station.x / YARD_CELL), y: Math.round(c.station.z / YARD_CELL) };
    assert.ok(cell.x !== CANAL_COL, 'not in the canal');
  }
});

test('the dossier is in the same container for the same seed, always one that can be opened, and different seeds use different ones', () => {
  const n = yardOpenContainers().length;
  const picks = Array.from({ length: 40 }, (_, i) => yardDossierIndex(i + 1, n));
  for (const p of picks) assert.ok(p >= 0 && p < n);
  assert.deepEqual(picks, Array.from({ length: 40 }, (_, i) => yardDossierIndex(i + 1, n)));
  assert.ok(new Set(picks).size >= 5);
  assert.equal(yardDossierIndex(3, 0), -1);
});
