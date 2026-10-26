import test from 'node:test';
import assert from 'node:assert/strict';
import { HIDEOUTS, hideCounts } from './hideouts.ts';
import { difficultyFor } from './difficulty.ts';

test('every place has a way to hide a body of each kind, named and worded for it', () => {
  const names = new Set<string>();
  for (const [id, h] of Object.entries(HIDEOUTS)) {
    for (const n of [h.locker.name, h.crates.name, h.vent.name]) assert.ok(n.length > 3, id);
    for (const w of [h.locker.working, h.crates.working, h.vent.working]) assert.match(w, /^[A-Z ]+$/, id);
    names.add(h.locker.name);
  }
  assert.equal(names.size, Object.keys(HIDEOUTS).length, 'two places call their lockers the same thing');
});

test('the places do not hide bodies alike: their mixes of crates, lockers and vents differ', () => {
  const mixes = new Set(Object.values(HIDEOUTS).map((h) => JSON.stringify(h.mix)));
  assert.ok(mixes.size >= 5);
  assert.ok(HIDEOUTS.warehouse.mix.crates > 0 && HIDEOUTS.warehouse.mix.lockers < 0, 'the warehouse is crates');
  assert.ok(HIDEOUTS.lab.mix.lockers > 0, 'the lab is cabinets');
});

test('a place never leaves a floor with fewer than one hiding place less than the job asks for, and never a negative count', () => {
  for (let level = 1; level <= 40; level++) {
    const base = difficultyFor(level);
    for (const [id, h] of Object.entries(HIDEOUTS)) {
      const c = hideCounts(base, h);
      assert.ok(c.crates >= 0 && c.staffLockers >= 0 && c.vents >= 0, `${id} job ${level}`);
      assert.ok(c.crates + c.staffLockers + c.vents >= base.crates + base.staffLockers + base.vents - 1, `${id} job ${level}`);
    }
  }
});

test('the campus changes nothing', () => {
  const base = difficultyFor(7);
  assert.deepEqual(hideCounts(base, HIDEOUTS.campus), { crates: base.crates, staffLockers: base.staffLockers, vents: base.vents });
});
