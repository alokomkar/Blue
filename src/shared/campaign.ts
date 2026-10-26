// The Daily Heist as a weekly run of jobs. Each week (Monday to Sunday, UTC) is one route: seven nights, each hitting another
// site along it, up to Sunday's night at the last one. The daily jobs rise through the week the same way (daily.ts's DAILY_LEVELS),
// so the week climbs with them.
//
// And each night carries into the next: a clean run buys a perk, a loud or burned one puts the sites on alert. Carry-overs
// only touch what doesn't change the building (how fast guards react, the
// log timer, the kit, what's marked on the blueprint), so everyone still
// plays the same maze on the same day.
//
// Pure (type-only imports), so it's unit-tested under Node.

import type { DailyResult } from './daily';
import type { ContractId } from './contracts';

/** A site on a week's route, as the briefing describes it. */
export type Place = { name: string; what: string };

/** One of the seven nights of a week: where, and what's there to photograph. */
export type Night = { site: Place; files: string };

/** A week's route: seven sites in order. */
export type Figure = {
  name: string;
  /** What the route is called in the daily post. */
  alias: string;
  /** Monday to Sunday. */
  nights: readonly [Night, Night, Night, Night, Night, Night, Night];
};

const night = (name: string, what: string, files: string): Night => ({ site: { name, what }, files });

export const FIGURES: readonly Figure[] = [
  {
    name: 'The Harbour Route',
    alias: 'the Harbour Route',
    nights: [
      night('Northgate Freight', 'a freight depot on the river docks', 'cargo manifests where the weights don’t add up'),
      night('the Pier 9 cold store', 'a refrigerated warehouse on the quay', 'the store’s log of what goes in and out'),
      night('the Harbour Authority', 'the port office on the waterfront', 'the berth allocation ledger'),
      night('Eastside Shipping', 'the office that books the containers', 'the bookings the system deletes every night'),
      night('Tidewater Customs', 'a customs broker on the quay', 'the stamps for inspections that never happened'),
      night('Harbour Security', 'the dock police office', 'the patrol rosters'),
      night('the Anchor Tower', 'the harbour-front tower', 'the master contract file'),
    ],
  },
  {
    name: 'The Finance Route',
    alias: 'the Finance Route',
    nights: [
      night('Linden Private Bank', 'a quiet branch that handles large cash accounts', 'deposits too large for the accounts they land in'),
      night('Goldline Exchange', 'a currency exchange that never closes its books', 'the exchanges that move money offshore'),
      night('Linden’s head office', 'where the bank keeps a private vault', 'the offshore account ledgers'),
      night('Meridian Data Services', 'the data centre that backs up the bank', 'the backups they now take every hour'),
      night('Blackwell Secure Transport', 'the armoured car depot', 'the routes of tonight’s cash run'),
      night('the family office', 'where the books are kept off the network', 'the list of payments to officials'),
      night('Linden Holdings', 'the glass tower downtown', 'the master ledger'),
    ],
  },
  {
    name: 'The Research Route',
    alias: 'the Research Route',
    nights: [
      night('Daybreak Laboratories', 'a research lab on the edge of the city', 'trial results with the bad ones missing'),
      night('the Daybreak distribution centre', 'where the labs’ output is packed and shipped', 'shipping records for batches that were never approved'),
      night('the private lab', 'a lab only two people have keys to', 'the formulas behind the recalls'),
      night('the Daybreak archive', 'where the labs’ records are backed up', 'the originals of the reports that were rewritten'),
      night('Meridian Cold Chain', 'a courier that moves samples between labs', 'the sample logs of tonight’s transfer'),
      night('the research wing', 'where the trials are run', 'falsified safety reports, signed'),
      night('the Institute', 'the foundation on the hill', 'the letters ordering the cover-up'),
    ],
  },
];

const DAY_MS = 86_400_000;
/** Week #1 opens on this Monday, the first full week of the Daily Heist. Days before it have no route. */
export const CASE_EPOCH = '2026-09-28';

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Where `day` falls in the serial: which week, which route, and which of its seven nights (0 = Monday); null before week #1. */
export function caseFor(day: string): { number: number; figure: Figure; night: number } | null {
  const days = Math.floor((dayMs(day) - dayMs(CASE_EPOCH)) / DAY_MS);
  if (days < 0) return null;
  const week = Math.floor(days / 7);
  return { number: week + 1, figure: FIGURES[week % FIGURES.length]!, night: days % 7 };
}

/** A day's place in the week, for the daily post's title: "The Harbour Route, night 1 of 7"; null before week #1. */
export function caseLine(day: string): string | null {
  const c = caseFor(day);
  return c && `${c.figure.alias.charAt(0).toUpperCase()}${c.figure.alias.slice(1)}, night ${c.night + 1} of 7`;
}

