import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { placeShutters, shutterClosure, shutterBlocks, SHUTTER_OPEN_S, SHUTTER_RISE_S, SHUTTER_HOLD_S } from './shutters.ts';

const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;

test('a shutter sits in a straight corridor, its panel one cell back and another beyond, facing away from the start', () => {
  let placed = 0;
  for (let run = 0; run < 40; run++) {
    const cells = generateMaze(14, 10);
    const dist = bfs(cells, 14, 10, 0, 0);
    const used = new Set(['0,0']);
    for (const s of placeShutters(cells, 14, 10, dist, used, 1)) {
      placed++;
      const [dx, dy] = DELTA[s.dir];
      const [near, far] = s.panels;
      assert.deepEqual([near.x, near.y], [s.x - dx, s.y - dy]);
      assert.deepEqual([far.x, far.y], [s.x + dx, s.y + dy]);
      assert.ok(cells[s.y]![s.x]![s.dir], 'across an open passage');
      assert.ok(dist[near.y]![near.x]! < dist[far.y]![far.x]!, 'the near panel is the one you come to first');
      for (const p of s.panels) {
        assert.equal(cells[p.y]![p.x]![p.wall], false, 'a panel goes on a wall');
        assert.ok(used.has(`${p.x},${p.y}`));
      }
    }
  }
  assert.ok(placed > 30, `only ${placed} of 40 floors had a shutter`);
});

test('unlocked, it rises, holds open, then comes down; shut before and after', () => {
  assert.equal(shutterClosure(null), 1);
  assert.equal(shutterClosure(0), 1);
  assert.ok(shutterClosure(SHUTTER_RISE_S / 2) > 0 && shutterClosure(SHUTTER_RISE_S / 2) < 1);
  assert.equal(shutterClosure(SHUTTER_RISE_S + SHUTTER_HOLD_S / 2), 0);
  assert.ok(shutterClosure(SHUTTER_OPEN_S - 0.5) > 0.5);
  assert.equal(shutterClosure(SHUTTER_OPEN_S + 1), 1);
});

test('half down, it stops someone walking but not someone sliding', () => {
  assert.equal(shutterBlocks(0.2, false), false);
  assert.equal(shutterBlocks(0.55, false), true);
  assert.equal(shutterBlocks(0.55, true), false);
  assert.equal(shutterBlocks(0.95, true), true);
});

test('walking from the panel gets there too late; a dash from it slides under', () => {
  // From the panel's cell to the shutter: 1.5 cells (6 m). After the hack: a quarter turn (0.6 s) to face it.
  const TURN = 0.6;
  const walkArrives = TURN + 6 / 7;
  assert.ok(shutterBlocks(shutterClosure(walkArrives), false), `walking arrives at ${shutterClosure(walkArrives).toFixed(2)} down`);
  // A dash to the cell beyond (8 m): 4.5 m of sprint at 11 m/s, then the slide (2.6 m in 0.55 s) under the shutter.
  const dashUnder = TURN + 0.25 + 4.5 / 11 + (1.5 / 2.6) * 0.55;
  assert.ok(!shutterBlocks(shutterClosure(dashUnder), true), `sliding arrives at ${shutterClosure(dashUnder).toFixed(2)} down`);
});
