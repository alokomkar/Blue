import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORIES, MEMORY_TOTAL, memoryId, memoryText, nextMemory, pagesOf, parseSeen } from './memories.ts';

test('no pages are defined, so nothing is ever turned up', () => {
  assert.equal(MEMORY_TOTAL, Object.values(MEMORIES).reduce((n, list) => n + list.length, 0));
  assert.equal(MEMORY_TOTAL, 0);
  assert.equal(memoryText(1, 1), null);
  assert.equal(memoryText(0, 1), null);
  assert.equal(memoryText(3, 0), null);
  assert.equal(nextMemory(5, 1, new Set()), null);
});

test('the pages kept are read back as a list of ids, ignoring anything that is not a page', () => {
  assert.deepEqual([...parseSeen(null)], []);
  assert.deepEqual([...parseSeen('not json')], []);
  assert.deepEqual([...parseSeen('{"a":1}')], []);
  assert.deepEqual([...parseSeen('["1.1","3.2","99.1","1.7",4,"x"]')], []);
});

test('the file lists nothing when there are no pages', () => {
  assert.deepEqual(pagesOf(new Set([memoryId(7, 1), memoryId(2, 2)])), []);
  assert.deepEqual(pagesOf(new Set()), []);
});
