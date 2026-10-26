// The guide: a floor arrow, and a line on the PDA, that point the way to the next objective, so nobody is left
// wandering a maze for the one room they still need while a guard's route comes round again. The stealth is the
// game; the maze is only the setting. Here: which objective comes next, and which way along the corridors it lies.
// game.ts draws the arrow and keeps the PDA's line. Pure (type-only imports), so it's unit-tested under Node.

import type { MazeCells } from './maze';

export type GoalKind = 'uplink' | 'files' | 'logs' | 'exit' | 'clue' | 'dossier';

/** A place that could be next: its floor, its cell on that floor, and what getting there costs (a lower cost is nearer). */
export type Goal = { kind: GoalKind; floor: number; x: number; y: number; cost: number };

export const GOAL_LABEL: Record<GoalKind, string> = {
  uplink: 'Take down the uplink',
  files: 'Records room',
  logs: 'Wipe the logs',
  exit: 'Exit lift',
  clue: 'Facilities terminal',
  dossier: 'The dossier',
};

/** What's still to do on the job. */
export type Needs = {
  /** The uplink is up, which keeps every workstation locked. */
  uplinkOnline: boolean;
  /** Files still to photograph. */
  filesLeft: number;
  /** Access logs are queued, and want wiping before they go out. */
  logsPending: boolean;
};

/**
 * The next objective: the uplink while it's up (nothing can be captured until it's down), then the nearest records
 * room, then the log server once the logs are queued, then the way out. Null when there's nothing to point at.
 */
export function pickGoal(goals: readonly Goal[], needs: Needs): Goal | null {
  const nearest = (kind: GoalKind): Goal | null => goals.filter((g) => g.kind === kind).sort((a, b) => a.cost - b.cost)[0] ?? null;
  if (needs.uplinkOnline) {
    const up = nearest('uplink');
    if (up) return up;
  }
  if (needs.filesLeft > 0) {
    const files = nearest('files');
    if (files) return files;
  }
  if (needs.logsPending) {
    const logs = nearest('logs');
    if (logs) return logs;
  }
  return needs.filesLeft === 0 ? nearest('exit') : null;
}

// ---- the bunker (tasks/plan.md): terminals that know where the dossier is, then the dossier, then the way out ----

export type BunkerProgress = {
  /** The storeys whose terminal has to be hacked to lead to the dossier (the bottom one up to the dossier's own). */
  needed: readonly number[];
  /** The storeys whose terminal has been hacked. */
  hacked: ReadonlySet<number>;
  /** The dossier has been read. */
  found: boolean;
};
export type BunkerSites = {
  /** A terminal's cell, by storey. */
  clue: (level: number) => { level?: number; x: number; y: number } | null;
  /** The cell at the dossier container's door, and its storey. */
  dossier: { level: number; x: number; y: number } | null;
  /** The way out. */
  exit: { level: number; x: number; y: number };
};

/**
 * Where the arrow points in the bunker. Nowhere until the first terminal is hacked (finding one is up to the agent); then at the lowest terminal still to hack on the way to the dossier;
 * then at the dossier's container; and once the dossier is read, at the way out.
 */
export function pickBunkerGoal(progress: BunkerProgress, sites: BunkerSites): Goal | null {
  if (progress.found) return { kind: 'exit', floor: sites.exit.level, x: sites.exit.x, y: sites.exit.y, cost: 0 };
  if (progress.hacked.size === 0) return null;
  const next = progress.needed.find((l) => !progress.hacked.has(l));
  if (next !== undefined) {
    const c = sites.clue(next);
    if (c) return { kind: 'clue', floor: c.level ?? next, x: c.x, y: c.y, cost: 0 };
  }
  const d = sites.dossier;
  return d ? { kind: 'dossier', floor: d.level, x: d.x, y: d.y, cost: 0 } : null;
}

const STEPS: ReadonlyArray<{ dir: 'N' | 'S' | 'E' | 'W'; dx: number; dy: number }> = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'W', dx: -1, dy: 0 },
];

/**
 * Walking from `from` toward the target `dist` was measured from (a bfs() field: steps to the target, -1 where
 * there's no way), up to `ahead` cells along the way: where that gets to, and how many steps are left from `from`.
 * Null if there's no way from here.
 */
export function stepToward(
  dist: number[][],
  cells: MazeCells,
  from: { x: number; y: number },
  ahead: number
): { to: { x: number; y: number }; left: number } | null {
  const left = dist[from.y]?.[from.x] ?? -1;
  if (left < 0) return null;
  let cur = { ...from };
  let d = left;
  for (let i = 0; i < ahead && d > 0; i++) {
    const next = STEPS.map((s) => ({ x: cur.x + s.dx, y: cur.y + s.dy, open: cells[cur.y]![cur.x]![s.dir] })).find(
      (n) => n.open && dist[n.y]?.[n.x] === d - 1
    );
    if (!next) break;
    cur = { x: next.x, y: next.y };
    d--;
  }
  return { to: cur, left };
}

