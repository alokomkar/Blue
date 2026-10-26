import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANNOUNCE, GAP_MAX_S, GAP_MIN_S, Habits, ROUTE_AWAY_S, STUN_RANGE_M, THRESHOLD, type Place } from './habits.ts';

const at = (x: number, z = 0, floor = 0): Place => ({ x, z, floor });

test('nothing is answered before a tactic passes its threshold', () => {
  const h = new Habits(1);
  h.notePlace('hide', at(10));
  h.noteCamo();
  h.noteCamo();
  h.noteStun(8);
  assert.equal(h.due(0), null);
  assert.deepEqual(h.waiting, []);
});

test('the same hiding spot twice is a habit; a different spot is not', () => {
  const h = new Habits(1);
  h.notePlace('hide', at(10));
  h.notePlace('hide', at(30));
  assert.equal(h.due(0), null, 'two different spots');
  h.notePlace('hide', at(11)); // the first again, a metre off
  const c = h.due(0);
  assert.equal(c?.tactic, 'hide');
  assert.equal(c?.line, ANNOUNCE.hide);
  assert.equal(c?.at?.x, 10);
});

test('a corner counts per floor: the same spot on another storey is another corner', () => {
  const h = new Habits(1);
  h.notePlace('corner', at(10, 10, 0));
  h.notePlace('corner', at(10, 10, 1));
  assert.equal(h.due(0), null);
  h.notePlace('corner', at(12, 11, 1));
  assert.equal(h.due(0)?.tactic, 'corner');
});

test('stun counts only from range', () => {
  const h = new Habits(1);
  for (let i = 0; i < THRESHOLD.stun + 3; i++) h.noteStun(STUN_RANGE_M - 0.5);
  assert.equal(h.tally().stun, 0);
  for (let i = 0; i < THRESHOLD.stun; i++) h.noteStun(STUN_RANGE_M + 1);
  assert.equal(h.due(0)?.tactic, 'stun');
});

test('camo counts its switch-ons', () => {
  const h = new Habits(1);
  for (let i = 0; i < THRESHOLD.camo; i++) h.noteCamo();
  assert.equal(h.due(0)?.tactic, 'camo');
});

test('a lane is busy once it has been walked enough times, with a gap between passes', () => {
  const h = new Habits(1);
  let now = 0;
  const pass = (x: number): void => {
    // in the lane for a few seconds, then away for longer than the gap
    for (let s = 0; s < 3; s++) h.stepRoute(at(x), (now += 1));
    for (let s = 0; s < ROUTE_AWAY_S + 1; s++) h.stepRoute(at(x + 40), (now += 1));
  };
  for (let i = 0; i < THRESHOLD.route - 1; i++) pass(0);
  assert.equal(h.due(now), null, 'one pass short');
  for (let s = 0; s < 3; s++) h.stepRoute(at(1), (now += 1));
  const c = h.due(now);
  assert.equal(c?.tactic, 'route');
  assert.ok(c?.at && Math.abs(c.at.x) < 5, 'the counter knows which lane');
});

test('standing about in a lane is one pass, and a quick pop out and back is not a new one', () => {
  const h = new Habits(1);
  let now = 0;
  for (let s = 0; s < 200; s++) h.stepRoute(at(0), (now += 1));
  assert.equal(h.tally().route, 1);
  for (let i = 0; i < 20; i++) {
    h.stepRoute(at(30), (now += 2));
    h.stepRoute(at(0), (now += 2));
  }
  assert.equal(h.tally().route, 1, 'away only two seconds each time');
});

test('walking along a lane does not build a count anywhere else', () => {
  const h = new Habits(1);
  let now = 0;
  for (let i = 0; i < 4; i++) {
    for (let x = 0; x < 60; x += 0.5) h.stepRoute(at(x), (now += 0.2));
    for (let s = 0; s < ROUTE_AWAY_S + 2; s++) h.stepRoute(at(300), (now += 1));
  }
  assert.ok(h.tally().route <= 4);
  assert.equal(h.due(now), null);
});

test('one counter at a time, 60 to 90 seconds apart, and the next is held until then', () => {
  const h = new Habits(7);
  h.notePlace('hide', at(0));
  h.notePlace('hide', at(0));
  h.notePlace('corner', at(50));
  h.notePlace('corner', at(50));
  for (let i = 0; i < THRESHOLD.camo; i++) h.noteCamo();
  assert.deepEqual(h.waiting, ['hide', 'corner', 'camo'], 'in the order they passed');
  const first = h.due(100);
  assert.equal(first?.tactic, 'hide');
  assert.equal(h.due(100.5), null, 'not at once');
  assert.equal(h.due(100 + GAP_MIN_S - 1), null, 'not before 60 seconds');
  const second = h.due(100 + GAP_MAX_S + 0.01);
  assert.equal(second?.tactic, 'corner');
  assert.equal(h.due(100 + GAP_MAX_S + 1), null);
  assert.equal(h.due(100 + 2 * GAP_MAX_S + 1)?.tactic, 'camo');
});

test('the gap is drawn from the seed: the same level waits the same, another level need not', () => {
  const gaps = (seed: number): number[] => {
    const h = new Habits(seed);
    const out: number[] = [];
    let now = 0;
    for (const t of ['hide', 'corner'] as const) {
      h.notePlace(t, at(t === 'hide' ? 0 : 99));
      h.notePlace(t, at(t === 'hide' ? 0 : 99));
    }
    h.due(now);
    for (; ; now += 0.5) {
      if (h.due(now)) {
        out.push(now);
        break;
      }
    }
    return out;
  };
  assert.deepEqual(gaps(5), gaps(5));
  const g = gaps(5)[0]!;
  assert.ok(g >= GAP_MIN_S - 0.01 && g <= GAP_MAX_S + 0.5);
  assert.notDeepEqual(
    [1, 2, 3, 4, 5, 6].map((s) => gaps(s)[0]),
    [1, 2, 3, 4, 5, 6].map(() => gaps(1)[0]),
    'the seed matters'
  );
});

test('never twice for the same tactic in a level', () => {
  const h = new Habits(1);
  for (let i = 0; i < 6; i++) h.notePlace('hide', at(0));
  assert.equal(h.due(0)?.tactic, 'hide');
  for (let i = 0; i < 6; i++) h.notePlace('hide', at(0));
  assert.equal(h.due(1000), null);
  assert.deepEqual(h.done, ['hide']);
});

test('a counter nobody can carry out yet stays waiting, and the cooldown is not used up', () => {
  const h = new Habits(1);
  h.notePlace('hide', at(0));
  h.notePlace('hide', at(0));
  h.noteCamo();
  h.noteCamo();
  h.noteCamo();
  assert.equal(h.due(0, (t) => t !== 'hide')?.tactic, 'camo', 'the first that can be answered goes');
  assert.deepEqual(h.waiting, ['hide']);
  assert.equal(h.due(1000, () => false), null);
  assert.deepEqual(h.waiting, ['hide'], 'still waiting');
  assert.equal(h.due(1000)?.tactic, 'hide');
});

test('a new level starts clean', () => {
  const h = new Habits(1);
  h.notePlace('hide', at(0));
  h.notePlace('hide', at(0));
  assert.equal(new Habits(1).tally().hide, 0);
  assert.equal(new Habits(1).due(0), null);
  assert.equal(h.due(0)?.tactic, 'hide');
});
