import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { traceEndWith } from './traceend.ts';
import { lineClearOver } from './detection.ts';

const traceEnd = (...a: [THREE.Vector3, THREE.Vector3, number, Parameters<typeof lineClearOver>[6], number]): THREE.Vector3 => traceEndWith(lineClearOver, ...a);

const wall = { minX: -5, maxX: 5, minZ: 5, maxZ: 5.3 };

test('a laser stops at a wall on the ground floor', () => {
  const end = traceEnd(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, 1), 16, [wall], 0);
  assert.ok(end.z > 4.5 && end.z < 5.3, `ended at z ${end.z}`);
});

test('and on an upper floor: the same wall stops a line that is four or twelve metres up in the world', () => {
  for (const floorY of [4, 8, 12]) {
    const end = traceEnd(new THREE.Vector3(0, floorY + 1.2, 0), new THREE.Vector3(0, 0, 1), 16, [wall], floorY);
    assert.ok(end.z > 4.5 && end.z < 5.3, `floor at ${floorY}: ended at z ${end.z}`);
    assert.ok(Math.abs(end.y - (floorY + 1.2)) < 1e-6);
  }
});

test('a line that misses the wall goes its full range, and one aimed down ends on the floor of its own storey', () => {
  const miss = traceEnd(new THREE.Vector3(20, 5.2, 0), new THREE.Vector3(0, 0, 1), 16, [wall], 4);
  assert.ok(Math.abs(miss.z - 16) < 1e-6);
  const down = traceEnd(new THREE.Vector3(0, 5.2, 0), new THREE.Vector3(0, -0.5, 0.866), 30, [], 4);
  assert.ok(Math.abs(down.y - 4) < 0.05, `ended at y ${down.y}`);
});
