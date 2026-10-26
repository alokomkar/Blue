import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Avoider, blockedAt, clearSpot, hitsBox } from './avoid.ts';

// A pair of crates in the middle of a cell, as hiding.ts makes them: 1.9 long along x, 1.2 across z.
const crate = { minX: -0.95, maxX: 0.95, minZ: -0.6, maxZ: 0.6 };
const R = 0.34;

test('a body hits a box when its circle’s square overlaps it', () => {
  assert.equal(hitsBox(0, 0, R, crate), true);
  assert.equal(hitsBox(1.2, 0, R, crate), true);
  assert.equal(hitsBox(1.4, 0, R, crate), false);
  assert.equal(blockedAt(0, 0.9, R, [crate]), true);
  assert.equal(blockedAt(0, 1.0, R, [crate]), false);
});

/** Walks a body from (x, z) towards a target in small steps, as the game would, and says how it got on. */
function walk(from: { x: number; z: number }, to: { x: number; z: number }, boxes = [crate], seconds = 12): { x: number; z: number; inside: boolean; arrived: boolean } {
  const a = new Avoider();
  let { x, z } = from;
  let inside = false;
  for (let t = 0; t < seconds; t += 1 / 30) {
    if (Math.hypot(to.x - x, to.z - z) < 0.15) return { x, z, inside, arrived: true };
    const next = a.step(x, z, to.x, to.z, (3.5 / 30), R, boxes, 1 / 30);
    x = next.x;
    z = next.z;
    if (blockedAt(x, z, R, boxes)) inside = true;
  }
  return { x, z, inside, arrived: Math.hypot(to.x - x, to.z - z) < 0.15 };
}

test('walking straight at a pair of crates, a body goes round them and never into them', () => {
  const r = walk({ x: -3.5, z: 0 }, { x: 3.5, z: 0 });
  assert.equal(r.inside, false, 'never inside');
  assert.equal(r.arrived, true, 'and gets to the far side');
});

test('it goes round from any side, and round a lone box in a diagonal approach', () => {
  for (const [from, to] of [
    [{ x: 3.5, z: 0.1 }, { x: -3.5, z: 0 }],
    [{ x: 0, z: -3.5 }, { x: 0, z: 3.5 }],
    [{ x: -3, z: -3 }, { x: 3, z: 3 }],
  ] as const) {
    const r = walk(from, to);
    assert.equal(r.inside, false);
    assert.equal(r.arrived, true);
  }
});

test('with no box in the way, it goes straight', () => {
  const a = new Avoider();
  const p = a.step(0, 0, 0, 4, 0.5, R, [crate.minX === 1 ? crate : { minX: 9, maxX: 10, minZ: 9, maxZ: 10 }], 1 / 30);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.z - 0.5) < 1e-9);
});

test('already inside a box, a body walks straight out, not stuck', () => {
  const a = new Avoider();
  const p = a.step(0, 0, 4, 0, 0.5, R, [crate], 1 / 30);
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.z) < 1e-9);
});

test('a body boxed in on every side waits, then goes on straight rather than stay for ever', () => {
  const walls = [
    { minX: -3, maxX: 3, minZ: 0.4, maxZ: 1.5 },
    { minX: -3, maxX: 3, minZ: -1.5, maxZ: -0.4 },
    { minX: 0.4, maxX: 1.6, minZ: -3, maxZ: 3 },
    { minX: -1.6, maxX: -0.4, minZ: -3, maxZ: 3 },
  ];
  const a = new Avoider();
  let p = { x: 0, z: 0 };
  p = a.step(p.x, p.z, 5, 0, 0.12, R, walls, 0.5);
  assert.deepEqual(p, { x: 0, z: 0 }, 'held up for a moment');
  for (let i = 0; i < 4; i++) p = a.step(p.x, p.z, 5, 0, 0.12, R, walls, 0.5);
  assert.ok(p.x > 0, 'then on through');
});

test('a route point inside the crates is moved out beside them, towards where the body is', () => {
  const north = clearSpot(0, 0, R, [crate], { x: 0, z: 5 });
  assert.ok(!blockedAt(north.x, north.z, R, [crate]));
  assert.ok(north.z > 0 && Math.abs(north.x) < 1e-9, 'out the north side, the nearer to a body to the north');
  const south = clearSpot(0, 0, R, [crate], { x: 0, z: -5 });
  assert.ok(south.z < 0);
  const free = clearSpot(5, 5, R, [crate], { x: 0, z: 0 });
  assert.deepEqual(free, { x: 5, z: 5 });
});
