import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, debrief, jobOperation, operationFor, salutation } from './story.ts';
import { dayInfo, nextDay } from './daily.ts';
import { caseFor, carryOver } from './campaign.ts';

const op = (day: string) => operationFor(dayInfo(day));

test('the day decides the operation, so everyone shares tonight’s story', () => {
  assert.deepEqual(op('2026-09-27'), op('2026-09-27'));
  let day = '2026-09-27';
  const sites = new Set<string>();
  for (let i = 0; i < 7; i++, day = nextDay(day)) sites.add(op(day).site.name);
  assert.ok(sites.size >= 3, 'the target changes through the week');
  assert.equal(nextDay('2026-09-30'), '2026-10-01');
});

test('the handler addresses the player as Mr. or Ms. by their agent, or as Agent when there’s no name', () => {
  assert.equal(salutation('male', 'lokigambit'), 'Mr. lokigambit');
  assert.equal(salutation('female', 'lokigambit'), 'Ms. lokigambit');
  assert.equal(salutation(null, 'lokigambit'), 'Mr. lokigambit');
  assert.equal(salutation('female', null), 'Agent');
});

test('the briefing names the target and the parameters, with the right file count', () => {
  const o = op('2026-09-27');
  const b = briefing(o, 3, 'female', 'sam');
  assert.equal(b.greeting, 'Good evening, Ms. sam.');
  assert.ok(b.paragraphs.join(' ').includes(o.site.name));
  assert.deepEqual(
    b.parameters.map((p) => p.text),
    ['Photograph all 3 files.', 'Wipe the access logs before they go out.', 'Get out without being caught.', 'Keep a low profile: raise no alarms.']
  );
});

test('the debrief marks each parameter, reads the verdict, and names tomorrow’s target', () => {
  const o = op('2026-09-27');
  const next = op('2026-09-28');
  const clean = debrief(o, next, { cleared: true, documents: 3, totalDocuments: 3, alarms: 0, burned: false }, 'male', 'x');
  assert.equal(clean.verdict, 'flawless');
  assert.deepEqual(clean.parameters.map((p) => p.met), [true, true, true, true]);
  assert.ok(clean.closing.includes(next.site.name));
  const loud = debrief(o, next, { cleared: true, documents: 3, totalDocuments: 3, alarms: 2, burned: false }, 'male', 'x');
  assert.equal(loud.verdict, 'noisy');
  assert.deepEqual(loud.parameters.map((p) => p.met), [true, true, true, false]);
  assert.equal(loud.parameters[3]!.text, '2 alarms raised.');
  const burned = debrief(o, next, { cleared: true, documents: 3, totalDocuments: 3, alarms: 1, burned: true }, 'male', 'x');
  assert.equal(burned.verdict, 'burned');
  assert.deepEqual(burned.parameters.map((p) => p.met), [true, false, true, false]);
  const caught = debrief(o, next, { cleared: false, documents: 1, totalDocuments: 3, alarms: 0, burned: false }, 'male', 'x');
  assert.equal(caught.verdict, 'failed');
  assert.deepEqual(caught.parameters.map((p) => p.met), [false, false, false, false]);
  assert.equal(caught.parameters[0]!.text, 'Files: 1 of 3 photographed.');
});

test('the briefing can be read again after the scored attempt, and says the run is practice', () => {
  const o = op('2026-09-27');
  assert.ok(briefing(o, 3, null, null).closing.includes('one attempt'));
  assert.ok(briefing(o, 3, null, null, 'replay').closing.includes('practice'));
  assert.ok(briefing(o, 3, null, null, 'guest').closing.includes('Log in'));
  assert.deepEqual(briefing(o, 3, null, null, 'replay').parameters, briefing(o, 3, null, null).parameters);
});

test('each job on the ladder has its own letter, the same every time it is played', () => {
  assert.deepEqual(jobOperation(4), jobOperation(4));
  const letter = briefing(jobOperation(4), 3, 'female', 'sam', 'job');
  assert.ok(letter.kicker.endsWith('Job 4'));
  assert.ok(letter.paragraphs.join(' ').includes(jobOperation(4).site.name));
  const sites = new Set(Array.from({ length: 8 }, (_, i) => jobOperation(i + 1).site.name));
  assert.ok(sites.size >= 3, 'the target changes from job to job');
});

const night = (day: string) => operationFor({ ...dayInfo(day), chapter: caseFor(day)! });

