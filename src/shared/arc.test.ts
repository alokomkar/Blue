import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARC_JOBS, ENDINGS, arcOpening, arcParagraph, choiceLetter, endingLetter, epilogueParagraph, fragmentFor, isEnding } from './arc.ts';
import { briefing, debrief, jobOperation, operationFor } from './story.ts';
import { isEnding as progressIsEnding } from './progress.ts';
import { caseFor } from './campaign.ts';

const who = { greeting: 'Good evening, Agent,' };

test('no job is scripted: every job keeps the usual opening and the day’s own target', () => {
  assert.equal(ARC_JOBS, 0);
  for (const j of [0, 1, 5, 15, 16]) {
    assert.equal(arcParagraph(j), null, `job ${j}`);
    assert.equal(arcOpening(j, null), null, `job ${j}`);
    assert.equal(arcOpening(j, 'public'), null, `job ${j}`);
    assert.equal(epilogueParagraph('private', j), null, `job ${j}`);
  }
  const letter = briefing(jobOperation(5), 4, null, null, 'job', null, arcOpening(5, null));
  assert.match(letter.paragraphs[0]!, /come highly recommended/);
  assert.match(letter.paragraphs[1]!, /Tonight’s target is/);
});

test('the profile accepts exactly the endings the arc knows', () => {
  for (const e of ENDINGS) assert.equal(progressIsEnding(e), isEnding(e));
  assert.equal(progressIsEnding('both'), false);
});

test('the neutral choice and closing letters are well formed', () => {
  assert.equal(choiceLetter(who).parameters.length, 2);
  for (const e of ENDINGS) assert.ok(endingLetter(e, who).paragraphs.length > 0);
});

test('the last night of a week ends on a field note', () => {
  const chapter = caseFor('2026-10-05')!;
  const base = { day: '2026-10-05', number: 4, level: 5, seed: 7 };
  const op = operationFor({ ...base, chapter: { ...chapter, night: 6 } });
  const outcome = { cleared: true, documents: 4, totalDocuments: 4, alarms: 0, burned: false };
  const tomorrow = operationFor({ ...base, number: 5 });
  const plain = debrief(op, tomorrow, outcome, null, null, []);
  const withNote = debrief(op, tomorrow, outcome, null, null, [], fragmentFor(chapter.number));
  assert.equal(withNote.paragraphs.length, plain.paragraphs.length + 1);
  assert.match(withNote.paragraphs.at(-1)!, /^Field note: /);
  const midweek = operationFor({ ...base, chapter: { ...chapter, night: 2 } });
  assert.equal(debrief(midweek, tomorrow, outcome, null, null, [], fragmentFor(1)).paragraphs.length, 1, 'only the last night carries a note');
  assert.match(briefing(op, 4, null, null, 'scored').paragraphs[0]!, /last night/i);
});

test('the field notes come round across the weeks, whatever the week number', () => {
  assert.equal(fragmentFor(1), fragmentFor(7));
  assert.notEqual(fragmentFor(1), fragmentFor(2));
  assert.ok(fragmentFor(0));
  assert.ok(fragmentFor(-3));
});
