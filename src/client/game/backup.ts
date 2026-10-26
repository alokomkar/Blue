// Backup for a fallen guard. A camera that has a downed guard in its view for a moment calls it in: another guard comes down on a line round a corner from the body, out of its sight, lands crouched,
// creeps up to look at it (it cannot revive it), and then goes looking for the agent, a few steps off from where they are, every few seconds, until it sees them or gives up.
// The rules here: how long a camera must watch a body, which cell the backup drops into, and where it looks for the agent. Pure, so it is unit-tested under Node; game.ts does the dropping.

/** A camera must keep a body in its view this long before it calls for backup. */
export const CAMERA_BODY_S = 1;
/** Between two calls for backup on a floor, and how many backups may be about at once on it. */
export const BACKUP_GAP_S = 20;
export const BACKUP_MAX = 3;
/** The drop, in metres, from the ceiling to the floor. */
export const BACKUP_DROP_M = 4;
/** How far from the body, in cells' walk (a cell is 4 m), the backup comes down, and how near the agent it may do so, in metres. */
export const DROP_MIN_CELLS = 2;
export const DROP_MAX_CELLS = 5;
export const DROP_AGENT_MIN_M = 10;
/** Once it has seen to the body it looks for the agent for this long, re-aiming this often, at a spot within this many cells of where they are. */
export const SEARCH_FOR_S = 45;
export const SEARCH_EVERY_S = 6;
export const SEARCH_FUZZ_CELLS = 3;

export type DropCandidate = { x: number; y: number; /** Cells' walk from the body. */ fromBody: number; /** The body has a line to this cell. */ seesBody: boolean; /** Metres from the agent. */ fromAgent: number; /** The agent has a line to it. */ seenByAgent: boolean };

/** The cell the backup drops into: round a corner from the body (a few cells' walk, no line to it), not in the agent's face, and out of the agent's sight if there is such a cell. `pick` is a draw in 0..1. */
export function pickDropCell(cells: readonly DropCandidate[], pick: number): DropCandidate | null {
  const ok = cells.filter((c) => c.fromBody >= DROP_MIN_CELLS && c.fromBody <= DROP_MAX_CELLS && !c.seesBody && c.fromAgent >= DROP_AGENT_MIN_M);
  const hidden = ok.filter((c) => !c.seenByAgent);
  const pool = hidden.length > 0 ? hidden : ok;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(pick * pool.length))]!;
}

/** Whether a call for backup may go out now: nobody called lately on this floor, and not too many are about already. */
export function mayCallBackup(sinceLast: number, about: number): boolean {
  return sinceLast >= BACKUP_GAP_S && about < BACKUP_MAX;
}

/** Where it looks for the agent next: a cell within the fuzz of theirs (`a` and `b` are draws in 0..1: the way round, and how far out). */
export function searchCell(agent: { x: number; y: number }, a: number, b: number): { x: number; y: number } {
  const ang = a * Math.PI * 2;
  const r = b * SEARCH_FUZZ_CELLS;
  return { x: Math.round(agent.x + Math.cos(ang) * r), y: Math.round(agent.y + Math.sin(ang) * r) };
}
