import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBunkerGoal, pickGoal, stepToward, resolveGoalTarget, type BunkerSites, type Goal } from './guide.ts';
import { bfs, generateMaze, type MazeCells } from './maze.ts';

const g = (kind: Goal['kind'], cost: number, floor = 0): Goal => ({ kind, floor, x: 0, y: 0, cost });
const sites: BunkerSites = { clue: (l) => ({ x: 10 + l, y: 20 + l }), dossier: { level: 2, x: 5, y: 6 }, exit: { level: 3, x: 26, y: 50 } };

test('the uplink first while it is up, then the nearest records room, the logs when queued, and the exit last', () => {
  const goals = [g('exit', 5), g('files', 30), g('files', 12), g('uplink', 40), g('logs', 8)];
  assert.equal(pickGoal(goals, { uplinkOnline: true, filesLeft: 2, logsPending: false })!.kind, 'uplink');
  const files = pickGoal(goals, { uplinkOnline: false, filesLeft: 2, logsPending: false })!;
  assert.deepEqual([files.kind, files.cost], ['files', 12]);
  assert.equal(pickGoal(goals, { uplinkOnline: false, filesLeft: 0, logsPending: true })!.kind, 'logs');
  assert.equal(pickGoal(goals, { uplinkOnline: false, filesLeft: 0, logsPending: false })!.kind, 'exit');
  assert.equal(pickGoal([g('exit', 1)], { uplinkOnline: false, filesLeft: 1, logsPending: false }), null, 'no records room left to find, but the exit is not yet open');
  assert.equal(pickGoal([], { uplinkOnline: true, filesLeft: 0, logsPending: false }), null);
});

test('with no uplink to take down the guide goes straight on to the files', () => {
  assert.equal(pickGoal([g('files', 3), g('exit', 1)], { uplinkOnline: true, filesLeft: 1, logsPending: false })!.kind, 'files');
});

test('walking toward a target follows the corridors, a few cells ahead, and says how far is left', () => {
  for (let run = 0; run < 30; run++) {
    const cols = 12;
    const rows = 8;
    const cells = generateMaze(cols, rows);
    const target = { x: cols - 1, y: rows - 1 };
    const dist = bfs(cells, cols, rows, target.x, target.y);
    const from = { x: 0, y: 0 };
    const step = stepToward(dist, cells, from, 3)!;
    assert.equal(step.left, dist[0]![0]);
    assert.equal(dist[step.to.y]![step.to.x], step.left - Math.min(3, step.left), 'three cells nearer');
    // Walking it cell by cell gets there.
    let cur = from;
    for (let i = 0; i < 400 && dist[cur.y]![cur.x]! > 0; i++) cur = stepToward(dist, cells, cur, 1)!.to;
    assert.deepEqual(cur, target);
  }
});

test('no way, no guide', () => {
  const cells = generateMaze(4, 4);
  const dist = cells.map((row) => row.map(() => -1));
  assert.equal(stepToward(dist, cells, { x: 0, y: 0 }, 3), null);
  const here = stepToward(Object.assign([[0]], {}), [[{ N: false, S: false, E: false, W: false }]], { x: 0, y: 0 }, 3)!;
  assert.deepEqual([here.to, here.left], [{ x: 0, y: 0 }, 0]);
});

