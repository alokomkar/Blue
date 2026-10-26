import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_BEST, EMPTY_PROFILE, mergeBest, parseSaveRequest, encodeHeistDetail, decodeHeistDetail, parseProfileUpdate, mergeProfile, continueJob, isEnding } from './progress.ts';

test('mergeBest records a first clear and score from an empty record', () => {
  const r = mergeBest(EMPTY_BEST, { jobCleared: 1, score: 15 });
  assert.deepEqual(r.best, { bestJob: 1, bestScore: 15 });
  assert.equal(r.newBestJob, true);
  assert.equal(r.newBestScore, true);
});

test('mergeBest never lowers an existing best', () => {
  const r = mergeBest({ bestJob: 5, bestScore: 40 }, { jobCleared: 2, score: 10 });
  assert.deepEqual(r.best, { bestJob: 5, bestScore: 40 });
  assert.equal(r.newBestJob, false);
  assert.equal(r.newBestScore, false);
});

test('mergeBest: a caught run (jobCleared null) can still set a new best score but never a new best job', () => {
  const r = mergeBest({ bestJob: 3, bestScore: 20 }, { jobCleared: null, score: 25 });
  assert.deepEqual(r.best, { bestJob: 3, bestScore: 25 });
  assert.equal(r.newBestJob, false);
  assert.equal(r.newBestScore, true);
});

test('mergeBest: a negative score (rigged lockers) never beats the zero baseline', () => {
  const r = mergeBest(EMPTY_BEST, { jobCleared: null, score: -10 });
  assert.equal(r.best.bestScore, 0);
  assert.equal(r.newBestScore, false);
});

test('parseSaveRequest accepts well-formed bodies', () => {
  assert.deepEqual(parseSaveRequest({ jobCleared: 4, score: -10 }), { jobCleared: 4, score: -10 });
  assert.deepEqual(parseSaveRequest({ jobCleared: null, score: 0 }), { jobCleared: null, score: 0 });
});

