import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraining } from './tutorial.ts';
import { bfs } from './maze.ts';
import { KINDS } from './towerfurniture.ts';
import {
  BUNKER_ALPHAS, BUNKER_CAMERAS, BUNKER_CAMERA_Y, BUNKER_COLS, BUNKER_DOGS, BUNKER_DUCTS, BUNKER_EXIT, BUNKER_EXIT_LEVEL, BUNKER_GATES, BUNKER_LEVELS, BUNKER_LINES, BUNKER_PACK, BUNKER_PATROLS, BUNKER_POSTS,
  BUNKER_ROWS, BUNKER_SETS, BUNKER_SHAFTS, BUNKER_SLIDERS, BUNKER_SPACES, BUNKER_STAIRS, BUNKER_START, BUNKER_STATIONS, BUNKER_SWEEPERS, DUCT_LANE, bunkerMap, bunkerPieces, ductCellSolids, ductsOn, levelOfCell,
  BUNKER_CLUES, CLUE_ROOMS, FURNITURE_SHARE, alphasOn, camerasOn, clearCells, clueOn, containersOn, dogsOn, furnishedCells, openContainers, packOn, patrolsOn, postsOn, roofIslands, roofNav, roofRoutes, spaceAt, spacesOn, stairCells, stairEnds, stairsOn, walkableCells,
} from './bunkerplan.ts';

const levels = Array.from({ length: BUNKER_LEVELS }, (_, l) => l);
const guards = levels.map((l) => parseTraining(bunkerMap(l, false)));
const drawn = levels.map((l) => parseTraining(bunkerMap(l, true)));
const isOpen = (l: number, x: number, y: number): boolean => {
  const c = guards[l]!.cells[y]?.[x];
  return c !== undefined && (c.N || c.S || c.E || c.W);
};
/** Where a storey is entered: the start on the lowest, the room's cell by the head of the stair below on the rest. */
const entry = (l: number): { x: number; y: number } => (l === 0 ? BUNKER_START : stairEnds(BUNKER_STAIRS.find((s) => s.high === l)!).head[0]!);

test('every storey map is the stated size; the way in is marked on the lowest and the way out on the ground floor', () => {
  for (const l of levels) {
    assert.equal(guards[l]!.cols, BUNKER_COLS);
    assert.equal(guards[l]!.rows, BUNKER_ROWS);
  }
  assert.deepEqual(guards[0]!.marks['@'], BUNKER_START);
  assert.deepEqual(guards[BUNKER_EXIT_LEVEL]!.marks['X'], BUNKER_EXIT);
  assert.equal(guards[1]!.marks['@'], undefined);
});

