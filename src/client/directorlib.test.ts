import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSpec, encodeSpec, failureLines, parseSse, playUrl, reasonText } from './directorlib.ts';
import type { LevelSpec } from '../shared/levelspec.ts';

const spec = {
  version: 1, title: 'Night at the Gallery', brief: 'Take the painting.', place: 'museum', layout: 'halls', size: { cols: 10, rows: 7 }, floors: 1, seed: 7, contract: 'vault', twists: ['lightsout'],
  roster: { guards: 2, watchdogs: 1, crawlers: 0, alphas: 0, drones: 0, heavies: 0 },
  hazards: { doors: 1, lasers: 2, lines: 0, gates: 0, sweepers: 0, sliders: 0, shutters: 0, blackouts: 0 },
  loot: { documents: 2 },
} as LevelSpec;

test('parseSse reads complete blocks and keeps a cut-off block for the next chunk', () => {
  const a = parseSse('event: round\ndata: {"type":"round","n":1,"of":4}\n\nevent: ver');
  assert.deepEqual(a.events, [{ type: 'round', n: 1, of: 4 }]);
  assert.equal(a.rest, 'event: ver');
  const b = parseSse(`${a.rest}ify\ndata: {"type":"verify","n":1,"ok":true,"failures":[]}\n\n`);
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0]!.type, 'verify');
  assert.equal(b.rest, '');
});

test('parseSse handles several events in a chunk, windows newlines, and skips what it cannot read', () => {
  const text = 'data: {"type":"round","n":1,"of":4}\r\n\r\ndata: not json\n\n: comment only\n\ndata: {"type":"round","n":2,"of":4}\n\n';
  const { events } = parseSse(text);
  assert.deepEqual(events.map((e) => (e.type === 'round' ? e.n : -1)), [1, 2]);
});

test('describeSpec says what the level is in plain sentences', () => {
  const lines = describeSpec(spec);
  assert.equal(lines[0], 'a museum, one floor, 10 by 7 cells, halls layout');
  assert.equal(lines[1], 'Job: open the vault');
  assert.equal(lines[2], 'Against: 2 guards, 1 dog on each floor');
  assert.equal(lines[3], 'Hazards: 2 lasers, 1 locked door');
  assert.equal(lines[4], 'Twist: lightsout');
  const quiet = describeSpec({ ...spec, floors: 2, layout: 'maze', roster: { ...spec.roster, guards: 0, watchdogs: 0 }, hazards: { ...spec.hazards, lasers: 0, doors: 0 }, twists: [] });
  assert.equal(quiet[0], 'a museum, two floors, 10 by 7 cells, a maze');
  assert.equal(quiet[2], 'Against: no one on each floor');
  assert.equal(quiet.length, 3);
});

test('the play address carries the spec as base64url that decodes back to it, and the partner flag', () => {
  const url = playUrl(spec, { coop: true });
  assert.match(url, /^game\.html\?spec=[A-Za-z0-9_-]+&coop=ai$/);
  const param = url.slice('game.html?spec='.length, url.indexOf('&'));
  assert.ok(!/[+/=]/.test(param));
  const json = Buffer.from(param.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.deepEqual(JSON.parse(json), spec);
  assert.equal(playUrl(spec), `game.html?spec=${encodeSpec(spec)}`);
  assert.equal(playUrl(spec, { base: '/x/' }).startsWith('/x/game.html?spec='), true);
});

test('failure lines use the checker\'s own sentences, and reasons are sentences', () => {
  assert.deepEqual(failureLines([{ code: 'exit_close', message: 'the exit is only 5 steps from the start' }, { code: 'x', message: '' }]), ['the exit is only 5 steps from the start', 'x']);
  assert.match(reasonText('request_rejected'), /filter/);
  assert.match(reasonText('rate_limited'), /busy/);
  assert.match(reasonText(undefined), /checker/);
  assert.match(reasonText('exit_close'), /checker/);
});
