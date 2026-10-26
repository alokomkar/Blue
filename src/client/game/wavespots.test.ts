import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evenBearings, ringCell, spreadSpots, type Cell } from './wavespots.ts';

const player: Cell = { x: 10, y: 10 };
/** Cells on a ring of `r` round the player, every 15 degrees. */
const ring = (r: number): Cell[] => Array.from({ length: 24 }, (_, i) => ({ x: 10 + Math.round(Math.sin((i / 24) * Math.PI * 2) * r), y: 10 + Math.round(Math.cos((i / 24) * Math.PI * 2) * r) }));
const bearing = (c: Cell): number => Math.atan2(c.x - player.x, c.y - player.y);
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
let seed = 7;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('each guard of a wave gets a spot of its own when there are enough to go round', () => {
  for (const n of [2, 3, 4, 6]) {
    const spots = spreadSpots(ring(7), n, player, rnd);
    assert.equal(spots.length, n);
    assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, n, `n=${n}`);
  }
});

test('they come from different sides of the agent: no two on the same bearing when the candidates are all round', () => {
  for (let trial = 0; trial < 20; trial++) {
    const spots = spreadSpots(ring(7), 4, player, rnd);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(apart(bearing(spots[i]!), bearing(spots[j]!)) > 0.9, `trial ${trial}: two from the same side`);
  }
});

test('with a few candidates the list is still as long as asked, and with none it is empty', () => {
  assert.equal(spreadSpots([{ x: 1, y: 1 }, { x: 5, y: 5 }], 5, player, rnd).length, 5);
  assert.deepEqual(spreadSpots([], 3, player, rnd), []);
  assert.deepEqual(spreadSpots(ring(5), 0, player, rnd), []);
});

test('a wave\'s bearings are evenly apart, round the whole circle', () => {
  for (const n of [2, 3, 4, 6]) {
    const b = evenBearings(n, 0.4);
    assert.equal(b.length, n);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(b[(i + 1) % n]! - b[i]! - (n === 1 ? 0 : (Math.PI * 2) / n)) < 1e-9 || i === n - 1);
    assert.ok((Math.PI * 2) / n >= (30 * Math.PI) / 180 || n > 12);
  }
});

test('the ring cell is the one nearest the asked bearing, inside the ring, or none when nothing is in it', () => {
  const cells: Cell[] = [];
  for (let x = 0; x <= 20; x++) for (let y = 0; y <= 20; y++) cells.push({ x, y });
  const p: Cell = { x: 10, y: 10 };
  for (const deg of [0, 90, 180, -90, 45]) {
    const want = (deg * Math.PI) / 180;
    const c = ringCell(cells, p, want)!;
    const got = Math.atan2(c.x - p.x, c.y - p.y);
    let arc = Math.abs(got - want) % (Math.PI * 2);
    if (arc > Math.PI) arc = Math.PI * 2 - arc;
    assert.ok(arc < 0.5, `${deg}: ${arc}`);
    const r = Math.hypot(c.x - p.x, c.y - p.y);
    assert.ok(r >= 1.2 && r <= 2.4);
  }
  assert.equal(ringCell([{ x: 10, y: 10 }, { x: 11, y: 10 }], p, 0), null);
});
