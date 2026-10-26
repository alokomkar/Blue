import test from 'node:test';
import assert from 'node:assert/strict';
import * as bp from './bunkerplan.ts';
import { KINDS } from './towerfurniture.ts';

// Every first level built on the stacks engine (the annex, the store, the depot) obeys the same rules. Each runs with its plan selected.
const sizes = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));
const PLACE: Record<string, string> = { annex: 'campus', store: 'museum', depot: 'bank' };

for (const id of ['annex', 'store', 'depot'] as const) {
  test(`${id}: three storeys, entered at the lowest in the arrival room and left at the top, inside the footprint`, () => {
    bp.selectBunkerPlan(id);
    assert.equal(bp.BUNKER_LEVELS, 3);
    assert.equal(bp.BUNKER_EXIT_LEVEL, 2);
    assert.equal(bp.spaceAt(bp.BUNKER_START.x, bp.BUNKER_START.y)?.id, 'A');
    assert.equal(bp.levelOfCell(bp.BUNKER_START.x, bp.BUNKER_START.y), 0);
    assert.equal(bp.levelOfCell(bp.BUNKER_EXIT.x, bp.BUNKER_EXIT.y), 2);
    for (const s of bp.BUNKER_SPACES) assert.ok(s.x0 >= 0 && s.y0 >= 0 && s.x1 < bp.BUNKER_COLS && s.y1 < bp.BUNKER_ROWS, `${s.id} is inside the footprint`);
  });

  test(`${id}: no two spaces overlap on the plan, no stair runs through one, and each opens onto a room below and a hall above`, () => {
    bp.selectBunkerPlan(id);
    const sp = bp.BUNKER_SPACES;
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      const a = sp[i]!;
      const b = sp[j]!;
      assert.ok(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0, `${a.id} and ${b.id} overlap`);
    }
    for (const st of bp.BUNKER_STAIRS) {
      assert.equal(bp.stairCells(st).filter((c) => bp.spaceAt(c.x, c.y)).length, 0, `${st.id} runs through a space`);
      for (const c of bp.stairEnds(st).foot) { const s = bp.spaceAt(c.x, c.y)!; assert.ok(s && !s.hall && s.level === st.low, `${st.id} foot on ${s?.id}`); }
      for (const c of bp.stairEnds(st).head) { const s = bp.spaceAt(c.x, c.y)!; assert.ok(s && s.hall && s.level === st.high, `${st.id} head on ${s?.id}`); }
    }
  });

  test(`${id}: every space can be walked to from where its storey is entered, and the stairs and the lift are reachable`, () => {
    bp.selectBunkerPlan(id);
    for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
      const walk = bp.walkableCells(l);
      for (const s of bp.spacesOn(l)) {
        let any = false;
        for (let y = s.y0; y <= s.y1 && !any; y++) for (let x = s.x0; x <= s.x1; x++) if (walk.has(`${x},${y}`)) { any = true; break; }
        assert.ok(any, `${s.id} on storey ${l} is cut off`);
      }
    }
    for (const st of bp.BUNKER_STAIRS) for (const c of bp.stairEnds(st).foot) assert.ok(bp.walkableCells(st.low).has(`${c.x},${c.y}`), `${st.id}'s foot is reachable`);
    const top = bp.walkableCells(2);
    assert.ok(top.has(`${bp.BUNKER_EXIT.x},${bp.BUNKER_EXIT.y}`) || top.has(`${bp.BUNKER_EXIT.x - 1},${bp.BUNKER_EXIT.y}`) || top.has(`${bp.BUNKER_EXIT.x},${bp.BUNKER_EXIT.y - 1}`), 'the lift is reachable');
  });

  test(`${id}: every storey has a clue system, two sentries, patrols and cameras, and the top storey has containers for the dossier`, () => {
    bp.selectBunkerPlan(id);
    for (let l = 0; l < bp.BUNKER_LEVELS; l++) {
      assert.ok(bp.clueOn(l), `storey ${l} has a clue system`);
      assert.equal(bp.postsOn(l).length, 2, `storey ${l} sentries`);
      assert.ok(bp.patrolsOn(l).length >= 1, `storey ${l} patrols`);
      assert.ok(bp.camerasOn(l).length >= 3, `storey ${l} cameras`);
    }
    assert.ok(bp.openContainers(2, sizes, PLACE[id]!).length >= 3, 'containers on the top storey');
    assert.equal(bp.BUNKER_STATIONS.length >= 6, true);
  });
}

test('the Sump comes back when it is selected again', () => {
  bp.selectBunkerPlan('depot');
  bp.selectBunkerPlan('sump');
  assert.equal(bp.BUNKER_LEVELS, 4);
  assert.equal(bp.BUNKER_COLS, 28);
});
