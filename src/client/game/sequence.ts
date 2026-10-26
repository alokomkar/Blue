// The order a heist goes in: take the uplink down, photograph every file, wipe the access logs, leave. Each step
// is locked until the one before it is done, so no step can be skipped or done twice over: the workstations stay
// locked while the uplink is up, and the log console stays locked until the last file is in, since a wipe done
// early only has the later captures to be logged again. The log batch goes out a window after the *last* capture,
// not the first, so the wipe always has its full window once the files are in. Pure, so it's unit-tested under Node.

export type Locks = {
  /** The workstations can't be used: the uplink is still up. */
  capture: boolean;
  /** The log console can't be used: there are files still to photograph. */
  wipe: boolean;
};

/** What's locked, given whether the uplink is up and how many files are still to photograph. */
export function locksFor(uplinkOnline: boolean, filesLeft: number): Locks {
  return { capture: uplinkOnline, wipe: filesLeft > 0 };
}

/** When a batch of logs queued at `now` goes out, if it isn't wiped: a window after the latest capture. */
export function logDeadline(now: number, windowS: number): number {
  return now + windowS;
}

/** What the PDA's Logs row says about a queued batch: the clock, and while the console is still locked, that it is. */
export function queuedLogsText(clock: string, wipeLocked: boolean): string {
  return wipeLocked ? `After files · out in ${clock}` : `Out in ${clock}`;
}
