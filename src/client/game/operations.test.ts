import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_OP, OPERATIONS, OPS_KEY, nextOperation, noteCleared, operationFor, operationOf, operationRun, opsCleared, paLine } from './operations.ts';
import { ADDRESSES, addressOf, decodeRun, dossierPage, encodeRun, newRun, runOptions } from './arc.ts';
import type { Store } from './arc.ts';

const memory = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

test('six operations in a fixed order: the five places, then the lab', () => {
  assert.deepEqual(OPERATIONS.map((o) => o.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(OPERATIONS.map((o) => o.place), ['campus', 'museum', 'warehouse', 'refinery', 'bank', 'lab']);
  assert.equal(OPERATIONS[CORE_OP - 1]!.place, 'lab');
  assert.equal(new Set(OPERATIONS.map((o) => o.director.name)).size, 6, 'six different faces');
});

test('each operation opens in its own first level', () => {
  assert.deepEqual(OPERATIONS.map((o) => o.site), ['annex', 'store', 'yard', 'farm', 'depot', 'bunker']);
});

test('every operation has its words: a front, an item, a consignee, a debrief and a PA line for each moment of the exit', () => {
  for (const o of OPERATIONS) {
    for (const s of [o.front, o.caseItem, o.labReveal, o.consignee, o.debrief, o.pa.open, o.pa.lobby, o.director.title]) assert.ok(s.length > 4, `${o.n}: ${s}`);
    assert.ok(o.pa.wave.length >= 2);
    assert.ok(o.consignee.includes(o.director.name.split(' ').pop()!.replace('.', '')), `the consignee names ${o.director.name}`);
  }
});

test('an operation run starts at its first level, going to its place and its site, with its number', () => {
  for (const o of OPERATIONS) {
    const r = operationRun(11, o.n);
    assert.deepEqual([r.stage, r.place, r.site, r.op, r.found], ['bunker', o.place, o.site, o.n, false]);
    assert.equal(operationOf(r), o);
  }
  assert.equal(operationRun(1, 99).op, 1, 'a number outside the six is the first');
  assert.equal(operationFor(0), null);
  assert.equal(operationOf(newRun(3)), null, 'a free run is no operation');
});

test('a campaign run saves and reads back with its operation, and the old formats still read', () => {
  const run = { ...operationRun(42, 4), stage: 'maze' as const, found: true };
  assert.equal(encodeRun(run).split('|')[0], 'run3');
  assert.deepEqual(decodeRun(encodeRun(run)), run);
  const free = newRun(9);
  assert.equal(encodeRun(free).split('|')[0], 'run2', 'a free run keeps the old format');
  assert.deepEqual(decodeRun(encodeRun(free)), free);
  assert.equal(decodeRun('run3|1|bunker|campus|0|bunker|9'), null, 'an operation outside the six is damaged');
  assert.equal(decodeRun('run3|1|bunker|campus|0|bunker'), null);
});

test('the final operation has an address of its own, and its dossier names its consignee', () => {
  const core = operationRun(5, CORE_OP);
  assert.notEqual(addressOf(core), ADDRESSES.lab);
  const last = OPERATIONS[5]!;
  const page = dossierPage({ ...core, found: true }, last.consignee);
  assert.ok(page.body.includes(last.consignee.replace('Consignee: ', '')) || page.body.includes(last.consignee));
  const first = OPERATIONS[0]!;
  const campus = dossierPage({ ...operationRun(5, 1), found: true }, first.consignee);
  assert.ok(campus.body.includes(first.consignee) && campus.body.includes(ADDRESSES.campus.name));
  assert.ok(!dossierPage({ ...newRun(2), found: true }).body.includes('Consignee'), 'a free run names no consignee');
});

test('the run options flag the final operation, from the run or the URL', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(runOptions(q(''), operationRun(1, CORE_OP)).core, true);
  assert.equal(runOptions(q('core=1'), null).core, true);
  assert.equal(runOptions(q(''), operationRun(1, 2)).core, false);
  assert.equal(runOptions(q(''), null).core, false);
});

test('progress: the campaign remembers how many are cleared, never goes back, and ends after six', () => {
  const s = memory();
  assert.equal(opsCleared(s), 0);
  assert.equal(nextOperation(opsCleared(s)), 1);
  noteCleared(s, 2);
  assert.equal(opsCleared(s), 2);
  noteCleared(s, 1);
  assert.equal(opsCleared(s), 2, 'replaying the first does not take it back');
  assert.equal(nextOperation(2), 3);
  noteCleared(s, 6);
  assert.equal(nextOperation(opsCleared(s)), null, 'six cleared: free runs');
  noteCleared(s, 99);
  assert.equal(opsCleared(s), 6);
  s.data.set(OPS_KEY, 'junk');
  assert.equal(opsCleared(s), 0);
  const blocked: Store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(opsCleared(blocked), 0);
  assert.doesNotThrow(() => noteCleared(blocked, 1));
  assert.equal(opsCleared(null), 0);
});

test('the PA speaks as the exit begins, at each wave, and in the lobby', () => {
  const o = OPERATIONS[0]!;
  assert.equal(paLine(o, 0), o.pa.open);
  assert.equal(paLine(o, 1), o.pa.wave[0]);
  assert.equal(paLine(o, 2), o.pa.wave[1]);
  assert.equal(paLine(o, 9), o.pa.wave[o.pa.wave.length - 1], 'more waves than lines: the last repeats');
  assert.equal(paLine(o, -1), o.pa.lobby);
});

test('the final operation\'s bunker is furnished with tanks, in the halls and the rooms', async () => {
  const { BUNKER_SETS } = await import('./bunkerplan.ts');
  const core = BUNKER_SETS.core!;
  assert.deepEqual(Object.keys(core).sort(), Object.keys(BUNKER_SETS.lab!).sort(), 'a set for every space the lab has');
  assert.ok(core.hall!.filter((k) => k === 'tank').length >= 2);
});

test('four operations go out through their first level played backwards; the campus and the lab keep the tower', async () => {
  const { reverseExit, REVERSE_EXIT_SITES } = await import('./arc.ts');
  const { operationRun } = await import('./operations.ts');
  const at = (n: number) => ({ ...operationRun(1, n), stage: 'exit' as const });
  assert.deepEqual(OPERATIONS.map((o) => reverseExit(at(o.n))), [false, true, true, true, true, false]);
  assert.equal(reverseExit({ ...at(2), stage: 'bunker' as const }), false, 'only at the exit');
  assert.equal(reverseExit({ seed: 1, site: 'store', stage: 'exit', place: 'museum', found: true }), false, 'a free run (no operation) uses the tower');
  assert.equal(reverseExit(null), false);
  assert.deepEqual([...REVERSE_EXIT_SITES].sort(), ['depot', 'farm', 'store', 'yard']);
});
