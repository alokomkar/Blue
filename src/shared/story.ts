// The briefing behind the Daily Heist. Each night the handler sends the player an encrypted message: tonight's target, the
// documents to take, and the mission's parameters. After the run, the handler writes back with how it went and names
// tomorrow's target. The site, the documents and the operation's name come from the day itself, so everyone playing
// tonight shares the same briefing, and tomorrow's is always known to tease. The Daily Heist runs as a weekly route
// (campaign.ts): each night is another site along it, and last night carries into tonight's letter. Pure (it takes the
// day's number, job, seed and chapter from daily.ts and campaign.ts rather than importing them), so it's unit-tested
// under Node.

import type { Carry, Figure, RunOutcome } from './campaign';
import type { ContractId } from './contracts';

/** Where a day falls in the weekly route (campaign.ts's caseFor). */
export type Chapter = { number: number; figure: Figure; night: number };

/** What story.ts needs to know about a day (daily.ts works it out; campaign.ts the chapter, for a daily). */
export type Day = { day: string; number: number; level: number; seed: number; chapter?: Chapter };

export type Agent = 'male' | 'female';

type Site = { name: string; what: string };

const SITES: readonly Site[] = [
  { name: 'Northgate Freight', what: 'a freight depot on the river docks' },
  { name: 'Daybreak Laboratories', what: 'a research lab on the edge of the city' },
  { name: 'Linden Holdings', what: 'a glass tower downtown' },
  { name: 'Meridian Data Services', what: 'a data center behind a nondescript front door' },
  { name: 'Linden Private Bank', what: 'a private bank with a very quiet vault' },
  { name: 'Harbour Security', what: 'the office that runs the private guards' },
  { name: 'Eastside Shipping', what: 'a shipping office that books the containers' },
  { name: 'Dawnline Construction', what: 'a construction firm with a site office on the bridge' },
];

const DOCUMENTS: readonly string[] = [
  'account ledgers',
  'shipping manifests',
  'payment records',
  'inspection reports',
  'board minutes',
  'payroll sheets',
  'company registrations',
  'signed contracts',
];

const OPERATIONS: readonly string[] = [
  'Nightjar',
  'Glasshouse',
  'Lantern',
  'Ledger',
  'Quiet Hour',
  'Copper',
  'Keystone',
  'Moth',
  'Undertow',
  'Silver Line',
  'Longshadow',
  'Blindside',
];

/** What the briefing warns about, by the job the day plays: the new threat it brings in (difficulty.ts). */
const INTEL: Record<number, string> = {
  3: 'They’ve brought in robot watchdogs that hunt by sound. Walk softly.',
  4: 'Part of the building has lost power. There’s night vision in your kit.',
  5: 'Expect crawler mines in the corridors, and doors that open in a chain.',
  6: 'Your kit is light tonight: no EMP charges. You’ll find some in the lockers.',
  7: 'Drones watch from above. Only an EMP will bring one down.',
  8: 'The watchdogs hunt in packs now. Find where they meet.',
  9: 'Heavy enforcers guard the server rooms. Stagger one before you strike.',
  10: 'The wiring here runs in circuits, each with a breaker panel. Cut one and a whole stretch goes dark.',
};

