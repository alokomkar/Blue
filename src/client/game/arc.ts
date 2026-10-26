// The run: one trip from the bunker to the street. The bunker (The Sump) holds a dossier in one of its containers; reading it gives the address of the next target. The agent goes to that
// place's tower (collects the key cards), takes the heist door into its maze, and when the maze is done goes back out through the tower with a shoot-out (the exit level). This file is the
// spine of that: which stage the run is at, which place it is for, the address, which container holds the dossier, and how the run is saved. Pure (type-only imports, no runtime ones), so it is unit-tested under Node;
// game.ts reads it and advances it. See tasks/plan.md.

import type { LocationId } from './locations';

export type Stage = 'bunker' | 'tower' | 'maze' | 'exit' | 'done';
export const STAGES: readonly Stage[] = ['bunker', 'tower', 'maze', 'exit', 'done'];

/** The stage after `stage`; `done` is the end and stays. */
export function nextStage(stage: Stage): Stage {
  return STAGES[Math.min(STAGES.length - 1, STAGES.indexOf(stage) + 1)]!;
}

// ---- where it goes: the places, and the address of each ----

/** The place the bunker itself is dressed as (the lab): never the next target. */
export const BUNKER_PLACE: LocationId = 'lab';

export type Address = { /** The building. */ name: string; /** The street, and the part of town. */ street: string };

export const ADDRESSES: Readonly<Record<LocationId, Address>> = {
  campus: { name: 'Harbour Campus, Building 4', street: '1 Meridian Way, Harbour Park' },
  museum: { name: 'The Founders’ Hall', street: '12 Calder Street, Old Town' },
  refinery: { name: 'Tidewater Refinery', street: 'Plot 6, Tidewater Road' },
  bank: { name: 'Southern Sun Banking', street: '14 Exchange Row, Lower Mile' },
  warehouse: { name: 'Dockside Store 9', street: 'Berth 9, Pier Road' },
  lab: { name: 'Research Annex', street: '3 Foundry Lane, Eastgate' },
};

/** The places the run can go on to: every one but the bunker's own. */
export const TARGETS: readonly LocationId[] = (Object.keys(ADDRESSES) as LocationId[]).filter((p) => p !== BUNKER_PLACE);