// ---- how a night went, and what it carries into the next ----

/**
 * How a night's scored run went: clean (out with no alarm and the logs
 * wiped), noisy (out, but alarms went up), burned (out, but the logs got
 * away), caught, unfinished (started, never finished), or missed.
 */
export type RunOutcome = 'clean' | 'noisy' | 'burned' | 'caught' | 'unfinished' | 'missed';

export function outcomeOf(started: boolean, result: DailyResult | null): RunOutcome {
  if (!result) return started ? 'unfinished' : 'missed';
  if (!result.cleared) return 'caught';
  if (result.burned) return 'burned';
  return (result.alarms ?? 0) > 0 ? 'noisy' : 'clean';
}

/** What last night carries into tonight: a perk, the sites on alert, or nothing. */
export type Carry = {
  kind: 'perk' | 'watch' | 'alert' | 'missed' | 'none';
  /** Added to how long a guard takes to be sure it's seen you (negative: faster). */
  reactionS: number;
  /** Added to the log window (negative: the logs go out sooner). */
  logWindowS: number;
  /** Extra EMP charges in the kit. */
  extraEmp: number;
  /** The network closet and the log room are marked on the blueprint from the start. */
  markNetwork: boolean;
  /** Patrol guards on each floor, more or fewer (a floor keeps at least one). */
  guards: number;
  /** Extra traps in the kit. */
  extraTraps: number;
  /** This many locked doors start open. */
  openDoors: number;
  /** Extra blacked-out patches (no power, so guards see less far). */
  darkSections: number;
  /** The breaker panels are marked on the blueprint from the start. */
  markBreakers: boolean;
  /** What the last contract's result adds, in the briefing's words (the style's own line is `kind`'s). */
  notes: string[];
  /** Part of this is the help a job gives after it has beaten you a few times (easeFor), not a favour from the last one. */
  eased: boolean;
};

export const NO_CARRY: Carry = { kind: 'none', reactionS: 0, logWindowS: 0, extraEmp: 0, markNetwork: false, guards: 0, extraTraps: 0, openDoors: 0, darkSections: 0, markBreakers: false, notes: [], eased: false };

/**
 * What a cleared contract leaves behind for the next job, whatever the style of the run: each contract pays
 * off in its own way, small enough not to change the building (only who's in it, how long the lights hold,
 * and what's in the kit).
 */
export function contractCarry(contract: ContractId | null | undefined): Partial<Carry> {
  switch (contract) {
    case 'sabotage':
      return { guards: -1, darkSections: 1, notes: ['The supply lines are cut: a guard short on every floor, and part of the next building has no power.'] };
    case 'vault':
      return { extraEmp: 1, extraTraps: 1, notes: ['The vault paid for it: an extra EMP charge and an extra trap in your kit.'] };
    case 'hit':
      return { openDoors: 1, notes: ['The stolen card still works: one locked door starts open.'] };
    case 'extract':
      return { reactionS: 0.2, notes: ['The sample bought a favour: guards are slower to be sure of you.'] };
    case 'swap':
      return { logWindowS: 30, notes: ['The forged papers hold: the next job’s logs go out 30 seconds later.'] };
    case 'shipment':
      return { markNetwork: true, notes: ['The manifest names the route: the next building’s network rooms are marked on your blueprint.'] };
    case 'blackout':
      return { markBreakers: true, notes: ['You mapped their wiring: every breaker panel is marked on your blueprint.'] };
    default:
      return {};
  }
}

/** Two carry-overs together: numbers add, marks combine, notes join (the first's kind stands unless it's none). */
export function mergeCarry(a: Carry, b: Partial<Carry>): Carry {
  return {
    kind: a.kind !== 'none' ? a.kind : (b.kind ?? 'none'),
    reactionS: a.reactionS + (b.reactionS ?? 0),
    logWindowS: a.logWindowS + (b.logWindowS ?? 0),
    extraEmp: a.extraEmp + (b.extraEmp ?? 0),
    markNetwork: a.markNetwork || (b.markNetwork ?? false),
    guards: a.guards + (b.guards ?? 0),
    extraTraps: a.extraTraps + (b.extraTraps ?? 0),
    openDoors: a.openDoors + (b.openDoors ?? 0),
    darkSections: a.darkSections + (b.darkSections ?? 0),
    markBreakers: a.markBreakers || (b.markBreakers ?? false),
    notes: [...a.notes, ...(b.notes ?? [])],
    eased: a.eased || (b.eased ?? false),
  };
}

