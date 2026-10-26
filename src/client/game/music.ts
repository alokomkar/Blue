// The soundtrack — adaptive music made in code, in four layers that follow
// the danger: a filtered pad while exploring, plucks and ticking hats as an
// enemy closes in, bass and snare when something is after you, and a siren
// lead when the alarm is up. Layers only change on bar lines, easing in or
// out over a bar, so it sounds composed rather than switched.
//
// The conductor owns the beat clock, and the heartbeat is its kick: music
// and heart share one tempo (heart.ts eases it between 62 and 150 bpm with
// the threat), so they never fight each other.
//
// Pure helpers first (tested under Node); the Conductor below only runs in
// the browser, with a small synth kit handed to it by audio.ts.

export type MusicMix = { explore: number; tension: number; chase: number; alarm: number };
export type MusicLayer = keyof MusicMix;
export type Stinger = 'document' | 'spotted';

export const STEPS_PER_BAR = 8; // 8th notes; the heart beats on every other one
const TENSION_AT = 0.35; // threat level (heart.ts threatLevel) where the tension layer comes in fully
const TENSION_HINT_AT = 0.2;

/** Target loudness (0–1) of each layer for the current danger. The explore bed is always there. */
export function musicMix(threat: number, chased: boolean, alarm: boolean): MusicMix {
  const tension = chased || threat >= TENSION_AT ? 1 : threat >= TENSION_HINT_AT ? 0.5 : 0;
  return { explore: 1, tension, chase: chased ? 1 : 0, alarm: alarm ? 1 : 0 };
}

/** A minor, Am–F–Dm–Em, two bars per chord. MIDI note numbers, root first. */
export const PROGRESSION: ReadonlyArray<{ name: string; notes: readonly number[] }> = [
  { name: 'Am', notes: [57, 60, 64] },
  { name: 'F', notes: [53, 57, 60] },
  { name: 'Dm', notes: [50, 53, 57] },
  { name: 'Em', notes: [52, 55, 59] },
];

export function chordForBar(bar: number): { name: string; notes: readonly number[] } {
  return PROGRESSION[Math.floor(Math.max(0, bar) / 2) % PROGRESSION.length]!;
}

export function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---- the conductor (browser only) ----

/** What the conductor plays through — built by audio.ts's SoundEngine. */
export type SynthKit = {
  ctx: AudioContext;
  /** The music bus (its own on/off, under the master mute). */
  bus: GainNode;
  tone: (out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, dur: number) => void;
  burst: (out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number) => void;
  /** One lub-dub of the heartbeat at audio time `t`. */
  heart: (t: number, volume: number, period: number) => void;
};

const LOOKAHEAD_S = 0.35; // steps are scheduled this far ahead, so a slow frame never delays one
const LAYERS: MusicLayer[] = ['explore', 'tension', 'chase', 'alarm'];
const BASS_PATTERN = [0, 0, 7, 0, 0, 12, 7, 0]; // semitones above the chord root, per 8th
const SILENT = 0.0001;

export class Conductor {
  private readonly out: Record<MusicLayer, GainNode>;
  private readonly level: Record<MusicLayer, number> = { explore: 1, tension: 0, chase: 0, alarm: 0 };
  private mix: MusicMix = { explore: 1, tension: 0, chase: 0, alarm: 0 };
  private next = 0;
  private step = 0;
  private stopped = false;
  private arp = 0;
  private readonly kit: SynthKit;