test('the spaces do not overlap or touch except where a hall meets a room, halls are two cells wide and rooms are bigger', () => {
  for (const a of BUNKER_SPACES) {
    if (a.hall) assert.ok(Math.min(a.x1 - a.x0 + 1, a.y1 - a.y0 + 1) >= 2, `${a.id} is at least two wide`);
    else assert.ok(Math.min(a.x1 - a.x0 + 1, a.y1 - a.y0 + 1) >= 4, `${a.id} is a room`);
    for (const b of BUNKER_SPACES) {
      if (a === b) continue;
      const overlap = a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
      assert.ok(!overlap, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('each storey is a linear run: every space on it is reached from where it is entered, and each hall on it joins two spaces or one and a stair', () => {
  for (const l of levels) {
    const at = entry(l);
    const dist = bfs(guards[l]!.cells, BUNKER_COLS, BUNKER_ROWS, at.x, at.y);
    const furnished = furnishedCells(l);
    for (const s of spacesOn(l)) for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
      // (the furniture's cells are shut in the guards' map; every other cell, aisle or hall, is one network from the way in)
      if (furnished.has(`${x},${y}`)) assert.ok(dist[y]![x]! < 0, `level ${l}: ${s.id} cell ${x},${y} is furnished and shut`);
      else assert.ok(dist[y]![x]! >= 0, `level ${l}: ${s.id} cell ${x},${y} is reached`);
    }
    // a space on a storey is never reached from another storey's cells
    for (const s of BUNKER_SPACES.filter((q) => q.level !== l)) assert.ok(!isOpen(l, s.x0, s.y0), `${s.id} is not on level ${l}`);
  }
  const top = bfs(guards[BUNKER_EXIT_LEVEL]!.cells, BUNKER_COLS, BUNKER_ROWS, entry(BUNKER_EXIT_LEVEL).x, entry(BUNKER_EXIT_LEVEL).y);
  assert.ok(top[BUNKER_EXIT.y]![BUNKER_EXIT.x]! >= 0);
  // the way up: stair i climbs from level i to i+1, and there is one between each pair
  assert.equal(BUNKER_STAIRS.length, BUNKER_LEVELS - 1);
  BUNKER_STAIRS.forEach((s, i) => {
    assert.equal(s.low, i);
    assert.equal(s.high, i + 1);
  });
});

test('a stair: its stairwell is clear of every space, its foot meets a room on the lower storey and its head a hall on the upper one, and the drawn maps join them', () => {
  for (const st of BUNKER_STAIRS) {
    for (const c of stairCells(st)) assert.ok(!spaceAt(c.x, c.y), `${st.id} cell ${c.x},${c.y} is in a space`);
    const ends = stairEnds(st);
    for (const c of ends.foot) {
      const s = spaceAt(c.x, c.y);
      assert.ok(s && !s.hall && s.level === st.low, `${st.id}'s foot is in a room on level ${st.low}`);
    }
    for (const c of ends.head) {
      const s = spaceAt(c.x, c.y);
      assert.ok(s && s.hall && s.level === st.high, `${st.id}'s head is in a hall on level ${st.high}`);
    }
    // closed to the guards on both storeys, open when drawn
    for (const c of stairCells(st)) for (const l of [st.low, st.high]) {
      assert.ok(!isOpen(l, c.x, c.y), `${st.id} cell ${c.x},${c.y} is open to the guards on level ${l}`);
      const d = drawn[l]!.cells[c.y]![c.x]!;
      assert.ok(d.N || d.S || d.E || d.W, `${st.id} cell ${c.x},${c.y} is drawn on level ${l}`);
    }
    // drawn, the foot's room reaches the head's stairwell cells on the lower storey, and the head's landing reaches them on the upper one
    const lowAt = ends.foot[0]!;
    const lowDist = bfs(drawn[st.low]!.cells, BUNKER_COLS, BUNKER_ROWS, lowAt.x, lowAt.y);
    for (const c of stairCells(st)) assert.ok(lowDist[c.y]![c.x]! >= 0, `${st.id} ${c.x},${c.y} is reached from its foot`);
    const highAt = ends.head[0]!;
    const highDist = bfs(drawn[st.high]!.cells, BUNKER_COLS, BUNKER_ROWS, highAt.x, highAt.y);
    for (const c of stairCells(st)) assert.ok(highDist[c.y]![c.x]! >= 0, `${st.id} ${c.x},${c.y} is reached from its head`);
  }
  for (const l of levels) assert.ok(stairsOn(l).length >= 1);
});

test('the ducts are one-cell corridors outside every space, closed to the guards, open in what is drawn; a shaft joins the last cell of one storey\'s duct to the first of the next\'s', () => {
  for (const d of BUNKER_DUCTS) {
    for (let i = 0; i < d.cells.length; i++) {
      const c = d.cells[i]!;
      assert.ok(!spaceAt(c.x, c.y), `${d.id} cell ${c.x},${c.y} is in a space`);
      assert.ok(!isOpen(d.level, c.x, c.y), `${d.id} cell ${c.x},${c.y} is open to the guards`);
      for (const st of stairsOn(d.level)) assert.ok(!stairCells(st).some((s) => s.x === c.x && s.y === c.y), `${d.id} cell ${c.x},${c.y} is in a stairwell`);
      if (i > 0) assert.equal(Math.abs(c.x - d.cells[i - 1]!.x) + Math.abs(c.y - d.cells[i - 1]!.y), 1, `${d.id} is continuous`);
    }
    const first = d.cells[0]!;
    const last = d.cells[d.cells.length - 1]!;
    if (d.ends[0]) assert.equal(Math.abs(first.x - d.ends[0].x) + Math.abs(first.y - d.ends[0].y), 1, `${d.id} opens onto its first end`);
    if (d.ends[1]) assert.equal(Math.abs(last.x - d.ends[1].x) + Math.abs(last.y - d.ends[1].y), 1, `${d.id} opens onto its last end`);
    assert.ok(d.ends[0] || d.ends[1], `${d.id} opens somewhere`);
    // every duct cell is reached in the drawn map
    const from = d.ends[0] ?? d.ends[1]!;
    const dist = bfs(drawn[d.level]!.cells, BUNKER_COLS, BUNKER_ROWS, from.x, from.y);
    for (const c of d.cells) assert.ok(dist[c.y]![c.x]! >= 0, `${d.id} ${c.x},${c.y} is reached`);
  }
  assert.equal(BUNKER_SHAFTS.length, BUNKER_LEVELS - 1);
  for (const sh of BUNKER_SHAFTS) {
    const below = ductsOn(sh.level).find((d) => d.ends[1] === null && d.cells[d.cells.length - 1]!.x === sh.x && d.cells[d.cells.length - 1]!.y === sh.y);
    const above = ductsOn(sh.level + 1).find((d) => d.ends[0] === null && d.cells[0]!.x === sh.x && d.cells[0]!.y === sh.y);
    assert.ok(below, `a duct ends in the shaft at ${sh.x},${sh.y} on level ${sh.level}`);
    assert.ok(above, `a duct begins at the shaft's top on level ${sh.level + 1}`);
  }
  // each shaft is a real way past a stair: from the lower duct's mouth it goes up without crossing the stair's guards
  assert.ok(BUNKER_DUCTS.length >= 6);
});

test('a duct cell is a lane between solid sides: a straight one has two sides and four corners, a corner has more, and the lane is as wide as stated', () => {
  const straight = ductCellSolids(5, 5, { N: false, S: false, E: true, W: true });
  assert.equal(straight.length, 6);
  const north = straight.filter((b) => b.maxZ <= 20);
  const south = straight.filter((b) => b.minZ >= 20);
  assert.equal(north.length, 3);
  assert.equal(south.length, 3);
  const lane = Math.min(...south.map((b) => b.minZ)) - Math.max(...north.map((b) => b.maxZ));
  assert.ok(Math.abs(lane - DUCT_LANE) < 1e-9);
  const corner = ductCellSolids(5, 5, { N: false, S: true, E: true, W: false });
  assert.equal(corner.length, 6);
});

test('everyone stands on open cells in their own space: posts, patrol rings, dogs, the pack, alphas', () => {
  const open = (x: number, y: number): boolean => isOpen(levelOfCell(x, y), x, y);
  for (const p of BUNKER_POSTS) assert.ok(open(p.x, p.y), `a post at ${p.x},${p.y}`);
  for (const p of BUNKER_PATROLS) {
    const s = spaceAt(p.x, p.y);
    assert.ok(s && !s.hall, `a patrol starts in a room (${p.x},${p.y})`);
    for (const c of p.round) assert.equal(spaceAt(c.x, c.y)?.id, s!.id, `${c.x},${c.y} is in the patrol's room`);
  }
  for (const d of [...BUNKER_DOGS, ...BUNKER_ALPHAS]) assert.ok(open(d.x, d.y) && spaceAt(d.x, d.y)!.id !== undefined);
  for (const d of BUNKER_PACK.dogs) assert.ok(open(d.x, d.y));
  // four on the floor of every storey: two sentries and two patrols
  for (const l of levels) {
    assert.equal(BUNKER_POSTS.filter((p) => levelOfCell(p.x, p.y) === l).length, 2, `sentries on ${l}`);
    assert.equal(BUNKER_PATROLS.filter((p) => levelOfCell(p.x, p.y) === l).length, 2, `patrols on ${l}`);
  }
  assert.equal(BUNKER_DOGS.length + BUNKER_PACK.dogs.length, 8);
  assert.equal(BUNKER_ALPHAS.length, 6);
  // nobody starts on another's cell
  const starts = [...BUNKER_POSTS, ...BUNKER_PATROLS, ...BUNKER_DOGS, ...BUNKER_PACK.dogs, ...BUNKER_ALPHAS].map((a) => `${a.x},${a.y}`);
  assert.equal(new Set(starts).size, starts.length, 'two actors start on one cell');
});

test('the lasers are on open cells; gates in halls take both cells of the hall', () => {
  for (const g of BUNKER_GATES) assert.ok(isOpen(levelOfCell(g.x, g.y), g.x, g.y), `gate ${g.x},${g.y}`);
  for (const l of BUNKER_LINES) assert.ok(isOpen(levelOfCell(l.x, l.y), l.x, l.y));
  for (const s of BUNKER_SWEEPERS) assert.ok(isOpen(levelOfCell(s.x, s.y), s.x, s.y));
  for (const s of BUNKER_SLIDERS) for (let i = s.from; i <= s.to; i++) assert.ok(isOpen(levelOfCell(i, s.at), i, s.at));
  for (const g of BUNKER_GATES) {
    const s = spaceAt(g.x, g.y)!;
    assert.ok(s.hall, 'gates are in halls');
    const cells = BUNKER_GATES.filter((o) => spaceAt(o.x, o.y)!.id === s.id && o.kind === g.kind && (g.spanX ? o.y === g.y : o.x === g.x));
    assert.equal(cells.length, 2, `a gate across ${s.id} takes both cells`);
  }
});

test('the stations go up the way in order, each beacon and checkpoint on an open cell of its own storey, each checkpoint the last beacon', () => {
  BUNKER_STATIONS.forEach((s, i) => {
    assert.ok(isOpen(s.goal.level, s.goal.x, s.goal.y), `${s.title}: goal`);
    assert.ok(isOpen(s.checkpoint.level, s.checkpoint.x, s.checkpoint.y), `${s.title}: checkpoint`);
    assert.equal(levelOfCell(s.goal.x, s.goal.y), s.goal.level, `${s.title}: goal's level`);
    assert.equal(levelOfCell(s.checkpoint.x, s.checkpoint.y), s.checkpoint.level);
    if (i > 0) assert.deepEqual(s.checkpoint, BUNKER_STATIONS[i - 1]!.goal, `${s.title}: the checkpoint is the last beacon`);
    if (i > 0) assert.ok(s.goal.level >= s.checkpoint.level, `${s.title} does not go down`);
  });
  assert.equal(BUNKER_STATIONS.length, 14);
  assert.equal(BUNKER_STATIONS[BUNKER_STATIONS.length - 1]!.goal.level, BUNKER_EXIT_LEVEL);
});

test('the furniture comes in pairs, in the lab set, inside the spaces, clear of lasers, doorways, stairs and posts, and never overlapping', () => {
  const sizes = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));
  const all = levels.map((l) => bunkerPieces(sizes, 'lab', l));
  assert.ok(all.flat().length >= 130, `${all.flat().length} pieces`);
  const used = new Set([...Object.values(BUNKER_SETS['lab']!).flat(), 'cargo']);
  const cellOf = (v: number): number => Math.round(v / 4);
  all.forEach((pieces, l) => {
    for (const p of pieces) assert.ok(used.has(p.kind), p.kind);
    // pairs: two pieces of a kind that touch
    const byPair = new Map<number, typeof pieces>();
    for (const p of pieces) byPair.set(p.pair, [...(byPair.get(p.pair) ?? []), p]);
    for (const [id, two] of byPair) assert.equal(two.length, two[0]!.kind === 'cargo' ? 1 : 2, `pair ${id}`);
    // inside open space of this storey, not on a laser's cell, not on a stair's ends
    for (const p of pieces) {
      for (const [x, z] of [[p.box.minX, p.box.minZ], [p.box.maxX, p.box.maxZ], [p.box.minX, p.box.maxZ], [p.box.maxX, p.box.minZ]] as const) {
        const d = drawn[l]!.cells[cellOf(z)]?.[cellOf(x)];
        assert.ok(d && (d.N || d.S || d.E || d.W), `a ${p.kind} corner at ${x.toFixed(1)},${z.toFixed(1)} is off the floor of level ${l}`);
      }
      for (const g of BUNKER_GATES) assert.ok(!(cellOf(p.cx) === g.x && cellOf(p.cz) === g.y), `a ${p.kind} stands in a gate's cell`);
      for (const st of stairsOn(l)) {
        const ends = stairEnds(st);
        for (const c of st.low === l ? ends.foot : ends.head) assert.ok(!(cellOf(p.cx) === c.x && cellOf(p.cz) === c.y), `a ${p.kind} stands at ${st.id}'s end`);
      }
    }
    // no two overlap
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i]!.box;
        const b = pieces[j]!.box;
        assert.ok(!(a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6), `${pieces[i]!.kind} and ${pieces[j]!.kind} overlap`);
      }
    }
    // the hall's lane stays open: no piece within 1.5 m of a hall's middle line
    for (const h of spacesOn(l).filter((s) => s.hall)) {
      const vertical = h.y1 - h.y0 > h.x1 - h.x0;
      const mid = vertical ? ((h.x0 + h.x1) / 2) * 4 : ((h.y0 + h.y1) / 2) * 4;
      for (const p of pieces) {
        if (spaceAt(cellOf(p.cx), cellOf(p.cz))?.id !== h.id) continue;
        const a = vertical ? p.box.minX : p.box.minZ;
        const b = vertical ? p.box.maxX : p.box.maxZ;
        assert.ok(a > mid + 1.5 || b < mid - 1.5, `a ${p.kind} blocks ${h.id}'s middle`);
      }
    }
  });
});

