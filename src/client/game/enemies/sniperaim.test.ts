import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineClearOver } from '../detection.ts';
import { smokeBlocks } from '../smoke.ts';
import type { WallBox } from '../scene.ts';
import {
  ACQUIRE_S,
  AIM_S,
  LASER_HALF,
  LOCK_HALF,
  LOSE_GRACE_S,
  PARTNER_HIT,
  PLAYER_HIT,
  RELOAD_S,
  SNIPER_RANGE,
  START,
  SWEEP_HALF,
  Y_GATE,
  aimHeight,
  aimed,
  lands,
  look,
  pickTarget,
  reachable,
  sniperRange,
  stepAim,
  sweepAngle,
  turnToward,
  type AimState,
  type Mark,
} from './sniperaim.ts';

const deps = { lineClear: lineClearOver, smokeBlocks };
const EYE = 1.55;
const stand: Mark = { x: 0, z: 20, y: 0, hidden: false, prone: false, crouched: false };
const lookAt = (m: Mark, boxes: WallBox[] = [], smokes: Array<{ x: number; z: number; age: number }> = [], scale = 1, centre?: number, half?: number) => look(0, 0, EYE, 0, m, boxes, deps, smokes, scale, centre, half);
const low = (minX: number, maxX: number, minZ: number, maxZ: number): WallBox => ({ minX, maxX, minZ, maxZ, cover: 'low' });
const wall = (minX: number, maxX: number, minZ: number, maxZ: number): WallBox => ({ minX, maxX, minZ, maxZ });

test('it sees a standing agent across the hall, and not one beyond its reach', () => {
  assert.equal(lookAt(stand).sees, true);
  assert.equal(lookAt({ ...stand, z: SNIPER_RANGE - 1 }).sees, true);
  assert.equal(lookAt({ ...stand, z: SNIPER_RANGE + 1 }).sees, false);
});

test('a posture shortens how far it sees: crouched a fifth, flat on the floor more than half', () => {
  assert.ok(sniperRange({ prone: false, crouched: true }) < sniperRange({ prone: false, crouched: false }));
  assert.ok(sniperRange({ prone: true, crouched: false }) < sniperRange({ prone: false, crouched: true }));
  assert.ok(sniperRange({ prone: false, crouched: false, running: true }) > SNIPER_RANGE);
  assert.equal(lookAt({ ...stand, z: 20, prone: true }).sees, false, 'flat on the floor, 20 m is past the 15 m it sees a lying agent');
  assert.equal(lookAt({ ...stand, z: 12, prone: true }).sees, true);
  assert.equal(sniperRange(stand, 0.5), SNIPER_RANGE * 0.5, 'a dark corner (sightScale) shortens it');
});

test('a wall, a tall crate and a closed door stop the line; a rail, a pane of glass and a fence do not', () => {
  assert.equal(lookAt(stand, [wall(-3, 3, 9, 9.3)]).sees, false);
  assert.equal(lookAt(stand, [{ minX: -3, maxX: 3, minZ: 9, maxZ: 10, cover: 'tall' }]).sees, false, 'a tall crate is above the line to a chest');
  assert.equal(lookAt(stand, [{ minX: -3, maxX: 3, minZ: 9, maxZ: 9.3, see: true }]).sees, true, 'see-through boxes (rails, glass, fences) do not stop a look');
  assert.equal(lookAt(stand, [wall(10, 12, 9, 9.3)]).sees, true, 'a wall off to one side is not in the way');
});

test('low furniture hides a crouched agent and a lying one but not one standing over it (the 3D line, detection.ts)', () => {
  const desk = low(-3, 3, 18, 19); // a desk just in front of the agent
  assert.equal(lookAt(stand, [desk]).sees, true, 'standing: the line to the chest passes over it');
  assert.equal(lookAt({ ...stand, crouched: true }, [desk]).sees, false, 'crouched behind it: hidden');
  assert.equal(lookAt({ ...stand, prone: true, z: 12 }, [low(-3, 3, 11, 11.8)]).sees, false, 'lying flat behind it: hidden');
  // ...but only if the cover is near them: low cover far from a crouched agent leaves them showing over it.
  assert.equal(lookAt({ ...stand, crouched: true }, [low(-3, 3, 2, 3)]).sees, true);
});

