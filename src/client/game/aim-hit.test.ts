import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayHitVolumes } from './detection.ts';
const body = { target: 'guard', zone: 'body' as const, x: 0, y: 1, z: 8, rx: 0.35, ry: 0.5, rz: 0.25 };
const head = { target: 'guard', zone: 'head' as const, x: 0, y: 1.75, z: 8, rx: 0.18, ry: 0.22, rz: 0.18 };
const origin = { x: 0, y: 1.2, z: 0 };
const direction = (y: number) => ({ x: 0, y: y - origin.y, z: 8 });
test('aim rays distinguish head, body and misses without snapping to chest', () => {
  assert.equal(rayHitVolumes(origin, direction(1.75), [body, head], [], 14)?.zone, 'head');
  assert.equal(rayHitVolumes(origin, direction(1), [body, head], [], 14)?.zone, 'body');
  assert.equal(rayHitVolumes(origin, direction(2.5), [body, head], [], 14), null);
});
test('aim rays respect range, walls, nearest hit and empty/degenerate input', () => {
  const dir = direction(1.75);
  assert.equal(rayHitVolumes(origin, dir, [], [], 14), null);
  assert.equal(rayHitVolumes(origin, { x: 0, y: 0, z: 0 }, [head], [], 14), null);
  assert.equal(rayHitVolumes(origin, dir, [head], [], 7), null);
  assert.equal(rayHitVolumes(origin, dir, [head], [{ minX: -1, maxX: 1, minZ: 4, maxZ: 5, minY: 0, maxY: 3 }], 14), null);
  const near = { ...body, target: 'near', z: 4, ry: 2 };
  assert.equal(rayHitVolumes(origin, dir, [head, near], [], 14)?.target, 'near');
  assert.equal(rayHitVolumes(origin, { x: 0, y: 0, z: -1 }, [head], [], 14), null);
});

test('a wall stops an aimed shot on an upper storey as it does on the ground floor', () => {
  const wall = { minX: -3, maxX: 3, minZ: 4, maxZ: 4.3 };
  for (const floorY of [0, 4, 8, 12]) {
    const o = { x: 0, y: floorY + 1.2, z: 0 };
    const up = (v: typeof body) => ({ ...v, y: v.y + floorY });
    const hit = rayHitVolumes(o, { x: 0, y: 0, z: 8 }, [up(body)], [wall], 14, floorY);
    assert.equal(hit, null, `through a wall at floor ${floorY}`);
    assert.equal(rayHitVolumes(o, { x: 0, y: 0, z: 8 }, [up(body)], [], 14, floorY)?.zone, 'body', `in the open at floor ${floorY}`);
  }
});
