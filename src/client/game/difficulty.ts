// How hard each job is, all in one place: every count and every enemy
// setting the job is built with. Pure (no imports), so it's unit-tested and
// tuning means editing this file alone.
//
// The shape: harder means new rules, not just more of the same. Jobs come
// in chapters of about two, each bringing in one new thing (said as the job
// starts, via `newThisJob`), and counts grow gently between them. The maze
// stops growing at 14×10 by job 4, so a job stays a few minutes long
// however far in you are: after that jobs get more crowded and more
// complicated, never longer to walk. Enemies also get sharper as jobs go
// on: guards confirm a sighting faster, sentries sweep wider. The Daily
// Heist is built exactly like story mode's job of the same number.

export type Difficulty = {
  /** Said as the job starts when it brings in something new; null otherwise. */
  newThisJob: string | null;
  cols: number;
  rows: number;
  /** One floor on the first job (and in training), two after: a stair up to a second maze. */
  floors: 1 | 2;
  /** Patrol guards per floor (sentries come with storage rooms, on top of these). */
  guards: number;
  watchdogs: number;
  crawlers: number;
  /** Alpha units per floor (enemies/alpha.ts): robot dogs that run at you and go off; shoot one from beyond its blast radius, or EMP it. */
  alphas: number;
  drones: number;
  /** Heavy enforcers, one per server-room doorway up to this many. */
  heavies: number;
  /** Security doors per floor. */
  doors: number;
  /** Door B's terminal and server go inside section A (behind door A), so the doors open in a chain. */
  chainedDoors: boolean;
  lasers: number;
  /** Groups of line lasers per floor (linelasers.ts): single beams that rise and fall or sweep across a corridor, crossed lying flat or crouched; and how many lines the first group has (1-3). */
  lines: number;
  lineSize: 1 | 2 | 3;
  /** Laser gates per floor (evade.ts): beams a cloak does nothing about, beaten by ducking, crawling or waiting out a pulse. */
  gates: number;
  /** Sweeping lasers per floor: a beam turning at chest height in a junction (movingLasers.ts). */
  sweepers: number;
  /** Laser curtains per floor, running up and down a stretch of corridor (movingLasers.ts). */
  sliders: number;
  /** How many of those run fast: too quick to walk clear of, so you duck aside and dash. */
  fastSliders: number;
  /** Timed shutters per floor: hack the panel, then dash and slide under before it's down (shutters.ts). */
  shutters: number;
  /** Documents for the whole job, split across the floors. */
  documents: number;
  /** Decorative rooms per floor (offices, conference rooms, cafeterias). */
  decorRooms: number;
  crates: number;
  /** Staff lockers to hide in, per floor. */
  staffLockers: number;
  /** Vent pairs per floor. */
  vents: number;
  /** Tall floors with a ceiling of ducts and pipes over the corridors, and towers to climb up to them (pipes.ts). On every job. */
  pipes: boolean;
  /** Blacked-out patches per floor (blackout.ts), and about how many cells each covers. */
  blackouts: number;
  blackoutCells: number;
  /** Wiring circuits per floor, each with a breaker panel to cut (power.ts); 0 before job 10. */
  breakers: number;
  /** Seconds after files are captured before the log server sends the access logs out, unless they're wiped. */
  logWindowS: number;
  /** A silent night (twists.ts): no sentries on the doors, and a smaller floor for the slower pace. */
  silent?: boolean;
  /** EMP charges in hand at the start (more come from lockers). */
  empAtStart: number;
  /** Remote traps to set this job. */
  trapsAtStart: number;
  /** Seconds of clear sight a guard needs to confirm it has seen you. */
  guardReactionS: number;
  /** How far either side of its post a sentry's gaze sweeps, in radians. */
  sentrySweep: number;
};

/** What a job brings in, by the job it first appears. */
const NEW_AT: Record<number, string> = {
  2: 'NEW · LASER LINES: SINGLE BEAMS THAT RISE AND FALL OR SWEEP ACROSS A CORRIDOR. CAMO DOES NOTHING: CROSS A RISING ONE LYING FLAT OR CROUCHED WHILE IT IS ABOVE YOU, AND CRAWL UNDER A SWEEPING ONE',
  1: 'NEW · GRAPPLE (U): FACE A PIPE OVERHEAD TO HAUL YOURSELF UP, OUT OF THE GUARDS’ AND DOGS’ SIGHT AND HEARING. U AGAIN LOWERS YOU OVER A CONSOLE. YOUR ARMS TIRE, AND A FALL IS LOUD',
  3: 'NEW · WATCHDOGS HUNT BY SOUND: WALKING CARRIES, SNEAKING BARELY DOES, STANDING STILL IS SILENT',
  4: 'NEW · BLACKOUTS: PARTS OF THE FLOOR HAVE LOST POWER. PUT ON NIGHT VISION (R) TO SEE WITHOUT A TORCH, BUT WATCH ITS BATTERY',
  5: 'NEW · CRAWLER MINES, ALPHA UNITS AND CHAINED DOORS: AN ALPHA HOWLS, SHOOTS WHEN IT SEES YOU, RUNS AT YOU AND BLOWS, SO SHOOT IT FROM FAR OFF (ITS BLAST DOWNS EVERYONE AND SHORTS EVERY CAMERA IN ITS RING) OR EMP IT. ONE SECTION’S TERMINAL IS BEHIND ANOTHER DOOR',
  6: 'NEW · SWEEPING LASERS TURN IN SOME JUNCTIONS: SNEAK TO DUCK UNDER THE BEAM',
  7: 'NEW · DRONES SWEEP SEARCHLIGHTS FROM ABOVE; ONLY AN EMP BRINGS ONE DOWN',
  8: 'NEW · WATCHDOG PACKS: EVERY HALF MINUTE THEY REGROUP AT A MEETING POINT. FIND IT, ROLL A TRAP INTO IT AND TAKE THE WHOLE PACK AT ONCE',
  10: 'NEW · CIRCUIT BREAKERS: CUT ONE TO BLACK OUT ITS WHOLE SECTION, BUT A GUARD WILL BE SENT TO RESET IT',
  12: 'NEW · TIMED SHUTTERS: HACK THE PANEL AND ONE OPENS, BUT NOT FOR LONG. DASH FOR IT (G, THEN SPACE) AND SLIDE UNDER BEFORE IT’S DOWN',
  13: 'NEW · FAST LASER CURTAINS: TOO QUICK TO WALK CLEAR OF. DUCK INTO A SIDE PASSAGE AS ONE PASSES, THEN DASH FOR THE END (G TO AIM, THEN SPACE)',
  11: 'NEW · LASER CURTAINS RUN UP AND DOWN SOME CORRIDORS: YOU CAN’T DUCK ONE, SO STEP INTO A SIDE PASSAGE AND LET IT PASS',
  9: 'NEW · HEAVY ENFORCERS GUARD THE SERVER ROOMS: A STUN STAGGERS ONE, SO TAKE IT DOWN THEN (OR STUN IT THREE TIMES)',
};

