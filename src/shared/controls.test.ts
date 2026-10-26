import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_CONTROLS,
  DEFAULT_KEYS,
  TURN_MAX,
  TURN_MIN,
  actionOf,
  bind,
  isBindable,
  isCustom,
  keyLabel,
  parseControls,
  resolveKeys,
  withKeys,
} from './controls.ts';

test('every action has a default key and a label, and no two actions share a default', () => {
  assert.equal(new Set(Object.values(DEFAULT_KEYS)).size, ACTIONS.length);
  for (const a of ACTIONS) {
    assert.ok(isBindable(DEFAULT_KEYS[a]), a);
    assert.ok(ACTION_LABELS[a], a);
  }
});

test('turn sensitivity is clamped to its range and rounded to a twentieth, and an odd value falls back to normal', () => {
  assert.equal(parseControls({ turn: 9 })!.turn, TURN_MAX);
  assert.equal(parseControls({ turn: 0.01 })!.turn, TURN_MIN);
  assert.equal(parseControls({ turn: 1.2345 })!.turn, 1.25);
  assert.equal(parseControls({ turn: 'fast' })!.turn, DEFAULT_CONTROLS.turn);
  assert.equal(parseControls({ turn: NaN })!.turn, DEFAULT_CONTROLS.turn);
  assert.equal(parseControls({})!.smooth, false);
  assert.equal(parseControls({ smooth: true })!.smooth, true);
  assert.equal(parseControls({ smooth: 'yes' })!.smooth, false);
});

test('settings are read from an object or a JSON string, and anything else is not settings', () => {
  assert.deepEqual(parseControls('{"turn":1.5,"smooth":true,"keys":{"torch":"KeyY"}}'), { turn: 1.5, aim: 1, camera: 47, smooth: true, dash: true, fps: false, keys: { torch: 'KeyY' } });
  assert.equal(parseControls('not json'), null);
  assert.equal(parseControls(null), null);
  assert.equal(parseControls(7), null);
  assert.deepEqual(parseControls({}), DEFAULT_CONTROLS);
});

test('keys that are not bindable, not actions, or on the same key twice are dropped', () => {
  const p = parseControls({ keys: { torch: 'Escape', goggles: 'F1', nope: 'KeyY', flare: 'KeyJ', trap: 'KeyJ', camo: 'MetaLeft' } })!;
  assert.deepEqual(p.keys, { flare: 'KeyJ' });
  assert.equal(isBindable('Escape'), false);
  assert.equal(isBindable('Enter'), false);
  assert.equal(isBindable('ControlLeft'), false);
  assert.equal(isBindable(12), false);
  assert.equal(isBindable('KeyJ'), true);
  assert.equal(isBindable('ShiftRight'), true);
});

test('settings that would leave two actions on one key are not trusted', () => {
  // Forward on A while turn-left is still on A.
  assert.deepEqual(parseControls({ turn: 1.5, keys: { forward: 'KeyA' } }), { turn: 1.5, aim: 1, camera: 47, smooth: false, dash: true, fps: false, keys: {} });
});

test('binding a free key moves the action there, and the default key is then free', () => {
  const s = bind(DEFAULT_CONTROLS, 'torch', 'KeyY');
  assert.deepEqual(s.keys, { torch: 'KeyY' });
  assert.equal(resolveKeys(s).torch, 'KeyY');
  assert.equal(actionOf(resolveKeys(s), 'KeyT'), null);
  assert.equal(actionOf(resolveKeys(s), 'KeyY'), 'torch');
});

test('binding a key another action holds swaps the two, so nothing is left without one', () => {
  const s = bind(DEFAULT_CONTROLS, 'torch', 'KeyR'); // R was night vision
  const keys = resolveKeys(s);
  assert.equal(keys.torch, 'KeyR');
  assert.equal(keys.goggles, 'KeyT');
  assert.equal(new Set(Object.values(keys)).size, ACTIONS.length);
});

test('binding something back to its default drops it from what is kept; an unbindable key changes nothing', () => {
  const moved = bind(DEFAULT_CONTROLS, 'torch', 'KeyY');
  assert.deepEqual(bind(moved, 'torch', 'KeyT').keys, {});
  assert.equal(bind(moved, 'torch', 'Escape'), moved);
  assert.equal(bind(moved, 'torch', 'KeyY'), moved);
});

