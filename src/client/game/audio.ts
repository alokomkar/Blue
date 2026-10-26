// Sound, all synthesized with Web Audio (oscillators and filtered noise) —
// no audio files, so nothing to license or download. Positional sounds are
// placed in the world relative to the player (the listener) and muffled when
// a wall is in the way, so a patrol's footsteps in the next corridor are
// audible, but dull, before it comes into view.
//
// The AudioContext is created on the first call to `start()`, which game.ts
// makes from the "Begin Mission" click — browsers only allow audio to start
// from a user gesture. Mute is remembered in localStorage.

import { Conductor } from './music';

export type SoundKind =
  | 'step'
  | 'stepRaised'
  | 'botStep'
  | 'shot'
  | 'shotSmg'
  | 'shotBurst'
  | 'shotRail'
  | 'hurt'
  | 'botDown'
  | 'alert'
  | 'lockerOpen'
  | 'document'
  | 'loot'
  | 'rigged'
  | 'key'
  | 'hackDone'
  | 'shutter'
  | 'powerUp'
  | 'doorOpen'
  | 'denied'
  | 'flareThrow'
  | 'caught'
  | 'cleared'
  | 'toast'
  | 'camoOn'
  | 'gogglesOn'
  | 'gogglesOff'
  | 'camoOff'
  | 'beep'
  | 'alarm'
  | 'drag'
  | 'stash'
  | 'ding'
  | 'liftDoors'
  | 'liftRide'
  | 'emp'
  | 'takedown'
  | 'dodge'
  | 'glass'
  | 'bulletIn'
  | 'bulletOut'
  | 'smokePop'
  | 'shockPop'
  | 'skitter'
  | 'crawlerWake'
  | 'boom'
  | 'armour'
  | 'clatter'
  | 'vent'
  | 'bark'
  | 'dogStep'
  | 'dogPing'
  | 'dogAlarm'
  | 'protocolLock'
  | 'protocolPurge'
  | 'protocolCrackle'
  | 'protocolLift'
  | 'wallSink'
  | 'wallRise'
  | 'flashBang'
  | 'protocolShatter'
  | 'protocolReform'
  | 'protocolDone'
  | 'recharge'
  | 'ready'
  | 'dry';

export type Loop = {
  stop: () => void;
  setVolume: (v: number) => void;
  /** Re-checks whether a wall now sits between it and the player. */
  refresh: () => void;
  /** Moves a positioned loop (a drone's rotors). */
  move: (x: number, y: number, z: number) => void;
};


type Pos = { x: number; y: number; z: number };


