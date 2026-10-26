// Security layout for one floor: locked doors that seal off sections of the
// maze, the terminal (laptop) and server rooms that unlock them, storage
// rooms whose lockers hold the documents, and decorative rooms. Pure and dependency-free (no Three.js) so it's unit
// testable under Node.
//
// Relies on generateMaze() producing a perfect maze (a spanning tree): every
// open passage is the only route between its two sides, so a door on one
// passage seals off exactly the subtree beyond it — its "section". Rooms are
// dead-end pockets off corridors (1 cell, or 2 when the pocket runs straight
// for two cells), which keeps rooms genuinely isolated without changing
// maze generation at all.
//
// Solvability: door k's terminal and server always sit in the open region or
// in sections of doors placed before it (0..k-1), never in its own section or
// a later one — so opening doors in id order always works. Door k's server
// prefers door k-1's section when it has a free room, which chains the
// unlocks into a progression instead of a flat checklist.

import type { MazeCells } from './maze';
import type { LockerContent } from './decisions';

export type Dir = 'N' | 'S' | 'E' | 'W';
const DIRS: Dir[] = ['N', 'S', 'E', 'W'];
export const DIR_DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** A locked passage: from cell (x,y) through `dir`. The section lies beyond. */
export type Door = { id: number; x: number; y: number; dir: Dir };

export type RoomKind =
  | 'terminal'
  | 'server'
  | 'storage'
  | 'uplink'
  | 'logs'
  | 'office'
  | 'conference'
  | 'cafeteria'
  | 'rack'
  // The museum's, the refinery's and the bank's own decorative rooms (locations.ts).
  | 'gallery'
  | 'exhibit'
  | 'boiler'
  | 'control'
  | 'teller'
  | 'deposit'
  // The warehouse's and the lab's.
  | 'shelving'
  | 'dock'
  | 'bench'
  | 'specimen';

export type Room = {
  kind: RoomKind;
  /** Innermost (dead-end) cell — the room's furniture sits here, against the wall opposite `openDir`. */
  x: number;
  y: number;
  /** Every cell the room occupies, innermost first (1 or 2 cells). */
  cells: Array<{ x: number; y: number }>;
  /** Direction the room opens toward, out to the corridor. */
  openDir: Dir;
  /** The door this terminal/server controls; null for other rooms. */
  keyId: number | null;
  /** Storage rooms: how many of its lockers hold a document (the rest are loot or rigged). 0 for other rooms. */
  docs: number;
  /** Storage rooms: exactly what's in the lockers, in order, instead of a random stock (the training floor). */
  stock?: LockerContent[];
};

/** How many of each thing a floor wants. */
export type SecurityCounts = {
  doors: number;
  storage: number;
  decor: number;
  /** Put each door's terminal and server behind the door before it, so they open in a chain (difficulty.ts). */
  chain?: boolean;
  /**
   * The heist loop's rooms on this floor: the network closet with the uplink, and the log server that records
   * file access. One of each per building, so a two-floor job puts one on each floor.
   */
  network?: ReadonlyArray<'uplink' | 'logs'>;
  /**
   * Picks a way in on this floor (entries.ts's roof hatch or tunnel grate), given which cells no locked door
   * seals off and what's taken. Asked once the doors are chosen and before rooms claim the dead ends, so it
   * can always find one, and never inside a locked section, where a door's terminal would be out of reach.
   */
  entry?: ((unsealed: (x: number, y: number) => boolean, used: ReadonlySet<string>) => { x: number; y: number } | null) | undefined;
};

export type SecurityPlan = {
  doors: Door[];
  rooms: Room[];
  /** Door id whose section contains the cell, or -1 for the always-open region. */
  section: number[][];
  /** The way in `counts.entry` picked, if any (reserved in `used`). */
  entry?: { x: number; y: number } | null;
};

/** Colour and letter per door id, shared by the door, its terminal and its server so the trio reads as a set. */
export const KEY_COLORS = [0x4ee08a, 0xc27bff, 0xffb347];
export const keyLabel = (id: number): string => String.fromCharCode(65 + id);