/** The log batch's window: five minutes at first, tightening by fifteen seconds a job to three minutes, enough to take every file. */
export const MAX_LOG_WINDOW_S = 300;
export const MIN_LOG_WINDOW_S = 180;

/** The biggest a floor gets: big enough to get lost in, small enough to finish in a sitting. */
export const MAX_COLS = 14;
export const MAX_ROWS = 10;

/** Patrol guards keep pace with the maze: about one per this many cells, so big buildings don't thin out. */
const CELLS_PER_GUARD = 50;
const MAX_GUARDS = 4;

/** Job `level`'s settings. */
export function difficultyFor(level: number): Difficulty {
  const n = Math.max(1, Math.floor(level));
  const step = (every: number, from = 1): number =>
    Math.floor((n - from) / every);
  // The first two jobs are small (10×8), then it grows to the cap over two more.
  const cols = Math.min(10 + Math.max(0, n - 2) * 2, MAX_COLS);
  const rows = n < 3 ? 8 : MAX_ROWS;
  const cells = cols * rows;
  return {
    newThisJob: NEW_AT[n] ?? null,
    cols,
    rows,
    floors: n < 2 ? 1 : 2,
    // Each chapter's minimum, or enough to fill the maze, whichever is more. On a floor no bigger than 14×10,
    // every roster below tops out early: past that, jobs get harder with new rules, not more bodies
    // (a late floor holds about a dozen enemies all told, sentries included).
    guards: Math.min(MAX_GUARDS, Math.max(Math.min(2 + step(3), 4), Math.round(cells / CELLS_PER_GUARD))),
    watchdogs: n < 3 ? 0 : n < 8 ? 1 : 2, // two hunt as a pack
    crawlers: n < 5 ? 0 : n < 12 ? 1 : 2,
    alphas: n < 5 ? 0 : n < 10 ? 1 : 2,
    drones: n < 7 ? 0 : 1,
    heavies: n < 9 ? 0 : 1,
    doors: n <= 2 ? 1 : 2, // a 14×10 floor has room (dead ends) for about this many terminal–server pairs
    chainedDoors: n >= 5,
    lasers: Math.min(1 + step(3), 3),
    gates: n < 2 ? 1 : n < 6 ? 2 : 3, // from the first job, so a cloak is never the only answer to a beam
    lines: n < 2 ? 0 : n < 7 ? 1 : 2, // single beams from job 2; two groups from job 7
    lineSize: n < 4 ? 1 : n < 8 ? 2 : 3, // alone at first, then a pair, then a row of three
    sweepers: n < 6 ? 0 : n < 12 ? 1 : 2,
    sliders: n < 11 ? 0 : n < 14 ? 1 : 2,
    fastSliders: n < 13 ? 0 : 1,
    shutters: n < 12 ? 0 : 1,
    documents: Math.min(2 + step(2), 4), // each records room has a sentry on its door, so this is a guard count too
    decorRooms: Math.min(2 + step(3), 5),
    crates: n < 6 ? 4 : 3, // places to hide behind, and to put a body
    staffLockers: n < 2 ? 2 : 3, // to hide in, and to put a body
    vents: n < 4 ? 1 : 2,
    pipes: true, // every floor has its ceiling now: the grapple (grapple.ts) works anywhere; the towers come with it
    blackouts: n < 4 ? 0 : n < 12 ? 1 : 2,
    blackoutCells: Math.min(14 + 2 * Math.max(0, n - 4), 26, Math.round(cells / 12)),
    breakers: n < 10 ? 0 : n < 14 ? 2 : 3,
    logWindowS: Math.max(MIN_LOG_WINDOW_S, MAX_LOG_WINDOW_S - 15 * (n - 1)), // five minutes on the first job, fifteen seconds less each job, never under three
    empAtStart: n < 3 ? 1 : n < 9 ? 2 : 1, // the dogs (job 3) and the drones and packs after can only be stopped with these
    trapsAtStart: 2,
    guardReactionS: Math.max(1.4, 1.8 - 0.05 * (n - 1)),
    sentrySweep: Math.min(0.9, 0.6 + 0.03 * (n - 1)),
  };
}
