import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hopSpot, HOP_RANGE, HOP_STANDOFF } from './coverhop.ts';
import { COVER_STANDOFF } from './cover.ts';
import type { WallBox } from './scene';

// A desk 2.8 wide and 0.7 deep centred at (0, 10), another at (6, 10), the agent at the origin facing +z (yaw 0).
const desk = (cx: number, cz: number, cover: 'low' | 'tall' = 'low'): WallBox => ({ minX: cx - 1.4, maxX: cx + 1.4, minZ: cz - 0.35, maxZ: cz + 0.35, cover });
const open = (boxes: WallBox[]) => (x1: number, z1: number, x2: number, z2: number): number => {
  // A coarse march: how far along the line before it enters any box.
  const len = Math.hypot(x2 - x1, z2 - z1);
  for (let d = 0; d < len; d += 0.05) {
    const t = d / len;
    const px = x1 + (x2 - x1) * t;
    const pz = z1 + (z2 - z1) * t;
    if (boxes.some((b) => px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ)) return d;
  }
  return len;
};

test('a desk ahead is hopped to, on its near face, in line with the agent', () => {
  const boxes = [desk(0, 10)];
  const s = hopSpot(boxes, 0, 0, 0, [], open(boxes))!;
  assert.ok(s, 'a spot');
  assert.equal(s.nz, -1, 'the face toward the agent');
  assert.ok(Math.abs(s.px) < 0.5 && s.pz < 9.65 && s.pz > 9.2, `at ${s.px}, ${s.pz}`);
});

test('with a guard beyond the desk the near face is chosen, and with one on the near side the far one is out of reach so the near one is still all there is', () => {
  const boxes = [desk(0, 10)];
  const beyond = hopSpot(boxes, 0, 0, 0, [{ x: 0, z: 18 }], open(boxes))!;
  assert.equal(beyond.nz, -1);
});

test('of two desks the one the agent is facing wins, and one behind or far to the side is not offered', () => {
  const boxes = [desk(0, 10), desk(12, 4)];
  const s = hopSpot(boxes, 0, 0, 0, [], open(boxes))!;
  assert.equal(s.box, boxes[0]);
  assert.equal(hopSpot(boxes, 0, 0, Math.PI, [], open(boxes)), null, 'facing away from both');
});

test('nothing beyond the range, nothing through a wall, and not the spot the agent is already on', () => {
  const far = [desk(0, HOP_RANGE + 6)];
  assert.equal(hopSpot(far, 0, 0, 0, [], open(far)), null);
  const wall: WallBox = { minX: -5, maxX: 5, minZ: 4, maxZ: 4.3 };
  const behind = [desk(0, 10), wall];
  assert.equal(hopSpot(behind, 0, 0, 0, [], open(behind)), null);
  const boxes = [desk(0, 10)];
  const first = hopSpot(boxes, 0, 14, Math.PI, [], open(boxes))!;
  assert.ok(first);
  const again = hopSpot(boxes, first.px, first.pz, Math.PI, [], open(boxes), first);
  assert.ok(!again || !(again.nx === first.nx && again.nz === first.nz));
});

test('a see-through box (a fence) and a box with no cover are never a place to hop to', () => {
  const fence: WallBox = { minX: -1.4, maxX: 1.4, minZ: 9.6, maxZ: 10.4, cover: 'low', see: true };
  const wallish: WallBox = { minX: -1.4, maxX: 1.4, minZ: 9.6, maxZ: 10.4 };
  assert.equal(hopSpot([fence], 0, 0, 0, [], open([fence])), null);
  assert.equal(hopSpot([wallish], 0, 0, 0, [], open([wallish])), null);
});

test('the hop stands the agent where cover does', () => assert.equal(HOP_STANDOFF, COVER_STANDOFF));