const MUTE_KEY = 'mazeHeist.muted';
const MUSIC_KEY = 'mazeHeist.music';
const MUSIC_LEVEL = 0.55;
const MUFFLE_HZ = 650;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Music is on unless the player switched it off. */
function readMusicOn(): boolean {
  try {
    return window.localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Glassy notes (Hz) the breaking-up sounds are pitched from: a pentatonic run, so a thousand of them still sound like one thing. */
const SHARDS = [1319, 1568, 1760, 2093, 2349, 2637, 3136, 3520];
/** The scale climbing as the building goes together again. */
const CLIMB = [262, 294, 330, 392, 440, 523, 587, 784];

/**
 * Recorded sounds that stand in for a synthesised one (public/sounds). The
 * synthesised version plays until the file has loaded, and if it can't be.
 */
const SAMPLES: Partial<Record<SoundKind | 'klaxon', string>> = {
  shot: '/sounds/stun-shot.mp3', // the player's and the bots' stun guns
  emp: '/sounds/emp-discharge.mp3',
  klaxon: '/sounds/alarm.m4a', // loops while the alarm is up
  alarm: '/sounds/alarm.m4a', // a rigged locker's fuse running out: the start of the same alarm
  caught: '/sounds/alarm.m4a', // the end of a job, caught: the same alarm again
};
/** One-shots cut short (seconds), fading out at the end — the alarm file is a long loop. */
const SAMPLE_CLIP: Partial<Record<SoundKind, number>> = { alarm: 2.5, caught: 2.5 };
/** Sounds with no synthesised stand-in: if the file hasn't loaded, they're silent rather than crude. */
const SAMPLE_ONLY: ReadonlySet<SoundKind> = new Set<SoundKind>(['caught', 'alarm']);
const SAMPLE_PEAK = 0.5; // every sample is scaled to this peak, so none is much louder than the synthesised sounds
const KLAXON_LEVEL = 0.3; // the looping alarm, as a share of a normalised sample: a backdrop, not a blast
const SAMPLE_GATE = 0.03; // leading audio quieter than this share of the peak is skipped, so a shot sounds the instant it's fired

/** A decoded sample, with its gain and where its sound actually starts. */
type Sample = { buffer: AudioBuffer; gain: number; offset: number };

class SoundEngine {
  private ctx: AudioContext | null = null;
  private readonly samples = new Map<SoundKind | 'klaxon', Sample>();
  private master!: GainNode;
  private slowFilter: BiquadFilterNode | null = null;
  private noise!: AudioBuffer;
  private muted = readMuted();
  private musicBus!: GainNode;
  private musicOn = readMusicOn();
  private occluded: (x: number, z: number) => boolean = () => false;

  /** Creates/resumes the audio context — call from a user gesture. */
  start(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      // Everything goes through a low-pass that closes in bullet time (setSlowmo): the world sounds muffled and far, as if under water.
      this.slowFilter = this.ctx.createBiquadFilter();
      this.slowFilter.type = 'lowpass';
      this.slowFilter.frequency.value = 20000;
      this.slowFilter.connect(comp);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.slowFilter);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? MUSIC_LEVEL : 0;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.loadSamples(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private loadSamples(ctx: AudioContext): void {
    // Each file is fetched and decoded once, however many sounds share it.
    const decoded = new Map<string, Promise<AudioBuffer>>();
    for (const [kind, url] of Object.entries(SAMPLES) as Array<[SoundKind | 'klaxon', string]>) {
      if (!decoded.has(url)) {
        decoded.set(
          url,
          fetch(url)
            .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${url}: ${res.status}`))))
            .then((bytes) => ctx.decodeAudioData(bytes))
        );
      }
      decoded
        .get(url)!
        .then((buffer) => {
          let peak = 0;
          for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
          if (peak === 0) return;
          const first = buffer.getChannelData(0).findIndex((v) => Math.abs(v) >= peak * SAMPLE_GATE);
          this.samples.set(kind, { buffer, gain: SAMPLE_PEAK / peak, offset: Math.max(0, first) / buffer.sampleRate });
        })
        .catch((err) => console.warn('Sound not loaded, using the synthesised one', err));
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** How far bullet time is in (0 to 1): the sound closes down to a dull rumble as it goes. */
  setSlowmo(k: number): void {
    if (!this.ctx || !this.slowFilter) return;
    this.slowFilter.frequency.setTargetAtTime(20000 * Math.pow(650 / 20000, k), this.ctx.currentTime, 0.08);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      window.localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode) — mute still works for this session.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  get isMusicOn(): boolean {
    return this.musicOn;
  }

  /** The soundtrack's own switch (the master mute still silences everything). */
  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    try {
      window.localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode) — the switch still works for this session.
    }
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.2);
    return this.musicOn;
  }

  /** Decides whether a sound at (x, z) is behind a wall from the player (game.ts supplies a wall check). */
  setOcclusion(fn: (x: number, z: number) => boolean): void {
    this.occluded = fn;
  }

  /** Puts the listener at the player's head, facing where the player faces (0 = +Z). */
  setListener(x: number, y: number, z: number, facing: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y + 1.4;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(x, y + 1.4, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Output chain for one sound: a gain, then (if positioned) a wall muffle and a panner, into the master bus. */
  /** A pitched tone that swells in over `attack` seconds, then fades by `dur`: a riser or a pad, rather than a struck note. */
  private swell(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Noise through a band that sweeps from `f0` to `f1`, swelling in over `attack` seconds and fading by `dur`: wind, or a pull. */
  private sweep(out: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, dur: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** Calls `fn(time, k)` for a cloud of grains over `dur` seconds, thickening from `from` to `to` a second; `k` is how far through (0 to 1). */
  private grains(t: number, dur: number, from: number, to: number, fn: (time: number, k: number) => void): void {
    let at = 0;
    while (at < dur) {
      const k = at / dur;
      fn(t + at, k);
      at += (1 / (from + (to - from) * k)) * (0.6 + Math.random() * 0.8);
    }
  }

  private chain(at: Pos | undefined, volume: number): { input: GainNode; muffle: BiquadFilterNode | null; panner: PannerNode | null } {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    input.gain.value = volume;
    if (!at) {
      input.connect(this.master);
      return { input, muffle: null, panner: null };
    }
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    const behindWall = this.occluded(at.x, at.z);
    muffle.frequency.value = behindWall ? MUFFLE_HZ : 18000;
    if (behindWall) input.gain.value = volume * 0.55;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.rolloffFactor = 1.3;
    panner.maxDistance = 40;
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
    } else {
      panner.setPosition(at.x, at.y, at.z);
    }
    input.connect(muffle).connect(panner).connect(this.master);
    return { input, muffle, panner };
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** A burst of filtered noise with a fast attack and an exponential decay. */
  private burst(out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, offset = Math.random()): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, offset * 1.5);
    src.stop(t + decay + 0.05);
  }

  /** A tone gliding from f0 to f1, with an exponential decay. */
  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(kind: SoundKind, at?: Pos, volume = 1): void {
    if (!this.ctx || this.muted) return;
    const { input } = this.chain(at, volume);
    const t = this.ctx.currentTime + 0.005;
    const sample = this.samples.get(kind);
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample.buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = sample.gain;
      src.connect(gain).connect(input);
      const clip = SAMPLE_CLIP[kind];
      if (clip) {
        gain.gain.setValueAtTime(sample.gain, t + clip - 0.4);
        gain.gain.linearRampToValueAtTime(0.0001, t + clip);
        src.start(t, sample.offset, clip);
      } else {
        src.start(t, sample.offset);
      }
      return;
    }
    if (SAMPLE_ONLY.has(kind)) return;
    switch (kind) {
      case 'step':
        this.tone(input, t, 'sine', 120, 60, 0.18, 0.08);
        this.burst(input, t, 'lowpass', 700, 0.7, 1.1, 0.09);
        break;
      case 'stepRaised':
        this.tone(input, t, 'sine', 150, 80, 0.14, 0.07);
        this.burst(input, t, 'lowpass', 1100, 0.8, 0.9, 0.07);
        this.burst(input, t + 0.01, 'bandpass', 2200, 6, 0.5, 0.05);
        break;
      case 'botStep':
        this.tone(input, t, 'sine', 90, 45, 0.5, 0.12);
        this.burst(input, t, 'lowpass', 380, 0.8, 0.35, 0.11);
        this.tone(input, t + 0.02, 'triangle', 2400, 2300, 0.05, 0.05);
        break;
      case 'shot': // the player's and the bots' guns sound the same
        this.tone(input, t, 'square', 980, 120, 0.22, 0.14);
        this.burst(input, t, 'highpass', 1800, 0.7, 0.35, 0.1);
        break;
      case 'shotSmg': // three quick dry clicks of a dart gun
        for (let i = 0; i < 3; i++) {
          this.tone(input, t + i * 0.045, 'square', 1500, 420, 0.1, 0.06);
          this.burst(input, t + i * 0.045, 'highpass', 3200, 0.7, 0.2, 0.04);
        }
        break;
      case 'shotBurst': // three punchy thumps, heavier than the pistol's
        for (let i = 0; i < 3; i++) {
          this.tone(input, t + i * 0.07, 'sawtooth', 620, 85, 0.16, 0.12);
          this.burst(input, t + i * 0.07, 'bandpass', 1400, 0.8, 0.3, 0.09);
        }
        break;
      case 'shotRail': // a rising whine, then a crack and a low boom
        this.tone(input, t, 'sine', 400, 3600, 0.12, 0.18);
        this.burst(input, t + 0.17, 'highpass', 2200, 0.7, 0.55, 0.3);
        this.tone(input, t + 0.17, 'sine', 90, 35, 0.4, 0.5);
        this.tone(input, t + 0.17, 'sawtooth', 2200, 140, 0.14, 0.4);
        break;
      case 'hurt':
        this.tone(input, t, 'sine', 140, 45, 0.6, 0.28);
        this.burst(input, t, 'lowpass', 900, 0.8, 0.3, 0.15);
        break;
      case 'botDown':
        this.burst(input, t, 'lowpass', 420, 0.9, 0.5, 0.25);
        this.tone(input, t, 'sine', 70, 40, 0.4, 0.3);
        this.burst(input, t + 0.05, 'bandpass', 2600, 5, 0.12, 0.2);
        break;
      case 'alert':
        this.tone(input, t, 'square', 880, 880, 0.14, 0.08);
        this.tone(input, t + 0.1, 'square', 1320, 1320, 0.14, 0.12);
        break;
      case 'lockerOpen': {
        // Hinge creak: a buzzy tone through a sweeping resonant filter, then a clank.
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(150, t);
        o.frequency.linearRampToValueAtTime(190, t + 0.45);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 9;
        f.frequency.setValueAtTime(600, t);
        f.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(f).connect(g).connect(input);
        o.start(t);
        o.stop(t + 0.55);
        this.burst(input, t + 0.5, 'bandpass', 1200, 3, 0.35, 0.18);
        this.tone(input, t + 0.5, 'triangle', 620, 600, 0.08, 0.25);
        break;
      }
      case 'document':
        this.tone(input, t, 'sine', 660, 660, 0.18, 0.18);
        this.tone(input, t + 0.09, 'sine', 990, 990, 0.18, 0.22);
        this.tone(input, t + 0.18, 'sine', 1320, 1320, 0.2, 0.4);
        break;
      case 'loot':
        this.tone(input, t, 'triangle', 1567, 1567, 0.16, 0.15);
        this.tone(input, t + 0.08, 'triangle', 2093, 2093, 0.16, 0.3);
        break;
      case 'rigged':
        for (let i = 0; i < 4; i++) this.tone(input, t + i * 0.13, 'square', 1040, 1040, 0.16, 0.08);
        break;
      case 'key':
        this.burst(input, t, 'highpass', 2600 + Math.random() * 1500, 0.8, 0.45, 0.03);
        break;
      case 'shutter': // the PDA's camera: a click, the curtain, a second click
        this.burst(input, t, 'highpass', 3200, 0.9, 0.5, 0.025);
        this.burst(input, t + 0.02, 'bandpass', 1800, 2, 0.25, 0.07);
        this.burst(input, t + 0.1, 'highpass', 2800, 0.9, 0.4, 0.03);
        break;
      case 'hackDone':
        this.tone(input, t, 'sine', 400, 1200, 0.16, 0.25);
        this.tone(input, t + 0.22, 'sine', 1320, 1320, 0.18, 0.35);
        break;
      case 'powerUp': {
        // Generator spinning up: a low sawtooth rising in pitch as a filter opens.
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(45, t);
        o.frequency.exponentialRampToValueAtTime(140, t + 1.2);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(150, t);
        f.frequency.exponentialRampToValueAtTime(1800, t + 1.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(f).connect(g).connect(input);
        o.start(t);
        o.stop(t + 1.6);
        this.tone(input, t + 1.1, 'sine', 880, 880, 0.12, 0.3);
        break;
      }
      case 'doorOpen':
        this.burst(input, t, 'bandpass', 1400, 0.6, 0.25, 1.0);
        this.tone(input, t, 'sine', 70, 55, 0.25, 0.9);
        this.burst(input, t + 1.0, 'lowpass', 500, 1, 0.45, 0.2);
        break;
      case 'denied':
        this.tone(input, t, 'square', 180, 170, 0.2, 0.12);
        this.tone(input, t + 0.14, 'square', 150, 140, 0.2, 0.2);
        break;
      case 'flareThrow':
        this.burst(input, t, 'bandpass', 900, 1.2, 0.7, 0.35);
        this.tone(input, t, 'sine', 300, 900, 0.05, 0.3);
        break;
      case 'cleared':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(input, t + i * 0.11, 'triangle', f, f, 0.18, i === 3 ? 0.6 : 0.2));
        break;
      case 'toast':
        this.tone(input, t, 'sine', 1200, 1200, 0.05, 0.06);
        break;
      case 'camoOn': // a rising shimmer as the cloak folds around you
        this.tone(input, t, 'sine', 320, 1400, 0.12, 0.35);
        this.tone(input, t + 0.04, 'sine', 480, 2100, 0.06, 0.32);
        this.burst(input, t, 'bandpass', 3000, 3, 0.35, 0.3);
        break;
      case 'gogglesOn': // a click, then the tube's thin rising whine as it charges
        this.burst(input, t, 'highpass', 4000, 1, 0.03, 0.25);
        this.tone(input, t + 0.03, 'sine', 2400, 9000, 0.035, 0.6);
        break;
      case 'gogglesOff':
        this.burst(input, t, 'highpass', 4000, 1, 0.03, 0.2);
        this.tone(input, t + 0.02, 'sine', 6000, 1800, 0.025, 0.2);
        break;
      case 'camoOff':
        this.tone(input, t, 'sine', 1300, 300, 0.1, 0.3);
        this.burst(input, t, 'bandpass', 2200, 3, 0.25, 0.22);
        break;
      case 'beep': // a rigged locker's fuse ticking down
        this.tone(input, t, 'square', 1500, 1500, 0.1, 0.07);
        break;
      case 'drag': // hauling a body off the floor
        this.tone(input, t, 'sine', 110, 55, 0.35, 0.16);
        this.burst(input, t + 0.03, 'lowpass', 600, 0.8, 0.5, 0.3);
        break;
      case 'ding': // the lift arriving
        this.tone(input, t, 'sine', 1319, 1319, 0.16, 0.9);
        this.tone(input, t + 0.28, 'sine', 1047, 1047, 0.16, 1.1);
        break;
      case 'liftDoors': // steel doors sliding on their track
        this.burst(input, t, 'bandpass', 700, 0.9, 0.3, 0.8);
        this.tone(input, t, 'sine', 180, 150, 0.08, 0.8);
        break;
      case 'liftRide': { // the cab winding up to speed
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(55, t);
        o.frequency.exponentialRampToValueAtTime(110, t + 1.4);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(f).connect(g).connect(input);
        o.start(t);
        o.stop(t + 1.9);
        break;
      }
      case 'emp': // a charged pulse: a rising whine, then a crackling discharge
        this.tone(input, t, 'sawtooth', 300, 2600, 0.12, 0.18);
        this.burst(input, t + 0.16, 'highpass', 2500, 0.7, 0.6, 0.45);
        this.tone(input, t + 0.16, 'square', 90, 40, 0.3, 0.4);
        break;
      case 'takedown': // a muffled tackle: body impact, a grunt, a thump to the floor
        this.tone(input, t, 'sine', 120, 50, 0.5, 0.18);
        this.burst(input, t, 'lowpass', 500, 0.8, 0.7, 0.12);
        this.tone(input, t + 0.06, 'sawtooth', 190, 120, 0.06, 0.14);
        this.burst(input, t + 0.32, 'lowpass', 300, 0.8, 0.5, 0.2);
        break;
      case 'dodge': // a quick sidestep: cloth and air
        this.burst(input, t, 'bandpass', 1400, 1.2, 0.45, 0.18);
        this.tone(input, t, 'sine', 500, 180, 0.05, 0.16);
        break;
      case 'glass': // a ceiling light shattering and popping out
        this.burst(input, t, 'highpass', 5000, 0.8, 0.5, 0.35);
        this.tone(input, t, 'sine', 2600, 900, 0.05, 0.12);
        this.burst(input, t + 0.05, 'bandpass', 3500, 3, 0.3, 0.25);
        break;
      case 'clatter': // a bin or boxes knocked over
        for (let i = 0; i < 4; i++) this.burst(input, t + i * 0.07 + Math.random() * 0.03, 'bandpass', 900 + i * 400, 2, 0.45 - i * 0.07, 0.12);
        this.tone(input, t, 'sine', 160, 70, 0.25, 0.2);
        break;
      case 'vent': // crawling through a duct
        for (let i = 0; i < 5; i++) this.burst(input, t + i * 0.2, 'bandpass', 700, 1.5, 0.25, 0.16);
        this.tone(input, t + 0.1, 'sine', 90, 70, 0.08, 0.9);
        break;
      case 'skitter': // a crawler's legs ticking on the floor
        this.burst(input, t, 'highpass', 5200, 1, 0.18, 0.02);
        break;
      case 'crawlerWake': // a mine arming: a fast rising beep
        for (let i = 0; i < 3; i++) this.tone(input, t + i * 0.08, 'square', 900 + i * 350, 900 + i * 350, 0.08, 0.06);
        break;
      case 'boom': // a crawler mine going off
        this.tone(input, t, 'sine', 90, 30, 0.9, 0.7);
        this.burst(input, t, 'lowpass', 900, 0.6, 1, 0.8);
        this.burst(input, t + 0.02, 'bandpass', 2500, 0.8, 0.4, 0.3);
        break;
      case 'armour': // a stun sparking off a heavy's armour
        this.tone(input, t, 'triangle', 1400, 1100, 0.15, 0.25);
        this.burst(input, t, 'bandpass', 3000, 4, 0.3, 0.15);
        break;
      case 'dogPing': // a watchdog somewhere near: one soft sonar blip (the player's warning, not the dog's own sound)
        this.tone(input, t, 'sine', 880, 880, 0.09, 0.1);
        this.tone(input, t + 0.09, 'sine', 1180, 1180, 0.07, 0.12);
        break;
      case 'dogAlarm': // a watchdog on your trail: a harsh two-tone beep over a low growl
        this.tone(input, t, 'square', 1500, 1500, 0.09, 0.07);
        this.tone(input, t + 0.075, 'square', 1950, 1950, 0.09, 0.08);
        this.tone(input, t, 'sawtooth', 95, 62, 0.14, 0.22);
        this.burst(input, t, 'lowpass', 420, 0.8, 0.18, 0.2);
        break;
      case 'bark': // a watchdog locking on: two clipped electronic barks
        for (let i = 0; i < 2; i++) {
          this.tone(input, t + i * 0.17, 'square', 420, 180, 0.22, 0.12);
          this.burst(input, t + i * 0.17, 'bandpass', 900, 2, 0.3, 0.09);
        }
        break;
      case 'recharge': // the gun taking in its charge: a rising whine with ticks, as long as the wait (FIRE_COOLDOWN_S)
        this.tone(input, t, 'sawtooth', 240, 1500, 0.045, 1.35);
        this.tone(input, t + 0.05, 'triangle', 480, 3000, 0.025, 1.3);
        for (let i = 0; i < 7; i++) this.burst(input, t + 0.15 + i * 0.17, 'highpass', 4200, 1, 0.07, 0.02);
        break;
      case 'ready': // charged: two bright notes, up
        this.tone(input, t, 'sine', 1318, 1318, 0.16, 0.22);
        this.tone(input, t + 0.09, 'sine', 1760, 1760, 0.14, 0.4);
        break;
      case 'dry': // the trigger pulled with nothing in the gun: a dull click
        this.burst(input, t, 'highpass', 2800, 1, 0.28, 0.03);
        this.tone(input, t, 'square', 220, 110, 0.08, 0.05);
        break;
      case 'bulletIn': // time slowing: a deep downward sweep, a heartbeat thump, and the air rushing out
        this.tone(input, t, 'sine', 220, 38, 0.55, 0.9);
        this.tone(input, t + 0.02, 'sine', 60, 40, 0.8, 0.28);
        this.burst(input, t, 'lowpass', 1800, 0.7, 0.5, 0.8);
        this.tone(input, t + 0.3, 'sine', 55, 45, 0.5, 0.22);
        break;
      case 'bulletOut': // time catching up: a rising sweep and a rush
        this.tone(input, t, 'sine', 70, 520, 0.2, 0.5);
        this.burst(input, t, 'bandpass', 1200, 0.6, 0.4, 0.5);
        break;
      case 'smokePop': // a canister popping: a soft thump and a long hiss
        this.tone(input, t, 'sine', 120, 55, 0.5, 0.25);
        this.burst(input, t + 0.02, 'bandpass', 2600, 0.5, 0.45, 1.6);
        break;
      case 'shockPop': // a shock grenade: a hard crack, a buzzing discharge, a high zing
        this.burst(input, t, 'highpass', 2600, 0.7, 0.8, 0.12);
        this.tone(input, t, 'sine', 110, 40, 0.6, 0.35);
        this.tone(input, t + 0.05, 'sawtooth', 2400, 600, 0.12, 0.5);
        this.burst(input, t + 0.05, 'bandpass', 3800, 1.2, 0.35, 0.6);
        break;
      case 'flashBang': // a stun grenade: a flat crack and a thud, a flood of hiss, and a high ringing that hangs
        this.burst(input, t, 'highpass', 2400, 0.7, 0.9, 0.14);
        this.burst(input, t, 'lowpass', 700, 0.8, 0.9, 0.3);
        this.tone(input, t, 'sine', 95, 34, 0.8, 0.55);
        this.burst(input, t + 0.06, 'bandpass', 3200, 0.6, 0.3, 1.3);
        this.tone(input, t + 0.05, 'sine', 4300, 4150, 0.05, 2.4);
        this.tone(input, t + 0.05, 'sine', 5700, 5500, 0.025, 1.9);
        break;
      case 'protocolLock': // the building locking down: a falling alarm, the power going out of it, then the bolts
        this.tone(input, t, 'sawtooth', 920, 240, 0.12, 0.9);
        this.tone(input, t + 0.05, 'square', 460, 120, 0.07, 0.9);
        this.swell(input, t, 'sine', 170, 30, 0.35, 0.05, 1.5);
        this.sweep(input, t, 'lowpass', 5000, 160, 0.8, 0.22, 0.05, 1.3);
        for (let i = 0; i < 3; i++) {
          this.tone(input, t + 0.7 + i * 0.16, 'sine', 80, 38, 0.5, 0.25);
          this.burst(input, t + 0.7 + i * 0.16, 'lowpass', 600, 0.8, 0.5, 0.18);
        }
        break;
      case 'protocolPurge': {
        // The contents coming apart into cubes, as the wave runs out from the agent (PURGE_S): a sub swelling under it, a wind of
        // breaking data rising, the wave's pulse beating faster as it widens, and a cloud of digital blips and ticks that thickens.
        const D = 4.6;
        this.swell(input, t, 'sine', 38, 100, 0.5, 3.4, D);
        this.swell(input, t, 'sawtooth', 70, 900, 0.035, 3.6, D);
        this.sweep(input, t, 'bandpass', 300, 7000, 1.4, 0.32, 3.2, D);
        let pulseAt = 0;
        let gap = 0.55;
        while (pulseAt < D - 0.5) {
          this.tone(input, t + pulseAt, 'sine', 72, 34, 0.4, 0.34);
          this.burst(input, t + pulseAt, 'lowpass', 240, 0.8, 0.3, 0.2);
          pulseAt += gap;
          gap = Math.max(0.2, gap * 0.86);
        }
        this.grains(t + 0.15, D - 0.5, 5, 46, (time, k) => {
          const f = 500 + Math.random() * 2600;
          this.tone(input, time, 'square', f, f * 0.8, 0.018 + 0.02 * k, 0.025 + Math.random() * 0.03);
          if (Math.random() < 0.7) this.burst(input, time, 'highpass', 4200 + Math.random() * 3500, 0.9, 0.1 + 0.1 * k, 0.03);
        });
        break;
      }
      case 'protocolShatter': {
        // The floor and the walls breaking into glass (SHATTER_S, then the shards hang): a crack, a low whoomp, a bright wind going out
        // with the wave, and a cloud of glassy tinkles with a ringing second partial, thick at first and thinning as they hang.
        const D = 4.4;
        this.burst(input, t, 'highpass', 5200, 0.8, 0.5, 0.16);
        this.burst(input, t + 0.03, 'bandpass', 2400, 1.5, 0.4, 0.3);
        this.swell(input, t, 'sine', 120, 38, 0.5, 0.04, 1.4);
        this.sweep(input, t, 'bandpass', 2000, 9000, 1.2, 0.22, 1.4, 3.2);
        this.grains(t + 0.05, D - 0.4, 52, 8, (time, k) => {
          const f = SHARDS[Math.floor(Math.random() * SHARDS.length)]! * (1 + Math.random() * 0.02);
          const ring = 0.16 + Math.random() * 0.4;
          this.tone(input, time, 'sine', f, f * 0.97, 0.05 * (1.2 - k), ring);
          this.tone(input, time, 'sine', f * 2.76, f * 2.7, 0.022 * (1.2 - k), ring * 0.6);
          if (Math.random() < 0.6) this.burst(input, time, 'highpass', 5000 + Math.random() * 3500, 0.9, 0.16 * (1.1 - k), 0.025);
        });
        break;
      }
      case 'protocolCrackle': // a handful of things breaking up into cubes: a crunch, ticks and a few shards
        this.burst(input, t, 'bandpass', 800 + Math.random() * 700, 1.2, 0.2, 0.09);
        for (let i = 0; i < 7; i++) this.burst(input, t + i * 0.03 + Math.random() * 0.03, 'highpass', 2600 + Math.random() * 4200, 0.9, 0.22, 0.04);
        for (let i = 0; i < 2; i++) {
          const f = SHARDS[Math.floor(Math.random() * SHARDS.length)]!;
          this.tone(input, t + i * 0.05, 'sine', f, f * 0.55, 0.05, 0.16);
        }
        break;
      case 'protocolLift': // being carried off the floor: a long airy rise, a low hum and a pad over it
        this.burst(input, t, 'bandpass', 500, 0.8, 0.4, 1.5);
        this.tone(input, t, 'sine', 55, 110, 0.12, 4);
        this.tone(input, t + 0.2, 'triangle', 220, 440, 0.04, 3.5);
        this.swell(input, t + 0.1, 'sine', 330, 392, 0.05, 1.6, 4.4);
        this.swell(input, t + 0.1, 'sine', 494, 587, 0.03, 1.8, 4.4);
        break;
      case 'protocolReform': {
        // The building being laid again, as the first walls come back up (about REFORM_SPREAD_S of it): the wind drawn back in, a
        // sub building under it, snaps coming faster and brighter, and a scale climbing as it goes together.
        const D = 4.6;
        this.sweep(input, t, 'bandpass', 6500, 260, 1.2, 0.3, 2.8, D);
        this.swell(input, t, 'sine', 36, 78, 0.4, 3.6, D);
        this.grains(t, D - 0.4, 3, 38, (time, k) => {
          const f = 500 + 3200 * k;
          this.tone(input, time, 'square', f, f * 1.25, 0.022, 0.03);
          this.burst(input, time, 'bandpass', 1800 + 2600 * k, 3, 0.12, 0.025);
        });
        CLIMB.forEach((f, i) => this.tone(input, t + 0.5 + i * 0.5, 'sine', f, f, 0.07, 0.9));
        break;
      }
      case 'wallSink': // a wall grinding down into the floor
        this.tone(input, t, 'sine', 70, 38, 0.5, 0.9);
        this.burst(input, t, 'lowpass', 260, 0.9, 0.5, 1.1);
        this.burst(input, t + 0.2, 'bandpass', 700, 2, 0.5, 0.18);
        break;
      case 'wallRise': // a wall coming up and seating: a grind and a clunk
        this.burst(input, t, 'lowpass', 300, 0.9, 0.35, 0.9);
        this.tone(input, t, 'sine', 45, 80, 0.3, 0.8);
        this.tone(input, t + 0.85, 'sine', 110, 55, 0.3, 0.3);
        this.burst(input, t + 0.85, 'bandpass', 1400, 3, 0.2, 0.25);
        break;
      case 'protocolDone': // the rebuild complete: a chord settling in over a deep note, and a bright note on top
        this.swell(input, t, 'sine', 98, 98, 0.22, 0.12, 2.6);
        for (const f of [392, 494, 587, 784]) this.swell(input, t, 'sine', f, f, 0.07, 0.3, 2.8);
        this.tone(input, t + 0.35, 'sine', 1568, 1568, 0.05, 1.8);
        this.burst(input, t, 'lowpass', 300, 0.8, 0.25, 0.4);
        break;
      case 'dogStep': // light metal feet ticking on the floor
        this.burst(input, t, 'bandpass', 3400, 5, 0.35, 0.03);
        this.tone(input, t, 'sine', 240, 180, 0.06, 0.04);
        break;
      case 'stash': // putting a body down
        this.tone(input, t, 'sine', 95, 40, 0.5, 0.2);
        this.burst(input, t, 'lowpass', 400, 0.8, 0.8, 0.14);
        this.burst(input, t + 0.12, 'bandpass', 1800, 1.5, 0.25, 0.2);
        break;
    }
  }

  /**
   * The soundtrack and heartbeat for one job (music.ts): call its update()
   * every frame with the heart's pace and the layers wanted. Before audio
   * has started it does nothing.
   */
  score(): Pick<Conductor, 'update' | 'stinger' | 'stop'> {
    const ctx = this.ctx;
    if (!ctx) return { update: () => {}, stinger: () => {}, stop: () => {} };
    return new Conductor({
      ctx,
      bus: this.musicBus,
      tone: (out, t, type, f0, f1, peak, dur) => {
        if (!this.muted) this.tone(out, t, type, f0, f1, peak, dur);
      },
      burst: (out, t, type, freq, q, peak, decay) => {
        if (!this.muted) this.burst(out, t, type, freq, q, peak, decay);
      },
      heart: (t, volume, period) => {
        if (!this.muted) this.beat(t, volume, period);
      },
    });
  }

  /**
   * One "lub-dub". The low thump carries on headphones; the higher body and
   * the soft click are what a phone speaker (little below ~150 Hz) can play.
   */
  private beat(t: number, volume: number, period: number): void {
    const { input } = this.chain(undefined, volume);
    const dub = t + Math.min(0.22, period * 0.32);
    this.tone(input, t, 'sine', 85, 48, 0.3, 0.16);
    this.tone(input, t, 'triangle', 170, 100, 0.06, 0.09);
    this.burst(input, t, 'lowpass', 260, 0.7, 0.2, 0.06);
    this.tone(input, dub, 'sine', 95, 55, 0.22, 0.13);
    this.tone(input, dub, 'triangle', 190, 115, 0.04, 0.07);
  }

  /** A continuous sound; `stop()` fades it out. `at` places it in the world. */
  loop(kind: 'ambience' | 'ambienceData' | 'laser' | 'flare' | 'klaxon' | 'rotor' | 'pulse', at?: Pos, volume = 1, seconds?: number): Loop {
    const none: Loop = { stop: () => {}, setVolume: () => {}, refresh: () => {}, move: () => {} };
    if (!this.ctx) return none;
    const ctx = this.ctx;
    const { input, muffle, panner } = this.chain(at, volume);
    const where = at ? { ...at } : undefined;
    const t = ctx.currentTime;
    const sources: AudioScheduledSourceNode[] = [];
    const add = (s: AudioScheduledSourceNode): void => {
      s.start(t);
      sources.push(s);
    };
    const drone = (freq: number, gain: number, type: OscillatorType = 'sine'): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(input);
      add(o);
    };
    const hiss = (type: BiquadFilterType, freq: number, gain: number, flicker = 0): void => {
      const n = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      if (flicker) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = flicker;
        const depth = ctx.createGain();
        depth.gain.value = gain * 0.8;
        lfo.connect(depth).connect(g.gain);
        add(lfo);
      }
      n.connect(f).connect(g).connect(input);
      add(n);
    };
    if (kind === 'ambience') {
      drone(55, 0.05);
      drone(55.7, 0.05);
      hiss('lowpass', 320, 0.025);
    } else if (kind === 'ambienceData') {
      drone(60, 0.045);
      drone(120, 0.02);
      hiss('bandpass', 900, 0.03, 0.3);
    } else if (kind === 'pulse') {
      // An electric pulse running a pipe: a crackling, spitting hiss over a mains buzz.
      hiss('bandpass', 3400, 0.09, 37);
      hiss('highpass', 6000, 0.04, 11);
      drone(100, 0.025, 'sawtooth');
    } else if (kind === 'rotor') {
      // A drone: a buzzing sawtooth pair with a fast wobble, and air rushing under it.
      drone(118, 0.035, 'sawtooth');
      drone(121.5, 0.03, 'sawtooth');
      hiss('bandpass', 1800, 0.05, 23);
    } else if (kind === 'klaxon' && this.samples.has('klaxon')) {
      // The recorded alarm, looping — kept well under the effects.
      const sample = this.samples.get('klaxon')!;
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.loop = true;
      src.loopStart = sample.offset;
      src.loopEnd = sample.buffer.duration;
      const g = ctx.createGain();
      g.gain.value = sample.gain * KLAXON_LEVEL;
      src.connect(g).connect(input);
      add(src);
    } else if (kind === 'klaxon') {
      // The alarm is the recorded file only: until it has loaded, it's silent rather than crude.
    } else if (kind === 'laser') {
      drone(110, 0.05, 'sawtooth');
      drone(220.8, 0.03);
    } else {
      hiss('bandpass', 2800, 0.12, 13);
      hiss('lowpass', 500, 0.08);
    }
    input.gain.setValueAtTime(0.0001, t);
    input.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + 0.4);
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      input.gain.cancelScheduledValues(now);
      input.gain.setTargetAtTime(0.0001, now, 0.15);
      for (const s of sources) s.stop(now + 0.8);
    };
    if (seconds !== undefined) window.setTimeout(stop, seconds * 1000);
    return {
      stop,
      setVolume: (v: number) => {
        if (!stopped) input.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.2);
      },
      refresh: () => {
        if (!stopped && where && muffle) muffle.frequency.setTargetAtTime(this.occluded(where.x, where.z) ? MUFFLE_HZ : 18000, ctx.currentTime, 0.1);
      },
      move: (x: number, y: number, z: number) => {
        if (stopped || !panner || !where) return;
        where.x = x;
        where.y = y;
        where.z = z;
        if (panner.positionX) {
          panner.positionX.value = x;
          panner.positionY.value = y;
          panner.positionZ.value = z;
        } else {
          panner.setPosition(x, y, z);
        }
      },
    };
  }
}

export const sound = new SoundEngine();
