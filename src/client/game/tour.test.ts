import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTour, describe, stationText, flyDuration, type TourSpot } from './tour.ts';

const spot = (kind: TourSpot['kind'], floor: number, x: number, z: number, files?: number): TourSpot => ({ kind, floor, x, z, ...(files ? { files } : {}) });

test('the way out comes last, and the nearest stop first', () => {
  const spots = [spot('exit', 0, 50, 0), spot('files', 0, 40, 0, 2), spot('uplink', 0, 4, 0), spot('files', 0, 20, 8, 1)];
  const order = orderTour(spots, { floor: 0, x: 0, z: 0 });
  assert.deepEqual(order.map((s) => s.kind), ['uplink', 'files', 'files', 'exit']);
  assert.equal(order[1]!.z, 8, 'the nearer files first');
});

test('the stairs come just before the tour goes up, and only if it does', () => {
  const up = [spot('uplink', 0, 4, 0), spot('files', 0, 20, 0, 1), spot('stairs', 0, 30, 0), spot('logs', 1, 12, 12), spot('files', 1, 24, 8, 1), spot('exit', 0, 60, 0)];
  const order = orderTour(up, { floor: 0, x: 0, z: 0 });
  const kinds = order.map((s) => s.kind);
  assert.equal(kinds.at(-1), 'exit');
  assert.equal(order[kinds.indexOf('stairs') + 1]!.floor, 1, 'the stop after the stairs is upstairs');
  assert.equal(new Set(order).size, order.length, 'each stop once');
  // Nothing upstairs: the stairs aren't worth a stop.
  const flat = orderTour([spot('uplink', 0, 4, 0), spot('stairs', 0, 30, 0), spot('exit', 0, 60, 0)], { floor: 0, x: 0, z: 0 });
  assert.deepEqual(flat.map((s) => s.kind), ['uplink', 'exit']);
});

test('starting upstairs (the roof), the stops there come first and the stairs before going down', () => {
  const spots = [spot('uplink', 0, 4, 0), spot('logs', 1, 8, 8), spot('stairs', 0, 30, 0), spot('exit', 0, 60, 0)];
  const order = orderTour(spots, { floor: 1, x: 0, z: 0 });
  assert.deepEqual(order.map((s) => s.kind), ['logs', 'stairs', 'uplink', 'exit']);
});

test('every stop says what it is', () => {
  for (const kind of ['uplink', 'files', 'logs', 'stairs', 'exit'] as const) {
    const d = describe(spot(kind, 0, 0, 0, 3));
    assert.ok(d.title.length > 0 && d.text.length > 0);
  }
  assert.match(describe(spot('files', 0, 0, 0, 3)).text, /3 files/);
  assert.match(describe(spot('files', 0, 0, 0, 1)).text, /A file/);
});

test('a flight takes longer the further it goes, never a jump cut and never a crawl', () => {
  assert.ok(flyDuration(0) >= 1.2);
  assert.ok(flyDuration(20) > flyDuration(5));
  assert.ok(flyDuration(1000) <= 2.4);
});

test('a contract station is described by what it is, and the uplink is the alarm link off a records job', () => {
  const shot = describe({ kind: 'files', floor: 0, x: 0, z: 0, title: 'Cryo pod', text: stationText('cryo') });
  assert.equal(shot.title, 'Cryo pod');
  assert.ok(!/records room|photograph/i.test(shot.text));
  assert.equal(describe({ kind: 'uplink', floor: 0, x: 0, z: 0, alarm: true }).title, 'The alarm link');
  assert.equal(describe({ kind: 'uplink', floor: 0, x: 0, z: 0 }).title, 'The uplink');
  assert.ok(!stationText('tracker', 'B').includes('real'), 'a container never gives the answer away');
});
