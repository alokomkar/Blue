import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_NAMES, checkDigit, containerId, nextTag, rand, resetTags, tagFor, type TagKind } from './signage.ts';

test('the check digit is ISO 6346\'s: a known container, CSQU 305438 3', () => {
  assert.equal(checkDigit('CSQU305438'), 3);
});

test('container IDs: six digits and a check digit that agrees, each one different, the same every time', () => {
  const ids = Array.from({ length: 80 }, (_, n) => containerId(1, n));
  assert.equal(new Set(ids).size, 80, 'no two alike on a level');
  for (const id of ids) {
    const m = /^DCU (\d{6}) (\d)$/.exec(id);
    assert.ok(m, id);
    assert.equal(checkDigit(`DCUU${m![1]}`), Number(m![2]), `check digit of ${id}`);
  }
  assert.equal(containerId(2, 5), containerId(2, 5));
  assert.notEqual(containerId(0, 5), containerId(1, 5), 'another storey, another ID');
});

test('serials: five digits, never repeated within a kind, the same for the same job', () => {
  for (const kind of Object.keys(MODEL_NAMES) as TagKind[]) {
    const tags = Array.from({ length: 200 }, (_, n) => tagFor(kind, n + 1, 3));
    assert.equal(new Set(tags.map((t) => t.serial)).size, 200, kind);
    assert.ok(tags.every((t) => /^\d{5}$/.test(t.serial) && t.model === MODEL_NAMES[kind]));
  }
  resetTags(9);
  const a = [nextTag('guard'), nextTag('guard'), nextTag('dog')];
  resetTags(9);
  const b = [nextTag('guard'), nextTag('guard'), nextTag('dog')];
  assert.deepEqual(a, b);
  assert.notEqual(a[0]!.serial, a[1]!.serial);
});

test('the draw is steady and in range', () => {
  for (let i = 0; i < 50; i++) {
    const r = rand(i);
    assert.ok(r >= 0 && r < 1);
    assert.equal(r, rand(i));
  }
});
