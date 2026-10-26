import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRun, loadRun, saveRun, RUN_KEY, newRun, advance, type Store } from './arc.ts';

const memory = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

test('a saved run comes back as it was, and clearing forgets it', () => {
  const s = memory();
  assert.equal(loadRun(s), null);
  const run = advance({ ...newRun(77), found: true });
  saveRun(s, run);
  assert.deepEqual(loadRun(s), run);
  clearRun(s);
  assert.equal(loadRun(s), null);
});

test('damaged storage, blocked storage and no storage all read as no run', () => {
  const s = memory();
  s.data.set(RUN_KEY, 'nonsense');
  assert.equal(loadRun(s), null);
  const blocked: Store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(loadRun(blocked), null);
  assert.doesNotThrow(() => saveRun(blocked, newRun(1)));
  assert.doesNotThrow(() => clearRun(blocked));
  assert.equal(loadRun(null), null);
});
