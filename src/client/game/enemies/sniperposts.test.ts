import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACING, SNIPER_LEVELS, SNIPER_MIN_GROUND, SNIPER_MIN_LANE, lane, planSniperPosts, rngFor, sniperCount, type PlanView, type Way } from './sniperposts.ts';
import { TOWER_PLANS, activePlan, selectTowerPlan, setSniperPosts, sniperViewOf, towerBlocked, validatePlan, TOWER_LAYOUT } from '../towerplan.ts';
import { TOWER_SET_IDS, furnitureFor, setLayoutPlan } from '../towerfurniture.ts';

setLayoutPlan(TOWER_LAYOUT);
const WAYS: Way[] = ['N', 'S', 'E', 'W'];
const wayOf = (f: number): Way => WAYS.find((w) => Math.abs(FACING[w] - f) < 1e-9)!;
const SEEDS = [0, 1, 7, 42, 99, 2024, 12345];

/** A hall of `cols` x `rows` floor with a void in the middle columns, no walls inside, one level. */
function hall(cols: number, rows: number, voidFrom: number, voidTo: number): PlanView {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const isDrop = (x: number, y: number): boolean => inside(x, y) && x >= voidFrom && x <= voidTo;
  return {
    cols,
    rows,
    walk: (_l, x, y) => inside(x, y) && !isDrop(x, y),
    taken: () => false,
    busy: () => false,
    deck: () => false,
    arrivals: () => [],
    clear: () => true,
    drop: (_l, x, y) => isDrop(x, y),
    solid: () => false,
    open: (_l, x, y, way) => {
      const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[way]!;
      return inside(x + d[0]!, y + d[1]!) && !isDrop(x + d[0]!, y + d[1]!);
    },
    reached: () => true,
  };
}

test('a lane counts the cells a look passes before a wall, how many are void, and whether it starts at a rail', () => {
  const v = hall(11, 5, 4, 6);
  assert.deepEqual(lane(v, 2, 2, 2, 'E'), { reach: 8, over: 3, edge: false, ground: 4, across: true }, 'floor on the far side of the drop');
  assert.deepEqual(lane(v, 2, 3, 2, 'E'), { reach: 7, over: 3, edge: true, ground: 4, across: true }, 'right at the rail: a balcony');
  assert.deepEqual(lane(v, 2, 2, 2, 'N'), { reach: 2, over: 0, edge: false, ground: 0, across: false });
  assert.equal(lane(v, 2, 0, 2, 'E').ground, 5);
  assert.equal(lane({ ...v, deck: (_l, x) => x >= 4 && x <= 6 }, 2, 0, 2, 'E').ground, 8, 'a bridge\'s deck counts as somewhere to be');
  const blocked: PlanView = { ...v, clear: (_l, x, _y, way) => !(way === 'E' && x === 5) };
  assert.equal(lane(blocked, 2, 2, 2, 'E').reach, 3, 'a wall on the line stops it');
  const lift: PlanView = { ...v, solid: (_l, x) => x === 8 };
  assert.equal(lane(lift, 2, 2, 2, 'E').reach, 5, 'a cab or a pylon stops it');
});

test('the planner needs the lane, floor behind, and keeps off the agent\'s arrivals, and gives the same posts for the same stream', () => {
  const v = { ...hall(13, 7, 5, 7), arrivals: () => [{ x: 1, y: 3 }] };
  const posts = planSniperPosts(v, rngFor(1, 'x'), 4);
  assert.ok(posts.length >= 1);
  for (const p of posts) {
    const w = wayOf(p.facing);
    assert.ok(lane(v, p.level, p.x, p.y, w).reach >= SNIPER_MIN_LANE && lane(v, p.level, p.x, p.y, w).ground >= SNIPER_MIN_GROUND);
    const back = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[w]!;
    assert.ok(v.walk(p.level, p.x + back[0]!, p.y + back[1]!), 'floor behind it');
    assert.ok(Math.abs(p.x - 1) + Math.abs(p.y - 3) >= 3, 'not at the stairs');
  }
  assert.deepEqual(planSniperPosts(v, rngFor(1, 'x'), 4), posts);
  assert.ok(SNIPER_LEVELS.includes(posts[0]!.level));
});

