import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicMix, chordForBar, hz, PROGRESSION } from './music.ts';

test('exploring alone plays just the bed', () => {
  assert.deepEqual(musicMix(0, false, false), { explore: 1, tension: 0, chase: 0, alarm: 0 });
});

test('tension creeps in as an enemy closes, and is full once near', () => {
  assert.equal(musicMix(0.25, false, false).tension, 0.5);
  assert.equal(musicMix(0.5, false, false).tension, 1);
});

test('being chased brings in the chase layer and full tension, whatever the distance', () => {
  const m = musicMix(0, true, false);
  assert.equal(m.chase, 1);
  assert.equal(m.tension, 1);
});

test('the alarm layer follows the alarm', () => {
  assert.equal(musicMix(0, false, true).alarm, 1);
  assert.equal(musicMix(0, false, false).alarm, 0);
});

test('the progression holds each chord for two bars and cycles every eight', () => {
  assert.equal(chordForBar(0).name, 'Am');
  assert.equal(chordForBar(1).name, 'Am');
  assert.equal(chordForBar(2).name, 'F');
  assert.equal(chordForBar(7).name, 'Em');
  assert.equal(chordForBar(8).name, 'Am');
  assert.equal(PROGRESSION.length, 4);
});

test('hz: A4 is 440 and an octave doubles it', () => {
  assert.equal(hz(69), 440);
  assert.ok(Math.abs(hz(81) - 880) < 1e-9);
});