const pick = <T>(list: readonly T[], seed: number, salt: number): T => list[(((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0) % list.length)]!;

export type Operation = {
  day: string;
  number: number;
  name: string;
  site: Site;
  documents: string;
  intel: string | null;
  /** The Daily Heist's place in its weekly route; null for a job on the ladder. */
  chapter: Chapter | null;
};

/**
 * The day's operation, the same for everyone: a night of the week's route
 * when the day has a chapter (the Daily Heist), otherwise picked from the
 * seed (a job on the ladder).
 */
export function operationFor(d: Day): Operation {
  const intel = INTEL[d.level] ?? null;
  if (d.chapter) {
    const night = d.chapter.figure.nights[d.chapter.night]!;
    return {
      day: d.day,
      number: d.number,
      name: `Operation ${OPERATIONS[(d.chapter.number - 1) % OPERATIONS.length]!}`,
      site: night.site,
      documents: night.files,
      intel,
      chapter: d.chapter,
    };
  }
  return {
    day: d.day,
    number: d.number,
    name: `Operation ${pick(OPERATIONS, d.seed, 1)}`,
    site: pick(SITES, d.seed, 2),
    documents: pick(DOCUMENTS, d.seed, 3),
    intel,
    chapter: null,
  };
}

/** Each night of a week, as the letter opens it: Monday starts the route, Sunday ends it. */
const CHAPTER_LINES: ReadonlyArray<(f: Figure, at: string, files: string) => string> = [
  (f, at, files) => `A new week on ${f.alias}. It starts tonight at ${at}. Inside: ${files}.`,
  (_f, at, files) => `Tonight: ${at}. Inside: ${files}.`,
  (_f, at, files) => `Tonight: ${at}. Inside: ${files}. Expect more doors than usual.`,
  (_f, at, files) => `Tonight: ${at}. Inside: ${files}. They’ll be ready for you.`,
  (_f, at, files) => `Tonight: ${at}. Inside: ${files}. It won’t be there tomorrow.`,
  (_f, at, files) => `Tonight: ${at}. Inside: ${files}.`,
  (f, at, files) => `The last night on ${f.alias}: ${at}. Bring out ${files} and the week is done.`,
];

/** What last night carries into tonight's letter (campaign.ts's carryOver). */
const CARRY_LINES: Record<Carry['kind'], string | null> = {
  perk: 'Last night was clean, and it bought us a favour: our contact inside has marked their network closet and log room on your blueprint, and slipped an extra EMP charge into your kit.',
  watch: 'Last night was loud. They’re jumpier now: guards will make you faster.',
  alert: 'Last night went wrong, and security is on alert: guards will make you faster, and the logs go out sooner.',
  missed: 'We missed you last night.',
  none: null,
};

/** The same, for a job on the ladder, where it's the last job you cleared, not last night. */
const JOB_CARRY_LINES: Record<Carry['kind'], string | null> = {
  perk: 'The last job was clean, and it bought us a favour: our contact inside has marked their network closet and log room on your blueprint, and slipped an extra EMP charge into your kit.',
  watch: 'The last job was loud. They’re jumpier now: guards will make you faster.',
  alert: 'The last job’s logs got away, and security is on alert: guards will make you faster, and the logs go out sooner.',
  missed: null,
  none: null,
};

/**
 * The operation for job `job` on the ladder: the same letter every time that
 * job is played (a retry reads what the first attempt did), from the job
 * number rather than the day.
 */
export function jobOperation(job: number): Operation {
  let seed = 0x811c9dc5;
  for (const ch of `blueprint-job-ladder:${job}`) {
    seed ^= ch.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193);
  }
  return operationFor({ day: '', number: job, level: job, seed: seed >>> 0 });
}

/** How the handler addresses the player: "Mr. name" or "Ms. name" by the agent they play; "Agent" when there's no name. */
export function salutation(agent: Agent | null, username: string | null): string {
  if (!username) return 'Agent';
  return `${agent === 'female' ? 'Ms.' : 'Mr.'} ${username}`;
}

/** The words a contract's letter and debrief use. */
export type ContractWords = {
  /** The paragraph in the letter that says what to do. */
  task: string;
  /** The first line of the letter's list of parameters, for `units` units. */
  goal: (units: number) => string;
  /** The debrief's line for how far it got: `done` of `total`. */
  tally: (done: number, total: number) => string;
  /** Whether the job has access logs to wipe (only a records job does). */
  logs: boolean;
};

const NO_LOGS = (task: string, goal: (n: number) => string, tally: (d: number, t: number) => string): ContractWords => ({ task, goal, tally, logs: false });

export const CONTRACT_WORDS: Record<ContractId, ContractWords> = {
  records: {
      task: 'Nothing leaves the building on paper. Take their uplink offline first: the workstations stay locked while it’s up. Then photograph the files on your PDA at the workstations. Every file you open is written to the log server, and the logs go out in the next batch: wipe them before the timer runs out, or they will know exactly what we read.',
      goal: (n) => `Photograph ${n === 1 ? 'the file' : `all ${n} files`}.`,
      tally: (d, t) => `Files: ${d} of ${t} photographed.`,
      logs: true,
    },
  sabotage: NO_LOGS(
      'Nothing leaves the building on paper tonight: this one is about what stays behind. Take their alarm link down first, so nobody can call it in. Then plant a charge on each of the three tanks and pumps your PDA marks. The moment the last is set the fuse is lit, and you will have ninety seconds to be gone.',
      () => 'Plant all three charges.',
      (d, t) => `Charges: ${d} of ${t} planted.`
    ),
  vault: NO_LOGS(
      'This is a vault, and a vault wants a key. Take their alarm link down first. One guard on the ground floor carries the keycard, and your PDA marks him: take it off him. It opens the vault at the console in the vault hall, and the ledger is inside. Take it, and walk out.',
      () => 'Take the keycard, open the vault, take the ledger.',
      (d, t) => `Vault: ${d} of ${t} steps done.`
    ),
  hit: NO_LOGS('Take their alarm link down first, then do what the PDA asks, and leave.', () => 'Finish the job.', (d, t) => `Steps: ${d} of ${t} done.`),
  blackout: NO_LOGS('Take their alarm link down first, then cut the breakers your PDA marks, and leave.', () => 'Cut the breakers.', (d, t) => `Breakers: ${d} of ${t} cut.`),
  extract: NO_LOGS(
      'There is a live sample in this lab, and it has to leave the building alive. Take their alarm link down first. Then lift the specimen out of its cryo pod. It is fragile: with it in your arms you can’t run, grapple or drag a body, and it warms the longer you take, until it spoils and has to be fetched again. Carry it to the way out.',
      () => 'Get the specimen out intact.',
      (d, t) => (d >= t ? 'Specimen: delivered.' : 'Specimen: not delivered.')
    ),
  swap: NO_LOGS(
      'We are not taking anything from this museum: we are leaving something behind. Take their alarm link down first. One guard carries the keycard to the case in the great hall, and your PDA marks him: take it off him. Swap the exhibit for our forgery, and walk out. Nobody should notice for days.',
      () => 'Swap the exhibit for the forgery.',
      (d, t) => `Swap: ${d} of ${t} steps done.`
    ),
  shipment: NO_LOGS(
      'The cargo we want is in one of four containers, and the manifest says which. Take their alarm link down first. Read the manifest at the dispatch console, then plant our tracker on the container it names. Force the wrong one and its lock trips an alarm.',
      () => 'Tag the right container.',
      (d, t) => `Shipment: ${d} of ${t} steps done.`
    ),
};

