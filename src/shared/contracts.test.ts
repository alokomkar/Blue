import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_IDS, CONTRACTS } from './contracts.ts';
import { isContract } from './progress.ts';
import { parseDailyResult } from './daily.ts';
import { pagesFor } from './fallout.ts';
import { contractCarry } from './campaign.ts';

test('every contract has its words, is accepted from the browser, pays pages and says what it carries on', () => {
  for (const id of CONTRACT_IDS) {
    assert.ok(CONTRACTS[id].unit.length > 0, id);
    assert.ok(CONTRACTS[id].evidence.length > 0, id);
    assert.equal(isContract(id), true, `${id} is rejected by progress.ts`);
    const result = { day: '2026-10-01', cleared: true, points: 100, grade: 'A', seconds: 200, documents: 3, totalDocuments: 3, spotted: 0, takedowns: 0, contract: id };
    assert.ok(parseDailyResult(result), `${id} is rejected by daily.ts`);
    assert.ok(pagesFor({ contract: id, cleared: true, alarms: 0, burned: false, units: 3, totalUnits: 3 }) >= 3, id);
    if (id !== 'records') assert.ok((contractCarry(id).notes ?? []).length > 0 || id === 'hit', `${id} carries nothing on`);
  }
  assert.equal(isContract('nonsense'), false);
});
