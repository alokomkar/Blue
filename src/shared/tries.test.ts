import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causeOf, fieldsFor, parseTryReport, readOf, storyLine, trainingLine, triesToast } from './tries.ts';

test('grapple uses are counted, and only the known ones', () => {
  assert.deepEqual(parseTryReport({ kind: 'grapple', use: 'hover' }), { kind: 'grapple', use: 'hover' });
  assert.equal(parseTryReport({ kind: 'grapple', use: 'teleport' }), null);
  assert.deepEqual(fieldsFor({ kind: 'grapple', use: 'fall' }), ['grapple:fall']);
  assert.match(triesToast({ 'grapple:hook': '9', 'grapple:hover': '4', 'grapple:fall': '1' }), /Grapple: hook 9 · hover 4 · fall 1/);
});

test('a report that says its screen counts under it as well, and one that does not counts only in the totals', () => {
  assert.deepEqual(parseTryReport({ kind: 'try', job: 2, cleared: true, device: 'touch' }), { kind: 'try', job: 2, daily: false, cleared: true, device: 'touch' });
  assert.equal(parseTryReport({ kind: 'try', job: 2, cleared: true, device: 'fridge' })!.device, undefined);
  assert.deepEqual(fieldsFor({ kind: 'try', job: 2, daily: false, cleared: true, device: 'touch' }), ['j2:cleared', 'touch:j2:cleared']);
  assert.deepEqual(fieldsFor({ kind: 'grapple', use: 'hook', device: 'desktop' }), ['grapple:hook', 'desktop:grapple:hook']);
  assert.deepEqual(fieldsFor({ kind: 'try', job: 2, daily: false, cleared: true }), ['j2:cleared']);
});

test('the toast splits tries, clears, hard votes and hooks by screen, without the screens muddling the totals', () => {
  const t = triesToast({
    'j1:cleared': '3', 'j1:caught': '9', 'touch:j1:cleared': '1', 'touch:j1:caught': '8', 'desktop:j1:cleared': '2', 'desktop:j1:caught': '1',
    'touch:j1:feel:hard': '4', 'j1:feel:hard': '4', 'touch:grapple:hook': '5', 'grapple:hook': '6', 'desktop:grapple:hook': '1',
  });
  assert.match(t, /J1 3\/12/);
  assert.match(t, /touch: 9 tries, 1 cleared, 4 hard, 5 hooks/);
  assert.match(t, /desktop: 3 tries, 2 cleared, 0 hard, 1 hooks/);
  assert.match(t, /Felt: 0 easy · 0 right · 4 hard/);
});

test('every way of being caught maps to a cause, and anything else to other', () => {
  assert.equal(causeOf('Mauled by a watchdog'), 'dog');
  assert.equal(causeOf('Caught in a laser'), 'laser');
  assert.equal(causeOf('Blown up by an alpha'), 'blast');
  assert.equal(causeOf("You've been spotted"), 'spotted');
  assert.equal(causeOf('Spotted from above'), 'drone');
  assert.equal(causeOf('Something new'), 'other');
});

test('reports are parsed strictly', () => {
  assert.deepEqual(parseTryReport({ kind: 'try', job: 3, daily: false, cleared: true }), { kind: 'try', job: 3, daily: false, cleared: true });
  assert.deepEqual(parseTryReport({ kind: 'try', job: 3, cleared: false, cause: 'dog' }), { kind: 'try', job: 3, daily: false, cleared: false, cause: 'dog' });
  assert.equal((parseTryReport({ kind: 'try', job: 3, cleared: false, cause: 'made-up' }) as { cause: string }).cause, 'other');
  assert.deepEqual(parseTryReport({ kind: 'feel', job: 2, daily: true, feel: 'hard' }), { kind: 'feel', job: 2, daily: true, feel: 'hard' });
  for (const bad of [null, 'x', {}, { kind: 'try', job: 0, cleared: true }, { kind: 'try', job: 1.5, cleared: true }, { kind: 'try', job: 100, cleared: true }, { kind: 'try', job: 1 }, { kind: 'feel', job: 1, feel: 'meh' }])
    assert.equal(parseTryReport(bad), null, JSON.stringify(bad));
});

