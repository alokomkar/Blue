import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpec } from './levelspec.ts';
import { MAX_DEAD_END_SHARE, MIN_EXIT_STEPS, checkFloors, checkGrid, checkPlacement, checkSpec, type Cell, type VerifyFloor } from './verify.ts';

const closed = (): Cell => ({ N: false, S: false, E: false, W: false });

/** A floor of solid cells, then `links` opened out: [x, y, 'E' | 'S'] joins a cell to the one east or south of it. */
function floorOf(cols: number, rows: number, links: Array<[number, number, 'E' | 'S']>, over: Partial<VerifyFloor> = {}): VerifyFloor {
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, closed));
  for (const [x, y, dir] of links) {
    if (dir === 'E') {
      cells[y]![x]!.E = true;
      cells[y]![x + 1]!.W = true;
    } else {
      cells[y]![x]!.S = true;
      cells[y + 1]![x]!.N = true;
    }
  }
  return { floor: 0, cols, rows, cells, start: { x: 0, y: 0 }, exit: { x: cols - 1, y: 0 }, stair: null, guards: [], lasers: [], hazards: [], doors: [], stations: [], ...over };
}

/** One row of `n` cells, start at the west end, exit at the east. */
const corridor = (n: number, over: Partial<VerifyFloor> = {}): VerifyFloor =>
  floorOf(n, 1, Array.from({ length: n - 1 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), over);

const codes = (floors: VerifyFloor[], fn: typeof checkFloors = checkFloors, opts = {}): string[] => fn(floors, opts).failures.map((f) => f.code);

test('V1: a sound spec passes, and each kind of fault is a failure with its code and a sentence', () => {
  assert.deepEqual(checkSpec(defaultSpec()), { ok: true, failures: [] });
  const bad = checkSpec({ ...defaultSpec(), place: 'moon', roster: { ...defaultSpec().roster, guards: 40 }, size: { cols: 3, rows: 8 } });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map((f) => f.code), ['bad_field', 'bad_field', 'bad_field']);
  assert.ok(bad.failures.every((f) => f.message.length > 10 && f.where === undefined));
  assert.match(bad.failures[0]!.message, /place/);
  const misfit = checkSpec({ ...defaultSpec(), contract: 'sabotage', twists: ['silent'] });
  assert.deepEqual(misfit.failures.map((f) => f.code), ['twist_misfit']);
  assert.match(misfit.failures[0]!.message, /silent/);
  assert.deepEqual(checkSpec({ ...defaultSpec(), twists: ['timer', 'lockdown'] }).failures.map((f) => f.code), ['twist_misfit']);
  assert.equal(checkSpec('nonsense').ok, false);
  assert.equal(checkSpec(null).failures[0]!.code, 'bad_field');
  assert.equal(checkSpec({ ...defaultSpec(), extra: 1 }).ok, false);
});

test('a plain corridor with everything in its place passes V2 and V3', () => {
  const f = corridor(14, { guards: [{ x: 10, y: 0, kind: 'guard' }], lasers: [{ x: 6, y: 0 }], hazards: [{ x: 9, y: 0, kind: 'gate' }], stations: [{ kind: 'storage', x: 7, y: 0 }], expect: { storage: 1, stair: false } });
  assert.deepEqual(checkFloors([f]), { ok: true, failures: [] });
  assert.equal(MIN_EXIT_STEPS, 12);
  assert.equal(MAX_DEAD_END_SHARE, 0.4);
});

