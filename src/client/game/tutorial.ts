// Training — an authored floor that teaches every move in the game, one
// station at a time: a coach panel says what to do (with the controls for
// the device in hand), and a gate at the end of each station opens once
// it's done. Failing — spotted too often, run down by the dog — restarts the
// station, not the level.
//
// The floor is drawn below as a maze at double resolution: each cell sits
// at an odd row/column, the characters between cells are its walls. '#' is
// wall, ' ' open; a digit in a wall slot is a training gate (the station
// that opens it names it), a capital letter a security door (A = the first
// key colour). Marks in cell slots place things:
//   @ arrival lift   * first beacon   g guard (back to you)   c crate
//   o office (desk)  L laser          h staff locker          d watchdog
//   t terminal A     s server A       $ records room + sentry X exit lift
//   p a patrolling guard (the loop by the cover corridor)
//   D a watchdog in the pack (one per mark)   M the pack's meeting point
//   k the staff locker by the pack's arena
//   q a drone over the yard          b the yard's crate   e the yard's staff locker
//   U a laser gate to duck under     V one to crawl beneath   W a pulsing one to wait out (evade.ts)
//
// Pure (type-only imports), so it runs under node's test runner as-is.

import type { EnemyKind } from './enemies/types';
import type { MazeCells } from './maze';
import type { Dir } from './security';
import type { PipePlan } from './pipes';
import type { Slider, Sweeper } from './movingLasers';
import type { ShutterPlan } from './shutters';

/** Gates that stay shut to guards and dogs even once open to you — the patrol keeps to its loop, the pack to its arena. */
export const GUARD_GATES: readonly number[] = [2, 7];

/** The laser hall has lost power: the night-vision lesson, and the lasers after it, happen in the dark. */
export const TRAINING_BLACKOUT: ReadonlyArray<{ x: number; y: number }> = [
  { x: 7, y: 6 },
  { x: 8, y: 6 },
  { x: 9, y: 6 },
];

/** The yard west of the torch corridor: the training drone keeps to it, and never over the corridor you come down. */
export const TRAINING_DRONE_YARD: ReadonlyArray<{ x: number; y: number }> = [2, 3, 4, 5,
].flatMap((x) => [4, 5, 6].map((y) => ({ x, y })));

/** The light switch taught in training: beside the corridor light by the crate, on the outer wall. */
export const TRAINING_SWITCHES: ReadonlyArray<{ x: number; y: number; wall: Dir;
}> = [{ x: 6, y: 0, wall: 'N' }];

/** The training pack regroups more often than a real one, so a lesson isn't mostly waiting. */
export const TRAINING_PACK_ROAM_S: readonly [number, number] = [10, 14];

/**
 * What you carry through training, topped back up whenever you run low, at
 * every station: a wasted EMP or a trap rolled to the wrong spot must never
 * leave you with no way past a dog or a pack.
 */
export const TRAINING_KIT = { emp: 2, traps: 2, flash: 2 } as const;

/** localStorage key set once the player finishes training. */
export const TRAINED_KEY = 'mazeHeist.trained';

export const TRAINING_MAP: readonly string[] = [
  '#############################',
  '#@   *1    g c#######l#$#u###',
  '#############2####### # # ###',
  '#########     #######      X#',
  '######### ### #######A#######',
  '#########p###  o###t   s#####',
  '######### ### #######6#######',
  '#########     #####  d###  D#',
  '#############3##### # ### # #',
  '#####  q    # ##### # 7k M  #',
  '#####       # ##### # ### ###',
  '#####    b    #####   ###   #',
  '#####       # #####5##### # #',
  '#####  e    # 4  L h#####  D#',
  '#############################',
];

export type Mark =
  | '@' | '*' | 'g' | 'G' | 'H' | 'K' | 'c' | 'o' | 'L' | 'h' | 'd' | 't' | 's' | '$' | 'u' | 'l' | 'X' | 'p' | 'M' | 'k' | 'q' | 'b' | 'e' | 'U' | 'V' | 'W';
type Point = { x: number; y: number };
/** A passage from cell (x, y) through `dir` — a gate or a door sits on it. */
export type Passage = { id: number; x: number; y: number; dir: Dir };

export type TrainingLayout = {
  cols: number;
  rows: number;
  cells: MazeCells;
  marks: Partial<Record<Mark, Point>>;
  /** The pack's dogs ('D' — there's more than one, so they aren't in `marks`). */
  packDogs: Point[];
  gates: Passage[];
  doors: Passage[];
};

export function parseTraining(map: readonly string[]): TrainingLayout {
  const rows = (map.length - 1) / 2;
  const cols = (map[0]!.length - 1) / 2;
  const at = (r: number, c: number): string => map[r]?.[c] ?? '#';
  const cells: MazeCells = [];
  const marks: TrainingLayout['marks'] = {};
  const packDogs: Point[] = [];
  const gates: Passage[] = [];
  const doors: Passage[] = [];
  for (let y = 0; y < rows; y++) {
    const row: MazeCells[number] = [];
    for (let x = 0; x < cols; x++) {
      const r = 2 * y + 1;
      const c = 2 * x + 1;
      row.push({
        N: at(r - 1, c) !== '#',
        S: at(r + 1, c) !== '#',
        E: at(r, c + 1) !== '#',
        W: at(r, c - 1) !== '#',
      });
      const mark = at(r, c);
      if (mark === 'D') packDogs.push({ x, y });
      else if (mark !== '#' && mark !== ' ') marks[mark as Mark] = { x, y };
      // Each passage is read once, from the cell west of / north of it.
      for (const [ch, dir] of [
        [at(r, c + 1), 'E'],
        [at(r + 1, c), 'S'],
      ] as const) {
        if (/[0-9]/.test(ch)) gates.push({ id: Number(ch), x, y, dir });
        else if (/[A-C]/.test(ch))
          doors.push({ id: ch.charCodeAt(0) - 65, x, y, dir });
      }
    }
    cells.push(row);
  }
  return { cols, rows, cells, marks, packDogs, gates, doors };
}

/** What the player has done so far — sampled every frame, compared against the sample taken when a station began. */
export type TrainingProgress = {
  cell: Point;
  takedowns: number;
  /** Bodies dropped where they're hard to see (bodies.ts's BODY_HIDDEN_PCT or under). */
  bodiesHidden: number;
  inCover: boolean;
  lightsOut: number;
  torchOff: boolean;
  /** Times the torch has been switched on. */
  torchOns: number;
  /** Lights switched off at their switches. */
  switchedOff: number;
  /** Night-vision goggles on. */
  gogglesOn: boolean;
  trapsSet: number;
  /** Enemies a trap has knocked out. */
  trapKills: number;
  /** Patrolling guards (not sentries) put down, by any means. */
  patrolsDown: number;
  hidden: boolean;
  dogsDown: number;
  /** Drones brought down (an EMP). */
  dronesDown: number;
  /** Seen the pack gathered at its meeting point. */
  packSpotted: boolean;
  /** Traps set at the pack's meeting point. */
  packTraps: number;
  /** Pack dogs still standing. */
  packLeft: number;
  /** The most enemies one trap blast has taken out. */
  bestBlast: number;
  hacked: boolean;
  gridOn: boolean;
  /** Sentries a flare has drawn off their post. */
  lures: number;
  /** Sentries put down, by any means. */
  sentriesDown: number;
  /** Current cover opponent persists across checkpoint resets. */
  coverEncounter?: { station: number; disabled: boolean } | null;
  documents: number;
  mapOpened: boolean;
  /** Up off the floor (game.ts's climbing and hanging), and how: null on the floor. */
  aloft: 'climb' | 'perch' | 'hang' | 'fall' | null;
  /** Enemies tagged from a lookout, still showing. */
  tagged: number;
  /** The pipe line hung from (pipes.ts), while hanging. */
  gripLine: number | null;
  /** Guards dropped on from the pipes. */
  aerialTakedowns: number;
  /** Warnings of a pulse coming down the pipe being hung from. */
  pulseWarnings: number;
  /** The building's uplink is down. */
  uplinkDown: boolean;
  /** Times the access logs have been wiped. */
  logsWiped: number;
  /** Bodies put away in a locker, crate, vent or behind furniture. */
  stashes: number;
  /** The visibility meter's reading right now, 0 to 1 (1 is seen), or 0 with no guard near. */
  exposure: number;
  /** How low the agent is (posture.ts). */
  posture: 'stand' | 'crouch' | 'prone';
  /** Dashes begun (the trap's aim line, then a dash to its end). */
  dashes: number;
  /** Traps set down where the agent stood, and traps rolled along the aim line. */
  trapsHere: number;
  trapsRolled: number;
  /** Stun shots fired. */
  shots: number;
  /** Times Fire was pressed while the gun was still recharging (the click). */
  dryFires: number;
  /** Heavy enforcers put down. */
  heaviesDown: number;
  /** Times the agent has leaned out of cover to aim. */
  aimsBegun: number;
  /** Enemies put down by a shot fired aiming from cover. */
  aimedDowns: number;
  /** Flash grenades thrown (the weapons course restocks them), and enemies they blinded. */
  flashes: number;
  flashDazed: number;
  /** All enemies disabled so far, for sequential cover-course encounters. */
  enemiesDown: number;
  /** Times the agent has got up a maze wall to lie along its top, and times they have rolled off one. */
  wallTops: number;
  wallRolls: number;
  /** Hanging from a tall wall's shelf (highwall.ts): times the agent has got up to it, metres shimmied along it, hops along it and leaps off it. */
  wallHangs: number;
  hangMetres: number;
  wallHops: number;
  wallJumps: number;
  /** Times the agent has run up from a tall wall's first shelf to its second (counted in wallTops), and dropped back down to the first. */
  wallLowers: number;
  /** Times the agent has gone over a tall wall's top to its far side. */
  wallCrosses: number;
};

export type Station = {
  /** Spawned only when this cover-course encounter begins. */
  enemy?: EnemyKind;
  enemyAt?: Point;
  title: string;
  /** Instructions with keyboard controls, and with the touch controls. */
  keys: string;
  touch: string;
  /**
   * Whether it's done, given the progress now, when this station began (`start`) and when training began (`begin`). What can
   * be done again (a torch, a trap, a flare) is counted from `start`. What can't (a guard put down, a light, a body, a file) is
   * counted from `begin`: done early, out of order, it still counts, or the station that comes next could never be cleared.
   */
  done: (now: TrainingProgress, start: TrainingProgress, begin: TrainingProgress) => boolean;
  /** The gate that opens once it's done. */
  opens?: number;
  /** A gate that shuts behind you once it's done. */
  closes?: number;
  /** A beacon marks this cell while the station is live. */
  goal?: Point;
  /** Said when it's done: a hint if it was done some other way than the one being taught. */
  note?: (now: TrainingProgress, start: TrainingProgress, begin: TrainingProgress) => string | null;
  /** The storey that beacon and the finish are on, and the one the checkpoint is on (a multi-storey course's: the bunker's); the ground floor when left out. */
  level?: number;
  checkpointLevel?: number;
  /** Where a failed attempt starts over. */
  checkpoint: Point;
  /** Or, for a station up on the pipes, the tower (its index in the course's pipe plan) whose platform it starts over on. */
  perch?: number;
  /** The guide arrow shows while this station is live (it's off in training otherwise). */
  guide?: boolean;
};

const at = (p: TrainingProgress, x: number, y: number): boolean =>
  p.cell.x === x && p.cell.y === y;

