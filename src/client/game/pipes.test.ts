import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { planPipes, reachSpots, connected, crossing, lineCells, nearestOnPipes, pointOnLine, lineLength, shimmy, turnOnto, gripAtTower, towerUnder, gripFacing, pulseAlong, type PipePlan } from './pipes.ts';

const CELL = 4;

test('towers stand in free straight corridors against a side wall, reserved, spread apart, each with a pipe line through it', () => {
  for (let run = 0; run < 40; run++) {
    const cols = 24;
    const rows = 18;
    const cells = generateMaze(cols, rows);
    const dist = bfs(cells, cols, rows, 0, 0);
    const used = new Set(['0,0']);
    const plan = planPipes(cells, cols, rows, dist, used, 3);
    assert.equal(plan.towers.length, 3);
    for (const t of plan.towers) {
      const c = cells[t.y]![t.x]!;
      assert.ok((c.N && c.S && !c.E && !c.W) || (c.E && c.W && !c.N && !c.S), 'a straight stretch of corridor');
      assert.ok(!c[t.wall], 'the mast stands against a wall');
      assert.ok(used.has(`${t.x},${t.y}`), 'reserved');
      assert.ok(dist[t.y]![t.x]! >= 3);
      assert.ok(plan.lines.some((l) => lineCells(l).some((p) => p.x === t.x && p.y === t.y)), 'a line runs over it');
    }
    // Spread: no two towers next to each other.
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = plan.towers[i]!;
      const b = plan.towers[j]!;
      assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= 4, `towers ${i} and ${j} too close`);
    }
  }
});

test('there are rows and columns both, crossing, so the network is one piece with loops', () => {
  for (let run = 0; run < 40; run++) {
    const cells = generateMaze(24, 18);
    const plan = planPipes(cells, 24, 18, bfs(cells, 24, 18, 0, 0), new Set(['0,0']), 3);
    assert.ok(plan.lines.some((l) => l.axis === 'x') && plan.lines.some((l) => l.axis === 'z'));
    assert.ok(connected(plan));
    for (const l of plan.lines) assert.ok(l.from === 0 && l.to === (l.axis === 'x' ? 23 : 17), 'full span');
  }
});

test('crossings, the nearest point on the network, and points along a line', () => {
  const plan = {
    towers: [],
    lines: [
      { axis: 'x' as const, at: 2, from: 0, to: 9 },
      { axis: 'z' as const, at: 5, from: 0, to: 7 },
    ],
  };
  assert.deepEqual(crossing(plan.lines[0]!, plan.lines[1]!), { x: 5, y: 2 });
  assert.equal(crossing(plan.lines[0]!, plan.lines[0]!), null);
  // Just below the row line, near x = 3 cells: the row line, 12 m along, 1 m off.
  const near = nearestOnPipes(plan, 12, 2 * CELL + 1, CELL)!;
  assert.equal(near.line, 0);
  assert.equal(near.along, 12);
  assert.equal(near.distance, 1);
  assert.deepEqual(pointOnLine(plan, 1, 8, CELL), { x: 20, z: 8 });
  assert.equal(lineLength(plan, 0, CELL), 36);
});

test('a small floor still gets its tower, and a lone tower its own line', () => {
  const cells = generateMaze(6, 5);
  const plan = planPipes(cells, 6, 5, bfs(cells, 6, 5, 0, 0), new Set(['0,0']), 1);
  assert.equal(plan.towers.length, 1);
  assert.equal(plan.lines.length, 1);
  assert.ok(connected(plan));
});

// A row along y = 3 and a column along x = 5, crossing at (5, 3); a tower at (2, 3) on the row.
const HAND: PipePlan = {
  towers: [{ x: 2, y: 3, wall: 'N' }],
  lines: [
    { axis: 'x', at: 3, from: 0, to: 9 },
    { axis: 'z', at: 5, from: 0, to: 7 },
  ],
};

