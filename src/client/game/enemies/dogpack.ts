// A pack of watchdogs sharing one floor: pack.ts's clock and meeting point,
// wired to the dogs themselves. game.ts ticks it once a frame (on the
// player's floor, like the dogs) and hears when the pack gathers, so it can
// bark and let the player spot where they meet.

import { CELL } from '../scene';
import { bfs, type MazeCells } from '../maze';
import { advancePack, startPack, PACK_ROAM_S, type PackPhase, type PackState } from './pack';
import type { EnemyContext } from './types';
import type { PackLink, Watchdog } from './watchdog';

/** How far each dog stands from the middle of the meeting point — well inside a trap's blast. */
const SLOT_R = 0.9;

export class WatchdogPack implements PackLink {
  private state: PackState;
  /** The player has seen the pack gathered here, so it's marked on the blueprint. */
  spotted = false;
  readonly meetX: number;
  readonly meetZ: number;
  readonly territory: number[][];

  constructor(
    readonly members: Watchdog[],
    /** The meeting point, in the floor's cells. */
    readonly cell: { x: number; y: number },
    navCells: MazeCells,
    cols: number,
    rows: number,
    originX: number,
    originZ: number,
    /** Seconds roaming apart between regroups (training's pack is quicker). */
    readonly roamS: readonly [number, number] = PACK_ROAM_S
  ) {
    this.state = startPack(Math.random, roamS[0] < PACK_ROAM_S[0] ? roamS : undefined);
    this.territory = bfs(navCells, cols, rows, cell.x, cell.y);
    this.meetX = cell.x * CELL + originX;
    this.meetZ = cell.y * CELL + originZ;
    for (const dog of members) dog.joinPack(this);
  }

  get gathering(): boolean {
    return this.state.phase !== 'roam';
  }

  /** Gathered at the meeting point right now. */
  get huddling(): boolean {
    return this.state.phase === 'huddle';
  }

  meetSpot(dog: Watchdog): { x: number; z: number } {
    const a = (this.members.indexOf(dog) / this.members.length) * Math.PI * 2 + 0.4;
    return { x: this.meetX + Math.sin(a) * SLOT_R, z: this.meetZ + Math.cos(a) * SLOT_R };
  }

  call(from: Watchdog, x: number, z: number, ctx: EnemyContext): void {
    for (const dog of this.members) if (dog !== from) dog.answerCall(x, z, ctx);
  }

  /** Advances the pack's clock; returns the phase it moved into this frame, if it changed. */
  tick(dt: number): PackPhase | null {
    const standing = this.members.filter((d) => !d.disabled);
    const arrived = standing.filter((d) => d.atMeetingPoint).length;
    const next = advancePack(this.state, dt, arrived, standing.length, Math.random, this.roamS);
    const changed = next.phase !== this.state.phase ? next.phase : null;
    this.state = next;
    return changed;
  }
}