export const STATIONS: readonly Station[] = [
  {
    title: 'Get moving',
    keys: 'The lift lets you out. {forward} and {back} walk forward and back, {turnLeft} and {turnRight} turn. Walk to the beacon.',
    touch:
      'The lift lets you out. Drag the stick at the bottom left: push up to walk forward, left and right to turn. Walk to the beacon.',
    done: (p) => at(p, 2, 0),
    opens: 1,
    goal: { x: 2, y: 0 },
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Take down a guard',
    keys: 'A guard ahead has its back to you. Press {sneak} to sneak, creep up behind it, and when the white chevron shows over it, click (or {fire}).',
    touch:
      'A guard ahead has its back to you. Tap Sneak, creep up behind it, and when the white chevron shows over it, tap Fire.',
    // Any way of putting it down will do (a stun shot shouldn't strand you behind the gate), but only a takedown is the lesson.
    done: (p, s) =>
      p.takedowns > s.takedowns || p.sentriesDown > s.sentriesDown,
    note: (p, s) =>
      p.takedowns > s.takedowns
        ? null
        : 'A STUN WORKS, BUT IT’S LOUD · NEXT TIME, SNEAK UP BEHIND FOR A SILENT TAKEDOWN',
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Switch off a light',
    keys: 'Lights have wall switches. Walk up to the one on the wall above the crate and press {interact} to switch the light off. It’s silent, unlike shooting the bulb out, but a guard who notices comes over to switch it back on, so darkness is a lure too.',
    touch:
      'Lights have wall switches. Walk up to the one on the wall above the crate and tap Lights to switch the light off. It’s silent, unlike shooting the bulb out, but a guard who notices comes over to switch it back on, so darkness is a lure too.',
    // Switched off before this station began (the light's right there, and so is the guard): still done.
    done: (p, _s, b) => p.switchedOff > b.switchedOff,
    goal: { x: 6, y: 0 },
    checkpoint: { x: 4, y: 0 },
  },
  {
    title: 'Hide the body',
    keys: 'Stand over the body and press {interact} to pick it up. The Detection % over it is how easily a guard would spot it: under a light, a guard sees it from far off. Carry it into the dark you just made (or into a room) and press {interact} again to put it down once it reads 40% or less. Next to a staff locker, a pair of crates or a vent, {interact} stashes it: the agent opens it, puts the body in and shuts it again, out of sight for good. A body will not go behind a desk or into a records locker.',
    touch:
      'Stand over the body and tap Carry to pick it up. The Detection % over it is how easily a guard would spot it: under a light, a guard sees it from far off. Carry it into the dark you just made (or into a room) and tap Drop to put it down once it reads 40% or less. Next to a locker, crate or vent, tap Stash to put it out of sight for good.',
    // There's only the one body: hidden before the light was off, it still counts.
    done: (p, _s, b) => p.bodiesHidden > b.bodiesHidden,
    note: (p, _s, b) =>
      p.stashes > b.stashes ? null : 'THE DARK WORKS · BUT A LOCKER, CRATE OR VENT HIDES A BODY COMPLETELY: NO ONE WILL EVER FIND IT',
    opens: 2,
    checkpoint: { x: 5, y: 0 },
  },
  {
    title: 'Take cover',
    keys: 'Walk up to the desk in the side room: beside it you go see-through, which is cover. Low cover only hides you crouched, and in cover you always are. Nothing holds you: walk off and you are in the open again.',
    touch:
      'Walk up to the desk in the side room: beside it you go see-through, which is cover. Low cover only hides you crouched, and in cover you always are. Nothing holds you: walk off and you are in the open again.',
    done: (p) => p.inCover,
    checkpoint: { x: 6, y: 1 },
  },
  {
    title: 'Set a trap',
    keys: 'A guard patrols the loop here. Press {trap} to line up a remote trap: a line on the floor shows where it would roll (up to two cells, stopping at a wall) and the ring its blast. Turn to aim down the guard’s path and press {trap} again to roll it, or {trapHere} to set it right where you stand. The blue line is its motion sensor: once armed, anything that walks across it sets the trap off.',
    touch:
      'A guard patrols the loop here. Tap the case button (above Fire) to open your kit, then tap Trap: a line on the floor shows where it would roll (up to two cells, stopping at a wall) and the ring its blast. Turn with the stick to aim down the guard’s path, then tap Roll, or Set here to drop it at your feet. The blue line is its motion sensor: once armed, anything that walks across it sets the trap off.',
    // With the patrol already down (shot, taken down, or caught by an earlier trap) there's nothing left to trap:
    // move on, rather than strand you behind gate 3. The next station says how.
    done: (p, s) => p.trapsSet > s.trapsSet || p.patrolsDown > 0,
    checkpoint: { x: 6, y: 1 },
  },
  {
    title: 'Blow the trap',
    keys: 'Get clear and watch the trap camera (top right). The trap arms itself: a blue laser lies across it, and when the guard walks over the beam it blows by itself. You can blow it yourself too, with {detonate}. Missed? Set another with {trap}.',
    touch:
      'Get clear and watch the trap camera. The trap arms itself: a blue laser lies across it, and when the guard walks over the beam it blows by itself. You can blow it yourself too: tap Detonate on the camera panel, top right. Missed? Roll another from your kit.',
    // Counted whenever the patrol went down, not only after this station began: shot before the trap
    // went off, it can't be trapped any more, and gate 3 must still open.
    done: (p, s) => p.trapKills > s.trapKills || p.patrolsDown > 0,
    note: (p) =>
      p.trapKills > 0
        ? null
        : 'THAT WORKS TOO · BUT A TRAP DOES IT FROM A SAFE DISTANCE',
    opens: 3,
    checkpoint: { x: 6, y: 1 },
  },
  {
    title: 'Kill the lights',
    keys: 'Guards see less far in the dark. Face the ceiling light ahead until the gauge reads LIGHT, then click to shoot it out.',
    touch:
      'Guards see less far in the dark. Face the ceiling light ahead until Fire reads LIGHT, then tap it to shoot the light out.',
    // A light shot out earlier, from where the gate was still shut, still counts: it can't be shot again.
    done: (p, _s, b) => p.lightsOut > b.lightsOut,
    checkpoint: { x: 6, y: 4 },
  },
  {
    title: 'Your torch',
    keys: 'You start every job with your torch off: guards spot you from much closer in the dark, but you only see what’s right around you. Press {torch} to switch it on and look ahead, then press {torch} again to switch it off. A guard who sees its beam on the floor comes to look.',
    touch:
      'You start every job with your torch off: guards spot you from much closer in the dark, but you only see what’s right around you. Open your kit (the case button) and tap Torch to switch it on and look ahead, then tap it again to switch it off. A guard who sees its beam on the floor comes to look.',
    done: (p, s) => p.torchOns > s.torchOns && p.torchOff,
    checkpoint: { x: 6, y: 4 },
  },
  {
    title: 'Dodge the drone',
    keys: 'A drone sweeps the yard to your left with its searchlight. Stand in the light for a moment and it has you, and from above crouching doesn’t help: only a crate, a staff locker, or camo ({camo}) while you’re crouched and still will hide you. Watch its light, wait by the crate while it passes, and reach the beacon in the far corner. An EMP ({forceEmp}) brings a drone down too.',
    touch:
      'A drone sweeps the yard to your left with its searchlight. Stand in the light for a moment and it has you, and from above crouching doesn’t help: only a crate, a staff locker, or camo (hold Sneak) while you’re crouched and still will hide you. Watch its light, wait by the crate while it passes, and reach the beacon in the far corner. An EMP (hold Fire) brings a drone down too.',
    // A drone put down earlier counts, from wherever it was done: it can't be put down twice.
    done: (p, _s, b) => at(p, 2, 4) || p.dronesDown > b.dronesDown,
    note: (p, _s, b) =>
      p.dronesDown > b.dronesDown ? 'THAT WORKS · BUT EMPS ARE FEW ON A JOB: MOST OF THE TIME, LET THE LIGHT PASS' : null,
    goal: { x: 2, y: 4 },
    checkpoint: { x: 6, y: 5 },
  },
  {
    title: 'Night vision',
    keys: 'The hall past this gate has lost power: it’s pitch dark in there. Guards see much less far in a blackout, but a torch beam would give you away. Press {goggles} to put on night vision. It runs on a battery that recharges while it’s off.',
    touch:
      'The hall past this gate has lost power: it’s pitch dark in there. Guards see much less far in a blackout, but a torch beam would give you away. Open your kit (the case button) and tap Night to put on night vision. It runs on a battery that recharges while it’s off.',
    done: (p) => p.gogglesOn,
    opens: 4,
    checkpoint: { x: 6, y: 4 },
  },
  {
    title: 'Cloak through the laser grid',
    keys: 'A laser grid seals the hall, and nothing stops it but a cloak. Press {camo} to cloak, then walk through the beams to the beacon before the camo runs out. (Other beams you will learn to beat on your own two feet, in the next course.)',
    touch:
      'A laser grid seals the hall, and nothing stops it but a cloak. Press and hold Sneak (a tap only sneaks) until its bar glows cyan: that’s your cloak. Then walk through the beams to the beacon before the camo runs out. (Other beams you will learn to beat on your own two feet, in the next course.)',
    done: (p) => at(p, 9, 6),
    goal: { x: 9, y: 6 },
    checkpoint: { x: 7, y: 6 },
  },
  {
    title: 'Hide from the dog',
    keys: 'A watchdog prowls behind the next door. It hunts by sound, and if it reaches you the job is over. Step into the staff locker beside you ({interact}): the door opens once you’re hidden.',
    touch:
      'A watchdog prowls behind the next door. It hunts by sound, and if it reaches you the job is over. Step into the staff locker beside you (Interact): the door opens once you’re hidden.',
    done: (p) => p.hidden,
    opens: 5,
    closes: 4, // shut behind you, so the dog stays in its loop
    checkpoint: { x: 9, y: 6 },
  },
  {
    title: 'EMP the dog',
    keys: 'The stun gun does nothing to a dog. Press {sneak} to sneak (it can barely hear that), step out as it comes by, face it, and press {forceEmp} to fire an EMP.',
    touch:
      'The stun gun does nothing to a dog. Tap Sneak (it can barely hear that), step out as it comes by, face it, and press and hold Fire until it fires an EMP.',
    // Counted from the start of training: a dog put down earlier (a trap, by the pack's cousins) must not strand the lesson.
    done: (p, _s, b) => p.dogsDown > b.dogsDown,
    opens: 7,
    checkpoint: { x: 9, y: 6 },
  },
  {
    title: 'Watch the pack',
    keys: 'Past the new gate, two watchdogs hunt as a pack, and every so often they regroup at a meeting point. Sneak in ({sneak}), step straight into the staff locker by the gate ({interact}) and watch them gather.',
    touch:
      'Past the new gate, two watchdogs hunt as a pack, and every so often they regroup at a meeting point. Sneak in, step straight into the staff locker by the gate (Interact) and watch them gather.',
    done: (p) => p.packSpotted,
    checkpoint: { x: 10, y: 4 },
  },
  {
    title: 'Trap the meeting point',
    keys: 'It’s marked on your blueprint now. Once they split up, step out, press {trap} and turn toward the beacon where they met until the ring turns green, then {trap} again: the trap rolls into the meeting point without you going near it. Get back in the locker before they come round again.',
    touch:
      'It’s marked on your blueprint now. Once they split up, step out, open your kit, tap Trap and turn toward the beacon where they met until the ring turns green, then tap Roll: the trap rolls into the meeting point without you going near it. Get back in the locker before they come round again.',
    done: (p, s) => p.packTraps > s.packTraps || p.packLeft === 0,
    goal: { x: 12, y: 4 },
    checkpoint: { x: 10, y: 4 },
  },
  {
    title: 'Take the whole pack',
    keys: 'Watch the trap camera from the locker. The trap goes off by itself as the dogs cross its beam, a moment after the first, so the second is in the blast too. Or press {detonate} once they are both on it: one blast takes them both.',
    touch: 'Watch the trap camera from the locker. The trap goes off by itself as the dogs cross its beam, a moment after the first, so the second is in the blast too. Or tap Detonate once they are both on it: one blast takes them both.',
    done: (p) => p.packLeft === 0,
    note: (p) =>
      p.bestBlast >= 2
        ? null
        : 'ONE AT A TIME WORKS · BUT CATCH THEM GATHERED AND ONE TRAP TAKES THE WHOLE PACK',
    opens: 6,
    checkpoint: { x: 10, y: 4 },
  },
  {
    title: 'Hack a terminal',
    keys: 'Door A is locked. Hack terminal A in the room to the left: press {interact}, then stay close until it’s done.',
    touch:
      'Door A is locked. Hack terminal A in the room to the left: tap Hack, then stay close until it’s done.',
    done: (p) => p.hacked,
    checkpoint: { x: 10, y: 2 },
  },
  {
    title: 'Power the grid',
    keys: 'Now power up server A in the room to the right ({interact}). Its grid opens door A.',
    touch:
      'Now power up server A in the room to the right (Power). Its grid opens door A.',
    done: (p) => p.gridOn,
    checkpoint: { x: 10, y: 2 },
  },
  {
    title: 'Draw the sentry off',
    keys: 'Round the corner, a sentry stands in the records-room doorway, watching the hall ahead. Keep sneaking, face down the hall past it, and press {flare} to throw a flare. It walks off to look.',
    touch:
      'Round the corner, a sentry stands in the records-room doorway, watching the hall ahead. Keep sneaking, face down the hall past it, open your kit (the case button) and tap Flare. It walks off to look.',
    done: (p, s, b) => p.lures > s.lures || p.sentriesDown > b.sentriesDown,
    checkpoint: { x: 10, y: 1 },
  },
  {
    title: 'Follow the guide',
    keys: 'On a job, an arrow by your feet points the way to your next objective, and the PDA says how far ({guide}, or the PDA’s Guide button, turns it off and on). Right now it’s leading to the network closet at the end of the hall: follow it there.',
    touch:
      'On a job, an arrow by your feet points the way to your next objective, and the PDA says how far (its Guide button turns it off and on). Right now it’s leading to the network closet at the end of the hall: follow it there.',
    done: (p) => at(p, 12, 1),
    guide: true,
    goal: { x: 12, y: 1 },
    checkpoint: { x: 10, y: 1 },
  },
  {
    title: 'Take the uplink down',
    keys: 'While the building’s uplink is up, every file you photograph streams straight out, so the workstations stay locked. Press {interact} at the network cabinet in this closet and stay close until the uplink reads Down.',
    touch:
      'While the building’s uplink is up, every file you photograph streams straight out, so the workstations stay locked. Tap Interact at the network cabinet in this closet and stay close until the uplink reads Down.',
    done: (p) => p.uplinkDown,
    goal: { x: 12, y: 0 },
    checkpoint: { x: 10, y: 1 },
  },
  {
    title: 'Photograph the file',
    keys: 'With the uplink down, the workstation is open. While the sentry stares at the flare, slip into the records room (or take it down from behind) and press {interact} at the workstation, then stay close while your PDA photographs the file.',
    touch:
      'With the uplink down, the workstation is open. While the sentry stares at the flare, slip into the records room (or take it down from behind) and tap Interact at the workstation, then stay close while your PDA photographs the file.',
    done: (p, s) => p.documents > s.documents,
    checkpoint: { x: 10, y: 1 },
  },
  {
    title: 'Wipe the logs',
    keys: 'Every file you photograph is logged, and the log batch goes out on a timer. The log console is in the room beside the records room (LOGS on the blueprint). It stays locked until every file is in, so now it’s open: press {interact} and stay close until the logs are wiped.',
    touch:
      'Every file you photograph is logged, and the log batch goes out on a timer. The log console is in the room beside the records room (LOGS on the blueprint). It stays locked until every file is in, so now it’s open: tap Interact and stay close until the logs are wiped.',
    done: (p, s) => p.logsWiped > s.logsWiped,
    goal: { x: 10, y: 0 },
    checkpoint: { x: 11, y: 1 },
  },
  {
    title: 'Check the blueprint',
    keys: 'Press {map} to open the blueprint: everything you’ve explored, drawn up. {map} or Esc closes it.',
    touch:
      'Open your kit (the case button) and tap Map to open the blueprint: everything you’ve explored, drawn up. Close it to carry on.',
    done: (p) => p.mapOpened,
    checkpoint: { x: 11, y: 1 },
  },
  {
    title: 'Get out',
    keys: 'The file is on your PDA, so the exit lift is open. Step inside to finish training.',
    touch:
      'The file is on your PDA, so the exit lift is open. Step inside to finish training.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 12, y: 1 },
  },
];

