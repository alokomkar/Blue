import test from 'node:test';
import assert from 'node:assert/strict';
import * as bp from './bunkerplan.ts';
import { KINDS } from './towerfurniture.ts';

// The Records Annex is a plan on the bunker engine (bunkerplan.ts's ANNEX_RAW). Each test of the file runs with it selected.
bp.selectBunkerPlan('annex');
const sizes = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));

test('the annex is three storeys, entered at the lowest and left at the top, inside its footprint', () => {
  assert.equal(bp.BUNKER_LEVELS, 3);
  assert.equal(bp.BUNKER_EXIT_LEVEL, 2);
  assert.equal(bp.BUNKER_LEVEL_NAMES.length, 3);
  assert.equal(bp.spaceAt(bp.BUNKER_START.x, bp.BUNKER_START.y)?.id, 'A');
  assert.equal(bp.levelOfCell(bp.BUNKER_START.x, bp.BUNKER_START.y), 0);
  assert.equal(bp.levelOfCell(bp.BUNKER_EXIT.x, bp.BUNKER_EXIT.y), bp.BUNKER_EXIT_LEVEL);
  for (const s of bp.BUNKER_SPACES) assert.ok(s.x0 >= 0 && s.y0 >= 0 && s.x1 < bp.BUNKER_COLS && s.y1 < bp.BUNKER_ROWS, `${s.id} is inside the footprint`);
});

test('no two spaces overlap on the plan, on any storey, and no stair is cut through a space', () => {
  const sp = bp.BUNKER_SPACES;
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
    const a = sp[i]!;
    const b = sp[j]!;
    assert.ok(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0, `${a.id} and ${b.id} overlap`);
  }
  for (const st of bp.BUNKER_STAIRS) assert.equal(bp.stairCells(st).filter((c) => bp.spaceAt(c.x, c.y)).length, 0, `${st.id} runs through a space`);
});

test('each stair opens onto a room below and a hall above, and the flights join every storey', () => {
  assert.deepEqual(bp.BUNKER_STAIRS.map((s) => [s.low, s.high]), [[0, 1], [1, 2]]);
  for (const st of bp.BUNKER_STAIRS) {
    const e = bp.stairEnds(st);
    for (const c of e.foot) { const s = bp.spaceAt(c.x, c.y)!; assert.ok(s && !s.hall && s.level === st.low, `${st.id} foot on ${s?.id}`); }
    for (const c of e.head) { const s = bp.spaceAt(c.x, c.y)!; assert.ok(s && s.hall && s.level === st.high, `${st.id} head on ${s?.id}`); }
  }
});

test('every space can be walked to on foot from where its storey is entered, and the exit and the stairs are reachable', () => {
  for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
    const walk = bp.walkableCells(l);
    for (const s of bp.spacesOn(l)) {
      let any = false;
      for (let y = s.y0; y <= s.y1 && !any; y++) for (let x = s.x0; x <= s.x1; x++) if (walk.has(`${x},${y}`)) { any = true; break; }
      assert.ok(any, `${s.id} on storey ${l} is cut off`);
    }
  }
  assert.ok(bp.walkableCells(bp.BUNKER_EXIT_LEVEL).has(`${bp.BUNKER_EXIT.x},${bp.BUNKER_EXIT.y}`) || bp.walkableCells(bp.BUNKER_EXIT_LEVEL).has(`${bp.BUNKER_EXIT.x - 1},${bp.BUNKER_EXIT.y}`), 'the lift is reachable');
  for (const st of bp.BUNKER_STAIRS) for (const c of bp.stairEnds(st).foot) assert.ok(bp.walkableCells(st.low).has(`${c.x},${c.y}`), `${st.id}'s foot is reachable`);
});

test('every storey has a clue system, guards, cameras, and the upper two have containers a dossier can be in', () => {
  for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
    assert.ok(bp.clueOn(l), `storey ${l} has a clue system`);
    assert.equal(bp.postsOn(l).length, 2);
    assert.ok(bp.patrolsOn(l).length >= 1);
    assert.ok(bp.camerasOn(l).length >= 3);
  }
  assert.deepEqual(bp.BUNKER_STATIONS.map((s) => s.title).length, bp.BUNKER_STATIONS.length);
  assert.ok(bp.openContainers(1, sizes, 'campus').length >= 4);
  assert.ok(bp.openContainers(2, sizes, 'campus').length >= 4);
});

test('the annex does not change the Sump: selecting it back gives the old plan', () => {
  bp.selectBunkerPlan('sump');
  assert.equal(bp.BUNKER_LEVELS, 4);
  assert.equal(bp.BUNKER_COLS, 28);
  bp.selectBunkerPlan('annex');
  assert.equal(bp.BUNKER_LEVELS, 3);
});

test('the stacks and the sorting room have banks that slide, each with a free aisle to slide into and its wheel end reachable', () => {
  const banks: Array<{ level: number; room: string }> = [];
  for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
    const furnished = bp.furnishedCells(l);
    const clear = bp.clearCells(l);
    const walk = bp.walkableCells(l);
    for (const p of bp.bunkerPieces(sizes, 'campus', l)) {
      if (p.kind !== 'bank') continue;
      assert.ok(p.slide, 'a bank knows how it slides');
      const along = p.yaw === 0;
      const x = Math.round(p.cx / 4 - (along ? 0.5 : 0));
      const y = Math.round(p.cz / 4 - (along ? 0 : 0.5));
      const cells = [{ x, y }, along ? { x: x + 1, y } : { x, y: y + 1 }];
      const room = bp.spaceAt(x, y)!;
      banks.push({ level: l, room: room.id });
      assert.equal(room.level, l);
      assert.ok(['Z2', 'Z3'].includes(room.id), `a bank in ${room.id}`);
      assert.ok(along ? p.slide.dx === 0 : p.slide.dy === 0, 'it slides across its length');
      for (const c of cells) {
        const t = `${c.x + p.slide.dx},${c.y + p.slide.dy}`;
        assert.ok(!furnished.has(t) && !clear.has(t), `${t} is a free aisle cell`);
        assert.equal(bp.spaceAt(c.x + p.slide.dx, c.y + p.slide.dy)?.id, room.id, 'and in the same room');
      }
      const door = along ? { x: x + 2, y } : { x, y: y - 1 };
      assert.ok(walk.has(`${door.x},${door.y}`), 'its wheel end can be walked to');
    }
  }
  assert.ok(banks.length >= 3, `banks: ${banks.length}`);
  assert.ok(banks.every((b) => b.level === 1), 'they are on the stacks storey');
  assert.ok(new Set(banks.map((b) => b.room)).size >= 1);
});

test('a bank is not a container: the dossier is never in one, and none of them can be climbed', () => {
  for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
    const ids = new Set(bp.containersOn(l, sizes, 'campus').map((c) => `${c.cx},${c.cz}`));
    for (const p of bp.bunkerPieces(sizes, 'campus', l)) if (p.kind === 'bank') assert.ok(!ids.has(`${p.cx},${p.cz}`));
  }
  assert.equal(KINDS.bank.roof, undefined);
});