test('two on a storey keep their distance', () => {
  const v = hall(13, 7, 5, 7);
  const posts = planSniperPosts(v, rngFor(5, 'y'), 4).filter((p) => p.level === 2);
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) assert.ok(Math.abs(posts[i]!.x - posts[j]!.x) + Math.abs(posts[i]!.y - posts[j]!.y) >= 5);
});

test('two snipers at first, three from job 3, four from job 6', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 12].map(sniperCount), [2, 2, 3, 3, 4, 4]);
});

for (const id of TOWER_SET_IDS) {
  test(`${id}: every seed gives four posts on the upper storeys, each a long lane with a way round to its back, clear of the stairs, lifts and cards, and deterministic`, () => {
    for (const seed of SEEDS) {
      const p = TOWER_PLANS[id](seed);
      const v = sniperViewOf(p);
      const posts = planSniperPosts(v, rngFor(p.seed, p.id), 4);
      assert.equal(posts.length, 4, `${id} ${seed}`);
      assert.deepEqual(planSniperPosts(sniperViewOf(TOWER_PLANS[id](seed)), rngFor(seed, id), 4), posts, 'the same plan and seed give the same posts');
      assert.notEqual(posts[0]!.level, posts[1]!.level, 'the first two are on different storeys');
      assert.ok(posts.every((q) => q.level >= 1 && q.level <= 3), 'upper storeys only');
      for (const q of posts) {
        const w = wayOf(q.facing);
        assert.ok(v.walk(q.level, q.x, q.y) && v.reached(q.level, q.x, q.y), `${id} ${seed}: a post off the floor or unreachable`);
        assert.ok(!v.taken(q.level, q.x, q.y), `${id} ${seed}: a post on a claimed cell`);
        assert.ok(lane(v, q.level, q.x, q.y, w).reach >= SNIPER_MIN_LANE && lane(v, q.level, q.x, q.y, w).ground >= SNIPER_MIN_GROUND, `${id} ${seed}: a short lane, or one over nothing`);
        const back = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[w]!;
        assert.ok(v.walk(q.level, q.x + back[0]!, q.y + back[1]!) && v.open(q.level, q.x, q.y, OPP[w]), `${id} ${seed}: no way round to its back`);
        for (const a of v.arrivals(q.level)) assert.ok(Math.abs(a.x - q.x) + Math.abs(a.y - q.y) >= 3, `${id} ${seed}: a post at the agent's arrival`);
      }
      // none shares a cell with another, and a plan with posts is still a valid plan.
      assert.equal(new Set(posts.map((q) => `${q.level},${q.x},${q.y}`)).size, 4);
      setSniperPosts(p, posts);
      assert.deepEqual(validatePlan(p), [], `${id} ${seed}`);
    }
  });

  test(`${id}: different seeds give different towers and different posts, and the furniture keeps off them`, () => {
    const sets = new Set<string>();
    for (const seed of SEEDS) {
      selectTowerPlan(id, seed);
      const p = activePlan();
      const posts = planSniperPosts(sniperViewOf(p), rngFor(seed, id), 4);
      setSniperPosts(p, posts);
      sets.add(JSON.stringify(posts));
      setLayoutPlan(TOWER_LAYOUT); // (a fresh layout for this plan, with the posts known)
      for (const q of posts) {
        assert.ok(towerBlocked(q.level, q.x, q.y), 'a post is a place that must stay clear');
        for (const f of furnitureFor(q.level, id)) {
          const inCell = f.box.minX < q.x * 4 + 0.5 && f.box.maxX > q.x * 4 - 0.5 && f.box.minZ < q.y * 4 + 0.5 && f.box.maxZ > q.y * 4 - 0.5;
          assert.ok(!inCell, `${id} ${seed}: a ${f.kind} stands on a sniper's post at ${q.level},${q.x},${q.y}`);
        }
      }
    }
    assert.ok(sets.size >= 4, `${id}: the posts hardly change with the seed`);
  });
}
const OPP: Record<Way, Way> = { N: 'S', S: 'N', E: 'W', W: 'E' };
