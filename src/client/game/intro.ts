// The opening cutscene. This build has no scripted opening, so it resolves at once; the caller carries on to the first job as before.

import type { Body } from './outfit';
import type { Look } from '../../shared/api';
import type { Style } from './skins';

export type IntroOptions = {
  canvas: HTMLCanvasElement;
  agent: Body;
  look: Look;
  style?: Style;
};

/** Resolves with whether the opening was skipped (always false: it has nothing to show). */
export function playIntro(_opts: IntroOptions): Promise<boolean> {
  return Promise.resolve(false);
}
