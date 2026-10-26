import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraining } from './tutorial.ts';
import {
  TOWER_COLS,
  TOWER_ROWS,
  TOWER_LEVELS,
  TOWER_STAIRS,
  TOWER_LIFTS,
  TOWER_EXIT,
  HEIST_DOOR,
  OFFICES,
  walkable,
  hasFloor,
  levelMap,
  playCells,
  drawCells,
  railsFor,
  reachable,
  gameStairs,
  climbWalls,
  stairCells,
  stairHigh,
  stairLow,
  TOWER_PATROLS,
  TOWER_POSTS,
  TOWER_DOGS,
  sightAcross,
  liftFront,
  TOWER_KEYCARD,
  TOWER_BRIDGES,
  TOWER_LASERS,
  TOWER_CAMERAS,
  TOWER_PYLONS,
  TOWER_SECURITY,
  ledgeSpans,
  ledgeNear,
  TOWER_OFFICE_DOORS,
  selectTowerPlan,
  validatePlan,
  activePlan,
  TOWER_PLANS,
  playCellsP,
  walkableP,
  type TowerPlanData,
  sectionsP as sectionsOf,
} from './towerplan.ts';
import { cameraYaw } from './cameras.ts';
import { GAP_CROUCH } from './linelasers.ts';
import { botCanSee } from './detection.ts';

// (The old tests are about the campus tower: each starts by making its plan the active one.)
const test = (name: string, fn: () => void): void => nodeTest(name, () => { selectTowerPlan('campus'); fn(); });

const levels = TOWER_LEVELS.map((_, i) => i);
const everyCell = (fn: (x: number, y: number) => void): void => {
  for (let y = 0; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) fn(x, y);
};

test('every storey parses as a training map of the tower size, the lobby with the start and the way out', () => {
  for (const l of levels) {
    const layout = parseTraining(levelMap(l));
    assert.equal(layout.cols, TOWER_COLS);
    assert.equal(layout.rows, TOWER_ROWS);
    assert.deepEqual(layout.marks['@'], l === 0 ? { x: 0, y: 0 } : undefined);
    assert.deepEqual(layout.marks.X, l === 0 ? { x: TOWER_EXIT.x, y: TOWER_EXIT.y } : undefined);
  }
});

test('the street door is on the lobby, the heist door on the offices, both on floor', () => {
  assert.ok(walkable(0, 0, 0));
  assert.ok(walkable(OFFICES, HEIST_DOOR.x, HEIST_DOOR.y));
  assert.equal(HEIST_DOOR.y, TOWER_ROWS - 1); // in the back (south) wall
});

test('every floor cell of every storey can be walked to from the street door by the stairs alone', () => {
  const seen = reachable(false);
  for (const l of levels) everyCell((x, y) => { if (walkable(l, x, y)) assert.ok(seen.has(`${l},${x},${y}`), `storey ${l} cell ${x},${y} is cut off`); });
});

test('the lifts add no cell the stairs do not already reach, and serve floor on both ends', () => {
  assert.deepEqual([...reachable(true)].sort(), [...reachable(false)].sort());
  for (const lf of TOWER_LIFTS) {
    for (const l of lf.serves) {
      assert.ok(!walkable(l, lf.x, lf.y), 'the cab is not floor to walk on');
      assert.ok(walkable(l, liftFront(lf).x, liftFront(lf).y), `storey ${l} has floor in front of lift ${lf.id}`);
    }
  }
});

test('each stair joins storeys one apart and arrives on floor at both ends', () => {
  for (const s of TOWER_STAIRS) {
    assert.equal(stairHigh(s) - stairLow(s), 1);
    for (let x = s.x; x < s.x + s.width; x++) {
      assert.ok(walkable(s.fromLevel, x, s.y - 1), `${s.id}: nothing to step off onto at the north end`);
      assert.ok(walkable(s.toLevel, x, s.y + s.run), `${s.id}: nothing to step off onto at the south end`);
    }
  }
});

test('no two stairs share a cell on a storey they both touch, and no stair stands on a lift', () => {
  const seen = new Map<string, string>();
  for (const s of TOWER_STAIRS) {
    for (const l of [s.fromLevel, s.toLevel]) {
      for (const c of stairCells(s)) {
        const k = `${l},${c.x},${c.y}`;
        assert.ok(!seen.has(k), `${s.id} and ${seen.get(k)} overlap at ${k}`);
        seen.set(k, s.id);
        for (const lf of TOWER_LIFTS) assert.ok(!(lf.serves.includes(l) && lf.x === c.x && lf.y === c.y));
      }
    }
  }
});

