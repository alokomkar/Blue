import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloorForVerify, verifyLevel, type FloorGenerators } from './floorbuild.ts';
import { PLACE_IDS, LAYOUT_IDS, defaultSpec, effectiveSize, type LevelSpec } from './levelspec.ts';
import { checkFloors, checkGrid } from './verify.ts';
import { bfs, farthestCell, generateMaze, placeBotSpawn, placeHidingSpots, placeLaserTraps, placeStair, stairReserved } from '../client/game/maze.ts';
import { generateLayout, landmarkOf, stairSpurOf } from '../client/game/layouts.ts';
import { generateBuilding } from '../client/game/building.ts';
import { LOCATIONS } from '../client/game/locations.ts';
import { planSecurity } from '../client/game/security.ts';
import { placeSweepers, placeSliders } from '../client/game/movingLasers.ts';
import { placeLines } from '../client/game/linelasers.ts';
import { placeGates } from '../client/game/evade.ts';
import { placeShutters } from '../client/game/shutters.ts';
import { planObjectives } from '../client/game/objectives.ts';
import { restoreRandom, seedRandom } from '../client/game/seeded.ts';

/**
 * The game's own generators, wired to the shapes floorbuild.ts asks for. This is the wiring a server does too: the client files are imported with their .ts
 * extensions (they are pure: type-only imports, no three.js), which a Node entry point in api/ can do and src/shared can't (tsc's rootDir).
 */
const real: FloorGenerators = {
  seedRandom,
  restoreRandom,
  plan: (place, layout, _floor, cols, rows) => {
    const cells = layout === 'maze' ? generateMaze(cols, rows) : generateLayout(layout, cols, rows, LOCATIONS[place].landmark, generateBuilding);
    return { cells, landmark: landmarkOf(cells), spur: stairSpurOf(cells) };
  },
  bfs,
  farthestCell,
  placeStair,
  stairReserved,
  planSecurity,
  placeBotSpawn,
  placeHidingSpots,
  placeLaserTraps,
  placeSweepers,
  placeSliders,
  placeLines,
  placeGates,
  placeShutters,
  planObjectives,
};

const spec = (over: Partial<LevelSpec> = {}): LevelSpec => ({ ...defaultSpec(), roster: { ...defaultSpec().roster, guards: 3, watchdogs: 1 }, ...over });

test('the same spec and seed build the same floors, and another seed builds others', () => {
  for (const place of PLACE_IDS) {
    for (const layout of LAYOUT_IDS) {
      const s = spec({ place, layout, size: { cols: 12, rows: 9 }, seed: 4242 });
      const a = buildFloorForVerify(s, real);
      const b = buildFloorForVerify(s, real);
      assert.deepEqual(a, b, `${place} ${layout}`);
      assert.notDeepEqual(buildFloorForVerify({ ...s, seed: 4243 }, real), a, `${place} ${layout} seed`);
    }
  }
});

test('the seed is the random only while a floor is built, even if the build throws', () => {
  const native = Math.random;
  buildFloorForVerify(spec({ seed: 9 }), real);
  assert.equal(Math.random, native);
  const broken: FloorGenerators = { ...real, plan: () => { throw new Error('no plan'); } };
  assert.throws(() => buildFloorForVerify(spec(), broken), /no plan/);
  assert.equal(Math.random, native);
});

test('every place and layout builds one and two floors, shaped as the game builds them', () => {
  for (const place of PLACE_IDS) {
    for (const layout of LAYOUT_IDS) {
      for (const floors of [1, 2] as const) {
        const s = spec({ place, layout, floors, size: { cols: 12, rows: 9 }, seed: 7 });
        const built = buildFloorForVerify(s, real);
        const tag = `${place} ${layout} ${floors}`;
        assert.ok(built.length === 1 || (floors === 2 && built.length === 2), tag);
        const [ground, upper] = built;
        assert.equal(ground!.floor, 0, tag);
        assert.deepEqual([ground!.cols, ground!.rows], [12, 9], tag);
        assert.deepEqual(ground!.start, { x: 0, y: 0 }, tag);
        assert.ok(ground!.exit && ground!.exit.x >= 0 && ground!.exit.x < 12 && ground!.exit.y >= 0 && ground!.exit.y < 9, tag);
        assert.equal(ground!.expect!.stair, floors === 2, tag);
        if (upper) {
          assert.equal(upper.floor, 1, tag);
          assert.equal(upper.exit, null, tag);
          assert.ok(ground!.stair, tag);
          assert.deepEqual(upper.start, { x: 0, y: 0 }, tag);
          // The landing's wall is punched open, where the stair comes up.
          assert.ok(upper.cells[0]![0]!.N || upper.cells[0]![0]!.W, tag);
        } else if (floors === 2) {
          assert.equal(ground!.stair, null, tag); // no stair fitted: the floor above was not built, and V3 says so
        }
        assert.ok(ground!.stations.some((st) => st.kind === 'uplink'), tag);
      }
    }
  }
});