test('a smoke cloud on the line, camo, a locker, and a different floor all break it', () => {
  assert.equal(lookAt(stand, [], [{ x: 0, z: 10, age: 4 }]).sees, false, 'smoke in the middle of the line');
  assert.equal(lookAt(stand, [], [{ x: 8, z: 10, age: 4 }]).sees, true, 'smoke beside it does not');
  assert.equal(lookAt(stand, [], [{ x: 0, z: 10, age: 0.05 }]).sees, true, 'a thin new puff is not enough');
  assert.equal(lookAt({ ...stand, hidden: true }).sees, false, 'hidden (camo and still, behind crates, in a locker)');
  assert.equal(lookAt({ ...stand, y: Y_GATE + 0.5 }).sees, false, 'standing a storey above or below is not seen through the floor');
  assert.equal(lookAt({ ...stand, y: -(Y_GATE + 0.5) }).sees, false);
  assert.equal(lookAt({ ...stand, y: 1 }).sees, true, 'a stair\'s first steps are still its floor');
});

test('the sweeping laser sees only what it lies on; a lock is a wider wedge', () => {
  const east: Mark = { ...stand, x: 20, z: 0 }; // 90 degrees from +Z
  assert.equal(lookAt(stand, [], [], 1, 0, LASER_HALF).sees, true);
  assert.equal(lookAt(east, [], [], 1, 0, LASER_HALF).sees, false);
  const off = { ...stand, x: 20 * Math.tan(LOCK_HALF * 0.9) };
  assert.equal(lookAt(off, [], [], 1, 0, LASER_HALF).sees, false, 'off the line by more than the sweep covers');
  assert.equal(lookAt(off, [], [], 1, 0, LOCK_HALF).sees, true, 'but inside the lock wedge');
  assert.ok(Math.abs(lookAt(east).bearing - Math.PI / 2) < 1e-9);
});

test('the aim point is a chest, hunched when crouched, a back when lying', () => {
  assert.ok(aimHeight({ prone: false, crouched: false }) > aimHeight({ prone: false, crouched: true }));
  assert.ok(aimHeight({ prone: false, crouched: true }) > aimHeight({ prone: true, crouched: false }));
});

const run = (s: AimState, frames: Array<[boolean, boolean]>, dt = 0.1) => {
  const out = { fired: 0, locked: 0, dropped: 0, state: s };
  for (const [beam, lock] of frames) {
    const r = stepAim(out.state, beam, lock, dt);
    out.state = r.state;
    if (r.fire) out.fired++;
    if (r.locked) out.locked++;
    if (r.dropped) out.dropped++;
  }
  return out;
};
const on = (seconds: number, beam: boolean, lock: boolean, dt = 0.1): Array<[boolean, boolean]> => Array.from({ length: Math.round(seconds / dt) }, () => [beam, lock]);

test('the laser on the agent for a moment locks it; a brush across the line does not', () => {
  assert.equal(run(START, on(ACQUIRE_S + 0.1, true, false)).locked, 1);
  const brush = run(START, [...on(0.2, true, false), ...on(1, false, false), ...on(0.2, true, false)]);
  assert.equal(brush.locked, 0);
  assert.equal(brush.state.phase, 'scan');
});

test('an unbroken line for 1.5 s after the lock fires, and the reload follows', () => {
  const r = run(START, [...on(ACQUIRE_S + 0.1, true, false), ...on(AIM_S - 0.2, false, true)]);
  assert.equal(r.fired, 0, 'not yet');
  assert.equal(r.state.phase, 'lock');
  assert.ok(aimed(r.state) > 0.8 && aimed(r.state) < 1);
  const done = run(START, [...on(ACQUIRE_S + 0.1, true, false), ...on(AIM_S + 0.15, false, true)]);
  assert.equal(done.fired, 1);
  assert.equal(done.state.phase, 'reload');
  assert.ok(done.state.reload > RELOAD_S - 0.3 && done.state.reload <= RELOAD_S, 'the reload has just begun');
});

