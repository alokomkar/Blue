import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTraining,
  TRAINING_MAP,
  STATIONS,
  TRAINING_BLACKOUT,
  TRAINING_SWITCHES,
  TRAINING_KIT,
  TRAINING_DRONE_YARD,
  advance,
  CEILING_MAP,
  CEILING_STATIONS,
  CEILING_SWEEPERS,
  CEILING_SLIDERS,
  CEILING_SHUTTERS,
  CEILING_PIPES,
  CEILING_COLUMN,
  CEILING_GUARD,
  CEILING_PULSES_FROM,
  GRAPPLE_MAP,
  GRAPPLE_STATIONS,
  GRAPPLE_PIPES,
  GRAPPLE_GUARD,
  STEALTH_MAP,
  STEALTH_STATIONS,
  STEALTH_GUARD,
  WEAPONS_MAP,
  WEAPONS_STATIONS,
  WEAPONS_SENTRY_FACING,
  WEAPONS_HEAVY_FACING,
  WEAPONS_TRAP_HEAVY_FACING,
  COVER_MAP,
  COVER_STATIONS,
  CORNERS_MAP,
  CORNERS_STATIONS,
  CORNERS_PIPES,
  CORNERS_GUARDS,
  WALL_MAP,
  WALL_STATIONS,
  HIGHWALL_MAP,
  HIGHWALL_STATIONS,
  HIGHWALL_GUARDS,
  HIGHWALL_COLUMNS,
  WALL_GUARDS,
  DOCK_STATIONS,
  RANGE_STATIONS,
  TOWER_STATIONS,
  type TrainingProgress,
  type Passage,
} from './tutorial.ts';
import { ACTIONS, DEFAULT_KEYS, withKeys } from '../../shared/controls.ts';
import { readFileSync } from 'node:fs';
import { botCanSee, exposure, DETECT_RADIUS, SNEAK_DETECT_RADIUS, AWARE_RADIUS, SNEAK_AWARE_RADIUS } from './detection.ts';
import { PRONE_AWARE, PRONE_SIGHT } from './posture.ts';
import { bfs, type MazeCells } from './maze.ts';
import { connected, crossing, gripAtTower, hookPoint, pointOnLine, turnOnto } from './pipes.ts';
import { FAST_SLIDE_SPEED, SLIDE_SPEED } from './movingLasers.ts';

const layout = parseTraining(TRAINING_MAP);
const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;

/** The maze with these passages shut. */
function closed(cells: MazeCells, passages: Passage[]): MazeCells {
  const out = cells.map((row) => row.map((c) => ({ ...c })));
  for (const p of passages) {
    out[p.y]![p.x]![p.dir] = false;
    out[p.y + DELTA[p.dir][1]]![p.x + DELTA[p.dir][0]]![OPP[p.dir]] = false;
  }
  return out;
}

function reachable(
  cells: MazeCells,
  from: { x: number; y: number }
): number[][] {
  return bfs(cells, layout.cols, layout.rows, from.x, from.y);
}

