import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, RECIPES, TOWER_SETS, TOWER_SET_IDS, furnitureFor, setLayoutPlan, place, podPieces, inLane, waysOpen, footprint } from './towerfurniture.ts';
import { TOWER_LAYOUT, TOWER_LEVELS, TOWER_COLS, TOWER_ROWS, towerBlocked, walkable, selectTowerPlan, activePlan } from './towerplan.ts';

setLayoutPlan(TOWER_LAYOUT);
const levels = TOWER_LEVELS.map((_, i) => i);
const cellsOf = (p: { box: { minX: number; maxX: number; minZ: number; maxZ: number } }): Array<[number, number]> => [
  [Math.round(p.box.minX / 4), Math.round(p.box.minZ / 4)], [Math.round(p.box.maxX / 4), Math.round(p.box.minZ / 4)],
  [Math.round(p.box.minX / 4), Math.round(p.box.maxZ / 4)], [Math.round(p.box.maxX / 4), Math.round(p.box.maxZ / 4)],
];
const isFixed = (l: number, p: { box: { minX: number; maxX: number; minZ: number; maxZ: number } }): boolean =>
  activePlan().fixed.some((f) => f.level === l && Math.abs(place(f).box.minX - p.box.minX) < 1e-6 && Math.abs(place(f).box.minZ - p.box.minZ) < 1e-6);

test('there are six sets, each naming four storeys and giving each a mix of pods that exist', () => {
  assert.equal(TOWER_SET_IDS.length, 6);
  for (const id of TOWER_SET_IDS) {
    const s = TOWER_SETS[id];
    assert.equal(s.floors.length, 4);
    assert.equal(s.levels.length, 4);
    for (const mix of s.levels) {
      for (const [k] of mix.pods) assert.ok(RECIPES[k], `${id}: no recipe ${k}`);
      assert.ok(mix.fill > 0 && mix.area > 0);
    }
  }
});

test('every recipe fits the square between four cells, turned or not: 3.1 m across, so the lanes beside it stay clear', () => {
  for (const [name, r] of Object.entries(RECIPES)) {
    for (const turn of [false, true]) {
      for (const [kind, dx, dz, yaw] of r) {
        if (KINDS[kind].decor) continue;
        const q = Math.abs(Math.sin(yaw - (turn ? Math.PI / 2 : 0))) > 0.5;
        const hw = (q ? KINDS[kind].depth : KINDS[kind].len) / 2;
        const hd = (q ? KINDS[kind].len : KINDS[kind].depth) / 2;
        const [ox, oz] = turn ? [-dz, dx] : [dx, dz];
        assert.ok(Math.abs(ox) + hw <= 1.55 + 1e-9 && Math.abs(oz) + hd <= 1.55 + 1e-9, `recipe ${name} (${kind}) sticks out of its square${turn ? ' when turned' : ''}`);
      }
    }
  }
});

test('glass and mesh stop a body and not a look, and have no cover; everything else that is not decoration has some', () => {
  for (const [k, s] of Object.entries(KINDS)) {
    if (s.see) assert.equal(s.cover, null, `${k} is see-through and hides someone`);
    if (s.decor) continue;
    if (!s.see && !['lamp', 'chair'].includes(k)) assert.ok(s.cover, `${k} has no cover`);
  }
});

