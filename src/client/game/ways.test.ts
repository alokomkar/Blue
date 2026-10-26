import test from 'node:test';
import assert from 'node:assert/strict';
import { WAYS, ENTRY_TITLE, EXIT_NAME, EXIT_SOUND, type EntryKind, type ExitKind } from './ways.ts';
import { LOCATIONS } from './locations.ts';

test('every place has a way in and a way out, with words for each', () => {
  for (const id of Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>) {
    const w = WAYS[id];
    assert.ok(w, id);
    assert.ok(ENTRY_TITLE[w.entry].title.length > 3 && ENTRY_TITLE[w.entry].blurb.length > 20, `${id} entry words`);
    assert.match(EXIT_NAME[w.exit].open, /^[A-Z ·-]+$/, id);
    assert.ok(EXIT_SOUND[w.exit]);
  }
});

test('the places do not all begin and end in a lift: only the campus does', () => {
  const entries = new Set<EntryKind>();
  const exits = new Set<ExitKind>();
  for (const [id, w] of Object.entries(WAYS)) {
    entries.add(w.entry);
    exits.add(w.exit);
    if (id !== 'campus') {
      assert.notEqual(w.entry, 'lift', `${id} starts in a lift`);
      assert.notEqual(w.exit, 'lift', `${id} ends in a lift`);
    }
  }
  assert.ok(entries.size >= 5, `${entries.size} kinds of way in`);
  assert.ok(exits.size >= 5, `${exits.size} kinds of way out`);
});

test('no two places share the same way in', () => {
  const seen = new Set<string>();
  for (const w of Object.values(WAYS)) {
    if (w.entry === 'lift') continue;
    assert.ok(!seen.has(w.entry), `${w.entry} used twice`);
    seen.add(w.entry);
  }
});
