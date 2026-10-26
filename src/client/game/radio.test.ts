import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_AT_MISS, CHECK_MAX_S, CHECK_MIN_S, DEAD_ZONE_RETRY_S, FIRST_MAX_S, FIRST_MIN_S, JAM_LINE, RESTORED_LINE, Radio, pickDispatch, reportLine, unit, type RadioEvent, type RadioGuard } from './radio.ts';

const guard = (id: number, o: Partial<RadioGuard> = {}): RadioGuard => ({ id, x: id * 4, z: 0, active: true, deadZone: false, sentry: false, canDispatch: true, known: false, ...o });

/** Runs `seconds` of radio time in 0.1 s frames, calling `edit` before each so a test can change the guards, and collects what was said. */
function run(radio: Radio, guards: RadioGuard[], seconds: number, o: { jammed?: () => boolean; edit?: (t: number) => void } = {}): RadioEvent[] {
  const out: RadioEvent[] = [];
  const frames = Math.round(seconds * 10);
  for (let i = 0; i < frames; i++) {
    o.edit?.(radio.time);
    out.push(...radio.step(0.1, guards, o.jammed?.() ?? false));
  }
  return out;
}

test('the same inputs give the same draw, and different ones differ', () => {
  assert.equal(unit(7, 1, 2), unit(7, 1, 2));
  assert.notEqual(unit(7, 1, 2), unit(7, 2, 1));
  assert.notEqual(unit(7, 1, 2), unit(8, 1, 2));
  for (let i = 0; i < 200; i++) {
    const u = unit(123, i, i * 3);
    assert.ok(u >= 0 && u < 1);
  }
});

test('every guard reports in every 30 to 45 seconds, the first anywhere from 8 to 45', () => {
  const guards = [guard(1), guard(2), guard(3), guard(4)];
  const r2 = new Radio(99);
  const stamps = new Map<number, number[]>();
  for (let i = 0; i < 2000; i++) for (const e of r2.step(0.1, guards, false)) if (e.type === 'report') stamps.set(e.id, [...(stamps.get(e.id) ?? []), r2.time]);
  assert.equal(stamps.size, 4, 'all four spoke');
  for (const [, ts] of stamps) {
    assert.ok(ts[0]! >= FIRST_MIN_S - 0.11 && ts[0]! <= FIRST_MAX_S + 0.11, `first ${ts[0]}`);
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i]! - ts[i - 1]!;
      assert.ok(gap >= CHECK_MIN_S - 0.11 && gap <= CHECK_MAX_S + 0.11, `gap ${gap}`);
    }
    assert.ok(ts.length >= 4);
  }
});

test('the guards do not all speak together', () => {
  const radio = new Radio(5);
  const guards = Array.from({ length: 8 }, (_, i) => guard(i + 1));
  const firsts = new Set<number>();
  const seen = new Set<number>();
  for (let i = 0; i < 500; i++) for (const e of radio.step(0.1, guards, false)) if (e.type === 'report' && !seen.has(e.id)) { seen.add(e.id); firsts.add(Math.round(radio.time)); }
  assert.ok(firsts.size >= 5, `first reports spread over ${firsts.size} different seconds`);
});

test('a seed gives the same floor the same chatter, in the same order, twice', () => {
  const play = (seed: number): string[] => {
    const radio = new Radio(seed);
    const guards = [guard(1), guard(2, { sentry: true }), guard(3)];
    const log: string[] = [];
    for (let i = 0; i < 1500; i++) for (const e of radio.step(0.1, guards, false)) log.push(`${radio.time.toFixed(1)} ${e.type === 'report' ? e.line : e.type}`);
    return log;
  };
  assert.deepEqual(play(42), play(42));
  assert.notDeepEqual(play(42), play(43));
});

test('a report reads as a channel and a few words; a sentry has its own', () => {
  assert.match(reportLine(1, 3, 1, false), /^CH 3: [a-z ]+$/);
  assert.match(reportLine(1, 12, 5, true), /^CH 12: (post|eyes|holding)/);
});

test('a guard that goes down misses its next check-in: the two nearest others are sent to where it fell', () => {
  const radio = new Radio(1);
  const guards = [guard(1, { x: 10, z: 10 }), guard(2, { x: 14, z: 10 }), guard(3, { x: 30, z: 10 }), guard(4, { x: 12, z: 10 }), guard(5, { x: 8, z: 10, sentry: true, canDispatch: false })];
  run(radio, guards, 2);
  guards[0]!.active = false; // down at its spot
  const events = run(radio, guards, 50);
  const miss = events.find((e) => e.type === 'miss' && e.n === 1);
  assert.ok(miss && miss.type === 'miss');
  assert.equal(miss.id, 1);
  assert.deepEqual(miss.at, { x: 10, z: 10 });
  assert.deepEqual(miss.candidates.slice(0, 2), [4, 2], 'nearest first, never the dead one, never one that cannot go');
  assert.ok(!miss.candidates.includes(1) && !miss.candidates.includes(5));
  assert.match(miss.line, /NO ANSWER · 2 UNITS SENT/);
});

test('the last place it spoke from is where they go, not where its body was moved to', () => {
  const radio = new Radio(1);
  const g1 = guard(1, { x: 5, z: 5 });
  const guards = [g1, guard(2, { x: 20, z: 5 })];
  run(radio, guards, 3);
  g1.active = false;
  g1.x = 40; // carried off
  const miss = run(radio, guards, 50).find((e) => e.type === 'miss');
  assert.ok(miss && miss.type === 'miss');
  assert.deepEqual(miss.at, { x: 5, z: 5 });
});

