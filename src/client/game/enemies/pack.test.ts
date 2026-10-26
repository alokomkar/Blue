import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs, type MazeCells } from '../maze.ts';
import {
  advancePack,
  meetingPoint,
  startPack,
  PACK_GATHER_MAX_S,
  PACK_HUDDLE_S,
  PACK_ROAM_S,
  type PackState,
} from './pack.ts';

/** An open grid with no inner walls, sealed at the edges. */
function openGrid(cols: number, rows: number): MazeCells {
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => ({ N: y > 0, S: y < rows - 1, W: x > 0, E: x < cols - 1 }))
  );
}

test('the pack roams, heads for the meeting point, huddles there, then splits up again', () => {
  const half = () => 0.5;
  let s: PackState = startPack(half);
  assert.equal(s.phase, 'roam');
  s = advancePack(s, s.timer + 0.01, 0, 3, half);
  assert.equal(s.phase, 'gather');
  s = advancePack(s, 1, 2, 3, half);
  assert.equal(s.phase, 'gather', 'waits for the last dog');
  s = advancePack(s, 1, 3, 3, half);
  assert.deepEqual(s, { phase: 'huddle', timer: PACK_HUDDLE_S });
  s = advancePack(s, PACK_HUDDLE_S + 0.01, 3, 3, half);
  assert.equal(s.phase, 'roam');
  assert.equal(s.timer, (PACK_ROAM_S[0] + PACK_ROAM_S[1]) / 2);
});

test('stragglers are given up on; a pack with no one at the point goes back to roaming', () => {
  const gathering: PackState = { phase: 'gather', timer: PACK_GATHER_MAX_S };
  assert.equal(advancePack(gathering, PACK_GATHER_MAX_S + 1, 1, 3).phase, 'huddle');
  assert.equal(advancePack(gathering, PACK_GATHER_MAX_S + 1, 0, 3).phase, 'roam');
  // Knocked out dogs don't count: the two still standing are the whole pack.
  assert.equal(advancePack(gathering, 0.1, 2, 2).phase, 'huddle');
  assert.equal(advancePack(gathering, 0.1, 0, 0).phase, 'roam');
});

test('the meeting point is the junction central to the pack', () => {
  // A plus shape: the arms meet at (2, 2).
  const cols = 5;
  const rows = 5;
  const cells: MazeCells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ N: false, S: false, W: false, E: false })));
  for (let i = 0; i < 4; i++) {
    cells[2]![i]!.E = cells[2]![i + 1]!.W = true;
    cells[i]![2]!.S = cells[i + 1]![2]!.N = true;
  }
  assert.deepEqual(meetingPoint(cells, cols, rows, [{ x: 0, y: 2 }, { x: 4, y: 2 }, { x: 2, y: 4 }]), { x: 2, y: 2 });
  // Never somewhere it's told to avoid, and the dogs being cut off from each other means no pack at all.
  assert.notDeepEqual(meetingPoint(openGrid(6, 6), 6, 6, [{ x: 0, y: 0 }, { x: 5, y: 5 }], (x, y) => x === 2 && y === 3), { x: 2, y: 3 });
  cells[2]![1]!.E = cells[2]![2]!.W = false;
  assert.equal(meetingPoint(cells, cols, rows, [{ x: 0, y: 2 }, { x: 4, y: 2 }]), null);
});

test('in real mazes every dog can walk to the meeting point, and it is a junction whenever one is shared', () => {
  for (let run = 0; run < 40; run++) {
    const cols = 24;
    const rows = 18;
    const cells = generateMaze(cols, rows);
    const starts = Array.from({ length: 3 }, () => ({ x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }));
    const p = meetingPoint(cells, cols, rows, starts);
    assert.ok(p);
    for (const s of starts) assert.ok(bfs(cells, cols, rows, s.x, s.y)[p.y]![p.x]! >= 0);
    const c = cells[p.y]![p.x]!;
    const sides = [c.N && p.y > 0, c.S && p.y < rows - 1, c.W && p.x > 0, c.E && p.x < cols - 1].filter(Boolean).length;
    assert.ok(sides >= 3, `run ${run}: meets at a ${sides}-way cell`);
  }
});