/** A box in the letter: a rule that changes for this job. */
export type LetterNote = { title: string; text: string; /** The note says what is, or isn't, there tonight, so the job's own intel line (a threat that isn't there) is left out. */ noIntel?: true };

/** A job's side goal as the letter puts it: its name, exactly what is asked, and what it pays. */
export type SideBrief = { name: string; ask: string; bonus: number };

/** A mission parameter, and (in the debrief) whether it was met. */
export type Parameter = { text: string; met?: boolean };

export type Letter = {
  kicker: string;
  greeting: string;
  paragraphs: string[];
  parameters: Parameter[];
  /** What the list is called, where it isn't "Mission parameters" (arc.ts's choice). */
  parametersTitle?: string;
  /** Notes from the handler that change the rules for this job (a twist, the laser gates), each shown in a box of its own. */
  notes?: LetterNote[];
  closing: string;
};

/** What can replace a job's usual opening (arc.ts): the paragraph that opens its letter, an optional signature, and an optional fixed target. */
export type Arc = { opening: string; signature?: string; name?: string; site?: Site; documents?: string };

/**
 * Tonight's message from the handler, before the run. `mode`: the Daily Heist's
 * scored attempt, a replay once it's spent (read again, run for practice),
 * a guest who isn't logged in (practice only), or a job on the ladder.
 */
export function briefing(
  op: Operation,
  documents: number,
  agent: Agent | null,
  username: string | null,
  mode: 'scored' | 'replay' | 'guest' | 'job' = 'scored',
  carry: Carry | null = null,
  arc: Arc | null = null,
  contract: ContractId = 'records',
  side: SideBrief | null = null,
  notes: readonly LetterNote[] = []
): Letter {
  const words = CONTRACT_WORDS[contract];
  const docs = documents === 1 ? 'one document' : `${documents} documents`;
  const intel = op.intel && !notes.some((n) => n.noIntel) ? ` ${op.intel}` : '';
  // What the last mission carries in: the style of the run, then what its contract left behind.
  const carried = carry ? [(mode === 'job' ? JOB_CARRY_LINES : CARRY_LINES)[carry.kind], ...carry.notes].filter((l): l is string => Boolean(l)) : [];
  const opening = op.chapter
    ? [`${CHAPTER_LINES[op.chapter.night]!(op.chapter.figure, `${op.site.name}, ${op.site.what}`, op.documents)}${intel}`]
    : [
        arc?.opening ?? 'We’re contacting you because you come highly recommended.',
        `Tonight’s target is ${(arc?.site ?? op.site).name}, ${(arc?.site ?? op.site).what}. Inside are ${docs}: ${arc?.documents ?? op.documents}. Get them out.${intel}`,
      ];
  return {
    kicker: `Encrypted message · ${arc?.name ?? op.name} · ${mode === 'job' ? `Job ${op.number}` : `${nightLabel(op)}Daily Heist #${op.number}`}`,
    greeting: `Good evening, ${salutation(agent, username)}.`,
    ...(notes.length ? { notes: [...notes] } : {}),
    paragraphs: [
      ...opening,
      ...carried,
      words.task,
      ...(side ? [`There is a bonus in it as well, if you want it. ${side.ask} Do that and it is worth +${side.bonus} heist points on top. Miss it and the job still counts.`] : []),
    ],
    parameters: [
      { text: words.goal(documents) },
      ...(words.logs ? [{ text: 'Wipe the access logs before they go out.' }] : []),
      { text: 'Get out without being caught.' },
      { text: 'Keep a low profile: raise no alarms.' },
      ...(side ? [{ text: `Bonus · ${side.name}: ${side.ask} (+${side.bonus} heist points)` }] : []),
    ],
    closing: {
      scored: 'You get one attempt tonight. The rest of your instructions follow once you accept.',
      replay: 'Your one scored attempt tonight is spent. You can run it again, but only for practice.',
      guest: 'Log in to Reddit to run it for the record. You can still run it for practice.',
      job: `The rest of your instructions follow once you accept. Good luck.${arc?.signature ? ` ${arc.signature}` : ''}`,
    }[mode],
  };
}

