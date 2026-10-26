import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs, farthestCell, placeStair, stairReserved, type MazeCells } from './maze.ts';
import { difficultyFor } from './difficulty.ts';
import { planSecurity, navCellsFor, setPassage, OPPOSITE, DIR_DELTA, type SecurityPlan } from './security.ts';

const key = (x: number, y: number) => `${x},${y}`;

function openCount(cells: MazeCells, cols: number, rows: number, x: number, y: number): number {
  const c = cells[y]![x]!;
  let n = 0;
  if (c.N && y > 0) n++;
  if (c.S && y < rows - 1) n++;
  if (c.W && x > 0) n++;
  if (c.E && x < cols - 1) n++;
  return n;
}

function makePlan(level: number, storage = 2, network: ReadonlyArray<'uplink' | 'logs'> = ['uplink', 'logs']): { cells: MazeCells; cols: number; rows: number; plan: SecurityPlan; used: Set<string> } {
  const d = difficultyFor(level);
  const { cols, rows } = d;
  const cells = generateMaze(cols, rows);
  // Reserve exactly what game.ts does on floor 0 before planning: spawn, the
  // exit, the stair, and the unreachable cell past the top of the stairs —
  // the exit and that cell are both dead ends, which rooms compete for.
  const { x: ex, y: ey, dist } = farthestCell(cells, cols, rows, 0, 0);
  const used = new Set<string>(['0,0', `${ex},${ey}`]);
  const stair = placeStair(cols, rows, cells, dist, used);
  if (stair) for (const c of stairReserved(stair, 1)) used.add(`${c.x},${c.y}`);
  const plan = planSecurity(cells, cols, rows, dist, { x: 0, y: 0 }, used, { doors: d.doors, storage, decor: d.decorRooms, chain: d.chainedDoors, network });
  return { cells, cols, rows, plan, used };
}

