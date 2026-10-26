// The campaign: six operations in a fixed order, one run each. An operation fixes where the run goes (the place, the site of its first level), who stands at its exit
// (the director), what the dossier names as consignee, and what the building says over its address system on the way out. Pure (type-only imports), so it is
// unit-tested under Node; arc.ts holds the run itself (`Run.op` is the operation's number, 0 for a free run) and game.ts plays it.

import type { LocationId } from './locations';
import type { Run, Site, Store } from './arc';

/** The final operation (the number is 6; the name is kept for the callers). */
export const CORE_OP = 6;

export type Operation = {
  /** 1 to 6, in the order they are played. */
  n: number;
  place: LocationId;
  /** Where its first level is (the Records Annex for 1, the Museum Store for 2, the dock yard for 3, the Tank Farm for 4, the Armoured Depot for 5, the Lab Hall for 6). */
  site: Site;
  /** The face of its exit level. */
  director: { name: string; title: string };
  /** What the place does for a living. */
  front: string;
  /** What the agents carry out. */
  caseItem: string;
  /** A short label for the operation's report. */
  labReveal: string;
  /** The line on the dossier's page after the address: who the consignment is for. */
  consignee: string;
  /** What the building says over its address system on the way out: one line as the exit begins, one at each wave, one at the lobby. */
  pa: { open: string; wave: readonly string[]; lobby: string };
  /** The line on the finale's page: what the capture did to the director. */
  debrief: string;
  /** The handler's words in the scenes: the call-in before the first level, the line after the maze, the line after the exit (null: the final operation's exit ends the run). */
  said: { call: string; upload: string; street: string | null };
};

export const OPERATIONS: readonly Operation[] = [
  {
    n: 1,
    place: 'campus',
    site: 'annex',
    director: { name: 'Pat Alder', title: 'the Records Director' },
    front: 'A records office',
    caseItem: 'The records file',
    labReveal: 'Report 1',
    consignee: 'Consignee: P. Alder, Records',
    pa: {
      open: 'Close the atrium. Nobody leaves with the file.',
      wave: ['Every floor, every door. Hold them on the stairs.', 'Security to the records annex.'],
      lobby: 'The street is closed. Put the file down.',
    },
    debrief: 'Alder has some questions to answer about the file.',
    said: { call: 'Reach the target, take what you came for, get out. Below you is a sheet of paper. Find it.', upload: 'The file is yours. Read it, then move.', street: 'Good work. The next address is ready.' },
  },
  {
    n: 2,
    place: 'museum',
    site: 'store',
    director: { name: 'Ines Marlowe', title: 'the Curator' },
    front: 'A museum and its private collection',
    caseItem: 'The loan papers',
    labReveal: 'Report 2',
    consignee: 'Consignee: I. Marlowe, Acquisitions',
    pa: {
      open: 'The galleries are closed to visitors. All of them.',
      wave: ['Mind the exhibits. They are worth more than you are.', 'Take the stairs, not the paintings.'],
      lobby: 'The hall is sealed. The portraits are watching.',
    },
    debrief: 'Marlowe kept the papers in the frames. Every frame is now an exhibit.',
    said: { call: 'The papers are in the store. Take them and go.', upload: 'You have them. Keep moving.', street: 'Good work. Two down.' },
  },
  {
    n: 3,
    place: 'warehouse',
    site: 'yard',
    director: { name: 'Sam Crowe', title: 'the Harbourmaster' },
    front: 'A freight yard on the docks',
    caseItem: 'The manifest',
    labReveal: 'Report 3',
    consignee: 'Consignee: S. Crowe, Dockside',
    pa: {
      open: 'Lock the gates. Nothing leaves this berth tonight.',
      wave: ['Cranes down. Clear the lanes between the stacks.', 'Whatever is in those containers stays in them.'],
      lobby: 'The tide is out and so are you. Stay where you are.',
    },
    debrief: 'Crowe counted the containers by hand. The number is on record.',
    said: { call: 'Tonight the paper is in the yard, in the open. No ceilings, nowhere to hide but each other.', upload: 'The manifest is in your hands. Get it out of the yard.', street: 'The yard is behind you. On to the next.' },
  },
  {
    n: 4,
    place: 'refinery',
    site: 'farm',
    director: { name: 'Dr. Anna Reyes', title: 'the Plant Chemist' },
    front: 'A refinery and its control block',
    caseItem: 'The process ledgers',
    labReveal: 'Report 4',
    consignee: 'Consignee: A. Reyes, Process Control',
    pa: {
      open: 'Seal the control block. Vent the lower floors if you must.',
      wave: ['That is not a drill. Heavies to the pump hall.', 'Do not let the file past the flare stack.'],
      lobby: 'The plant is on lockdown. Every exit is a pressure door.',
    },
    debrief: 'Reyes has stopped answering questions about the ledgers.',
    said: { call: 'The order is in the tank farm. Find it and bring it out.', upload: 'Ledgers in hand. Move out.', street: 'Four down. Stay sharp.' },
  },
  {
    n: 5,
    place: 'bank',
    site: 'depot',
    director: { name: 'Mira Holt', title: 'the Branch Manager' },
    front: 'A bank and its transit depot',
    caseItem: 'The vault registry',
    labReveal: 'Report 5',
    consignee: 'Consignee: M. Holt, Registry',
    pa: {
      open: 'The vault has been breached. Close the banking hall.',
      wave: ['Every account on that floor is frozen. So are you.', 'Security to the mezzanine. Now.'],
      lobby: 'The hall is closed for the night. You are not leaving.',
    },
    debrief: 'Holt balanced every account in the registry, except one.',
    said: { call: 'The registry is in the depot vault. Pull it and go.', upload: 'The registry is yours. Get out.', street: 'Five down. One to go.' },
  },
  {
    n: CORE_OP,
    place: 'lab',
    site: 'bunker',
    director: { name: 'Col. Dana Rhodes', title: 'the Head of Security' },
    front: 'A research lab and its sample hall',
    caseItem: 'The lab samples',
    labReveal: 'Report 6',
    consignee: 'Consignee: Colonel D. Rhodes',
    pa: {
      open: 'Intruders in the lab. Release the white guard.',
      wave: ['Second wave. Bring them down floor by floor.', 'Third wave. Leave nothing standing.'],
      lobby: 'I know every step you took to get here. Come down.',
    },
    debrief: 'Rhodes has been exposed and relieved of command.',
    said: { call: 'Last one. Get in, get the samples, get out.', upload: 'The samples are secure. Time to go.', street: null },
  },
];

