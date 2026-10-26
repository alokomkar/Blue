// A twist: one thing about a job that changes how it plays, whatever its contract. Story mode gives each job from the fourth on one, going round the list;
// the Daily Heist gives its building two, drawn from the day's seed (so everyone gets the same two), with a budget so the pair is hard but never a wall. Each is
// either built into the job (an extra blackout, an extra guard, a lighter kit) or happens during it (the doors lock down, the patrols change shift, the clock runs
// out). Here: which twists there are, what each costs, how a job is dealt them, and the settings and timings they change. Pure, so it's unit-tested under Node.

import type { ContractId } from '../../shared/contracts';

export type TwistId = 'shiftchange' | 'lockdown' | 'lightsout' | 'reinforcements' | 'lightkit' | 'timer' | 'silent';

export type Twist = {
  id: TwistId;
  /** On the HUD chip. */
  name: string;
  /** Said as the job starts. */
  brief: string;
  /** How much of a Daily's budget it takes. */
  cost: 1 | 2;
  /** When it happens, in job seconds, for the ones that happen during the job. */
  at?: number;
  /** How long it lasts, in seconds, for the ones that last. */
  lasts?: number;
};

export const TWISTS: Record<TwistId, Twist> = {
  shiftchange: { id: 'shiftchange', name: 'SHIFT CHANGE', brief: 'A MINUTE AND A HALF IN, THE PATROLS CHANGE SHIFT AND TAKE NEW ROUTES. WHAT YOU LEARNED OF THEIR ROUNDS STOPS HOLDING', cost: 1, at: 90 },
  lockdown: { id: 'lockdown', name: 'LOCKDOWN', brief: 'AT SEVENTY SECONDS EVERY ROOM DOOR LOCKS DOWN FOR TWENTY: NOWHERE TO HIDE, AND NOTHING TO WORK IN, UNTIL THEY RELEASE', cost: 2, at: 70, lasts: 20 },
  lightsout: { id: 'lightsout', name: 'LIGHTS OUT', brief: 'THE POWER IS FAILING: MORE OF THE BUILDING IS DARK TONIGHT. NIGHT VISION AND A STEADY HAND', cost: 2 },
  reinforcements: { id: 'reinforcements', name: 'REINFORCEMENTS', brief: 'THE SITE CALLED IN EXTRA: ONE MORE GUARD ON EACH FLOOR AND A DOG', cost: 2 },
  lightkit: { id: 'lightkit', name: 'LIGHT KIT', brief: 'YOU CAME IN LIGHT: NO TRAPS AND NO FLASH GRENADES. THE STUN GUN, THE EMP AND YOUR NERVE', cost: 1 },
  silent: { id: 'silent', name: 'SILENT NIGHT', brief: 'NO GUARDS TONIGHT, ONLY DOGS, AND THEY HUNT BY EAR. YOU CAN’T WALK OR RUN: CROUCH OR CRAWL, AND EVERY STEP CARRIES. STAND STILL TO STAY QUIET, EVEN WITH A DOG ON TOP OF YOU', cost: 2 },
  timer: { id: 'timer', name: 'ON THE CLOCK', brief: 'THERE IS A WINDOW: WHEN IT CLOSES THE ALARM GOES UP WHEREVER YOU ARE', cost: 2 },
};

export const TWIST_IDS = Object.keys(TWISTS) as TwistId[];

/** The order story mode deals them in, from job 4. */
const ROTATION: readonly TwistId[] = ['shiftchange', 'lockdown', 'lightkit', 'silent', 'lightsout', 'reinforcements', 'timer'];

/** The first job with a twist: the early ones teach the contract and the kit without anything else on top. */
export const FIRST_TWIST_JOB = 4;

/** Story mode: job `level`'s twist (none before the fourth job), going round the list, so no two jobs running share one. */
export function storyTwist(level: number, contract: ContractId = 'records'): TwistId[] {
  if (level < FIRST_TWIST_JOB) return [];
  const start = (Math.floor(level) - FIRST_TWIST_JOB) % ROTATION.length;
  // The next one along that the job's contract can take (a fuse can't be outrun on tiptoe).
  for (let k = 0; k < ROTATION.length; k++) {
    const id = ROTATION[(start + k) % ROTATION.length]!;
    if (fitsContract(id, contract)) return [id];
  }
  return [];
}

/** Whether a twist can sit on a contract: a sabotage's 90 s fuse has to be outrun, and nobody outruns anything in a silent night. */
export function fitsContract(id: TwistId, contract: ContractId): boolean {
  return !(id === 'silent' && contract === 'sabotage');
}

/** The most a Daily's twists can cost between them. */
export const DAILY_BUDGET = 4;

