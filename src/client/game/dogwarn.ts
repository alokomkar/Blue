// The watchdog warning: a dog hunts by ear and a top-down camera can't see round a wall, so a dog on your trail has to announce itself some other way. From the dogs' distance and
// whether they're on the trail: how strong the warning is, how often the ping sounds (it quickens as the dog closes), and where on the screen its marker goes (on the dog when it's in
// view, on the screen's edge pointing its way when it's not). Pure; game.ts feeds it and hud.ts draws it.

/** A dog on the player's trail is flagged from this far (world metres); one only roaming or sniffing, from the shorter distance. */
export const TRACK_RANGE = 30;
export const ROAM_RANGE = 12;
/** Most markers shown at once: the nearest few. */
export const MAX_MARKERS = 4;

export type Dog = { x: number; z: number; dist: number; tracking: boolean };

/** How strong the warning from one dog is, 0 (none) to 1 (it's on you). A roaming dog never rates above 0.45: a heads-up, not an alarm. */
export function warnLevel(dog: { dist: number; tracking: boolean }): number {
  if (dog.tracking) return dog.dist >= TRACK_RANGE ? 0 : Math.max(0.2, 1 - dog.dist / TRACK_RANGE);
  return dog.dist >= ROAM_RANGE ? 0 : 0.45 * (1 - dog.dist / ROAM_RANGE);
}

/** Seconds between pings at a warning level: slow and calm at the edge of range, a frantic tick when it's close. */
export function pingGap(level: number): number {
  return 1.35 - 1.2 * Math.min(1, Math.max(0, level));
}

export type Marker = {
  /** Where on the screen, as fractions of its width and height (0 left, 0 top). */
  x: number;
  y: number;
  /** The way it points, radians on the screen (0 right, counter-clockwise positive, as a screen's y goes up). */
  angle: number;
  level: number;
  tracking: boolean;
  /** How far off it is, metres. */
  dist: number;
  /** The dog is in view: the marker sits on it and doesn't point. */
  onScreen: boolean;
};

const EDGE_X = 0.86;
const EDGE_Y = 0.8;

/** Where a dog's marker goes, from its projected position `(nx, ny)` in normalised device coordinates (-1..1, y up) and whether it's behind the camera. */
export function markerFor(nx: number, ny: number, behind: boolean, level: number, tracking: boolean, dist: number): Marker {
  let x = behind ? -nx : nx;
  let y = behind ? -ny : ny;
  const onScreen = !behind && Math.abs(x) <= EDGE_X && Math.abs(y) <= EDGE_Y;
  const angle = Math.atan2(y, x);
  if (!onScreen) {
    // Out along its bearing from the middle until it reaches the edge of the usable screen.
    const k = Math.max(Math.abs(x) / EDGE_X, Math.abs(y) / EDGE_Y, 1e-6);
    x /= k;
    y /= k;
  }
  return { x: (x + 1) / 2, y: (1 - y) / 2, angle, level, tracking, dist, onScreen };
}

/** The dogs worth a marker, the strongest first and at most MAX_MARKERS of them, with the loudest one's level (0 when there are none). */
export function strongest(dogs: readonly Dog[]): { picks: Array<{ dog: Dog; level: number }>; top: { dog: Dog; level: number } | null } {
  const picks = dogs
    .map((dog) => ({ dog, level: warnLevel(dog) }))
    .filter((p) => p.level > 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, MAX_MARKERS);
  return { picks, top: picks[0] ?? null };
}
