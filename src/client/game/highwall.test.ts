import test from 'node:test';
import assert from 'node:assert/strict';
import { DROP_REACH, END_MARGIN, HOP_M, HOP_S, JUMP_REACH, LEDGE_OUT, LEDGE_Y, SHIMMY_CLIP_M, SHIMMY_CLIP_S, SHIMMY_SPEED, clampAlong, cornerAt, crossTarget, floorPoint, handsPoint, highRuns, hopTarget, leftAlong, runOf } from './highwall.ts';
import { wallContact } from './wallclimb.ts';

// Four 4 m segments of a tall wall along x, end to end, on the line z = -2 (0.28 thick); one more beside them that is not tall.
const seg = (i: number, high = true) => ({ minX: i * 4 - 2, maxX: i * 4 + 2, minZ: -2.14, maxZ: -1.86, ...(high ? { high: true } : {}) });
const BOXES = [seg(0), seg(1), seg(2), seg(3), { minX: 20, maxX: 24, minZ: -2.14, maxZ: -1.86 }];

test('tall wall segments end to end make one run, and a plain wall beside them is not in it', () => {
  const runs = highRuns(BOXES);
  assert.equal(runs.length, 1);
  const r = runs[0]!;
  assert.equal(r.run, 'x');
  assert.ok(Math.abs(r.centre + 2) < 1e-9);
  assert.equal(r.lo, -2);
  assert.equal(r.hi, 14);
  assert.ok(Math.abs(r.thick - 0.28) < 1e-9);
});

test('a gap between tall walls is two runs; walls across each other are two', () => {
  assert.equal(highRuns([seg(0), seg(2)]).length, 2);
  assert.equal(highRuns([seg(0), { minX: 3.9, maxX: 4.1, minZ: -6, maxZ: -2, high: true }]).length, 2);
});

test('a dash at a tall wall meets it as a tall wall, and finds its run', () => {
  const c = wallContact(BOXES, 5, -0.5, Math.PI, 1.6); // at z = -0.5 facing -z: the wall's face is at z = -1.86
  assert.ok(c);
  assert.equal(c.high, true);
  const run = runOf(highRuns(BOXES), c);
  assert.ok(run);
  assert.equal(run.lo, -2);
  const plain = wallContact(BOXES, 22, -0.5, Math.PI, 1.6);
  assert.ok(plain);
  assert.equal(plain.high, false);
  assert.equal(runOf(highRuns(BOXES), plain), null);
});

test('the hands stay clear of the run’s ends, and rest on the shelf’s edge on the side the face looks to', () => {
  const r = highRuns(BOXES)[0]!;
  assert.equal(clampAlong(r, -5), r.lo + END_MARGIN);
  assert.equal(clampAlong(r, 99), r.hi - END_MARGIN);
  assert.equal(clampAlong(r, 6), 6);
  const h = handsPoint(r, 0, 1, 6); // the face looks +z (toward a corridor south of the wall)
  assert.equal(h.x, 6);
  assert.ok(h.z > r.centre + r.thick / 2 && h.z < r.centre + r.thick / 2 + LEDGE_OUT, 'on the shelf, over the face and under its outer edge');
  const f = floorPoint(r, 0, 1, 6, 0.7);
  assert.ok(Math.abs(f.z - (r.centre + r.thick / 2 + 0.7)) < 1e-9);
});

test('which way along the run the agent’s left lies, whichever way it faces the wall', () => {
  const north = highRuns(BOXES)[0]!; // a run along x: the agent faces -z (angle pi) at its south face
  assert.equal(leftAlong(north, Math.PI), -1, 'facing north the left is west: toward lower x');
  assert.equal(leftAlong(north, 0), 1, 'facing south the left is east');
  const east = { run: 'z', centre: 0, lo: 0, hi: 10, thick: 0.28 } as const; // a run along z, faced from the west (facing +x, angle pi/2)
  assert.equal(leftAlong(east, Math.PI / 2), -1, 'facing east the left is north: toward lower z');
});

test('a hop goes a full hop along the shelf, is cut short at the run’s end and refused with no room', () => {
  const r = highRuns(BOXES)[0]!;
  assert.equal(hopTarget(r, 5, 1), 5 + HOP_M);
  assert.equal(hopTarget(r, 5, -1), 5 - HOP_M);
  const end = hopTarget(r, r.hi - END_MARGIN - 0.6, 1);
  assert.equal(end, r.hi - END_MARGIN, 'shortened to the end');
  assert.equal(hopTarget(r, r.hi - END_MARGIN - 0.2, 1), null, 'less than a handspan left');
});

test('the numbers hang together: a shimmy is slower than a hop, a leap reaches further than a drop, the shelf is at an ordinary wall’s top', () => {
  assert.ok(SHIMMY_SPEED < HOP_M / HOP_S / 2, 'a hop covers ground at least twice as fast as a shimmy');
  assert.ok(Math.abs(SHIMMY_CLIP_M / SHIMMY_CLIP_S - 0.47) < 0.01);
  assert.ok(JUMP_REACH > DROP_REACH);
  assert.equal(LEDGE_Y, 3.07);
});