/** The operation `n` (1 to 6), or null for a free run (0) or a number outside the six. */
export function operationFor(n: number): Operation | null {
  return OPERATIONS.find((o) => o.n === n) ?? null;
}

/** Whether `n` is the final operation. */
export const isCore = (n: number): boolean => n === CORE_OP;

/** The operation a run is on, or null for a free run. */
export function operationOf(run: Pick<Run, 'op'>): Operation | null {
  return operationFor(run.op ?? 0);
}

/** A new run for operation `n` (1 to 6): at its first level, going to its place, starting at its site. Falls back to operation 1 for a number outside the six. */
export function operationRun(seed: number, n: number): Run {
  const op = operationFor(n) ?? OPERATIONS[0]!;
  return { seed, site: op.site, stage: 'bunker', place: op.place, found: false, op: op.n };
}

// ---- how far the campaign has got ----

export const OPS_KEY = 'mazeHeist.ops';

/** How many operations are cleared (0 to 6): none, damaged or blocked storage reads as 0. */
export function opsCleared(store: Store | null): number {
  try {
    const n = Number(store?.getItem(OPS_KEY) ?? 0);
    return Number.isInteger(n) ? Math.max(0, Math.min(OPERATIONS.length, n)) : 0;
  } catch {
    return 0;
  }
}

/** Keep that operation `n` is cleared (a lower number than already cleared is ignored: replaying the first never takes the campaign back). */
export function noteCleared(store: Store | null, n: number): void {
  try {
    store?.setItem(OPS_KEY, String(Math.max(opsCleared(store), Math.min(OPERATIONS.length, Math.max(0, Math.floor(n))))));
  } catch {
    // Storage blocked: the campaign is only remembered for this visit.
  }
}

/** The operation to play next, given how many are cleared: the one after the last cleared; null when all six are done (then free runs). */
export function nextOperation(cleared: number): number | null {
  return cleared >= OPERATIONS.length ? null : Math.max(0, Math.floor(cleared)) + 1;
}

/** What the exit level's address system says: `line` 0 is the one as the exit begins, 1 and up are the waves' (the last repeats if there are more waves than lines), -1 is the lobby's. */
export function paLine(op: Operation, line: number): string {
  if (line < 0) return op.pa.lobby;
  if (line === 0) return op.pa.open;
  return op.pa.wave[Math.min(op.pa.wave.length - 1, line - 1)] ?? op.pa.open;
}
