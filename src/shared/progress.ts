import type { Agent, BestRun, Grade, Hairstyle, LastRun, Look, Profile, ProfileUpdate, SaveRequest, SuitColour } from './api';
import type { RunOutcome } from './campaign';
import type { ContractId } from './contracts';
import type { Ending } from './arc';

export const EMPTY_BEST: BestRun = { bestJob: 0, bestScore: 0 };

// Loose sanity bounds on client-reported values. Scores are client-side
// (the game runs in the browser), so these only reject malformed or absurd
// input — they aren't anti-cheat.
const MAX_JOB = 10_000;
const MAX_ABS_SCORE = 1_000_000;
const MAX_HEIST_POINTS = 10_000_000;
const GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];
/** Kept in step with shared/contracts.ts's CONTRACT_IDS (a test checks): a value import of it would not run under Node's test runner. */
const CONTRACT_LIST: readonly ContractId[] = ['records', 'sabotage', 'vault', 'hit', 'blackout', 'extract', 'swap', 'shipment'];
/** The outcomes a cleared job can have (campaign.ts's RunOutcome). */
const CLEARED: readonly RunOutcome[] = ['clean', 'noisy', 'burned'];
const MAX_PAGES = 12;
const ENDING_LIST: readonly Ending[] = ['public', 'private'];

export const isEnding = (v: unknown): v is Ending => ENDING_LIST.includes(v as Ending);
export const isContract = (v: unknown): v is ContractId => CONTRACT_LIST.includes(v as ContractId);
export const isClearedOutcome = (v: unknown): v is RunOutcome => CLEARED.includes(v as RunOutcome);

/** The last cleared run as the profile keeps it: "outcome|contract" (null if it isn't one). */
export function parseLastRun(v: unknown): LastRun | null {
  const [outcome, contract] = typeof v === 'string' ? v.split('|') : [];
  return isClearedOutcome(outcome) && isContract(contract) ? { outcome, contract } : null;
}

/** Validates an untrusted request body; returns null if it isn't a well-formed SaveRequest. */
export function parseSaveRequest(body: unknown): SaveRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { jobCleared, score, heist, run: reported } = body as Record<string, unknown>;
  if (!Number.isInteger(score) || Math.abs(score as number) > MAX_ABS_SCORE) return null;
  if (jobCleared !== null && (!Number.isInteger(jobCleared) || (jobCleared as number) < 1 || (jobCleared as number) > MAX_JOB)) return null;
  let run: SaveRequest = { jobCleared: jobCleared as number | null, score: score as number };
  // What a cleared job was and how it went only mean something for a cleared job.
  if (reported !== undefined) {
    if (jobCleared === null || typeof reported !== 'object' || reported === null) return null;
    const { outcome, contract, pages } = reported as Record<string, unknown>;
    if (!isClearedOutcome(outcome) || !isContract(contract) || !Number.isInteger(pages) || (pages as number) < 0 || (pages as number) > MAX_PAGES) return null;
    run = { ...run, run: { outcome, contract, pages: pages as number } };
  }
  if (heist === undefined) return run;
  // Heist points only mean something for a cleared job.
  if (jobCleared === null || typeof heist !== 'object' || heist === null) return null;
  const { points, grade } = heist as Record<string, unknown>;
  if (!Number.isInteger(points) || (points as number) < 0 || (points as number) > MAX_HEIST_POINTS) return null;
  if (!GRADES.includes(grade as Grade)) return null;
  return { ...run, heist: { points: points as number, grade: grade as Grade } };
}

/** Keeps the higher of each personal best. */
export function mergeBest(prev: BestRun, run: SaveRequest): { best: BestRun; newBestJob: boolean; newBestScore: boolean } {
  const newBestJob = run.jobCleared !== null && run.jobCleared > prev.bestJob;
  const newBestScore = run.score > prev.bestScore;
  return {
    best: {
      bestJob: newBestJob ? run.jobCleared! : prev.bestJob,
      bestScore: newBestScore ? run.score : prev.bestScore,
    },
    newBestJob,
    newBestScore,
  };
}