/**
 * Moves the coach on past every station the progress already satisfies
 * (a later one can already be done by the time an earlier one clears),
 * returning the new station index, the gates to open and shut, and any
 * notes on how they were done.
 */
export function advance(
  index: number,
  now: TrainingProgress,
  start: TrainingProgress,
  stations: readonly Station[] = STATIONS,
  begin: TrainingProgress = start
): { index: number; opened: number[]; closed: number[]; notes: string[] } {
  const opened: number[] = [];
  const closed: number[] = [];
  const notes: string[] = [];
  let i = index;
  let base = start;
  while (i < stations.length && stations[i]!.done(now, base, begin)) {
    const { opens, closes, note } = stations[i]!;
    if (opens !== undefined) opened.push(opens);
    if (closes !== undefined) closed.push(closes);
    const said = note?.(now, base, begin);
    if (said) notes.push(said);
    i++;
    // The lessons are checkboxes, not a queue: what was done since training began (a drone put down, the goggles tried, a torch switched) ticks the next one too, however early it was done.
    base = begin;
  }
  return { index: i, opened, closed, notes };
}

// ---- Up high: the second training course, offered before job 8 ----
//
// Every floor has its ceiling now (the grapple course, below, is the way up
// on a job's first floors), and by job 8 the towers, the pulses and the moving
// lasers are about too, the fast curtains you dash past not long after. This
// course teaches
// them on a floor of its own, the same way: a station at a time, a gate
// opening as each is done. Its floor is drawn like the first's (marks:
// @ arrival lift, X exit lift, g the guard walled in under the pipe, only
// reachable from above); the moving lasers and the ceiling are given
// alongside, below, since they aren't single cells.

export const CEILING_MAP: readonly string[] = [
  '#########################',
  '#@          1           #',
  '####### ######### #####2#',
  '####### ######### # ### #',
  '################### ### #',
  '#############           #',
  '#############5###########',
  '#############           #',
  '#########################',
  '#########################',
  '#########################',
  '#################g#######',
  '################# #######',
  '############### 3 #######',
  '############### #########',
  '###############       4X#',
  '#########################',
];

/** The sweeper, in the first junction, off its side pocket. */
export const CEILING_SWEEPERS: readonly Sweeper[] = [{ x: 3, y: 0, phase: 0, dir: 1 },
];

/**
 * The curtains: a slow one on the stretch past gate 1, with an alcove off its second cell to step into, and
 * a fast one on the stretch past gate 2, down to gate 5, with an alcove partway along.
 */
export const CEILING_SLIDERS: readonly Slider[] = [
  { axis: 'x', at: 0, from: 7, to: 10, phase: 0, speed: 1.3 }, // movingLasers.ts's SLIDE_SPEED
  { axis: 'x', at: 2, from: 6, to: 10, phase: 0.5, speed: 8 }, // its FAST_SLIDE_SPEED
];

/** The shutter: on the corridor past gate 5, with its panel in the cell before it and another beyond. */
export const CEILING_SHUTTERS: readonly ShutterPlan[] = [
  {
    x: 8,
    y: 3,
    dir: 'E',
    panels: [
      { x: 7, y: 3, wall: 'S' },
      { x: 9, y: 3, wall: 'S' },
    ],
  },
];

/**
 * The ceiling: a row of pipe through the first tower (in the corridor past
 * gate 2) and a column through the second (by the exit), crossing over the
 * walls between; the column runs over the walled-in guard.
 */
export const CEILING_PIPES: PipePlan = {
  towers: [
    { x: 10, y: 3, wall: 'N' },
    { x: 8, y: 7, wall: 'S' },
  ],
  lines: [
    { axis: 'x', at: 3, from: 0, to: 11 },
    { axis: 'z', at: 8, from: 0, to: 7 },
  ],
};

/** The pipe line over the guard, that you turn onto at the crossing. */
export const CEILING_COLUMN = 1;

/** The guard under the column, walled in, facing down its pocket, away from where you'll come. */
export const CEILING_GUARD = { x: 8, y: 5, facing: 0 };

export const CEILING_STATIONS: readonly Station[] = [
  {
    title: 'Duck the sweeper',
    keys: 'A laser turns in the junction ahead, at chest height. Press {sneak} to sneak and it passes over your head: sneak through it to the beacon. Walk through upright and it catches you.',
    touch: 'A laser turns in the junction ahead, at chest height. Tap Sneak and it passes over your head: sneak through it to the beacon. Walk through upright and it catches you.',
    done: (p) => at(p, 5, 0),
    opens: 1,
    goal: { x: 5, y: 0 },
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Let the curtain pass',
    keys: 'Past the gate, a laser curtain runs up and down the corridor. Nothing ducks it. Follow it in, step into the alcove on the right as it comes back, let it pass, then make for the beacon at the far end. ({camo} cloaks through it too.)',
    touch: 'Past the gate, a laser curtain runs up and down the corridor. Nothing ducks it. Follow it in, step into the alcove on the right as it comes back, let it pass, then make for the beacon at the far end. (Holding Sneak to cloak gets through it too.)',
    done: (p) => at(p, 11, 0),
    opens: 2,
    goal: { x: 11, y: 0 },
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Dash past a fast curtain',
    keys: 'This curtain runs faster than you walk: follow it in and it catches you coming back. Wait for it to head away, then duck into the alcove on the right and let it pass. The moment it’s gone by, face down the corridor, press {trap} to aim and {interact} to dash for the far end.',
    touch: 'This curtain runs faster than you walk: follow it in and it catches you coming back. Wait for it to head away, then duck into the alcove on the right and let it pass. The moment it’s gone by, face down the corridor, open your kit, tap Trap to aim and Dash to go for the far end.',
    done: (p) => at(p, 6, 2),
    opens: 5,
    goal: { x: 6, y: 2 },
    checkpoint: { x: 11, y: 1 },
  },
  {
    title: 'Slide under the shutter',
    keys: 'From job 12, timed shutters close off corridors. Hack the panel on the wall ({interact}) and the shutter rolls up, but it’s back down before you could walk there. Turn to face it, press {trap} to aim and {interact} to dash: the dash ends in a slide, under it as it closes. Too slow? Hack it again. On the far side, another panel opens it from there.',
    touch: 'From job 12, timed shutters close off corridors. Tap Hack at the panel on the wall and the shutter rolls up, but it’s back down before you could walk there. Turn to face it, open your kit, tap Trap to aim and Dash to go: the dash ends in a slide, under it as it closes. Too slow? Hack it again. On the far side, another panel opens it from there.',
    done: (p) => at(p, 9, 3),
    goal: { x: 9, y: 3 },
    checkpoint: { x: 7, y: 3 },
  },
  {
    title: 'Climb the tower',
    keys: 'The floors are taller, with pipes up in the dark and towers to reach them. Walk to the ladder on the side of the mast and press {interact} to climb. From the top you see over the walls around, and every enemy in sight is tagged: an amber diamond you can see through walls for 25 seconds. (Face the ladder again and {interact} climbs back down.)',
    touch: 'The floors are taller, with pipes up in the dark and towers to reach them. Walk to the ladder on the side of the mast and tap Climb. From the top you see over the walls around, and every enemy in sight is tagged: an amber diamond you can see through walls for 25 seconds. (Face the ladder again and tap Climb down to get back down.)',
    done: (p) => p.aloft === 'perch' && p.tagged > 0,
    goal: { x: 10, y: 3 },
    checkpoint: { x: 9, y: 3 },
  },
  {
    title: 'Hang from the pipe',
    keys: 'Turn to face along the pipe and press {interact} to grab it. Up in the dark nobody sees you unless you hang under one of its lamps.',
    touch: 'Turn to face along the pipe and tap Hang to grab it. Up in the dark nobody sees you unless you hang under one of its lamps.',
    done: (p) => p.aloft === 'hang',
    checkpoint: { x: 11, y: 3 },
    perch: 0,
  },
  {
    title: 'Shimmy and turn',
    keys: '{forward} and {back} shimmy along the pipe, over the walls. Shimmy to the junction box where the pipes cross (the beacon) and press {turnLeft} or {turnRight} to swing onto the other pipe.',
    touch: 'Push the stick up or down to shimmy along the pipe, over the walls. Shimmy to the junction box where the pipes cross (the beacon) and push the stick left or right to swing onto the other pipe.',
    done: (p) => p.aloft === 'hang' && p.gripLine === CEILING_COLUMN,
    goal: { x: 8, y: 3 },
    checkpoint: { x: 11, y: 3 },
    perch: 0,
  },
  {
    title: 'Death from above',
    keys: 'The guard below is walled in: the only way to it is from above, and it has no idea you’re up there. Shimmy on until you’re over it and Fire reads TAKEDOWN, then click (or {fire}) to drop on it. On a job, a takedown from above is worth bonus points.',
    touch: 'The guard below is walled in: the only way to it is from above, and it has no idea you’re up there. Shimmy on until you’re over it and Fire reads TAKEDOWN, then tap Fire to drop on it. On a job, a takedown from above is worth bonus points.',
    // The guard is walled in and only reachable from above: dropped on while hanging over it, before this station, still counts.
    done: (p, _s, b) => p.aerialTakedowns > b.aerialTakedowns || p.sentriesDown > b.sentriesDown,
    note: (p, _s, b) =>
      p.aerialTakedowns > b.aerialTakedowns ? null : 'THAT WORKS · BUT FROM ABOVE IT’S SILENT, AND WORTH A BONUS ON A JOB',
    opens: 3,
    checkpoint: { x: 11, y: 3 },
    perch: 0,
  },
  {
    title: 'Mind the pulses',
    keys: 'Electric pulses run the pipes, end to end and back, faster than you can shimmy, and one reaching your hands ends the job. Climb the tower past the gate and hang from its pipe. When you’re warned a pulse is coming, get off: {interact} over the tower puts you back on its platform, or click to drop.',
    touch: 'Electric pulses run the pipes, end to end and back, faster than you can shimmy, and one reaching your hands ends the job. Climb the tower past the gate and hang from its pipe. When you’re warned a pulse is coming, get off: tap Platform over the tower, or Fire to drop.',
    done: (p, s) => p.pulseWarnings > s.pulseWarnings && p.aloft !== 'hang',
    opens: 4,
    goal: { x: 8, y: 7 },
    checkpoint: { x: 7, y: 7 },
    perch: 1,
  },
  {
    title: 'Get out',
    keys: 'That’s the ceiling. Step into the exit lift to finish.',
    touch: 'That’s the ceiling. Step into the exit lift to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 10, y: 7 },
  },
];