test('a failed try adds to its job, its cause on that job, and the cause overall', () => {
  assert.deepEqual(fieldsFor({ kind: 'try', job: 4, daily: false, cleared: true }), ['j4:cleared']);
  assert.deepEqual(fieldsFor({ kind: 'try', job: 4, daily: true, cleared: false, cause: 'dog' }), ['d4:caught', 'd4:cause:dog', 'cause:dog']);
  assert.deepEqual(fieldsFor({ kind: 'feel', job: 4, daily: false, feel: 'easy' }), ['j4:feel:easy']);
});

test('the moderator toast reads clears per try, what ends tries, and how it felt', () => {
  const t = triesToast({ 'j1:cleared': '9', 'j1:caught': '3', 'j2:cleared': '2', 'j2:caught': '7', 'cause:dog': '6', 'cause:laser': '4', 'j1:feel:hard': '2', 'j2:feel:right': '1', 'd3:cleared': '1', 'd3:caught': '4' });
  assert.match(t, /J1 9\/12 · J2 2\/9/);
  assert.match(t, /Ended by: dog 6 · laser 4/);
  assert.match(t, /Felt: 0 easy · 1 right · 2 hard/);
  assert.match(t, /Daily: 1\/5/);
  assert.equal(triesToast({}), 'No tries yet.');
});

test('training reports are parsed strictly and counted per station, with the screen under it', () => {
  assert.deepEqual(parseTryReport({ kind: 'train', course: 'basics', event: 'reach', station: 3, device: 'touch' }), { kind: 'train', course: 'basics', event: 'reach', station: 3, device: 'touch' });
  assert.deepEqual(parseTryReport({ kind: 'train', course: 'basics', event: 'done' }), { kind: 'train', course: 'basics', event: 'done' });
  assert.equal(parseTryReport({ kind: 'train', course: 'basics', event: 'reach' }), null, 'a station is needed');
  assert.equal(parseTryReport({ kind: 'train', course: 'basics', event: 'reach', station: 0 }), null);
  assert.equal(parseTryReport({ kind: 'train', course: 'basics', event: 'reach', station: 999 }), null);
  assert.equal(parseTryReport({ kind: 'train', course: 'nope', event: 'done' }), null);
  assert.equal(parseTryReport({ kind: 'train', course: 'basics', event: 'quit', station: 1 }), null);
  assert.deepEqual(fieldsFor({ kind: 'train', course: 'basics', event: 'fail', station: 7, device: 'desktop' }), ['train:basics:s7:fail', 'desktop:train:basics:s7:fail']);
  assert.deepEqual(fieldsFor({ kind: 'train', course: 'grapple', event: 'done' }), ['train:grapple:done']);
});

test('the training line shows who reached each station, the stations that restarted people most, and who finished', () => {
  assert.equal(trainingLine({}), '', 'nothing before anyone has trained');
  assert.equal(trainingLine({ 'j1:cleared': '4', 'train:grapple:s1:reach': '2' }), '', 'only the basics course is read');
  const t = trainingLine({
    'train:basics:s1:reach': '10', 'train:basics:s2:reach': '8', 'train:basics:s3:reach': '3',
    'train:basics:s2:fail': '5', 'train:basics:s3:fail': '9', 'train:basics:done': '1',
    'touch:train:basics:s1:reach': '6', 'touch:train:basics:done': '0', 'desktop:train:basics:s1:reach': '4', 'desktop:train:basics:done': '1',
  });
  assert.match(t, /reached \(station:agents\) 1:10 2:8 3:3/);
  assert.match(t, /finished 1/);
  assert.match(t, /most restarts \(station:times\) 3:9 2:5/);
  assert.match(t, /touch 0\/6 · desktop 1\/4/);
});