test('resolveGoalTarget intercepts objectives behind a locked door and directs to terminal then server', () => {
  // A straight 4-cell horizontal corridor: (0,0) - (1,0) - (2,0) - (3,0)
  // Door 0 is at (1,0) going E into (2,0).
  // Player is at (0,0).
  // Terminal 0 is at (0,0).
  // Server 0 is at (1,0).
  // Objective is at (3,0).
  const cells: MazeCells = [
    [
      { N: false, S: false, E: true, W: false },
      { N: false, S: false, E: true, W: true },
      { N: false, S: false, E: true, W: true },
      { N: false, S: false, E: false, W: true },
    ],
  ];
  // navCells has door (1,0)->E closed
  const navCells: MazeCells = [
    [
      { N: false, S: false, E: true, W: false },
      { N: false, S: false, E: false, W: true },
      { N: false, S: false, E: true, W: false },
      { N: false, S: false, E: false, W: true },
    ],
  ];

  const door = { id: 0, x: 1, y: 0, dir: 'E' as const, isOpen: false };
  const terminal = { keyId: 0, x: 0, y: 0, hacked: false };
  const server = { keyId: 0, x: 1, y: 0, online: false };

  // Step 1: Terminal unhacked -> should target terminal
  const res1 = resolveGoalTarget({
    bfs,
    navCells,
    cells,
    cols: 4,
    rows: 1,
    from: { x: 0, y: 0 },
    target: { x: 3, y: 0 },
    defaultLabel: 'Records room',
    doors: [door],
    terminals: [terminal],
    servers: [server],
  });
  assert.deepEqual(res1, { target: { x: 0, y: 0 }, label: 'Terminal A', locked: false });

  // Step 2: Terminal hacked, Server offline -> should target server
  const res2 = resolveGoalTarget({
    bfs,
    navCells,
    cells,
    cols: 4,
    rows: 1,
    from: { x: 0, y: 0 },
    target: { x: 3, y: 0 },
    defaultLabel: 'Records room',
    doors: [door],
    terminals: [{ ...terminal, hacked: true }],
    servers: [server],
  });
  assert.deepEqual(res2, { target: { x: 1, y: 0 }, label: 'Server A', locked: false });

  // Step 3: Door unlocked in navCells -> should target records room
  const openNavCells: MazeCells = [
    [
      { N: false, S: false, E: true, W: false },
      { N: false, S: false, E: true, W: true },
      { N: false, S: false, E: true, W: true },
      { N: false, S: false, E: false, W: true },
    ],
  ];
  const res3 = resolveGoalTarget({
    bfs,
    navCells: openNavCells,
    cells,
    cols: 4,
    rows: 1,
    from: { x: 0, y: 0 },
    target: { x: 3, y: 0 },
    defaultLabel: 'Records room',
    doors: [{ ...door, isOpen: true }],
    terminals: [{ ...terminal, hacked: true }],
    servers: [{ ...server, online: true }],
  });
  assert.deepEqual(res3, { target: { x: 3, y: 0 }, label: 'Records room', locked: false });
});


test('in the bunker nothing is pointed at before the first terminal is hacked', () => {
  assert.equal(pickBunkerGoal({ needed: [0, 1], hacked: new Set(), found: false }, sites), null);
});

test('after a hack the arrow goes to the lowest terminal still to hack on the way to the dossier', () => {
  const g = pickBunkerGoal({ needed: [0, 1, 2], hacked: new Set([0]), found: false }, sites)!;
  assert.deepEqual([g.kind, g.floor, g.x, g.y], ['clue', 1, 11, 21]);
  // hacked out of order: the lowest left is still the next
  const h = pickBunkerGoal({ needed: [0, 1, 2], hacked: new Set([1]), found: false }, sites)!;
  assert.deepEqual([h.kind, h.floor], ['clue', 0]);
});

test('with the last terminal hacked the arrow goes to the dossier\'s container', () => {
  const g = pickBunkerGoal({ needed: [0, 1], hacked: new Set([0, 1]), found: false }, sites)!;
  assert.deepEqual([g.kind, g.floor, g.x, g.y], ['dossier', 2, 5, 6]);
  assert.equal(pickBunkerGoal({ needed: [0, 1], hacked: new Set([0, 1]), found: false }, { ...sites, dossier: null }), null, 'no container to point at');
});

test('once the dossier is read the arrow points at the way out, whatever else is left', () => {
  const g = pickBunkerGoal({ needed: [0, 1, 2], hacked: new Set(), found: true }, sites)!;
  assert.deepEqual([g.kind, g.floor, g.x, g.y], ['exit', 3, 26, 50]);
});

test('a chain of stops on one floor points at each stop on that floor, not at a floor numbered like the stop', () => {
  const sites = { clue: (i: number) => ({ level: 0, x: i, y: 1 }), dossier: { level: 0, x: 9, y: 9 }, exit: { level: 0, x: 0, y: 0 } };
  const goal = pickBunkerGoal({ needed: [0, 1, 2], hacked: new Set([0]), found: false }, sites);
  assert.deepEqual(goal, { kind: 'clue', floor: 0, x: 1, y: 1, cost: 0 });
});