/** Plays the unlock loop: a door opens once its terminal and server are both reachable. */
function simulateUnlocks(cells: MazeCells, cols: number, rows: number, plan: SecurityPlan): Set<number> {
  const nav = navCellsFor(cells, plan.doors, cols, rows);
  const opened = new Set<number>();
  for (let guard = 0; guard <= plan.doors.length; guard++) {
    const reach = bfs(nav, cols, rows, 0, 0);
    let progressed = false;
    for (const door of plan.doors) {
      if (opened.has(door.id)) continue;
      const mine = plan.rooms.filter((r) => r.keyId === door.id);
      if (mine.every((r) => reach[r.y]![r.x]! >= 0)) {
        setPassage(nav, door, true, cols, rows);
        opened.add(door.id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return opened;
}


test('every generated security plan is solvable: all doors can be opened in some order', () => {
  for (let i = 0; i < 300; i++) {
    const level = 1 + (i % 10);
    const { cells, cols, rows, plan } = makePlan(level);
    const opened = simulateUnlocks(cells, cols, rows, plan);
    assert.equal(opened.size, plan.doors.length, `level ${level}: ${plan.doors.length - opened.size} door(s) could never be opened`);
  }
});

test('doors actually get placed: job 1 often has a door, later jobs usually one or two', () => {
  let early = 0;
  let late = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    early += makePlan(1, 1, ['uplink']).plan.doors.length; // floor 0 of a job-1 run with stairs holds 1 of its 3 documents, and the uplink
    late += makePlan(8).plan.doors.length;
  }
  // Records rooms and the network rooms claim dead ends before
  // terminal/server pairs, so on the smallest (job 1) mazes most floors have
  // no locked section: measured ~0.4–0.5 doors per floor under game
  // conditions (the uplink closet costs about 0.25). A 14×10 floor (the
  // biggest) has only ~11 dead ends, so from job 3 it's ~0.85–1.1 of the 2
  // asked for: about two locked sections a job, over its two floors.
  assert.ok(early / N >= 0.3, `job 1 averaged ${(early / N).toFixed(2)} doors`);
  assert.ok(late / N >= 0.7, `job 8 averaged ${(late / N).toFixed(2)} doors`);
});

test('each door has exactly one terminal and one server, never inside its own or a later section', () => {
  for (let i = 0; i < 200; i++) {
    const { plan } = makePlan(1 + (i % 10));
    for (const door of plan.doors) {
      const mine = plan.rooms.filter((r) => r.keyId === door.id);
      assert.deepEqual(mine.map((r) => r.kind).sort(), ['server', 'terminal']);
      for (const r of mine) {
        const region = plan.section[r.y]![r.x]!;
        assert.ok(region === -1 || region < door.id, `room for door ${door.id} sits in section ${region}`);
      }
    }
  }
});

test('chained doors: from job 5, a later door\'s terminal and server usually sit behind the door before it', () => {
  let chained = 0;
  let later = 0;
  // Two doors on one floor are the exception on a 14×10 floor (~15%), so it takes a lot of plans to see enough of them.
  for (let i = 0; i < 1000; i++) {
    const { plan } = makePlan(8);
    for (const door of plan.doors) {
      if (door.id === 0) continue;
      later++;
      const rooms = plan.rooms.filter((r) => r.keyId === door.id);
      if (rooms.every((r) => plan.section[r.y]![r.x] === door.id - 1)) chained++;
    }
  }
  assert.ok(later > 0);
  assert.ok(chained / later >= 0.5, `only ${chained} of ${later} later doors were chained`);
});

test('sections are non-empty, disjoint, and the door opens directly into its own section', () => {
  for (let i = 0; i < 200; i++) {
    const { cols, rows, plan } = makePlan(1 + (i % 10));
    for (const door of plan.doors) {
      const [dx, dy] = DIR_DELTA[door.dir];
      assert.equal(plan.section[door.y + dy]![door.x + dx], door.id, 'the cell beyond a door belongs to that door');
      assert.notEqual(plan.section[door.y]![door.x], door.id, 'the near side of a door is outside its section');
      let count = 0;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (plan.section[y]![x] === door.id) count++;
      assert.ok(count > 0);
    }
  }
});

test('rooms are dead-end pockets opening in openDir, never overlapping each other or spawn', () => {
  for (let i = 0; i < 200; i++) {
    const { cells, cols, rows, plan, used } = makePlan(1 + (i % 10));
    const seen = new Set<string>();
    for (const r of plan.rooms) {
      assert.equal(openCount(cells, cols, rows, r.x, r.y), 1, 'innermost room cell is a dead end');
      assert.ok(cells[r.y]![r.x]![r.openDir], 'the dead end opens toward openDir');
      if (r.cells.length === 2) {
        const [n] = [r.cells[1]!];
        const c = cells[n.y]![n.x]!;
        assert.ok(c[r.openDir] && c[OPPOSITE[r.openDir]], 'a 2-cell room runs straight');
      }
      for (const c of r.cells) {
        const k = key(c.x, c.y);
        assert.ok(!seen.has(k), 'rooms never share a cell');
        assert.notEqual(k, '0,0');
        assert.ok(used.has(k), 'room cells are reserved in used');
        seen.add(k);
      }
    }
  }
});

test('navCellsFor closes door passages on both sides without touching the source maze', () => {
  const { cells, cols, rows, plan } = makePlan(4);
  const nav = navCellsFor(cells, plan.doors, cols, rows);
  for (const d of plan.doors) {
    const [dx, dy] = DIR_DELTA[d.dir];
    assert.equal(nav[d.y]![d.x]![d.dir], false);
    assert.equal(nav[d.y + dy]![d.x + dx]![OPPOSITE[d.dir]], false);
    assert.equal(cells[d.y]![d.x]![d.dir], true, 'source maze keeps the passage open (no wall is drawn there)');
  }
});

test('requested documents get storage-room lockers in practically every maze', () => {
  // The only way a document goes unplaced is a floor with no free dead end at
  // all (measured ~0.1% of the smallest job-1 mazes); game.ts counts what was
  // actually placed, so such a job is still winnable.
  let complete = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const level = 1 + (i % 10);
    const { plan } = makePlan(level, 3);
    const storage = plan.rooms.filter((r) => r.kind === 'storage');
    if (storage.reduce((n, r) => n + r.docs, 0) === 3) complete++;
    for (const r of plan.rooms) {
      if (r.kind === 'storage') assert.ok(r.docs >= 1 && r.docs <= 3);
      else assert.equal(r.docs, 0);
    }
  }
  assert.ok(complete / N >= 0.98, `only ${complete}/${N} plans placed every document`);
});

test('every locked section holds a storage room when there are enough documents to go round', () => {
  let sections = 0;
  let covered = 0;
  for (let i = 0; i < 300; i++) {
    const { plan } = makePlan(1 + (i % 10), 3);
    for (const door of plan.doors) {
      sections++;
      if (plan.rooms.some((r) => r.kind === 'storage' && plan.section[r.y]![r.x] === door.id)) covered++;
    }
  }
  assert.ok(covered / sections >= 0.95, `only ${covered}/${sections} locked sections held a storage room`);
});

test('the uplink closet and the log server get a room each, usually outside the locked sections', () => {
  let placed = 0;
  let open = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const { plan } = makePlan(1 + (i % 10));
    for (const kind of ['uplink', 'logs'] as const) {
      const rooms = plan.rooms.filter((r) => r.kind === kind);
      assert.ok(rooms.length <= 1, `two ${kind} rooms`);
      if (!rooms[0]) continue;
      placed++;
      if (plan.section[rooms[0].y]![rooms[0].x] === -1) open++;
    }
  }
  assert.ok(placed / (2 * N) >= 0.9, `only ${placed} of ${2 * N} placed`);
  assert.ok(open / placed >= 0.8, `only ${open} of ${placed} in the open`);
});

test('on a floor with loops a door only goes where it really seals a section, and the plan stays solvable', () => {
  // A maze with its walls knocked out here and there (a sketch's rings and open rooms): every door must be a bridge, or it would simply be walked round.
  let doors = 0;
  let loops = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const d = difficultyFor(8);
    const { cols, rows } = d;
    let s = seed * 2654435761;
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const cells = generateMaze(cols, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x < cols - 1 && !cells[y]![x]!.E && rnd() < 0.06) { cells[y]![x]!.E = true; cells[y]![x + 1]!.W = true; loops++; }
        if (y < rows - 1 && !cells[y]![x]!.S && rnd() < 0.06) { cells[y]![x]!.S = true; cells[y + 1]![x]!.N = true; loops++; }
      }
    }
    const { x: ex, y: ey, dist } = farthestCell(cells, cols, rows, 0, 0);
    const used = new Set<string>(['0,0', `${ex},${ey}`]);
    const plan = planSecurity(cells, cols, rows, dist, { x: 0, y: 0 }, used, { doors: 2, storage: 2, decor: 2, chain: false, network: ['uplink', 'logs'] });
    for (const door of plan.doors) {
      doors++;
      const nav = navCellsFor(cells, [door], cols, rows);
      const reach = bfs(nav, cols, rows, 0, 0);
      const beyond = { x: door.x + DIR_DELTA[door.dir][0], y: door.y + DIR_DELTA[door.dir][1] };
      assert.equal(reach[beyond.y]![beyond.x]!, -1, `seed ${seed}: door ${door.id} at ${door.x},${door.y} ${door.dir} is walked round`);
    }
    assert.equal(simulateUnlocks(cells, cols, rows, plan).size, plan.doors.length, `seed ${seed}: unlockable`);
  }
  assert.ok(loops > 100 && doors > 10, `loops ${loops}, doors ${doors}`);
});