test('a letter is read as fast, mid or slow by how long it was open', () => {
  assert.equal(readOf(0.4), 'fast');
  assert.equal(readOf(2.99), 'fast');
  assert.equal(readOf(3), 'mid');
  assert.equal(readOf(12), 'mid');
  assert.equal(readOf(12.01), 'slow');
});

test('letter and story reports are parsed strictly and counted per job, with the screen under each', () => {
  assert.deepEqual(parseTryReport({ kind: 'letter', job: 4, daily: false, event: 'shown' }), { kind: 'letter', job: 4, daily: false, event: 'shown' });
  assert.deepEqual(parseTryReport({ kind: 'letter', job: 4, event: 'accept', read: 'slow', device: 'touch' }), { kind: 'letter', job: 4, daily: false, event: 'accept', read: 'slow', device: 'touch' });
  assert.deepEqual(parseTryReport({ kind: 'letter', job: 4, event: 'shown', read: 'slow' }), { kind: 'letter', job: 4, daily: false, event: 'shown' }, 'a letter just opened has no read');
  assert.equal(parseTryReport({ kind: 'letter', job: 4, event: 'ignore' }), null);
  assert.equal(parseTryReport({ kind: 'letter', job: 0, event: 'shown' }), null);
  assert.deepEqual(fieldsFor({ kind: 'letter', job: 4, daily: false, event: 'accept', read: 'fast', device: 'desktop' }), ['letter:j4:accept', 'letter:j4:read:fast', 'desktop:letter:j4:accept', 'desktop:letter:j4:read:fast']);
  assert.deepEqual(fieldsFor({ kind: 'letter', job: 9, daily: true, event: 'later', read: 'mid' }), ['letter:d9:later', 'letter:d9:read:mid']);
  assert.deepEqual(parseTryReport({ kind: 'story', what: 'memory', job: 5, n: 2 }), { kind: 'story', what: 'memory', job: 5, n: 2 });
  assert.equal(parseTryReport({ kind: 'story', what: 'memory', job: 5, n: 0 }), null);
  assert.equal(parseTryReport({ kind: 'story', what: 'memory', job: 5, n: 99 }), null);
  assert.equal(parseTryReport({ kind: 'story', what: 'other' }), null);
  assert.deepEqual(parseTryReport({ kind: 'story', what: 'ending', ending: 'public', skipped: true }), { kind: 'story', what: 'ending', ending: 'public', skipped: true });
  assert.equal(parseTryReport({ kind: 'story', what: 'ending', ending: 'both', skipped: true }), null);
  assert.equal(parseTryReport({ kind: 'story', what: 'ending', ending: 'public' }), null);
  assert.deepEqual(fieldsFor({ kind: 'story', what: 'ending', ending: 'private', skipped: false }), ['story:ending:private', 'story:ending:watched']);
  assert.deepEqual(fieldsFor({ kind: 'story', what: 'memory', job: 5, n: 2 }), ['story:memory:j5:2']);
});

test('the story line shows letters per job, cards seen and how the final choices went, and nothing when there is nothing', () => {
  assert.equal(storyLine({}), '');
  assert.equal(storyLine({ 'j1:cleared': '3' }), '');
  const t = storyLine({
    'letter:j1:shown': '12', 'letter:j1:accept': '9', 'letter:j1:read:fast': '7', 'letter:j2:shown': '5', 'letter:j2:accept': '4',
    'touch:letter:j1:shown': '4', 'letter:d3:shown': '99', 'story:memory:j1:1': '6', 'story:memory:j2:1': '2',
    'story:ending:public': '3', 'story:ending:private': '1', 'story:ending:skipped': '2', 'story:ending:watched': '2',
  });
  assert.match(t, /J1 12 opened 9 accepted 7 skimmed/);
  assert.match(t, /J2 5 opened 4 accepted 0 skimmed/);
  assert.doesNotMatch(t, /J3|99/, 'the Daily and the screens do not muddle the ladder');
  assert.match(t, /Cards seen 8/);
  assert.match(t, /Choices: 3 public · 1 private \(2 skipped the film\)/);
});