test('the second miss raises the alert, and after that it is not asked after', () => {
  const radio = new Radio(2);
  const guards = [guard(1), guard(2)];
  run(radio, guards, 1);
  guards[0]!.active = false;
  const events = run(radio, guards, 200).filter((e) => e.type === 'miss');
  assert.equal(events.length, ALERT_AT_MISS, 'one dispatch, one alert, then silence');
  const [first, second] = events as Array<Extract<RadioEvent, { type: 'miss' }>>;
  assert.equal(first!.n, 1);
  assert.equal(second!.n, 2);
  assert.ok(first!.candidates.length > 0);
  assert.deepEqual(second!.candidates, []);
  assert.match(second!.line, /STILL SILENT · ALERT RAISED/);
  assert.equal(radio.dueOf(1), null);
});

test('the clock the second miss gives is a normal check-in interval', () => {
  const radio = new Radio(3);
  const guards = [guard(1), guard(2)];
  guards[0]!.active = false;
  const times: number[] = [];
  for (let i = 0; i < 2000; i++) for (const e of radio.step(0.1, guards, false)) if (e.type === 'miss') times.push(radio.time);
  assert.equal(times.length, 2);
  const gap = times[1]! - times[0]!;
  assert.ok(gap >= CHECK_MIN_S - 0.2 && gap <= CHECK_MAX_S + 0.2, `second miss ${gap} s after the first`);
});

test('a guard whose body was found is not missed: the control room knows', () => {
  const radio = new Radio(2);
  const guards = [guard(1), guard(2)];
  run(radio, guards, 1);
  guards[0]!.active = false;
  guards[0]!.known = true;
  assert.equal(run(radio, guards, 200).filter((e) => e.type === 'miss').length, 0);
});

test('a guard that keeps reporting never misses', () => {
  const radio = new Radio(4);
  const guards = [guard(1), guard(2)];
  assert.equal(run(radio, guards, 300).filter((e) => e.type === 'miss').length, 0);
});

test('an EMP jam stops the clock: nothing is said, nothing is missed, and it resumes where it left off', () => {
  const radio = new Radio(1);
  const guards = [guard(1), guard(2), guard(3)];
  run(radio, guards, 1);
  guards[0]!.active = false;
  const before = radio.time;
  let jam = true;
  const events = run(radio, guards, 120, { jammed: () => jam });
  assert.equal(radio.time, before, 'no radio time ran');
  assert.deepEqual(events.map((e) => e.type), ['jam']);
  assert.equal(events[0]!.type === 'jam' && events[0].line, JAM_LINE);
  jam = false;
  const after = run(radio, guards, 60, { jammed: () => jam });
  assert.equal(after[0]!.type, 'restored');
  assert.equal(after[0]!.type === 'restored' && after[0].line, RESTORED_LINE);
  assert.ok(after.some((e) => e.type === 'miss' && e.n === 1), 'the silence is noticed once the radio is back');
});

test('a jam silences the length of the jam: the miss comes that much later', () => {
  const missAt = (jamS: number): number => {
    const radio = new Radio(7);
    const guards = [guard(1), guard(2)];
    guards[0]!.active = false;
    let wall = 0;
    for (let i = 0; i < 4000; i++) {
      const jammed = wall >= 5 && wall < 5 + jamS;
      wall += 0.1;
      if (radio.step(0.1, guards, jammed).some((e) => e.type === 'miss')) return wall;
    }
    return -1;
  };
  const plain = missAt(0);
  const jammed = missAt(20);
  assert.ok(plain > 0 && jammed > 0);
  assert.ok(Math.abs(jammed - plain - 20) < 0.3, `${jammed} vs ${plain}`);
});

test('a guard in a blackout is not heard and not missed, and is asked again shortly', () => {
  const radio = new Radio(6);
  const guards = [guard(1, { deadZone: true }), guard(2)];
  const events = run(radio, guards, 200);
  assert.ok(!events.some((e) => (e.type === 'report' || e.type === 'miss') && e.id === 1), 'nothing from or about it');
  guards[0]!.deadZone = false;
  const after = run(radio, guards, DEAD_ZONE_RETRY_S + 0.5);
  assert.ok(after.some((e) => e.type === 'report' && e.id === 1), 'it speaks as soon as it is out of the dark');
});

test('a guard downed in a blackout is not missed until it is out of the dead zone', () => {
  const radio = new Radio(6);
  const guards = [guard(1, { deadZone: true, active: false }), guard(2), guard(3)];
  assert.ok(!run(radio, guards, 200).some((e) => e.type === 'miss'));
  guards[0]!.deadZone = false; // the body is dragged out into the light
  assert.ok(run(radio, guards, 10).some((e) => e.type === 'miss' && e.n === 1));
});

test('dispatch picks the nearest guards, ties by id, and skips the silent one', () => {
  const guards = [guard(1, { x: 0 }), guard(2, { x: 3 }), guard(3, { x: 3 }), guard(4, { x: 9 }), guard(5, { x: 1, active: false })];
  assert.deepEqual(pickDispatch(guards, { x: 0, z: 0 }, 1), [2, 3, 4]);
});

test('channels are numbered in the order guards are first heard of', () => {
  const radio = new Radio(1);
  radio.step(0.1, [guard(7), guard(3)], false);
  assert.equal(radio.channelOf(7), 1);
  assert.equal(radio.channelOf(3), 2);
  radio.step(0.1, [guard(7), guard(3), guard(9)], false);
  assert.equal(radio.channelOf(9), 3);
  assert.equal(radio.channelOf(4), null);
});
