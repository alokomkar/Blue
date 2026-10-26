import test from 'node:test';
import assert from 'node:assert/strict';
import { planObjectives, stepBlocked, unitsDone, nextStep, fuseLeft, specimenWarmth, SPECIMEN_SAFE_S } from './objectives.ts';
import { CONTRACT_IDS } from '../../shared/contracts.ts';

const PLAYABLE = ['extract', 'sabotage', 'swap', 'vault', 'shipment'] as const;

test('each contract plans steps whose units add up, with real ids and nothing waiting on a step that is not there', () => {
  for (const c of PLAYABLE) {
    for (const floors of [1, 2] as const) {
      const plan = planObjectives(c, floors, 2);
      assert.ok(plan.steps.length > 0, c);
      assert.equal(plan.steps.filter((s) => s.unit).length, plan.units, `${c}: units`);
      const ids = new Set(plan.steps.map((s) => s.id));
      assert.equal(ids.size, plan.steps.length, `${c}: duplicate step ids`);
      for (const s of plan.steps) {
        for (const r of s.requires) {
          assert.ok(ids.has(r), `${c}/${s.id} waits on ${r}`);
          assert.ok(s.locked[r], `${c}/${s.id} has no words for waiting on ${r}`);
        }
        assert.ok(s.seconds >= 2 && s.seconds <= 8, `${c}/${s.id}: ${s.seconds} s`);
        assert.ok(s.working.length > 3 && s.done.length > 3);
        assert.ok(s.floor === 0 || floors === 2, `${c}/${s.id} is on a floor that is not there`);
      }
    }
  }
});

test('steps can be done in an order that works: nothing waits in a circle', () => {
  for (const c of PLAYABLE) {
    const plan = planObjectives(c, 2, 1);
    const done = new Set<string>();
    for (let i = 0; i < plan.steps.length + 1; i++) {
      const next = plan.steps.find((s) => !done.has(s.id) && stepBlocked(s, done) === null);
      if (!next) break;
      done.add(next.id);
    }
    assert.equal(done.size, plan.steps.length, `${c}: stuck at ${[...done].join(',')}`);
    assert.equal(unitsDone(plan, done), plan.units);
    assert.equal(nextStep(plan, done), null);
  }
});

test('the keycard contracts wait on the keycard, and say so', () => {
  for (const c of ['swap', 'vault'] as const) {
    const plan = planObjectives(c, 2);
    assert.equal(plan.carrier, true);
    const after = plan.steps[1]!;
    assert.match(stepBlocked(after, new Set()) ?? '', /KEYCARD/);
    assert.equal(stepBlocked(after, new Set(['keycard'])), null);
  }
  assert.equal(planObjectives('vault', 2).steps[2]!.requires[0], 'vault');
});

test('the shipment has four containers, one of them real, only that one counts, and it waits on the manifest', () => {
  for (let pick = 0; pick < 4; pick++) {
    const plan = planObjectives('shipment', 2, pick);
    const containers = plan.steps.filter((s) => s.kind === 'tracker');
    assert.equal(containers.length, 4);
    assert.deepEqual(containers.map((s) => s.letter), ['A', 'B', 'C', 'D']);
    const real = containers.filter((s) => !s.decoy);
    assert.equal(real.length, 1);
    assert.equal(real[0]!.letter, 'ABCD'[pick]);
    assert.ok(real[0]!.unit && containers.filter((s) => s.decoy).every((s) => !s.unit));
    assert.match(plan.steps[0]!.done, new RegExp(`CONTAINER ${'ABCD'[pick]}`));
    assert.match(stepBlocked(real[0]!, new Set()) ?? '', /MANIFEST/);
  }
});

test('sabotage has three charges and a fuse; nothing else has one', () => {
  const s = planObjectives('sabotage', 2);
  assert.equal(s.steps.length, 3);
  assert.ok(s.fuseS >= 60 && s.fuseS <= 120);
  for (const c of ['extract', 'swap', 'vault', 'shipment'] as const) assert.equal(planObjectives(c, 2).fuseS, 0);
  assert.equal(fuseLeft(null, 100, 90), null);
  assert.equal(fuseLeft(10, 40, 90), 60);
  assert.equal(fuseLeft(10, 500, 90), 0);
  assert.equal(fuseLeft(10, 40, 0), null);
});

test('records and unbuilt contracts have no steps', () => {
  for (const c of CONTRACT_IDS) if (!(PLAYABLE as readonly string[]).includes(c)) assert.equal(planObjectives(c, 2).steps.length, 0, c);
});

test('a specimen warms from cold to spoiled over a generous window', () => {
  assert.equal(specimenWarmth(0), 0);
  assert.equal(specimenWarmth(SPECIMEN_SAFE_S), 1);
  assert.ok(SPECIMEN_SAFE_S >= 180, 'a few minutes at least');
  assert.ok(specimenWarmth(SPECIMEN_SAFE_S / 2) > 0.4 && specimenWarmth(SPECIMEN_SAFE_S / 2) < 0.6);
});
