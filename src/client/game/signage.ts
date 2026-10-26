// Writing on the bunker: what the floors, the walls and the containers say, the ID each container wears, and the model name and serial number each guard, dog and alpha carries on its back. Everything
// here is text and rules (pure, so it is unit-tested under Node); signs.ts places it and signrender.ts draws it.
//
// The voice is a facilities department: lane markings, procedure signs, freight stencils. A line or two of dry office humour (a counter that never moves, a slogan in small print),
// kept faint: the place reads as a real site first.

/** A deterministic draw from a seed: the same seed, the same number in 0..1. */
export function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One of `list`, by a seed. */
export const pick = <T>(list: readonly T[], seed: number): T => list[Math.min(list.length - 1, Math.floor(rand(seed) * list.length))]!;

// ---- the text ----

export const LEVEL_CODES = ['B-3', 'B-2', 'B-1', 'G'] as const;
export const LEVEL_TITLES = ['SUB-BASEMENT', 'STORES', 'PLANT', 'EGRESS'] as const;

/** Lane and zone markings on the floor of a hall. */
export const HALL_FLOOR: readonly string[] = ['EGRESS ROUTE', 'KEEP CLEAR', 'PEDESTRIANS', 'FORKLIFT ONLY', 'NO PARKING', 'MIND THE GATE'];

/** Procedure and warning plates on the walls (a heading, and the line under it). */
export const PLATES: ReadonlyArray<readonly string[]> = [
  ['HARD HAT AREA'],
  ['NO LONE WORKING'],
  ['MIND YOUR HEAD', 'AC DUCT OVERHEAD'],
  ['AUTHORISED ONLY', 'BREACH LOGGED'],
  ['KEEP DOORS CLOSED'],
  ['SITE FACILITIES', 'DO NOT ALTER'],
  ['EYE PROTECTION', 'REQUIRED BEYOND THIS POINT'],
  ['REPORT DAMAGE TO', 'FACILITIES · EXT 4471'],
  ['COOLANT', 'LOOP 3 · LINE 12'],
  ['FIRE ASSEMBLY POINT', 'GROUND FLOOR'],
];

/** What a room is called on its door and over its floor. */
export const ROOM_NAMES: Readonly<Record<string, string>> = { Z1: 'BARRACKS 2', Z2: 'ARMOURY', Z3: 'LAB 4', Z4: 'CONTROL', Z5: 'REACTOR HALL', Z6: 'BLAST DOOR' };

/** The faint ones: said once or twice a level, small. */
export const LORE_FLOOR: readonly string[] = ['MIND THE STEP', 'WORK SAFE, GO HOME SAFE'];
export const LORE_PLATE: ReadonlyArray<readonly string[]> = [['DAYS SINCE LAST INCIDENT', '000'], ['YOU ARE HERE', 'FLOOR PLAN B'], ['ASK AT THE DESK']];

/** The cargo a container is marked with. */
export const CARGO: readonly string[] = ['NORTHGATE FREIGHT', 'COLD STORE', 'SPARES', 'MEDICAL', 'ARCHIVE', 'LOT 12', 'RECORDS', 'POWER PLANT'];
export const HANDLING: readonly string[] = ['THIS WAY UP', 'KEEP DRY', 'FRAGILE', 'MAX GROSS 30,480 KG', 'SEAL BEFORE TRANSIT'];

// ---- container IDs (ISO 6346: owner code, serial, check digit) ----

const LETTER_VALUES: Readonly<Record<string, number>> = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };

/** The check digit of an ISO 6346 container code: the owner and category letters and the six digits (such as 'DCUU447112'), without the digit itself. */
export function checkDigit(code: string): number {
  let sum = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    sum += (c >= '0' && c <= '9' ? Number(c) : LETTER_VALUES[c]!) * 2 ** i;
  }
  return (sum % 11) % 10;
}

/** The ID painted on container `n` of level `level`: 'DCU 447112 3' (owner, six digits, check digit). Unique for each `n`, and the same every time. */
export function containerId(level: number, n: number): string {
  const serial = String(100000 + ((level * 7919 + n * 104729 + 31) % 900000)).padStart(6, '0');
  const owner = 'DCU';
  return `${owner} ${serial.slice(0, 6)} ${checkDigit(`${owner}U${serial}`)}`;
}

/** The size and type code stencilled by the ID. */
export const SIZE_CODE = '45G1';

// ---- guards, dogs and alphas ----

export type TagKind = 'guard' | 'sentry' | 'hunter' | 'heavy' | 'dog' | 'alpha';

/** The model each kind of guard is, as the site names it. */
export const MODEL_NAMES: Readonly<Record<TagKind, string>> = {
  guard: 'WARDEN W-3',
  sentry: 'BASTION B-2',
  hunter: 'REAPER R-1',
  heavy: 'BULWARK H-9',
  dog: 'HOUND K9-6',
  alpha: 'ALPHA VII',
};

export type Tag = { model: string; serial: string };

/** The serial for the `n`th of a kind this run: five digits, never repeated within the kind, the same each time for the same `seed`. */
export function tagFor(kind: TagKind, n: number, seed = 0): Tag {
  const stride = 7919;
  const base = Math.floor(rand(seed * 31 + kind.length * 17) * 90000);
  const serial = String((base + n * stride) % 100000).padStart(5, '0');
  return { model: MODEL_NAMES[kind], serial };
}

let counters: Record<string, number> = {};
let tagSeed = 0;
/** Starts the numbering again (a new job): the same job, the same serials. */
export function resetTags(seed: number): void {
  counters = {};
  tagSeed = seed;
}
/** The next tag of a kind. */
export function nextTag(kind: TagKind): Tag {
  const n = (counters[kind] = (counters[kind] ?? 0) + 1);
  return tagFor(kind, n, tagSeed);
}
