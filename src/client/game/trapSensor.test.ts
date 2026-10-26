import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SENSOR_MIN, SENSOR_REACH, beamAcross, brokeBeam, segmentDistance } from './trapSensor.ts';

test('the beam runs across the way the trap faces, through the trap', () => {
  // Facing +Z (0), the beam runs along x.
  const b = beamAcross(10, 5, 0, 2, 2);
  assert.ok(Math.abs(b.az - 5) < 1e-9 && Math.abs(b.bz - 5) < 1e-9);
  assert.ok(Math.abs(Math.abs(b.ax - b.bx) - 4) < 1e-9);
  assert.ok(Math.abs((b.ax + b.bx) / 2 - 10) < 1e-9);
  // Facing +X (a quarter turn), it runs along z.
  const c = beamAcross(10, 5, Math.PI / 2, 2, 2);
  assert.ok(Math.abs(c.ax - 10) < 1e-9 && Math.abs(c.bx - 10) < 1e-9);
  assert.ok(Math.abs(Math.abs(c.az - c.bz) - 4) < 1e-9);
});

test('the beam stops short of the walls, within the reach, and is never shorter than the minimum', () => {
  const wide = beamAcross(0, 0, 0, 40, 40);
  assert.ok(Math.abs(wide.ax - SENSOR_REACH) < 1e-9 && Math.abs(wide.bx + SENSOR_REACH) < 1e-9);
  const tight = beamAcross(0, 0, 0, 0, 0.1);
  assert.ok(Math.abs(tight.ax - SENSOR_MIN) < 1e-9 && Math.abs(tight.bx + SENSOR_MIN) < 1e-9);
  const lopsided = beamAcross(0, 0, 0, 1, 2);
  assert.ok(Math.abs(lopsided.ax - 2) < 1e-9 && Math.abs(lopsided.bx + 1) < 1e-9);
});

test('segments: crossing is zero apart, parallel is the gap, and a near miss is the miss', () => {
  assert.equal(segmentDistance({ x: -1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }, { x: 1, z: -1 }), 0);
  assert.equal(segmentDistance({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 0, z: 3 }, { x: 4, z: 3 }), 3);
  assert.ok(Math.abs(segmentDistance({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 1 }, { x: 2, z: 3 }) - Math.hypot(1, 1)) < 1e-9);
});

const beam = beamAcross(0, 0, 0, 2, 2); // along x, at z = 0

test('walking across the beam breaks it; walking along it, beside it, or standing in it does not', () => {
  assert.equal(brokeBeam(beam, { x: 0, z: -0.1 }, { x: 0, z: 0.1 }, 0.4), true, 'across, both sides within a body');
  assert.equal(brokeBeam(beam, { x: 0, z: -1.2 }, { x: 0, z: -0.9 }, 0.4), false, 'a step short of it, a body away');
  assert.equal(brokeBeam(beam, { x: 0, z: -1 }, { x: 0, z: 1 }, 0.4), true, 'a quick step right over it');
  assert.equal(brokeBeam(beam, { x: -5, z: 1.5 }, { x: -4.9, z: 1.5 }, 0.4), false, 'walking past it, off its end');
  assert.equal(brokeBeam(beam, { x: 0, z: 0 }, { x: 0, z: 0.005 }, 0.4), false, 'standing in it is not motion');
  assert.equal(brokeBeam(beam, { x: 0, z: -9 }, { x: 0, z: 9 }, 0.4), false, 'a jump from one place to another is not a walk');
});

test('turning on the spot in the beam is motion, away from it or too slowly is not', () => {
  const here = { x: 0, z: 0.1 };
  assert.equal(brokeBeam(beam, here, here, 0.34, 0.5), true, 'a guard sweeping its gaze on the beam');
  assert.equal(brokeBeam(beam, here, here, 0.34, 0.02), false, 'barely turning');
  assert.equal(brokeBeam(beam, here, here, 0.34, 0), false, 'standing still');
  const off = { x: 0, z: 1.5 };
  assert.equal(brokeBeam(beam, off, off, 0.34, 2), false, 'turning, but not on the beam');
});

test('a thin body still counts for a minimum', () => {
  assert.equal(brokeBeam(beam, { x: 0, z: -0.25 }, { x: 0, z: -0.2 }, 0), true, 'a dog 0.2 m off the beam, moving, breaks it');
  assert.equal(brokeBeam(beam, { x: 0, z: -0.6 }, { x: 0, z: -0.55 }, 0), false);
});