/** The station the pulses come on at: before it, the pipes are quiet. */
export const CEILING_PULSES_FROM = CEILING_STATIONS.findIndex((st) => st.title === 'Mind the pulses');

/** localStorage key set once the player finishes the ceiling course. */
export const TRAINED_CEILING_KEY = 'mazeHeist.trainedCeiling';

/** The job the ceiling course is offered before. */
export const CEILING_BEFORE_JOB = 8;


// ---- The grapple: the third course, offered before the first job ----
//
// Hook a pipe from the floor, shimmy over a wall, drop on a guard who is walled
// in, hover over a records room's workstation past its sentry, and get out.
// The pipes run over the top of everything: one row over the first corridor
// (through a tower), a column over the guard's pocket, another row over the
// hall to the records room. Marks as the first course (@ arrival lift, g the
// guard shut in its pocket, $ the records room and its sentry, X exit lift).
//
//   y0  @ . . 1 . . . . . . . . . |
//   y1                 g        (the pocket, gate 2 below it)   |
//   y2      $ <sentry ... hall ...............|
//   y3                                        X (gate 3 above it)

export const GRAPPLE_MAP: readonly string[] = [
  '#########################',
  '#@    1                 #',
  '####################### #',
  '###############g####### #',
  '###############2####### #',
  '#######$                #',
  '#######################3#',
  '#######################X#',
  '#########################',
];

/** The grapple course's ceiling: a row over the first corridor (a tower on it), a column over the guard's pocket, a row over the hall. */
export const GRAPPLE_PIPES: PipePlan = {
  towers: [
    { x: 2, y: 0, wall: 'N' },
    { x: 9, y: 2, wall: 'S' },
  ],
  lines: [
    { axis: 'x', at: 0, from: 0, to: 11 },
    { axis: 'z', at: 7, from: 0, to: 3 },
    { axis: 'x', at: 2, from: 0, to: 11 },
  ],
};

/** The guard shut in its pocket behind gate 2, unaware: facing the gate. */
export const GRAPPLE_GUARD = { x: 7, y: 1, facing: 0 };

export const GRAPPLE_STATIONS: readonly Station[] = [
  {
    title: 'Hook the pipe',
    keys: 'Every building has pipes along its ceiling. Face the one over this corridor and press {grapple}: the grapple hooks it and hauls you up. Up there guards and dogs can’t see or hear you, but you hang by your own strength: the sweat drop beside the Grip meter swells as your arms tire.',
    touch:
      'Every building has pipes along its ceiling. Face the one over this corridor, open your kit (the case button) and tap Grapple: it hooks the pipe and hauls you up. Up there guards and dogs can’t see or hear you, but you hang by your own strength: the sweat drop beside the Grip meter swells as your arms tire.',
    done: (p) => p.aloft === 'hang',
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Over the wall',
    keys: 'A wall blocks the corridor, but the pipe runs over it. {forward} and {back} shimmy along the pipe: go over the wall to the beacon, then press {flare}ire (or click) to let go and drop down. Watch the Grip meter: a fall from an empty grip is loud.',
    touch:
      'A wall blocks the corridor, but the pipe runs over it. Push the stick up or down to shimmy along the pipe: go over the wall to the beacon, then tap Fire to let go and drop down. Watch the Grip meter: a fall from an empty grip is loud.',
    done: (p) => at(p, 4, 0) && p.aloft === null,
    goal: { x: 4, y: 0 },
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Drop on the guard',
    keys: 'Follow the corridor round to the beacon. A guard is shut in behind the gate to the north, out of reach on foot, and it has no idea you’re here. Face the gate and press {grapple} to hook the pipe over it, shimmy until you’re over the guard and Fire reads TAKEDOWN, then click (or {fire}) to drop on it. {back} takes you back if you’re heading the wrong way.',
    touch:
      'Follow the corridor round to the beacon. A guard is shut in behind the gate to the north, out of reach on foot, and it has no idea you’re here. Face the gate, open your kit and tap Grapple to hook the pipe over it, shimmy until you’re over the guard and Fire reads TAKEDOWN, then tap Fire to drop on it. Pull the stick back if you’re heading the wrong way.',
    done: (p, _s, b) => p.aerialTakedowns > b.aerialTakedowns || p.sentriesDown > b.sentriesDown,
    opens: 2,
    goal: { x: 7, y: 2 },
    checkpoint: { x: 7, y: 2 },
  },
  {
    title: 'Hover over the console',
    keys: 'A sentry guards the records room at the end of the hall, its back to you. Hook the pipe over the hall ({grapple}) and shimmy along it until you’re over the room, then press {grapple} again to lower yourself until you hover above the workstation. Press {interact} to photograph the file and stay put until it’s done. {grapple} hauls you back up. Hovering, your grip lasts about fifteen seconds, and nothing on the floor can see or hear you.',
    touch:
      'A sentry guards the records room at the end of the hall, its back to you. Hook the pipe over the hall (kit → Grapple) and shimmy along it until you’re over the room, then tap Grapple again to lower yourself until you hover above the workstation. Tap Capture and stay put until it’s done. Grapple again hauls you back up. Hovering, your grip lasts about fifteen seconds, and nothing on the floor can see or hear you.',
    // The ceiling runs over the wall and the guard to the records room: the file can be hovered for before the guard is dropped on.
    done: (p, _s, b) => p.documents > b.documents,
    opens: 3,
    goal: { x: 3, y: 2 },
    checkpoint: { x: 6, y: 2 },
  },
  {
    title: 'Get out',
    keys: 'The file is on your PDA and the exit lift is open. The sentry stands between you and the hall: haul yourself up ({grapple}), shimmy back along the pipe, and drop down well clear of it, out of its sight. Then walk to the lift to finish training.',
    touch: 'The file is on your PDA and the exit lift is open. The sentry stands between you and the hall: haul yourself up (Grapple), shimmy back along the pipe, and drop down well clear of it, out of its sight. Then walk to the lift to finish training.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 11, y: 2 },
  },
];

/** localStorage key set once the player finishes the grapple course. */
export const TRAINED_GRAPPLE_KEY = 'mazeHeist.trainedGrapple';


// ---- Staying hidden: the fourth training course, offered after the first ----
//
// The visibility meter, crouching, lying flat and the dash, in a hall with a sentry watching down it. The agent starts with the
// torch on, which makes them easy to see (a standing agent in torchlight is seen from 10 units, a crouched one from 5.5, a flat
// one from less than 2), so the distances line up with the cells: the guard is 9 cells from the lift, the meter
// wakes at 4 and turns amber at about 5, standing is seen from 6, crouching is safe from 7 and seen at 8, and only lying flat
// gets as close as the cell beside the guard. Marks: @ the lift, g the sentry, X the exit lift.

/** localStorage key set once the player finishes the stealth course. */
export const TRAINED_STEALTH_KEY = 'mazeHeist.trainedStealth';

export const STEALTH_MAP: readonly string[] = [
  '#############################',
  '#@                 g#########',
  '#####1#######################',
  '##### #######################',
  '##### #######################',
  '#####       2  U   V   W   X#',
  '#############################',
];

/** The sentry at the end of the hall, facing west, down it, toward you. */
export const STEALTH_GUARD = { x: 9, y: 0, facing: -Math.PI / 2 } as const;

export const STEALTH_STATIONS: readonly Station[] = [
  {
    title: 'Watch the meter',
    keys: 'A guard stands watch at the end of this hall, and your torch is on, which makes you easy to see. The VISIBILITY meter (top right) wakes when a guard is near: it fills as they could spot you, and reads SEEN when they have you. Walk toward the guard until it turns amber, EXPOSED.',
    touch:
      'A guard stands watch at the end of this hall, and your torch is on, which makes you easy to see. The VISIBILITY meter (top right) wakes when a guard is near: it fills as they could spot you, and reads SEEN when they have you. Walk toward the guard until it turns amber, EXPOSED.',
    done: (p) => p.exposure >= 0.6,
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Crouch',
    keys: 'Crouch to be harder to see. Press {sneak}: the meter drops, because a crouched agent is seen from about half the distance, and moves at half the pace.',
    touch: 'Crouch to be harder to see. Tap Sneak: the meter drops, because a crouched agent is seen from about half the distance, and moves at half the pace.',
    done: (p) => p.posture !== 'stand',
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Lie flat',
    keys: 'Lower still. You’re far enough away to stand safely: press {sneak} to stand, then tap it twice, quickly: crouch, then flat on the floor. (One press after a pause always stands you up.) The meter nearly empties.',
    touch: 'Lower still. You’re far enough away to stand safely: tap Sneak to stand, then tap it twice, quickly: crouch, then flat on the floor. (One tap after a pause always stands you up.) The meter nearly empties.',
    done: (p) => p.posture === 'prone',
    checkpoint: { x: 4, y: 0 },
  },
  {
    title: 'Crawl up to the guard',
    keys: 'Flat on the floor you crawl slowly, almost silently, and the guard sees you from barely a step away. Crawl to the beacon right beside it: crouched, you’d be seen at this range. You can’t do anything else from the floor, and {sneak} gets you up.',
    touch: 'Flat on the floor you crawl slowly, almost silently, and the guard sees you from barely a step away. Crawl to the beacon right beside it: crouched, you’d be seen at this range. You can’t do anything else from the floor, and Sneak gets you up.',
    done: (p) => at(p, 8, 0) && p.posture === 'prone',
    goal: { x: 8, y: 0 },
    opens: 1,
    checkpoint: { x: 5, y: 0 },
  },
  {
    title: 'Crawl back',
    keys: 'Crawl back to the beacon, until the meter has dropped: stand up this close to the guard and you’re seen.',
    touch: 'Crawl back to the beacon, until the meter has dropped: stand up this close to the guard and you’re seen.',
    done: (p) => at(p, 7, 0),
    goal: { x: 7, y: 0 },
    checkpoint: { x: 5, y: 0 },
  },
  {
    title: 'Creep out',
    keys: 'Now crouch: one press from the floor. Creep back down the hall to the junction, crouched: stand too soon and you’d be seen. The gate south is open.',
    touch: 'Now crouch: one tap from the floor. Creep back down the hall to the junction, crouched: stand too soon and you’d be seen. The gate south is open.',
    done: (p) => at(p, 2, 1),
    goal: { x: 2, y: 1 },
    checkpoint: { x: 5, y: 0 },
  },
  {
    title: 'Dash',
    keys: 'Sometimes hiding isn’t the answer and you have to be quick. Tap {forward} twice and hold the second tap: you dash. A dash is fast, but loud and easy to see, and the energy (by the posture marks, top right) runs out within a second or two. Dash to the beacon.',
    touch:
      'Sometimes hiding isn’t the answer and you have to be quick. Touch the stick twice, quickly, and hold the second touch while you push forward: you dash. A dash is fast, but loud and easy to see, and the energy (top right) runs out within a second or two. Dash to the beacon.',
    done: (p, s) => p.dashes > s.dashes,
    goal: { x: 5, y: 2 },
    opens: 2,
    checkpoint: { x: 2, y: 2 },
  },
  {
    title: 'Duck the beams',
    keys: 'A laser gate hangs across the hall ahead, high up. A cloak does nothing against this kind: the beams measure you, not what the cameras see. Crouch ({sneak}) and walk under them to the beacon. Standing, they catch you.',
    touch: 'A laser gate hangs across the hall ahead, high up. A cloak does nothing against this kind: the beams measure you, not what the cameras see. Tap Sneak to crouch and walk under them to the beacon. Standing, they catch you.',
    done: (p) => at(p, 8, 2),
    goal: { x: 8, y: 2 },
    checkpoint: { x: 6, y: 2 },
  },
  {
    title: 'Crawl beneath the low beam',
    keys: 'This beam is low: crouching is not enough. Press {sneak} twice, quickly, to lie flat, and crawl beneath it to the beacon. (One press after a pause stands you up again.)',
    touch: 'This beam is low: crouching is not enough. Tap Sneak twice, quickly, to lie flat, and crawl beneath it to the beacon. (One tap after a pause stands you up again.)',
    done: (p) => at(p, 10, 2),
    goal: { x: 10, y: 2 },
    checkpoint: { x: 8, y: 2 },
  },
  {
    title: 'Wait for the gap',
    keys: 'A pulsing curtain: it blinks off for a moment, and flickers just before it comes back. Nothing ducks it, and a cloak is no use. Wait for it to go off, then walk through the gap to the beacon.',
    touch: 'A pulsing curtain: it blinks off for a moment, and flickers just before it comes back. Nothing ducks it, and a cloak is no use. Wait for it to go off, then walk through the gap to the beacon.',
    done: (p) => at(p, 12, 2),
    goal: { x: 12, y: 2 },
    checkpoint: { x: 10, y: 2 },
  },
  {
    title: 'Get out',
    keys: 'That’s the lot: stand, crouch, flat, a dash when there’s no time, and the beams a cloak can’t beat. Step into the exit lift to finish training.',
    touch: 'That’s the lot: stand, crouch, flat, a dash when there’s no time, and the beams a cloak can’t beat. Step into the exit lift to finish training.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 5, y: 2 },
  },
];

