import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS, arrivesAt, locationFor } from './locations.ts';

test('the first two jobs are on the campus, and after that the places take turns', () => {
  const at = (n: number): string => locationFor(n).id;
  assert.deepEqual([1, 2].map(at), ['campus', 'campus']);
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(at), ['museum', 'refinery', 'bank', 'warehouse', 'lab', 'campus']);
  assert.deepEqual([9, 10, 11, 12, 13, 14].map(at), ['refinery', 'campus', 'lab', 'museum', 'warehouse', 'bank']);
});

test('no place comes up twice running, and every round of six visits all six places', () => {
  for (let n = 2; n < 200; n++) assert.notEqual(locationFor(n).id, locationFor(n + 1).id, `jobs ${n} and ${n + 1}`);
  for (let from = 3; from < 200; from += 6) {
    assert.equal(new Set([0, 1, 2, 3, 4, 5].map((k) => locationFor(from + k).id)).size, 6, `the round starting at job ${from}`);
  }
});

test('the places do not come in the same order every round', () => {
  const rounds = new Set<string>();
  for (let from = 3; from < 3 + 24; from += 6) rounds.add([0, 1, 2, 3, 4, 5].map((k) => locationFor(from + k).id).join());
  assert.equal(rounds.size, 4);
});

test('each new place announces itself on its first job only, and the campus never does', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => arrivesAt(n)?.id ?? null), [null, null, 'museum', 'refinery', 'bank', 'warehouse', 'lab', null, null, null]);
  for (const id of ['museum', 'refinery', 'bank', 'warehouse', 'lab'] as const) assert.match(LOCATIONS[id].arrival, /^NEW LOCATION/);
});

test('every place has two floors that look different from each other and from the other places', () => {
  const names = new Set<string>();
  for (const loc of Object.values(LOCATIONS)) {
    const [ground, upper] = loc.floors;
    assert.notEqual(ground.name, upper.name);
    assert.ok(ground.wall !== upper.wall, `${loc.id}: the floors share a wall colour`);
    for (const t of loc.floors) {
      assert.ok(!names.has(t.name), `two floors called ${t.name}`);
      names.add(t.name);
      assert.ok(t.decorKinds.length > 0);
      assert.equal(t.edge.kind, loc.id === 'campus' ? 'campus' : loc.id);
    }
  }
  // The new places each have a floor surface of their own.
  assert.equal(LOCATIONS.museum.floors[0].floor, 'marble');
  assert.equal(LOCATIONS.refinery.floors[0].floor, 'grating');
  assert.equal(LOCATIONS.bank.floors[0].floor, 'parquet');
  assert.equal(LOCATIONS.warehouse.floors[0].floor, 'concrete');
  assert.equal(LOCATIONS.lab.floors[0].floor, 'tile');
});

test('a place dresses its rooms in its own kinds, not the campus office ones', () => {
  const campusKinds = new Set(['office', 'conference', 'cafeteria', 'rack']);
  for (const id of ['museum', 'refinery', 'bank', 'warehouse', 'lab'] as const) {
    for (const t of LOCATIONS[id].floors) {
      assert.ok(t.decorKinds.every((k) => !campusKinds.has(k)), `${id}/${t.name} has an office room`);
    }
  }
});

test('wall trim sits within the wall, bottom to top, and stands proud a little', () => {
  for (const loc of Object.values(LOCATIONS)) {
    for (const t of loc.floors) {
      for (const b of t.bands ?? []) {
        assert.ok(b.y0 >= 0 && b.y1 <= 3 && b.y1 > b.y0, `${t.name}: a band from ${b.y0} to ${b.y1}`);
        assert.ok(b.out > 0 && b.out < 0.3);
      }
    }
  }
});

test('each place has its own kind of job, and a job the game can’t play yet falls back to records', async () => {
  const { wantedContract, contractFor, PLAYABLE } = await import('./contracts.ts');
  // The campus takes records, the museum a swap, the refinery sabotage, the bank a vault, the warehouse a shipment, the lab an extraction.
  assert.equal(wantedContract(1, 'campus'), 'records');
  assert.equal(wantedContract(3, locationFor(3).id), 'swap');
  assert.equal(wantedContract(4, locationFor(4).id), 'sabotage');
  assert.equal(wantedContract(5, locationFor(5).id), 'vault');
  assert.equal(wantedContract(6, locationFor(6).id), 'shipment');
  assert.equal(wantedContract(7, locationFor(7).id), 'extract');
  const seen = new Set<string>();
  for (let n = 1; n <= 30; n++) {
    const place = locationFor(n).id;
    const c = contractFor(n, place);
    assert.ok(PLAYABLE.has(c), `job ${n}: ${c} isn't playable`);
    seen.add(c);
    if (!PLAYABLE.has(wantedContract(n, place))) assert.equal(c, 'records');
  }
  assert.equal(seen.size, 6, 'every kind of job comes up');
});