for (const id of TOWER_SET_IDS) {
  test(`${id}: every piece stands on floor, none on a place that must stay reachable, nothing overlaps, no lane is blocked, and a way is left between open cells`, () => {
    selectTowerPlan(id);
    for (const l of levels) {
      const ps = furnitureFor(l, id).filter((p) => !p.spec.decor);
      assert.ok(ps.length > 0, `storey ${l} has furniture`);
      for (const p of ps) {
        for (const [x, y] of cellsOf(p)) assert.ok(walkable(l, x, y), `${id} ${l}: ${p.kind} reaches ${x},${y}, which is not floor`);
        if (!isFixed(l, p)) assert.ok(!towerBlocked(l, Math.round(p.cx / 4), Math.round(p.cz / 4)), `${id} ${l}: ${p.kind} at ${p.cx.toFixed(1)},${p.cz.toFixed(1)} is on a place that must stay clear`);
        if (!isFixed(l, p)) assert.ok(!inLane(TOWER_LAYOUT, l, p), `${id} ${l}: ${p.kind} at ${p.cx.toFixed(1)},${p.cz.toFixed(1)} is in a lane`);
      }
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i]!.box;
          const b = ps[j]!.box;
          assert.ok(!(a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ), `${id} ${l}: ${ps[i]!.kind} and ${ps[j]!.kind} overlap`);
        }
      }
      // And none stands in a wall (outer, partition or room): every piece, the fixed ones too.
      for (const q of ps) {
        if (q.spec.decor) continue;
        const hit = TOWER_LAYOUT.wallRects(l).find((r) => q.box.minX < r.x1 - 1e-6 && q.box.maxX > r.x0 + 1e-6 && q.box.minZ < r.z1 - 1e-6 && q.box.maxZ > r.z0 + 1e-6);
        assert.ok(!hit, `${id} ${l}: ${q.kind} at ${q.cx.toFixed(1)},${q.cz.toFixed(1)} is in a wall`);
      }
      assert.ok(waysOpen(TOWER_LAYOUT, l, ps), `${id} ${l}: a way is shut`);
    }
  });

  test(`${id}: laid out the same each time, with a fuller floor above the lobby, and somewhere to hide on every storey`, () => {
    selectTowerPlan(id);
    for (const l of levels) {
      const a = furnitureFor(l, id);
      assert.equal(a.length, furnitureFor(l, id).length);
      assert.ok(a.some((p) => p.spec.cover), `${id} ${l}: nowhere to hide`);
    }
    const cells = (l: number): number => { let n = 0; for (let y = 0; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) if (walkable(l, x, y)) n++; return n; };
    const share = (l: number): number => footprint(furnitureFor(l, id)) / (cells(l) * 16);
    assert.ok(share(1) > share(0), `${id}: the lobby is as full as the balcony`);
    for (const l of levels) assert.ok(share(l) >= TOWER_SETS[id].levels[l]!.area / 100 * 0.45, `${id} ${l}: only ${(share(l) * 100).toFixed(1)}% covered`);
  });
}

test('the sets differ: no two share the same tall pieces on the top storey', () => {
  for (const id of TOWER_SET_IDS) selectTowerPlan(id);
  const kinds = (id: (typeof TOWER_SET_IDS)[number]): string => [...new Set(furnitureFor(3, id).filter((p) => p.spec.cover === 'tall').map((p) => p.kind))].sort().join(',');
  const all = TOWER_SET_IDS.map(kinds);
  assert.equal(new Set(all).size, all.length, all.join(' | '));
});

test('a recipe turned a quarter stays in its square and keeps its pieces', () => {
  for (const [k, r] of Object.entries(RECIPES)) {
    const a = podPieces({ level: 0, kind: k, i: 1, j: 1 });
    const b = podPieces({ level: 0, kind: k, i: 1, j: 1, turn: true });
    assert.equal(a.length, r.length);
    assert.equal(b.length, r.length);
  }
});

test('furniture follows the seed, and holds its rules on any tower: out of the lanes and the walls, no overlaps, every way open', () => {
  for (const id of TOWER_SET_IDS) {
    for (const seed of [1, 2, 3, 4]) {
      selectTowerPlan(id, seed);
      for (const l of [0, 1, 2, 3]) {
        const ps = furnitureFor(l, id);
        const fixed = (q: (typeof ps)[number]): boolean => TOWER_LAYOUT.fixed.some((f) => f.level === l && f.kind === q.kind && f.x === q.x && f.y === q.y);
        for (const q of ps) {
          if (q.spec.decor) continue;
          const hit = TOWER_LAYOUT.wallRects(l).find((r) => q.box.minX < r.x1 - 1e-6 && q.box.maxX > r.x0 + 1e-6 && q.box.minZ < r.z1 - 1e-6 && q.box.maxZ > r.z0 + 1e-6);
          assert.ok(!hit, `${id} seed ${seed} ${l}: ${q.kind} at ${q.cx.toFixed(1)},${q.cz.toFixed(1)} is in a wall`);
          if (!fixed(q)) assert.ok(!inLane(TOWER_LAYOUT, l, q), `${id} seed ${seed} ${l}: ${q.kind} is in a lane`);
        }
        assert.ok(waysOpen(TOWER_LAYOUT, l, ps), `${id} seed ${seed} ${l}: a way is shut`);
      }
    }
    selectTowerPlan(id, 1);
    const a = furnitureFor(1, id).map((q) => `${q.kind}${q.cx.toFixed(1)}${q.cz.toFixed(1)}`).join();
    selectTowerPlan(id, 2);
    const b = furnitureFor(1, id).map((q) => `${q.kind}${q.cx.toFixed(1)}${q.cz.toFixed(1)}`).join();
    assert.notEqual(a, b, `${id}: two seeds, the same furniture`);
  }
  selectTowerPlan('campus');
});
