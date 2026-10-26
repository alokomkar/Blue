// Plays an interlude (interlude.ts). Interludes carry no narrative in this build, so the scene is over at once; callers chain their next step on the promise as before.

import type { Scene } from './interlude';

export function playInterlude(_scene: Scene): Promise<void> {
  return Promise.resolve();
}
