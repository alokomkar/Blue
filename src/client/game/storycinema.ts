// Story scenes (an apartment, a lab hall) are not part of this build: playStory resolves at once, and the caller carries on.

export type StoryId = 'apartment' | 'core';

export type StoryOptions = {
  id: StoryId;
  canvas: HTMLCanvasElement;
  look: unknown;
  style?: unknown;
  /** Localhost testing: hold the scene at this many seconds in (ignored). */
  freezeAt?: number;
};

/** Resolves with whether the scene was skipped (always false: there is nothing to show). */
export function playStory(_opts: StoryOptions): Promise<boolean> {
  return Promise.resolve(false);
}
