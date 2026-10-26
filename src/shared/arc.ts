// Fixed briefing text for the ladder's early jobs. This used to carry a long story; it is now a thin, neutral layer:
// no jobs are scripted (ARC_JOBS is 0), so every letter opens with the usual line and the day's own target, and the
// choice and ending letters below are never reached. They are kept so the callers in game.ts keep compiling. Pure, so
// it's unit-tested under Node.

import type { Arc, Letter } from './story';

/** How many jobs have a scripted briefing. None: every job's letter is the usual one. */
export const ARC_JOBS = 0;

export const ENDINGS = ['public', 'private'] as const;
export type Ending = (typeof ENDINGS)[number];

export const isEnding = (v: unknown): v is Ending => (ENDINGS as readonly unknown[]).includes(v);

/** The scripted paragraph for a job; null for every job (there are none). */
export function arcParagraph(_job: number): string | null {
  return null;
}

/** A short line shown on the training floor. */
export const TRAINING_LINE = 'Training floor: learn the controls, then move out.';

/** The epilogue's opening paragraph; null, as there is no scripted run to follow. */
export function epilogueParagraph(_ending: Ending | null, _job: number): string | null {
  return null;
}

/** What opens (and signs) job `job`'s letter in place of the usual one; null for every job, so the usual opening and the day's target stand. */
export function arcOpening(_job: number, _ending: Ending | null): Arc | null {
  return null;
}

/** The signature on an epilogue letter's closing. */
export function epilogueSignature(_ending: Ending): string {
  return '';
}

type Dressing = { greeting: string };

/** A neutral letter that offers two options, for callers that still ask for it. */
export function choiceLetter({ greeting }: Dressing): Letter {
  return {
    kicker: 'Encrypted message · Next steps',
    greeting,
    paragraphs: ['The job is done. Choose how to continue.'],
    parameters: [{ text: 'Option A.' }, { text: 'Option B.' }],
    parametersTitle: 'Your options',
    closing: 'The choice is yours.',
  };
}

/** A neutral closing letter for either option. */
export function endingLetter(_ending: Ending, { greeting }: Dressing): Letter {
  return {
    kicker: 'Encrypted message · Wrapping up',
    greeting,
    paragraphs: ['Understood. Good work.'],
    parameters: [],
    closing: 'More jobs are on the way.',
  };
}

/** Short field notes that close each week of the Daily Heist in turn. */
const FRAGMENTS: readonly string[] = [
  'Quiet runs pay best: every alarm costs points.',
  'A body left in view is a body found. Stash it.',
  'The logs go out on a timer. Wipe them early.',
  'Dogs hunt by sound. Walk, don’t run.',
  'An EMP charge is worth keeping for a drone.',
  'Read the briefing: the twist changes the rules.',
];

/** The field note that closes week `number`. */
export function fragmentFor(number: number): string {
  return FRAGMENTS[(((number - 1) % FRAGMENTS.length) + FRAGMENTS.length) % FRAGMENTS.length]!;
}
