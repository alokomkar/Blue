import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAR_R, CLOSE_AFTER_S, OPEN_R, SHUT, stepRoomDoor } from './roomdoors.ts';

test('a shut door opens as soon as anything comes within reach, and stays shut for what passes at a distance', () => {
  assert.equal(stepRoomDoor(SHUT, OPEN_R - 0.1, 0.016).open, true);
  assert.equal(stepRoomDoor(SHUT, OPEN_R + 0.5, 0.016).open, false);
  assert.equal(stepRoomDoor(SHUT, 2, 0.016).open, false, 'a guard walking down the middle of the corridor is about two metres off');
});

test('an open door shuts only after everything has been clear of it for a moment', () => {
  let s = stepRoomDoor(SHUT, 0.5, 0.016);
  s = stepRoomDoor(s, CLEAR_R + 1, CLOSE_AFTER_S / 2);
  assert.equal(s.open, true);
  s = stepRoomDoor(s, CLEAR_R + 1, CLOSE_AFTER_S / 2 + 0.01);
  assert.equal(s.open, false);
});

test('something coming back while it waits starts the wait over', () => {
  let s = stepRoomDoor(SHUT, 0.5, 0.016);
  s = stepRoomDoor(s, CLEAR_R + 1, CLOSE_AFTER_S - 0.1);
  s = stepRoomDoor(s, OPEN_R - 0.1, 0.016);
  s = stepRoomDoor(s, CLEAR_R + 1, CLOSE_AFTER_S - 0.1);
  assert.equal(s.open, true);
});

test('the agent standing in the middle of a one-cell room does not hold the door open, and standing in the doorway does', () => {
  // The doorway is at a cell's edge; the middle of the cell is two metres from it.
  assert.ok(2 > CLEAR_R);
  let s = stepRoomDoor(SHUT, 0.4, 0.016);
  s = stepRoomDoor(s, 1.5, 5);
  assert.equal(s.open, true, 'between the two radii it neither opens nor starts to close');
  s = stepRoomDoor(s, 2, CLOSE_AFTER_S + 0.1);
  assert.equal(s.open, false);
});
