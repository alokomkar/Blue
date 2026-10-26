import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, bfs } from './maze.ts';
import { POSTURE_HEIGHT } from './evade.ts';
import { BODY_HEIGHT, placeLines, lineHits, lineHeight, lineSide, lineOffset, LINE_HIGH, LINE_LOW, GAP_PRONE, GAP_CROUCH, type LineLaser } from './linelasers.ts';

const CELL = 4;
const R = 0.32;
const at = (g: LineLaser, along: number, across = 0): [number, number] => (g.spanX ? [g.x * CELL + across, g.y * CELL + along] : [g.x * CELL + along, g.y * CELL + across]);

test('line lasers go in straight corridor cells, apart, and reserve them', () => {
  let placed = 0;
  for (let run = 0; run < 40; run++) {
    const cells = generateMaze(14, 10);
    const dist = bfs(cells, 14, 10, 0, 0);
    const used = new Set(['0,0']);
    const lines = placeLines(cells, 14, 10, dist, used, 2, 3);
    for (const g of lines) {
      placed++;
      const c = cells[g.y]![g.x]!;
      assert.ok(g.spanX ? c.N && c.S && !c.E && !c.W : c.E && c.W && !c.N && !c.S);
      assert.ok(used.has(`${g.x},${g.y}`));
      assert.ok(dist[g.y]![g.x]! >= 2);
    }
    if (lines.length === 2) {
      assert.ok(Math.abs(lines[0]!.x - lines[1]!.x) + Math.abs(lines[0]!.y - lines[1]!.y) >= 3);
      assert.equal(lines[0]!.orient, 'h');
      assert.equal(lines[1]!.orient, 'v');
      assert.equal(lines[0]!.count, 3);
      assert.equal(lines[1]!.count, 2);
    }
  }
  assert.ok(placed > 40);
});

test('a horizontal line rises and falls between the floor and above a crouched head, and never clears a standing one', () => {
  const g: LineLaser = { x: 3, y: 3, spanX: true, orient: 'h', count: 1, phase: 0, gap: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 12; t += 0.05) {
    const h = lineHeight(g, 0, t);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    const [px, pz] = at(g, 0);
    assert.ok(lineHits(g, t, px, pz, CELL, R, 'stand'), 'standing is always caught in its plane');
  }
  assert.ok(lo < LINE_LOW + 0.01 && hi > LINE_HIGH - 0.01);
  // Crouched: free while it is above 1.25; lying flat: free while it is above 0.45, which is longer.
  let crouchFree = 0;
  let proneFree = 0;
  for (let t = 0; t < 5.2; t += 0.05) {
    const [px, pz] = at(g, 0);
    if (!lineHits(g, t, px, pz, CELL, R, 'crouch')) crouchFree++;
    if (!lineHits(g, t, px, pz, CELL, R, 'prone')) proneFree++;
  }
  assert.ok(crouchFree > 5 && proneFree > crouchFree + 10);
  // It comes down to the floor: lying flat is caught then.
  let caughtFlat = 0;
  for (let t = 0; t < 5.2; t += 0.05) {
    const [px, pz] = at(g, 0);
    if (lineHits(g, t, px, pz, CELL, R, 'prone')) caughtFlat++;
  }
  assert.ok(caughtFlat > 5);
  // Away from its plane, or outside the corridor, nothing.
  const [px, pz] = at(g, 1.5);
  assert.ok(!lineHits(g, 0, px, pz, CELL, R, 'stand'));
  const [ox, oz] = at(g, 0, 3);
  assert.ok(!lineHits(g, 0, ox, oz, CELL, R, 'stand'));
});

test('a vertical line sweeps wall to wall; lying flat passes under a low one, crouching under a high one, and standing never does', () => {
  for (const [gap, safe] of [[GAP_PRONE, 'prone'], [GAP_CROUCH, 'crouch']] as const) {
    const g: LineLaser = { x: 5, y: 2, spanX: false, orient: 'v', count: 1, phase: 0, gap };
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 7; t += 0.05) {
      const s = lineSide(g, 0, t, CELL);
      min = Math.min(min, s);
      max = Math.max(max, s);
      const [px, pz] = at(g, 0, s);
      assert.ok(lineHits(g, t, px, pz, CELL, R, 'stand'), 'it is on the standing agent');
      assert.ok(!lineHits(g, t, px, pz, CELL, R, safe), `${safe} passes under it`);
    }
    assert.ok(min < -1.4 && max > 1.4, 'it covers the corridor');
  }
  const g: LineLaser = { x: 5, y: 2, spanX: false, orient: 'v', count: 1, phase: 0, gap: GAP_CROUCH };
  const [px, pz] = at(g, 0, lineSide(g, 0, 0, CELL));
  assert.ok(lineHits(g, 0, px, pz, CELL, R, 'stand'));
  assert.ok(lineHits({ ...g, gap: GAP_CROUCH }, 0, px, pz, CELL, R, 'stand'));
});

test('lines of a group are spaced along the corridor and out of step', () => {
  const g: LineLaser = { x: 1, y: 1, spanX: true, orient: 'h', count: 3, phase: 0.1, gap: 0 };
  assert.deepEqual([0, 1, 2].map((i) => lineOffset(g, i)), [-1.25, 0, 1.25]);
  const hs = new Set([0, 1, 2].map((i) => lineHeight(g, i, 0).toFixed(2)));
  assert.equal(hs.size, 3);
  // Each one catches only at its own place.
  const [px, pz] = at(g, 1.25);
  let any = false;
  for (let t = 0; t < 6; t += 0.05) if (lineHits(g, t, px, pz, CELL, R, 'prone')) any = true;
  assert.ok(any);
  const [mx, mz] = at(g, 0.6);
  for (let t = 0; t < 6; t += 0.05) assert.ok(!lineHits(g, t, mx, mz, CELL, R, 'stand'), 'between two lines is clear');
});

test('the body heights match the gates\'', () => {
  assert.deepEqual(BODY_HEIGHT, POSTURE_HEIGHT);
});