test('the pull-up onto the wall top: out from the face while the body rises, then in over the cap to the centre line; the hands let go as it clears the edge', async () => {
  const { mountOut, mountGrip, HANG_OUT } = await import('./highwall.ts');
  const thick = 0.3;
  assert.equal(mountOut(0, thick), HANG_OUT);
  assert.equal(mountOut(0.4, thick), HANG_OUT, 'still out at the face while it rises');
  assert.ok(Math.abs(mountOut(1, thick) + thick / 2) < 1e-9, 'ends on the wall’s centre line');
  let last = Infinity;
  for (let k = 0; k <= 1; k += 0.05) {
    const o = mountOut(k, thick);
    assert.ok(o <= last + 1e-9, 'only ever in');
    last = o;
  }
  assert.equal(mountGrip(0), 1);
  assert.equal(mountGrip(1), 0);
  assert.ok(mountGrip(0.5) > 0 && mountGrip(0.5) < 1);
});

test('round a corner: an inner corner turns the hang the other way, an outer corner wraps it round the wall\'s end, and a wall that does not meet the end is no corner', () => {
  const T = 0.28;
  // an L: a wall along x at z = 10 from x = 0 to 10 (plus the corner), and one along z at x = 10 from z = 10 to 20 (plus the corner)
  const along = { run: 'x', centre: 10, lo: 0 - T / 2, hi: 10 + T / 2, thick: T } as const;
  const down = { run: 'z', centre: 10, lo: 10 - T / 2, hi: 20 + T / 2, thick: T } as const;
  const runs = [along, down];
  // on the +z face of the x wall (the inner side of the L), going +x: the z wall's face looking back at us (-x), going +z
  const inner = cornerAt(runs, along, 0, 1, 1)!;
  assert.equal(inner.run, down);
  assert.deepEqual([inner.nx, inner.nz, inner.dir, inner.convex], [-1, 0, 1, false]);
  assert.ok(inner.along >= 10 + T / 2 && inner.along <= down.hi);
  // on the -z face (the outer side), going +x: wraps onto the z wall's +x face, going -z... but the z wall only reaches +z, so it goes back along the wall's own end
  const outer = cornerAt(runs, along, 0, -1, 1)!;
  assert.equal(outer.run, down);
  assert.deepEqual([outer.nx, outer.nz, outer.convex, outer.dir], [1, 0, true, 1]);
  // no wall at the other end
  assert.equal(cornerAt(runs, along, 0, 1, -1), null);
  // a wall that does not meet the end is no corner
  assert.equal(cornerAt([along, { ...down, centre: 14, lo: 20, hi: 30 }], along, 0, 1, 1), null);
});

test('jumping across a gap: the nearest other face that looks toward the agent, within reach', () => {
  const T = 0.28;
  const a = { run: 'x', centre: 10, lo: 0, hi: 10, thick: T } as const;
  const b = { run: 'x', centre: 14, lo: 0, hi: 10, thick: T } as const; // four metres across the corridor, parallel
  const far = { run: 'x', centre: 40, lo: 0, hi: 10, thick: T } as const;
  // hanging on the +z face of a (z about 10.6): b's -z face looks back at us, 3.7 m off
  const t = crossTarget([a, b, far], a, 5, 10.7)!;
  assert.equal(t.run, b);
  assert.deepEqual([t.nx, t.nz], [0, -1]);
  assert.equal(t.along, 5);
  // too far to reach, or nothing on that side
  assert.equal(crossTarget([a, far], a, 5, 10.7), null);
  assert.equal(crossTarget([a], a, 5, 10.7), null);
  // it never crosses to the face of the wall it hangs from
  assert.equal(crossTarget([b, a], b, 5, 13.3)?.run, a);
});

test('a gap as wide as a hall (eight metres) is too far to jump across', () => {
  const T = 0.28;
  const a = { run: 'x', centre: 10, lo: 0, hi: 10, thick: T } as const;
  const hall = { run: 'x', centre: 18, lo: 0, hi: 10, thick: T } as const;
  assert.equal(crossTarget([a, hall], a, 5, 10.7), null);
  assert.equal(crossTarget([a, { ...hall, centre: 14 }], a, 5, 10.7)?.run.centre, 14, 'a cell across is within reach');
});

test('jumping across never goes through a wall: the wall behind the one hung from is out of reach', () => {
  const T = 0.28;
  const a = { run: 'x', centre: 10, lo: 0, hi: 10, thick: T } as const;
  const behind = { run: 'x', centre: 7, lo: 0, hi: 10, thick: T } as const; // three metres behind a, its +z face looking at us
  const across = { run: 'x', centre: 14, lo: 0, hi: 10, thick: T } as const; // four metres across the open side
  assert.equal(crossTarget([a, behind, across], a, 5, 10.7)?.run, across);
  assert.equal(crossTarget([a, behind], a, 5, 10.7), null);
});