test('the training map parses into a consistent maze with every mark placed', () => {
  assert.equal(layout.cols, 14);
  assert.equal(layout.rows, 7);
  for (let y = 0; y < layout.rows; y++) {
    for (let x = 0; x < layout.cols; x++) {
      const c = layout.cells[y]![x]!;
      // Both sides of every wall agree.
      if (x + 1 < layout.cols)
        assert.equal(
          c.E,
          layout.cells[y]![x + 1]!.W,
          `E/W mismatch at ${x},${y}`
        );
      if (y + 1 < layout.rows)
        assert.equal(
          c.S,
          layout.cells[y + 1]![x]!.N,
          `N/S mismatch at ${x},${y}`
        );
    }
  }
  for (const m of [
    '@',
    '*',
    'g',
    'c',
    'o',
    'L',
    'h',
    'd',
    't',
    's',
    '$',
    'u',
    'l',
    'X',
    'p',
    'M',
    'k',
    'q',
    'b',
    'e',
  ] as const)
    assert.ok(layout.marks[m], `missing mark ${m}`);
  assert.deepEqual(layout.gates.map((g) => g.id).sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(layout.packDogs.length, 2);
  assert.equal(layout.doors.length, 1);
});

test('rooms and lifts sit in dead ends', () => {
  for (const m of ['@', 'o', 't', 's', '$', 'u', 'l', 'X'] as const) {
    const { x, y } = layout.marks[m]!;
    const c = layout.cells[y]![x]!;
    assert.equal(
      [c.N, c.S, c.E, c.W].filter(Boolean).length,
      1,
      `${m} at ${x},${y} is not a dead end`
    );
  }
});

test('with everything open, the exit is reachable from the lift', () => {
  const dist = reachable(layout.cells, layout.marks['@']!);
  const exit = layout.marks.X!;
  assert.ok(dist[exit.y]![exit.x]! > 0);
});

test('each gate holds back everything after its station until it opens', () => {
  let shut = [...layout.gates, ...layout.doors];
  const gate = (id: number): Passage => layout.gates.find((g) => g.id === id)!;
  for (const [i, st] of STATIONS.entries()) {
    // Measured from where a failed attempt puts you back.
    const dist = reachable(closed(layout.cells, shut), st.checkpoint);
    if (st.goal)
      assert.ok(
        dist[st.goal.y]![st.goal.x]! >= 0,
        `station ${i + 1}'s goal is walled off`
      );
    if (st.opens !== undefined) {
      const g = gate(st.opens);
      // One side of it is where you are; the other is shut off until it opens.
      const sides = [
        dist[g.y]![g.x]!,
        dist[g.y + DELTA[g.dir][1]]![g.x + DELTA[g.dir][0]]!,
      ];
      assert.equal(
        sides.filter((d) => d === -1).length,
        1,
        `gate ${g.id} doesn't hold anything back`
      );
      shut = shut.filter((p) => p !== g);
    }
    if (st.closes !== undefined) shut.push(gate(st.closes));
    if (st.title === 'Power the grid')
      shut = shut.filter((p) => !layout.doors.includes(p));
    const next = STATIONS[i + 1];
    const after = reachable(closed(layout.cells, shut), st.checkpoint);
    if (next)
      assert.ok(
        after[next.checkpoint.y]![next.checkpoint.x]! >= 0,
        `station ${i + 2} can't be reached from station ${i + 1}`
      );
    else
      assert.ok(
        after[layout.marks.X!.y]![layout.marks.X!.x]! >= 0,
        'the exit lift is walled off'
      );
  }
});

test('the watchdog is shut in its loop, away from the lasers, until you hide', () => {
  const hide = STATIONS.findIndex((s) => s.title === 'Hide from the dog');
  const dog = layout.marks.d!;
  const laser = layout.marks.L!;
  const beforeHiding = STATIONS.slice(0, hide).flatMap((s) =>
    s.opens === undefined ? [] : [s.opens]
  );
  const shut = [
    ...layout.gates.filter((g) => !beforeHiding.includes(g.id)),
    ...layout.doors,
  ];
  assert.equal(
    reachable(closed(layout.cells, shut), dog)[laser.y]![laser.x],
    -1
  );
});

const blank: TrainingProgress = {
  exposure: 0,
  posture: 'stand',
  dashes: 0,
  trapsHere: 0,
  trapsRolled: 0,
  shots: 0,
  dryFires: 0,
  heaviesDown: 0,
  aimsBegun: 0,
  aimedDowns: 0,
  flashes: 0,
  flashDazed: 0,
  enemiesDown: 0,
  wallTops: 0,
  wallRolls: 0,
  wallHangs: 0,
  hangMetres: 0,
  wallHops: 0,
  wallJumps: 0,
  wallLowers: 0,
  wallCrosses: 0,
  cell: { x: 0, y: 0 },
  takedowns: 0,
  bodiesHidden: 0,
  inCover: false,
  lightsOut: 0,
  torchOff: true,
  torchOns: 0,
  switchedOff: 0,
  gogglesOn: false,
  trapsSet: 0,
  trapKills: 0,
  patrolsDown: 0,
  hidden: false,
  dogsDown: 0,
  dronesDown: 0,
  packSpotted: false,
  packTraps: 0,
  packLeft: 2,
  bestBlast: 0,
  hacked: false,
  gridOn: false,
  lures: 0,
  sentriesDown: 0,
  documents: 0,
  mapOpened: false,
  aloft: null,
  tagged: 0,
  gripLine: null,
  aerialTakedowns: 0,
  pulseWarnings: 0,
  uplinkDown: false,
  logsWiped: 0,
  stashes: 0,
};

test('the coach waits until a station is done, then opens its gate', () => {
  assert.deepEqual(advance(0, blank, blank), {
    index: 0,
    opened: [],
    closed: [],
    notes: [],
  });
  assert.deepEqual(advance(0, { ...blank, cell: { x: 2, y: 0 } }, blank), {
    index: 1,
    opened: [1],
    closed: [],
    notes: [],
  });
});

test('what can be done again counts from the station that asks for it: a torch switched on before is not enough', () => {
  const torch = STATIONS.findIndex((s) => s.title === 'Your torch');
  const earlier = { ...blank, torchOns: 1, torchOff: true };
  assert.equal(advance(torch, earlier, earlier, STATIONS, blank).index, torch);
  assert.equal(advance(torch, { ...earlier, torchOns: 2 }, earlier, STATIONS, blank).index, torch + 1);
});

test('what can’t be done twice counts from the start of training, so doing it out of order never strands a gate', () => {
  // A light shot out from where the gate was still shut can’t be shot again: it counts.
  const lights = STATIONS.findIndex((s) => s.title === 'Kill the lights');
  const shot = { ...blank, lightsOut: 1 };
  assert.equal(advance(lights, shot, shot, STATIONS, blank).index, lights + 1);
  assert.equal(advance(lights, blank, blank, STATIONS, blank).index, lights, 'but none shot is still none');
  // The one light switch, switched off before its station: still done, and so is the body hidden before the light was off.
  const takedown = STATIONS.findIndex((s) => s.title === 'Take down a guard');
  const early = { ...blank, takedowns: 1, switchedOff: 1, bodiesHidden: 1 };
  const run = advance(takedown, early, blank, STATIONS, blank);
  assert.deepEqual(run.opened, [2], 'gate 2 opens');
  assert.equal(STATIONS[run.index]!.title, 'Take cover');
  // Even from a station that began after it was all done.
  const hide = STATIONS.findIndex((s) => s.title === 'Hide the body');
  assert.deepEqual(advance(hide, early, early, STATIONS, blank).opened, [2]);
  assert.equal(advance(hide, early, early).index, hide, 'counted from the station alone, as it used to be, it never would');
  // The ceiling course’s guard, dropped on while hanging over it before its station, and the grapple course’s guard and file.
  const death = CEILING_STATIONS.findIndex((s) => s.title === 'Death from above');
  const dropped = { ...blank, aerialTakedowns: 1 };
  assert.ok(advance(death, dropped, dropped, CEILING_STATIONS, blank).opened.includes(3));
  const drop = GRAPPLE_STATIONS.findIndex((s) => s.title === 'Drop on the guard');
  const both = { ...blank, aerialTakedowns: 1, documents: 1 };
  assert.deepEqual(advance(drop, both, both, GRAPPLE_STATIONS, blank).opened, [2, 3]);
});

test('switching the torch on and off again leads to the drone yard, then night vision opens the gate to the dark laser hall', () => {
  const torch = STATIONS.findIndex((s) => s.title === 'Your torch');
  // It starts off, so being off isn't enough: it has to go on, then off again.
  assert.equal(advance(torch, blank, blank).index, torch);
  assert.equal(advance(torch, { ...blank, torchOns: 1, torchOff: false }, blank).index, torch);
  const off = { ...blank, torchOns: 1 };
  assert.deepEqual(advance(torch, off, blank), { index: torch + 1, opened: [], closed: [], notes: [] });
  assert.equal(STATIONS[torch + 1]!.title, 'Dodge the drone');
  assert.equal(STATIONS[torch + 2]!.title, 'Night vision');
  // Goggles on don't get you past the drone: the yard comes first.
  assert.equal(advance(torch, { ...off, gogglesOn: true }, blank).index, torch + 1);
  const yard = { ...off, cell: { x: 2, y: 4 } };
  assert.deepEqual(advance(torch + 1, { ...yard, gogglesOn: true }, off), { index: torch + 3, opened: [4], closed: [], notes: [] });
});

test('the drone lesson clears at the far corner of the yard, or with the drone brought down (and a note)', () => {
  const i = STATIONS.findIndex((s) => s.title === 'Dodge the drone');
  assert.equal(advance(i, { ...blank, cell: { x: 5, y: 5 } }, blank).index, i);
  assert.equal(advance(i, { ...blank, cell: { x: 2, y: 4 } }, blank).index, i + 1);
  const emp = advance(i, { ...blank, dronesDown: 1 }, blank);
  assert.equal(emp.index, i + 1);
  assert.equal(emp.notes.length, 1);
});

test('the drone yard is one open room off the corridor, holding the drone, a crate and a staff locker, and not the corridor itself', () => {
  const inYard = (p: { x: number; y: number }): boolean => TRAINING_DRONE_YARD.some((c) => c.x === p.x && c.y === p.y);
  for (const m of ['q', 'b', 'e'] as const) assert.ok(inYard(layout.marks[m]!), `${m} is outside the yard`);
  assert.ok(!TRAINING_DRONE_YARD.some((c) => c.x === 6), 'the drone would fly over the corridor');
  // Every yard cell reachable from the lesson's checkpoint, and the only way in is the doorway at (5, 5).
  const i = STATIONS.findIndex((s) => s.title === 'Dodge the drone');
  const dist = reachable(layout.cells, STATIONS[i]!.checkpoint);
  for (const c of TRAINING_DRONE_YARD) assert.ok(dist[c.y]![c.x]! >= 0, `yard cell ${c.x},${c.y} is walled off`);
  const doorways = TRAINING_DRONE_YARD.flatMap((c) =>
    (['N', 'S', 'E', 'W'] as const).filter((d) => layout.cells[c.y]![c.x]![d] && !inYard({ x: c.x + DELTA[d][0], y: c.y + DELTA[d][1] })).map((d) => `${c.x},${c.y},${d}`)
  );
  assert.deepEqual(doorways, ['5,5,E']);
});

test('the blackout covers the laser hall and nothing before the night-vision lesson', () => {
  const laser = layout.marks.L!;
  assert.ok(TRAINING_BLACKOUT.some((c) => c.x === laser.x && c.y === laser.y));
  const nv = STATIONS.find((s) => s.title === 'Night vision')!;
  assert.ok(!TRAINING_BLACKOUT.some((c) => c.x === nv.checkpoint.x && c.y === nv.checkpoint.y));
});

test('stations clear in order, never skipping ahead on later progress', () => {
  // Hacking the terminal before the dog is down doesn't move the coach on,
  // and nor does it once the dog is down: the pack comes first.
  const dog = STATIONS.findIndex((s) => s.title === 'EMP the dog');
  assert.equal(advance(dog, { ...blank, hacked: true }, blank).index, dog);
  assert.equal(
    advance(dog, { ...blank, hacked: true, dogsDown: 1 }, blank).index,
    dog + 1
  );
});

test('stunning the first guard instead of taking it down still moves on, with a hint', () => {
  const takedown = STATIONS.findIndex((s) => s.title === 'Take down a guard');
  const { index, notes } = advance(
    takedown,
    { ...blank, sentriesDown: 1 },
    blank
  );
  assert.equal(index, takedown + 1);
  assert.equal(notes.length, 1);
  // A real takedown needs no hint.
  assert.deepEqual(
    advance(takedown, { ...blank, takedowns: 1, sentriesDown: 1 }, blank).notes,
    []
  );
});

test('training keeps enough EMP charges and traps in hand for a second try', () => {
  assert.ok(TRAINING_KIT.emp >= 2 && TRAINING_KIT.traps >= 2);
});

test('the trap steps come between cover and the lights, and blowing the trap opens gate 3', () => {
  const titles = STATIONS.map((s) => s.title);
  assert.deepEqual(
    titles.slice(
      titles.indexOf('Take cover'),
      titles.indexOf('Kill the lights') + 1
    ),
    ['Take cover', 'Set a trap', 'Blow the trap', 'Kill the lights']
  );
  const blow = titles.indexOf('Blow the trap');
  assert.deepEqual(advance(blow, { ...blank, trapKills: 1 }, blank), {
    index: blow + 1,
    opened: [3],
    closed: [],
    notes: [],
  });
  // Putting the guard down some other way still moves on, with a hint.
  assert.equal(
    advance(blow, { ...blank, patrolsDown: 1 }, blank).notes.length,
    1
  );
});

test('a patrol shot before its trap goes off still gets you through gate 3', () => {
  const set = STATIONS.findIndex((s) => s.title === 'Set a trap');
  // Shot while "Set a trap" was still up: both trap stations clear, gate 3 opens, with the hint.
  const shot = { ...blank, patrolsDown: 1 };
  const r = advance(set, shot, blank);
  assert.equal(STATIONS[r.index]!.title, 'Kill the lights');
  assert.deepEqual(r.opened, [3]);
  assert.equal(r.notes.length, 1);
  // Shot after a trap was set but before it was blown: the blow station clears on its own start.
  const blow = set + 1;
  assert.equal(advance(blow, shot, shot).index, blow + 1);
  // Caught by the trap: no hint.
  assert.deepEqual(
    advance(blow, { ...blank, trapKills: 1, patrolsDown: 1 }, blank).notes,
    []
  );
});

test('the pack stations come after the dog: watch, trap the meeting point, then take them together', () => {
  const titles = STATIONS.map((s) => s.title);
  const dog = titles.indexOf('EMP the dog');
  assert.deepEqual(titles.slice(dog, dog + 5), [
    'EMP the dog',
    'Watch the pack',
    'Trap the meeting point',
    'Take the whole pack',
    'Hack a terminal',
  ]);
  const watch = dog + 1;
  assert.equal(advance(watch, blank, blank).index, watch);
  const spotted = { ...blank, packSpotted: true };
  assert.equal(advance(watch, spotted, blank).index, watch + 1);
  // A trap anywhere else doesn't count; one at the meeting point does.
  assert.equal(advance(watch + 1, { ...spotted, trapsSet: 1 }, spotted).index, watch + 1);
  const trapped = { ...spotted, trapsSet: 1, packTraps: 1 };
  assert.equal(advance(watch + 1, trapped, spotted).index, watch + 2);
  // Both dogs in one blast opens gate 6; one at a time does too, with a hint.
  assert.deepEqual(advance(watch + 2, { ...trapped, packLeft: 0, bestBlast: 2 }, trapped), {
    index: watch + 3,
    opened: [6],
    closed: [],
    notes: [],
  });
  assert.equal(advance(watch + 2, { ...trapped, packLeft: 0, bestBlast: 1 }, trapped).notes.length, 1);
  assert.equal(advance(watch + 2, { ...trapped, packLeft: 1, bestBlast: 1 }, trapped).index, watch + 2);
});

test('the pack meets at a four-way junction both dogs reach, and stays in its arena', () => {
  const meet = layout.marks.M!;
  const c = layout.cells[meet.y]![meet.x]!;
  assert.deepEqual([c.N, c.S, c.E, c.W], [true, true, true, true]);
  // Gate 7 stays shut to them even once it's open to you.
  const gate7 = layout.gates.filter((g) => g.id === 7);
  for (const d of layout.packDogs) {
    const dist = reachable(closed(layout.cells, gate7), d);
    assert.ok(dist[meet.y]![meet.x]! > 0);
    assert.equal(dist[gate7[0]!.y]![gate7[0]!.x]!, -1, 'a pack dog can leave its arena');
  }
  // The locker to watch from sits at the arena's mouth, a clear cell from the meeting point.
  const k = layout.marks.k!;
  assert.deepEqual([k.y, meet.x - k.x], [meet.y, 1]);
});

test('the light switch lesson comes right after the takedown, so the body can be hidden in the dark it makes', () => {
  const titles = STATIONS.map((s) => s.title);
  const i = titles.indexOf('Switch off a light');
  assert.equal(titles[i - 1], 'Take down a guard');
  assert.equal(titles[i + 1], 'Hide the body');
  const st = STATIONS[i]!;
  assert.equal(advance(i, blank, blank).index, i);
  assert.equal(advance(i, { ...blank, switchedOff: 1 }, blank).index, i + 1);
  assert.deepEqual(st.goal, { x: TRAINING_SWITCHES[0]!.x, y: TRAINING_SWITCHES[0]!.y });
  // Mounted on a wall of its cell, not across an opening.
  const sw = TRAINING_SWITCHES[0]!;
  assert.equal(layout.cells[sw.y]![sw.x]![sw.wall], false);
});

// ---- Up high: the ceiling course ----

const ceiling = parseTraining(CEILING_MAP);
const CELL = 4;

test('the ceiling course parses into a consistent maze, lift to exit', () => {
  for (let y = 0; y < ceiling.rows; y++) {
    for (let x = 0; x < ceiling.cols; x++) {
      const c = ceiling.cells[y]![x]!;
      if (x + 1 < ceiling.cols) assert.equal(c.E, ceiling.cells[y]![x + 1]!.W, `E/W mismatch at ${x},${y}`);
      if (y + 1 < ceiling.rows) assert.equal(c.S, ceiling.cells[y + 1]![x]!.N, `N/S mismatch at ${x},${y}`);
    }
  }
  assert.deepEqual(ceiling.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(ceiling.marks.g, { x: CEILING_GUARD.x, y: CEILING_GUARD.y });
  assert.deepEqual(ceiling.gates.map((g) => g.id).sort(), [1, 2, 3, 4, 5]);
  // On foot, the lift leads to the first tower; the exit is reached from where you drop, past the guard.
  const x = ceiling.marks.X!;
  const toExit = bfs(ceiling.cells, ceiling.cols, ceiling.rows, x.x, x.y);
  assert.ok(toExit[0]![0]! < 0, 'no walking round the ceiling');
  assert.ok(toExit[CEILING_GUARD.y]![CEILING_GUARD.x]! > 0, 'a way on from the drop');
});

test('each ceiling gate holds back everything after its station, and the guard is only reachable from above', () => {
  const shut = (ids: number[]): number[][] =>
    bfs(closed(ceiling.cells, ceiling.gates.filter((g) => ids.includes(g.id))), ceiling.cols, ceiling.rows, 0, 0);
  const x = ceiling.marks.X!;
  // Every station's goal is reachable once the gates before it are open, and not before.
  let gatesShut = [1, 2, 3, 4, 5];
  for (const st of CEILING_STATIONS) {
    const reach = shut(gatesShut);
    // The stations up on the pipes mark their goals in the air, over walled-off cells; the rest are on foot.
    const onFoot = CEILING_STATIONS.indexOf(st) < CEILING_STATIONS.findIndex((t) => t.title === 'Shimmy and turn');
    if (st.goal && onFoot) assert.ok(reach[st.goal.y]![st.goal.x]! >= 0, `${st.title}: goal unreachable`);
    if (st.opens !== undefined) gatesShut = gatesShut.filter((id) => id !== st.opens);
  }
  // From the drop, the last gate holds back the exit.
  const fromDrop = bfs(closed(ceiling.cells, ceiling.gates.filter((g) => g.id === 4)), ceiling.cols, ceiling.rows, CEILING_GUARD.x, CEILING_GUARD.y);
  assert.ok(fromDrop[x.y]![x.x]! < 0, 'the exit waits for the last gate');
  // Before the takedown's gate opens, nothing on foot gets to the guard.
  assert.ok(shut([3, 4])[CEILING_GUARD.y]![CEILING_GUARD.x]! < 0);
  // The fast curtain's gate holds back the towers: no way round it.
  const t1 = CEILING_PIPES.towers[0]!;
  assert.ok(shut([5, 3, 4])[t1.y]![t1.x]! < 0);
});

test('the moving lasers sit where they can be passed: a sweeper in a junction, a curtain with an alcove off it', () => {
  // One slow curtain, then a fast one to dash past, at the speeds the game runs them.
  assert.deepEqual(CEILING_SLIDERS.map((l) => l.speed), [SLIDE_SPEED, FAST_SLIDE_SPEED]);
  for (const s of CEILING_SWEEPERS) {
    const c = ceiling.cells[s.y]![s.x]!;
    assert.ok([c.N, c.S, c.E, c.W].filter(Boolean).length >= 3);
  }
  for (const l of CEILING_SLIDERS) {
    let aside = false;
    for (let i = l.from; i <= l.to; i++) {
      const c = l.axis === 'x' ? ceiling.cells[l.at]![i]! : ceiling.cells[i]![l.at]!;
      if (i < l.to) assert.ok(l.axis === 'x' ? c.E : c.S);
      if (l.axis === 'x' ? c.S || c.N : c.E || c.W) aside = true;
    }
    assert.ok(aside);
  }
});

test('the shutter closes a straight corridor past the fast curtain, a panel on the wall either side, and its station is past it', () => {
  const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;
  const st = CEILING_STATIONS.find((t) => t.title === 'Slide under the shutter')!;
  assert.equal(CEILING_STATIONS.indexOf(st), CEILING_STATIONS.findIndex((t) => t.title === 'Dash past a fast curtain') + 1);
  for (const s of CEILING_SHUTTERS) {
    const [dx, dy] = DELTA[s.dir];
    const run = [s.panels[0], { x: s.x, y: s.y }, s.panels[1]];
    assert.deepEqual([s.panels[0].x, s.panels[0].y, s.panels[1].x, s.panels[1].y], [s.x - dx, s.y - dy, s.x + dx, s.y + dy]);
    for (const c of run) {
      const cell = ceiling.cells[c.y]![c.x]!;
      assert.ok(dx !== 0 ? cell.E && cell.W && !cell.N && !cell.S : cell.N && cell.S && !cell.E && !cell.W, 'a straight corridor');
    }
    for (const p of s.panels) assert.equal(ceiling.cells[p.y]![p.x]![p.wall], false, 'a panel goes on a wall');
    // You come to the near panel first, with room to dash from it, and the station ends beyond the shutter.
    assert.deepEqual([st.checkpoint.x, st.checkpoint.y], [s.panels[0].x, s.panels[0].y]);
    assert.deepEqual([st.goal!.x, st.goal!.y], [s.panels[1].x, s.panels[1].y]);
  }
});

test('the towers stand in straight corridors against a wall, under their pipes, which cross over the guard\'s column', () => {
  const plan = CEILING_PIPES;
  for (const t of plan.towers) {
    const c = ceiling.cells[t.y]![t.x]!;
    const open = (['N', 'S', 'E', 'W'] as const).filter((d) => c[d]);
    assert.equal(open.length, 2);
    assert.equal(c[t.wall], false, 'the mast stands against a wall');
  }
  // Grabbing over the first tower takes the row; the rows and columns cross; the column runs over the guard.
  const grip = gripAtTower(plan, 0, { x: -1, z: 0 }, CELL)!;
  assert.equal(plan.lines[grip.line]!.axis, 'x');
  const cross = crossing(plan.lines[0]!, plan.lines[1]!)!;
  assert.ok(cross);
  const atCross = { ...grip, along: (cross.x - plan.lines[grip.line]!.from) * CELL };
  const turned = turnOnto(plan, atCross, 1, CELL) ?? turnOnto(plan, atCross, -1, CELL);
  assert.equal(turned!.line, CEILING_COLUMN);
  const col = plan.lines[CEILING_COLUMN]!;
  assert.equal(col.axis, 'z');
  assert.equal(col.at, CEILING_GUARD.x);
  const over = pointOnLine(plan, CEILING_COLUMN, (CEILING_GUARD.y - col.from) * CELL, CELL);
  assert.deepEqual(over, { x: CEILING_GUARD.x * CELL, z: CEILING_GUARD.y * CELL });
  // The second tower hangs you on the column, where the pulse lesson happens.
  assert.equal(gripAtTower(plan, 1, { x: 0, z: -1 }, CELL)!.line, CEILING_COLUMN);
});

test('a ceiling station up on the pipes starts over on a tower platform, one on the ground on the ground', () => {
  for (const st of CEILING_STATIONS) {
    const up = ['Hang from the pipe', 'Shimmy and turn', 'Death from above', 'Mind the pulses'].includes(st.title);
    assert.equal(st.perch !== undefined, up, st.title);
    if (st.perch !== undefined) assert.ok(CEILING_PIPES.towers[st.perch]);
  }
});

test('the ceiling stations run in order: climb, hang, turn, drop, then the pulses', () => {
  const run = (from: number, now: Partial<TrainingProgress>, start: Partial<TrainingProgress> = {}): number =>
    advance(from, { ...blank, ...now }, { ...blank, ...start }, CEILING_STATIONS).index;
  const climb = CEILING_STATIONS.findIndex((st) => st.title === 'Climb the tower');
  assert.equal(run(climb, { aloft: 'perch' }), climb, 'up, but nothing tagged yet');
  assert.equal(run(climb, { aloft: 'perch', tagged: 1 }), climb + 1);
  assert.equal(run(climb + 1, { aloft: 'hang', gripLine: 0 }), climb + 2);
  assert.equal(run(climb + 2, { aloft: 'hang', gripLine: CEILING_COLUMN }), climb + 3);
  const drop = climb + 3;
  const done = advance(drop, { ...blank, aerialTakedowns: 1 }, blank, CEILING_STATIONS);
  assert.equal(done.index, drop + 1);
  assert.deepEqual(done.opened, [3]);
  assert.equal(CEILING_PULSES_FROM, drop + 1);
  // Warned while hanging isn't enough: off the pipe it counts.
  assert.equal(run(CEILING_PULSES_FROM, { aloft: 'hang', pulseWarnings: 1 }), CEILING_PULSES_FROM);
  assert.equal(run(CEILING_PULSES_FROM, { aloft: 'perch', pulseWarnings: 1 }), CEILING_PULSES_FROM + 1);
});


// ---- The grapple course ----

const grapple = parseTraining(GRAPPLE_MAP);

test('the grapple course parses into a consistent maze, lift to exit, with each gate where it should be', () => {
  for (let y = 0; y < grapple.rows; y++) {
    for (let x = 0; x < grapple.cols; x++) {
      const c = grapple.cells[y]![x]!;
      if (x + 1 < grapple.cols) assert.equal(c.E, grapple.cells[y]![x + 1]!.W, `E/W mismatch at ${x},${y}`);
      if (y + 1 < grapple.rows) assert.equal(c.S, grapple.cells[y + 1]![x]!.N, `N/S mismatch at ${x},${y}`);
    }
  }
  assert.deepEqual(grapple.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(grapple.marks.g, { x: GRAPPLE_GUARD.x, y: GRAPPLE_GUARD.y });
  assert.ok(grapple.marks.$ && grapple.marks.X);
  assert.deepEqual(grapple.gates.map((g) => g.id).sort(), [1, 2, 3]);
  const gate = (id: number): Passage => grapple.gates.find((g) => g.id === id)!;
  const from = (id: number[], at: { x: number; y: number }): number[][] =>
    bfs(closed(grapple.cells, grapple.gates.filter((g) => id.includes(g.id))), grapple.cols, grapple.rows, at.x, at.y);
  // On foot from the lift: gate 1 walls the corridor, so nothing past it is reachable until you're over it.
  const walk = from([1, 2, 3], { x: 0, y: 0 });
  assert.ok(walk[0]![2]! >= 0 && walk[0]![3]! < 0, 'gate 1 blocks the corridor');
  const beyond = from([2, 3], { x: 4, y: 0 });
  assert.ok(beyond[2]![7]! >= 0, 'past gate 1 you can walk round to the hall');
  assert.ok(beyond[GRAPPLE_GUARD.y]![GRAPPLE_GUARD.x]! < 0, 'the guard is shut in behind gate 2');
  assert.ok(beyond[grapple.marks.X!.y]![grapple.marks.X!.x]! < 0, 'the exit is behind gate 3');
  assert.equal(gate(2).dir, 'S');
  assert.equal(gate(2).x, GRAPPLE_GUARD.x);
  // With every gate open the lift is reachable from everywhere.
  const toExit = bfs(grapple.cells, grapple.cols, grapple.rows, grapple.marks.X!.x, grapple.marks.X!.y);
  for (let y = 0; y < grapple.rows; y++) for (let x = 0; x < grapple.cols; x++) if (grapple.cells[y]![x]!.N || grapple.cells[y]![x]!.S || grapple.cells[y]![x]!.E || grapple.cells[y]![x]!.W) assert.ok(toExit[y]![x]! >= 0, `${x},${y} reaches the exit`);
});

test('the grapple ceiling runs over the wall, the guard and the records room, in one connected piece', () => {
  const plan = GRAPPLE_PIPES;
  assert.ok(connected(plan));
  const covers = (x: number, y: number): boolean => plan.lines.some((l) => (l.axis === 'x' ? l.at === y && x >= l.from && x <= l.to : l.at === x && y >= l.from && y <= l.to));
  assert.ok(covers(2, 0) && covers(3, 0), 'over gate 1');
  assert.ok(covers(GRAPPLE_GUARD.x, GRAPPLE_GUARD.y), 'over the guard');
  assert.ok(covers(grapple.marks.$!.x, grapple.marks.$!.y), 'over the records room');
  for (const t of plan.towers) assert.ok(covers(t.x, t.y), 'each tower stands on a pipe');
  // From the beacon at the pocket's gate, the hook takes the column over the guard (it beats the row over the hall).
  const hook = hookPoint(plan, GRAPPLE_GUARD.x * CELL, 2 * CELL, { x: 0, z: -1 }, CELL, 9)!;
  assert.equal(plan.lines[hook.grip.line]!.axis, 'z');
  assert.equal(hook.grip.dir, -1, 'facing north, forward is north');
  // From the middle of the hall, facing the room, it takes the row over the hall.
  const hall = hookPoint(plan, 6 * CELL, 2 * CELL, { x: -1, z: 0 }, CELL, 9)!;
  assert.equal(plan.lines[hall.grip.line]!.at, 2);
  assert.equal(plan.lines[hall.grip.line]!.axis, 'x');
});

test('every grapple station has a spot to restart at that you can stand in, and the gates come in order', () => {
  for (const st of GRAPPLE_STATIONS) {
    const c = grapple.cells[st.checkpoint.y]?.[st.checkpoint.x];
    assert.ok(c && (c.N || c.S || c.E || c.W), `${st.title}: a real cell`);
    assert.equal(st.perch, undefined, st.title);
    assert.ok(st.keys.length > 0 && st.touch.length > 0);
  }
  assert.deepEqual(GRAPPLE_STATIONS.map((s) => s.opens).filter((o) => o !== undefined), [2, 3]);
});

test('the grapple stations run in order: hook, over the wall, drop on the guard, hover, out', () => {
  const run = (from: number, now: Partial<TrainingProgress>, start: Partial<TrainingProgress> = {}): number =>
    advance(from, { ...blank, ...now }, { ...blank, ...start }, GRAPPLE_STATIONS).index;
  assert.equal(run(0, {}), 0);
  assert.equal(run(0, { aloft: 'climb' }), 0, 'still being hauled up');
  assert.equal(run(0, { aloft: 'hang', cell: { x: 1, y: 0 } }), 1);
  assert.equal(run(1, { aloft: 'hang', cell: { x: 4, y: 0 } }), 1, 'over the wall, but still hanging');
  assert.equal(run(1, { aloft: null, cell: { x: 4, y: 0 } }), 2, 'dropped past the wall');
  assert.equal(run(1, { aloft: null, cell: { x: 2, y: 0 } }), 1, 'dropped before the wall');
  assert.equal(run(2, {}), 2);
  const drop = advance(2, { ...blank, aerialTakedowns: 1 }, blank, GRAPPLE_STATIONS);
  assert.equal(drop.index, 3);
  assert.deepEqual(drop.opened, [2]);
  const hover = advance(3, { ...blank, documents: 1 }, blank, GRAPPLE_STATIONS);
  assert.equal(hover.index, 4);
  assert.deepEqual(hover.opened, [3]);
  assert.equal(run(4, { documents: 5 }), 4, 'the lift ends the course');
});


test('the heist stages come in order: guide, uplink, file, logs, blueprint, out; each reachable from where a failure restarts', () => {
  const titles = STATIONS.map((s) => s.title);
  const i = titles.indexOf('Follow the guide');
  assert.deepEqual(titles.slice(i - 1, i + 6), ['Draw the sentry off', 'Follow the guide', 'Take the uplink down', 'Photograph the file', 'Wipe the logs', 'Check the blueprint', 'Get out']);
  assert.equal(STATIONS[i]!.guide, true);
  assert.ok(STATIONS.filter((s) => s.guide).length === 1, 'the guide shows at one station only');
  const up = layout.marks.u!;
  const logs = layout.marks.l!;
  const rec = layout.marks.$!;
  // Three rooms in a row off the hall, in this order, each its own dead end.
  assert.deepEqual([logs.x, rec.x, up.x], [10, 11, 12]);
  assert.ok(logs.y === 0 && rec.y === 0 && up.y === 0);
  // With the gates after the grid open, all of them and the exit can be reached from a restart spot.
  const open = reachable(closed(layout.cells, []), STATIONS[i]!.checkpoint);
  for (const m of [up, logs, rec, layout.marks.X!]) assert.ok(open[m.y]![m.x]! >= 0);
  // The stages' conditions.
  assert.equal(advance(i, { ...blank, cell: { x: 12, y: 1 } }, blank).index, i + 1);
  assert.equal(advance(i + 1, blank, blank).index, i + 1);
  assert.equal(advance(i + 1, { ...blank, uplinkDown: true }, blank).index, i + 2);
  assert.equal(advance(i + 2, { ...blank, documents: 1 }, blank).index, i + 3);
  assert.equal(advance(i + 3, { ...blank, logsWiped: 1 }, { ...blank, logsWiped: 0 }).index, i + 4);
  assert.equal(advance(i + 3, { ...blank, logsWiped: 1 }, { ...blank, logsWiped: 1 }).index, i + 3, 'a wipe from before the stage does not count');
});

test('hiding a body says so if it was done any way other than stashing it', () => {
  const st = STATIONS.find((s) => s.title === 'Hide the body')!;
  assert.match(st.note!({ ...blank, bodiesHidden: 1 }, blank, blank) ?? '', /LOCKER, CRATE OR VENT/);
  assert.equal(st.note!({ ...blank, bodiesHidden: 1, stashes: 1 }, blank, blank), null);
  assert.match(st.keys, /stash/i);
  assert.match(st.touch, /stash/i);
});

test('the desktop text names keys by action, every token is an action, and the defaults read as they always did', () => {
  const all = [...STATIONS, ...CEILING_STATIONS, ...GRAPPLE_STATIONS];
  for (const st of all) {
    for (const [, name] of st.keys.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok((ACTIONS as readonly string[]).includes(name!), `${st.title}: {${name}}`);
    assert.doesNotMatch(st.touch, /\{[a-zA-Z]+\}/, `${st.title}: the touch text names no keys`);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
  const text = (title: string): string => withKeys(all.find((s) => s.title === title)!.keys, DEFAULT_KEYS);
  assert.match(text('Get moving'), /W and S walk forward and back, A and D turn/);
  assert.match(text('Take down a guard'), /Press Left Shift to sneak.*click \(or Right Shift\)/);
  assert.match(text('Set a trap'), /Press G to line up.*press G again.*or Z to set it/);
  assert.match(text('Take cover'), /beside it you go see-through.*Nothing holds you: walk off/);
  assert.match(text('Check the blueprint'), /Press Tab to open the blueprint.*Tab or Esc closes it/);
  // Moved to other keys, the same text follows.
  const moved = { ...DEFAULT_KEYS, trap: 'KeyJ', trapHere: 'KeyK' };
  assert.match(withKeys(all.find((s) => s.title === 'Set a trap')!.keys, moved), /Press J to line up.*press J again.*or K to set it/);
});

test('the controls sheet and the trap buttons name their keys by action too', () => {
  const html = readFileSync(new URL('../game.html', import.meta.url), 'utf8');
  const tokens = [...html.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!);
  assert.ok(tokens.length > 25, `${tokens.length} tokens`);
  for (const name of tokens) assert.ok((ACTIONS as readonly string[]).includes(name), name);
  // Every action that has a key to show in the table has a row for it somewhere (the trap, map and mute ones among them).
  for (const must of ['forward', 'turnLeft', 'sneak', 'interact', 'fire', 'trap', 'trapHere', 'detonate', 'map', 'mute', 'recon']) assert.ok(tokens.includes(must), must);
});

// ---- Staying hidden: the stealth course ----

const stealth = parseTraining(STEALTH_MAP);
const CELL_M = 4;

test('the stealth course parses into a hall with a sentry at one end, a lift at the other, and a branch to the exit', () => {
  assert.equal(stealth.cols, 14);
  assert.equal(stealth.rows, 3);
  assert.deepEqual(stealth.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(stealth.marks['X'], { x: 13, y: 2 });
  // The laser gates, in the hall past the dash: duck, crawl, wait, each in a straight stretch with a free cell between.
  assert.deepEqual([stealth.marks['U'], stealth.marks['V'], stealth.marks['W']], [{ x: 7, y: 2 }, { x: 9, y: 2 }, { x: 11, y: 2 }]);
  assert.deepEqual(stealth.marks['g'], { x: STEALTH_GUARD.x, y: STEALTH_GUARD.y });
  assert.deepEqual(stealth.gates.map((g) => g.id).sort(), [1, 2]);
  const open = (c: { N: boolean; S: boolean; E: boolean; W: boolean }) => [c.N, c.S, c.E, c.W].filter(Boolean).length;
  assert.equal(open(stealth.cells[0]![0]!), 1, 'the lift sits in a dead end');
  assert.equal(open(stealth.cells[2]![13]!), 1, 'and so does the exit lift');
  for (const m of ['U', 'V', 'W'] as const) {
    const c = stealth.cells[stealth.marks[m]!.y]![stealth.marks[m]!.x]!;
    assert.ok(c.E && c.W && !c.N && !c.S, `${m} is a straight stretch of corridor`);
  }
  // The sentry faces down the hall, toward the lift: west.
  assert.ok(Math.abs(STEALTH_GUARD.facing + Math.PI / 2) < 1e-9);
});

test('the exit is out of reach until the two gates are open, and reachable with them open', () => {
  const dist = (opened: number[]) => {
    const cells = stealth.cells.map((row) => row.map((c) => ({ ...c })));
    for (const g of stealth.gates) {
      if (opened.includes(g.id)) continue;
      const [dx, dz] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[g.dir] as [number, number];
      cells[g.y]![g.x]![g.dir] = false;
      const back = { N: 'S', S: 'N', E: 'W', W: 'E' }[g.dir] as 'N' | 'S' | 'E' | 'W';
      cells[g.y! + dz]![g.x + dx]![back] = false;
    }
    return bfs(cells as MazeCells, stealth.cols, stealth.rows, 0, 0)[2]![13]!;
  };
  assert.equal(dist([]) < 0, true);
  assert.equal(dist([1]) < 0, true);
  assert.ok(dist([1, 2]) > 0);
});

test('the lesson distances line up with what a guard sees: torch on, the beacons sit where each posture matters', () => {
  const g = { x: STEALTH_GUARD.x * CELL_M, z: 0 };
  const seen = (cellX: number, radius: number, aware: number) => botCanSee(g.x, g.z, STEALTH_GUARD.facing, cellX * CELL_M, 0, [], radius, aware, true);
  const stand = [DETECT_RADIUS, AWARE_RADIUS] as const;
  const crouch = [SNEAK_DETECT_RADIUS, SNEAK_AWARE_RADIUS] as const;
  const prone = [SNEAK_DETECT_RADIUS * PRONE_SIGHT, SNEAK_AWARE_RADIUS * PRONE_AWARE] as const;
  // The first lesson: the meter is amber before a standing agent is seen.
  const amber = exposure(g.x, g.z, STEALTH_GUARD.facing, 5.5 * CELL_M, 0, [], ...stand, true);
  assert.ok(amber >= 0.6 && amber < 1, `${amber}`);
  assert.equal(seen(5, ...stand), false, 'cell 5 is outside a standing agent’s torchlit sight');
  assert.equal(seen(7, ...stand), true, 'standing at the creep beacon, they’d be seen');
  assert.equal(seen(7, ...crouch), false, 'crouched, they aren’t');
  assert.equal(seen(8, ...crouch), true, 'crouched beside the guard, they’d be seen');
  assert.equal(seen(8, ...prone), false, 'but flat, they aren’t');
});

test('the stealth stations run in order and only on what the lesson asks for', () => {
  const titles = STEALTH_STATIONS.map((s) => s.title);
  assert.deepEqual(titles, ['Watch the meter', 'Crouch', 'Lie flat', 'Crawl up to the guard', 'Crawl back', 'Creep out', 'Dash', 'Duck the beams', 'Crawl beneath the low beam', 'Wait for the gap', 'Get out']);
  const at = (x: number, y: number, over: Partial<TrainingProgress> = {}) => ({ ...blank, cell: { x, y }, ...over });
  const run = (from: number, now: TrainingProgress) => advance(from, now, blank, STEALTH_STATIONS, blank);
  assert.equal(run(0, at(3, 0)).index, 0);
  assert.equal(run(0, at(5, 0, { exposure: 0.7 })).index, 1);
  assert.equal(run(1, at(5, 0, { posture: 'stand' })).index, 1);
  assert.equal(run(1, at(5, 0, { posture: 'crouch' })).index, 2);
  assert.equal(run(2, at(5, 0, { posture: 'crouch' })).index, 2, 'crouched is not flat');
  assert.equal(run(2, at(5, 0, { posture: 'prone' })).index, 3);
  assert.equal(run(3, at(8, 0, { posture: 'crouch' })).index, 3, 'crouched beside the guard doesn’t do');
  const crawled = run(3, at(8, 0, { posture: 'prone' }));
  assert.equal(crawled.index, 4);
  assert.deepEqual(crawled.opened, [1]);
  assert.equal(run(4, at(7, 0)).index, 5);
  assert.equal(run(5, at(5, 0)).index, 5);
  assert.equal(run(5, at(2, 1)).index, 6);
  assert.equal(run(6, at(3, 2)).index, 6);
  const dashed = advance(6, at(3, 2, { dashes: 1 }), at(3, 2, { dashes: 0 }), STEALTH_STATIONS, blank);
  assert.equal(dashed.index, 7);
  assert.deepEqual(dashed.opened, [2]);
  assert.equal(run(7, at(7, 2)).index, 7, 'in the beams is not past them');
  assert.equal(run(7, at(8, 2)).index, 8);
  assert.equal(run(8, at(9, 2)).index, 8);
  assert.equal(run(8, at(10, 2)).index, 9);
  assert.equal(run(9, at(11, 2)).index, 9);
  assert.equal(run(9, at(12, 2)).index, 10);
  assert.equal(run(10, at(13, 2)).index, 10, 'the lift itself ends training');
});

test('every stealth station has a spot to restart at that you can stand in, and the desktop text names keys by action', () => {
  for (const st of STEALTH_STATIONS) {
    const c = stealth.cells[st.checkpoint.y]?.[st.checkpoint.x];
    assert.ok(c, st.title);
    assert.doesNotMatch(st.touch, /\{[a-zA-Z]+\}/, st.title);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
});

// ---- The gun: the weapons course ----

const weapons = parseTraining(WEAPONS_MAP);

test('the weapons course is one hall: a lift, two sentries, a gate, a heavy, a gate, a second heavy to trap, and the exit lift', () => {
  assert.equal(weapons.cols, 16);
  assert.equal(weapons.rows, 1);
  assert.deepEqual(weapons.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(weapons.marks['g'], { x: 2, y: 0 });
  assert.deepEqual(weapons.marks['G'], { x: 4, y: 0 });
  assert.deepEqual(weapons.marks['H'], { x: 8, y: 0 });
  assert.deepEqual(weapons.marks['K'], { x: 13, y: 0 });
  assert.deepEqual(weapons.marks['X'], { x: 15, y: 0 });
  assert.deepEqual(weapons.gates.map((g) => g.id).sort(), [1, 2]);
  // The sentries have their backs to you, the heavy faces you.
  assert.ok(Math.abs(WEAPONS_SENTRY_FACING - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(WEAPONS_HEAVY_FACING + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(WEAPONS_TRAP_HEAVY_FACING - Math.PI / 2) < 1e-9, 'the trapped heavy has its back to you');
});

test('the heavy is out of sight and inside the gun\'s range from the cell before the gate', () => {
  const heavy = weapons.marks['H']!;
  const gate = weapons.gates[0]!;
  const metres = (heavy.x - gate.x) * CELL_M;
  assert.ok(metres <= 14 && metres > DETECT_RADIUS, `${metres} m: inside the 14 m range, outside the 10 m it sees from`);
});

test('the weapons stations are done by the right things: a shot, a click or a wait, two sentries, then the heavy', () => {
  const [fire, recharge, chime, flash, heavy, trapHere, slide, blow] = WEAPONS_STATIONS as [Station, Station, Station, Station, Station, Station, Station, Station];
  assert.equal(fire.done(blank, blank, blank), false);
  assert.equal(fire.done({ ...blank, shots: 1 }, blank, blank), true);
  assert.equal(recharge.done({ ...blank, shots: 1 }, { ...blank, shots: 1 }, blank), false);
  assert.equal(recharge.done({ ...blank, shots: 1, dryFires: 1 }, { ...blank, shots: 1 }, blank), true);
  assert.equal(recharge.note?.({ ...blank, shots: 1, dryFires: 1 }, { ...blank, shots: 1 }, blank), null, 'a click needs no hint');
  assert.ok(recharge.note?.({ ...blank, shots: 2 }, { ...blank, shots: 1 }, blank), 'waiting it out is praised');
  assert.equal(chime.done({ ...blank, sentriesDown: 1 }, blank, blank), false);
  assert.equal(chime.done({ ...blank, sentriesDown: 2 }, blank, blank), true);
  assert.equal(chime.opens, 1);
  // The flash grenade: thrown is not enough, it has to blind someone; one blinded before the lesson does not count.
  assert.equal(flash.done({ ...blank, flashes: 1 }, blank, blank), false);
  assert.equal(flash.done({ ...blank, flashes: 1, flashDazed: 1 }, blank, blank), true);
  assert.equal(flash.done({ ...blank, flashes: 1, flashDazed: 1 }, { ...blank, flashDazed: 1 }, blank), false);
  assert.match(withKeys(flash.keys, DEFAULT_KEYS), /press 1 /);
  assert.equal(heavy.done({ ...blank, heaviesDown: 1 }, blank, blank), true);
  assert.equal(heavy.done(blank, blank, blank), false);
  assert.equal(heavy.opens, 2);
  // The trap lessons: set one on the spot, roll one along the line, then blow the second heavy.
  assert.equal(trapHere.done({ ...blank, trapsRolled: 1 }, blank, blank), false, 'a rolled trap is not a trap set on the spot');
  assert.equal(trapHere.done({ ...blank, trapsHere: 1 }, blank, blank), true);
  assert.equal(slide.done({ ...blank, trapsHere: 1 }, blank, blank), false);
  assert.equal(slide.done({ ...blank, trapsRolled: 1 }, blank, blank), true);
  assert.equal(blow.done({ ...blank, heaviesDown: 1 }, blank, blank), false, 'the first heavy was the shots');
  assert.equal(blow.done({ ...blank, heaviesDown: 2 }, blank, blank), true);
  assert.equal(blow.note?.({ ...blank, heaviesDown: 2, trapKills: 1 }, blank, blank), null);
  assert.ok(blow.note?.({ ...blank, heaviesDown: 2 }, blank, blank), 'put down some other way: a hint that a trap is safer');
});

test('the second heavy is out of its sight from the gate and within a rolled trap\'s reach after a step or two', () => {
  const gate = weapons.gates.find((g) => g.id === 2)!;
  const trapHeavy = weapons.marks['K']!;
  assert.ok((trapHeavy.x - gate.x) * CELL_M >= 12, 'the gate is at least 12 m from it');
  assert.ok((trapHeavy.x - (gate.x + 2)) * CELL_M <= 2 * CELL_M + 0.01, 'two cells past the gate, it is within a roll');
});

test('every weapons station says how, for a keyboard and for a thumb', () => {
  for (const st of WEAPONS_STATIONS) {
    assert.ok(st.keys.length > 20 && st.touch.length > 20, st.title);
    assert.ok(!/\{[a-z]+\}/i.test(st.touch), `${st.title}: no key tokens in the touch text`);
  }
});

// ---- Cover fire ----

const cover = parseTraining(COVER_MAP);

test('the cover course is one hall running south: a lift, a crate, a gate, a guard and the exit lift', () => {
  assert.equal(cover.cols, 1);
  assert.equal(cover.rows, 24);
  assert.deepEqual(cover.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(cover.marks['c'], { x: 0, y: 1 });
  assert.deepEqual(cover.marks['g'], { x: 0, y: 3 });
  assert.deepEqual(cover.marks['X'], { x: 0, y: 23 });
  assert.deepEqual(cover.gates.map((g) => g.id), [1, 2]);
  assert.deepEqual(cover.gates[0], { id: 1, x: 0, y: 1, dir: 'S' }, 'the gate shuts the guard off from the crate');
});

test('the guard starts out of sight of the crate and inside the gun\'s range from it', () => {
  const metres = (cover.marks['g']!.y - cover.marks['c']!.y) * CELL_M;
  assert.ok(metres >= DETECT_RADIUS - 2 && metres <= 14, `${metres} m`);
});

test('the cover stations are done by the right things: taking cover, aiming, then a shot fired aiming', () => {
  const take = COVER_STATIONS[0]!, aim = COVER_STATIONS[1]!, shoot = COVER_STATIONS[2]!;
  assert.equal(take.done(blank, blank, blank), false);
  assert.equal(take.done({ ...blank, inCover: true }, blank, blank), true);
  assert.equal(take.opens, 1);
  assert.equal(aim.done({ ...blank, inCover: true }, blank, blank), false);
  assert.equal(aim.done({ ...blank, aimsBegun: 1 }, blank, blank), true);
  assert.equal(aim.done({ ...blank, aimsBegun: 1 }, { ...blank, aimsBegun: 1 }, blank), false, 'an earlier lean out does not count');
  assert.equal(shoot.done(blank, blank, blank), false);
  assert.equal(shoot.done({ ...blank, aimedDowns: 1 }, blank, blank), true);
  assert.equal(shoot.note?.({ ...blank, aimedDowns: 1 }, blank, blank), null);
  assert.equal(shoot.done({ ...blank, takedowns: 1 }, blank, blank), true, 'put down some other way, the lesson still moves on');
  assert.ok(shoot.note?.({ ...blank, takedowns: 1 }, blank, blank), '... with a word about the shot from cover');
});

test('every cover station says how, for a keyboard and for a thumb, and only names real keys', () => {
  for (const st of COVER_STATIONS) {
    assert.ok(st.keys.length > 20 && st.touch.length > 20, st.title);
    assert.ok(!/\{[a-z]+\}/i.test(st.touch), `${st.title}: no key tokens in the touch text`);
    for (const [, name] of st.keys.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok((ACTIONS as readonly string[]).includes(name!), `${st.title}: {${name}}`);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
});

test('cover enemy encounters advance once per disabled enemy and unlock the exit last', () => {
  const encounters = COVER_STATIONS.filter((s) => s.enemy);
  assert.deepEqual(
    encounters.map((s) => s.enemy),
    ['patrol', 'hunter', 'heavy', 'watchdog', 'crawler', 'drone']
  );
  for (const [n, st] of encounters.entries()) {
    const index = COVER_STATIONS.indexOf(st);
    const start = { ...blank, enemiesDown: n + 1 };
    assert.equal(
      advance(index, start, start, COVER_STATIONS).index,
      index,
      st.title
    );
    const next = advance(
      index,
      { ...start, enemiesDown: n + 2, coverEncounter: { station: index, disabled: true } },
      start,
      COVER_STATIONS
    );
    assert.equal(
      next.index,
      index + 1,
      'one enemy cannot complete multiple encounters'
    );
    assert.deepEqual(next.opened, st.enemy === 'drone' ? [2] : []);
  }
  assert.equal(
    COVER_STATIONS.at(-1)!.done({ ...blank, enemiesDown: 7 }, blank, blank),
    false
  );
});

test('cover encounters have distinct spaced bays, reachable cover and nearby retry points', () => {
  const encounters = COVER_STATIONS.filter((s) => s.enemy);
  let previous = cover.marks.g!.y;
  for (const st of encounters) {
    assert.ok(st.enemyAt && st.goal);
    assert.ok(st.goal.y > previous, 'next cover is beyond the previous opponent');
    assert.equal(st.enemyAt.y - st.goal.y, 2, 'each opponent is eight metres past its cover');
    assert.equal(st.checkpoint.y, st.goal.y - 1);
    assert.ok(st.enemyAt.y < cover.marks.X!.y);
    const distances = bfs(cover.cells, cover.cols, cover.rows, st.checkpoint.x, st.checkpoint.y);
    assert.ok(distances[st.goal.y]![st.goal.x]! >= 0);
    previous = st.enemyAt.y;
  }
  assert.equal(cover.gates.find((g) => g.id === 2)?.y, previous, 'exit gate follows the final opponent');
});

test('cover practice accepts any disable method, including after a retry resets counters', () => {
  for (let index = 2; index < COVER_STATIONS.length - 1; index++) {
    const dead = { ...blank, coverEncounter: { station: index, disabled: true } };
    const next = advance(index, dead, dead, COVER_STATIONS, dead);
    assert.equal(next.index, index + 1, 'the disabled encounter advances once even when baseline already includes it');
    assert.deepEqual(next.opened, index === 8 ? [2] : []);
    const wrong = { ...dead, coverEncounter: { station: index - 1, disabled: true } };
    assert.equal(advance(index, wrong, wrong, COVER_STATIONS).index, index, 'previous kills cannot skip an encounter');
  }
  const early = { ...blank, coverEncounter: { station: 2, disabled: true } };
  assert.equal(advance(1, early, early, COVER_STATIONS).index, 3, 'a kill before the aim instruction cannot strand the course');
});

// ---- Corners and high ground ----

const corners = parseTraining(CORNERS_MAP);

test('the corners course is an L down to a hall: a lift, a corner, a guard behind a gate, a tower, a second guard behind a gate and the exit lift', () => {
  assert.equal(corners.cols, 12);
  assert.equal(corners.rows, 5);
  assert.deepEqual(corners.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(corners.marks['g'], { x: 3, y: 3 });
  assert.deepEqual(corners.marks['G'], { x: 10, y: 4 });
  assert.deepEqual(corners.marks['X'], { x: 11, y: 4 });
  assert.deepEqual(corners.gates.map((g) => g.id).sort(), [1, 2]);
  // The corner: the corridor's last cell has walls above and below, and the turn south is at the cell after it, with nothing above or east of it.
  const bend = corners.cells[0]![3]!;
  assert.deepEqual([bend.N, bend.E, bend.S, bend.W], [false, false, true, true]);
  const before = corners.cells[0]![2]!;
  assert.deepEqual([before.N, before.S], [false, false], 'closed above and below: the wall that ends at the turn');
});

test('the guards are where the course says: the first at the foot of the long hall, facing up it; the second 16 m from the tower, facing it', () => {
  assert.deepEqual(CORNERS_GUARDS.map((g) => [g.x, g.y]), [[3, 3], [10, 4]]);
  assert.ok(Math.abs(CORNERS_GUARDS[0].facing - Math.PI) < 1e-9);
  assert.ok(Math.abs(CORNERS_GUARDS[1].facing + Math.PI / 2) < 1e-9);
  const tower = CORNERS_PIPES.towers[0]!;
  assert.deepEqual([tower.x, tower.y, tower.wall], [6, 4, 'N']);
  assert.equal(corners.cells[tower.y]![tower.x]!.N, false, 'the tower stands against a wall');
  const metres = (CORNERS_GUARDS[1].x - tower.x) * CELL_M;
  assert.ok(metres > 14 && metres <= 22, `${metres} m: past the gun's reach from the floor, inside it from the platform`);
  // The first guard is within the gun's reach of the lean at the corner.
  const lean = { x: 3 * CELL_M - 1.2, z: 1.6 };
  assert.ok(Math.hypot(CORNERS_GUARDS[0].x * CELL_M - lean.x, CORNERS_GUARDS[0].y * CELL_M - lean.z) <= 14);
});

test('the corners stations are done by the right things, in the right order', () => {
  const [take, lean, shoot, climb, lie, high] = CORNERS_STATIONS as [Station, Station, Station, Station, Station, Station, Station];
  assert.equal(take.done(blank, blank, blank), false);
  assert.equal(take.done({ ...blank, inCover: true }, blank, blank), true);
  assert.deepEqual(take.goal, { x: 2, y: 0 }, 'the beacon is the cell before the turn');
  assert.equal(lean.done({ ...blank, aimsBegun: 1 }, blank, blank), true);
  assert.equal(lean.done({ ...blank, aimsBegun: 1 }, { ...blank, aimsBegun: 1 }, blank), false);
  assert.equal(shoot.done({ ...blank, aimedDowns: 1 }, blank, blank), true);
  assert.equal(shoot.note?.({ ...blank, aimedDowns: 1 }, blank, blank), null);
  assert.ok(shoot.note?.({ ...blank, takedowns: 1 }, blank, blank), 'put down some other way: a word about the lesson');
  assert.equal(shoot.opens, 1);
  assert.equal(climb.done({ ...blank, aloft: 'climb' }, blank, blank), false);
  assert.equal(climb.done({ ...blank, aloft: 'perch' }, blank, blank), true);
  assert.equal(lie.done({ ...blank, aimsBegun: 1 }, blank, blank), false, 'aiming down on the floor is not aiming on the platform');
  assert.equal(lie.done({ ...blank, aloft: 'perch', aimsBegun: 1 }, blank, blank), true);
  assert.equal(high.done({ ...blank, sentriesDown: 1 }, blank, blank), false);
  assert.equal(high.done({ ...blank, sentriesDown: 2 }, blank, blank), true);
  assert.equal(high.opens, 2);
  assert.equal(lie.perch, 0, 'a failed attempt starts over on the platform');
});

test('every corners station says how, for a keyboard and for a thumb, and only names real keys', () => {
  for (const st of CORNERS_STATIONS) {
    assert.ok(st.keys.length > 20 && st.touch.length > 20, st.title);
    assert.ok(!/\{[a-z]+\}/i.test(st.touch), `${st.title}: no key tokens in the touch text`);
    for (const [, name] of st.keys.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok((ACTIONS as readonly string[]).includes(name!), `${st.title}: {${name}}`);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
});

test('every corners station starts over somewhere that can be walked to from the lift (or up on the platform)', () => {
  const dist = bfs(corners.cells, corners.cols, corners.rows, 0, 0);
  for (const st of CORNERS_STATIONS) {
    if (st.perch !== undefined) continue;
    assert.ok(dist[st.checkpoint.y]![st.checkpoint.x]! >= 0, `${st.title}: checkpoint ${st.checkpoint.x},${st.checkpoint.y}`);
  }
});

// ---- Over the wall ----

const wall = parseTraining(WALL_MAP);

test('the wall course is one corridor with two walls across it: a run-up, a guard 10 m past the first, a guard just past the second, the exit lift', () => {
  assert.equal(wall.rows, 1);
  assert.equal(wall.cols, 11);
  assert.deepEqual(wall.marks['@'], { x: 0, y: 0 });
  assert.deepEqual(wall.marks['X'], { x: 10, y: 0 });
  assert.deepEqual(wall.gates, []);
  // The two walls: the cells either side of them are shut to each other, every other pair is open.
  const shut = wall.cells[0]!.flatMap((c, x) => (x < wall.cols - 1 && !c.E ? [x] : []));
  assert.deepEqual(shut, [4, 8]);
  // A run-up of four cells to the first wall; a dash needs 1.8 m, and the corridor gives 16.
  assert.ok(4 * CELL_M >= 8);
  assert.deepEqual(WALL_GUARDS.map((g) => [g.x, g.y]), [[7, 0], [9, 0]]);
  const first = (WALL_GUARDS[0].x - 4.5) * CELL_M;
  assert.ok(first > 8 && first < 14, `${first} m from the first wall: inside the gun's reach from a lie on top`);
  const second = (WALL_GUARDS[1].x - 8.5) * CELL_M;
  assert.ok(second < 2.6, `${second} m from the second wall: within a drop's reach (game.ts WALL_REACH)`);
});

test('the wall stations are done by the right things, in the right order', () => {
  const [run, shoot, roll, drop] = WALL_STATIONS as [Station, Station, Station, Station, Station];
  assert.equal(run.done(blank, blank, blank), false);
  assert.equal(run.done({ ...blank, wallTops: 1 }, blank, blank), true);
  assert.deepEqual(run.goal, { x: 3, y: 0 }, 'the beacon is a run-up from the wall');
  assert.equal(shoot.done({ ...blank, sentriesDown: 1 }, blank, blank), true);
  assert.equal(roll.done({ ...blank, wallRolls: 1 }, blank, blank), true);
  assert.equal(roll.done({ ...blank, wallRolls: 1 }, { ...blank, wallRolls: 1 }, blank), true, 'rolled off before the lesson: it counts');
  assert.equal(drop.done({ ...blank, sentriesDown: 1 }, blank, blank), false);
  assert.equal(drop.done({ ...blank, aerialTakedowns: 1 }, blank, blank), true);
  assert.equal(drop.note?.({ ...blank, aerialTakedowns: 1 }, blank, blank), null);
  assert.ok(drop.note?.({ ...blank, sentriesDown: 2 }, blank, blank), 'both down some other way: a word about the lesson');
});

test('however the guards go down, a player on the floor past the first wall is not stranded', () => {
  // Climbed, rolled off, shot the guard from the floor past the wall: on to the drop.
  const run = (now: Partial<TrainingProgress>): string => WALL_STATIONS[advance(0, { ...blank, ...now }, blank, WALL_STATIONS, blank).index]!.title;
  assert.equal(run({ wallTops: 1, sentriesDown: 1 }), 'Jump off');
  assert.equal(run({ wallTops: 1, sentriesDown: 1, wallRolls: 1 }), 'Drop on the guard');
  assert.equal(run({ wallTops: 1, sentriesDown: 2, wallRolls: 1 }), 'Get out');
});

test('every wall station says how, for a keyboard and for a thumb, and only names real keys', () => {
  for (const st of WALL_STATIONS) {
    assert.ok(st.keys.length > 20 && st.touch.length > 20, st.title);
    assert.ok(!/\{[a-z]+\}/i.test(st.touch), `${st.title}: no key tokens in the touch text`);
    for (const [, name] of st.keys.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok((ACTIONS as readonly string[]).includes(name!), `${st.title}: {${name}}`);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
});

test('every wall station starts over on a side of a wall that can be walked to from the lift', () => {
  // Walls block the way, so a checkpoint past the first wall is reached from the lift only by climbing: the earlier ones are reachable on foot.
  const dist = bfs(wall.cells, wall.cols, wall.rows, 0, 0);
  for (const st of WALL_STATIONS.slice(0, 3)) assert.ok(dist[st.checkpoint.y]![st.checkpoint.x]! >= 0, st.title);
  assert.equal(dist[0]![WALL_STATIONS[3]!.checkpoint.x]!, -1, 'the drop starts past the first wall: reached over it');
});

test('however an enemy goes down, the lesson about it moves on: a player who never uses the flash, the traps or the gun still finishes', () => {
  const run = (now: Partial<TrainingProgress>): number => advance(0, { ...blank, ...now }, blank, WEAPONS_STATIONS, blank).index;
  const title = (i: number): string => WEAPONS_STATIONS[i]!.title;
  // Both sentries put down in silence, with no shot fired: past the three gun lessons to the flash.
  assert.equal(title(run({ sentriesDown: 2 })), 'Flash grenade');
  // The first heavy shot to pieces with no flash thrown: past the flash and the plates, to the traps.
  assert.equal(title(run({ sentriesDown: 2, heaviesDown: 1 })), 'Set a trap on the spot');
  // The second heavy down with the gun, no trap ever set: all the way to the exit.
  assert.equal(title(run({ sentriesDown: 2, heaviesDown: 2 })), 'Get out');
  // The flash itself still earns no hint, and shooting past it does.
  const flash = WEAPONS_STATIONS.find((s) => s.title === 'Flash grenade')!;
  assert.equal(flash.note?.({ ...blank, flashDazed: 1 }, blank, blank), null);
  assert.ok(flash.note?.({ ...blank, heaviesDown: 1 }, blank, blank));
});

test('the basics course does not strand a player who put the dog, the pack or the sentry down some other way', () => {
  const dog = STATIONS.find((s) => s.title === 'EMP the dog')!;
  assert.equal(dog.done({ ...blank, dogsDown: 1 }, { ...blank, dogsDown: 1 }, blank), true, 'a dog downed before the lesson began still counts');
  const meeting = STATIONS.find((s) => s.title === 'Trap the meeting point')!;
  assert.equal(meeting.done({ ...blank, packLeft: 0 }, blank, blank), true, 'the pack gone some other way');
  const sentry = STATIONS.find((s) => s.title === 'Draw the sentry off')!;
  assert.equal(sentry.done({ ...blank, sentriesDown: 1 }, { ...blank, sentriesDown: 1 }, blank), true, 'a sentry put down earlier still counts');
  const drop = GRAPPLE_STATIONS.find((s) => s.title === 'Drop on the guard')!;
  assert.equal(drop.done({ ...blank, sentriesDown: 1 }, blank, blank), true, 'the guard in its pocket put down some other way');
});

test('lessons are checkboxes: whatever was done since training began ticks the lesson when it comes up, in any order', () => {
  const torch = STATIONS.findIndex((s) => s.title === 'Your torch');
  const drone = STATIONS.findIndex((s) => s.title === 'Dodge the drone');
  const night = STATIONS.findIndex((s) => s.title === 'Night vision');
  assert.equal(drone, torch + 1);
  assert.equal(night, drone + 1);
  // The drone EMP'd while still on the torch lesson: finishing the torch lesson carries straight on past the drone and stops at night vision.
  const droneDown = { ...blank, dronesDown: 1 };
  const atTorch = advance(torch, { ...droneDown, torchOns: 1, torchOff: true }, droneDown, STATIONS, blank);
  assert.equal(atTorch.index, night, 'the drone lesson is ticked, not waited for');
  // The drone lesson itself is ticked by a drone put down at any time since training began, not only since the lesson did.
  assert.equal(advance(drone, droneDown, droneDown, STATIONS, blank).index, drone + 1);
  assert.equal(advance(drone, blank, blank, STATIONS, blank).index, drone, 'but with none put down and nowhere near the yard, it waits');
  // Night vision on before its lesson comes up (held through the drone lesson) ticks it too, and opens its gate.
  const goggles = advance(drone, { ...droneDown, gogglesOn: true }, droneDown, STATIONS, blank);
  assert.equal(goggles.index, night + 1);
  assert.deepEqual(goggles.opened, [4]);
});

test('no lesson is ticked by nothing: at the very start, with training just begun, none is done', () => {
  for (const [name, list] of [['basics', STATIONS], ['ceiling', CEILING_STATIONS], ['grapple', GRAPPLE_STATIONS], ['stealth', STEALTH_STATIONS], ['weapons', WEAPONS_STATIONS], ['cover', COVER_STATIONS], ['corners', CORNERS_STATIONS], ['wall', WALL_STATIONS], ['dock', DOCK_STATIONS], ['range', RANGE_STATIONS], ['tower', TOWER_STATIONS]] as const) {
    for (const [i, st] of list.entries()) {
      // A lesson done from the first moment, counted from the beginning with nothing yet done, would be skipped before it is shown.
      if (i === 0) continue;
      assert.equal(st.done(blank, blank, blank), false, `${name} lesson ${i + 1} (${st.title}) is done before anything has happened`);
    }
  }
});

// ---- the high wall ----

test('the high wall course is an open corridor with the tall wall along its south side, a guard under the wall near each end and the exit past them, and a second corridor over the wall that leads back up to the exit', () => {
  const hw = parseTraining(HIGHWALL_MAP);
  assert.equal(hw.rows, 2);
  assert.deepEqual(hw.cells[0]!.map((c) => c.E).slice(0, hw.cols - 1), Array(hw.cols - 1).fill(true), 'nothing shuts the corridor: the wall is the lesson, not a barrier');
  assert.deepEqual(hw.cells[1]!.map((c) => c.E).slice(0, hw.cols - 1), Array(hw.cols - 1).fill(true), 'the far corridor is open end to end');
  for (let x = 0; x < hw.cols; x++) assert.equal(hw.cells[0]![x]!.S, x === hw.cols - 1, `the wall between the corridors is shut at x${x} except under the lift, so the way over is the wall`);
  assert.deepEqual(HIGHWALL_GUARDS.map((g) => [g.x, g.y]), [[5, 0], [8, 0]]);
  for (const g of HIGHWALL_GUARDS) assert.ok(g.x >= HIGHWALL_COLUMNS.from && g.x <= HIGHWALL_COLUMNS.to, `the guard at x${g.x} stands under the tall wall`);
  assert.ok(HIGHWALL_COLUMNS.to < hw.marks.X!.x, 'the tall wall ends before the exit');
  // The first beacon is a run-up from the wall's start, as the wall course's.
  assert.ok(HIGHWALL_STATIONS[0]!.goal!.x >= HIGHWALL_COLUMNS.from);
});

test('the high wall stations are done by the right things, in the right order', () => {
  const [up, along, drop, leap, top, down, over] = HIGHWALL_STATIONS as [Station, Station, Station, Station, Station, Station, Station, Station];
  assert.equal(up.done(blank, blank, blank), false);
  assert.equal(up.done({ ...blank, wallHangs: 1 }, blank, blank), true);
  assert.equal(along.done({ ...blank, hangMetres: 2 }, blank, blank), false);
  assert.equal(along.done({ ...blank, hangMetres: 3.5 }, blank, blank), true);
  assert.equal(drop.done({ ...blank, aerialTakedowns: 1 }, blank, blank), true);
  assert.equal(drop.done({ ...blank, sentriesDown: 1 }, blank, blank), true, 'shot down some other way: it counts');
  assert.equal(leap.done({ ...blank, wallJumps: 1 }, blank, blank), true);
  assert.equal(leap.done({ ...blank, sentriesDown: 2 }, blank, blank), false, 'both guards down is not a leap');
  assert.ok(leap.note?.({ ...blank, sentriesDown: 2 }, blank, blank), 'both down already: a word about the leap');
  assert.equal(top.done(blank, blank, blank), false);
  assert.equal(top.done({ ...blank, wallTops: 1 }, blank, blank), true, 'up on the top shelf');
  assert.equal(down.done({ ...blank, wallLowers: 1 }, blank, blank), true, 'dropped back to the first shelf');
  assert.equal(over.done(blank, blank, blank), false);
  assert.equal(over.done({ ...blank, wallCrosses: 1 }, blank, blank), true, 'went over the top');
});

test('the high wall lessons follow in order, and one already done by earlier play counts', () => {
  const run = (now: Partial<TrainingProgress>): string => HIGHWALL_STATIONS[advance(0, { ...blank, ...now }, blank, HIGHWALL_STATIONS, blank).index]!.title;
  assert.equal(run({}), 'Up to the ledge');
  assert.equal(run({ wallHangs: 1 }), 'Along the shelf');
  assert.equal(run({ wallHangs: 1, hangMetres: 4 }), 'Drop on the guard');
  assert.equal(run({ wallHangs: 1, hangMetres: 4, aerialTakedowns: 1 }), 'Leap off the wall');
  assert.equal(run({ wallHangs: 1, hangMetres: 4, aerialTakedowns: 1, wallJumps: 1 }), 'Up to the top shelf');
  assert.equal(run({ wallHangs: 1, hangMetres: 4, aerialTakedowns: 1, wallJumps: 1, wallTops: 1 }), 'Down a level');
  assert.equal(run({ wallHangs: 1, hangMetres: 4, aerialTakedowns: 1, wallJumps: 1, wallTops: 1, wallLowers: 1 }), 'Over the top');
  assert.equal(run({ wallHangs: 1, hangMetres: 4, aerialTakedowns: 1, wallJumps: 1, wallTops: 1, wallLowers: 1, wallCrosses: 1 }), 'Get out');
});

test('every high wall station says how, for a keyboard and for a thumb, and only names real keys', () => {
  for (const st of HIGHWALL_STATIONS) {
    assert.ok(st.keys.length > 20 && st.touch.length > 20, st.title);
    assert.ok(!/\{[a-z]+\}/i.test(st.touch), `${st.title}: no key tokens in the touch text`);
    for (const [, name] of st.keys.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok((ACTIONS as readonly string[]).includes(name!), `${st.title}: {${name}}`);
    assert.doesNotMatch(withKeys(st.keys, DEFAULT_KEYS), /[{}]/, st.title);
  }
});

test('the cover course teaches the aim key, wherever it is bound, and no longer a lean out from cover', () => {
  const aim = COVER_STATIONS.find((st) => st.title === 'Aim')!;
  assert.match(withKeys(aim.keys, DEFAULT_KEYS), /Press \/ \(or the right mouse button\) to aim/);
  assert.match(withKeys(aim.keys, { ...DEFAULT_KEYS, aim: 'KeyK' }), /Press K \(or the right mouse button\) to aim/);
  for (const st of [...COVER_STATIONS, ...CORNERS_STATIONS]) assert.doesNotMatch(st.keys + st.touch, /lean out|Stay in cover|leave cover/, st.title);
});