const DOOR_MIN_DIST = 4;
const ROOM_MIN_DIST = 3;
const SECTION_MIN_FRACTION = 0.12;
const SECTION_MAX_FRACTION = 0.45; // for a single door; split across more doors so several disjoint sections still fit
const DEFAULT_DECOR_KINDS: RoomKind[] = ['office', 'conference', 'cafeteria'];
const MAX_DOCS_PER_ROOM = 3; // a storage room has at most 3 lockers

const key = (x: number, y: number): string => `${x},${y}`;

function openNeighbors(cells: MazeCells, cols: number, rows: number, x: number, y: number): Array<{ dir: Dir; x: number; y: number }> {
  const out: Array<{ dir: Dir; x: number; y: number }> = [];
  const c = cells[y]![x]!;
  for (const dir of DIRS) {
    if (!c[dir]) continue;
    const nx = x + DIR_DELTA[dir][0];
    const ny = y + DIR_DELTA[dir][1];
    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push({ dir, x: nx, y: ny });
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** `dist` is the BFS distance grid from `spawn` (maze.ts's bfs()), passed in rather than recomputed. */
export function planSecurity(
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  spawn: { x: number; y: number },
  used: Set<string>,
  counts: SecurityCounts,
  decorKinds: RoomKind[] = DEFAULT_DECOR_KINDS
): SecurityPlan {
  const doorCount = counts.doors;
  const total = cols * rows;

  // Spanning tree rooted at spawn: each cell's parent is its neighbor one
  // step closer; subtree sizes accumulate from the farthest cells inward.
  const parent: Array<Array<{ x: number; y: number } | null>> = [];
  const size: number[][] = [];
  const order: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < rows; y++) {
    parent.push(new Array(cols).fill(null));
    size.push(new Array(cols).fill(1));
    for (let x = 0; x < cols; x++) {
      order.push({ x, y });
      if (x === spawn.x && y === spawn.y) continue;
      const p = openNeighbors(cells, cols, rows, x, y).find((n) => dist[n.y]![n.x] === dist[y]![x]! - 1);
      parent[y]![x] = p ? { x: p.x, y: p.y } : null;
    }
  }
  order.sort((a, b) => dist[b.y]![b.x]! - dist[a.y]![a.x]!);
  for (const c of order) {
    const p = parent[c.y]![c.x];
    if (p) size[p.y]![p.x]! += size[c.y]![c.x]!;
  }

  const isAncestorOrSelf = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    let cur: { x: number; y: number } | null = b;
    while (cur) {
      if (cur.x === a.x && cur.y === a.y) return true;
      cur = parent[cur.y]![cur.x]!;
    }
    return false;
  };

  // Whether the section behind a door at `root` has a dead end a room could go in (on a small floor, one
  // may be nothing but corridor, and a locked door with nothing behind it is pointless).
  const hasFreeDeadEnd = (root: { x: number; y: number }): boolean => {
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      const nbrs = openNeighbors(cells, cols, rows, cur.x, cur.y);
      if (cur !== root && nbrs.length === 1 && !used.has(key(cur.x, cur.y)) && dist[cur.y]![cur.x]! >= ROOM_MIN_DIST) return true;
      for (const n of nbrs) if (dist[n.y]![n.x] === dist[cur.y]![cur.x]! + 1) stack.push({ x: n.x, y: n.y });
    }
    return false;
  };

  // Door candidates: the passage into a straight corridor cell whose
  // subtree is a meaningful but not overwhelming share of the floor, with somewhere behind it for a room.
  type Candidate = { p: { x: number; y: number }; c: { x: number; y: number }; dir: Dir };
  const candidates: Candidate[] = [];
  for (const c of order) {
    const p = parent[c.y]![c.x];
    if (!p || dist[c.y]![c.x]! < DOOR_MIN_DIST) continue;
    if (used.has(key(c.x, c.y)) || used.has(key(p.x, p.y))) continue;
    const nbrs = openNeighbors(cells, cols, rows, c.x, c.y);
    if (nbrs.length !== 2 || OPPOSITE[nbrs[0]!.dir] !== nbrs[1]!.dir) continue;
    const frac = size[c.y]![c.x]! / total;
    if (frac < SECTION_MIN_FRACTION || frac > Math.min(SECTION_MAX_FRACTION, 0.9 / Math.max(1, doorCount))) continue;
    if (!hasFreeDeadEnd(c)) continue;
    const dir = DIRS.find((d) => p.x + DIR_DELTA[d][0] === c.x && p.y + DIR_DELTA[d][1] === c.y)!;
    candidates.push({ p, c, dir });
  }

  // Pick disjoint sections: a new root can't sit inside a chosen section,
  // nor contain a chosen root inside its own.
  const chosen: Candidate[] = [];
  for (const cand of shuffle(candidates)) {
    if (chosen.length >= doorCount) break;
    const overlaps = chosen.some((ch) => isAncestorOrSelf(ch.c, cand.c) || isAncestorOrSelf(cand.c, ch.c));
    if (!overlaps) chosen.push(cand);
  }

  const section: number[][] = [];
  for (let y = 0; y < rows; y++) section.push(new Array(cols).fill(-1));
  const markSection = (root: { x: number; y: number }, id: number): void => {
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      section[cur.y]![cur.x] = id;
      for (const n of openNeighbors(cells, cols, rows, cur.x, cur.y)) {
        if (dist[n.y]![n.x] === dist[cur.y]![cur.x]! + 1) stack.push({ x: n.x, y: n.y });
      }
    }
  };
  chosen.forEach((ch, i) => markSection(ch.c, i));

  // Cells beside a door stay clear of rooms (and of other content, via `used`).
  const blocked = new Set<string>();
  for (const ch of chosen) {
    blocked.add(key(ch.p.x, ch.p.y));
    blocked.add(key(ch.c.x, ch.c.y));
  }

  // The way in, before rooms take the dead ends: in the open region (a door dropped below only widens it).
  const entry = counts.entry?.((x, y) => section[y]![x] === -1 && !blocked.has(key(x, y)), used) ?? null;
  if (entry) used.add(key(entry.x, entry.y));

  // Room slots: dead-end pockets, extended to 2 cells when the pocket runs straight.
  type Slot = { cells: Array<{ x: number; y: number }>; openDir: Dir };
  const slots: Slot[] = [];
  for (const d of order) {
    if (d.x === spawn.x && d.y === spawn.y) continue;
    const k = key(d.x, d.y);
    if (used.has(k) || blocked.has(k) || dist[d.y]![d.x]! < ROOM_MIN_DIST) continue;
    const nbrs = openNeighbors(cells, cols, rows, d.x, d.y);
    if (nbrs.length !== 1) continue;
    const openDir = nbrs[0]!.dir;
    const next = { x: nbrs[0]!.x, y: nbrs[0]!.y };
    const nextNbrs = openNeighbors(cells, cols, rows, next.x, next.y);
    const nextStraight = nextNbrs.length === 2 && nextNbrs.some((n) => n.dir === openDir);
    const nk = key(next.x, next.y);
    const extend = nextStraight && !used.has(nk) && !blocked.has(nk) && !(next.x === spawn.x && next.y === spawn.y);
    slots.push({ cells: extend ? [d, next] : [d], openDir });
  }
  shuffle(slots);

  const rooms: Room[] = [];
  const takeSlot = (pred: (s: Slot) => boolean): Slot | null => {
    const i = slots.findIndex(pred);
    return i === -1 ? null : slots.splice(i, 1)[0]!;
  };
  const regionOf = (s: Slot): number => section[s.cells[0]!.y]![s.cells[0]!.x]!;

  // Storage rooms first — documents are the job's objective, doors are
  // optional structure, so on a small maze the documents get the dead ends.
  // One inside every locked section (so each door guards something worth
  // opening), the rest anywhere. If dead ends still run short, extra
  // documents stack into rooms already placed (up to MAX_DOCS_PER_ROOM); only
  // a floor with no free dead end at all can come up short, and game.ts
  // counts documents actually placed, so the job stays winnable. (A door whose terminal/server can't then
  // fit is dropped below, and its storage room simply ends up unlocked.)
  const storage: Room[] = [];
  const addStorage = (slot: Slot): void => {
    const room: Room = { kind: 'storage', x: slot.cells[0]!.x, y: slot.cells[0]!.y, cells: slot.cells, openDir: slot.openDir, keyId: null, docs: 1 };
    storage.push(room);
    rooms.push(room);
  };
  for (let id = 0; id < chosen.length && storage.length < counts.storage; id++) {
    const slot = takeSlot((sl) => regionOf(sl) === id);
    if (slot) addStorage(slot);
  }
  while (storage.length < counts.storage) {
    const slot = takeSlot(() => true);
    if (!slot) break;
    addStorage(slot);
  }
  let unplaced = counts.storage - storage.length;
  for (const room of storage) {
    while (unplaced > 0 && room.docs < MAX_DOCS_PER_ROOM) {
      room.docs++;
      unplaced--;
    }
  }

  // The uplink closet and the log server, next: the heist loop runs through
  // both (take the uplink down, capture the files, wipe the logs), so they
  // come before the doors, which are optional structure. In the part of the
  // floor no door seals when there's room, so the loop doesn't wait on a
  // door (a door dropped below for want of controls folds its section back
  // into the open region anyway).
  {
    for (const kind of counts.network ?? []) {
      const slot = takeSlot((s) => regionOf(s) === -1) ?? takeSlot(() => true);
      if (slot) rooms.push({ kind, x: slot.cells[0]!.x, y: slot.cells[0]!.y, cells: slot.cells, openDir: slot.openDir, keyId: null, docs: 0 });
    }
  }

  // Terminal + server per door, in id order; a door that can't get both is
  // dropped and its section folds back into the open region.
  const kept: Candidate[] = [];
  const oldToNew = new Map<number, number>();
  chosen.forEach((ch, oldId) => {
    const newId = kept.length;
    const allowed = (s: Slot): boolean => {
      const r = regionOf(s);
      return r === -1 || (oldToNew.has(r) && oldToNew.get(r)! < newId);
    };
    // Chained: behind the previous door when there's room there, so each door opens the way to the next one's controls.
    const prevOld = counts.chain ? [...oldToNew.entries()].find(([, n]) => n === newId - 1)?.[0] : undefined;
    const behindPrev = (): Slot | null => (prevOld !== undefined ? takeSlot((s) => regionOf(s) === prevOld) : null);
    const server = behindPrev() ?? takeSlot(allowed);
    const terminal = server ? (behindPrev() ?? takeSlot(allowed)) : null;
    if (!server || !terminal) {
      if (server) slots.push(server);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (section[y]![x] === oldId) section[y]![x] = -1;
      return;
    }
    oldToNew.set(oldId, newId);
    kept.push(ch);
    for (const [kind, slot] of [
      ['server', server],
      ['terminal', terminal],
    ] as const) {
      rooms.push({ kind, x: slot.cells[0]!.x, y: slot.cells[0]!.y, cells: slot.cells, openDir: slot.openDir, keyId: newId, docs: 0 });
    }
  });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const s = section[y]![x]!;
      if (s !== -1) section[y]![x] = oldToNew.get(s)!;
    }
  }

  for (let i = 0; i < counts.decor; i++) {
    const slot = takeSlot(() => true);
    if (!slot) break;
    rooms.push({ kind: decorKinds[i % decorKinds.length]!, x: slot.cells[0]!.x, y: slot.cells[0]!.y, cells: slot.cells, openDir: slot.openDir, keyId: null, docs: 0 });
  }

  const doors: Door[] = kept.map((ch, id) => ({ id, x: ch.p.x, y: ch.p.y, dir: ch.dir }));
  for (const k of blocked) used.add(k);
  for (const r of rooms) for (const c of r.cells) used.add(key(c.x, c.y));

  return { doors, rooms, section, entry };
}

/** A copy of `cells` with every door passage closed — what patrol bots path on while those doors are locked. */
export function navCellsFor(cells: MazeCells, doors: Door[], cols: number, rows: number): MazeCells {
  const nav = cells.map((row) => row.map((c) => ({ ...c })));
  for (const d of doors) setPassage(nav, d, false, cols, rows);
  return nav;
}

/** Opens or closes a door's passage in a nav grid (both sides of the edge). */
export function setPassage(nav: MazeCells, door: Door, open: boolean, cols: number, rows: number): void {
  const nx = door.x + DIR_DELTA[door.dir][0];
  const ny = door.y + DIR_DELTA[door.dir][1];
  nav[door.y]![door.x]![door.dir] = open;
  if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) nav[ny]![nx]![OPPOSITE[door.dir]] = open;
}
