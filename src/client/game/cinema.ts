// End-of-run cinematics are not part of this build: playCinematic resolves at once, and the caller carries on to what follows.

import type { Body } from './outfit';
import type { Look } from '../../shared/api';
import type { Style } from './skins';

export type CinemaOptions = {
  ending: string;
  canvas: HTMLCanvasElement;
  agent: Body;
  look: Look;
  style?: Style;
  /** How many files the player collected (unused). */
  documents?: number;
  /** Localhost testing: hold at this many seconds in (ignored). */
  freezeAt?: number;
};

/** Resolves with whether it was skipped (always false: there is nothing to show). */
export function playCinematic(_opts: CinemaOptions): Promise<boolean> {
  return Promise.resolve(false);
}
