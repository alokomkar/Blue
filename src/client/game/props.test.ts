import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeStaffLockers, placeVents, VENT_MIN_DETOUR } from './props.ts';
import { generateMaze, bfs } from './maze.ts';

const COLS = 16;
const ROWS = 12;

test('staff lockers stand in plain corridors, against a closed wall, in unused cells, spread out', () => {
  for (let run = 0; run < 30; run++) {
    const cells = generateMaze(COLS, ROWS);
    const used = new Set<string>(['0,0']);
    const lockers = placeStaffLockers(cells, COLS, ROWS, used, 3);
    assert.ok(lockers.length > 0);
    for (const l of lockers) {
      const c = cells[l.y]![l.x]!;
      assert.equal([c.N, c.S, c.E, c.W].filter(Boolean).length, 2);
      assert.equal(c[l.wall], false, 'backs onto a closed wall');
      assert.ok(used.has(`${l.x},${l.y}`), 'reserves its cell');
    }
    for (let i = 0; i < lockers.length; i++) {
      for (let j = i + 1; j < lockers.length; j++) {
        assert.ok(Math.abs(lockers[i]!.x - lockers[j]!.x) + Math.abs(lockers[i]!.y - lockers[j]!.y) >= 3);
      }
    }
  }
});

test('vents join walled-off neighbours that are far apart on foot, in the same section', () => {
  let placed = 0;
  for (let run = 0; run < 30; run++) {
    const cells = generateMaze(COLS, ROWS);
    const section = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => (x < COLS / 2 ? -1 : y < ROWS / 2 ? 0 : 1)));
    const used = new Set<string>(['0,0']);
    for (const v of placeVents(cells, COLS, ROWS, section, used, 2)) {
      placed++;
      assert.equal(Math.abs(v.a.x - v.b.x) + Math.abs(v.a.y - v.b.y), 1, 'neighbours');
      assert.equal(cells[v.a.y]![v.a.x]![v.side], false, 'a wall between them');
      assert.equal(section[v.a.y]![v.a.x], section[v.b.y]![v.b.x], 'same door section');
      const walk = bfs(cells, COLS, ROWS, v.a.x, v.a.y)[v.b.y]![v.b.x]!;
      assert.ok(walk >= VENT_MIN_DETOUR, `saves a real detour (${walk} cells)`);
    }
  }
  assert.ok(placed > 20, `vents get placed on most mazes (${placed} over 30)`);
});

test('on a floor with solid cores between its halls, vents run through them, from one open cell to another in line', async () => {
  const { generateLayout } = await import('./layouts.ts');
  const { generateBuilding } = await import('./building.ts');
  const { VENT_MAX_GAP } = await import('./props.ts');
  let placed = 0;
  let throughSolid = 0;
  for (const style of ['plus', 'fishbone', 'aisles', 'uturn'] as const) {
    for (let run = 0; run < 25; run++) {
      const cells = generateLayout(style, 14, 10, 'commons', generateBuilding);
      const section = Array.from({ length: 10 }, () => new Array<number>(14).fill(-1));
      const used = new Set<string>(['0,0']);
      for (const v of placeVents(cells, 14, 10, section, used, 2)) {
        placed++;
        const dx = Math.sign(v.b.x - v.a.x);
        const dy = Math.sign(v.b.y - v.a.y);
        assert.ok(dx === 0 || dy === 0, 'in line');
        const gap = Math.abs(v.b.x - v.a.x) + Math.abs(v.b.y - v.a.y) - 1;
        assert.ok(gap >= 0 && gap <= VENT_MAX_GAP);
        if (gap > 0) throughSolid++;
        for (let k = 1; k <= gap; k++) {
          const c = cells[v.a.y + dy * k]![v.a.x + dx * k]!;
          assert.ok(!c.N && !c.S && !c.E && !c.W, 'only solid cells between the ends');
        }
        const open = (c: { N: boolean; S: boolean; E: boolean; W: boolean }): boolean => c.N || c.S || c.E || c.W;
        assert.ok(open(cells[v.a.y]![v.a.x]!) && open(cells[v.b.y]![v.b.x]!), 'both ends are open cells');
        assert.equal(cells[v.a.y]![v.a.x]![v.side], false);
      }
    }
  }
  assert.ok(placed > 100, `vents get placed (${placed})`);
  assert.ok(throughSolid > 20, `and many go through solid cells (${throughSolid})`);
});