  constructor(kit: SynthKit) {
    this.kit = kit;
    const { ctx, bus } = kit;
    const make = (level: number, filter?: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = Math.max(SILENT, level);
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filter;
        g.connect(f).connect(bus);
      } else {
        g.connect(bus);
      }
      return g;
    };
    this.out = { explore: make(1, 1400), tension: make(0), chase: make(0, 2600), alarm: make(0, 3000) };
  }

  /** Call every frame: the tempo (the heart's bpm), the heartbeat's loudness, and the layers wanted now. */
  update(bpm: number, heartVolume: number, mix: MusicMix): void {
    if (this.stopped) return;
    this.mix = mix;
    const now = this.kit.ctx.currentTime;
    const stepS = 60 / bpm / 2;
    if (this.next === 0) this.next = now + 0.05;
    // After a stalled frame, skip the missed steps but stay on the grid.
    while (this.next < now) {
      this.next += stepS;
      this.step++;
    }
    while (this.next < now + LOOKAHEAD_S) {
      this.playStep(this.next, stepS, heartVolume);
      this.next += stepS;
      this.step++;
    }
  }

  /** A short musical flourish over the top, right away. */
  stinger(kind: Stinger): void {
    if (this.stopped) return;
    const { tone, bus, ctx } = this.kit;
    const t = ctx.currentTime + 0.02;
    if (kind === 'document') {
      [69, 73, 76, 81].forEach((m, i) => tone(bus, t + i * 0.09, 'triangle', hz(m), hz(m), 0.09, 0.45));
    } else {
      for (const m of [45, 57, 60]) tone(bus, t, 'sawtooth', hz(m), hz(m) * 0.97, 0.05, 0.35);
    }
  }

  stop(): void {
    this.stopped = true;
    const now = this.kit.ctx.currentTime;
    for (const layer of LAYERS) this.out[layer].gain.setTargetAtTime(SILENT, now, 0.3);
  }

  private playStep(t: number, stepS: number, heartVolume: number): void {
    const s = this.step % STEPS_PER_BAR;
    const bar = Math.floor(this.step / STEPS_PER_BAR);
    if (s % 2 === 0) this.kit.heart(t, heartVolume, stepS * 2);

    // Bar line: ease every layer toward what's wanted now, over one bar.
    if (s === 0) {
      for (const layer of LAYERS) {
        const g = this.out[layer].gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(Math.max(SILENT, this.mix[layer]), t, (stepS * STEPS_PER_BAR) / 3);
        this.level[layer] = Math.max(this.level[layer], this.mix[layer]);
      }
    }
    // A layer keeps playing while it's wanted or still fading out.
    const playing = (layer: MusicLayer): boolean => this.mix[layer] > 0 || this.level[layer] > 0;
    if (s === STEPS_PER_BAR - 1) for (const layer of LAYERS) this.level[layer] = this.mix[layer];

    const chord = chordForBar(bar);
    const barS = stepS * STEPS_PER_BAR;
    if (playing('explore') && s === 0 && bar % 2 === 0) this.pad(t, chord.notes, barS * 2);
    if (playing('tension')) this.tensionStep(t, s, chord.notes);
    if (playing('chase')) this.chaseStep(t, s, bar, chord.notes, stepS);
    if (playing('alarm') && s % 4 === 0) {
      const m = s === 0 ? 76 : 77;
      this.kit.tone(this.out.alarm, t, 'square', hz(m), hz(m) * 1.01, 0.035, stepS * 3.5);
    }
  }

  /** A slow-swelling chord, two detuned triangles per note, held for `dur`. */
  private pad(t: number, notes: readonly number[], dur: number): void {
    const { ctx } = this.kit;
    for (const m of notes) {
      for (const detune of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz(m - 12);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(SILENT, t);
        g.gain.linearRampToValueAtTime(0.018, t + Math.min(1.4, dur * 0.3));
        g.gain.setValueAtTime(0.018, t + dur - 0.2);
        g.gain.exponentialRampToValueAtTime(SILENT, t + dur + 0.9);
        o.connect(g).connect(this.out.explore);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }

  /** Muted plucks walking the chord, with hats ticking on the off-beats. */
  private tensionStep(t: number, s: number, notes: readonly number[]): void {
    const { tone, burst } = this.kit;
    if (Math.random() < 0.8) {
      // A walking arpeggio that sometimes skips or turns back, so it doesn't loop audibly.
      this.arp = (this.arp + (Math.random() < 0.2 ? 2 : 1)) % (notes.length * 2);
      const i = this.arp < notes.length ? this.arp : notes.length * 2 - 1 - this.arp;
      const m = notes[i]! + 12;
      tone(this.out.tension, t, 'triangle', hz(m), hz(m), 0.03, 0.2);
    }
    if (s % 2 === 1) burst(this.out.tension, t, 'highpass', 7000, 0.7, 0.05, 0.03);
  }

  /** Driving 8th-note bass and a backbeat snare, with a fill every 8 bars. */
  private chaseStep(t: number, s: number, bar: number, notes: readonly number[], stepS: number): void {
    const { tone, burst } = this.kit;
    const root = notes[0]! - 24;
    const m = root + BASS_PATTERN[s]!;
    tone(this.out.chase, t, 'sawtooth', hz(m), hz(m) * 0.99, 0.08, stepS * 0.9);
    const fill = bar % 8 === 7 && s >= 4;
    if (s === 2 || s === 6 || fill) {
      burst(this.out.chase, t, 'bandpass', 1800, 0.8, fill ? 0.14 : 0.22, 0.12);
      tone(this.out.chase, t, 'triangle', 200, 150, 0.08, 0.08);
    }
  }
}
