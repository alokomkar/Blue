import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKLOG_MS, EMPTY_TOASTS, MAX_QUEUE, clearToasts, expireToast, pushToast, visibleCap, type ToastState } from './toasts.ts';

const push = (s: ToastState, text: string, kind: 'good' | 'bad' | 'neutral' = 'neutral', ms = 7000, cap = 2) => pushToast(s, text, kind, ms, cap);

test('a phone upright shows two at a time, sideways one, a big screen three', () => {
  assert.equal(visibleCap(true), 2);
  assert.equal(visibleCap(false), 3);
  assert.equal(visibleCap(true, true), 1);
});

test('notices show while there is room, then wait in line instead of piling up', () => {
  let s = EMPTY_TOASTS;
  const shown: string[] = [];
  for (const t of ['a', 'b', 'c', 'd']) {
    const c = push(s, t);
    s = c.state;
    shown.push(...c.show.map((x) => x.text));
  }
  assert.deepEqual(shown, ['a', 'b']);
  assert.deepEqual(s.shown.map((t) => t.text), ['a', 'b']);
  assert.deepEqual(s.queue.map((t) => t.text), ['c', 'd']);
});

test('the same words are never up twice, shown or waiting', () => {
  let s = push(EMPTY_TOASTS, 'a').state;
  s = push(s, 'b').state;
  s = push(s, 'c').state;
  const again = push(s, 'a');
  assert.equal(again.state, s);
  assert.deepEqual(again.show, []);
  assert.equal(push(s, 'c').state, s, 'one already waiting');
});

test('when one runs out the next in line takes its place, a little shorter when more wait behind it', () => {
  let s = EMPTY_TOASTS;
  for (const t of ['a', 'b', 'c', 'd', 'e']) s = push(s, t).state;
  const first = s.shown[0]!;
  const c = expireToast(s, first.id, 2);
  assert.deepEqual(c.show.map((t) => t.text), ['c']);
  assert.equal(c.show[0]!.ms, BACKLOG_MS, 'there are two more behind it');
  // The last one waiting keeps its full time.
  let t = c.state;
  t = expireToast(t, t.shown[0]!.id, 2).state;
  const last = expireToast(t, t.shown[0]!.id, 2);
  assert.equal(last.show[0]!.text, 'e');
  assert.equal(last.show[0]!.ms, 7000);
});

test('a warning jumps the line by pushing the oldest ordinary notice off', () => {
  let s = push(EMPTY_TOASTS, 'a').state;
  s = push(s, 'b').state;
  const c = push(s, 'SPOTTED', 'bad', 3000);
  assert.deepEqual(c.hide.map((t) => t.text), ['a']);
  assert.deepEqual(c.show.map((t) => t.text), ['SPOTTED']);
  assert.deepEqual(c.state.shown.map((t) => t.text), ['b', 'SPOTTED']);
  // With only warnings up, the oldest of them gives way.
  let w = push(EMPTY_TOASTS, 'w1', 'bad').state;
  w = push(w, 'w2', 'bad').state;
  const d = push(w, 'w3', 'bad');
  assert.deepEqual(d.hide.map((t) => t.text), ['w1']);
});

test('the line is only so long: the oldest waiting notice is dropped past it', () => {
  let s = EMPTY_TOASTS;
  for (let i = 0; i < 2 + MAX_QUEUE + 3; i++) s = push(s, `n${i}`).state;
  assert.equal(s.queue.length, MAX_QUEUE);
  assert.equal(s.queue[0]!.text, 'n5');
  assert.equal(s.queue.at(-1)!.text, `n${2 + MAX_QUEUE + 2}`);
});

test('a tap clears what is up and what is waiting', () => {
  let s = EMPTY_TOASTS;
  for (const t of ['a', 'b', 'c']) s = push(s, t).state;
  const c = clearToasts(s);
  assert.deepEqual(c.hide.map((t) => t.text), ['a', 'b']);
  assert.deepEqual(c.state.shown, []);
  assert.deepEqual(c.state.queue, []);
  assert.equal(c.state.nextId, s.nextId, 'ids keep counting');
});

import { EMPTY_INBOX, INBOX_MAX, addToInbox, ageLabel, markAllRead, unreadCount } from './toasts.ts';

test('the inbox keeps notices newest first, counts the unread, and clears the count when opened', () => {
  let box = addToInbox(EMPTY_INBOX, 'first', 'neutral', 1000);
  box = addToInbox(box, 'second', 'good', 2000);
  assert.deepEqual(box.items.map((i) => i.text), ['second', 'first']);
  assert.equal(unreadCount(box), 2);
  const read = markAllRead(box);
  assert.equal(unreadCount(read), 0);
  assert.equal(markAllRead(read), read, 'nothing to mark: the same inbox');
  const later = addToInbox(read, 'third', 'bad', 3000);
  assert.equal(unreadCount(later), 1);
  assert.equal(later.items[0]!.read, false);
});

test('a repeat of the newest notice is not added, but an older one coming round again is', () => {
  let box = addToInbox(EMPTY_INBOX, 'a', 'neutral', 0);
  assert.equal(addToInbox(box, 'a', 'neutral', 5), box);
  box = addToInbox(box, 'b', 'neutral', 10);
  assert.equal(addToInbox(box, 'a', 'neutral', 20).items.length, 3);
});

test('the inbox is only so long, and ages read in a word or two', () => {
  let box = EMPTY_INBOX;
  for (let i = 0; i < INBOX_MAX + 7; i++) box = addToInbox(box, `n${i}`, 'neutral', i);
  assert.equal(box.items.length, INBOX_MAX);
  assert.equal(box.items[0]!.text, `n${INBOX_MAX + 6}`);
  assert.equal(ageLabel(2000), 'now');
  assert.equal(ageLabel(12_000), '12 s');
  assert.equal(ageLabel(190_000), '3 min');
  assert.equal(ageLabel(-5), 'now');
});
