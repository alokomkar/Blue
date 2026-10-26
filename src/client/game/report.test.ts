import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parSeconds, stealthRating, gradeFor, heistPoints, formatTime, type JobStats } from './report.ts';

const clean: JobStats = {
  level: 1,
  cleared: true,
  seconds: 120,
  cells: 160,
  documents: 3,
  totalDocuments: 3,
  logs: 'wiped',
  botsStunned: 0,
  empsUsed: 0,
  takedowns: 0,
  shotsFired: 0,
  alarms: 0,
  timesSpotted: 0,
  timesHit: 0,
  lockersOpened: 3,
  riggedLockers: 0,
  gridsPowered: 1,
  bodiesFound: 0,
  score: 0,
};

test('a clean run inside par is a perfect S', () => {
  assert.equal(stealthRating(clean), 100);
  assert.equal(gradeFor(stealthRating(clean)), 'S');
});

test('being spotted or shot costs the grade', () => {
  assert.equal(gradeFor(stealthRating({ ...clean, timesSpotted: 1 })), 'A');
  assert.equal(gradeFor(stealthRating({ ...clean, timesSpotted: 1, timesHit: 1 })), 'B');
  assert.equal(gradeFor(stealthRating({ ...clean, timesSpotted: 3, timesHit: 2 })), 'D');
});

test('takedowns and opening lockers do not cost the grade', () => {
  assert.equal(stealthRating({ ...clean, botsStunned: 6, takedowns: 6, lockersOpened: 9, riggedLockers: 2 }), 100);
});

test('every stun shot costs a little, up to a cap', () => {
  assert.equal(stealthRating({ ...clean, shotsFired: 1 }), 96);
  assert.equal(gradeFor(stealthRating({ ...clean, shotsFired: 2 })), 'A');
  assert.equal(stealthRating({ ...clean, shotsFired: 50 }), 80);
});

test('takedowns add heist points', () => {
  assert.equal(heistPoints(1, 'D', 0, 3) - heistPoints(1, 'D', 0), 30);
});

test('running long past par costs up to 25 points, never more', () => {
  const par = parSeconds(clean.cells);
  assert.equal(stealthRating({ ...clean, seconds: par }), 100);
  assert.ok(stealthRating({ ...clean, seconds: par * 1.4 }) < 100);
  assert.equal(stealthRating({ ...clean, seconds: par * 20 }), 75);
});

test('the rating never drops below zero', () => {
  assert.equal(stealthRating({ ...clean, timesSpotted: 20, timesHit: 20 }), 0);
});

test('heist points reward bigger jobs, better grades, and locker score', () => {
  assert.ok(heistPoints(3, 'B', 0) > heistPoints(2, 'B', 0));
  assert.ok(heistPoints(2, 'S', 0) > heistPoints(2, 'A', 0));
  assert.equal(heistPoints(1, 'D', 30), 130);
  assert.equal(heistPoints(1, 'D', -20), 100, 'a negative locker score never takes points away');
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(247.4), '4:07');
  assert.equal(formatTime(3600), '60:00');
});

test('letting the access logs go out costs the grade', () => {
  assert.equal(stealthRating({ ...clean, logs: 'none' }), 100);
  assert.equal(stealthRating({ ...clean, logs: 'burned' }), 75);
});
