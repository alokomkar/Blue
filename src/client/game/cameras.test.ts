import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraYaw, cameraSees as sees, spotMeter, coneRadii, CAMERA_SPOT_S, type CameraPlan } from './cameras.ts';
import { botCanSee } from './detection.ts';
import type { WallBox } from './scene.ts';

const cameraSees = (c: CameraPlan, t: number, px: number, pz: number, walls: WallBox[], crouched: boolean): boolean => sees(c, t, px, pz, walls, crouched, botCanSee);

const cam: CameraPlan = { level: 1, x: 0, z: 0, face: Math.PI / 2, sweep: 0.8, period: 10, phase: 0, range: 10, half: 0.5 };

test('the head sweeps between face - sweep and face + sweep, and is periodic', () => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 10; t += 0.05) {
    const y = cameraYaw(cam, t);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  assert.ok(Math.abs(lo - (cam.face - cam.sweep)) < 0.01);
  assert.ok(Math.abs(hi - (cam.face + cam.sweep)) < 0.01);
  assert.ok(Math.abs(cameraYaw(cam, 3.3) - cameraYaw(cam, 13.3)) < 1e-9);
});

test('it sees someone in its cone and range with a clear line, not behind it, beyond range, or behind a wall', () => {
  const at = 0; // facing the middle of its sweep: due east at t = 0
  assert.equal(cameraSees(cam, at, 6, 0, [], false), true);
  assert.equal(cameraSees(cam, at, -6, 0, [], false), false); // behind
  assert.equal(cameraSees(cam, at, 12, 0, [], false), false); // out of range
  assert.equal(cameraSees(cam, at, 6, 5, [], false), false); // well off its axis
  assert.equal(cameraSees(cam, at, 6, 0, [{ minX: 3, maxX: 3.3, minZ: -2, maxZ: 2 }], false), false); // a wall between
});

test('low furniture hides a crouched or lying agent from it, and not a standing one', () => {
  const sofa = { minX: 3, maxX: 4, minZ: -1, maxZ: 1, cover: 'low' as const };
  assert.equal(cameraSees(cam, 0, 6, 0, [sofa], false), true);
  assert.equal(cameraSees(cam, 0, 6, 0, [sofa], true), false);
});

test('the spot meter fills while the agent is in view and drains twice as fast out of it', () => {
  let m = 0;
  for (let i = 0; i < 9; i++) m = spotMeter(m, true, 0.1);
  assert.ok(Math.abs(m - 0.9) < 1e-9);
  assert.ok(m >= CAMERA_SPOT_S - 1e-9);
  assert.ok(Math.abs(spotMeter(0.9, false, 0.2) - 0.5) < 1e-9);
  assert.equal(spotMeter(0.1, false, 5), 0);
});

test('the drawn cone stops at a wall and a tall cabinet, and runs through a fence and over low furniture', () => {
  const open = coneRadii(cam, cam.face, [], 8);
  assert.ok(open.every((r) => r === cam.range));
  const wall = { minX: 5, maxX: 5.3, minZ: -20, maxZ: 20 };
  const stopped = coneRadii(cam, cam.face, [wall], 8);
  assert.ok(stopped.every((r) => r >= 5 - 1e-6 && r < 6.5), 'every ray ends at the wall');
  assert.ok(Math.abs(stopped[4]! - 5) < 1e-6, 'the middle ray, straight at it, ends at its face');
  assert.ok(coneRadii(cam, cam.face, [{ ...wall, see: true }], 8).every((r) => r === cam.range));
  assert.ok(coneRadii(cam, cam.face, [{ ...wall, cover: 'low' }], 8).every((r) => r === cam.range));
  assert.ok(coneRadii(cam, cam.face, [{ ...wall, cover: 'tall' }], 8).every((r) => r < cam.range));
});