test('where a flight comes up through a storey the floor is cut out for it', () => {
  for (const s of TOWER_STAIRS) for (const c of stairCells(s)) assert.ok(!hasFloor(stairHigh(s), c.x, c.y), `${s.id} head at ${c.x},${c.y}`);
});

test('the play cells are shut round everything that is not floor, the drawn cells open round it', () => {
  for (const l of levels) {
    const play = playCells(l);
    const draw = drawCells(l);
    everyCell((x, y) => {
      if (!walkable(l, x, y)) {
        assert.deepEqual(play[y]![x], { N: false, S: false, E: false, W: false });
        if (x > 0) assert.ok(draw[y]![x]!.W);
        if (y > 0) assert.ok(draw[y]![x]!.N);
      }
      // What one cell says of its neighbour, the neighbour says back.
      if (x + 1 < TOWER_COLS) assert.equal(play[y]![x]!.E, play[y]![x + 1]!.W);
      if (y + 1 < TOWER_ROWS) assert.equal(play[y]![x]!.S, play[y + 1]![x]!.N);
    });
  }
});

test('balustrades stand where floor meets a drop, never across a stair', () => {
  assert.equal(railsFor(0).length > 0, true); // the sides of the grand stairs
  assert.ok(railsFor(1).length > 0);
  assert.ok(railsFor(2).length > 0);
  for (const l of levels) {
    for (const r of railsFor(l)) {
      assert.ok(walkable(l, r.x, r.y));
      const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[r.dir];
      assert.ok(!walkable(l, r.x + d[0], r.y + d[1]));
    }
  }
  // The gallery's edge on the atrium and the balcony's: the hall's front edge is railed between the stairs, open at them.
  const balcony = railsFor(1).filter((r) => r.dir === 'N' && r.y === 4).map((r) => r.x);
  assert.ok(!balcony.includes(1) && !balcony.includes(9), 'the grand stairs arrive through the balcony rail');
  assert.ok(balcony.includes(5), 'and the rest of the front edge is railed');
});

test('the stairs as the game sees them climb one storey, in either direction; the climbs are walls, not flights', () => {
  const stairs = gameStairs(4);
  assert.equal(stairs.length, TOWER_STAIRS.filter((s) => !s.climb).length);
  assert.ok(TOWER_STAIRS.filter((s) => s.climb).map((s) => s.id).sort().join() === 'core,wide', 'the wide stair and the core stair are climbs');
  for (const s of stairs) assert.equal(Math.abs(s.toFloorY - s.fromFloorY), 4);
  assert.ok(!stairs.some((s) => s.id === 'core' || s.id === 'wide'));
});

test('a climb has a wall on the lower storey across the upper end of its opening, and the opening is railed all round', () => {
  for (const s of TOWER_STAIRS.filter((t) => t.climb)) {
    const walls = climbWalls(stairLow(s));
    const w = walls.find((c) => c.id === s.id)!;
    assert.ok(w, s.id);
    assert.equal(w.toLevel, stairHigh(s));
    assert.equal(w.x1 - w.x0, s.width * 4);
    // Under the opening the lower storey is floor to walk on; above, the footprint is a hole with a rail on every side (the upper end too).
    for (const c of stairCells(s)) assert.ok(walkable(stairLow(s), c.x, c.y), `${s.id} foot ${c.x},${c.y}`);
    const spans = ledgeSpans(stairHigh(s)).filter((l) => l.axis === 'x' && Math.abs(l.fixed - w.edge) < 1e-6 && l.nz === w.nz);
    assert.ok(spans.length > 0, `${s.id}: a ledge span along the upper edge`);
    assert.ok(spans.some((l) => l.from <= w.x0 + 0.5 && l.to >= w.x1 - 0.5), `${s.id}: it spans the wall's width`);
  }
});

test('every guard, post and dog starts on floor, and each round can be walked end to end', () => {
  for (const p of TOWER_PATROLS) {
    for (const c of p.route) assert.ok(walkable(p.level, c.x, c.y), `storey ${p.level} round point ${c.x},${c.y}`);
    const play = playCells(p.level);
    const seen = new Set<string>([`${p.route[0]!.x},${p.route[0]!.y}`]);
    const queue = [p.route[0]!];
    while (queue.length) {
      const c = queue.shift()!;
      for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (play[c.y]![c.x]![d] && !seen.has(k)) {
          seen.add(k);
          queue.push({ x: c.x + dx, y: c.y + dy });
        }
      }
    }
    for (const c of p.route) assert.ok(seen.has(`${c.x},${c.y}`), `storey ${p.level}: ${c.x},${c.y} cannot be reached on the round`);
  }
  for (const g of TOWER_POSTS) assert.ok(walkable(g.level, g.x, g.y));
  for (const d of TOWER_DOGS) assert.ok(walkable(d.level, d.x, d.y));
});