/** Pairs that are unfair together: a clock and a lockdown both take the player's time, and a light kit on top of reinforcements is a siege. */
const CLASH: ReadonlyArray<readonly [TwistId, TwistId]> = [
  ['timer', 'lockdown'],
  ['lightkit', 'reinforcements'],
  ['timer', 'reinforcements'],
  // A silent night has no guards to shift, reinforce or race, and half the pace for a clock.
  ['silent', 'shiftchange'],
  ['silent', 'reinforcements'],
  ['silent', 'timer'],
];

/** Whether two twists may share a job. */
export const mayShare = (a: TwistId, b: TwistId): boolean => a !== b && !CLASH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** A Daily's two twists, drawn with `rnd` (the day's seeded random): distinct, within the budget, and not a clashing pair. */
export function dailyTwists(rnd: () => number, contract: ContractId = 'records'): TwistId[] {
  const pool = TWIST_IDS.filter((id) => fitsContract(id, contract));
  const first = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
  const fits = pool.filter((id) => mayShare(first, id) && TWISTS[first].cost + TWISTS[id].cost <= DAILY_BUDGET);
  const second = fits[Math.floor(rnd() * fits.length)];
  return second ? [first, second] : [first];
}

/** The ones that happen at a moment of the job, with when. */
export function timedTwists(twists: readonly TwistId[]): Array<{ id: TwistId; at: number; lasts: number }> {
  return twists.flatMap((id) => (TWISTS[id].at !== undefined ? [{ id, at: TWISTS[id].at!, lasts: TWISTS[id].lasts ?? 0 }] : []));
}

/** The clock's window for a job with `contract`, in seconds: long enough that a clean run has several minutes in hand. */
export const TIMER_S: Record<ContractId, number> = { records: 330, sabotage: 360, vault: 390, hit: 330, blackout: 330, extract: 330, swap: 330, shipment: 330 };

/** What the briefing says about each twist in the letter, in a box of its own: the rule that changes, in plain words. */
export const TWIST_NOTES: Record<TwistId, { title: string; text: string; noIntel?: true }> = {
  shiftchange: { title: 'Shift change', text: 'A minute and a half in, the guards change shift and take new routes. Whatever you learned of their rounds stops holding: be ready to watch them again.' },
  lockdown: { title: 'Lockdown', text: 'At seventy seconds every room door locks down for twenty. You can’t hide in a room or work in one until it releases, so don’t be caught in the open.' },
  lightsout: { title: 'Lights out', text: 'The power is failing: more of the building is dark tonight. Night vision and a steady hand.' },
  reinforcements: { title: 'Reinforcements', text: 'The site called in extra: one more guard on every floor, and a dog.' },
  lightkit: { title: 'Light kit', text: 'You are going in light: no traps and no flash grenades. The stun gun, the EMP and your nerve.' },
  timer: { title: 'On the clock', text: 'There is a window. When it closes the alarm goes up wherever you are, so work to the clock in the corner.' },
  silent: {
    noIntel: true, // the night's usual guards and drones aren't there
    title: 'Silent night',
    text: 'No guards tonight. Only dogs, and they hunt by ear. You cannot walk or run: you crouch, or you crawl (the crouch key swaps between the two). Every step carries: a crouch is heard two cells away, a crawl less than one, and standing still is silent. A ring on the floor shows how far you can be heard. Go slowly, stop when they near, and if one is on top of you, freeze: stand perfectly still and it only sniffs. One step and it has you. Never fire the gun.',
  },
};

/** What a job's settings become under `twists` (difficulty.ts's Difficulty fields by name). */
export type TwistedCounts = { guards: number; watchdogs: number; blackouts: number; blackoutCells: number; trapsAtStart: number; flashes: number | null };

/** Dogs on each floor of a silent night: enough that the corridors are never empty of listening. */
export const SILENT_DOGS = 2;
/** And the floor stays this size at most: the pace is half, so the building shrinks to match. */
export const SILENT_MAX_COLS = 10;
export const SILENT_MAX_ROWS = 7;

export function applyTwists<T extends Omit<TwistedCounts, 'flashes'>>(base: T, twists: readonly TwistId[]): T & { flashes: number | null } {
  let out: T & { flashes: number | null } = { ...base, flashes: null };
  for (const id of twists) {
    if (id === 'lightsout') out = { ...out, blackouts: out.blackouts + 2, blackoutCells: out.blackoutCells + 8 };
    if (id === 'reinforcements') out = { ...out, guards: out.guards + 1, watchdogs: out.watchdogs + 1 };
    if (id === 'lightkit') out = { ...out, trapsAtStart: 0, flashes: 0 };
    if (id === 'silent') out = { ...out, guards: 0, watchdogs: Math.max(out.watchdogs, SILENT_DOGS) };
  }
  return out;
}

/** A ready line for the HUD chip: the names, joined. */
export const chipText = (twists: readonly TwistId[]): string => twists.map((id) => TWISTS[id].name).join(' · ');
