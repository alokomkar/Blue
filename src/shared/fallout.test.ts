import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryOver, ladderCarry, describeCarry, mergeCarry, NO_CARRY, contractCarry } from './campaign.ts';
import { CONTRACT_IDS, CONTRACTS, isContractId } from './contracts.ts';
import { CASE_TIERS, caseStrength, communityCarry } from './case.ts';
import { falloutFor, pagesFor, runOutcomeOf, type MissionOutcome } from './fallout.ts';
const expects = (c: ReturnType<typeof carryOver>) => describeCarry(c);

const done = (o: Partial<MissionOutcome> = {}): MissionOutcome => ({ contract: 'records', cleared: true, alarms: 0, burned: false, units: 4, totalUnits: 4, ...o });

test('every contract has words for the HUD, the report and the week', () => {
  for (const id of CONTRACT_IDS) {
    const c = CONTRACTS[id];
    assert.equal(c.id, id);
    assert.ok(c.name && c.unit && c.report && c.evidence);
    assert.ok(isContractId(id));
  }
  assert.ok(!isContractId('extraction'));
});

test('a cleared contract pays off in its own way, and a failed one in none', () => {
  assert.equal(carryOver('clean', [], 'sabotage').guards, -1);
  assert.equal(carryOver('clean', [], 'sabotage').darkSections, 1);
  assert.equal(carryOver('noisy', [], 'vault').extraTraps, 1);
  assert.equal(carryOver('burned', [], 'hit').openDoors, 1);
  assert.equal(carryOver('clean', [], 'blackout').markBreakers, true);
  assert.deepEqual(contractCarry('records'), {});
  // Caught: the style's alert, and none of the contract's reward.
  const caught = carryOver('caught', [], 'sabotage');
  assert.equal(caught.kind, 'alert');
  assert.equal(caught.guards, 0);
  assert.deepEqual(caught.notes, []);
});

test('style and contract stack: a clean vault is a perk and a vault reward', () => {
  const c = carryOver('clean', [], 'vault');
  assert.equal(c.kind, 'perk');
  assert.equal(c.extraEmp, 2); // the perk's, and the vault's
  assert.equal(c.markNetwork, true);
  assert.equal(c.extraTraps, 1);
  assert.equal(c.notes.length, 1);
});

test('on the ladder only a cleared job carries forward', () => {
  assert.deepEqual(ladderCarry('caught', 'vault'), NO_CARRY);
  assert.deepEqual(ladderCarry(null, 'vault'), NO_CARRY);
  assert.equal(ladderCarry('clean', 'vault').extraTraps, 1);
  assert.equal(ladderCarry('noisy').kind, 'watch');
});

test('the carry-over says what it changes, good and bad', () => {
  const lines = describeCarry(mergeCarry(carryOver('noisy', [], 'sabotage'), { extraEmp: 1 }));
  const text = lines.map((l) => l.text).join(' | ');
  assert.match(text, /\+1 EMP/);
  assert.match(text, /fewer guard/);
  assert.match(text, /no power/);
  assert.match(text, /react faster/);
  assert.ok(lines.some((l) => l.tone === 'bad') && lines.some((l) => l.tone === 'good'));
  assert.deepEqual(describeCarry(NO_CARRY), []);
  assert.ok(describeCarry(carryOver('clean', [], 'vault')).some((l) => l.text === '+2 EMP charges in your kit'));
  assert.ok(describeCarry(carryOver('clean', [], 'records')).some((l) => l.text === '+1 EMP charge in your kit'));
});

test('pages of evidence: what the contract brings out, a page more for a clean run, none for a failure', () => {
  assert.equal(pagesFor(done()), 5); // four files, and a clean page
  assert.equal(pagesFor(done({ alarms: 1 })), 4);
  assert.equal(pagesFor(done({ burned: true })), 4);
  assert.equal(pagesFor(done({ cleared: false })), 0);
  assert.equal(pagesFor(done({ contract: 'vault' })), 5);
  assert.equal(pagesFor(done({ contract: 'sabotage', alarms: 2 })), 3);
  assert.equal(pagesFor(done({ contract: 'records', totalUnits: 0 })), 2); // never less than a page
});

