import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALL_RANGE_M, PERSONAL_SPACE_M, WITNESS_NEAR_M, WITNESS_RANGE_M, flankCell, reachedBy, sawItHappen, separationPush } from './squad.ts';
import { Glance } from './patrol.ts';

test('two guards in one another part by the whole of the overlap, between them', () => {
  const a = separationPush({ x: 0, z: 0 }, [{ x: 0.5, z: 0 }]);
  const b = separationPush({ x: 0.5, z: 0 }, [{ x: 0, z: 0 }]);
  assert.ok(a.x < 0 && Math.abs(a.z) < 1e-9);
  assert.ok(b.x > 0);
  assert.ok(Math.abs(a.x - -(PERSONAL_SPACE_M - 0.5) / 2) < 1e-9);
  // 0.5 apart plus both pushes is the personal space
  assert.ok(Math.abs(0.5 - a.x + b.x - PERSONAL_SPACE_M) < 1e-9);
});

test('guards clear of one another are not pushed, and one exactly on another steps aside', () => {
  assert.deepEqual(separationPush({ x: 0, z: 0 }, [{ x: PERSONAL_SPACE_M + 0.1, z: 0 }]), { x: 0, z: 0 });
  const on = separationPush({ x: 3, z: 3 }, [{ x: 3, z: 3 }]);
  assert.ok(Number.isFinite(on.x) && on.x !== 0);
});

test('a guard sees a partner go down when it is near, or in its wide view with a clear line, and in range', () => {
  const w = { x: 0, z: 0, facing: 0 };
  assert.equal(sawItHappen(w, { x: 0, z: 8 }, true), true);
  assert.equal(sawItHappen(w, { x: 0, z: 8 }, false), false);
  assert.equal(sawItHappen(w, { x: 0, z: -8 }, true), false); // behind it
  assert.equal(sawItHappen(w, { x: 0, z: -(WITNESS_NEAR_M - 0.5) }, true), true); // right beside it
  assert.equal(sawItHappen(w, { x: 0, z: WITNESS_RANGE_M + 1 }, true), false);
  assert.equal(sawItHappen(w, { x: 7, z: 4 }, true), true); // off to the side, well inside the wide view
});

test('a shout reaches the guards in range only', () => {
  const near = { x: 5, z: 5 };
  const far = { x: CALL_RANGE_M + 5, z: 0 };
  assert.deepEqual(reachedBy({ x: 0, z: 0 }, [near, far]), [0]);
});

test('a flank is a reachable cell three to six cells from the agent, well round from the guard', () => {
  const size = 20;
  const cells = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ N: true, S: true, E: true, W: true })));
  const dist = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => Math.abs(x - 10) + Math.abs(y - 16)));
  const agent = { x: 10, y: 8 };
  const guard = { x: 10, y: 16 };
  const f = flankCell(agent, guard, dist, cells)!;
  assert.ok(f);
  const r = Math.hypot(f.x - agent.x, f.y - agent.y);
  assert.ok(r >= 3 && r <= 6);
  const cos = ((f.x - agent.x) * (guard.x - agent.x) + (f.y - agent.y) * (guard.y - agent.y)) / (r * 8);
  assert.ok(cos <= Math.cos((70 * Math.PI) / 180) + 1e-9);
  // nowhere to go: nothing is reachable
  assert.equal(flankCell(agent, guard, dist.map((row) => row.map(() => -1)), cells), null);
});

test('a glance goes to one side, then the other, in different sizes, and stays within the look', () => {
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = new Glance(rand);
  const seen: number[] = [];
  for (let i = 0; i < 600; i++) seen.push(g.step(0.05, 0.7, rand));
  assert.ok(Math.max(...seen) <= 0.7 + 1e-9 && Math.min(...seen) >= -0.7 - 1e-9);
  assert.ok(Math.max(...seen) > 0.15 && Math.min(...seen) < -0.15, 'it looks both ways');
  for (let i = 1; i < seen.length; i++) assert.ok(Math.abs(seen[i]! - seen[i - 1]!) < 0.1, 'smoothly');
  assert.ok(new Set(seen.map((v) => v.toFixed(2))).size > 40);
});