/** A deterministic draw from a seed, 0 up to (not including) 1: the same seed, the same number. */
function draw(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The next target for a run seeded `seed`: one of the five places that are not the bunker's own. */
export function pickNextPlace(seed: number): LocationId {
  return TARGETS[Math.min(TARGETS.length - 1, Math.floor(draw(seed * 3 + 1) * TARGETS.length))]!;
}

// ---- the dossier ----

export type DossierPlan = { /** The storey it is on (1 to 3: never the first, so the agent has climbed at least one flight). */ level: number; /** Which of that storey's containers (by the order they are listed). */ container: number };

/** The first and last storey a dossier may be on. */
export const DOSSIER_LEVELS = { min: 1, max: 3 } as const;

/** Where the dossier is for a run seeded `seed`, given how many containers each storey has: a storey from 1 to 3 that has any, and one of its containers; null when none has. */
export function dossierPlan(seed: number, containersPerLevel: readonly number[]): DossierPlan | null {
  const levels: number[] = [];
  for (let l = DOSSIER_LEVELS.min; l <= Math.min(DOSSIER_LEVELS.max, containersPerLevel.length - 1); l++) if ((containersPerLevel[l] ?? 0) > 0) levels.push(l);
  if (levels.length === 0) return null;
  const level = levels[Math.min(levels.length - 1, Math.floor(draw(seed * 5 + 2) * levels.length))]!;
  const count = containersPerLevel[level]!;
  return { level, container: Math.min(count - 1, Math.floor(draw(seed * 7 + 3) * count)) };
}

/** The storeys that carry a clue system for a dossier on `level`: the bottom one up to the dossier's own (the last one points at the container). */
export function clueLevels(level: number): number[] {
  return Array.from({ length: level + 1 }, (_, l) => l);
}

// ---- the run itself, and saving it ----

/** Where a run's first level is: the underground bunker, or the outdoor dock yard. */
export type Site = 'bunker' | 'yard' | 'farm' | 'annex' | 'store' | 'depot';
export const SITES: readonly Site[] = ['bunker', 'yard', 'farm', 'annex', 'store', 'depot'];

/** The operations whose way out is their first level played the other way (from the lift at the top down to the one at the bottom, or from the truck to the gate), not the tower. */
export const REVERSE_EXIT_SITES: readonly Site[] = ['store', 'depot', 'yard', 'farm'];
/** A campaign run that is at its exit and goes out through its first level. */
export const reverseExit = (run: Pick<Run, 'stage' | 'site' | 'op'> | null | undefined): boolean => !!run && run.stage === 'exit' && !!run.op && REVERSE_EXIT_SITES.includes(run.site);

/** The first levels built on the open-air yard engine: the dock yard, and the Tank Farm laid on it. */
export const isYardSite = (s: string | null | undefined): s is 'yard' | 'farm' => s === 'yard' || s === 'farm';

/** The first levels built on the stacks engine (bunkerplan.ts's plans of the same names), the place each is dressed as, and what it is called. */
export type StackSite = 'annex' | 'store' | 'depot';
export const STACK_SITES: readonly StackSite[] = ['annex', 'store', 'depot'];
export const isStackSite = (s: string | null | undefined): s is StackSite => STACK_SITES.includes(s as StackSite);
export const SITE_PLACE: Readonly<Record<StackSite, LocationId>> = { annex: 'campus', store: 'museum', depot: 'bank' };
export const SITE_TITLE: Readonly<Record<StackSite, string>> = { annex: 'The Records Annex', store: 'The Founders’ Store', depot: 'The Armoured Depot' };

/** The site a seed's run starts at (the same seed, the same site; roughly half and half). */
export function pickSite(seed: number): Site {
  return draw(seed * 13 + 7) < 0.5 ? 'bunker' : 'yard';
}

export type Run = {
  seed: number;
  /** Where the run's first level is. */
  site: Site;
  stage: Stage;
  /** The place the dossier names (chosen when the run starts, known to the player once the dossier is read). */
  place: LocationId;
  /** The dossier has been read: the address is known. */
  found: boolean;
  /** The campaign's operation this run is (1 to 6, operations.ts); absent or 0 for a free run. */
  op?: number;
};

/** A new run, at the bunker, for the seed. */
export function newRun(seed: number): Run {
  return { seed, site: pickSite(seed), stage: 'bunker', place: pickNextPlace(seed), found: false };
}

/** The run moved on a stage. */
export function advance(run: Run): Run {
  return { ...run, stage: nextStage(run.stage) };
}

/** The address the run is going to. */
export const addressOf = (run: Run): Address => (run.op === CORE_OP ? CORE_ADDRESS : ADDRESSES[run.place]);

/** The last operation (operations.ts's CORE_OP: the same number, kept here so this file has no runtime imports). */
const CORE_OP = 6;

/** The last operation's address. */
export const CORE_ADDRESS: Address = { name: 'The Final Level', street: 'Beneath the Research Annex, 3 Foundry Lane, Eastgate' };

const PREFIX = 'run2';
/** A campaign run carries its operation as a seventh part. */
const PREFIX_OP = 'run3';

/** The run as a short string (for localStorage). */
export function encodeRun(run: Run): string {
  const parts = [run.seed, run.stage, run.place, run.found ? 1 : 0, run.site];
  return run.op ? [PREFIX_OP, ...parts, run.op].join('|') : [PREFIX, ...parts].join('|');
}

/** The run in a string, or null if it is not one (wrong shape, an unknown stage or place, a seed that is not a whole number). */
export function decodeRun(text: string | null | undefined): Run | null {
  if (!text) return null;
  const parts = text.split('|');
  // (A run saved before the yard existed has no site: it is the bunker's.)
  const old = parts[0] === 'run1' && parts.length === 5;
  const campaign = parts[0] === PREFIX_OP && parts.length === 7;
  if (!old && !campaign && !(parts[0] === PREFIX && parts.length === 6)) return null;
  const op = campaign ? Number(parts[6]) : 0;
  if (campaign && !(Number.isInteger(op) && op >= 1 && op <= CORE_OP)) return null;
  const seed = Number(parts[1]);
  const stage = parts[2] as Stage;
  const place = parts[3] as LocationId;
  const site = (old ? 'bunker' : parts[5]) as Site;
  if (!Number.isInteger(seed) || !STAGES.includes(stage) || !(place in ADDRESSES) || (parts[4] !== '0' && parts[4] !== '1') || !SITES.includes(site)) return null;
  return { seed, site, stage, place, found: parts[4] === '1', ...(op ? { op } : {}) };
}

// ---- the dossier's page ----

export type DossierPage = { kicker: string; title: string; body: string; note: string };

/** What each place's page says besides the address: where in the building the cards are held. */
const PAGE_DETAIL: Readonly<Record<LocationId, { title: string; cards: string; note: string }>> = {
  campus: { title: 'Next transfer: the atrium tower', cards: 'The atrium tower, four storeys round the lobby. The cards are on the gallery, in the back offices and at the security desk.', note: 'Note: the glass is thinner than it looks.' },
  museum: { title: 'Next transfer: the closed galleries', cards: 'The great hall and the galleries that are shut for the night. The cards are with the night curators.', note: 'Note: the archive is kept in the shut galleries.' },
  refinery: { title: 'Next transfer: the control block', cards: 'The control block over the pump hall. The cards are with the shift supervisors, one to a floor.', note: 'Note: expect heavy machinery noise.' },
  bank: { title: 'Next transfer: the banking hall', cards: 'The banking hall and the floors above it. The cards are in the manager’s offices and the records room.', note: 'Note: the vault is under the hall.' },
  warehouse: { title: 'Next transfer: dockside store 9', cards: 'The dock office and the loft over the racking. The cards are with the dispatchers.', note: 'Note: everything leaves by water.' },
  lab: { title: 'Next transfer: the research annex', cards: 'The annex over the clean rooms. The cards are with the duty scientists.', note: 'Note: the clean rooms are locked down at night.' },
};

/** The last operation's page. */
const CORE_DETAIL = {
  title: 'Final transfer',
  cards: 'The registry and the pass to the lower floor.',
  note: 'Note: this is the last stop.',
};

/** The page the dossier shows when it is read: the consignment order that names the next target and its address. */
export function dossierPage(run: Run, consignee?: string): DossierPage {
  const a = addressOf(run);
  const d = run.op === CORE_OP ? CORE_DETAIL : PAGE_DETAIL[run.place];
  const who = consignee ? `\n${consignee}\n` : '\n';
  const lead = run.op === CORE_OP ? 'The last entry in the registry is for:' : 'The next consignment goes to:';
  return { kicker: run.op === CORE_OP ? 'Registry' : 'Consignment order', title: d.title, body: `${lead}\n\n${a.name}\n${a.street}\n${who}${d.cards}`, note: d.note };
}

// ---- what the clue systems and the other containers say ----

const LEVEL_LABEL = ['LEVEL -3', 'LEVEL -2', 'LEVEL -1', 'GROUND'];
const CLUE_HEAD = ['ROSTER · NIGHT WATCH', 'ISSUE LOG · ARMOURY', 'PLANT LOG · REACTOR', 'GATE LOG · BLAST DOOR'];
const CORE_HEAD = ['REGISTRY · HALL A', 'REGISTRY · HALL B', 'REGISTRY · HALL C', 'REGISTRY · HALL D'];
const STORE_LABEL = ['THE CRATE STACKS', 'THE CLIMATE ROOM', 'THE CURATORS’ OFFICE'];
const STORE_HEAD = ['RECEIVING LOG · CRATE 14', 'CLIMATE LOG · ROOM A', 'CURATORS’ LOG · OFFICE'];
const DEPOT_LABEL = ['THE LOADING BAYS', 'THE PARKING DECK', 'THE ANTECHAMBER'];
const DEPOT_HEAD = ['GATE LOG · LANE 2', 'DECK LOG · BAY 7', 'VAULT LOG · ANTECHAMBER'];
const ANNEX_LABEL = ['THE READING ROOMS', 'THE SORTING ROOM', 'THE REGISTRY'];
const ANNEX_HEAD = ['READING LOG · ROOM 2', 'SORTING LOG · THE STACKS', 'REGISTRY LOG · THE VAULT'];
const FARM_LABEL = ['THE GATE', 'THE RACK ROW', 'THE PUMP HOUSE'];
const FARM_HEAD = ['GATE LOG · WEST BANK', 'RACK LOG · TRENCH', 'PUMP HOUSE LOG'];
const YARD_LABEL = ['THE GATE', 'THE EAST BANK', 'THE PORT OFFICE'];
const YARD_HEAD = ['GATE LOG · WEST BANK', 'DISPATCH LOG · BRIDGE', 'PORT OFFICE LOG'];

/** The screen of a clue system once it is hacked: its own log, and either where the log goes on to (the next storey, or the next console in the yard) or, at the last stop of the chain, the container. */
export function clueScreen(level: number, lastStop: number, site: Site = 'bunker', core = false): string[] {
  if (core) return level >= lastStop ? [CORE_HEAD[level] ?? 'REGISTRY', 'LAST ENTRY', 'ENTRY MARKED'] : [CORE_HEAD[level] ?? 'REGISTRY', 'ENTRY SIGNED OFF', 'REGISTRY CONTINUES'];
  const heads = site === 'farm' ? FARM_HEAD : site === 'yard' ? YARD_HEAD : site === 'annex' ? ANNEX_HEAD : site === 'store' ? STORE_HEAD : site === 'depot' ? DEPOT_HEAD : CLUE_HEAD;
  const labels = site === 'farm' ? FARM_LABEL : site === 'yard' ? YARD_LABEL : site === 'annex' ? ANNEX_LABEL : site === 'store' ? STORE_LABEL : site === 'depot' ? DEPOT_LABEL : LEVEL_LABEL;
  const head = heads[level] ?? 'FACILITIES LOG';
  if (level >= lastStop) return [head, 'CONSIGNMENT · LOT 12', 'CONTAINER MARKED'];
  return [head, 'ENTRY SIGNED OFF', `LOG CONTINUES · ${labels[level + 1] ?? 'ON'}`];
}

/**
 * The containers that can be opened at all: the dossier's, and a few decoys on the way to it (`decoysOn[level]` of each level's), picked by the seed; no other container offers to open.
 * `idsByLevel` lists the containers with a free door on each level (the yard has the one level).
 */
export function openableCrates(seed: number, idsByLevel: readonly (readonly string[])[], decoysOn: readonly number[], dossierId: string): Set<string> {
  const out = new Set<string>([dossierId]);
  idsByLevel.forEach((ids, level) => {
    const rank = (id: string): number => {
      let h = seed | 0;
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x9e3779b1) | 0;
      return draw(h);
    };
    const pool = ids.filter((id) => id !== dossierId).sort((a, b) => rank(a) - rank(b));
    for (const id of pool.slice(0, decoysOn[level] ?? 0)) out.add(id);
  });
  return out;
}

