import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmState, sendsHunters, ALARM_ON, ALARM_OFF, MAX_HUNTER_WAVES } from './alarm.ts';

test('the alarm trips at ALARM_ON and not before', () => {
  assert.equal(alarmState(false, ALARM_ON - 1), false);
  assert.equal(alarmState(false, ALARM_ON), true);
});

test('once up, it holds until suspicion falls below ALARM_OFF', () => {
  assert.equal(alarmState(true, ALARM_ON - 10), true);
  assert.equal(alarmState(true, ALARM_OFF), true);
  assert.equal(alarmState(true, ALARM_OFF - 1), false);
});

test('in between the two thresholds, it keeps whatever state it was in', () => {
  const mid = (ALARM_ON + ALARM_OFF) / 2;
  assert.equal(alarmState(false, mid), false);
  assert.equal(alarmState(true, mid), true);
});

test('hunters come for the first waves only', () => {
  assert.equal(sendsHunters(0), true);
  assert.equal(sendsHunters(MAX_HUNTER_WAVES - 1), true);
  assert.equal(sendsHunters(MAX_HUNTER_WAVES), false);
});
