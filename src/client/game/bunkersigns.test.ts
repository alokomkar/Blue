import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraining } from './tutorial.ts';
import { BUNKER_LEVELS, atDoorway, bunkerMap, furnishedCells, spaceAt } from './bunkerplan.ts';
import * as plan from './bunkerplan.ts';
import * as text from './signage.ts';
import { containerSigns, roomSigns } from './bunkersigns.ts';

const deps = { plan, text };

const C = 4;
const levels = Array.from({ length: BUNKER_LEVELS }, (_, l) => l);
const signsOf = (l: number) => roomSigns(deps, l, parseTraining(bunkerMap(l, true)).cells);

test('every storey has writing on its walls and floors, the same each time', () => {
  for (const l of levels) {
    const signs = signsOf(l);
    assert.ok(signs.length >= 6, `storey ${l} has ${signs.length} signs`);
    assert.ok(signs.some((s) => s.style === 'big'), 'a sector letter');
    assert.ok(signs.some((s) => s.flat), 'something on the floor');
    assert.deepEqual(signsOf(l), signs);
  }
});

test('wall writing is on a wall of the room it names, facing in, off the doorways and clear of the floor level it hangs at', () => {
  for (const l of levels) {
    for (const s of signsOf(l).filter((q) => !q.flat)) {
      const cx = Math.round(s.x / C);
      const cz = Math.round(s.z / C);
      const sp = spaceAt(cx, cz);
      assert.ok(sp && sp.level === l, `sign at ${s.x},${s.z} is in a space of storey ${l}`);
      assert.ok(!atDoorway(cx, cz), 'not at a doorway');
      // the face it hangs on is just behind it: the point a step behind along its normal is out of the cell it is on
      const bx = s.x - Math.sin(s.angle) * 0.4;
      const bz = s.z - Math.cos(s.angle) * 0.4;
      assert.ok(Math.abs(bx - cx * C) > C / 2 - 0.9 || Math.abs(bz - cz * C) > C / 2 - 0.9, 'it hangs on the edge of its cell');
      assert.ok(s.y >= 1 && s.y <= 5.2, `height ${s.y}`);
    }
  }
});

test('floor writing lies in a free cell, flat to the floor', () => {
  for (const l of levels) {
    const furnished = furnishedCells(l);
    for (const s of signsOf(l).filter((q) => q.flat)) {
      assert.ok(s.y < 0.1);
      assert.ok(!furnished.has(`${Math.round(s.x / C)},${Math.round(s.z / C)}`), `floor sign at ${s.x},${s.z} is under furniture`);
    }
  }
});

test('containers: an ID on each long side, the same ID both sides, the cargo on one', () => {
  const boxes = [
    { cx: 20, cz: 10, yaw: 0, len: 7.8, depth: 3.8, height: 2.6, key: 'a' },
    { cx: 40, cz: 30, yaw: Math.PI / 2, len: 7.8, depth: 3.8, height: 2.6, key: 'b' },
  ];
  const signs = containerSigns(deps, 1, boxes);
  assert.equal(signs.length, 6);
  const a = signs.filter((s) => s.key === 'a' && s.style === 'stencil');
  assert.equal(a.length, 2);
  assert.equal(a[0]!.lines[0], a[1]!.lines[0]);
  assert.notEqual(a[0]!.angle, a[1]!.angle, 'opposite sides');
  assert.ok(signs.every((s) => !s.flat && s.y > 0.5 && s.y < 2.6));
  assert.deepEqual(containerSigns(deps, 1, boxes), signs);
});
