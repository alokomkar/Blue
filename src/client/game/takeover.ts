// What used to play after the agent is caught (a scripted take-down of the building) is not part of this build. The Takeover keeps its shape so game.ts can still start one and wait for
// `onDone`; it ends at once. The retry builds a fresh floor plan by itself (game.ts's freshPlan), so `layout` is never asked for one.

import type { MazeCells } from './maze';
import type { Player } from './player';
import type { SceneRoot } from './scene';
import type * as THREE from 'three';

export type TakeoverOptions = {
  root: SceneRoot;
  player: Player;
  /** Plays a sound by name (unused). */
  cue: (name: string, volume?: number) => void;
  /** The floors of the building (unused). */
  floors: ReadonlyArray<{ group: THREE.Object3D; cols: number; rows: number }>;
  /** A fresh floor plan for a floor of this size (unused: the retry plans its own). */
  layout: ((cols: number, rows: number) => MazeCells) | null;
  /** The takeover is over: show what comes next. */
  onDone: () => void;
  skippable?: boolean;
};

export class Takeover {
  private done = false;
  private finished = false;

  constructor(private readonly o: TakeoverOptions) {
    queueMicrotask(() => this.finish());
  }

  get active(): boolean {
    return !this.done;
  }

  skip(): void {
    this.finish();
  }

  update(_dt: number): void {
    // nothing to play
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.done = true;
    this.o.onDone();
  }
}
