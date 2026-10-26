import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposure, hasLineOfSight, tryFire, tryFireAimed, lineClearOver, inViewCone, botCanSee, rayToBoxes, canTakedown, AWARE_RADIUS, TAKEDOWN_RANGE } from './detection.ts';
import type { WallBox } from './scene.ts';

function box(minX: number, maxX: number, minZ: number, maxZ: number): WallBox {
  return { minX, maxX, minZ, maxZ };
}

test('hasLineOfSight: clear line within range is visible from any direction (no facing/blind-spot check)', () => {
  assert.equal(hasLineOfSight(0, 0, 5, 0, []), true);
  assert.equal(hasLineOfSight(0, 0, 0, -5, []), true); // "behind" a facing-based bot would be a blind spot — not here
  assert.equal(hasLineOfSight(0, 0, -3, 4, []), true);
});

test('hasLineOfSight: out of detection range is not visible even with a clear line', () => {
  assert.equal(hasLineOfSight(0, 0, 50, 0, []), false);
});

test('hasLineOfSight: a wall directly between bot and player blocks it', () => {
  const wall = box(2.5, 3.5, -10, 10); // a wall segment straight across the path at x≈3
  assert.equal(hasLineOfSight(0, 0, 6, 0, [wall]), false);
});

test('hasLineOfSight: a wall around a corner does not block a line that never crosses it', () => {
  const wall = box(2.5, 3.5, 5, 15); // off to the side, not on the line from (0,0) to (6,0)
  assert.equal(hasLineOfSight(0, 0, 6, 0, [wall]), true);
});

function fakeBot(worldX: number, worldZ: number, disabled = false) {
  return { worldX, worldZ, disabled, disable() {} };
}

test('tryFire: hits a bot directly ahead within range', () => {
  // facingAngle 0 means forward is world (sinθ, cosθ) = (0, 1)
  const bot = fakeBot(0, 6);
  const hit = tryFire(0, 0, 0, [bot as never], []);
  assert.equal(hit, bot);
});

test('tryFire: misses a bot outside the aim cone', () => {
  const bot = fakeBot(6, 0); // directly to the "east," not ahead
  const hit = tryFire(0, 0, 0, [bot as never], []);
  assert.equal(hit, null);
});

test('tryFire: misses a bot beyond range', () => {
  const bot = fakeBot(0, 40);
  const hit = tryFire(0, 0, 0, [bot as never], []);
  assert.equal(hit, null);
});

test('tryFire: ignores an already-disabled bot', () => {
  const bot = fakeBot(0, 6, true);
  const hit = tryFire(0, 0, 0, [bot as never], []);
  assert.equal(hit, null);
});

test('tryFire: a wall in the way blocks the shot', () => {
  const bot = fakeBot(0, 6);
  const wall = box(-1, 1, 2.5, 3.5);
  const hit = tryFire(0, 0, 0, [bot as never], [wall]);
  assert.equal(hit, null);
});

test('tryFire: picks the nearest of several bots in the cone', () => {
  const near = fakeBot(0, 4);
  const far = fakeBot(0, 8);
  const hit = tryFire(0, 0, 0, [far as never, near as never], []);
  assert.equal(hit, near);
});

test('inViewCone: ahead is inside the 100° cone, beside and behind are not', () => {
  // facing 0 = +Z
  assert.equal(inViewCone(0, 0, 0, 0, 5), true);
  assert.equal(inViewCone(0, 0, 0, 3, 4), true); // ~37° off-axis
  assert.equal(inViewCone(0, 0, 0, 5, 0.5), false); // ~84° off-axis
  assert.equal(inViewCone(0, 0, 0, 0, -5), false); // directly behind
  assert.equal(inViewCone(0, 0, Math.PI / 2, 5, 0), true); // facing +X
});

test('botCanSee: sneaking up behind a bot goes unnoticed until inside its awareness radius', () => {
  assert.equal(botCanSee(0, 0, 0, 0, -6, []), false, 'behind, outside awareness radius');
  assert.equal(botCanSee(0, 0, 0, 0, -(AWARE_RADIUS - 0.2), []), true, 'behind but too close');
  assert.equal(botCanSee(0, 0, 0, 0, 6, []), true, 'ahead within range');
  assert.equal(botCanSee(0, 0, 0, 0, 12, []), false, 'ahead but beyond detection radius');
});