/** Leaderboard detail stored beside each score: "job|grade". */
export function encodeHeistDetail(job: number, grade: Grade): string {
  return `${job}|${grade}`;
}

export function decodeHeistDetail(detail: string | null | undefined): { job: number; grade: Grade } {
  const [job, grade] = (detail ?? '').split('|');
  return { job: parseInt(job ?? '', 10) || 0, grade: GRADES.includes(grade as Grade) ? (grade as Grade) : 'D' };
}

export const EMPTY_PROFILE: Profile = { agent: null, look: null, suit: null, hair: null, trained: false, stealthTrained: false, ending: null, controls: null, lastRun: null };
const AGENTS: readonly Agent[] = ['male', 'female'];

/** The looks an agent can wear: their own clothes, or the operative's black bodysuit (the client's skins.ts). */
export const LOOKS = ['classic', 'operative'] as const;
/** The operative's bodysuit colours: dark shades only, it's a stealth game. */
export const SUIT_COLOURS = ['black', 'charcoal', 'midnight', 'olive', 'oxblood', 'plum'] as const;
/** The operative's hair. */
export const HAIRSTYLES = ['bald', 'buzzed', 'parted', 'long', 'buns'] as const;

export function isLook(v: unknown): v is Look {
  return (LOOKS as readonly unknown[]).includes(v);
}

export function isSuitColour(v: unknown): v is SuitColour {
  return (SUIT_COLOURS as readonly unknown[]).includes(v);
}

export function isHairstyle(v: unknown): v is Hairstyle {
  return (HAIRSTYLES as readonly unknown[]).includes(v);
}

/** Validates an untrusted profile update; null if it isn't one (an empty update is fine). */
export function parseProfileUpdate(body: unknown): ProfileUpdate | null {
  if (typeof body !== 'object' || body === null) return null;
  const { agent, look, suit, hair, trained, stealthTrained, ending } = body as Record<string, unknown>;
  const update: ProfileUpdate = {};
  if (agent !== undefined) {
    if (!AGENTS.includes(agent as Agent)) return null;
    update.agent = agent as Agent;
  }
  if (look !== undefined) {
    if (!isLook(look)) return null;
    update.look = look;
  }
  if (suit !== undefined) {
    if (!isSuitColour(suit)) return null;
    update.suit = suit;
  }
  if (hair !== undefined) {
    if (!isHairstyle(hair)) return null;
    update.hair = hair;
  }
  if (trained !== undefined) {
    if (typeof trained !== 'boolean') return null;
    update.trained = trained;
  }
  if (stealthTrained !== undefined) {
    if (typeof stealthTrained !== 'boolean') return null;
    update.stealthTrained = stealthTrained;
  }
  if (ending !== undefined) {
    if (!isEnding(ending)) return null;
    update.ending = ending;
  }
  return update;
}

/** Applies an update. Finishing training sticks (a later `trained: false` doesn't undo it), and so does the ending. */
export function mergeProfile(prev: Profile, update: ProfileUpdate): Profile {
  return {
    agent: update.agent ?? prev.agent,
    look: update.look ?? prev.look,
    suit: update.suit ?? prev.suit,
    hair: update.hair ?? prev.hair,
    trained: prev.trained || update.trained === true,
    stealthTrained: prev.stealthTrained || update.stealthTrained === true,
    // The choice is made once: a later one doesn't undo it.
    ending: prev.ending ?? update.ending ?? null,
    // The settings are the player's latest, whole: a change replaces the last.
    controls: update.controls ?? prev.controls,
    lastRun: prev.lastRun,
  };
}

/**
 * The job to offer as "Continue": the one after the furthest cleared,
 * whether the server knows it (logged in) or only this browser does.
 * Null when there's nothing to continue (nothing cleared yet).
 */
export function continueJob(...bestJobs: Array<number | null | undefined>): number | null {
  const best = Math.max(0, ...bestJobs.map((j) => (Number.isInteger(j) && (j as number) > 0 ? (j as number) : 0)));
  return best > 0 ? Math.min(best + 1, MAX_JOB) : null;
}
