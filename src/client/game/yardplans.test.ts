import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCK_MAP, parseTraining } from './tutorial.ts';
import { bfs } from './maze.ts';
import { BRIDGE_ROW, CANAL_COL, CONTAINER_H, CONTAINER_W, DOCK_ZIPLINE, EXIT_CELL, YARD_CELL, YARD_COLS, YARD_PLANS, YARD_ROWS, type ContainerSpec, type YardId } from './yardplan.ts';
import { yardOpenContainers } from './yardsite.ts';

// The dock yard and the Tank Farm run on one map and one rulebook; each plan puts different things on it.
const layout = parseTraining(DOCK_MAP);
const box = (c: ContainerSpec): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  const w = c.width ?? CONTAINER_W;
  const hx = (c.alongZ ? w : c.len) / 2;
  const hz = (c.alongZ ? c.len : w) / 2;
  return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz };
};
const at = (x: number, y: number): { x: number; z: number } => ({ x: x * YARD_CELL, z: y * YARD_CELL });
const inside = (p: { x: number; z: number }, b: ReturnType<typeof box>, pad: number): boolean => p.x > b.minX - pad && p.x < b.maxX + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad;

for (const id of ['dock', 'farm'] as YardId[]) {
  const plan = YARD_PLANS[id];
  const boxes = plan.containers.map(box);

  test(`${id}: everything stays inside the fence, out of the canal, off the gate, the truck and the zipline, and clear of everything else`, () => {
    const w = YARD_COLS * YARD_CELL;
    const d = YARD_ROWS * YARD_CELL;
    boxes.forEach((b, i) => {
      assert.ok(b.minX > -YARD_CELL / 2 && b.maxX < w - YARD_CELL / 2 && b.minZ > -YARD_CELL / 2 && b.maxZ < d - YARD_CELL / 2, `#${i} inside the fence`);
      assert.ok(!(b.maxX > (CANAL_COL - 0.5) * YARD_CELL && b.minX < (CANAL_COL + 0.5) * YARD_CELL && b.minZ < (BRIDGE_ROW - 0.5) * YARD_CELL), `#${i} is on the canal`);
      for (const p of [at(0, 0), at(EXIT_CELL.x, EXIT_CELL.y), DOCK_ZIPLINE.from, DOCK_ZIPLINE.to]) assert.ok(!inside(p, b, 2.2), `#${i} crowds ${p.x},${p.z}`);
      for (let j = i + 1; j < boxes.length; j++) {
        const o = boxes[j]!;
        assert.ok(!(b.minX < o.maxX && b.maxX > o.minX && b.minZ < o.maxZ && b.maxZ > o.minZ), `${i} and ${j} overlap`);
      }
    });
  });

  test(`${id}: the people stand on dry ground in real cells and not inside anything, and the clue consoles are clear and apart`, () => {
    for (const c of [...plan.guards, ...plan.patrols, ...plan.dogs, ...plan.crates]) {
      const cell = layout.cells[c.y]?.[c.x];
      assert.ok(cell && (cell.N || cell.S || cell.E || cell.W), `cell ${c.x},${c.y} is a place`);
      assert.ok(!(c.x === CANAL_COL && c.y < BRIDGE_ROW), 'not in the water');
      for (const b of boxes) assert.ok(!inside(at(c.x, c.y), b, 0.6), `${c.x},${c.y} is inside something`);
    }
    const dist = bfs(layout.cells, layout.cols, layout.rows, 0, 0);
    for (const c of plan.clues) {
      assert.ok(dist[c.y]![c.x]! >= 0, `clue ${c.x},${c.y} reachable`);
      for (const b of boxes) assert.ok(!inside(at(c.x, c.y), b, 2.2), `clue ${c.x},${c.y} is clear`);
    }
    for (let i = 0; i < plan.clues.length; i++) for (let j = i + 1; j < plan.clues.length; j++) assert.ok(Math.hypot(plan.clues[i]!.x - plan.clues[j]!.x, plan.clues[i]!.y - plan.clues[j]!.y) >= 3);
  });

  test(`${id}: you can walk from the gate to the office door, the truck, every clue and every guard, round everything on it`, () => {
    const R = 1;
    const W = Math.floor(YARD_COLS * YARD_CELL);
    const H = Math.floor(YARD_ROWS * YARD_CELL);
    const blocked = (x: number, z: number): boolean => boxes.some((b) => x > b.minX - 0.9 && x < b.maxX + 0.9 && z > b.minZ - 0.9 && z < b.maxZ + 0.9) || (x > 60 && x < 68 && z < 76);
    const seen = new Set<string>(['2,2']);
    const queue: Array<[number, number]> = [[2, 2]];
    for (let k = 0; k < queue.length; k++) {
      const [i, j] = queue[k]!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < -4 || b < -4 || a > W - 4 || b > H - 4 || seen.has(`${a},${b}`) || blocked(a * R + 0.5, b * R + 0.5)) continue;
        seen.add(`${a},${b}`);
        queue.push([a, b]);
      }
    }
    const reach = (p: { x: number; z: number }): boolean => {
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (seen.has(`${Math.floor(p.x) + di},${Math.floor(p.z) + dj}`)) return true;
      return false;
    };
    for (const p of [{ x: 120, z: 18 }, at(EXIT_CELL.x, EXIT_CELL.y), ...plan.clues.map((c) => at(c.x, c.y)), ...plan.guards.map((c) => at(c.x, c.y))]) assert.ok(reach(p), `${p.x},${p.z} is cut off`);
  });

  test(`${id}: there are plenty of containers that can be opened, with a clear spot at their doors, and none is a tank or a rack`, () => {
    const open = yardOpenContainers({ containers: plan.containers, width: CONTAINER_W, cell: YARD_CELL, cols: YARD_COLS, rows: YARD_ROWS, height: CONTAINER_H });
    assert.ok(open.length >= 8, `${open.length} open`);
    assert.equal(new Set(open.map((c) => c.id)).size, open.length);
    for (const o of open) assert.ok(!['tank', 'rack'].includes(plan.containers[o.index]!.shape ?? 'box'));
  });
}

test('the farm is laid out differently from the dock: other things, in other places', () => {
  const dock = YARD_PLANS.dock.containers;
  const farm = YARD_PLANS.farm.containers;
  assert.ok(farm.some((c) => c.shape === 'tank') && farm.some((c) => c.shape === 'rack') && farm.some((c) => c.shape === 'cage'));
  assert.ok(dock.every((c) => (c.shape ?? 'box') === 'box'));
  const same = farm.filter((f) => dock.some((d) => d.x === f.x && d.z === f.z)).length;
  assert.ok(same <= 2, `${same} in the same place`);
  assert.notDeepEqual(YARD_PLANS.farm.patrols, YARD_PLANS.dock.patrols);
});