test('botCanSee: a wall blocks both the cone and the awareness radius', () => {
  const wall = [box(-2, 2, 0.8, 1.0)];
  assert.equal(botCanSee(0, 0, 0, 0, 5, wall), false);
  assert.equal(botCanSee(0, 0, 0, 0, 1.5, wall), false);
});

test('rayToBoxes: stops at the first wall, or runs the full distance when clear', () => {
  const walls = [box(-1, 1, 4, 4.3), box(-1, 1, 2, 2.3)];
  assert.ok(Math.abs(rayToBoxes(0, 0, 0, 1, 10, walls) - 2) < 1e-9, 'nearest wall wins');
  assert.equal(rayToBoxes(0, 0, 1, 0, 10, walls), 10, 'clear ray runs to maxDist');
});

// canTakedown: an enemy at the origin facing +Z (angle 0); "behind" it is -Z.
test('canTakedown: from right behind, close, facing it, unnoticed', () => {
  assert.equal(canTakedown(0, 0, 0, false, 0, -1.2, 0, []), true);
});

test('canTakedown: not from in front or from the side it can see', () => {
  assert.equal(canTakedown(0, 0, 0, false, 0, 1.2, Math.PI, []), false);
  // About 50° off its nose: inside the cone plus the blind-spot margin, so it would see you.
  assert.equal(canTakedown(0, 0, 0, false, 1.0, 0.8, Math.atan2(-1.0, -0.8), []), false);
});

test('canTakedown: not once it has noticed you, not from too far, not facing away', () => {
  assert.equal(canTakedown(0, 0, 0, true, 0, -1.2, 0, []), false);
  assert.equal(canTakedown(0, 0, 0, false, 0, -(TAKEDOWN_RANGE + 0.3), 0, []), false);
  assert.equal(canTakedown(0, 0, 0, false, 0, -1.2, Math.PI, []), false);
});

test('canTakedown: not through a wall', () => {
  const wall: WallBox = { minX: -1, maxX: 1, minZ: -0.7, maxZ: -0.5 };
  assert.equal(canTakedown(0, 0, 0, false, 0, -1.2, 0, [wall]), false);
});

// Low cover: a desk between a bot and the player.
const desk: WallBox = { minX: -1, maxX: 1, minZ: 2.8, maxZ: 3.2, cover: 'low' };
const rack: WallBox = { minX: -1, maxX: 1, minZ: 2.8, maxZ: 3.2, cover: 'tall' };

test('botCanSee: low cover hides a crouched player but not a standing one', () => {
  assert.equal(botCanSee(0, 0, 0, 0, 5, [desk], 10, 2.2, true), false);
  assert.equal(botCanSee(0, 0, 0, 0, 5, [desk], 10, 2.2, false), true);
});

test('botCanSee: tall cover hides a player either way', () => {
  assert.equal(botCanSee(0, 0, 0, 0, 5, [rack], 10, 2.2, true), false);
  assert.equal(botCanSee(0, 0, 0, 0, 5, [rack], 10, 2.2, false), false);
});

test('tryFire: shots clear low cover, not tall', () => {
  const bot = { worldX: 0, worldZ: 5, disabled: false };
  assert.equal(tryFire(0, 0, 0, [bot], [desk]), bot);
  assert.equal(tryFire(0, 0, 0, [bot], [rack]), null);
});

test('exposure is 1 exactly when the bot can see the player, whatever the posture, light or angle', () => {
  const walls = [box(2, 3, -4, 1)];
  let seenCount = 0;
  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const crouched of [true, false]) {
      for (const radius of [3, 5.5, 10]) {
        for (let x = -8; x <= 8; x += 1.5) {
          for (let z = -8; z <= 8; z += 1.5) {
            const seen = botCanSee(0, 0, facing, x, z, walls, radius, 2.2, crouched);
            const e = exposure(0, 0, facing, x, z, walls, radius, 2.2, crouched);
            assert.equal(e === 1, seen, `facing ${facing} at (${x}, ${z}) radius ${radius}`);
            assert.ok(e >= 0 && e <= 1);
            if (seen) seenCount++;
          }
        }
      }
    }
  }
  assert.ok(seenCount > 50, 'the sweep includes plenty of sightings');
});

test('behind a wall the player is not exposed at all', () => {
  assert.equal(exposure(0, 0, 0, 0, 6, [box(-1, 1, 2, 3)], 10, 2.2, false), 0);
});