test('grabbing over a tower takes the line through it, facing the way the agent faces', () => {
  const east = gripAtTower(HAND, 0, { x: 1, z: 0 }, CELL);
  assert.deepEqual(east, { line: 0, along: 8, dir: 1 });
  const west = gripAtTower(HAND, 0, { x: -0.9, z: 0.1 }, CELL);
  assert.deepEqual(west, { line: 0, along: 8, dir: -1 });
  assert.equal(towerUnder(HAND, east!, CELL), 0);
  assert.equal(towerUnder(HAND, shimmy(HAND, east!, 1, CELL), CELL), -1);
});

test('shimmying moves along the facing and stops short of the ends', () => {
  const g = { line: 0, along: 8, dir: 1 as const };
  assert.equal(shimmy(HAND, g, 2, CELL).along, 10);
  assert.equal(shimmy(HAND, g, -2, CELL).along, 6);
  assert.equal(shimmy(HAND, { ...g, dir: -1 }, 2, CELL).along, 6);
  const end = shimmy(HAND, g, 100, CELL).along;
  assert.ok(end > lineLength(HAND, 0, CELL) && end < lineLength(HAND, 0, CELL) + CELL / 2);
  assert.ok(shimmy(HAND, g, -100, CELL).along < 0);
});

test('turning at a crossing swings onto the other line, to that side', () => {
  // Heading east (+x) along the row, at the crossing (x = 5): right is +z (south), left is -z.
  const atCross = { line: 0, along: 20, dir: 1 as const };
  const right = turnOnto(HAND, atCross, 1, CELL)!;
  assert.deepEqual(right, { line: 1, along: 12, dir: 1 });
  assert.deepEqual(gripFacing(HAND, right), { x: 0, z: 1 });
  assert.equal(turnOnto(HAND, atCross, -1, CELL)!.dir, -1);
  // Heading west, right is north.
  assert.equal(turnOnto(HAND, { ...atCross, dir: -1 }, 1, CELL)!.dir, -1);
  // Away from the crossing, no turn.
  assert.equal(turnOnto(HAND, { ...atCross, along: 18 }, 1, CELL), null);
  // And back again, onto the row where it crosses.
  const back = turnOnto(HAND, right, 1, CELL)!;
  assert.equal(back.line, 0);
  assert.equal(back.along, 20);
  const p = pointOnLine(HAND, back.line, back.along, CELL);
  assert.deepEqual(p, { x: 20, z: 12 });
});

test('a pulse runs its line to the far end and back, over and over', () => {
  assert.deepEqual(pulseAlong(-2, 38, 4, 0, 0), { along: -2, dir: 1 });
  assert.deepEqual(pulseAlong(-2, 38, 4, 0, 5), { along: 18, dir: 1 });
  assert.deepEqual(pulseAlong(-2, 38, 4, 0, 12), { along: 30, dir: -1 });
  assert.deepEqual(pulseAlong(-2, 38, 4, 0, 20), { along: -2, dir: 1 });
  assert.deepEqual(pulseAlong(-2, 38, 4, 40, 0), { along: 38, dir: -1 });
  for (let t = 0; t < 60; t += 0.37) {
    const p = pulseAlong(-2, 38, 4, 13, t);
    assert.ok(p.along >= -2 && p.along <= 38);
  }
});

test('a pipe is run over each room that has none, and the network stays one piece', () => {
  const base: PipePlan = { towers: [], lines: [{ axis: 'x', at: 3, from: 0, to: 9 }, { axis: 'z', at: 5, from: 0, to: 7 }] };
  const more = reachSpots(base, [{ x: 8, y: 6 }, { x: 2, y: 3 }, { x: 5, y: 1 }, { x: 1, y: 1 }], 10, 8);
  // (2, 3) is on the row already and (5, 1) on the column: nothing added for those.
  assert.equal(more.lines.length, 4);
  for (const spot of [{ x: 8, y: 6 }, { x: 2, y: 3 }, { x: 5, y: 1 }, { x: 1, y: 1 }]) {
    assert.ok(more.lines.some((l) => (l.axis === 'x' ? l.at === spot.y : l.at === spot.x)), `${spot.x},${spot.y} has a pipe over it`);
  }
  assert.ok(connected(more));
  assert.equal(base.lines.length, 2, 'the plan given is left alone');
});