test('the roster and hazards asked for are what is placed, per floor, and twists change them as the game does', () => {
  const s = spec({ place: 'warehouse', layout: 'aisles', size: { cols: 14, rows: 10 }, floors: 2, seed: 31, roster: { guards: 3, watchdogs: 2, crawlers: 1, alphas: 1, drones: 1, heavies: 0 }, hazards: { doors: 1, lasers: 2, lines: 1, gates: 2, sweepers: 1, sliders: 1, shutters: 0, blackouts: 0 } });
  const count = (f: { guards: Array<{ kind: string }> }, kind: string): number => f.guards.filter((g) => g.kind === kind).length;
  for (const f of buildFloorForVerify(s, real)) {
    assert.equal(count(f, 'guard'), 3);
    assert.equal(count(f, 'watchdog'), 2);
    assert.equal(count(f, 'crawler'), 1);
    assert.equal(count(f, 'alpha'), 1);
    assert.equal(count(f, 'drone'), 1);
    assert.equal(f.lasers.length, 2);
    assert.equal(f.hazards.filter((h) => h.kind === 'gate').length, 2);
    assert.equal(f.hazards.filter((h) => h.kind === 'line').length, 1);
    assert.equal(f.hazards.filter((h) => h.kind === 'sweeper').length, 1);
    assert.ok(f.hazards.filter((h) => h.kind === 'slider').length >= 3); // a curtain is a run of cells
    // Nothing shares a cell with another thing.
    const cells = [...f.guards, ...f.lasers, ...f.hazards.filter((h) => h.kind !== 'slider')].map((p) => `${p.x},${p.y}`);
    assert.equal(new Set(cells).size, cells.length);
  }
  const reinforced = buildFloorForVerify({ ...s, twists: ['reinforcements'] }, real);
  assert.equal(count(reinforced[0]!, 'guard'), 4);
  assert.equal(count(reinforced[0]!, 'watchdog'), 3);
  // A silent night: dogs only, and the ground floor shrinks to the slow pace.
  const silent = buildFloorForVerify({ ...s, twists: ['silent'] }, real);
  assert.deepEqual([silent[0]!.cols, silent[0]!.rows], [10, 7]);
  assert.deepEqual(effectiveSize({ ...s, twists: ['silent'] }), { cols: 10, rows: 7 });
  assert.deepEqual([...new Set(silent[0]!.guards.map((g) => g.kind))], ['watchdog']);
});

test('a records job puts its files in records rooms, and any other contract has none', () => {
  const rec = buildFloorForVerify(spec({ floors: 2, size: { cols: 12, rows: 9 }, loot: { documents: 4 }, seed: 5 }), real);
  const storage = rec.map((f) => f.stations.filter((st) => st.kind === 'storage').length);
  assert.deepEqual(rec.map((f) => f.expect!.storage), [2, 2]);
  assert.ok(storage[0]! >= 1 && storage[1]! >= 1);
  const raid = buildFloorForVerify(spec({ contract: 'sabotage', floors: 2, size: { cols: 12, rows: 9 }, seed: 5 }), real);
  assert.deepEqual(raid.map((f) => f.expect!.storage), [0, 0]);
  assert.deepEqual(raid.map((f) => f.stations.filter((st) => st.kind === 'storage').length), [0, 0]);
  // The way the game splits the files: the upper floor takes the extra one.
  assert.deepEqual(buildFloorForVerify(spec({ floors: 2, size: { cols: 12, rows: 9 }, loot: { documents: 3 }, seed: 5 }), real).map((f) => f.expect!.storage), [1, 2]);
});

test('a calm spec on a full-size floor passes V1 to V3 for most seeds, in every place', () => {
  for (const place of PLACE_IDS) {
    let passed = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const verdict = verifyLevel(spec({ place, layout: 'halls', size: { cols: 14, rows: 10 }, floors: 2, seed }), real);
      assert.ok(verdict.spec);
      if (verdict.ok) passed++;
    }
    assert.ok(passed >= 12, `${place}: only ${passed} of 24 seeds passed`);
  }
});