test('no one stands where the agent comes in, or within sight of the street door on the first move', () => {
  for (const p of TOWER_PATROLS) if (p.level === 0) for (const c of p.route) assert.ok(Math.hypot(c.x, c.y) >= 3, 'the lobby round keeps its distance from the door');
});

test('sight across storeys: down the atrium, not through a balcony or the offices floor', () => {
  const FH = 4;
  const eye = (cx: number, cy: number, level: number, h: number) => ({ x: cx * 4, y: level * FH + h, z: cy * 4 });
  // Someone leaning on the gallery's rail at (2,4) sees the middle of the lobby; so does the balcony's front edge.
  assert.ok(sightAcross(FH, eye(2, 4, 2, 1.6), eye(5, 1, 0, 1.3)));
  assert.ok(sightAcross(FH, eye(5, 4, 1, 1.6), eye(5, 1, 0, 1.3)));
  // But not into the lobby's back, which is under the balcony, nor from the offices (a floor over everything).
  assert.ok(!sightAcross(FH, eye(2, 4, 2, 1.6), eye(5, 6, 0, 1.3)));
  assert.ok(!sightAcross(FH, eye(5, 2, 3, 1.6), eye(5, 1, 0, 1.3)));
  // And on one storey it is not this function's call.
  assert.ok(!sightAcross(FH, eye(2, 4, 2, 1.6), eye(8, 4, 2, 1.6)));
});

test('a guard at the rail leans out: sight from the middle of a balcony cell reaches a few metres into the hall, but the offices floor never lets anyone look down', () => {
  const FH = 4;
  const eye = (x: number, z: number, level: number, h: number) => ({ x, y: level * FH + h, z });
  assert.ok(sightAcross(FH, eye(20, 16, 1, 1.6), eye(20, 11, 0, 1.45))); // five metres out, from the cell's middle
  assert.ok(sightAcross(FH, eye(20, 16, 1, 1.6), eye(20, 4, 0, 1.45)));
  assert.ok(!sightAcross(FH, eye(20, 8, 3, 1.6), eye(20, 4, 0, 1.45))); // through the offices floor, no
  assert.ok(!sightAcross(FH, eye(20, 24, 1, 1.6), eye(20, 4, 0, 1.45))); // from the back of the balcony the floor in front is in the way
});

/** The cells reachable on a storey from a start cell, optionally never entering the cells `avoid` says no to. */
function flood(level: number, from: { x: number; y: number }, avoid: (x: number, y: number) => boolean = () => false): Set<string> {
  const play = playCells(level);
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!play[c.y]![c.x]![d] || seen.has(`${nx},${ny}`) || avoid(nx, ny)) continue;
      seen.add(`${nx},${ny}`);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

test('the offices have two ways to the heist door: across the open floor from the core stair, and down the service corridor from Lift B', () => {
  const door = `${HEIST_DOOR.x},${HEIST_DOOR.y}`;
  // From the core stair's head at the west end, through the open floor and a doorway of the back offices.
  assert.ok(flood(OFFICES, { x: 0, y: 0 }).has(door));
  // From Lift B's doors, down the east corridor: never onto the open floor (columns 0 to 9, rows 0 to 3).
  const lift = TOWER_LIFTS.find((l) => l.id === 'B')!;
  const front = liftFront(lift);
  assert.ok(flood(OFFICES, front, (x, y) => x <= 9 && y <= 3).has(door), 'Lift B reaches the door without crossing the open floor');
  // And the open floor really is a way the other route does not need: with it shut, the stair has no way to the door.
  assert.ok(!flood(OFFICES, { x: 0, y: 0 }, (x, y) => y >= 4).has(door));
});

test('the keycard is on floor at the gallery spur, reachable by the stairs, and Lift B starts locked while Lift A does not', () => {
  assert.ok(walkable(TOWER_KEYCARD.level, TOWER_KEYCARD.x, TOWER_KEYCARD.y));
  assert.ok(reachable(false).has(`${TOWER_KEYCARD.level},${TOWER_KEYCARD.x},${TOWER_KEYCARD.y}`));
  assert.equal(TOWER_LIFTS.find((l) => l.id === 'A')!.locked, false);
  assert.equal(TOWER_LIFTS.find((l) => l.id === 'B')!.locked, true);
  // The offices are a stair (or the keycard) from everywhere else: Lift A stops at the gallery.
  assert.ok(!TOWER_LIFTS.find((l) => l.id === 'A')!.serves.includes(OFFICES));
});

