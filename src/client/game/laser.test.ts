import test from 'node:test';
import assert from 'node:assert/strict';
import { CREEP_PACE, DRAIN, LASER_NOTICE_S, LASER_RANGE, LASER_WEDGE, laserIn, stepDwell, warning } from './laser.ts';

// A guard at the origin facing +x (angle pi/2), the agent along its line.
const EAST = Math.PI / 2;

test('the agent straight down the line, in reach and in the clear, is in the laser', () => {
  assert.equal(laserIn(0, 0, EAST, 0, 12, 0, true), true);
  assert.equal(laserIn(0, 0, EAST, 0, 12, 0, false), false, 'a wall in the way');
  assert.equal(laserIn(0, 0, EAST, 0, LASER_RANGE + 1, 0, true), false, 'out of reach');
  assert.equal(laserIn(0, 0, EAST, 0, -12, 0, true), false, 'behind the gun');
});

test('a line that sweeps to and fro covers the whole arc, and a little either side', () => {
  const half = 0.6; // the sentry's sweep
  const at = (bearing: number): boolean => laserIn(0, 0, EAST, half, Math.sin(bearing) * 10, Math.cos(bearing) * 10, true);
  assert.equal(at(EAST + half + LASER_WEDGE - 0.02), true, 'at the edge of the sweep');
  assert.equal(at(EAST - half - LASER_WEDGE + 0.02), true);
  assert.equal(at(EAST + half + LASER_WEDGE + 0.05), false, 'past it');
  assert.equal(laserIn(0, 0, EAST, 0, 10 * Math.sin(EAST + 0.3), 10 * Math.cos(EAST + 0.3), true), false, 'a guard walking has only its line: 0.3 rad off is outside the wedge');
});

test('time on the agent builds while on and drains, faster than it built, when off', () => {
  let d = 0;
  for (let i = 0; i < 50; i++) d = stepDwell(d, true, 0.1);
  assert.ok(Math.abs(d - LASER_NOTICE_S) < 1e-9, 'five seconds on the agent is the notice');
  const off = stepDwell(d, false, 1);
  assert.ok(Math.abs(off - (LASER_NOTICE_S - DRAIN)) < 1e-9);
  assert.equal(stepDwell(0.2, false, 1), 0, 'never below nothing');
});

test('the warning runs from nothing to one as the guard comes to notice, and the creep is slower than a walk', () => {
  assert.equal(warning(0), 0);
  assert.equal(warning(LASER_NOTICE_S / 2), 0.5);
  assert.equal(warning(99), 1);
  assert.ok(CREEP_PACE > 0 && CREEP_PACE < 0.6);
});