/** A job that has beaten you this many times in a row starts to give a little. */
export const EASE_AFTER = 2;

/**
 * The help a ladder job gives after `fails` failed tries in a row (nothing before EASE_AFTER): slower guards, a
 * longer window on the logs, and a fuller kit, growing over the next two tries and then holding. The building
 * itself never changes, so it's the same job, just more forgiving.
 */
export function easeFor(fails: number): Partial<Carry> {
  if (!Number.isFinite(fails) || fails < EASE_AFTER) return {};
  const step = Math.min(Math.floor(fails) - EASE_AFTER + 1, 3);
  return {
    eased: true,
    reactionS: [0.25, 0.4, 0.55][step - 1]!,
    logWindowS: [15, 25, 40][step - 1]!,
    extraEmp: step === 3 ? 2 : 1,
    extraTraps: step === 3 ? 1 : 0,
    guards: step === 1 ? 0 : -1,
  };
}

/** Whether a night's outcome got out of the building with the job done. */
export const clearedOutcome = (o: RunOutcome | null | undefined): boolean => o === 'clean' || o === 'noisy' || o === 'burned';

/** What a carry-over changes, as short lines for the report and the mission-start list. */
export function describeCarry(c: Carry): Array<{ tone: 'good' | 'bad'; text: string }> {
  const out: Array<{ tone: 'good' | 'bad'; text: string }> = [];
  if (c.extraEmp) out.push({ tone: 'good', text: `+${c.extraEmp} EMP ${c.extraEmp === 1 ? 'charge' : 'charges'} in your kit` });
  if (c.extraTraps) out.push({ tone: 'good', text: `+${c.extraTraps} ${c.extraTraps === 1 ? 'trap' : 'traps'} in your kit` });
  if (c.markNetwork) out.push({ tone: 'good', text: 'Network rooms marked on your blueprint' });
  if (c.markBreakers) out.push({ tone: 'good', text: 'Breaker panels marked on your blueprint' });
  if (c.openDoors) out.push({ tone: 'good', text: c.openDoors === 1 ? 'A locked door starts open' : `${c.openDoors} locked doors start open` });
  if (c.guards < 0) out.push({ tone: 'good', text: `${-c.guards} fewer ${-c.guards === 1 ? 'guard' : 'guards'} on each floor` });
  if (c.darkSections > 0) out.push({ tone: 'good', text: c.darkSections === 1 ? 'A stretch of the building has no power' : `${c.darkSections} stretches have no power` });
  if (c.guards > 0) out.push({ tone: 'bad', text: `${c.guards} more ${c.guards === 1 ? 'guard' : 'guards'} on each floor` });
  if (c.reactionS > 0) out.push({ tone: 'good', text: 'Guards are slower to be sure of you' });
  if (c.logWindowS > 0) out.push({ tone: 'good', text: `The logs go out ${c.logWindowS} s later` });
  if (c.reactionS < 0) out.push({ tone: 'bad', text: 'Guards react faster' });
  if (c.logWindowS < 0) out.push({ tone: 'bad', text: `The logs go out ${-c.logWindowS} s sooner` });
  return out;
}

/**
 * Tonight's carry-over from last night's outcome (null: no account, so
 * nothing carries). Missing a night is only remarked on when the player
 * ran an earlier night of this week's route (`week`, Monday first).
 */
export function carryOver(lastNight: RunOutcome | null, week: readonly RunOutcome[] = [], contract?: ContractId | null): Carry {
  const style = ((): Carry => {
    switch (lastNight) {
      case 'clean':
        return { ...NO_CARRY, kind: 'perk', extraEmp: 1, markNetwork: true };
      case 'noisy':
        return { ...NO_CARRY, kind: 'watch', reactionS: -0.15 };
      case 'burned':
      case 'caught':
        return { ...NO_CARRY, kind: 'alert', reactionS: -0.15, logWindowS: -15 };
      case 'missed':
      case 'unfinished':
        return week.some((o) => o !== 'missed') ? { ...NO_CARRY, kind: 'missed' } : NO_CARRY;
      default:
        return NO_CARRY;
    }
  })();
  // A contract only pays off when it was carried out.
  return clearedOutcome(lastNight) ? mergeCarry(style, contractCarry(contract)) : style;
}

/**
 * What the ladder carries from the last job you cleared into the next one (a job that ended in getting caught
 * carries nothing: a retry isn't made harder for it, as a missed night is).
 */
export function ladderCarry(outcome: RunOutcome | null, contract?: ContractId | null): Carry {
  return clearedOutcome(outcome) ? carryOver(outcome, [], contract) : NO_CARRY;
}
