import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEC_BASE_JOB, SPEC_PARAM_MAX, decodeSpecParam, encodeSpecParam, gridCells, liftFacing, seedRoll, specJob } from './specload.ts';
import { PLAYABLE } from './contracts.ts';
import { clampSpec, defaultSpec, specToDifficulty, type LevelSpec } from '../../shared/levelspec.ts';
import { difficultyFor } from './difficulty.ts';
import { buildFloorForVerify, type FloorGenerators } from '../../shared/floorbuild.ts';
import { bfs, farthestCell, generateMaze, placeBotSpawn, placeHidingSpots, placeLaserTraps, placeStair, stairReserved } from './maze.ts';
import { generateLayout, landmarkOf, stairSpurOf } from './layouts.ts';
import { generateBuilding } from './building.ts';
import { LOCATIONS } from './locations.ts';
import { planSecurity } from './security.ts';
import { placeSweepers, placeSliders } from './movingLasers.ts';
import { placeLines } from './linelasers.ts';
import { placeGates } from './evade.ts';
import { placeShutters } from './shutters.ts';
import { planObjectives } from './objectives.ts';
import { restoreRandom, seedRandom } from './seeded.ts';

test('a spec survives the round trip through the URL, text and all', () => {
  const spec = { ...defaultSpec(), title: 'Night at the Muséum, 夜', brief: 'Get in "quietly"; get out. <b>&</b>' };
  const text = encodeSpecParam(spec);
  assert.match(text, /^[A-Za-z0-9_-]+$/, 'url-safe, no padding');
  const back = decodeSpecParam(text);
  assert.ok(back.ok);
  assert.deepEqual(back.value, spec);
  // Plain base64 with padding, and bare JSON, are read too.
  const plain = Buffer.from(JSON.stringify(spec)).toString('base64');
  assert.deepEqual(decodeSpecParam(plain), { ok: true, value: spec });
  assert.deepEqual(decodeSpecParam(JSON.stringify(spec)), { ok: true, value: spec });
});

test('text that is not a spec is refused with a reason, never thrown on', () => {
  for (const bad of [null, undefined, '', '   ', 'not base64!!', 'eyJ', '@@@@', 'e30', 'W10', 'x'.repeat(SPEC_PARAM_MAX + 1)]) {
    const r = decodeSpecParam(bad as string | null | undefined);
    // `e30` is {} and `W10` is []: valid JSON, so read; the clamp decides what they are.
    if (bad === 'e30' || bad === 'W10') assert.ok(r.ok);
    else assert.ok(!r.ok && r.error.length > 0, String(bad));
  }
  // Valid base64, bytes that are not UTF-8.
  assert.equal(decodeSpecParam(Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')).ok, false);
});

test('any decoded value clamps to a legal spec the loader can use', () => {
  for (const v of [{}, [], 7, null, 'x', { version: 1, place: 'moon', roster: 5 }]) {
    const { spec } = clampSpec(v);
    const job = specJob(spec, PLAYABLE);
    assert.equal(job.level, SPEC_BASE_JOB);
    assert.ok(Number.isInteger(job.seed) && job.seed >= 0 && job.seed <= 0xffffffff);
  }
});

test('a spec job carries the spec\'s own place, layout, twists and seed, and the contract if the game can play it', () => {
  const spec: LevelSpec = { ...defaultSpec(), place: 'bank', layout: 'fishbone', contract: 'vault', twists: ['lightsout', 'shiftchange'], seed: 4_000_000_000 };
  const job = specJob(spec, PLAYABLE);
  assert.deepEqual([job.place, job.layout, job.contract, job.seed, job.grid], ['bank', 'fishbone', 'vault', 4_000_000_000, null]);
  assert.deepEqual(job.twists, ['lightsout', 'shiftchange']);
  assert.notEqual(job.twists, spec.twists, 'a copy');
  // 'hit' and 'blackout' are not playable yet: records.
  assert.equal(specJob({ ...spec, contract: 'hit' }, PLAYABLE).contract, 'records');
  assert.equal(specJob({ ...spec, contract: 'blackout' }, PLAYABLE).contract, 'records');
  // No twists means none, not a dealt one.
  assert.deepEqual(specJob({ ...spec, twists: [] }, PLAYABLE).twists, []);
});

test('the side goal\'s roll and the seed are the spec\'s alone, and spread', () => {
  assert.equal(seedRoll(5, 7), seedRoll(5, 7));
  const rolls = Array.from({ length: 200 }, (_, i) => seedRoll(i * 977, 7));
  assert.ok(rolls.every((r) => r >= 0 && r < 1));
  assert.ok(new Set(rolls.map((r) => Math.floor(r * 6))).size === 6, 'every sixth is hit');
  assert.notEqual(seedRoll(5, 1), seedRoll(5, 2));
});

test('the same spec and seed lay out the same floor, through the game\'s own generators, and the loader\'s difficulty is the spec\'s', () => {
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
  const spec: LevelSpec = { ...defaultSpec(), place: 'museum', layout: 'aisles', contract: 'swap', size: { cols: 12, rows: 8 }, seed: 99, roster: { ...defaultSpec().roster, guards: 3, watchdogs: 1 } };
  const a = buildFloorForVerify(spec, real);
  assert.deepEqual(buildFloorForVerify(spec, real), a);
  assert.notDeepEqual(buildFloorForVerify({ ...spec, seed: 100 }, real), a);
  const d = specToDifficulty(spec, { ...difficultyFor(SPEC_BASE_JOB), newThisJob: null });
  assert.deepEqual([d.cols, d.rows, d.guards, d.watchdogs, d.newThisJob], [12, 8, 3, 1, null]);
});

test('a sketch\'s walls become the game\'s cells, fresh each time', () => {
  const grid = { cols: 3, rows: 2, cells: Array.from({ length: 6 }, (_, i) => ({ n: i >= 3, s: i < 3, e: i % 3 < 2, w: i % 3 > 0 })), start: { x: 0, y: 0 }, exit: { x: 2, y: 1 } };
  const a = gridCells(grid);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.length, 3);
  assert.deepEqual(a[0]![0], { N: false, S: true, E: true, W: false });
  a[0]![0]!.N = true;
  assert.equal(gridCells(grid)[0]![0]!.N, false);
});

test('a lift faces an opening with a wall behind it, and any opening if there is none', () => {
  const cell = (N: boolean, S: boolean, E: boolean, W: boolean) => ({ N, S, E, W });
  // A dead end: its one opening.
  assert.equal(liftFacing([[cell(false, false, true, false)]], 0, 0), 'E');
  // The generated floors' corner (open south and east, walled north and west): south first, as the game's own choice.
  assert.equal(liftFacing([[cell(false, true, true, false)]], 0, 0), 'S');
  // A hall with a wall on its north side and doors east, west and south: south has the shut wall opposite, east and west have an open one.
  assert.equal(liftFacing([[cell(false, true, true, true)]], 0, 0), 'S');
  // A straight hall: both ends open, so no wall behind either; the first opening.
  assert.equal(liftFacing([[cell(false, false, true, true)]], 0, 0), 'E');
  // Outside the grid, or a solid cell: a harmless default.
  assert.equal(liftFacing([[cell(false, false, false, false)]], 0, 0), 'S');
  assert.equal(liftFacing([], 3, 3), 'S');
});