// ---- the weapons course (offered after the first course): the stun gun's rhythm ----
//
// One shot, then the gun recharges: the pill by the Fire button says RECHARGING, hums as it fills, and chimes when it's READY.
// Pressing Fire in between only clicks. Two sentries stand in a hall with their backs to you, to learn it on, and a heavy
// enforcer past them, which takes three stuns (one armour plate each) and so three recharges. Marks: @ the lift, g and G the
// sentries, H the heavy, X the exit lift.

/** localStorage key set once the player finishes the weapons course. */
export const TRAINED_WEAPONS_KEY = 'mazeHeist.trainedWeapons';

export const WEAPONS_MAP: readonly string[] = [
  '#################################',
  '#@   g   G  1    H  2      K   X#',
  '#################################',
];

/** The two sentries stand facing east, down the hall, their backs to you; the first heavy at the far end faces west, toward you; the second faces east, away. */
export const WEAPONS_SENTRY_FACING = Math.PI / 2;
export const WEAPONS_HEAVY_FACING = -Math.PI / 2;
export const WEAPONS_TRAP_HEAVY_FACING = Math.PI / 2;

export const WEAPONS_STATIONS: readonly Station[] = [
  {
    title: 'Fire the gun',
    keys: 'Your stun gun fires one shot at a time. Turn to face the guard ahead, its back is to you ({turnLeft} and {turnRight} turn), and press {fire} (or click). Listen for the shot.',
    touch: 'Your stun gun fires one shot at a time. Turn to face the guard ahead, its back is to you (push the stick left or right), and tap Fire. Listen for the shot.',
    // However a guard goes down (shot, or a silent takedown) the lesson moves on: it is the guard that matters, not how.
    done: (p, s, b) => p.shots > s.shots || p.sentriesDown > b.sentriesDown,
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'It has to recharge',
    keys: 'After every shot the gun recharges: the pill by your feet reads RECHARGING, the bar fills, and the gun hums as it fills. Press {fire} again right now: it only clicks. It is not a burst.',
    touch: 'After every shot the gun recharges: the pill above the stick reads RECHARGING, the bar fills, and the gun hums as it fills. Tap Fire again right now: nothing happens. It is not a burst.',
    done: (p, s, b) => p.dryFires > s.dryFires || p.shots > s.shots || p.sentriesDown >= b.sentriesDown + 2,
    note: (p, s) =>
      p.dryFires > s.dryFires ? null : 'YOU WAITED FOR IT · THAT IS THE RHYTHM: ONE SHOT, THEN WAIT FOR THE CHIME',
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Wait for the chime',
    keys: 'Both guards stand with their backs to you. Wait for the bright chime and READY, then fire. One shot puts a guard down, so there is no need to hurry: a shot that misses costs you the whole wait again. Put both guards down.',
    touch: 'Both guards stand with their backs to you. Wait for the bright chime and READY, then tap Fire. One shot puts a guard down, so there is no need to hurry: a shot that misses costs you the whole wait again. Put both guards down.',
    done: (p, _s, b) => p.sentriesDown >= b.sentriesDown + 2,
    opens: 1,
    checkpoint: { x: 1, y: 0 },
  },
  {
    title: 'Flash grenade',
    keys: 'Past the gate a heavy enforcer waits, facing you. Before you shoot, blind it: press {flash} (the 1 key; on a screen, the Flash button, top right) and a flash grenade is thrown ahead of you. It goes off with a crack and a white-out, and everything with a clear line to it, within seven metres, is blinded and deafened for ten seconds (five for a heavy), then goes to look at where it burst, not at where you are. Step closer if it lands too far off. It is also what you throw when a guard has you.',
    touch: 'Past the gate a heavy enforcer waits, facing you. Before you shoot, blind it: open your kit (the case button) and tap Flash, and a flash grenade is thrown ahead of you. It goes off with a crack and a white-out, and everything with a clear line to it, within seven metres, is blinded and deafened for ten seconds (five for a heavy), then goes to look at where it burst, not at where you are. Step closer if it lands too far off. It is also what you throw when a guard has you: the Flash button pulses.',
    // The heavy is the point: down by a flash and shots, or by shots alone, it moves on.
    done: (p, s, b) => p.flashDazed > s.flashDazed || p.heaviesDown > b.heaviesDown,
    note: (p, s) => (p.flashDazed > s.flashDazed ? null : 'THAT WORKS · BUT A FLASH BLINDS AND DEAFENS IT, AND ANYTHING NEAR IT, FOR TEN SECONDS'),
    checkpoint: { x: 4, y: 0 },
  },
  {
    title: 'Three plates, three shots',
    keys: 'A heavy enforcer waits at the end of the hall, in armour a stun cannot get through in one: each shot cracks one of the three glowing plates over its head, and it staggers. Stay out of its sight, shoot, wait for the chime, shoot, wait, shoot. If it walks toward you, back away between shots.',
    touch: 'A heavy enforcer waits at the end of the hall, in armour a stun cannot get through in one: each shot cracks one of the three glowing plates over its head, and it staggers. Stay out of its sight, tap Fire, wait for the chime, tap, wait, tap. If it walks toward you, back away between shots.',
    done: (p, _s, b) => p.heaviesDown > b.heaviesDown,
    opens: 2,
    checkpoint: { x: 4, y: 0 },
  },
  {
    title: 'Set a trap on the spot',
    keys: 'Past the gate a second heavy stands with its back to you. A trap knocks it out in one go, armour or not. Press {trap} to line up a trap, then {trapHere} to set it right where you stand, its camera looking the way you face.',
    touch: 'Past the gate a second heavy stands with its back to you. A trap knocks it out in one go, armour or not. Tap the case button (above Fire), tap Trap, then tap Set here to drop it where you stand.',
    // The second heavy down by any other means (the gun, a trap rolled in early) ends the lesson on it.
    done: (p, s, b) => p.trapsHere > s.trapsHere || p.heaviesDown >= b.heaviesDown + 2,
    checkpoint: { x: 10, y: 0 },
  },
  {
    title: 'Slide one into place',
    keys: 'Traps don’t have to go where you stand. Press {trap}: a line on the floor shows where a trap would roll (two cells at most) and the ring its blast. Turn to aim the line down the hall at the heavy, then press {trap} again to roll it. It settles at the heavy’s feet. Walk a cell closer first if the line falls short.',
    touch: 'Traps don’t have to go where you stand. Tap the case button, tap Trap: a line on the floor shows where a trap would roll (two cells at most) and the ring its blast. Turn with the stick to aim the line down the hall at the heavy, then tap Roll. It settles at the heavy’s feet. Walk a cell closer first if the line falls short.',
    done: (p, s, b) => p.trapsRolled > s.trapsRolled || p.heaviesDown >= b.heaviesDown + 2,
    checkpoint: { x: 10, y: 0 },
  },
  {
    title: 'Blow it',
    keys: 'Watch the trap camera (top right): the rolled trap is the one in view ({nextTrap} switches between traps). The heavy never leaves its post, but it sweeps its gaze, and that is motion: the trap blows by itself a moment after it is standing on it. Or press {detonate} yourself. Blown from here you are well clear of the blast. A trap needs a moment to arm.',
    touch: 'Watch the trap camera: the rolled trap is the one in view. The heavy never leaves its post, but it sweeps its gaze, and that is motion: the trap blows by itself a moment after it is standing on it. Or tap Detonate on the camera panel, top right. Blown from here you are well clear of the blast. A trap needs a moment to arm.',
    done: (p, _s, b) => p.heaviesDown >= b.heaviesDown + 2,
    note: (p) =>
      p.trapKills > 0 ? null : 'THAT WORKS TOO · BUT A TRAP DOES IT FROM A SAFE DISTANCE',
    checkpoint: { x: 10, y: 0 },
  },
  {
    title: 'Get out',
    keys: 'That is the gun and the trap: one shot, then the chime; a trap set on the spot or slid into place, and blown from a distance. Step into the exit lift to finish.',
    touch: 'That is the gun and the trap: one shot, then the chime; a trap set on the spot or slid into place, and blown from a distance. Step into the exit lift to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 10, y: 0 },
  },
];

// ---- Cover fire ----
//
// Behind a crate across a hall, lean out, put the crosshair on a guard walking up the hall, and stun him. The hall is one cell wide and runs south
// from the lift: the crate in the second cell, a gate shut behind it, and the guard past the gate, his back to you until the third station sends him up the hall.
// Marks: @ the lift, c the crate (its low cover hides a crouch, not a body that's leaned out to aim), g the guard, X the exit lift, 1 the gate.

/** localStorage key set once the player finishes the cover-fire course. */
export const TRAINED_COVER_KEY = 'mazeHeist.trainedCover';

export const COVER_MAP: readonly string[] = [
  '###',
  '#@#',
  '# #',
  '#c#',
  '#1#',
  '# #',
  '# #',
  '#g#',
  '# #',
  '#b#',
  '# #',
  '# #',
  '# #',
  '#p#',
  '# #',
  '#e#',
  '# #',
  '# #',
  '# #',
  '#h#',
  '# #',
  '#f#',
  '# #',
  '# #',
  '# #',
  '#H#',
  '# #',
  '#i#',
  '# #',
  '# #',
  '# #',
  '#d#',
  '# #',
  '#j#',
  '# #',
  '# #',
  '# #',
  '#m#',
  '# #',
  '#k#',
  '# #',
  '# #',
  '# #',
  '#q#',
  '#2#',
  '# #',
  '# #',
  '#X#',
  '###',
];

/** The guard stands facing south, away from you, until he is sent up the hall. */
export const COVER_GUARD_FACING = 0;