test('a long run of rebinding never leaves two actions on one key', () => {
  let s = DEFAULT_CONTROLS;
  const codes = ['KeyJ', 'KeyK', 'KeyW', 'KeyA', 'ShiftLeft', 'Space', 'KeyJ', 'KeyT', 'Digit1', 'KeyW'];
  codes.forEach((code, i) => {
    s = bind(s, ACTIONS[(i * 7) % ACTIONS.length]!, code);
    const keys = Object.values(resolveKeys(s));
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(parseControls(JSON.stringify(s)), s, 'and what is kept reads back the same');
  });
});

test('keys are named the way a player reads them', () => {
  assert.equal(keyLabel('KeyG'), 'G');
  assert.equal(keyLabel('ShiftLeft'), 'Left Shift');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Numpad3'), 'Num 3');
  assert.equal(keyLabel('Slash'), '/');
  for (const a of ACTIONS) if (!['Space', 'Tab'].includes(DEFAULT_KEYS[a])) assert.notEqual(keyLabel(DEFAULT_KEYS[a]), DEFAULT_KEYS[a], `${a} has a label`);
});

test('tokens in a line of text become the player’s own keys', () => {
  const keys = resolveKeys(bind(DEFAULT_CONTROLS, 'trap', 'KeyJ'));
  assert.equal(withKeys('Press {trap} to aim, then {trap} to roll, or {trapHere}.', keys), 'Press J to aim, then J to roll, or Z.');
  assert.equal(withKeys('{sneak} sneaks', DEFAULT_KEYS), 'Left Shift sneaks');
  assert.equal(withKeys('{nothing} stays', DEFAULT_KEYS), '{nothing} stays');
  assert.equal(withKeys('no tokens', DEFAULT_KEYS), 'no tokens');
});

test('settings count as custom once anything differs from the defaults', () => {
  assert.equal(isCustom(DEFAULT_CONTROLS), false);
  assert.equal(isCustom({ ...DEFAULT_CONTROLS, turn: 1.25 }), true);
  assert.equal(isCustom({ ...DEFAULT_CONTROLS, smooth: true }), true);
  assert.equal(isCustom(bind(DEFAULT_CONTROLS, 'torch', 'KeyY')), true);
});

test('the double-tap dash is on unless it has been turned off, and turning it off counts as a custom setting', () => {
  assert.equal(parseControls({})!.dash, true);
  assert.equal(parseControls({ dash: false })!.dash, false);
  assert.equal(parseControls({ dash: 'no' })!.dash, true, 'only an explicit false turns it off');
  assert.equal(isCustom({ ...DEFAULT_CONTROLS, dash: false }), true);
  assert.deepEqual(parseControls(JSON.stringify({ ...DEFAULT_CONTROLS, dash: false })), { ...DEFAULT_CONTROLS, dash: false });
});

test('aim sensitivity restores old saves, clamps invalid values and persists independently', () => {
  assert.equal(parseControls({ turn: 1.5 })!.aim, 1);
  for (const value of [null, 'fast', NaN, Infinity]) assert.equal(parseControls({ aim: value })!.aim, 1);
  assert.equal(parseControls({ aim: -1 })!.aim, 0.25);
  assert.equal(parseControls({ aim: 8 })!.aim, 2);
  assert.equal(parseControls({ aim: 0.624 })!.aim, 0.6);
  const saved = { ...DEFAULT_CONTROLS, aim: 0.5 };
  assert.deepEqual(parseControls(JSON.stringify(saved)), saved);
  assert.equal(isCustom(saved), true);
  assert.equal(saved.turn, DEFAULT_CONTROLS.turn);
});

test('camera angle restores old saves, clamps invalid values and persists independently', () => {
  assert.equal(parseControls({ turn: 1.5 })!.camera, 47);
  for (const value of [null, 'high', NaN, Infinity]) assert.equal(parseControls({ camera: value })!.camera, 47);
  assert.equal(parseControls({ camera: 5 })!.camera, 28);
  assert.equal(parseControls({ camera: 90 })!.camera, 72);
  assert.equal(parseControls({ camera: 55.6 })!.camera, 56);
  const saved = { ...DEFAULT_CONTROLS, camera: 35 };
  assert.deepEqual(parseControls(JSON.stringify(saved)), saved);
  assert.equal(isCustom(saved), true);
  assert.equal(isCustom(DEFAULT_CONTROLS), false);
});

test('aiming has its own key, / by default, which no other action uses', () => {
  assert.equal(DEFAULT_KEYS.aim, 'Slash');
  assert.equal(Object.values(DEFAULT_KEYS).filter((k) => k === 'Slash').length, 1);
});
