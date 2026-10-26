import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locksFor, logDeadline, queuedLogsText } from './sequence.ts';

test('the heist goes in order: uplink, files, logs', () => {
  assert.deepEqual(locksFor(true, 3), { capture: true, wipe: true });
  assert.deepEqual(locksFor(false, 3), { capture: false, wipe: true }, 'uplink down: files open, logs still locked');
  assert.deepEqual(locksFor(false, 1), { capture: false, wipe: true }, 'one file left: still no wiping');
  assert.deepEqual(locksFor(false, 0), { capture: false, wipe: false }, 'every file in: the logs can be wiped');
});

test('the log batch goes out a window after the latest capture, whatever came before', () => {
  assert.equal(logDeadline(100, 120), 220);
  assert.ok(logDeadline(130, 120) > logDeadline(100, 120), 'a later capture gives a later deadline');
});

test('the PDA says when the logs are queued but still locked', () => {
  assert.equal(queuedLogsText('1:58', false), 'Out in 1:58');
  assert.match(queuedLogsText('1:58', true), /After files/);
});