test('the gallery is two sections: the stairs and the lift each reach one, and only the bridge joins them', () => {
  const play = playCells(2);
  // The back strip's east end is shut, and the west wing is cut off from the east wing on every row.
  assert.equal(play[7]![6]!.E, false);
  const bridge = TOWER_BRIDGES[0]!;
  const west = flood(2, { x: 5, y: 7 }); // the wide stair's head
  assert.ok(west.has(`${bridge.fromX},${bridge.y}`), 'the stair reaches the west landing');
  assert.ok(!west.has(`${bridge.toX},${bridge.y}`), 'but not the east one, except over the bridge');
  assert.ok(!west.has(`${TOWER_KEYCARD.x},${TOWER_KEYCARD.y}`), 'the card is in the east section');
  assert.ok(west.has('0,4'), 'the core stair foot is in the west section');
  const east = flood(2, liftFront(TOWER_LIFTS.find((l) => l.id === 'A')!));
  assert.ok(east.has(`${TOWER_KEYCARD.x},${TOWER_KEYCARD.y}`), 'the lift reaches the card');
  assert.ok(!east.has('0,4'), 'but not the core stair, except over the bridge');
  // The bridge itself: landings on floor, across void.
  assert.ok(walkable(2, bridge.fromX, bridge.y) && walkable(2, bridge.toX, bridge.y));
  for (let x = bridge.fromX + 1; x < bridge.toX; x++) assert.ok(!hasFloor(2, x, bridge.y), `${x},${bridge.y} is air under the bridge`);
});

test('the lasers stand where they block something: the aisle to the core stair, the back corridor, the way to the service lift', () => {
  const play = playCells(2);
  const l = TOWER_LASERS[2]!;
  for (const s of l.sweepers) {
    assert.ok(walkable(2, s.x, s.y));
    assert.equal(play[s.y]![s.x]!.E, false); // walls either side: the beam fills the aisle
    assert.equal(play[s.y]![s.x]!.W, false);
  }
  for (const s of l.sliders) for (let i = s.from; i <= s.to; i++) assert.ok(s.axis === 'x' ? walkable(2, i, s.at) : walkable(2, s.at, i), `slider cell ${i} of ${s.at}`);
  for (const g of l.gates) {
    assert.ok(walkable(2, g.x, g.y));
    assert.equal(play[g.y]![g.x]!.E, false); // a corridor running north to south, so the beams run across it
  }
  // Without crossing the sweeper's cell the core stair's foot cannot be reached from the strip.
  const noSweeper = flood(2, { x: 5, y: 7 }, (x, y) => l.sweepers.some((s) => s.x === x && s.y === y));
  assert.ok(!noSweeper.has('0,4'));
});

test('the balcony cameras are on its walls and between them watch the rail, both grand stairs\' heads and the wide stair\'s foot', () => {
  for (const c of TOWER_CAMERAS.filter((q) => !q.wall)) {
    assert.equal(c.level, 1);
    assert.ok(c.x > -2 && c.x < TOWER_COLS * 4 - 2 && c.z > -2 && c.z < TOWER_ROWS * 4 - 2, 'inside the building');
  }
  const watched = (cx: number, cy: number): boolean => {
    for (let t = 0; t < 12; t += 0.25) for (const c of TOWER_CAMERAS.filter((q) => !q.wall)) if (botCanSee(c.x, c.z, cameraYaw(c, t), cx * 4, cy * 4, [], c.range, 0, false, c.half)) return true;
    return false;
  };
  for (const [x, y] of [[1, 4], [9, 4], [5, 4], [3, 4], [7, 4]]) assert.ok(watched(x, y), `${x},${y} is never in a camera's view`);
  // And there is somewhere they cannot see at once: the camera cones cover less than the whole balcony at one moment.
  let seenAtOnce = 0;
  let cells = 0;
  for (let y = 4; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) { cells++; if (TOWER_CAMERAS.filter((q) => !q.wall).some((c) => botCanSee(c.x, c.z, cameraYaw(c, 0), x * 4, y * 4, [], c.range, 0, false, c.half))) seenAtOnce++; }
  assert.ok(seenAtOnce < cells * 0.6, `${seenAtOnce} of ${cells} cells watched at once`);
});