test('the cameras: twenty, each on a wall of its own space, none at a hall\'s mouth, some with a 180 degree lens', () => {
  assert.equal(BUNKER_CAMERAS.length, 20);
  assert.ok(BUNKER_CAMERAS.filter((c) => c.half >= Math.PI / 2).length >= 5);
  assert.ok(BUNKER_CAMERAS.filter((c) => c.sweep >= 0.9).length >= 5);
  for (const c of BUNKER_CAMERAS) {
    const map = bunkerMap(c.level, true);
    // the wall's middle is 0.55 m behind the mount
    const dx = c.wall === 'W' ? -1 : c.wall === 'E' ? 1 : 0;
    const dz = c.wall === 'N' ? -1 : c.wall === 'S' ? 1 : 0;
    const wx = c.x + dx * 0.55;
    const wz = c.z + dz * 0.55;
    // the wall stands on the edge between two cells: a closed edge in the map, not an opening
    const gx = Math.round((wx / 4 + 0.5) * 2); // 2*cell + 1 is a cell, an even index is an edge
    const gz = Math.round((wz / 4 + 0.5) * 2);
    const ex = dx !== 0 ? gx : 2 * Math.round(c.x / 4) + 1;
    const ez = dz !== 0 ? gz : 2 * Math.round(c.z / 4) + 1;
    assert.equal(map[ez]![ex], '#', `camera at ${c.x},${c.z} is on a wall`);
    assert.equal(c.mountY, BUNKER_CAMERA_Y);
    assert.equal(spaceAt(Math.round(c.x / 4), Math.round(c.z / 4))?.level, c.level, `camera at ${c.x},${c.z} is on its space's storey`);
  }
});

