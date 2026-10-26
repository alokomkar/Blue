import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDocuments, documentFor } from './documents.ts';
import { LOCATIONS } from './locations.ts';

test('every place has three pages, each with a kicker, a title and a body', () => {
  for (const id of Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>) {
    const pages = new Set([1, 2, 3].map((n) => documentFor(id, 1, n).title));
    assert.equal(pages.size, 3, id);
  }
  for (const p of allDocuments()) {
    assert.ok(p.kicker && p.title && p.body.length > 20);
  }
});

test('the two files of a job are different pages', () => {
  for (let job = 1; job <= 15; job++) {
    assert.notEqual(documentFor('campus', job, 1).title, documentFor('campus', job, 2).title);
  }
});
