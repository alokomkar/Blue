// The staged alert (docs/ideas/staged-alert.md): the rung the building is on, shown to the player, and the search that Evasion is. Quiet, Caution (suspicion has started to climb), Alert (the alarm is up) and
// Evasion (the alarm is up, but nothing has had the agent in sight for a few seconds). The alarm itself is still alarm.ts's, unchanged; this is the name for where things stand, and the
// seed of the search that Evasion will become. Pure, and tested under Node.

export type Phase = 'quiet' | 'caution' | 'alert' | 'evasion';

/** Suspicion at which Caution starts, and the lower mark it falls back under (so it does not flicker). */
export const CAUTION_ON = 35;
export const CAUTION_OFF = 20;
/** With the alarm up, this many seconds with nothing after the agent is Evasion. */
export const EVASION_AFTER_S = 3;

/** How long the search lasts, with the agent still unseen: then the alarm is called off (they have stood down). */
export const EVASION_S = 40;
/** While searching, the guards are given a new place to sweep this often (seconds), within SWEEP_CELLS of where the agent was last seen. */
export const SWEEP_EVERY_S = 6;
export const SWEEP_CELLS = 3;
/** Suspicion eases off by this much a second while nothing is after the agent and the alarm is down: Caution times out. */
export const CAUTION_DECAY_PER_S = 0.4;
export const QUIET_DECAY_PER_S = 0.2;

export type AlertState = {
  phase: Phase;
  /** Seconds the alarm has been up with nothing after the agent. */
  unseenFor: number;
  /** Seconds spent searching (Evasion). */
  evasionFor: number;
};

export const QUIET: AlertState = { phase: 'quiet', unseenFor: 0, evasionFor: 0 };

/** The rung a frame later. `alarm`: the alarm is up (alarm.ts); `hunted`: something is after the agent right now. */
export function stepAlert(s: AlertState, input: { alarm: boolean; suspicion: number; hunted: boolean }, dt: number): AlertState {
  if (input.alarm) {
    const unseenFor = input.hunted ? 0 : s.unseenFor + dt;
    const phase = unseenFor >= EVASION_AFTER_S ? 'evasion' : 'alert';
    return { phase, unseenFor, evasionFor: phase === 'evasion' ? s.evasionFor + dt : 0 };
  }
  const caution = input.suspicion >= CAUTION_ON || (s.phase === 'caution' && input.suspicion >= CAUTION_OFF);
  return { phase: caution ? 'caution' : 'quiet', unseenFor: 0, evasionFor: 0 };
}

/** Whether the search has gone on long enough that they stand down. */
export function standsDown(s: AlertState): boolean {
  return s.phase === 'evasion' && s.evasionFor >= EVASION_S;
}

/** The suspicion a frame later while nothing is after the agent and the alarm is down: it eases off, Caution faster than Quiet. */
export function decayedSuspicion(suspicion: number, phase: Phase, hunted: boolean, dt: number): number {
  if (hunted || phase === 'alert' || phase === 'evasion') return suspicion;
  return Math.max(0, suspicion - (phase === 'caution' ? CAUTION_DECAY_PER_S : QUIET_DECAY_PER_S) * dt);
}

/** What the chip says. */
export const PHASE_LABEL: Record<Phase, string> = { quiet: 'Quiet', caution: 'Caution', alert: 'Alert', evasion: 'Evasion' };