test('V2 unreachable: a cell no walk from the start reaches, an exit in such a pocket, and a start walled in', () => {
  const links: Array<[number, number, 'E' | 'S']> = [...Array.from({ length: 13 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), [3, 2, 'E']];
  const island = floorOf(14, 3, links);
  const r = checkGrid([island]);
  assert.deepEqual(r.failures.map((f) => f.code), ['unreachable']);
  assert.deepEqual(r.failures[0]!.where, { x: 3, y: 2, floor: 0 });
  assert.match(r.failures[0]!.message, /2 cells/);
  // Solid blocks (walled in on every side, like a utility core) are not floor, and nothing is meant to reach them.
  assert.deepEqual(checkGrid([floorOf(14, 3, links.slice(0, 13))]).failures, []);
  // The exit in the island.
  const lost = checkGrid([{ ...island, exit: { x: 4, y: 2 } }]);
  assert.deepEqual(lost.failures.map((f) => f.message.split(' ').slice(0, 3).join(' ')), ['2 cells on', 'the exit (4,2)']);
  assert.deepEqual(lost.failures[1]!.where, { x: 4, y: 2, floor: 0 });
  assert.equal(lost.failures[1]!.code, 'unreachable');
  // A start cell with no opening.
  const walled = checkGrid([{ ...corridor(14), start: { x: 5, y: 0 }, cells: corridor(14).cells.map((row) => row.map((c, x) => (x === 5 ? closed() : c))) }]);
  assert.ok(walled.failures.some((f) => f.code === 'unreachable'));
});

test('V2 exit_close: an exit under twelve steps from the start, and the number is an option', () => {
  const short = corridor(8);
  const r = checkGrid([short]);
  assert.deepEqual(r.failures.map((f) => f.code), ['exit_close']);
  assert.match(r.failures[0]!.message, /7 steps.*at least 12/);
  assert.deepEqual(checkGrid([short], { minExitSteps: 7 }).failures, []);
  assert.deepEqual(checkGrid([corridor(13)]).failures, []); // twelve steps exactly
  assert.deepEqual(codes([corridor(12)], checkGrid), ['exit_close']);
});

test('V2 mostly_dead_ends: one dead-end corridor holding more than 40% of the cells', () => {
  // A main corridor of 14 cells with a 1-wide cul-de-sac of 14 more hanging off its middle: half the floor.
  const spine = Array.from({ length: 13 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']);
  const stem = Array.from({ length: 14 }, (_, y) => [6, y, 'S'] as [number, number, 'S']);
  const comb = floorOf(14, 15, [...spine, ...stem]);
  const r = checkGrid([comb]);
  assert.deepEqual(r.failures.map((f) => f.code), ['mostly_dead_ends']);
  assert.deepEqual(r.failures[0]!.where, { x: 6, y: 14, floor: 0 });
  assert.match(r.failures[0]!.message, /14 of the floor's 28 cells \(50%/);
  assert.deepEqual(checkGrid([comb], { maxDeadEndShare: 0.5 }).failures, []);
  // The same cells with the cul-de-sac cut to five (a room or two) are fine.
  assert.deepEqual(checkGrid([floorOf(14, 15, [...spine, ...stem.slice(0, 5)])]).failures, []);
  // The way through is not a dead end however long it is: a floor that is one long corridor passes.
  assert.deepEqual(checkGrid([corridor(14)]).failures, []);
});

test('V3 spawn_close: an enemy too near the start, by the game\'s own lead, and a hazard on the start cell', () => {
  const near = corridor(14, { guards: [{ x: 3, y: 0, kind: 'watchdog' }, { x: 10, y: 0, kind: 'guard' }] });
  const r = checkPlacement([near]);
  assert.deepEqual(r.failures.map((f) => f.code), ['spawn_close']);
  assert.match(r.failures[0]!.message, /watchdog starts 3 steps.*at least 7/); // 55% of the floor's 13 steps, under the eight a big floor gets
  assert.deepEqual(r.failures[0]!.where, { x: 3, y: 0, floor: 0 });
  assert.deepEqual(checkPlacement([near], { minSpawnSteps: 3 }).failures, []);
  assert.deepEqual(checkPlacement([near], { minSpawnSteps: 8 }).failures.map((f) => f.message.match(/at least (\d+)/)![1]), ['8']);
  // A floor big enough for it asks the full eight.
  assert.match(checkPlacement([corridor(20, { guards: [{ x: 7, y: 0, kind: 'drone' }] })]).failures[0]!.message, /drone starts 7 steps.*at least 8/);
  // A hazard on the start.
  for (const over of [{ lasers: [{ x: 0, y: 0 }] }, { hazards: [{ x: 0, y: 0, kind: 'line' as const }] }, { doors: [{ id: 0, x: 0, y: 0, dir: 'E' as const }] }]) {
    assert.deepEqual(codes([corridor(14, over)], checkPlacement), ['spawn_close', ...(over.doors ? ['station_unreachable', 'station_unreachable'] : [])], JSON.stringify(over));
  }
  // An enemy walled off from the start is not near it.
  assert.deepEqual(checkPlacement([floorOf(14, 2, [...Array.from({ length: 13 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), [1, 1, 'E']], { guards: [{ x: 1, y: 1, kind: 'guard' }] })]).failures, []);
});

test('V3 blocked_exit: a hazard on the exit, and lasers every way out has to cross', () => {
  assert.deepEqual(codes([corridor(14, { lasers: [{ x: 13, y: 0 }] })], checkPlacement), ['blocked_exit']);
  assert.deepEqual(codes([corridor(14, { hazards: [{ x: 13, y: 0, kind: 'gate' }] })], checkPlacement), ['blocked_exit']);
  const two = corridor(14, { lasers: [{ x: 4, y: 0 }, { x: 9, y: 0 }] });
  const r = checkPlacement([two]);
  assert.deepEqual(r.failures.map((f) => f.code), ['blocked_exit']);
  assert.match(r.failures[0]!.message, /crosses 2 trip lasers.*first at \(4,0\).*at most 1/);
  assert.deepEqual(r.failures[0]!.where, { x: 4, y: 0, floor: 0 });
  // One is a cloak's worth; the design's own rule allows none.
  assert.deepEqual(checkPlacement([corridor(14, { lasers: [{ x: 4, y: 0 }] })]).failures, []);
  assert.deepEqual(codes([corridor(14, { lasers: [{ x: 4, y: 0 }] })], checkPlacement, { laserCrossings: 0 }), ['blocked_exit']);
  assert.deepEqual(checkPlacement([two], { laserCrossings: 2 }).failures, []);
  // A second way round: two rows joined at both ends, a laser on the top row only.
  const loop = floorOf(14, 2, [...Array.from({ length: 13 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), ...Array.from({ length: 13 }, (_, x) => [x, 1, 'E'] as [number, number, 'E']), [0, 0, 'S'], [13, 0, 'S']], { lasers: [{ x: 4, y: 0 }, { x: 9, y: 0 }] });
  assert.deepEqual(checkPlacement([loop], { laserCrossings: 0 }).failures, []);
  // ... and shut on both rows it is not.
  assert.deepEqual(codes([{ ...loop, lasers: [{ x: 4, y: 0 }, { x: 4, y: 1 }] }], checkPlacement, { laserCrossings: 0 }), ['blocked_exit']);
});

test('V3 station_unreachable: a stair, a records room or a door the plan never delivered', () => {
  const stair = checkPlacement([corridor(14, { expect: { storage: 0, stair: true } })]);
  assert.deepEqual(stair.failures.map((f) => f.code), ['station_unreachable']);
  assert.match(stair.failures[0]!.message, /no stair/);
  assert.deepEqual(checkPlacement([corridor(14, { expect: { storage: 0, stair: true }, stair: { x: 5, y: 0 } })]).failures, []);
  const rooms = checkPlacement([corridor(14, { expect: { storage: 2, stair: false } })]);
  assert.match(rooms.failures[0]!.message, /no records room.*2 documents/);
  assert.deepEqual(checkPlacement([corridor(14, { expect: { storage: 2, stair: false }, stations: [{ kind: 'storage', x: 6, y: 0 }] })]).failures, []);
});

test('V3 station_unreachable: a room in a pocket nothing connects, and a stair or an exit that way', () => {
  const links: Array<[number, number, 'E' | 'S']> = [...Array.from({ length: 13 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), [3, 2, 'E']];
  const r = checkPlacement([floorOf(14, 3, links, { stations: [{ kind: 'storage', x: 3, y: 2 }, { kind: 'uplink', x: 5, y: 0 }], stair: { x: 4, y: 2 } })]);
  assert.deepEqual(r.failures.map((f) => f.code), ['station_unreachable', 'station_unreachable']);
  assert.deepEqual(r.failures.map((f) => f.where), [{ x: 3, y: 2, floor: 0 }, { x: 4, y: 2, floor: 0 }]);
  assert.match(r.failures[0]!.message, /storage/);
  assert.match(r.failures[1]!.message, /stair/);
});

test('V3 doors: opened as the game opens them, in any order, by a terminal and a server that can be reached', () => {
  const door = (id: number, x: number) => ({ id, x, y: 0, dir: 'E' as const });
  const rooms = (id: number, terminalX: number, serverX: number) => [
    { kind: 'terminal', x: terminalX, y: 0, keyId: id },
    { kind: 'server', x: serverX, y: 0, keyId: id },
  ];
  // Both controls before the door: it opens, and what is behind it can be reached.
  const open = corridor(14, { doors: [door(0, 6)], stations: [...rooms(0, 2, 4), { kind: 'storage', x: 9, y: 0 }] });
  assert.deepEqual(checkPlacement([open]).failures, []);
  // A chain: door B's controls are behind door A.
  const chain = corridor(14, { doors: [door(0, 4), door(1, 9)], stations: [...rooms(0, 1, 2), ...rooms(1, 6, 7), { kind: 'storage', x: 11, y: 0 }] });
  assert.deepEqual(checkPlacement([chain]).failures, []);
  // The wrong way round: door A's controls behind door B, B's behind A. Neither can be opened.
  const knot = corridor(14, { doors: [door(0, 4), door(1, 9)], stations: [...rooms(0, 11, 12), ...rooms(1, 6, 7)] });
  const stuck = checkPlacement([knot]);
  assert.deepEqual(stuck.failures.filter((f) => /cannot be opened/.test(f.message)).map((f) => f.message.slice(0, 6)), ['door A', 'door B']);
  assert.ok(stuck.failures.every((f) => f.code === 'station_unreachable'));
  assert.deepEqual(stuck.failures[0]!.where, { x: 4, y: 0, floor: 0 });
  // A door with no terminal, or no server, never opens.
  const bare = corridor(14, { doors: [door(0, 6)], stations: [{ kind: 'terminal', x: 2, y: 0, keyId: 0 }, { kind: 'storage', x: 9, y: 0 }] });
  // (the door, the room behind it, and the exit behind that)
  assert.deepEqual(checkPlacement([bare]).failures.map((f) => f.code), ['station_unreachable', 'station_unreachable', 'station_unreachable']);
  // The exit behind a door that can't be opened is not reachable either.
  assert.ok(checkPlacement([corridor(14, { doors: [door(0, 12)] })]).failures.some((f) => /the exit/.test(f.message)));
});

test('failures carry the floor they are on, and every floor is checked', () => {
  const upper = { ...corridor(14, { exit: null, guards: [{ x: 2, y: 0, kind: 'guard' as const }] }), floor: 1 };
  const r = checkFloors([corridor(14), upper]);
  assert.deepEqual(r.failures.map((f) => [f.code, f.where?.floor]), [['spawn_close', 1]]);
  assert.match(r.failures[0]!.message, /floor 1/);
  // A floor with no exit is not asked for a walk to one.
  assert.deepEqual(checkGrid([{ ...corridor(6), exit: null }]).failures, []);
  assert.equal(checkFloors([]).ok, true);
});

test('every failure has a code from the design, a message and a place', () => {
  const all = checkFloors([
    floorOf(14, 3, [...Array.from({ length: 7 }, (_, x) => [x, 0, 'E'] as [number, number, 'E']), [3, 2, 'E']], {
      exit: { x: 7, y: 0 },
      guards: [{ x: 1, y: 0, kind: 'guard' }],
      lasers: [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 7, y: 0 }],
      stations: [{ kind: 'storage', x: 3, y: 2 }],
      expect: { storage: 1, stair: true },
    }),
  ]);
  const seen = new Set(all.failures.map((f) => f.code));
  assert.deepEqual([...seen].sort(), ['blocked_exit', 'exit_close', 'spawn_close', 'station_unreachable', 'unreachable']);
  for (const f of all.failures) {
    assert.ok(f.message.length > 10);
    assert.ok(f.where && Number.isInteger(f.where.x) && Number.isInteger(f.where.y) && f.where.floor === 0);
  }
});