test('parseSaveRequest rejects malformed or absurd bodies', () => {
  for (const bad of [
    null,
    'x',
    {},
    { jobCleared: 1 },
    { jobCleared: 1, score: '5' },
    { jobCleared: 1.5, score: 5 },
    { jobCleared: 0, score: 5 },
    { jobCleared: -3, score: 5 },
    { jobCleared: 1, score: Number.NaN },
    { jobCleared: 1, score: 1e9 },
    { jobCleared: 1e9, score: 5 },
    { jobCleared: undefined, score: 5 },
  ]) {
    assert.equal(parseSaveRequest(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('parseSaveRequest accepts heist points with a cleared job', () => {
  assert.deepEqual(parseSaveRequest({ jobCleared: 2, score: 15, heist: { points: 420, grade: 'A' } }), {
    jobCleared: 2,
    score: 15,
    heist: { points: 420, grade: 'A' },
  });
});

test('parseSaveRequest rejects heist points that are malformed or not for a cleared job', () => {
  for (const bad of [
    { jobCleared: null, score: 0, heist: { points: 100, grade: 'S' } },
    { jobCleared: 1, score: 0, heist: null },
    { jobCleared: 1, score: 0, heist: { points: -1, grade: 'S' } },
    { jobCleared: 1, score: 0, heist: { points: 1.5, grade: 'S' } },
    { jobCleared: 1, score: 0, heist: { points: 1e12, grade: 'S' } },
    { jobCleared: 1, score: 0, heist: { points: 100, grade: 'Z' } },
    { jobCleared: 1, score: 0, heist: { points: 100 } },
  ]) {
    assert.equal(parseSaveRequest(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('heist detail round-trips, and a missing or corrupt one decodes safely', () => {
  assert.deepEqual(decodeHeistDetail(encodeHeistDetail(7, 'S')), { job: 7, grade: 'S' });
  assert.deepEqual(decodeHeistDetail(undefined), { job: 0, grade: 'D' });
  assert.deepEqual(decodeHeistDetail('x|Q'), { job: 0, grade: 'D' });
});

test('profile updates take an agent and a trained flag, and nothing malformed', () => {
  assert.deepEqual(parseProfileUpdate({ agent: 'female' }), { agent: 'female' });
  assert.deepEqual(parseProfileUpdate({ trained: true }), { trained: true });
  assert.deepEqual(parseProfileUpdate({ look: 'operative' }), { look: 'operative' });
  assert.equal(parseProfileUpdate({ look: 'tuxedo' }), null);
  assert.deepEqual(parseProfileUpdate({ suit: 'midnight', hair: 'bald' }), { suit: 'midnight', hair: 'bald' });
  assert.equal(parseProfileUpdate({ suit: 'hot pink' }), null);
  assert.equal(parseProfileUpdate({ hair: 'mohawk' }), null);
  assert.deepEqual(parseProfileUpdate({}), {});
  assert.equal(parseProfileUpdate({ agent: 'robot' }), null);
  assert.equal(parseProfileUpdate({ trained: 'yes' }), null);
  assert.equal(parseProfileUpdate(null), null);
});

test('finishing training sticks, and the agent changes only when one is given', () => {
  const p = mergeProfile(EMPTY_PROFILE, { agent: 'female', trained: true });
  const none = { look: null, suit: null, hair: null, stealthTrained: false, ending: null, controls: null, lastRun: null };
  assert.deepEqual(p, { agent: 'female', ...none, trained: true });
  assert.deepEqual(mergeProfile(p, { trained: false }), { agent: 'female', ...none, trained: true });
  assert.deepEqual(mergeProfile(p, { agent: 'male' }), { agent: 'male', ...none, trained: true });
  assert.deepEqual(mergeProfile(p, { look: 'operative', suit: 'olive', hair: 'buns' }), { agent: 'female', look: 'operative', suit: 'olive', hair: 'buns', trained: true, stealthTrained: false, ending: null, controls: null, lastRun: null });
});

test('continue offers the job after the furthest cleared, from the server or this browser', () => {
  assert.equal(continueJob(null, null), null);
  assert.equal(continueJob(0, undefined), null);
  assert.equal(continueJob(7, null), 8);
  assert.equal(continueJob(3, 5), 6);
  assert.equal(continueJob(null, 2), 3);
  assert.equal(continueJob(-4, 1.5 as number), null);
});

test('the last cleared run is kept with the profile, and a save can only report a cleared one', async () => {
  const { parseLastRun, parseSaveRequest, isContract } = await import('./progress.ts');
  assert.deepEqual(parseLastRun('clean|vault'), { outcome: 'clean', contract: 'vault' });
  assert.equal(parseLastRun('caught|vault'), null);
  assert.equal(parseLastRun('clean|extraction'), null);
  assert.equal(parseLastRun(undefined), null);
  const prev = { ...EMPTY_PROFILE, lastRun: { outcome: 'noisy' as const, contract: 'hit' as const } };
  assert.deepEqual(mergeProfile(prev, { agent: 'male' }).lastRun, prev.lastRun, 'a profile update leaves it alone');
  assert.deepEqual(parseSaveRequest({ jobCleared: 3, score: 10, run: { outcome: 'clean', contract: 'records', pages: 5 } })?.run, { outcome: 'clean', contract: 'records', pages: 5 });
  assert.equal(parseSaveRequest({ jobCleared: null, score: 0, run: { outcome: 'clean', contract: 'records', pages: 5 } }), null, 'not a job that wasn’t cleared');
  assert.equal(parseSaveRequest({ jobCleared: 3, score: 0, run: { outcome: 'caught', contract: 'records', pages: 0 } }), null);
  assert.equal(parseSaveRequest({ jobCleared: 3, score: 0, run: { outcome: 'clean', contract: 'records', pages: 999 } }), null, 'no absurd page counts');
  assert.ok(isContract('blackout') && !isContract('extraction'));
});

test('the ending is made once and then stays, and only the two endings are accepted', () => {
  assert.deepEqual(parseProfileUpdate({ ending: 'public' }), { ending: 'public' });
  assert.equal(parseProfileUpdate({ ending: 'both' }), null);
  assert.equal(parseProfileUpdate({ ending: 3 }), null);
  assert.equal(isEnding('private'), true);
  assert.equal(isEnding('both'), false);
  const chosen = mergeProfile(EMPTY_PROFILE, { ending: 'private' });
  assert.equal(chosen.ending, 'private');
  assert.equal(mergeProfile(chosen, { ending: 'public' }).ending, 'private', 'a later choice does not undo the first');
  assert.equal(mergeProfile(chosen, { agent: 'male' }).ending, 'private');
});

test('the controls are replaced whole by each update and kept when an update has none', () => {
  const a = mergeProfile(EMPTY_PROFILE, { controls: { turn: 1.5, aim: 1, smooth: true, dash: true, keys: {} } });
  assert.deepEqual(a.controls, { turn: 1.5, aim: 1, smooth: true, dash: true, keys: {} });
  assert.deepEqual(mergeProfile(a, { agent: 'male' }).controls, a.controls);
  assert.deepEqual(mergeProfile(a, { controls: { turn: 1, aim: 1, smooth: false, dash: true, keys: { torch: 'KeyY' } } }).controls, { turn: 1, aim: 1, smooth: false, dash: true, keys: { torch: 'KeyY' } });
});

test('finishing the stealth course sticks, like finishing training, and only a boolean is accepted', () => {
  assert.deepEqual(parseProfileUpdate({ stealthTrained: true }), { stealthTrained: true });
  assert.equal(parseProfileUpdate({ stealthTrained: 'yes' }), null);
  const done = mergeProfile(EMPTY_PROFILE, { stealthTrained: true });
  assert.equal(done.stealthTrained, true);
  assert.equal(mergeProfile(done, { stealthTrained: false }).stealthTrained, true, 'a later false does not undo it');
  assert.equal(mergeProfile(done, { agent: 'male' }).stealthTrained, true);
  assert.equal(EMPTY_PROFILE.stealthTrained, false);
});
