// Aiming at a guard from cover: the shot leaves the agent's eye level and flies where the crosshair points, so a head (a heavy's is 2 m up) is only hit once the aim is tilted
// up to it. This eases the tilt onto the head of whatever bot is already in the sights, until the player tilts by hand (then it keeps out of their way for a moment); and names
// what the crosshair is on. Pure; game.ts feeds it.

/** The tilt that sends a shot from `originY` to a head at `headY`, `dist` metres off (up positive, radians). */
export function headPitch(originY: number, headY: number, dist: number): number {
  return Math.atan2(headY - originY, Math.max(0.5, dist));
}

/** How fast the aim eases up to the head, radians a second: slow enough to see it happen, quick enough to be there before the shot. */
export const ASSIST_RATE = 0.9;
/** After the player's own tilt, how long (seconds) the assist waits before easing again. */
export const ASSIST_HOLDOFF_S = 0.7;

/** The aim's tilt, `dt` later: eased toward `want` unless the player tilted by hand `sinceManual` seconds ago (under ASSIST_HOLDOFF_S). */
export function assistPitch(pitch: number, want: number, sinceManual: number, dt: number): number {
  if (sinceManual < ASSIST_HOLDOFF_S) return pitch;
  const diff = want - pitch;
  const step = ASSIST_RATE * dt;
  return Math.abs(diff) <= step ? want : pitch + Math.sign(diff) * step;
}

/** What the crosshair says it is on: the zone it is locked to, and (a heavy's body is armour: a shot there only cracks a plate) a word to go with it. */
export function crosshairNote(zone: 'head' | 'body' | 'leg' | null, heavy: boolean): string {
  if (zone === 'head') return 'HEAD';
  if (zone === 'body' && heavy) return 'ARMOUR · AIM HIGHER';
  return '';
}