test('a daily is a night of the week’s route: Monday opens it on the route’s first site', () => {
  const mon = night('2026-09-28');
  const f = caseFor('2026-09-28')!.figure;
  assert.equal(mon.site.name, f.nights[0].site.name);
  const letter = briefing(mon, 3, 'male', 'x');
  assert.ok(letter.paragraphs[0]!.startsWith('A new week'));
  assert.ok(letter.paragraphs[0]!.includes(f.alias));
  assert.ok(letter.kicker.includes('Night 1 of 7'));
  // The whole week shares one operation name.
  assert.equal(night('2026-10-01').name, mon.name);
});

test('last night carries into tonight’s letter', () => {
  const tue = night('2026-09-29');
  assert.equal(briefing(tue, 3, null, null, 'scored', carryOver(null)).paragraphs.length, 2);
  assert.ok(briefing(tue, 3, null, null, 'scored', carryOver('clean')).paragraphs[1]!.includes('favour'));
  assert.ok(briefing(tue, 3, null, null, 'scored', carryOver('burned')).paragraphs[1]!.includes('on alert'));
});

test('each debrief points to the next night, and Sunday’s closes the week with the week’s tally', () => {
  const sat = night('2026-10-03');
  const sun = night('2026-10-04');
  const clean = { cleared: true, documents: 3, totalDocuments: 3, alarms: 0, burned: false };
  assert.ok(debrief(sat, sun, clean, null, null).closing.includes(sun.site.name));
  const closing = debrief(sun, night('2026-10-05'), clean, null, null, ['clean', 'clean', 'noisy', 'missed', 'clean', 'clean']);
  assert.ok(closing.closing.includes('new week opens'));
  assert.ok(closing.paragraphs[1]!.startsWith(`That closes the week on ${caseFor('2026-10-04')!.figure.name}.`));
  assert.ok(closing.paragraphs[1]!.includes('6 of the seven nights, 5 clean'));
});

test('the letter and debrief use the contract’s own words', () => {
  const o = jobOperation(4);
  const records = briefing(o, 3, null, null, 'job');
  assert.ok(records.paragraphs.some((p) => p.includes('access logs') || p.includes('logs go out')));
  assert.ok(records.parameters.some((p) => p.text.includes('access logs')));
  for (const id of ['sabotage', 'vault', 'swap', 'shipment', 'extract'] as const) {
    const letter = briefing(o, 3, null, null, 'job', null, null, id);
    assert.ok(!letter.paragraphs.some((p) => p.includes('photograph the files')), id);
    assert.ok(!letter.parameters.some((p) => p.text.includes('access logs')), id);
    assert.ok(letter.parameters[0]!.text.length > 5, id);
    const next = jobOperation(5);
    const d = debrief(o, next, { cleared: true, documents: 3, totalDocuments: 3, alarms: 0, burned: false }, null, null, [], null, id);
    assert.ok(!d.parameters.some((p) => p.text.includes('photographed') || p.text.includes('Access logs')), id);
  }
});

test('the side goal is in the letter in plain words, and in the debrief', () => {
  const o = jobOperation(4);
  const side = { name: 'No alarms', ask: 'Do not set off a single alarm.', bonus: 250 };
  const plain = briefing(o, 3, null, null, 'job');
  const withSide = briefing(o, 3, null, null, 'job', null, null, 'records', side);
  assert.equal(withSide.paragraphs.length, plain.paragraphs.length + 1);
  assert.ok(withSide.paragraphs.some((p) => p.includes('Do not set off a single alarm') && p.includes('+250')));
  assert.ok(withSide.parameters.some((p) => p.text.includes('No alarms') && p.text.includes('250')));
  assert.equal(plain.parameters.length, withSide.parameters.length - 1);
  const next = jobOperation(5);
  const out = { cleared: true, documents: 3, totalDocuments: 3, alarms: 0, burned: false };
  const kept = debrief(o, next, out, null, null, [], null, 'records', { name: 'No alarms', kept: true, bonus: 250 });
  assert.ok(kept.parameters.some((p) => p.text.includes('kept') && p.met === true));
  const missed = debrief(o, next, out, null, null, [], null, 'records', { name: 'No alarms', kept: false, bonus: 250 });
  assert.ok(missed.parameters.some((p) => p.text.includes('missed') && p.met === false));
});

test('notes from the handler ride on the letter only when there are some', () => {
  const o = jobOperation(7);
  assert.equal(briefing(o, 3, null, null, 'job').notes, undefined);
  const note = { title: 'Silent night', text: 'No guards tonight.' };
  const letter = briefing(o, 3, null, null, 'job', null, null, 'extract', null, [note]);
  assert.deepEqual(letter.notes, [note]);
});