const NOTHING = ['NOTHING HERE · PACKING CRATES AND SPARES', 'EMPTY · THE LABEL WAS WRONG', 'SPARE UNIFORMS · NOT WHAT YOU ARE AFTER', 'FOAM AND STRAPS · NOTHING ELSE', 'A DEAD RADIO AND A BLANKET'];

/** What a container that is not the dossier's holds: nothing (most), or a tripwire that tells the squad (about one in four). Fixed for the run and the container. */
export function crateOutcome(seed: number, id: string): { kind: 'empty' | 'alarm'; text: string } {
  let h = seed | 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x45d9f3b) | 0;
  const r = draw(h);
  if (r < 0.25) return { kind: 'alarm', text: 'A TRIPWIRE · THE SQUAD HEARD THAT' };
  return { kind: 'empty', text: NOTHING[Math.floor(draw(h + 1) * NOTHING.length)]! };
}

// ---- what the run decides about a level ----

/** The bits of a query string the options read (a `URLSearchParams` has them). */
export type Query = { get(key: string): string | null };

export type RunOptions = {
  /** The place a tower is for (`?place=`, else the run's, once it has reached the tower or the way out); null: the job number's. */
  towerPlace: LocationId | null;
  /** The tower is the exit level (`?exit=1`, else the run is at its exit stage). */
  exit: boolean;
  /** The place the bunker is dressed as (`?place=`, else the lab). */
  bunkerPlace: LocationId;
  /** The place a maze job is held in (the run's, at its maze stage); null: the job number's. */
  mazePlace: LocationId | null;
  /** The run is the last operation (6), or `?core=1`: white lab dressing and white guards. */
  core: boolean;
};

