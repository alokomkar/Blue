// The short transitions between the run's levels. In this build they carry no narrative: a scene is one neutral screen line, and playInterlude (interludeview.ts) resolves at once. This file keeps the
// scene shape the game passes around, the briefing's task list and the door-maze generator. Pure (type-only imports), so it is unit-tested under Node.

import type { Address, Run } from './arc';

/** What the scene shows. */
export type Ride = 'lift' | 'truck' | 'door' | 'call' | 'upload' | 'descent' | 'street';

/** One caption of the scene: when it appears (seconds in) and what it says. */
export type Line = { at: number; who: 'screen'; text: string };

export type Scene = {
  ride: Ride;
  /** Seconds the scene runs for. */
  duration: number;
  from: string;
  to: string;
  lines: Line[];
};

/** The bit of an operation a scene reads. */
type OpLike = { n: number };

const scene = (ride: Ride, from: string, to: string, text: string): Scene => ({ ride, duration: 4, from, to, lines: [{ at: 0.8, who: 'screen', text }] });

/** The scene before an operation's first level. */
export const callInScene = (op: OpLike): Scene => scene('call', 'START', `OPERATION ${op.n}`, `OPERATION ${op.n}`);

/** The scene after the maze. */
export const uploadScene = (op: OpLike): Scene => scene('upload', 'MAZE', 'EXIT', `OPERATION ${op.n} · MAZE CLEARED`);

/** The scene at the start of the exit level. */
export const descentScene = (op: OpLike): Scene => scene('descent', 'TOP FLOOR', 'LOBBY', `OPERATION ${op.n} · THE WAY OUT`);

/** The scene after the exit level; null when there is none. */
export const streetScene = (op: OpLike): Scene | null => (op.n >= 6 ? null : scene('street', 'BUILDING', 'STREET', `OPERATION ${op.n} · CLEAR`));

/** The scene between the first level and the tower of the dossier's place: out of the first level, with the address. */
export function toTowerScene(_run: Run, ride: Ride, a: Address): Scene {
  return {
    ride,
    duration: 5,
    from: ride === 'lift' ? 'GROUND' : 'THE YARD',
    to: ride === 'lift' ? 'STREET' : a.street.split(',')[0]!.toUpperCase(),
    lines: [
      { at: 0.8, who: 'screen', text: ride === 'lift' ? 'LIFT 4 · GROUND → STREET' : 'TRUCK 9 · OUT OF THE YARD' },
      { at: 2.4, who: 'screen', text: `${a.name}, ${a.street}` },
    ],
  };
}

/** The scene at the heist door. */
export function toHeistScene(place: string): Scene {
  return { ride: 'door', duration: 4, from: 'THE OFFICES', to: 'THE VAULT', lines: [{ at: 0.8, who: 'screen', text: `HEIST DOOR · ${place.toUpperCase()}` }] };
}

/** One wall of the maze drawn at the door, in cells, and how far from the middle it is (0 to 1: the order they are laid in). */
export type DoorWall = { x1: number; y1: number; x2: number; y2: number; d: number };

export const DOOR_COLS = 15;
export const DOOR_ROWS = 9;

/** A small maze for `seed` (a place's name): every wall of a grid carved by a depth-first walk from the middle, so the middle cell is where the agent stands and there is a way out of it. */
export function doorMaze(seed: string): DoorWall[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = (): number => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), h | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cols = DOOR_COLS;
  const rows = DOOR_ROWS;
  // open[a][b]: cell a and b (index = y * cols + x) are joined
  const joined = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const seen = new Set<number>();
  const start = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  const stack = [start];
  seen.add(start);
  while (stack.length > 0) {
    const c = stack[stack.length - 1]!;
    const x = c % cols;
    const y = Math.floor(c / cols);
    const next = [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1].filter((n) => n >= 0 && !seen.has(n));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(rnd() * next.length)]!;
    joined.add(key(c, n));
    seen.add(n);
    stack.push(n);
  }
  const mx = (cols - 1) / 2;
  const my = (rows - 1) / 2;
  const far = Math.hypot(mx + 0.5, my + 0.5);
  const walls: DoorWall[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number): void => {
    walls.push({ x1, y1, x2, y2, d: Math.min(1, Math.hypot((x1 + x2) / 2 - cols / 2, (y1 + y2) / 2 - rows / 2) / far) });
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x;
      if (x === 0) add(0, y, 0, y + 1);
      if (y === 0) add(x, 0, x + 1, 0);
      // the wall to the east and the wall to the south, where the cells are not joined (or it is the edge)
      if (x === cols - 1 || !joined.has(key(c, c + 1))) add(x + 1, y, x + 1, y + 1);
      if (y === rows - 1 || !joined.has(key(c, c + cols))) add(x, y + 1, x + 1, y + 1);
    }
  }
  return walls;
}

/** The briefing's task list for a tower: what is to be done, in order, in the words the briefing sheet shows. `floors` are the storeys' names, `cardsOn` the storeys (indices) with a keycard. */
export function towerTasks(floors: readonly string[], cardsOn: readonly number[]): string[] {
  const cards = cardsOn.map((l) => floors[l] ?? `floor ${l + 1}`);
  return [
    `Take the keycard on each of ${cardsOn.length === 4 ? 'the four' : cardsOn.length} floors: ${cards.join(', ')}. Each lies on a small desk, deep in its floor.`,
    `Go up to the top floor, ${floors[floors.length - 1] ?? 'the offices'}: the heist door opens once you hold every card.`,
    'Guards, dogs and cameras are optional. Taking them down pays; the door does not need it.',
  ];
}

/** The caption's text typed out `t` seconds after it appeared (a character every `1 / rate` seconds), whole once it is done. */
export function typedText(text: string, t: number, rate = 28): string {
  return text.slice(0, Math.max(0, Math.min(text.length, Math.floor(t * rate))));
}

/** The captions on screen at `t`: each stays up until the next appears two lines later, or the scene ends (at most two at once). */
export function visibleLines(scene: Scene, t: number): Array<{ line: Line; age: number }> {
  const shown = scene.lines.filter((l) => l.at <= t);
  return shown.slice(-2).map((line) => ({ line, age: t - line.at }));
}
