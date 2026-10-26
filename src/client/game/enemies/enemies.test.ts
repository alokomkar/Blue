import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noiseRadius, canHear, WALK_NOISE, SNEAK_NOISE, SHOT_NOISE, PRONE_CRAWL_NOISE, DASH_RUN_NOISE, SILENT_SNEAK_NOISE, SILENT_CRAWL_NOISE } from './noise.ts';
import { DASH_NOISE } from '../dash.ts';

test('standing still is silent, sneaking is quiet, walking carries', () => {
  assert.equal(noiseRadius(false, false), 0);
  assert.equal(noiseRadius(false, true), 0);
  assert.equal(noiseRadius(true, true), SNEAK_NOISE);
  assert.equal(noiseRadius(true, false), WALK_NOISE);
  assert.ok(SNEAK_NOISE < WALK_NOISE);
});

test('a shot rings out briefly, even standing still, then fades', () => {
  assert.equal(noiseRadius(false, false, 0.1), SHOT_NOISE);
  assert.equal(noiseRadius(true, true, 0.1), SHOT_NOISE);
  assert.equal(noiseRadius(false, false, 5), 0);
});

test('a listener hears only within the noise reach, and never in silence', () => {
  assert.equal(canHear(WALK_NOISE, WALK_NOISE - 1), true);
  assert.equal(canHear(WALK_NOISE, WALK_NOISE + 1), false);
  assert.equal(canHear(0, 0), false);
  assert.equal(canHear(WALK_NOISE, Infinity), false);
});

test('crawling flat carries the least noise, and a shot still rings out over it', () => {
  assert.equal(noiseRadius(true, true, Infinity, true), PRONE_CRAWL_NOISE);
  assert.ok(PRONE_CRAWL_NOISE < SNEAK_NOISE);
  assert.equal(noiseRadius(false, true, Infinity, true), 0, 'lying still is silent');
  assert.equal(noiseRadius(true, true, 0.1, true), SHOT_NOISE);
});

test('a dash is the loudest way to move, short of a shot, and the two files agree on how loud', () => {
  assert.equal(DASH_RUN_NOISE, DASH_NOISE);
  assert.equal(noiseRadius(true, false, Infinity, false, true), DASH_RUN_NOISE);
  assert.ok(DASH_RUN_NOISE > WALK_NOISE);
  assert.equal(noiseRadius(false, false, Infinity, false, true), 0, 'standing still after a dash is silent');
  assert.equal(noiseRadius(true, true, Infinity, true, true), PRONE_CRAWL_NOISE, 'flat on the floor there is no dashing');
});

test('on a silent night every step carries further, and standing still is still silent', () => {
  assert.equal(noiseRadius(true, true, Infinity, false, false, true), SILENT_SNEAK_NOISE);
  assert.equal(noiseRadius(true, true, Infinity, true, false, true), SILENT_CRAWL_NOISE);
  assert.ok(SILENT_SNEAK_NOISE > SNEAK_NOISE && SILENT_CRAWL_NOISE > PRONE_CRAWL_NOISE);
  assert.ok(SILENT_SNEAK_NOISE < WALK_NOISE);
  assert.equal(noiseRadius(false, true, Infinity, false, false, true), 0);
  assert.equal(noiseRadius(true, true, 0.1, false, false, true), SHOT_NOISE, 'a shot is the loudest thing there is');
});