test('the verdict on a real floor names what failed: a tiny floor is too short a walk', () => {
  const tiny = spec({ size: { cols: 6, rows: 5 }, floors: 1, roster: { ...defaultSpec().roster, guards: 0 }, hazards: { ...defaultSpec().hazards, lasers: 0 } });
  const verdicts = Array.from({ length: 12 }, (_, i) => verifyLevel({ ...tiny, seed: i + 1 }, real));
  assert.ok(verdicts.filter((v) => v.failures.some((f) => f.code === 'exit_close')).length >= 8);
  const first = verdicts.find((v) => v.failures.some((f) => f.code === 'exit_close'))!;
  assert.equal(first.ok, false);
  assert.ok(first.failures.every((f) => f.where && f.message));
});

test('verifyLevel stops at a spec that fails V1, and builds nothing', () => {
  let built = 0;
  const counting: FloorGenerators = { ...real, plan: (...args) => { built++; return real.plan(...args); } };
  const bad = verifyLevel({ ...defaultSpec(), contract: 'sabotage', twists: ['silent'] }, counting);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map((f) => f.code), ['twist_misfit']);
  assert.equal(bad.spec, null);
  assert.deepEqual(bad.floors, []);
  assert.equal(verifyLevel('not a spec', counting).ok, false);
  assert.equal(built, 0);
  const good = verifyLevel(defaultSpec(), counting);
  assert.ok(good.spec && good.floors.length >= 1 && built >= 1);
});

// ---------------------------------------------------------------------------------------------------------------------

/** A sketch's grid: one corridor snaking back and forth across `cols` by `rows`, `extra` cells opened across it to make a loop. */
function serpentine(cols: number, rows: number, loops: Array<[number, number]> = []): NonNullable<LevelSpec['grid']> {
  const cells = Array.from({ length: cols * rows }, () => ({ n: false, s: false, e: false, w: false }));
  const at = (x: number, y: number) => cells[y * cols + x]!;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols - 1; x++) {
      at(x, y).e = true;
      at(x + 1, y).w = true;
    }
    if (y < rows - 1) {
      const x = y % 2 === 0 ? cols - 1 : 0;
      at(x, y).s = true;
      at(x, y + 1).n = true;
    }
  }
  for (const [x, y] of loops) {
    at(x, y).s = true;
    at(x, y + 1).n = true;
  }
  const endX = rows % 2 === 1 ? cols - 1 : 0;
  return { cols, rows, cells, start: { x: 0, y: 0 }, exit: { x: endX, y: rows - 1 } };
}

test('a given grid is built on as it is, with its own start and exit, and a long snaking walk passes V2', () => {
  const grid = serpentine(8, 6);
  const s = spec({ size: { cols: 8, rows: 6 }, floors: 1, grid, roster: { ...defaultSpec().roster, guards: 2, watchdogs: 0 }, hazards: { ...defaultSpec().hazards, lasers: 0, doors: 0 } });
  const built = buildFloorForVerify(s, real);
  assert.equal(built.length, 1);
  const f = built[0]!;
  assert.deepEqual([f.start, f.exit], [grid.start, grid.exit]);
  assert.deepEqual(f.cells[0]![0], { N: false, S: false, E: true, W: false });
  assert.deepEqual(f.cells[1]![7], { N: true, S: false, E: false, W: true });
  assert.equal(f.guards.length, 2);
  assert.deepEqual(checkGrid(built).failures, []);
  assert.deepEqual(buildFloorForVerify(s, real), built);
});

test('a given grid with loops builds, places and is checked without a fuss', () => {
  const grid = serpentine(10, 6, [[3, 0], [6, 2], [2, 3]]);
  const s = spec({ size: { cols: 10, rows: 6 }, floors: 1, grid, hazards: { ...defaultSpec().hazards, lasers: 2, doors: 1 }, seed: 3 });
  const verdict = verifyLevel(s, real);
  assert.ok(verdict.spec?.grid);
  assert.equal(verdict.floors.length, 1);
  // Loops shorten the walk: the exit is nearer than the snake's 59 steps but still far.
  assert.ok(!verdict.failures.some((f) => f.code === 'unreachable'));
  assert.ok(verdict.floors[0]!.guards.length >= 1);
});

test('a given grid with a pocket nothing connects is not accepted: V2 names the cell', () => {
  const grid = serpentine(8, 6);
  // Close the snake's first turn: everything past row 0 is cut off from the start.
  grid.cells[7]!.s = false;
  grid.cells[15]!.n = false;
  const verdict = verifyLevel(spec({ size: { cols: 8, rows: 6 }, floors: 1, grid }), real);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((f) => f.code === 'unreachable' && f.where?.floor === 0));
  assert.ok(verdict.failures.some((f) => /exit/.test(f.message)));
  assert.equal(checkFloors(verdict.floors).ok, false);
});