export const COVER_STATIONS: readonly Station[] = [
  {
    title: 'Take cover',
    keys: 'A crate lies across the hall. Walk up to it: beside it you go see-through, which is cover. A guard stands past the gate at the far end. Crouched behind low cover you are hidden, so he cannot see you here.',
    touch: 'A crate lies across the hall. Walk up to it: beside it you go see-through, which is cover. A guard stands past the gate at the far end. Crouched behind low cover you are hidden, so he cannot see you here.',
    done: (p, _s, b) => p.inCover || p.aimsBegun > b.aimsBegun,
    opens: 1,
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Aim',
    keys: 'Press {aim} (or the right mouse button) to aim: the camera comes in behind your shoulder and a crosshair appears in the middle. You hold still while you aim, and it works anywhere, not only behind cover. Steer left and right with {turnLeft} and {turnRight}, up and down with {forward} and {back}, or use the mouse. In the open he can see you, so only aim when you mean to shoot. Press {aim} again to lower the gun.',
    touch: 'Tap Aim: the camera comes in behind your shoulder and a crosshair appears in the middle. You hold still while you aim, and it works anywhere, not only behind cover. Steer it with the stick in any direction. In the open he can see you, so only aim when you mean to shoot. Tap Duck to lower the gun.',
    done: (p, s) => p.aimsBegun > s.aimsBegun || (p.coverEncounter?.station === 2 && p.coverEncounter.disabled),
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Take the shot',
    keys: 'Sentries hold a post and scan. One stun disables a sentry. This practice target stays still and does not attack. Stay behind the crate, press {aim}, and swing the crosshair onto him: it turns red when he is in the sights. Then press {fire} (or click). One stun puts him down, and a miss costs the whole recharge.',
    touch: 'Sentries hold a post and scan. One stun disables a sentry. This practice target stays still and does not attack. Stay behind the crate, tap Aim, and push the stick to swing the crosshair onto him: it turns red when he is in the sights. Then tap Fire. One stun puts him down, and a miss costs the whole recharge.',
    // However he went down, the lesson moves on (a takedown as he turned his back would strand it otherwise); the note says what was missed.
    done: (p, _s, b) => (p.coverEncounter?.station === 2 && p.coverEncounter.disabled) || p.aimedDowns > b.aimedDowns || p.sentriesDown > b.sentriesDown || p.takedowns > b.takedowns,
    note: (p, _s, b) =>
      p.aimedDowns > b.aimedDowns ? null : 'DOWN · BUT THE LESSON WAS THE AIMED SHOT: AIM, PUT THE CROSSHAIR ON HIM, FIRE',
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Patrol guard',
    enemy: 'patrol',
    enemyAt: { x: 0, y: 6 },
    goal: { x: 0, y: 4 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Patrol guards walk a route and investigate noise. One stun disables them; a rear takedown is silent. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Patrol guards walk a route and investigate noise. One stun disables them; a rear takedown is silent. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 3 && p.coverEncounter.disabled,
    checkpoint: { x: 0, y: 3 },
  },
  {
    title: 'Hunter',
    enemy: 'hunter',
    enemyAt: { x: 0, y: 9 },
    goal: { x: 0, y: 7 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Hunters respond to alarms and move faster than ordinary guards. One stun still disables them. Aim and stop this one before it closes in. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Hunters respond to alarms and move faster than ordinary guards. One stun still disables them. Aim and stop this one before it closes in. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 4 && p.coverEncounter.disabled,
    checkpoint: { x: 0, y: 6 },
  },
  {
    title: 'Heavy enforcer',
    enemy: 'heavy',
    enemyAt: { x: 0, y: 12 },
    goal: { x: 0, y: 10 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Heavy armour takes three body shots, but one accurately aimed headshot disables it. Each hit removes a glowing plate and briefly staggers it. Duck and wait for the recharge between shots. Tilt your aim up to its head for the single-shot option. An EMP also disables it in one. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Heavy armour takes three body shots, but one accurately aimed headshot disables it. Each hit removes a glowing plate and briefly staggers it. Duck and wait for the recharge between shots. Tilt your aim up to its head for the single-shot option. An EMP also disables it in one. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 5 && p.coverEncounter.disabled,
    checkpoint: { x: 0, y: 9 },
  },
  {
    title: 'Watchdog',
    enemy: 'watchdog',
    enemyAt: { x: 0, y: 15 },
    goal: { x: 0, y: 13 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Watchdogs track sound; cover alone does not stop them finding you. Stuns only slow them for six seconds. Fire automatically selects EMP when you have a charge. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Watchdogs track sound; cover alone does not stop them finding you. Stuns only slow them for six seconds. Fire automatically selects EMP when you have a charge. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 6 && p.coverEncounter.disabled,
    checkpoint: { x: 0, y: 12 },
  },
  {
    title: 'Crawler mine',
    enemy: 'crawler',
    enemyAt: { x: 0, y: 18 },
    goal: { x: 0, y: 16 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Crawler mines rush and explode when you approach. One stun or an EMP disables them. Shoot this one from cover before moving closer. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Crawler mines rush and explode when you approach. One stun or an EMP disables them. Shoot this one from cover before moving closer. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 7 && p.coverEncounter.disabled,
    checkpoint: { x: 0, y: 15 },
  },
  {
    title: 'Drone',
    enemy: 'drone',
    enemyAt: { x: 0, y: 21 },
    goal: { x: 0, y: 19 },
    keys: 'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Drones patrol overhead and ignore stuns and takedowns. Fire automatically selects EMP. Face the drone down the hall and disable it before stepping out. Stay behind cover: {aim} aims, then {fire} shoots. {aim} again lowers the gun; {forward}/{back} tilt the aim.',
    touch:
      'Follow the beacon to the next crate and take cover. In this practice course the enemy stays still and does not attack. Drones patrol overhead and ignore stuns and takedowns. Fire automatically selects EMP. Face the drone down the hall and disable it before stepping out. Stay behind cover: tap Aim, then Fire. Use the stick to aim up/down or left/right. Tap Duck to lower the gun.',
    done: (p) => p.coverEncounter?.station === 8 && p.coverEncounter.disabled,
    opens: 2,
    checkpoint: { x: 0, y: 18 },
  },
  {
    title: 'Get out',
    keys: 'The enemy course is complete. That is cover fire: hidden behind low cover until you aim, the crosshair where the shot goes, and the guard down before he reaches you. Step into the exit lift to finish.',
    touch: 'The enemy course is complete. That is cover fire: hidden behind low cover until you aim, the crosshair where the shot goes, and the guard down before he reaches you. Step into the exit lift to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 0, y: 22 },
  },
];


// ---- Corners and high ground: the cover course's follow-on ----
//
// Two places to shoot from that are not behind a crate. Where a wall ends at a turn, the agent hugs it out of sight of the long hall beyond and leans out round the end to shoot
// down it; from a tower's platform they lie flat, tilt the aim down and shoot what they can see over the walls. The guards are practice targets: still, and not shooting back.
//
//   y0  @ . . .             the corridor turns south at x3 (the corner is the south wall's end, in the cell before it)
//   y1          .
//   y2          .
//   y3          g  (gate 1 under him)
//   y4          . . T . . . . G 2 X     a tower on the hall's north wall at x6; the second guard 16 m from it; gate 2 before the lift
// Marks: @ the lift, g the first guard, G the second, X the exit lift.

/** localStorage key set once the player finishes the corners course. */
export const TRAINED_CORNERS_KEY = 'mazeHeist.trainedCorners';

export const CORNERS_MAP: readonly string[] = [
  '#########################',
  '#@      #################',
  '####### #################',
  '####### #################',
  '####### #################',
  '####### #################',
  '####### #################',
  '#######g#################',
  '#######1#################',
  '#######              G2X#',
  '#########################',
];

/** The tower on the hall's north wall, with the pipe over the hall it is part of. */
export const CORNERS_PIPES: PipePlan = {
  towers: [{ x: 6, y: 4, wall: 'N' }],
  lines: [{ axis: 'x', at: 4, from: 3, to: 11 }],
};

/** The first guard stands at the foot of the long hall facing north, up it; the second at the end of the hall facing west, toward the tower. */
export const CORNERS_GUARDS = [
  { x: 3, y: 3, facing: Math.PI },
  { x: 10, y: 4, facing: -Math.PI / 2 },
] as const;

export const CORNERS_STATIONS: readonly Station[] = [
  {
    title: 'Take the corner',
    keys: 'The corridor turns south ahead, and a guard stands at the far end of the long hall beyond the turn. Walk to the beacon, the last cell before the corner, then edge up against the wall on your right, near its end, and stand still a moment: you go see-through, pressed back against the wall. Round its end he cannot see you, and you cannot see him.',
    touch: 'The corridor turns south ahead, and a guard stands at the far end of the long hall beyond the turn. Walk to the beacon, the last cell before the corner, then edge up against the wall on your right, near its end, and stand still a moment: you go see-through, pressed back against the wall. Round its end he cannot see you, and you cannot see him.',
    done: (p) => p.inCover,
    goal: { x: 2, y: 0 },
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Look round it',
    keys: 'Step out past the end of the wall and press {aim}: the long hall is in front of you, the crosshair up. You hold still while you aim, and the aim swings all the way round. Press {aim} again to lower the gun, and step back behind the wall.',
    touch: 'Step out past the end of the wall and tap Aim: the long hall is in front of you, the crosshair up. You hold still while you aim, and the aim swings all the way round. Tap Duck to lower the gun, and step back behind the wall.',
    done: (p, s) => p.aimsBegun > s.aimsBegun,
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Shoot down the hall',
    keys: 'The guard at the end of the hall is a practice target: he stands still and does not shoot back. Put the crosshair on him, it turns red, and press {fire} (or click). Out in the open the hall is all that can see you, and you are only out for the shot.',
    touch: 'The guard at the end of the hall is a practice target: he stands still and does not shoot back. Push the stick to put the crosshair on him, it turns red, and tap Fire. Out in the open the hall is all that can see you, and you are only out for the shot.',
    done: (p, _s, b) => p.aimedDowns > b.aimedDowns || p.sentriesDown > b.sentriesDown || p.takedowns > b.takedowns,
    note: (p, _s, b) => (p.aimedDowns > b.aimedDowns ? null : 'DOWN · BUT THE LESSON WAS THE SHOT FROM THE CORNER: STEP OUT, AIM, PUT THE CROSSHAIR ON HIM, FIRE'),
    opens: 1,
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Climb the tower',
    keys: 'Through the gate, a tower stands against the hall’s north wall. Walk to the beacon at its foot and press {interact} to climb the ladder to the platform.',
    touch: 'Through the gate, a tower stands against the hall’s north wall. Walk to the beacon at its foot and tap Climb to go up the ladder to the platform.',
    done: (p) => p.aloft === 'perch',
    goal: { x: 6, y: 4 },
    checkpoint: { x: 4, y: 4 },
  },
  {
    title: 'Lie down and aim',
    keys: 'On the platform press {aim} (or {fire}): you lie flat on the boards and the view drops in behind the gun, as over a rifle’s sights. {forward} and {back} (or the mouse) tilt the aim up and down, {turnLeft} and {turnRight} swing it. Any other key gets you up again.',
    touch: 'On the platform tap Aim: you lie flat on the boards and the view drops in behind the gun, as over a rifle’s sights. The stick tilts the aim up and down and swings it. Tap Duck to get up again.',
    done: (p, s) => p.aloft === 'perch' && p.aimsBegun > s.aimsBegun,
    checkpoint: { x: 4, y: 4 },
    perch: 0,
  },
  {
    title: 'Shoot from up high',
    keys: 'The second guard stands at the far end of the hall, 16 m off: too far for the gun from the floor (14 m), but not from up here (22 m). Tilt the aim down until the crosshair is on him and turns red, then press {fire}. From up here you can only hit what you can see: a wall hides whatever is behind it.',
    touch: 'The second guard stands at the far end of the hall, 16 m off: too far for the gun from the floor (14 m), but not from up here (22 m). Tilt the aim down with the stick until the crosshair is on him and turns red, then tap Fire. From up here you can only hit what you can see: a wall hides whatever is behind it.',
    done: (p, _s, b) => p.sentriesDown >= b.sentriesDown + 2,
    opens: 2,
    checkpoint: { x: 4, y: 4 },
    perch: 0,
  },
  {
    title: 'Get out',
    keys: 'That is the corner and the high ground: round a wall’s end, and flat on a platform with the whole hall in the sights. Step into the exit lift to finish.',
    touch: 'That is the corner and the high ground: round a wall’s end, and flat on a platform with the whole hall in the sights. Step into the exit lift to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 10, y: 4 },
  },
];

// ---- Over the wall: the corners course's follow-on ----
//
// A maze wall as cover. A dash at a wall runs up it and the agent lies flat along its top, out of sight and hearing of the guards and dogs (not of a drone), and aims and shoots
// from there like off a tower's platform, or rolls over the far side, or drops on a guard below. A single corridor, two walls across it, a practice guard behind each: the first
// one to shoot from the top, the second right under the wall's far side, to drop on.
//
//   x0 @ . . . . [W1] . . . g . . [W2] G . X     (the walls stand between x4 and x5, and x8 and x9)
// Marks: @ the lift, g the first guard, G the second, X the exit lift.

/** localStorage key set once the player finishes the wall course. */
export const TRAINED_WALL_KEY = 'mazeHeist.trainedWall';

export const WALL_MAP: readonly string[] = [
  '#######################',
  '#@        #    g  #G X#',
  '#######################',
];

/** The first guard faces the first wall from 10 m beyond it; the second faces the second from 2 m beyond it (so he is right under the one who lies along it). */
export const WALL_GUARDS = [
  { x: 7, y: 0, facing: -Math.PI / 2 },
  { x: 9, y: 0, facing: -Math.PI / 2 },
] as const;

export const WALL_STATIONS: readonly Station[] = [
  {
    title: 'Run at the wall',
    keys: 'A wall as tall as the maze’s walls stands across the corridor. Walk to the beacon, face the wall, then dash: tap {forward} twice and hold the second tap, and keep running into it. You run up its face, pull over the top and lie flat along it. It takes a run: a short step against it does nothing.',
    touch: 'A wall as tall as the maze’s walls stands across the corridor. Walk to the beacon, face the wall, then dash: touch the stick twice, quickly, and hold the second touch while you push forward, into the wall. You run up its face, pull over the top and lie flat along it. It takes a run: a short step against it does nothing.',
    done: (p, _s, b) => p.wallTops > b.wallTops,
    goal: { x: 3, y: 0 },
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Shoot from the top',
    keys: 'Lying along the top you are out of sight and hearing of guards and dogs (a drone still sees you). Press {fire}: the view comes in behind the gun. Steer with {turnLeft} and {turnRight}, tilt with {forward} and {back}, put the crosshair on the guard down the corridor and press {fire} again. He is a practice target and does not shoot back.',
    touch: 'Lying along the top you are out of sight and hearing of guards and dogs (a drone still sees you). Tap Aim: the view comes in behind the gun. The stick steers and tilts the aim: put the crosshair on the guard down the corridor and tap Fire. He is a practice target and does not shoot back.',
    done: (p, _s, b) => p.sentriesDown > b.sentriesDown,
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Jump off',
    keys: 'To get down, press {interact}: you stand up on the wall, jump off the edge and land in a crouch that rises again. Here you jump off the far side; hold {strafeLeft} or {strafeRight} as you press it to go down the side you came up instead. (On a job the roll goes back down the side you climbed unless you push the other way.) Roll down on the far side.',
    touch: 'To get down, tap Jump off: you stand up on the wall, jump off the edge and land in a crouch that rises again. Here you jump off the far side; push the stick sideways as you tap to go down the side you came up instead. (On a job the roll goes back down the side you climbed unless you push the other way.) Roll down on the far side.',
    done: (p, _s, b) => p.wallRolls > b.wallRolls,
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Drop on the guard',
    keys: 'A second wall, and a guard just behind it (if you are still short of the first wall, climb it and jump down the far side). Dash at it and lie along the top. When he is below you, within a couple of metres, {interact} says Takedown: you roll off on top of him. It is silent, and worth a bonus on a job.',
    touch: 'A second wall, and a guard just behind it (if you are still short of the first wall, climb it and jump down the far side). Dash at it and lie along the top. When he is below you, within a couple of metres, the button says Takedown: you roll off on top of him. It is silent, and worth a bonus on a job.',
    done: (p, _s, b) => p.aerialTakedowns > b.aerialTakedowns || p.sentriesDown >= b.sentriesDown + 2,
    note: (p, _s, b) => (p.aerialTakedowns > b.aerialTakedowns ? null : 'DOWN · BUT FROM THE WALL’S TOP IT IS SILENT: LIE ALONG IT, WAIT UNTIL HE IS BELOW AND TAKE HIM DOWN'),
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Get out',
    keys: 'That is the wall: a dash up it, flat along the top out of sight, a shot or a drop from there, and a jump down. Step into the exit lift to finish.',
    touch: 'That is the wall: a dash up it, flat along the top out of sight, a shot or a drop from there, and a jump down. Step into the exit lift to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 9, y: 0 },
  },
];

// ---- The high wall ----
//
// A TALL wall: twice an ordinary wall's height, with a shelf along its face at an ordinary wall's height and another at its top. The same dash up it ends hanging from the shelf, feet on the wall, out over the
// corridor. A corridor with the tall wall along its south side (from x2 to x9) and a practice guard under it near each end: shimmy along the shelf, hop, drop on the first guard, leap
// on the second, climb to the top shelf, and on over the top into the second corridor on the far side of the wall, which leads back up to the exit lift.
//
//   y0 @ . . . . . g . . . G . X     (the tall wall runs along the south side from x2 to x9)
//   y1 . . . . . . . . . . . . .     (the far side: its only way out is up at the east end, under the lift)
// Marks: @ the lift, g the first guard, G the second, X the exit lift.

/** localStorage key set once the player finishes the high wall course. */
export const TRAINED_HIGHWALL_KEY = 'mazeHeist.trainedHighWall';

export const HIGHWALL_MAP: readonly string[] = [
  '#######################',
  '#@         g     G   X#',
  '##################### #',
  '#                     #',
  '#######################',
];

/** The tall wall (the south side of the first corridor), in cells: from this column to that. */
export const HIGHWALL_COLUMNS = { from: 2, to: 9 } as const;

/** The practice guards face west, toward where the agent comes from: right under the wall, as the wall course's second. */
export const HIGHWALL_GUARDS = [
  { x: 5, y: 0, facing: -Math.PI / 2 },
  { x: 8, y: 0, facing: -Math.PI / 2 },
] as const;

export const HIGHWALL_STATIONS: readonly Station[] = [
  {
    title: 'Up to the ledge',
    keys: 'The wall along the south side is twice as tall as the maze’s walls, and has a shelf along its face. Walk to the beacon, step back to the far side of the corridor, face the wall (south), then dash: tap {forward} twice and hold the second tap, and keep running into it. It takes a run (a few metres): from right beside the wall nothing happens. You run up the face and catch the shelf: this wall is too tall to climb over, so you hang from it, feet on the wall.',
    touch: 'The wall along the south side is twice as tall as the maze’s walls, and has a shelf along its face. Walk to the beacon, step back to the far side of the corridor, face the wall (south), then dash: touch the stick twice, quickly, and hold the second touch while you push forward, into the wall. It takes a run (a few metres): from right beside the wall nothing happens. You run up the face and catch the shelf: this wall is too tall to climb over, so you hang from it, feet on the wall.',
    done: (p, _s, b) => p.wallHangs > b.wallHangs,
    goal: { x: 3, y: 0 },
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Along the shelf',
    keys: 'You hang by your hands, as long as you like. {turnLeft} and {turnRight} swing you along the shelf, two and a half metres a hop; hold one and the hops run on, one after another. A hop is heard by the guards a couple of cells away: {strafeLeft} and {strafeRight} shimmy you along it instead, hand over hand, slow and silent. Go a few metres along the shelf.',
    touch: 'You hang by your hands, as long as you like. Push the stick left or right to swing along the shelf, two and a half metres a hop; hold it and the hops run on, one after another. A hop is heard by the guards a couple of cells away: the sidestep buttons shimmy you along it instead, hand over hand, slow and silent. Go a few metres along the shelf.',
    done: (p, _s, b) => p.hangMetres > b.hangMetres + 3,
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Drop on the guard',
    keys: 'A guard stands under the wall ahead. Hop or shimmy along until you are over him, and when {fire} reads Takedown, press it: you let go and drop on him. It is silent, and worth a bonus on a job. (Without a guard below, {fire} just lets go; so does {back}, held on its own, which is the way down from the first shelf.)',
    touch: 'A guard stands under the wall ahead. Hop or shimmy along until you are over him, and when the fire button reads Takedown, tap it: you let go and drop on him. It is silent, and worth a bonus on a job. (Without a guard below, it just lets go; so does pulling the stick straight down, the way down from the first shelf.)',
    done: (p, _s, b) => p.aerialTakedowns > b.aerialTakedowns || p.sentriesDown > b.sentriesDown,
    checkpoint: { x: 3, y: 0 },
  },
  {
    title: 'Leap off the wall',
    keys: 'Another guard, further along. Dash at the wall again, get along the shelf to him, and press {interact}: you push off the wall and leap backwards, a couple of metres out, onto him if he is there.',
    touch: 'Another guard, further along. Dash at the wall again, get along the shelf to him, and tap Jump: you push off the wall and leap backwards, a couple of metres out, onto him if he is there.',
    done: (p, _s, b) => p.wallJumps > b.wallJumps,
    note: (p, _s, b) => (p.sentriesDown > b.sentriesDown + 1 ? 'BOTH GUARDS ARE DOWN · DASH AT THE WALL ANYWAY, AND LEAP OFF IT WITH THE JUMP BUTTON' : null),
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Up to the top shelf',
    keys: 'The wall has a second shelf, at its top. Dash at the wall again and, hanging from the first shelf, press {forward} on its own (no {turnLeft} or {turnRight}), once: you run up the wall as you did to reach the first shelf, and take hold of the second. A drop onto a guard from up there ({fire}, with him right under you) kills him, and the thud carries.',
    touch: 'The wall has a second shelf, at its top. Dash at the wall again and, hanging from the first shelf, push the stick straight up (not to a side), once: you run up the wall as you did to reach the first shelf, and take hold of the second. A drop onto a guard from up there (the fire button, with him right under you) kills him, and the thud carries.',
    done: (p, _s, b) => p.wallTops > b.wallTops,
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Down a level',
    keys: 'To come down one level without letting go of the wall, press {back} on its own, once, on the top shelf: you drop down three metres and catch the first shelf. (Shimmy and hop work on either shelf.) Drop down to the first shelf.',
    touch: 'To come down one level without letting go of the wall, pull the stick straight down, once, on the top shelf: you drop down three metres and catch the first shelf. (Shimmy and hop work on either shelf.) Drop down to the first shelf.',
    done: (p, _s, b) => p.wallLowers > b.wallLowers,
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Over the top',
    keys: 'You can go over. Dash at the wall, run up to the top shelf, and press {forward} on its own once more and keep it held: you pull yourself up onto the wall’s top and go straight on over, turning and lowering yourself into a hang from the top shelf on the far side. (Let go of {forward} while you are on the top and you stop there, crouched in plain sight; {forward} again goes on over.) ({back} or {fire} on the top climbs back down the side you came up.) Then drop to the floor on the far side with {back} (twice, from the top shelf) or {fire}.',
    touch: 'You can go over. Dash at the wall, run up to the top shelf, and push the stick straight up once more and keep it held: you pull yourself up onto the wall’s top and go straight on over, turning and lowering yourself into a hang from the top shelf on the far side. (Let go while you are on the top and you stop there, crouched in plain sight; push up again to go on over.) (Pulling the stick down or the fire button on the top climbs back down the side you came up.) Then drop to the floor on the far side by pulling the stick down (twice, from the top shelf) or with the fire button.',
    done: (p, _s, b) => p.wallCrosses > b.wallCrosses,
    checkpoint: { x: 6, y: 0 },
  },
  {
    title: 'Get out',
    keys: 'That is the tall wall: a dash up it, the shelf, a shimmy or a hop along it, a drop or a leap off it, the run up to the top shelf and back down, and over the top. The far side’s corridor leads back to the exit lift: step into it to finish.',
    touch: 'That is the tall wall: a dash up it, the shelf, a shimmy or a hop along it, a drop or a leap off it, the run up to the top shelf and back down, and over the top. The far side’s corridor leads back to the exit lift: step into it to finish.',
    done: () => false, // the lift itself ends training
    checkpoint: { x: 9, y: 0 },
  },
];

// ---- The dock yard ----
//
// An open-air level, not a lesson: eighteen by eleven cells of eight metres, a fence for a boundary, shipping containers to move between and hide among, a canal
// down the middle with a guarded bridge at its south end and a zipline across it, the port office on the east bank (the file) and the truck out. It runs on the
// course machinery (a hand-drawn floor, its own guards and dogs), with four short objectives for the coach. Played on localhost only, `?job=dock`.
//   @ the gate, $ the office's records room, X the truck.

const DOCK_COLS = 18;
const DOCK_ROWS = 11;

function buildDockMap(): string[] {
  const g: string[][] = Array.from({ length: DOCK_ROWS * 2 + 1 }, () => Array.from({ length: DOCK_COLS * 2 + 1 }, () => '#'));
  const solid = (x: number, y: number): boolean =>
    (x >= 14 && x <= 16 && y >= 0 && y <= 2 && !(x === 15 && y === 2)) || (x === 17 && (y === 4 || y === 6));
  const canal = (x: number, y: number): boolean => x === 8 && y <= 9;
  for (let y = 0; y < DOCK_ROWS; y++) {
    for (let x = 0; x < DOCK_COLS; x++) {
      if (solid(x, y)) continue;
      g[2 * y + 1]![2 * x + 1] = ' ';
      // Open to the east and the south, unless one of the two is solid or it is the canal's bank or the bridge's end.
      if (x + 1 < DOCK_COLS && !solid(x + 1, y) && !canal(x, y) && !canal(x + 1, y)) g[2 * y + 1]![2 * x + 2] = ' ';
      if (y + 1 < DOCK_ROWS && !solid(x, y + 1) && !(canal(x, y) && !canal(x, y + 1)) && !(canal(x, y + 1) && !canal(x, y))) g[2 * y + 2]![2 * x + 1] = ' ';
    }
  }
  g[1]![1] = '@';
  g[2 * 2 + 1]![2 * 15 + 1] = '$';
  g[2 * 5 + 1]![2 * 17 + 1] = 'X';
  return g.map((r) => r.join(''));
}

export const DOCK_MAP: readonly string[] = buildDockMap();

/** The tower (`?job=tower` on localhost): the entry level, a climb through a hall of three storeys and an office floor to the heist door. One station, for the coach: there is nothing to learn here, only a way to find. */
/** The exit level (the tower the other way, `?job=tower&exit=1`): one lesson, said once. */
export const EXIT_STATIONS: readonly Station[] = [
  {
    title: 'Get out',
    keys: 'The alarm is up and they are coming for you. You start at the top and the way out is the lift in the lobby, at the bottom. Everything is open: take the lifts, the stairs or drop from the rails, and shoot your way through. You carry TWO guns, fired one after the other so each shot comes twice as often as with one: {gun} (and Shift with a number) picks which. Enemies come in waves and are bent on stopping you, but you need not take any of them down. Furniture can be shot to bits for a clear line, and hit hurts: stay out of the red.',
    touch: 'The alarm is up and they are coming for you. You start at the top and the way out is the lift in the lobby, at the bottom. Everything is open: take the lifts, the stairs or drop from the rails, and shoot your way through. You carry TWO guns, fired one after the other so each shot comes twice as often as with one. Enemies come in waves and are bent on stopping you, but you need not take any of them down. Furniture can be shot to bits for a clear line, and a hit hurts: stay out of the red.',
    done: () => false, // the lift in the lobby ends it
    checkpoint: { x: 0, y: 0 },
  },
];

export const TOWER_STATIONS: readonly Station[] = [
  {
    title: 'Take the keycards',
    keys: 'Take the keycard on every floor (CARDS on the top bar counts them): only then does the heist door on the offices floor, at the top, open on the lift down to the heist. The card of each floor lies on a little desk, deep in the floor from where you come in. Taking down every guard and every dog, and switching off every camera at its panel on the wall (by hand, or by shooting the switch from across the room), is a bonus: it pays, but the door does not want it. The grand stairs rise from the hall to the balcony, a wide stair climbs to the gallery, and a stair at its west end goes on up to the offices. Or take the lift at the back: step in and {interact} to ride. Keep off the edge: the balustrade holds you, but the guards on the levels below can see you over it. Lie down ({sneak} twice) to crawl under a sofa or a desk (cyan ring on the floor): nobody can see you there. You can fire lying down anywhere, crawling included. Guards sometimes stop beside such a spot with their back to it: come out behind one for a silent takedown. Go from desk to desk, not across the open: line up the next one with {trap} and {interact} sprints and slides to the ring behind it and crouches there. Wait behind it for the guards to pass. On the gallery, sneak or crawl under the turning beam, step aside from the curtain that runs the back corridor, and wait out the pulsing one. There are no stairs from the balcony up: the opening at the gallery’s edge and the one to the offices are climbed. Stand back from the tall wall under the opening, dash at it and you catch its shelf; push forward again and you go up to the rail ledge over the opening, and {interact} pulls you over the rail onto the floor above. The hall’s keycard lies under a camera that does not sweep: its cone is a half circle, aimed at the desk, and it is mounted at the top of a free-standing double-height wall (a pylon). You cannot take the card while it is on. Dash at the pylon, push forward to the top shelf and {interact} switches the camera off (it cannot be shot out); its far face is out of its view, and from the top shelf you can pull up onto the wall’s top and over. The gallery’s lasers guard something: a curtain sweeps over the keycard’s desk, and a sweeper and a pulsing gate stand in front of the climb to the offices. The bridge across the atrium is a crawl in plain sight of the floors below and the cameras,. A chip lies in the middle of it, for a bonus. The guards at its two ends face away from it, so come out behind one for a silent takedown, and lie still and use camo while anyone looks your way. An alpha unit prowls every storey: it hears you, howls, shoots as soon as it has you in sight, runs at you and goes off, which ends the try. Shoot it from outside the red ring on the floor around it: its blast takes down every guard, dog and camera in the ring (and raises no suspicion), or use an EMP to stop it for good. Single laser lines guard some of the doorways between sections: one that rises and falls (cross it lying flat or crouched while it is above you), one that sweeps across (crawl under it).',
    touch: 'Take the keycard on every floor (CARDS on the top bar counts them): only then does the heist door on the offices floor, at the top, open on the lift down to the heist. The card of each floor lies on a little desk, deep in the floor from where you come in. Taking down every guard and every dog, and switching off every camera at its panel on the wall (by hand, or by shooting the switch from across the room), is a bonus: it pays, but the door does not want it. The grand stairs rise from the hall to the balcony, a wide stair climbs to the gallery, and a stair at its west end goes on up to the offices. Or take the lift at the back: step in and tap Use to ride. Keep off the edge: the balustrade holds you, but the guards on the levels below can see you over it. Tap the posture button twice to lie down and crawl under a sofa or a desk (cyan ring on the floor): nobody can see you there. You can fire lying down anywhere, crawling included. Guards sometimes stop beside such a spot with their back to it: come out behind one for a silent takedown. Go from desk to desk, not across the open: line up the next one with the trap button and tap Dash: you sprint and slide to the ring behind it and crouch there. Wait behind it for the guards to pass. On the gallery, sneak or crawl under the turning beam, step aside from the curtain that runs the back corridor, and wait out the pulsing one. There are no stairs from the balcony up: the opening at the gallery’s edge and the one to the offices are climbed. Stand back from the tall wall under the opening, dash at it (touch the stick twice, quickly, and hold) and you catch its shelf; push the stick up again and you go up to the rail ledge over the opening, and tap Use to pull yourself over the rail onto the floor above. The hall’s keycard lies under a camera that does not sweep: its cone is a half circle, aimed at the desk, and it is mounted at the top of a free-standing double-height wall (a pylon). You cannot take the card while it is on. Dash at the pylon (touch the stick twice, quickly, and hold), push the stick up to the top shelf and tap Use to switch the camera off (it cannot be shot out); its far face is out of its view, and from the top shelf you can pull up onto the wall’s top and over. The gallery’s lasers guard something: a curtain sweeps over the keycard’s desk, and a sweeper and a pulsing gate stand in front of the climb to the offices. The bridge across the atrium is a crawl in plain sight of the floors below and the cameras,. A chip lies in the middle of it, for a bonus. The guards at its two ends face away from it, so come out behind one for a silent takedown, and lie still and use camo while anyone looks your way. An alpha unit prowls every storey: it hears you, howls, shoots as soon as it has you in sight, runs at you and goes off, which ends the try. Shoot it from outside the red ring on the floor around it: its blast takes down every guard, dog and camera in the ring (and raises no suspicion), or use an EMP to stop it for good. Single laser lines guard some of the doorways between sections: one that rises and falls (cross it lying flat or crouched while it is above you), one that sweeps across (crawl under it).',
    done: () => false, // the heist door hands the agent on
    checkpoint: { x: 0, y: 0 },
  },
];

export const DOCK_STATIONS: readonly Station[] = [
  {
    title: 'The yard',
    keys: 'Open air, and the boundary is a fence: you can see through it, not out. Shipping containers stand in rows and blocks, tall enough to hide behind and to stop a guard seeing you; the crate pairs among them take a body. A canal splits the yard in two. Make your way west to east, and keep out of sight.',
    touch: 'Open air, and the boundary is a fence: you can see through it, not out. Shipping containers stand in rows and blocks, tall enough to hide behind and to stop a guard seeing you; the crate pairs among them take a body. A canal splits the yard in two. Make your way west to east, and keep out of sight.',
    done: (p) => p.cell.x >= 3,
    checkpoint: { x: 0, y: 0 },
  },
  {
    title: 'Cross the canal',
    keys: 'Two ways over. The bridge at the south end is open, and a guard stands at each end of it. Or the zipline: a tower stands on the west quay a few cells north of it, with a handle at the top. Stand under it and press {interact}: the trolley takes you over the water in a few seconds, silent, but it only runs one way, and you are in plain sight up there.',
    touch: 'Two ways over. The bridge at the south end is open, and a guard stands at each end of it. Or the zipline: a tower stands on the west quay a few cells north of it, with a handle at the top. Stand under it and tap Interact: the trolley takes you over the water in a few seconds, silent, but it only runs one way, and you are in plain sight up there.',
    done: (p) => p.cell.x >= 9,
    goal: { x: 6, y: 5 },
    checkpoint: { x: 6, y: 5 },
  },
  {
    title: 'The port office',
    keys: 'The file is in the records room of the port office, in the north-east corner, and a guard stands at its door. Go round, or draw him off. Photograph it at the workstation ({interact}) and stay put until it is done.',
    touch: 'The file is in the records room of the port office, in the north-east corner, and a guard stands at its door. Go round, or draw him off. Tap Capture at the workstation and stay put until it is done.',
    done: (p) => p.documents >= 1,
    goal: { x: 15, y: 2 },
    checkpoint: { x: 10, y: 5 },
  },
  {
    title: 'Get out',
    keys: 'The truck is backed up to the fence on the east edge. Walk to it and climb in to finish.',
    touch: 'The truck is backed up to the fence on the east edge. Walk to it and climb in to finish.',
    done: () => false, // the truck itself ends the level
    goal: { x: 17, y: 5 },
    checkpoint: { x: 15, y: 5 },
  },
];

// ---- the range (localhost, `?job=range`): an open hall to try the heavy guns in (the gun menu), their sound and their shots, at still targets ----

const RANGE_COLS = 14;
const RANGE_ROWS = 5;
export const RANGE_MAP: readonly string[] = (() => {
  const rows: string[][] = [];
  for (let r = 0; r <= 2 * RANGE_ROWS; r++) {
    rows.push(Array.from({ length: 2 * RANGE_COLS + 1 }, (_, c) => (r === 0 || r === 2 * RANGE_ROWS || c === 0 || c === 2 * RANGE_COLS ? '#' : ' ')));
  }
  rows[2 * 2 + 1]![1] = '@';
  rows[2 * 2 + 1]![2 * (RANGE_COLS - 1) + 1] = 'X';
  return rows.map((r) => r.join(''));
})();

/** Still targets (sentries, passive in the range) down the hall, at growing distances; they face the way you come in. */
export const RANGE_TARGETS: ReadonlyArray<{ x: number; y: number; facing: number }> = [
  { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 5, y: 2 }, { x: 7, y: 0 }, { x: 7, y: 4 }, { x: 9, y: 2 }, { x: 11, y: 1 }, { x: 11, y: 3 }, { x: 13, y: 2 },
].map((t) => ({ ...t, facing: -Math.PI / 2 }));

export const RANGE_STATIONS: readonly Station[] = [
  {
    title: 'The range',
    keys: 'An open hall of still targets. Press {gun} to choose a gun, and {fire} to shoot: each gun has its own shot and sound. Walk east to the lift to finish.',
    touch: 'An open hall of still targets. Open the kit and tap Gun to choose a gun, and tap Fire to shoot: each gun has its own shot and sound.',
    done: (p) => p.cell.x >= 13,
    checkpoint: { x: 0, y: 2 },
  },
];