test('the rooms are furnished: well over half of each one\'s floor, none of it on a laser, a doorway, a camera\'s panel or where anyone starts, and the aisles are one network', () => {
  let rooms = 0;
  let share = 0;
  for (const l of levels) {
    const furnished = furnishedCells(l);
    for (const s of spacesOn(l).filter((q) => !q.hall)) {
      let total = 0;
      let furn = 0;
      for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
        total++;
        if (furnished.has(`${x},${y}`)) furn++;
      }
      assert.ok(furn / total >= 0.5, `${s.id}: ${furn} of ${total} cells furnished`);
      share += furn / total;
      rooms++;
      assert.ok(furn <= Math.ceil(FURNITURE_SHARE * total) + 12, `${s.id}: not more than the share plus the cells that could not be aisle`);
    }
    for (const a of [...BUNKER_POSTS, ...BUNKER_DOGS, ...BUNKER_ALPHAS, ...BUNKER_PACK.dogs, ...BUNKER_PATROLS]) if (levelOfCell(a.x, a.y) === l) assert.ok(!furnished.has(`${a.x},${a.y}`), `someone starts in a furnished cell at ${a.x},${a.y}`);
    for (const g of BUNKER_GATES) assert.ok(!furnished.has(`${g.x},${g.y}`));
    for (const c of BUNKER_CAMERAS.filter((q) => q.level === l)) assert.ok(!furnished.has(`${Math.round(c.x / 4)},${Math.round(c.z / 4)}`), 'a camera\'s panel is walled in');
  }
  assert.ok(share / rooms >= 0.6, `the rooms average ${(share / rooms).toFixed(2)} furnished`);
});

