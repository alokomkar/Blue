// What every enemy has in common, so game.ts can run patrol bots, sentries,
// watchdogs and whatever comes next through one loop: where it is, whether
// it's still in the fight, how a shot lands on it, and one update per frame
// against a shared context. Type-only, so pure modules can import it.

import type { MazeCells } from '../maze';
import type { WallBox } from '../scene';

export type EnemyKind = 'patrol' | 'sentry' | 'hunter' | 'heavy' | 'watchdog' | 'crawler' | 'drone' | 'alpha' | 'sniper';

/** How the player attacks — chosen automatically per target (weapons.ts): a silent takedown from behind, a stun shot, or an EMP. */
export type Tool = 'takedown' | 'stun' | 'emp';

/** How a shot landed: out of the fight, hurt but still going, or no effect at all. */
export type HitResult = 'disabled' | 'damaged' | 'slowed' | 'immune';

/** Everything an enemy needs to know about the world this frame. */
export type EnemyContext = {
  /** Passive, stationary targets in the cover practice course only. */
  practiceTarget?: boolean;
  /** Nav cells for this floor (locked doors closed). */
  cells: MazeCells;
  cols: number;
  rows: number;
  wallBoxes: WallBox[];
  /** What stops a look, when it is not the same as what stops a body (the agent on a container's roof): wallBoxes without the containers. */
  sightWalls?: WallBox[] | undefined;
  /** Every solid on the floor, with the agent's height and the floor's: a guard and an agent at different heights (a guard on a container's roof, the agent on the floor, or the other way round) see one another only along a real 3D line over the boxes (detection.ts's lineClearOver). */
  occluders?: WallBox[] | undefined;
  playerY?: number | undefined;
  floorY?: number | undefined;
  playerX: number;
  playerZ: number;
  sneaking: boolean;
  /** Can't be seen at all this frame (behind a crate, cloaked + sneaking + still, or shut away). */
  hidden: boolean;
  /** The player is up out of reach (a tower's platform, the pipes, a line): a guard can see them but can't get under them and stands back. */
  unreachable?: boolean;
  /** The player is lying flat (posture.ts): seen from a third of the distance, with a smaller all-round awareness. */
  prone?: boolean;
  /** The player is dashing (dash.ts): a guard sees a runner from further off. */
  running?: boolean;
  /** The player lies along a wall top (wallclimb.ts): hidden from guards and dogs, but a drone, flying over the walls, still sees them. */
  overWalls?: boolean;
  /** Shut inside a staff locker or crawling through a vent — nothing can reach them, not even a watchdog. */
  enclosed: boolean;
  /** How far sight carries: 1 normally, less where a light has been shot out. */
  sightScale: number;
  /** How fast humanoid bots move: 1 normally, faster while the alarm is up. */
  speedScale: number;
  /** The guard walks its beat and watches but never spots or shoots (the high wall course's: they are there to be dropped on). */
  harmless?: boolean;
  /** A guard's laser on the player for long enough makes it take notice and creep up to see (laser.ts): on in the basics course, to try it. */
  laserNotice?: boolean;
  /** Seconds of clear sight a guard needs to confirm a sighting (difficulty.ts); the default when left out. */
  guardReactionS?: number;
  /** How far either side of its post a sentry's gaze sweeps, in radians (difficulty.ts). */
  sentrySweep?: number;
  /** A silent night (twists.ts): a dog brushing past an agent holding perfectly still only sniffs, as there is nothing to hear. */
  silentNight?: boolean;
  /** How far the player's noise carries this frame, in world units along the corridors (0 = silent). */
  noise: number;
  /** Walking distance from the player to (x, z) through the corridors, in world units; Infinity if cut off. */
  soundDistance: (x: number, z: number) => number;
  /** The smoke clouds on this floor (smoke.ts): guards cannot see through them, and see only a few steps from inside one. */
  smokes?: ReadonlyArray<{ x: number; z: number; age: number }>;
  /** Everything else on this floor (guards, dogs, the rest): a guard steps off any it is standing in (squad.ts). */
  crowd?: ReadonlyArray<Enemy>;
  /** The AI partner, for the enemies that shoot it as well as the agent (the sniper): where it stands (world, feet), how it is posed, and whether it is out of sight; null when it is down, gone or not on this floor. */
  partner?: { x: number; z: number; y: number; prone: boolean; crouched: boolean; hidden: boolean } | null;
  /** A sniper's round: whom it was at, and whether it landed. The game draws the tracer and plays the sound, and does the cost (the agent's hit) or puts the partner down. */
  onSniperShot?: (enemy: Enemy, at: 'player' | 'partner', hit: boolean) => void;
  /** A sustained sighting — suspicion rises. */
  onSpotted: (enemy: Enemy) => void;
  /** A shot landed on the player. */
  onShot: (enemy: Enemy) => void;
  /** The job ends on the spot. */
  onCaught: (enemy: Enemy, title: string, reason: string) => void;
  /** A crawler mine reached the player and went off. */
  onExplode: (enemy: Enemy) => void;
};

export interface Enemy {
  readonly kind: EnemyKind;
  readonly worldX: number;
  readonly worldZ: number;
  readonly floorY: number;
  readonly disabled: boolean;
  /** Walking this frame (drives footstep sounds). */
  readonly moving: boolean;
  /** Onto the player right now (drives the alert chirp and the heartbeat). */
  readonly alert: boolean;
  /** The stun gun can't drop it — only an EMP will. */
  readonly stunImmune: boolean;
  /** A stun shot still does something to it when there's no EMP to spend: it slows it down (watchdogs). */
  readonly stunSlows?: boolean;
  /** Can be taken down from behind (patrol bots and sentries; not watchdogs — they hear you coming). */
  readonly takedownable: boolean;
  /** Which way it's looking (0 = +Z) — what a takedown has to get behind. */
  readonly facing: number;
  /** Body radius the player collides with while it's active. */
  readonly radius: number;
  update(ctx: EnemyContext, dt: number): void;
  hit(tool: Tool): HitResult;
  /** Blinded and deafened by a flash grenade at (x, z) for `seconds`: it stumbles about seeing and hearing nothing, then goes to look at where it went off. Returns whether it was affected (a drone or a mine isn't). */
  daze?(seconds: number, x: number, z: number): boolean;
  /** Taken somewhere else on its floor, forgetting what it was after, and back on its rounds from there (a checkpoint: the agent is put back, and what had them is not standing there). Not a sentry, which holds its post. */
  relocate?(x: number, z: number, cells: MazeCells, cols: number, rows: number): void;
  /** The player slipped away (picked up at a checkpoint): drop whatever it was working itself up to and go back to its rounds. */
  calm?(): void;
  /** Shown only while the player is on its floor (the floor above is hidden while you're below it). */
  setVisible(visible: boolean): void;
  /** Drawn to a noise or a flare at (x, z) for `seconds`; returns whether it took the bait. */
  investigate?(x: number, z: number, seconds: number, cells: MazeCells, cols: number, rows: number, maxCells: number): boolean;
}