test('the security room has one door, reached from the balcony, and its console stands inside', () => {
  const play = playCells(1);
  const room = new Set(TOWER_SECURITY.cells.map((c) => `${c.x},${c.y}`));
  const doors: string[] = [];
  for (const c of TOWER_SECURITY.cells) {
    for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
      const n = `${c.x + dx},${c.y + dy}`;
      if (play[c.y]![c.x]![d] && !room.has(n)) doors.push(`${c.x},${c.y}${d}`);
    }
  }
  assert.deepEqual(doors, ['9,5W']);
  assert.ok(flood(1, { x: 9, y: 5 }).size >= TOWER_SECURITY.cells.length);
  assert.ok(reachable(false).has('1,9,5'));
});

test('ledges: the balcony and the gallery have runs of rail with a drop beyond, joined end to end; the lobby and the offices\' stair sides do not', () => {
  assert.ok(ledgeSpans(1).length > 0);
  assert.ok(ledgeSpans(2).length > 0);
  assert.equal(ledgeSpans(0).length, 0, 'the lobby has only stair sides');
  const fronts = ledgeSpans(1).filter((s) => s.axis === 'x' && s.fixed === 14);
  assert.equal(fronts.length, 3, 'the balcony front edge is three runs: the corner, between the two grand stairs\' heads, and the east corner');
  const mid = fronts.sort((a, b) => b.to - b.from - (a.to - a.from))[0]!;
  assert.equal(mid.nz, -1, 'the drop is to the north');
  assert.ok(mid.to - mid.from >= 24, 'joined from head to head');
  for (const l of [1, 2, 3]) for (const s of ledgeSpans(l)) {
    const cx = s.axis === 'x' ? (s.from + s.to) / 2 : s.fixed;
    const cz = s.axis === 'x' ? s.fixed : (s.from + s.to) / 2;
    assert.ok(!hasFloor(l, Math.round((cx + s.nx * 0.5) / 4), Math.round((cz + s.nz * 0.5) / 4)), `storey ${l}: beyond the rail is a drop`);
  }
});

test('ledgeNear finds the rail from the floor side, not from the drop, and not from far off', () => {
  // On the balcony at the front edge (z = 14), standing at z = 15 in the middle: the rail is a metre north.
  const near = ledgeNear(1, 20, 15);
  assert.ok(near && Math.abs(near.dist - 1) < 1e-9);
  assert.equal(ledgeNear(1, 20, 19.5), null, 'too far from any rail');
  assert.equal(ledgeNear(1, 20, 12.8, 1.2), null, 'on the drop side');
});

test('the keycard doors stand in the two doorways of the back offices, and the open floor reaches the heist door only through them', () => {
  assert.equal(TOWER_OFFICE_DOORS.length, 2);
  for (const d of TOWER_OFFICE_DOORS) {
    assert.equal(d.level, OFFICES);
    assert.equal(d.y, 4, 'on the wall north of row 4');
    assert.ok(walkable(OFFICES, d.x, d.y) && walkable(OFFICES, d.x, d.y - 1), 'floor on both sides');
    assert.ok(playCells(OFFICES)[d.y]![d.x]!.N, 'a doorway, not a wall');
  }
  // Every other cell along that wall is shut.
  for (let x = 0; x < TOWER_COLS - 1; x++) if (!TOWER_OFFICE_DOORS.some((d) => d.x === x)) assert.ok(!playCells(OFFICES)[4]![x]!.N, `wall at column ${x}`);
});

test('the offices have a pair of guards on the same round, a cell apart, so one is never alone', () => {
  const rounds = TOWER_PATROLS.filter((p) => p.level === OFFICES);
  assert.ok(rounds.length >= 2);
  const [a, b] = rounds;
  assert.ok(Math.abs(a!.route[0]!.x - b!.route[0]!.x) <= 1 && a!.route[0]!.y === b!.route[0]!.y);
  for (let i = 1; i < a!.route.length; i++) assert.deepEqual(a!.route[i], b!.route[i]);
});

test('every storey holds four to eight guards (rounds and posts) and at least one dog, more further up', () => {
  const guards = (l: number): number => TOWER_PATROLS.filter((p) => p.level === l).length + TOWER_POSTS.filter((p) => p.level === l).length;
  const dogs = (l: number): number => TOWER_DOGS.filter((d) => d.level === l).length;
  for (let l = 0; l < TOWER_LEVELS.length; l++) {
    assert.ok(guards(l) >= 4 && guards(l) <= 8, `storey ${l} has ${guards(l)} guards`);
    assert.ok(dogs(l) >= 1, `storey ${l} has a dog`);
  }
  assert.ok(dogs(OFFICES) >= 3 && dogs(2) >= 2);
});

// ---- every tower ----