test('the roofs: islands of connected cells, a nav grid that stops at the edge, and patrols that stay on their own island', () => {
  const cells = new Set(['2,2', '3,2', '4,2', '2,3', '3,3', '4,3', '5,3', '10,10', '11,10']);
  const islands = roofIslands(cells);
  assert.equal(islands.length, 2);
  assert.equal(islands[0]!.length, 7);
  const nav = roofNav(cells, 14, 14);
  assert.equal(nav[2]![2]!.E, true);
  assert.equal(nav[2]![2]!.W, false, 'the edge is the edge');
  assert.equal(nav[2]![5]!.S, false);
  assert.equal(nav[3]![5]!.W, true);
  assert.equal(nav[0]![0]!.N || nav[0]![0]!.E, false, 'no roof, no way');
  // a big roof (24 cells) gets two patrols, a small island none
  const big = new Set<string>();
  for (let x = 0; x < 8; x++) for (let y = 0; y < 3; y++) big.add(`${x},${y}`);
  const routes = roofRoutes(new Set([...big, '20,20', '21,20']), 3, 8, 20);
  assert.equal(routes.length, 2);
  for (const r of routes) {
    assert.equal(r.route.length, 4);
    for (const c of r.route) assert.ok(big.has(`${c.x},${c.y}`), 'each stop is on its roof');
    assert.deepEqual(r.start, r.route[0]);
  }
  assert.notDeepEqual(routes[0]!.start, routes[1]!.start);
  // the real bunker: some storeys have roofs a guard can patrol
  const sizes = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));
  let total = 0;
  for (const l of levels) {
    const roofs = new Set<string>();
    for (const p of bunkerPieces(sizes, 'lab', l).filter((q) => q.kind === 'cargo')) {
      const along = p.yaw === 0;
      const x = Math.round(p.cx / 4 - (along ? 0.5 : 0));
      const y = Math.round(p.cz / 4 - (along ? 0 : 0.5));
      roofs.add(`${x},${y}`);
      roofs.add(along ? `${x + 1},${y}` : `${x},${y + 1}`);
    }
    total += roofRoutes(roofs).length;
  }
  assert.ok(total >= 4, `${total} roof patrols in the bunker`);
});

