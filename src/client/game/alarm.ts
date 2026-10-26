// The global alarm. Suspicion climbing past ALARM_ON trips it: red lights,
// a klaxon, the soundtrack's alarm layer, bots moving faster, and a wave of
// hunters sent after the player. It only clears once suspicion has fallen
// well back (ALARM_OFF), so it doesn't flicker on and off around one number.
// Pure, tested under Node.

export const ALARM_ON = 70;
export const ALARM_OFF = 45;
export const ALARM_SPEED = 1.25; // humanoid bots move this much faster while it's up
export const HUNTERS_PER_WAVE = 2;
export const MAX_HUNTER_WAVES = 2; // per job

/** Whether the alarm is up, given whether it was and the suspicion now. */
export function alarmState(active: boolean, suspicion: number): boolean {
  return active ? suspicion >= ALARM_OFF : suspicion >= ALARM_ON;
}

/** Whether tripping the alarm now sends another wave of hunters. */
export function sendsHunters(wavesSent: number): boolean {
  return wavesSent < MAX_HUNTER_WAVES;
}