const OPPOSITE_DIR: Record<'N' | 'S' | 'E' | 'W', 'N' | 'S' | 'E' | 'W'> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E',
};

export type NavDoor = {
  id: number;
  x: number;
  y: number;
  dir: 'N' | 'S' | 'E' | 'W';
  isOpen: boolean;
};

export type NavTerminal = {
  keyId: number;
  x: number;
  y: number;
  hacked: boolean;
};

export type NavServer = {
  keyId: number;
  x: number;
  y: number;
  online: boolean;
};

export type TargetResolution = {
  target: { x: number; y: number };
  label: string;
  locked: boolean;
};

/**
 * When the next heist objective sits behind a locked door, resolveGoalTarget intercepts that objective
 * and instead guides the agent to the required security devices in order:
 * 1. The terminal (laptop) that readies the door's circuit, if not yet hacked.
 * 2. The server console that powers the door open, if not yet online.
 * 3. Once the door opens, guides straight into the sector toward the objective.
 */
export function resolveGoalTarget(params: {
  bfs: (cells: MazeCells, cols: number, rows: number, sx: number, sy: number) => number[][];
  navCells: MazeCells;
  cells: MazeCells;
  cols: number;
  rows: number;
  from: { x: number; y: number };
  target: { x: number; y: number };
  defaultLabel: string;
  doors: readonly NavDoor[];
  terminals: readonly NavTerminal[];
  servers: readonly NavServer[];
  keyLabel?: (keyId: number) => string;
}): TargetResolution {
  const { bfs, navCells, cells, cols, rows, from, defaultLabel, doors, terminals, servers } = params;
  let target = params.target;
  let label = defaultLabel;
  const labelForKey = params.keyLabel ?? ((k: number) => String.fromCharCode(65 + k));

  for (let iter = 0; iter < 5; iter++) {
    const navDist = bfs(navCells, cols, rows, target.x, target.y);
    // Directly reachable in open corridors
    if ((navDist[from.y]?.[from.x] ?? -1) >= 0) {
      return { target, label, locked: false };
    }

    // Unreachable in navCells: trace raw maze path to find the first locked door in the way
    const rawDist = bfs(cells, cols, rows, target.x, target.y);
    if ((rawDist[from.y]?.[from.x] ?? -1) < 0) {
      return { target, label, locked: true };
    }

    let cur = { ...from };
    let d = rawDist[cur.y]![cur.x]!;
    let blockedDoor: NavDoor | null = null;

    while (d > 0) {
      let moved = false;
      for (const step of STEPS) {
        const nx = cur.x + step.dx;
        const ny = cur.y + step.dy;
        const isOpenInCells = cells[cur.y]?.[cur.x]?.[step.dir] === true;
        if (isOpenInCells && rawDist[ny]?.[nx] === d - 1) {
          const isOpenInNav = navCells[cur.y]?.[cur.x]?.[step.dir] === true;
          if (!isOpenInNav) {
            blockedDoor =
              doors.find(
                (dr) =>
                  !dr.isOpen &&
                  ((dr.x === cur.x && dr.y === cur.y && dr.dir === step.dir) ||
                    (dr.x === nx && dr.y === ny && dr.dir === OPPOSITE_DIR[step.dir]))
              ) ??
              doors.find(
                (dr) => !dr.isOpen && ((dr.x === cur.x && dr.y === cur.y) || (dr.x === nx && dr.y === ny))
              ) ??
              null;
            break;
          }
          cur = { x: nx, y: ny };
          d--;
          moved = true;
          break;
        }
      }
      if (blockedDoor || !moved) break;
    }

    if (!blockedDoor) {
      return { target, label, locked: true };
    }

    const doorKey = blockedDoor.id;
    const keyName = labelForKey(doorKey);

    const terminal = terminals.find((t) => t.keyId === doorKey);
    if (terminal && !terminal.hacked) {
      target = { x: terminal.x, y: terminal.y };
      label = `Terminal ${keyName}`;
      continue;
    }

    const server = servers.find((s) => s.keyId === doorKey);
    if (server && !server.online) {
      target = { x: server.x, y: server.y };
      label = `Server ${keyName}`;
      continue;
    }

    return { target: { x: blockedDoor.x, y: blockedDoor.y }, label: `Door ${keyName}`, locked: false };
  }

  return { target, label, locked: false };
}