const PLAN_IDS = Object.keys(TOWER_PLANS) as Array<keyof typeof TOWER_PLANS>;
const plan = (id: keyof typeof TOWER_PLANS): TowerPlanData => selectTowerPlan(id);

for (const id of PLAN_IDS) {
  nodeTest(`${id}: the plan keeps the rules every tower must (shapes agree, stairs and lifts stand on floor, everything reachable by stairs and bridge, the keycard fetchable, the bridge needed...)`, () => {
    assert.deepEqual(validatePlan(plan(id)), []);
  });

  nodeTest(`${id}: four to eight guards (rounds and posts) on every storey, more dogs further up, rounds away from the street door`, () => {
    const p = plan(id);
    const guards = (l: number): number => p.patrols.filter((r) => r.level === l).length + p.posts.filter((g) => g.level === l).length;
    const dogs = (l: number): number => p.dogs.filter((d) => d.level === l).length;
    for (let l = 0; l < 4; l++) {
      assert.ok(guards(l) >= 4 && guards(l) <= 8, `${id}: storey ${l} has ${guards(l)} guards`);
      assert.ok(dogs(l) >= 1, `${id}: storey ${l} has no dog`);
    }
    assert.ok(dogs(3) >= 3 && dogs(2) >= 2);
    for (const r of p.patrols.filter((q) => q.level === 0)) for (const c of r.route) assert.ok(Math.hypot(c.x - p.start.x, c.y - p.start.y) >= 3, `${id}: a lobby round comes within sight of the street door`);
    const top = p.patrols.filter((r) => r.level === 3);
    assert.ok(Math.abs(top[0]!.route[0]!.x - top[1]!.route[0]!.x) + Math.abs(top[0]!.route[0]!.y - top[1]!.route[0]!.y) <= 1, `${id}: the top floor's first two guards are not a pair`);
  });

  nodeTest(`${id}: it has what the game puts in it: three cameras, a security room, two keycard doors, a bridge, lasers on the gallery, a timed stair, two lifts, grapple rings, the fixed furniture`, () => {
    const p = plan(id);
    assert.equal(p.cameras.filter((c) => !c.wall).length, 3, 'three balcony cameras');
    assert.ok(p.security.cells.length >= 2);
    assert.equal(p.officeDoors.length, 2);
    assert.equal(p.bridges.length, 1);
    assert.ok(p.lasers[2]!.sweepers.length >= 1 && p.lasers[2]!.sliders.length >= 1 && p.lasers[2]!.gates.length >= 1);
    assert.ok(p.stairs.some((s) => s.id === 'core' && s.climb && s.fromLevel === 3 && s.toLevel === 2));
    assert.ok(p.lifts.some((l) => l.id === 'A' && !l.locked) && p.lifts.some((l) => l.id === 'B' && l.locked));
    assert.ok(p.fixed.some((f) => f.kind === 'desk' && f.level === 0) && p.fixed.filter((f) => f.kind === 'console').length === 2);
  });

  nodeTest(`${id}: partition walls divide the storeys into sections, each with a guard of its own, and every gap can be walked`, () => {
    const p = plan(id);
    let cutLevels = 0;
    for (let l = 0; l < 4; l++) {
      const gaps = p.doorways.filter((d) => d.level === l);
      if (gaps.length === 0) continue;
      cutLevels++;
      assert.ok(gaps.length >= 1 && gaps.length <= 3, `${id} ${l}: ${gaps.length} doorways`);
      const sections = sectionsOf(p, l).filter((c) => c.length >= 4);
      assert.ok(sections.length >= 2, `${id} ${l}: only ${sections.length} sections`);
      for (const sec of sections.filter((c) => c.length >= 8)) {
        const inside = new Set(sec.map((c) => `${c.x},${c.y}`));
        const rounds = p.patrols.filter((r) => r.level === l && r.route.every((c) => inside.has(`${c.x},${c.y}`)));
        assert.ok(rounds.length >= 1, `${id} ${l}: a section of ${sec.length} cells has no round of its own`);
      }
      for (const d of p.dogs.filter((q) => q.level === l)) assert.ok(sections.some((sec) => sec.some((c) => c.x === d.x && c.y === d.y)), `${id} ${l}: a dog is outside every section`);
    }
    assert.ok(cutLevels >= 2, `${id}: only ${cutLevels} storeys are partitioned`);
    // A camera on each partition's wall, with the wall behind it and its panel's cell on floor.
    const wallCams = p.cameras.filter((c) => c.wall && !c.high);
    assert.ok(wallCams.length >= cutLevels, `${id}: ${wallCams.length} partition cameras for ${cutLevels} partitions`);
    // Each is bracketed to a stretch of real wall (not a doorway): the wall's edge lies at the mount's side and the camera stands against it.
    for (const c of wallCams) {
      const dx = c.wall === 'W' ? -1 : c.wall === 'E' ? 1 : 0;
      const dz = c.wall === 'N' ? -1 : c.wall === 'S' ? 1 : 0;
      const px = c.x + dx * 0.55; // the wall's middle
      const pz = c.z + dz * 0.55;
      const hit = (p.walls[c.level] ?? []).some((w) => (w.dir === 'W' ? Math.abs(w.x * 4 - 2 - px) < 1e-6 && pz > w.y * 4 - 2 - 1e-6 && pz < w.y * 4 + 2 + 1e-6 : Math.abs(w.y * 4 - 2 - pz) < 1e-6 && px > w.x * 4 - 2 - 1e-6 && px < w.x * 4 + 2 + 1e-6));
      assert.ok(hit, `${id} ${c.level}: a camera at ${c.x},${c.z} is not on a wall`);
    }
    // The watchers at the bridge's two ends face away from it.
    const br = p.bridges[0]!;
    const watchers = p.posts.filter((q) => q.level === br.level && q.y === br.y);
    assert.equal(watchers.length, 2);
    for (const w of watchers) assert.ok(Math.abs(Math.sin(w.facing)) > 0.9 && (w.x < br.fromX + 1 ? Math.sin(w.facing) < 0 : Math.sin(w.facing) > 0), `${id}: a bridge watcher faces the bridge`);
  });

  nodeTest(`${id}: any seed makes a valid tower: the same rules hold, four to eight guards a storey and a dog, a keycard on every storey; the same seed gives the same tower; seeds differ`, () => {
    const sigs = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const p = TOWER_PLANS[id](seed);
      assert.deepEqual(validatePlan(p), [], `seed ${seed}`);
      for (let l = 0; l < 4; l++) {
        const guards = p.posts.filter((q) => q.level === l).length + p.patrols.filter((q) => q.level === l).length;
        assert.ok(guards >= 4 && guards <= 8, `${id} seed ${seed}: storey ${l} has ${guards} guards`);
        assert.ok(p.dogs.some((d) => d.level === l), `${id} seed ${seed}: storey ${l} has no dog`);
        assert.equal(p.cards.filter((c) => c.level === l).length, 1, `${id} seed ${seed}: storey ${l}'s keycard`);
      }
      sigs.add(JSON.stringify([p.walls, p.doorways, p.cards, p.lifts, p.start]));
    }
    assert.ok(sigs.size >= 10, `${id}: only ${sigs.size} different towers in 12 seeds`);
    assert.deepEqual(TOWER_PLANS[id](5), TOWER_PLANS[id](5), 'the same seed, the same tower');
  });
}