const isPlace = (s: string | null): s is LocationId => s !== null && Object.prototype.hasOwnProperty.call(ADDRESSES, s);

/**
 * What the URL and the run say about the level being started. The URL always wins (it is how a level is looked at on its own); with none of its flags, the run says: the tower of the dossier's
 * place, the exit level on the way back out, the maze of that place in between. With no run either, nothing is forced and the job number decides, as it always did.
 */
export function runOptions(query: Query, run: Run | null): RunOptions {
  const asked = query.get('place');
  const urlPlace = isPlace(asked) ? asked : null;
  // (`?job=bunker&place=bank` dresses the bunker as the bank: it says nothing about the tower the run goes on to.)
  const bunkerUrl = query.get('job') === 'bunker';
  const exitAsked = query.get('exit');
  return {
    towerPlace: (bunkerUrl ? null : urlPlace) ?? (run && (run.stage === 'tower' || run.stage === 'exit') ? run.place : null),
    exit: exitAsked !== null ? exitAsked === '1' : run?.stage === 'exit',
    bunkerPlace: urlPlace ?? (run && (run.stage === 'bunker' || reverseExit(run)) && isStackSite(run.site) ? SITE_PLACE[run.site] : BUNKER_PLACE),
    mazePlace: run && run.stage === 'maze' ? run.place : null,
    core: query.get('core') === '1' || run?.op === CORE_OP,
  };
}

