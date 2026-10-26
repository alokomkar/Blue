import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_BEAMS, POSTURE_HEIGHT, PULSE_OFF_S, PULSE_ON_S, PULSE_PERIOD_S, gateBlocks, gateHits, placeGates, pulseState, type Gate } from './evade.ts';
import type { MazeCells } from './maze.ts';

const CELL = 6;

test('a duck gate is cleared crouched or flat, a crawl gate only flat, and a standing agent is stopped by both', () => {
  assert.equal(gateBlocks('duck', 0, 0, 'stand'), true);
  assert.equal(gateBlocks('duck', 0, 0, 'crouch'), false);
  assert.equal(gateBlocks('duck', 0, 0, 'prone'), false);
  assert.equal(gateBlocks('crawl', 0, 0, 'stand'), true);
  assert.equal(gateBlocks('crawl', 0, 0, 'crouch'), true);
  assert.equal(gateBlocks('crawl', 0, 0, 'prone'), false);
});

test('the beams are set so each posture clears what it should and no other', () => {
  assert.ok(POSTURE_HEIGHT.crouch < GATE_BEAMS.duck[0]! && POSTURE_HEIGHT.stand > GATE_BEAMS.duck[0]!);
  assert.ok(POSTURE_HEIGHT.prone < GATE_BEAMS.crawl[0]! && POSTURE_HEIGHT.crouch > GATE_BEAMS.crawl[0]!);
});

test('a pulse is on, then off, then flickers before it comes back, whatever you are doing', () => {
  assert.deepEqual(pulseState(0, 0), { on: true, warn: false });
  assert.deepEqual(pulseState(0, PULSE_ON_S + 0.1), { on: false, warn: false });
  assert.deepEqual(pulseState(0, PULSE_PERIOD_S - 0.1), { on: false, warn: true });
  assert.deepEqual(pulseState(0, PULSE_PERIOD_S + 0.1), { on: true, warn: false });
  for (const posture of ['stand', 'crouch', 'prone'] as const) {
    assert.equal(gateBlocks('pulse', 0, 0.2, posture), true);
    assert.equal(gateBlocks('pulse', 0, PULSE_ON_S + PULSE_OFF_S / 2, posture), false);
  }
  // The gap is long enough to walk through (a cell at a walk is about a second).
  assert.ok(PULSE_OFF_S >= 1.5);
});

test('a gate only has someone in its plane, in its corridor', () => {
  // Corridor runs north-south through cell (2, 3): beams run along x, the way through is z.
  const g: Gate = { x: 2, y: 3, spanX: true, kind: 'duck', phase: 0 };
  const cx = 2 * CELL;
  const cz = 3 * CELL;
  assert.equal(gateHits(g, 0, cx, cz, CELL, 0.35, 'stand'), true);
  assert.equal(gateHits(g, 0, cx, cz, CELL, 0.35, 'crouch'), false);
  assert.equal(gateHits(g, 0, cx, cz + 1.5, CELL, 0.35, 'stand'), false, 'a step short of it');
  assert.equal(gateHits(g, 0, cx + CELL, cz, CELL, 0.35, 'stand'), false, 'another corridor');
  // The other way round: a corridor along x, the way through is x.
  const h: Gate = { ...g, spanX: false };
  assert.equal(gateHits(h, 0, cx + 0.1, cz + 0.2, CELL, 0.35, 'stand'), true);
  assert.equal(gateHits(h, 0, cx + 2, cz, CELL, 0.35, 'stand'), false);
});

function corridor(cols: number, rows: number): MazeCells {
  // Every cell a straight east-west corridor except the first and last of each row (one opening).
  return Array.from({ length: rows }, () => Array.from({ length: cols }, (_, x) => ({ N: false, S: false, E: x < cols - 1, W: x > 0 })));
}

test('gates go only in straight cells, apart from one another, off the start and the reserved cells', () => {
  const cols = 12;
  const rows = 6;
  const cells = corridor(cols, rows);
  const dist = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => x + y));
  const used = new Set<string>(['5,2']);
  const gates = placeGates(cells, cols, rows, dist, used, 6);
  assert.ok(gates.length >= 3);
  for (const g of gates) {
    assert.ok(g.x > 0 && g.x < cols - 1, 'a dead end is not straight through');
    assert.ok(dist[g.y]![g.x]! >= 2);
    assert.equal(g.spanX, false);
    assert.ok(used.has(`${g.x},${g.y}`));
  }
  assert.ok(!gates.some((g) => g.x === 5 && g.y === 2));
  for (let i = 0; i < gates.length; i++) for (let j = i + 1; j < gates.length; j++) assert.ok(Math.abs(gates[i]!.x - gates[j]!.x) + Math.abs(gates[i]!.y - gates[j]!.y) >= 3);
});

test('the kinds asked for are the kinds dealt, in a mix', () => {
  const cols = 14;
  const rows = 8;
  const cells = corridor(cols, rows);
  const dist = Array.from({ length: rows }, () => Array.from({ length: cols }, (_, x) => x + 3));
  const gates = placeGates(cells, cols, rows, dist, new Set(), 6, ['duck', 'pulse']);
  assert.ok(gates.every((g) => g.kind !== 'crawl'));
  assert.ok(new Set(gates.map((g) => g.kind)).size === 2);
  assert.deepEqual(placeGates(cells, cols, rows, dist, new Set(), 0), []);
});
