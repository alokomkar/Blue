// Loading a level spec (shared/levelspec.ts) into the game: `?spec=<base64url of the JSON>` on localhost, and `window.__loadSpec(spec)` from the page. The pure parts live
// here: reading the URL's text, and turning a clamped spec into what startJob needs in place of a job number's choices (the place, layout, contract, twists, seed, and the
// sketch's walls). game.ts does the rest: it overlays the spec on the job's Difficulty with shared/levelspec.ts's specToDifficulty and builds as a Daily run would, so the same
// spec and seed build the same level (seeded.ts), and a scored run's rules (progress, carry-over, fail counts) never touch it.
//
// Type imports only, as the rest of src/client/game is: Node runs the unit tests over these files, and a client file can't import a value from shared without a .ts extension.

import type { ContractId, LayoutId, LevelSpec, PlaceId, SpecGrid, TwistId } from '../../shared/levelspec';
import type { Cell, MazeCells } from './maze';

/** The job whose rules a spec level is built under (what the carry-over, the tips and the story keys read): a mid-ladder one with everything a spec can ask for already in the game. */
export const SPEC_BASE_JOB = 8;

/** The most a `?spec=` value may be before it is read: a full 14 x 10 grid is about 14 KB of JSON. */
export const SPEC_PARAM_MAX = 96 * 1024;

export type Dir = 'N' | 'S' | 'E' | 'W';

/** Base64url (RFC 4648 section 5, no padding) of `value` as UTF-8 JSON. */
export function encodeSpecParam(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type DecodeResult = { ok: true; value: unknown } | { ok: false; error: string };

/** The JSON inside a `?spec=` value (base64url, or plain base64, or the JSON itself), or why it can't be read. Never throws. */
export function decodeSpecParam(text: string | null | undefined): DecodeResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'the spec is empty' };
  const raw = text.trim();
  if (raw.length > SPEC_PARAM_MAX) return { ok: false, error: `the spec is ${raw.length} characters; the most read is ${SPEC_PARAM_MAX}` };
  let json = raw;
  if (!raw.startsWith('{')) {
    if (!/^[A-Za-z0-9_\-+/]+={0,2}$/.test(raw)) return { ok: false, error: 'the spec is not base64url' };
    try {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return { ok: false, error: 'the spec is not valid base64url text' };
    }
  }
  try {
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch (e) {
    return { ok: false, error: `the spec is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
  }
}

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DIRS: readonly Dir[] = ['S', 'E', 'N', 'W'];

/** A sketch's walls as the game's cells (fresh objects each call: the game punches doorways in them). */
export function gridCells(grid: SpecGrid): MazeCells {
  return Array.from({ length: grid.rows }, (_, y) =>
    Array.from({ length: grid.cols }, (_, x): Cell => {
      const c = grid.cells[y * grid.cols + x]!;
      return { N: c.n, S: c.s, E: c.e, W: c.w };
    })
  );
}

/**
 * The way a lift (or the way out) standing in cell (x, y) faces: it stands with its back to a wall and its doors toward an opening, so an opening whose opposite wall is
 * shut. The generated floors' start is a corner against the outer wall, which always has one; a sketch's start or exit can be in a hall or a room, where it may not, and the
 * first opening is used (the lift then stands in a doorway: tell the Director to put them in dead ends or corners).
 */
export function liftFacing(cells: MazeCells, x: number, y: number): Dir {
  const c = cells[y]?.[x];
  if (!c) return 'S';
  return DIRS.find((d) => c[d] && !c[OPPOSITE[d]]) ?? DIRS.find((d) => c[d]) ?? 'S';
}

/** A number in [0, 1) from a seed alone (a hash, not Math.random), for the few choices that must not draw from the build's seeded stream, so the plan is the same the verifier builds. */
export function seedRoll(seed: number, salt = 0): number {
  let t = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** Everything startJob reads from a spec in place of a job number's choices. */
export type SpecJob = {
  spec: LevelSpec;
  /** The job number the level is built under (SPEC_BASE_JOB). */
  level: number;
  /** Seeds the build (seeded.ts): the same spec and seed, the same level. */
  seed: number;
  place: PlaceId;
  /** 'maze' is the plain maze; the others are layouts.ts's styles, for both floors. */
  layout: LayoutId;
  /** The spec's contract, or records if the game can't play it yet. */
  contract: ContractId;
  /** Forced: none is not "deal one". */
  twists: TwistId[];
  /** The side goal's roll, from the seed alone. */
  sideRoll: number;
  /** The sketch's walls, if the spec has them (the ground floor; the floor above, if any, is generated in `layout`). */
  grid: SpecGrid | null;
  title: string;
};

/** What a clamped spec asks of startJob. `playable` is contracts.ts's PLAYABLE. */
export function specJob(spec: LevelSpec, playable: ReadonlySet<ContractId>): SpecJob {
  return {
    spec,
    level: SPEC_BASE_JOB,
    seed: spec.seed >>> 0,
    place: spec.place,
    layout: spec.layout,
    contract: playable.has(spec.contract) ? spec.contract : 'records',
    twists: [...spec.twists],
    sideRoll: seedRoll(spec.seed, 7),
    grid: spec.grid ?? null,
    title: spec.title,
  };
}