// ---- keeping it between levels ----
// The browser's storage, under one key; every access is guarded (storage can be blocked, and then the run is simply not remembered).

export const RUN_KEY = 'mazeHeist.run';

/** The kind of storage this reads and writes (`localStorage` is one). */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The saved run, or null (none, damaged, or storage blocked). */
export function loadRun(store: Store | null): Run | null {
  try {
    return decodeRun(store?.getItem(RUN_KEY));
  } catch {
    return null;
  }
}

/** Keep the run (after every stage change). */
export function saveRun(store: Store | null, run: Run): void {
  try {
    store?.setItem(RUN_KEY, encodeRun(run));
  } catch {
    // Storage blocked: the run holds for this visit only.
  }
}

/** Forget the run (a new game, or the end of one): the job number decides again. */
export function clearRun(store: Store | null): void {
  try {
    store?.removeItem(RUN_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

// ---- how each level went (for the finale) ----

export type LevelStat = { seconds: number; hits: number };
export type RunStats = Partial<Record<Stage, LevelStat>>;

export const STATS_KEY = 'mazeHeist.runStats';

/** The levels' stats so far (none, damaged or blocked storage: none). */
export function loadStats(store: Store | null): RunStats {
  try {
    const raw = JSON.parse(store?.getItem(STATS_KEY) ?? '{}') as Record<string, unknown>;
    const out: RunStats = {};
    for (const stage of STAGES) {
      const v = raw[stage] as Partial<LevelStat> | undefined;
      if (v && Number.isFinite(v.seconds) && Number.isFinite(v.hits)) out[stage] = { seconds: Math.max(0, v.seconds!), hits: Math.max(0, Math.floor(v.hits!)) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Keep how a level went (replacing an earlier try at it). */
export function noteStat(store: Store | null, stage: Stage, stat: LevelStat): void {
  try {
    store?.setItem(STATS_KEY, JSON.stringify({ ...loadStats(store), [stage]: stat }));
  } catch {
    // Storage blocked: the finale will only know the levels since the page loaded.
  }
}

export function clearStats(store: Store | null): void {
  try {
    store?.removeItem(STATS_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

const LEVEL_NAMES: Readonly<Record<'bunker' | 'tower' | 'maze' | 'exit', string>> = { bunker: 'The Sump', tower: 'The tower', maze: 'The heist', exit: 'The way out' };

/** The finale's table: a row for each level the run went through (time, and how often the agent was spotted or hit), then the total time. `time` formats seconds. */
export function finaleRows(stats: RunStats, time: (seconds: number) => string, site: Site = 'bunker', core = false): [string, string][] {
  const rows: [string, string][] = [];
  let total = 0;
  for (const stage of ['bunker', 'tower', 'maze', 'exit'] as const) {
    const v = stats[stage];
    if (!v) continue;
    total += v.seconds;
    rows.push([stage === 'bunker' && site === 'yard' ? 'The dock yard' : stage === 'bunker' && site === 'farm' ? 'The Tank Farm' : stage === 'bunker' && isStackSite(site) ? SITE_TITLE[site] : stage === 'bunker' && core ? 'The lab hall' : LEVEL_NAMES[stage], `${time(v.seconds)} · ${v.hits === 0 ? 'untouched' : `${v.hits} ${v.hits === 1 ? 'hit' : 'hits'}`}`]);
  }
  rows.push(['Total', time(total)]);
  return rows;
}