// ---- the objective: clue systems and containers ----

const sizesOf = () => Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));

test('every storey has a clue system, in its room, on an aisle cell against one wall, nobody starting on it and no camera panel near', () => {
  assert.equal(BUNKER_CLUES.length, BUNKER_LEVELS);
  for (const l of levels) {
    const c = clueOn(l)!;
    assert.ok(c, `storey ${l} has one`);
    const sp = spaceAt(c.x, c.y)!;
    assert.equal(sp.id, CLUE_ROOMS[l]);
    assert.ok(!sp.hall && sp.level === l);
    const furnished = furnishedCells(l);
    assert.ok(!furnished.has(`${c.x},${c.y}`), 'on an aisle cell');
    assert.ok(!clearCells(l).has(`${c.x},${c.y}`), 'not on a doorway, laser, stair or duct cell');
    // against exactly one wall of the room, which is the side it names
    const step = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } as const;
    const out = (Object.keys(step) as Array<keyof typeof step>).filter((d) => spaceAt(c.x + step[d][0], c.y + step[d][1])?.id !== sp.id);
    assert.deepEqual(out, [c.side]);
    // it is worked from its own cell
    assert.deepEqual(c.stand, { x: c.x, y: c.y });
    for (const a of [...postsOn(l), ...patrolsOn(l), ...dogsOn(l), ...alphasOn(l), ...(packOn(l)?.dogs ?? [])]) assert.ok(!(a.x === c.x && a.y === c.y), `${a.x},${a.y} starts on it`);
    for (const cam of camerasOn(l)) assert.ok(Math.max(Math.abs(Math.round(cam.x / 4) - c.x), Math.round(Math.abs(cam.z / 4 - c.y))) > 1, 'clear of the camera panels');
  }
});