nodeTest('the six plans are six different buildings: no two share a footprint, a floor shape or a set of stair places', () => {
  const key = (p: TowerPlanData): string => `${p.cols}x${p.rows}`;
  const shapes = PLAN_IDS.map((id) => plan(id).floors.map((f) => f.join('/')).join('|'));
  assert.equal(new Set(shapes).size, PLAN_IDS.length);
  const stairs = PLAN_IDS.map((id) => plan(id).stairs.map((s) => `${s.x},${s.y},${s.width},${s.fromLevel}`).join(';'));
  assert.equal(new Set(stairs).size, PLAN_IDS.length);
  // And the footprints are not all alike either.
  assert.ok(new Set(PLAN_IDS.map((id) => key(plan(id)))).size >= 4);
  selectTowerPlan('campus');
});

nodeTest('the active plan can be told: activePlan() follows selectTowerPlan', () => {
  for (const id of PLAN_IDS) assert.equal(selectTowerPlan(id).id, activePlan().id);
  selectTowerPlan('campus');
});

const TOWER_CARDS_FOR_TEST = (): { x: number; y: number } => activePlan().cards.find((c) => c.level === 0)!;

nodeTest('pylons stand in the lobby under the openings, each with a fixed half-circle camera at its top aimed at the lobby keycard, and the lasers guard the gallery\'s keycard and the core climb', () => {
  const high = TOWER_CAMERAS.filter((c) => c.high);
  assert.ok(TOWER_PYLONS.length >= 1 && TOWER_PYLONS.length <= 2, 'one or two pylons');
  assert.equal(high.length, TOWER_PYLONS.length);
  const lobbyCard = TOWER_CARDS_FOR_TEST();
  for (const q of TOWER_PYLONS) {
    assert.equal(q.level, 0);
    assert.ok(!hasFloor(1, q.x, q.y) && !hasFloor(2, q.x, q.y), 'six metres clear overhead');
    assert.ok(!walkable(0, q.x, q.y), 'its cell is solid for walkers');
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(walkable(0, q.x + dx!, q.y + dy!), 'a way round');
    const cam = high.find((c) => c.level === 0 && c.x === q.x * 4 && Math.abs(Math.abs(c.z - q.y * 4) - 0.55) < 1e-9);
    assert.ok(cam, 'its camera is on one of its faces');
    assert.equal(cam!.sweep, 0, 'it does not sweep');
    assert.equal(cam!.half, Math.PI / 2, 'a half circle');
    assert.equal(cam!.wall, cam!.z > q.y * 4 ? 'N' : 'S', 'on the face toward the card');
    // The desk is in its cone: dead ahead, and in range.
    const dx = lobbyCard.x * 4 - cam!.x;
    const dz = lobbyCard.y * 4 - cam!.z;
    assert.ok(Math.hypot(dx, dz) < cam!.range, 'in range');
    assert.ok(Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - cam!.face), Math.cos(Math.atan2(dx, dz) - cam!.face))) < 1e-9, 'aimed at the desk');
  }
  // The lasers have something to guard: a curtain over the keycard's row, a gate across the core climb's foot and a sweeper beside it.
  const lasers = TOWER_LASERS[2]!;
  const card = TOWER_KEYCARD;
  assert.ok(lasers.sliders.some((s) => (s.axis === 'x' ? s.at === card.y && s.from <= card.x && s.to >= card.x : s.at === card.x && s.from <= card.y && s.to >= card.y)), 'a curtain sweeps across the keycard');
  const core = TOWER_STAIRS.find((s) => s.id === 'core')!;
  assert.ok(lasers.gates.some((g) => g.x === core.x && g.y === core.y + core.run), 'a gate across the foot of the core climb');
  assert.ok(lasers.sweepers.some((w) => Math.abs(w.x - core.x) + Math.abs(w.y - (core.y + core.run)) === 1), 'a sweeper in the cell before it');
});