test('the fallout says what was pinned, what went wrong, and what to expect', () => {
  const clean = falloutFor(done(), 'cargo manifests', expects(carryOver('clean', [], 'records')));
  assert.equal(clean.outcome, 'clean');
  assert.match(clean.consequences[0]!.text, /5 pages added to the week’s total: cargo manifests/);
  assert.ok(clean.consequences.some((c) => /Clean work/.test(c.text)));
  assert.ok(clean.expect.some((e) => /\+1 EMP/.test(e.text)));

  const loud = falloutFor(done({ alarms: 2, burned: true }), 'x', expects(carryOver('burned', [], 'records')));
  assert.equal(runOutcomeOf(done({ alarms: 2, burned: true })), 'burned');
  assert.ok(loud.consequences.some((c) => c.tone === 'bad' && /2 alarms/.test(c.text)));
  assert.ok(loud.consequences.some((c) => c.tone === 'bad' && /logs went out/.test(c.text)));

  const caught = falloutFor(done({ cleared: false }), 'x', expects(carryOver('caught')));
  assert.equal(caught.outcome, 'caught');
  assert.equal(caught.pages, 0);
  assert.match(caught.consequences[0]!.text, /Caught/);

  const sab = falloutFor(done({ contract: 'sabotage' }), CONTRACTS.sabotage.evidence, expects(carryOver('clean', [], 'sabotage')));
  assert.match(sab.consequences[0]!.text, /proof of the damage/);
  assert.ok(sab.expect.some((e) => /fewer guard/.test(e.text)));
});

test('the community week: tiers by pages, and what last week carries into this one', () => {
  assert.deepEqual(CASE_TIERS.map((t) => t.name), ['Bronze', 'Silver', 'Gold']);
  assert.equal(caseStrength(0).tier, 0);
  assert.equal(caseStrength(0).name, null);
  assert.equal(caseStrength(0).next?.name, 'Bronze');
  assert.equal(caseStrength(40).name, 'Bronze');
  assert.equal(caseStrength(150).name, 'Silver');
  assert.equal(caseStrength(150).next?.name, 'Gold');
  assert.equal(caseStrength(500).tier, 3);
  assert.equal(caseStrength(500).next, null);
  assert.equal(caseStrength(500).fraction, 1);
  assert.deepEqual(communityCarry(39), {});
  assert.deepEqual(communityCarry(60), {});
  assert.equal(communityCarry(100).extraEmp, 1);
  assert.equal(communityCarry(100).markNetwork, undefined);
  assert.equal(communityCarry(200).markNetwork, true);
});

test('the server accepts exactly the contracts the game has, and the pages a run reports', async () => {
  const { parseDailyResult } = await import('./daily.ts');
  const { isContract } = await import('./progress.ts');
  const run = { day: '2026-10-01', cleared: true, points: 500, grade: 'A', seconds: 200, documents: 3, totalDocuments: 3, spotted: 0, takedowns: 0 };
  for (const id of CONTRACT_IDS) {
    assert.ok(isContract(id), `${id} isn't accepted by the profile`);
    assert.equal(parseDailyResult({ ...run, contract: id, pages: 4 })?.contract, id, `${id} isn't accepted by a daily result`);
  }
  assert.equal(parseDailyResult({ ...run, contract: 'extraction' }), null);
  assert.equal(parseDailyResult({ ...run, pages: 99 }), null);
  assert.equal(parseDailyResult({ ...run, pages: 4 })?.pages, 4);
  assert.equal(parseDailyResult(run)?.contract, undefined, 'an older client that reports none is still fine');
});