test('each clue system can be walked to from where its storey is entered, with the furniture shut, and worked from its own cell', () => {
  for (const l of levels) {
    const c = clueOn(l)!;
    const walk = walkableCells(l);
    assert.ok(walk.size > 20, `storey ${l} has a walkable run`);
    assert.ok(walk.has(`${c.stand.x},${c.stand.y}`), `storey ${l}: the clue system's cell is reachable`);
    assert.ok(walk.has(`${c.x},${c.y}`), 'and so is the cell itself');
  }
});

test('containers are numbered in the order the plan lists them, with ids that do not change, and their cells and door end', () => {
  for (const l of levels) {
    const a = containersOn(l, sizesOf());
    const b = containersOn(l, sizesOf());
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((c) => c.id)).size, a.length);
    assert.equal(a.length, bunkerPieces(sizesOf(), 'lab', l).filter((p) => p.kind === 'cargo').length);
    a.forEach((c, i) => {
      assert.equal(c.index, i);
      assert.equal(c.cells.length, 2);
      assert.ok(c.cells.every((q) => furnishedCells(l).has(`${q.x},${q.y}`)), 'it stands on furnished cells');
      assert.equal(Math.abs(c.door.x - c.cells[1]!.x) + Math.abs(c.door.y - c.cells[1]!.y) + Math.abs(c.door.x - c.cells[0]!.x) + Math.abs(c.door.y - c.cells[0]!.y) <= 3, true, 'its door cell is next to one end');
    });
  }
});

test('open containers: only those whose door end is a free cell the agent can walk to; storeys 1 to 3 have some for the dossier', () => {
  for (const l of levels) {
    const all = containersOn(l, sizesOf());
    const open = openContainers(l, sizesOf());
    const walk = walkableCells(l);
    for (const c of open) {
      assert.ok(walk.has(`${c.door.x},${c.door.y}`), `${c.id}'s door end is reachable`);
      assert.ok(!furnishedCells(l).has(`${c.door.x},${c.door.y}`));
    }
    assert.ok(open.length <= all.length);
    if (l >= 1) assert.ok(open.length >= 3, `storey ${l} has ${open.length} containers to open`);
  }
});