nodeTest('line lasers cross a doorway near a keycard (first floor up and top, or the lobby and first floor where one has no doorway), and an alpha roams each storey', () => {
  for (const id of ['campus', 'museum', 'refinery', 'bank', 'warehouse', 'lab'] as const) {
    for (const seed of [0, 1, 2, 3]) {
      const p = TOWER_PLANS[id](seed);
      let groups = 0;
      for (const level of [0, 1, 3]) {
        for (const l of p.lasers[level]?.lines ?? []) {
          groups++;
          const c = playCellsP(p, level)[l.y]![l.x]!;
          assert.ok(l.spanX ? c.N && c.S && !c.E && !c.W : c.E && c.W && !c.N && !c.S, `${id} ${seed}: in a straight doorway`);
          assert.ok(walkableP(p, level, l.x, l.y));
          assert.equal(l.gap, GAP_CROUCH);
        }
      }
      assert.ok(groups >= 1, `${id} ${seed}: a line group somewhere`);
      assert.deepEqual(p.alphas.map((a) => a.level).sort(), [0, 1, 2, 3], `${id} ${seed}: one alpha on each storey`);
      for (const a of p.alphas) {
        assert.ok(walkableP(p, a.level, a.x, a.y));
        assert.ok(!p.dogs.some((d) => d.level === a.level && d.x === a.x && d.y === a.y));
      }
      assert.deepEqual(validatePlan(p), []);
    }
  }
});

nodeTest('in every place the lobby keycard has a fixed half-circle camera on a pylon in view of it, whatever the seed', () => {
  for (const id of ['campus', 'museum', 'refinery', 'bank', 'warehouse', 'lab'] as const) {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const p = TOWER_PLANS[id](seed);
      const card = p.cards.find((c) => c.level === 0)!;
      const high = p.cameras.filter((c) => c.high);
      assert.ok(high.length >= 1 && high.length === p.pylons.length, `${id} ${seed}: a camera on each pylon, and at least one`);
      for (const cam of high) {
        const dx = card.x * 4 - cam.x;
        const dz = card.y * 4 - cam.z;
        assert.equal(cam.sweep, 0);
        assert.equal(cam.half, Math.PI / 2);
        assert.ok(Math.hypot(dx, dz) < cam.range, `${id} ${seed}: the desk is in range`);
        assert.ok(Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - cam.face), Math.cos(Math.atan2(dx, dz) - cam.face))) < 1e-9, `${id} ${seed}: aimed at the desk`);
      }
      assert.deepEqual(validatePlan(p), []);
    }
  }
});
