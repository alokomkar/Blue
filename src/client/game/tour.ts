// Recon: a fly-over at the start of a job (and again on request) that shows where
// the objectives are and the way out: the camera rises off the agent, visits each
// stop in turn, holding at each until the player presses Next, and settles back
// behind them. Here, the parts that need no scene: which stops, in what order,
// what's said at each, and how long a flight takes. game.ts flies the camera,
// lights the ground, and puts up the captions. Type-free of three.js,
// so it's unit-tested under Node.

export type TourKind = 'uplink' | 'files' | 'logs' | 'stairs' | 'exit';

/** A place worth seeing: its floor (0 the ground floor) and world position. */
export type TourSpot = {
  kind: TourKind;
  floor: number;
  x: number;
  z: number;
  files?: number;
  /** A contract's own station (objectives.ts): what it is called and what it is for, in place of the records room's words. */
  title?: string;
  text?: string;
  /** The uplink is the alarm link on this job (a contract that is not records). */
  alarm?: boolean;
};
export type TourShot = TourSpot & { title: string; text: string };

/** Crossing to the other floor counts as this many metres, when working out which stop is nearest. */
const FLOOR_COST = 40;

const cost = (a: { floor: number; x: number; z: number }, b: { floor: number; x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z) + (a.floor === b.floor ? 0 : FLOOR_COST);

/**
 * The stops in the order the camera visits them: the nearest first, then the nearest to that, and so on
 * (the fewest sweeps back and forth), the stairs just before the tour first goes up or down, and the way
 * out always last.
 */
export function orderTour<T extends TourSpot>(spots: readonly T[], from: { floor: number; x: number; z: number }): T[] {
  const exit = spots.find((s) => s.kind === 'exit');
  const stairs = spots.find((s) => s.kind === 'stairs');
  const left = spots.filter((s) => s.kind !== 'exit' && s.kind !== 'stairs');
  const out: T[] = [];
  let at: { floor: number; x: number; z: number } = from;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (cost(at, left[i]!) < cost(at, left[best]!)) best = i;
    const next = left.splice(best, 1)[0]!;
    if (stairs && next.floor !== at.floor && !out.includes(stairs)) out.push(stairs);
    out.push(next);
    at = next;
  }
  if (exit) out.push(exit);
  return out;
}

/** What the caption says at a stop. */
export function describe(spot: TourSpot): { title: string; text: string } {
  switch (spot.kind) {
    case 'uplink':
      return spot.alarm
        ? { title: 'The alarm link', text: 'Take it down first, so nobody can call it in: until it is, every station stays locked.' }
        : { title: 'The uplink', text: 'Take it down first: until it is, every station stays locked and nothing can be done.' };
    case 'files':
      if (spot.title && spot.text) return { title: spot.title, text: spot.text };
      return { title: 'Records room', text: spot.files === 1 ? 'A file to photograph here.' : `${spot.files ?? 'Some'} files to photograph here.` };
    case 'logs':
      return { title: 'The log server', text: 'Wipe the access logs after a capture, before they go out.' };
    case 'stairs':
      return { title: 'The stairs', text: 'The way up. There’s more to do on the next floor.' };
    case 'exit':
      return { title: 'Your way out', text: 'The way out opens once the job is done. Get back here to leave.' };
  }
}

// ---- the flights ----

const FLY_MIN_S = 1.2;
const FLY_MAX_S = 2.4;
const FLY_S_PER_M = 0.04;

/** How long the camera takes to fly `metres` from where it was to the next stop: quick, but never a jump cut. */
export function flyDuration(metres: number): number {
  return Math.min(FLY_MAX_S, Math.max(FLY_MIN_S, FLY_MIN_S + metres * FLY_S_PER_M));
}

/** What the recon says at a contract's station, by what it is. A container never says whether it is the shipment. */
export function stationText(kind: string, letter?: string): string {
  switch (kind) {
    case 'cryo':
      return 'The specimen is in here. Lift it out, then carry it to the way out.';
    case 'charge':
      return 'A charge goes here. Plant all three, then run before the fuse.';
    case 'swapCase':
      return 'The exhibit. Swap it for the forgery, once you have the keycard.';
    case 'vaultConsole':
      return 'The vault console. It wants the keycard.';
    case 'ledger':
      return 'The ledger is in the vault. Open it first.';
    case 'manifest':
      return 'Read the manifest here to learn which container holds the shipment.';
    case 'tracker':
      return `Container ${letter ?? ''}: one of the four holds the shipment. The manifest says which.`.replace('  ', ' ');
    default:
      return 'Something to do here.';
  }
}