/** "Night 3 of 7 · " for a night of a week; nothing otherwise. */
function nightLabel(op: Operation): string {
  return op.chapter ? `Night ${op.chapter.night + 1} of 7 · ` : '';
}

/** How a run went, for the debrief. */
export type Outcome = {
  cleared: boolean;
  documents: number;
  totalDocuments: number;
  alarms: number;
  /** The access logs went out before they were wiped. */
  burned: boolean;
};

/**
 * The handler's reply after the run: how it went, the parameters marked, and
 * tomorrow's target. On the week's last night, `week` (how this week's
 * earlier nights went, campaign.ts) closes the week with a tally.
 */
export function debrief(
  op: Operation,
  tomorrow: Operation,
  outcome: Outcome,
  agent: Agent | null,
  username: string | null,
  week: readonly RunOutcome[] = [],
  fragment: string | null = null,
  contract: ContractId = 'records',
  side: { name: string; kept: boolean; bonus: number } | null = null
): Letter & { verdict: 'flawless' | 'noisy' | 'burned' | 'failed' } {
  const who = salutation(agent, username);
  const quiet = outcome.alarms === 0;
  const verdict = !outcome.cleared ? 'failed' : outcome.burned ? 'burned' : quiet ? 'flawless' : 'noisy';
  const words = CONTRACT_WORDS[contract];
  const records = contract === 'records';
  const lines: Record<typeof verdict, string> = {
    flawless: `Flawless. In and out, and nobody knows anyone was inside ${op.site.name}. Work like that buys us a favour from our contact tomorrow.`,
    burned: `${records ? 'We have the files' : 'The job is done'}, but the access logs went out. they know exactly what we read at ${op.site.name}, and they’ll be on alert tomorrow.`,
    noisy: `${records ? 'The files are ours' : 'The job is done'}, but it was loud. they know someone was inside ${op.site.name}, and they’ll be jumpier tomorrow.`,
    failed: `We lost you. security got to you before the job was done at ${op.site.name}, and they’ll be on alert tomorrow.`,
  };
  const paragraphs = [lines[verdict]];
  if (op.chapter?.night === 6) paragraphs.push(caseTally(op.chapter.figure, [...week, verdict === 'flawless' ? 'clean' : verdict === 'failed' ? 'caught' : verdict]));
  // A closing field note ends each week.
  if (op.chapter?.night === 6 && fragment) paragraphs.push(`Field note: ${fragment}`);
  const next = tomorrow.chapter;
  return {
    verdict,
    kicker: `Debrief · ${op.name} · ${nightLabel(op)}Daily Heist #${op.number}`,
    greeting: `${who},`,
    paragraphs,
    parameters: [
      { text: words.tally(outcome.documents, outcome.totalDocuments), met: outcome.cleared },
      ...(words.logs ? [{ text: outcome.burned ? 'The access logs went out.' : 'Access logs wiped.', met: outcome.cleared && !outcome.burned }] : []),
      { text: outcome.cleared ? 'Got out without being caught.' : 'Caught.', met: outcome.cleared },
      { text: quiet ? 'No alarms raised.' : `${outcome.alarms === 1 ? 'An alarm' : `${outcome.alarms} alarms`} raised.`, met: outcome.cleared && quiet },
      ...(side && outcome.cleared ? [{ text: side.kept ? `Bonus · ${side.name}: kept (+${side.bonus} heist points).` : `Bonus · ${side.name}: missed.`, met: side.kept }] : []),
    ],
    closing:
      next?.night === 0
        ? `Tomorrow a new week opens: ${next.figure.name}. Rest up.`
        : `Tomorrow: ${tomorrow.site.name}, ${tomorrow.site.what}. Rest up.`,
  };
}

/** The week closed: how many of its seven nights the player ran, and how many clean. */
function caseTally(figure: Figure, nights: readonly RunOutcome[]): string {
  const ran = nights.filter((o) => o !== 'missed').length;
  const clean = nights.filter((o) => o === 'clean').length;
  const record = `This week you ran ${ran === 7 ? 'all seven nights' : `${ran} of the seven nights`}${clean ? `, ${clean === ran ? 'every one of them' : clean} clean` : ''}.`;
  return `That closes the week on ${figure.name}. ${record} ${clean >= 5 ? 'Excellent work.' : ran >= 5 ? 'Solid work.' : 'Thin, but it’s a start.'}`;
}