test('short of being seen, exposure climbs as the player nears the edge of sight, and is lower out of the guard’s view', () => {
  const facing = 0; // looking toward +z
  const far = exposure(0, 0, facing, 0, 16, [], 10);
  const nearer = exposure(0, 0, facing, 0, 12, [], 10);
  assert.ok(far < nearer && nearer < 1, `${far} < ${nearer}`);
  const behind = exposure(0, 0, facing, 0, -8, [], 10); // inside its sight but behind it
  const ahead = exposure(0, 0, facing, 0, 8, [], 10); // seen
  assert.ok(behind < 1 && behind > 0.3, `${behind}`);
  assert.equal(ahead, 1);
  assert.ok(behind < 0.9 + 1e-9, 'never as high as seen');
});

test('a smaller sight radius (crouching, lying flat, the dark) lowers exposure at the same spot', () => {
  const spot = [0, 7] as const;
  const standing = exposure(0, 0, 0, spot[0], spot[1], [], 10);
  const crouched = exposure(0, 0, 0, spot[0], spot[1], [], 5.5);
  const flat = exposure(0, 0, 0, spot[0], spot[1], [], 3.5);
  assert.equal(standing, 1);
  assert.ok(crouched < standing && flat < crouched, `${standing} ${crouched} ${flat}`);
});

// ---- Shooting from up high: a real 3D line of sight over the walls ----

const guardAt = (x: number, z: number): { worldX: number; worldZ: number; disabled: boolean; floorY: number } => ({ worldX: x, worldZ: z, disabled: false, floorY: 0 });

test('lineClearOver: a wall stops the line only where the line is lower than its top', () => {
  const wall = box(2, 2.3, -2, 2); // 3 m high, 2 m out from the shooter, 6 m from a guard 8 m out
  // From a platform 4.5 m up at the origin to a guard's chest at 8 m: the line is over 3.5 m up at the wall, so it clears it...
  assert.equal(lineClearOver(0, 4.5, 0, 8, 1.15, 0, [wall]), true);
  // ...but a wall hard against the guard is in the line's way: it's only 1.5 m up there.
  assert.equal(lineClearOver(0, 4.5, 0, 8, 1.15, 0, [box(6.5, 6.8, -2, 2)]), false);
  // And a wall that is not between them at all is no matter.
  assert.equal(lineClearOver(0, 4.5, 0, 8, 1.15, 0, [box(2, 2.3, 3, 8)]), true);
  // Low furniture is cleared more easily than a wall.
  assert.equal(lineClearOver(0, 4.5, 0, 8, 1.15, 0, [{ ...box(6.5, 6.8, -2, 2), cover: 'low' }]), true);
});

test('tryFireAimed: only what is in the sights in both directions, in range, and in sight', () => {
  const guard = guardAt(0, 8); // straight ahead (yaw 0), 8 m out, chest 3.35 m below a 4.5 m eye
  const pitchAtGuard = Math.atan2(1.15 - 4.5, 8);
  assert.equal(tryFireAimed(0, 0, 4.5, 0, pitchAtGuard, [guard], [], 0.1, 22), guard, 'dead on');
  assert.equal(tryFireAimed(0, 0, 4.5, 0, 0, [guard], [], 0.1, 22), null, 'aimed level it passes over his head');
  assert.equal(tryFireAimed(0, 0, 4.5, 0.4, pitchAtGuard, [guard], [], 0.1, 22), null, 'aimed to the side');
  assert.equal(tryFireAimed(0, 0, 4.5, 0, pitchAtGuard, [guard], [], 0.1, 6), null, 'out of range');
  assert.equal(tryFireAimed(0, 0, 4.5, 0, pitchAtGuard, [{ ...guard, disabled: true }], [], 0.1, 22), null, 'already down');
  // A wall right by the guard hides him: he is in the sights but not in sight.
  assert.equal(tryFireAimed(0, 0, 4.5, 0, pitchAtGuard, [guard], [box(-2, 2, 6.6, 6.9)], 0.1, 22), null, 'behind a wall he cannot be seen over');
  // The nearest of two in line is the one taken.
  const near = guardAt(0, 5);
  assert.equal(tryFireAimed(0, 0, 4.5, 0, Math.atan2(1.15 - 4.5, 5), [guard, near], [], 0.2, 22), near);
});
