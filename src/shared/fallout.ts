// What a finished mission leaves behind: the pages it adds to the week's total, what
// went wrong (or right) and what security does about it, and what the next
// mission will carry in. The report card and the debrief say it; the next
// mission's letter and kit show it. Pure, so it's unit-tested under Node.

import type { RunOutcome } from './campaign';
import type { ContractId } from './contracts';

/** How a mission ended, for its fallout. */
export type MissionOutcome = {
  contract: ContractId;
  cleared: boolean;
  alarms: number;
  burned: boolean;
  /** The contract's own count (files photographed, charges planted...). */
  units: number;
  totalUnits: number;
};

/** Which of campaign.ts's outcomes it was. */
export function runOutcomeOf(o: MissionOutcome): RunOutcome {
  if (!o.cleared) return 'caught';
  if (o.burned) return 'burned';
  return o.alarms > 0 ? 'noisy' : 'clean';
}

/** Whether nothing was raised and nothing got away. */
export const quietRun = (o: MissionOutcome): boolean => o.cleared && !o.burned && o.alarms === 0;

/** Pages a mission adds to the week's total: what its contract brings out, and a page more for a clean run. Nothing if it failed. */
export function pagesFor(o: MissionOutcome): number {
  if (!o.cleared) return 0;
  const base: Record<ContractId, number> = { records: Math.max(1, o.totalUnits), sabotage: 3, vault: 4, hit: 3, blackout: 3, extract: 3, swap: 3, shipment: 3 };
  return base[o.contract] + (quietRun(o) ? 1 : 0);
}

export type Consequence = { tone: 'good' | 'bad' | 'neutral'; text: string };

export type Fallout = {
  outcome: RunOutcome;
  pages: number;
  /** What happened, and what it costs or buys. */
  consequences: Consequence[];
  /** What the next mission carries in. */
  expect: Consequence[];
};

/**
 * `what` is what the pages are (a records job's night's documents, "cargo manifests where the weights don't
 * add up"; another contract's own kind of evidence, contracts.ts); `expect` what the next mission carries in
 * (campaign.ts's describeCarry), which the caller works out for the ladder or the daily.
 */
export function falloutFor(o: MissionOutcome, what: string, expect: Consequence[]): Fallout {
  const outcome = runOutcomeOf(o);
  const pages = pagesFor(o);
  const c: Consequence[] = [];
  if (o.cleared) {
    c.push({ tone: 'good', text: `${pages} ${pages === 1 ? 'page' : 'pages'} added to the week’s total: ${what}` });
    if (quietRun(o)) c.push({ tone: 'good', text: 'Clean work: nobody knows anyone was inside' });
    if (o.alarms > 0) c.push({ tone: 'bad', text: `${o.alarms === 1 ? 'An alarm' : `${o.alarms} alarms`} raised: they know someone was inside` });
    if (o.burned) c.push({ tone: 'bad', text: 'The access logs went out: they know what you read' });
  } else {
    c.push({ tone: 'bad', text: 'Caught: nothing left the building, and nothing is added to the total' });
  }
  return { outcome, pages, consequences: c, expect };
}