test('losing the line drops the lock, and the aim starts from nothing: it needs the whole 1.5 s again', () => {
  const lockedAt = run(START, on(ACQUIRE_S + 0.1, true, false)).state;
  // a short flicker (a step behind a pillar) is forgiven...
  const flicker = run(lockedAt, [...on(1, false, true), ...on(LOSE_GRACE_S - 0.1, false, false), ...on(0.4, false, true)]);
  assert.equal(flicker.dropped, 0);
  assert.equal(flicker.fired, 0);
  // ...a real break is not: it goes back to sweeping, aim zero.
  const broken = run(lockedAt, [...on(1.2, false, true), ...on(LOSE_GRACE_S + 0.2, false, false)]);
  assert.equal(broken.dropped, 1);
  assert.deepEqual(broken.state, START);
  // and from there the agent crossing the line again needs a lock and the full aim: no shot until ACQUIRE_S + AIM_S have both passed.
  const again = run(broken.state, [...on(ACQUIRE_S + 0.1, true, false), ...on(AIM_S - 0.3, false, true)]);
  assert.equal(again.fired, 0);
  const full = run(broken.state, [...on(ACQUIRE_S + 0.1, true, false), ...on(AIM_S + 0.2, false, true)]);
  assert.equal(full.fired, 1);
});

test('after a shot it reloads for 3 s before it looks again, then starts over', () => {
  const afterShot = run(START, [...on(ACQUIRE_S + 0.1, true, false), ...on(AIM_S + 0.15, false, true)]).state;
  const during = run(afterShot, on(RELOAD_S - 0.5, true, true));
  assert.equal(during.fired, 0);
  assert.equal(during.locked, 0);
  assert.equal(during.state.phase, 'reload');
  const after = run(afterShot, on(RELOAD_S + 0.2, true, true));
  assert.equal(after.state.phase, 'scan');
  assert.equal(after.fired, 0);
});

test('the shot lands on the agent more often than on the partner', () => {
  assert.ok(PLAYER_HIT > PARTNER_HIT);
  assert.equal(lands(PLAYER_HIT - 0.001, 'player'), true);
  assert.equal(lands(PLAYER_HIT + 0.001, 'player'), false);
  assert.equal(lands(PARTNER_HIT - 0.001, 'partner'), true);
  assert.equal(lands((PARTNER_HIT + PLAYER_HIT) / 2, 'partner'), false);
  assert.equal(lands((PARTNER_HIT + PLAYER_HIT) / 2, 'player'), true);
  // Over many even rolls the rates are the constants.
  let p = 0;
  let q = 0;
  for (let i = 0; i < 1000; i++) {
    if (lands(i / 1000, 'player')) p++;
    if (lands(i / 1000, 'partner')) q++;
  }
  assert.equal(p, Math.round(PLAYER_HIT * 1000));
  assert.equal(q, Math.round(PARTNER_HIT * 1000));
});

test('the agent comes first; the partner is its target only when the agent is out of its sights', () => {
  const yes = { sees: true };
  const no = { sees: false };
  assert.equal(pickTarget(yes, yes)?.who, 'player');
  assert.equal(pickTarget(no, yes)?.who, 'partner');
  assert.equal(pickTarget(null, yes)?.who, 'partner');
  assert.equal(pickTarget(yes, null)?.who, 'player');
  assert.equal(pickTarget(no, no), null);
  assert.equal(pickTarget(null, null), null);
});

test('a stun shot reaches a sniper only from its own floor: not through the one above or below', () => {
  assert.equal(reachable(7, 7), true);
  assert.equal(reachable(7, 8.5), true, 'on the first steps of a stair, or a step up');
  assert.equal(reachable(7, 0), false, 'the floor below');
  assert.equal(reachable(7, 14), false, 'the floor above');
  assert.equal(reachable(7, 3.5), false, 'half way up a flight from below');
});

test('the sweep goes to and fro about the post\'s facing, within its half angle, and the turn takes the short way', () => {
  for (let t = 0; t < 20; t += 0.37) assert.ok(Math.abs(sweepAngle(1, t) - 1) <= SWEEP_HALF + 1e-9);
  assert.ok(Math.abs(sweepAngle(1, 2) - 1) > SWEEP_HALF * 0.99, 'a quarter period in, it is at the end of its arc');
  assert.ok(Math.abs(turnToward(3.0, -3.0, 1, 0.1) - 3.1) < 1e-9, 'across the +-pi seam it turns the short way, by rate x dt');
  assert.equal(turnToward(0, 0.05, 2, 1), 0.05, 'and never overshoots');
});
