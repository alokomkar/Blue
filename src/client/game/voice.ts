// Talking to the AI partner (docs/DESIGN.md section 4): hold the talk key (V; the controls sheet moves it) or the mic button, say an order, let go. The clip (at most 6 s, mono 16-bit WAV at 24 kHz,
// wavencode.ts) goes to POST /api/ai/transcribe, which answers the words and the one order they mean; the words show at once and the partner's reply under them, and the order is handed to game.ts to carry out.
//
// Privacy: the microphone is asked for on the first press only, and it is open ONLY while the key (or button) is held: the tracks are stopped the moment it is let go, when the window loses focus, when the job ends,
// and the clip is sent nowhere else. The first time, the screen says the clip goes to Meta's model. If the mic is refused or the call fails, the HUD says so and the game carries on.
//
// On localhost, `window.__order("cover me")` runs the same path from typed words (the fast path, then POST /api/ai/order), for testing without a microphone.

import { CLIP_MAX_S, CLIP_MIN_S, encodeClip, peak } from './wavencode';
import { matchOrder, readVoiceReply, voiceErrorText, type PartnerOrder, type VoiceReply } from '../../shared/orders';
import { hideVoice, setMicLive, setVoiceLevel, showMic, showVoice, wireMic } from './voicehud';

const NOTICE_KEY = 'mazeHeist.voiceNotice';
const CALL_TIMEOUT_MS = 15000;

export type VoiceHooks = {
  signal: AbortSignal;
  /** The talk key's KeyboardEvent.code (the player's own binding). */
  getKey: () => string;
  /** The talk key as the player reads it. */
  keyLabel: () => string;
  /** "AGENT B": who answers. */
  partnerName: string;
  /** Whether there is a partner to talk to right now. */
  hasPartner: () => boolean;
  /** Whether talking is allowed right now (not caught, cleared, or paused behind a menu). */
  canTalk: () => boolean;
  /** Carries the order out. Returns the partner's answer when it is not the order's own line (a shot it could not take: ok false), else null. */
  apply: (order: PartnerOrder) => { say: string; ok: boolean } | null;
  /** Called with each finished exchange (for the debug hook and for tests). */
  onExchange?: (e: Exchange) => void;
};

export type Exchange = { transcript: string; order: PartnerOrder; source: VoiceReply['source']; said: string; msTotal: number; ms: VoiceReply['ms'] };

export type VoiceControl = {
  /** Runs the typed words the way a spoken clip would be (the localhost test hook). */
  order: (text: string) => Promise<Exchange | null>;
  state: () => 'idle' | 'arming' | 'listening' | 'sending';
};

/** The tap that hands the microphone's samples over from the audio thread, 2048 at a time. */
const WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.buf.push(new Float32Array(ch)); this.n += ch.length;
      if (this.n >= 2048) {
        const out = new Float32Array(this.n); let at = 0;
        for (const b of this.buf) { out.set(b, at); at += b.length; }
        this.port.postMessage(out, [out.buffer]); this.buf = []; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-tap', Tap);`;

type Mic = { rate: number; close: () => void };

/** Opens the microphone and feeds `onChunk` mono samples. Throws what getUserMedia throws (a refusal is a NotAllowedError). */
async function openMic(onChunk: (c: Float32Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  // (The tap has no output, so nothing else refers to it: held here, or the browser collects it a moment after the key goes down and the clip stops short.)
  let keep: AudioNode | null = null;
  const close = () => {
    for (const t of stream.getTracks()) t.stop();
    try {
      src.disconnect();
      keep?.disconnect();
      keep = null;
    } catch {
      /* already gone */
    }
    void ctx.close().catch(() => undefined);
  };
  try {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const tap = new AudioWorkletNode(ctx, 'voice-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
      keep = tap;
      src.connect(tap);
    } catch {
      // No AudioWorklet here: the older tap (it must be wired to the output to run, and is silent there).
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(sp);
      sp.connect(ctx.destination);
      keep = sp;
    }
    await ctx.resume();
  } catch (e) {
    close();
    throw e;
  }
  return { rate: ctx.sampleRate, close };
}

const isLocalhost = (): boolean => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

export function initVoice(h: VoiceHooks): VoiceControl {
  let state: ReturnType<VoiceControl['state']> = 'idle';
  let releaseWanted = false;
  let mic: Mic | null = null;
  let chunks: Float32Array[] = [];
  let samples = 0;
  let seq = 0;
  let noPartnerSaid = false;
  const who = h.partnerName.toUpperCase();

  showMic(h.hasPartner(), h.keyLabel());

  const noticeSeen = (): boolean => {
    try {
      return window.localStorage.getItem(NOTICE_KEY) === '1';
    } catch {
      return true; // no storage: the notice would come every press; say it on this visit only
    }
  };
  let noticeShownThisVisit = false;
  const notice = (): string | null => {
    if (noticeShownThisVisit || noticeSeen()) return null;
    noticeShownThisVisit = true;
    try {
      window.localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      /* no storage here */
    }
    return `THE MIC IS ON ONLY WHILE YOU HOLD ${h.keyLabel().toUpperCase()} · THE CLIP GOES TO META'S MODEL TO READ YOUR ORDER`;
  };

  const stopMic = () => {
    mic?.close();
    mic = null;
    setMicLive(false);
  };

  async function press(): Promise<void> {
    if (state !== 'idle' && state !== 'sending') return;
    if (!h.hasPartner()) {
      if (!noPartnerSaid) {
        noPartnerSaid = true;
        showVoice({ text: 'NO PARTNER', tone: 'info' }, null, 2500);
      }
      return;
    }
    if (!h.canTalk()) return;
    releaseWanted = false;
    state = 'arming';
    chunks = [];
    samples = 0;
    const first = notice();
    showVoice({ text: 'OPENING THE MIC…', tone: 'wait' }, first ? { text: first, tone: 'dim' } : null, null);
    try {
      const opened = await openMic((c) => {
        if (state !== 'listening' && state !== 'arming') return; // (from the first sample, not from when the mic reports ready)
        chunks.push(c);
        samples += c.length;
        setVoiceLevel(Math.min(1, peak(c) * 2.5));
        if (state === 'listening' && mic && samples >= CLIP_MAX_S * mic.rate) void finish(); // the longest clip: it stops by itself
      });
      if (h.signal.aborted || releaseWanted || state !== 'arming') {
        // Let go before the mic was ready (a tap), or the job ended: nothing was recorded for long enough to matter.
        opened.close();
        state = 'idle';
        if (!h.signal.aborted) showVoice({ text: `HOLD ${h.keyLabel().toUpperCase()} AND TALK, THEN LET GO`, tone: 'info' }, null, 2800);
        return;
      }
      mic = opened;
      state = 'listening';
      setMicLive(true);
      showVoice({ text: 'LISTENING… LET GO TO SEND', tone: 'listening' }, first ? { text: first, tone: 'dim' } : null, null);
    } catch (e) {
      state = 'idle';
      stopMic();
      const name = e instanceof DOMException ? e.name : '';
      const text = name === 'NotAllowedError' || name === 'SecurityError' ? 'MIC BLOCKED · ALLOW THE MICROPHONE FOR THIS SITE TO GIVE ORDERS' : name === 'NotFoundError' ? 'NO MICROPHONE FOUND' : 'COULD NOT OPEN THE MIC';
      showVoice({ text, tone: 'error' }, null, 5000);
    }
  }

  function release(): void {
    releaseWanted = true;
    if (state === 'listening') void finish();
  }

  /** Stops the recording and sends it (or throws it away). */
  async function finish(): Promise<void> {
    if (state !== 'listening' || !mic) return;
    const rate = mic.rate;
    const taken = chunks;
    chunks = [];
    stopMic();
    state = 'sending';
    const clip = encodeClip(taken, rate);
    if (clip.seconds < CLIP_MIN_S) {
      state = 'idle';
      showVoice({ text: `TOO SHORT · HOLD ${h.keyLabel().toUpperCase()} WHILE YOU TALK`, tone: 'info' }, null, 2800);
      return;
    }
    const mine = ++seq;
    showVoice({ text: '…', tone: 'wait' }, null, null);
    const t0 = performance.now();
    let reply: VoiceReply | null = null;
    let failure: string | null = null;
    try {
      reply = await postClip(clip.wav, (words) => {
        // The words are in while the order is still being worked out: show them now, with a dot for the answer.
        if (mine === seq && words.trim() !== '') showVoice({ text: `YOU: “${words.replace(/\s+/g, ' ').trim().slice(0, 200)}”`, tone: 'heard' }, { text: '…', tone: 'dim' }, null);
      });
    } catch (e) {
      failure = e instanceof VoiceCallError ? e.text : voiceErrorText(0, 'network');
    }
    if (mine !== seq) return; // a newer clip has gone out since: its answer is the one to show
    if (state === 'sending') state = 'idle';
    if (h.signal.aborted) return;
    if (!reply) {
      showVoice({ text: failure ?? voiceErrorText(0), tone: 'error' }, null, 5000);
      return;
    }
    conclude(reply, performance.now() - t0);
  }

  /** The words and the order they mean are in: show them, carry the order out, show the answer. */
  function conclude(reply: VoiceReply, msTotal: number): Exchange {
    const heard = reply.transcript;
    if (reply.order.order === 'none') {
      const text = heard === '' ? "DIDN'T CATCH THAT" : '';
      showVoice(heard === '' ? { text, tone: 'info' } : { text: `YOU: “${heard}”`, tone: 'heard' }, heard === '' ? null : { text: 'NOT AN ORDER', tone: 'dim' });
      return finishExchange(reply, '', msTotal);
    }
    const override = h.apply(reply.order);
    const said = override?.say ?? reply.order.say;
    showVoice({ text: `YOU: “${heard}”`, tone: 'heard' }, { text: `${who}: ${said}`, tone: override && !override.ok ? 'error' : 'reply' });
    return finishExchange(reply, said, msTotal);
  }

  function finishExchange(reply: VoiceReply, said: string, msTotal: number): Exchange {
    const e: Exchange = { transcript: reply.transcript, order: reply.order, source: reply.source, said, msTotal: Math.round(msTotal), ms: reply.ms };
    h.onExchange?.(e);
    return e;
  }

  // ---- input ----
  const modifierFree = (ev: KeyboardEvent) => !ev.metaKey && !ev.ctrlKey && !ev.altKey;
  const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  window.addEventListener(
    'keydown',
    (ev) => {
      if (ev.code !== h.getKey() || ev.repeat || !modifierFree(ev) || typing(ev.target)) return;
      ev.preventDefault();
      void press();
    },
    { signal: h.signal }
  );
  window.addEventListener(
    'keyup',
    (ev) => {
      if (ev.code === h.getKey()) release();
    },
    { signal: h.signal }
  );
  // The window went away with the key down (a keyup that never comes): the mic closes and nothing is sent.
  const abandon = () => {
    releaseWanted = true;
    if (state === 'listening') {
      chunks = [];
      stopMic();
      state = 'idle';
      showVoice({ text: 'MIC CLOSED · NOTHING WAS SENT', tone: 'info' }, null, 2500);
    }
  };
  window.addEventListener('blur', abandon, { signal: h.signal });
  document.addEventListener('visibilitychange', () => document.hidden && abandon(), { signal: h.signal });
  wireMic({ down: () => void press(), up: release }, h.signal);
  h.signal.addEventListener('abort', () => {
    chunks = [];
    stopMic();
    state = 'idle';
    hideVoice();
  });

  // ---- the typed twin (localhost only) ----
  async function order(text: string): Promise<Exchange | null> {
    if (!h.hasPartner()) {
      showVoice({ text: 'NO PARTNER', tone: 'info' }, null, 2500);
      return null;
    }
    const mine = ++seq;
    const t0 = performance.now();
    showVoice({ text: '…', tone: 'wait' }, null, null);
    const fast = matchOrder(text);
    let reply: VoiceReply;
    if (fast) reply = { transcript: text, order: fast, source: 'fast', ms: { asr: 0, order: 0 } };
    else {
      try {
        reply = await postText(text);
      } catch (e) {
        showVoice({ text: e instanceof VoiceCallError ? e.text : voiceErrorText(0, 'network'), tone: 'error' }, null, 5000);
        return null;
      }
    }
    if (mine !== seq || h.signal.aborted) return null;
    return conclude(reply, performance.now() - t0);
  }
  if (isLocalhost()) {
    const w = window as unknown as Record<string, unknown>;
    w.__order = (text: string) => order(text);
    h.signal.addEventListener('abort', () => {
      if (w.__order) delete w.__order;
    });
  }

  return { order, state: () => state };
}

class VoiceCallError extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}

/** The last JSON object of a newline-delimited stream; each one is handed to `onLine` the moment it arrives. */
async function lastLine(body: ReadableStream<Uint8Array>, onLine: (o: unknown) => void): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last: unknown = null;
  const take = (line: string) => {
    if (line.trim() === '') return;
    last = JSON.parse(line);
    onLine(last);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf('\n');
    while (at >= 0) {
      take(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      at = buffer.indexOf('\n');
    }
    if (done) break;
  }
  take(buffer);
  return last;
}

async function call(path: string, init: RequestInit, onLine: (o: unknown) => void = () => undefined): Promise<unknown> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(path, { ...init, signal: ctl.signal });
    } catch (e) {
      throw new VoiceCallError(voiceErrorText(0, e instanceof DOMException && e.name === 'AbortError' ? 'timeout' : 'network'));
    }
    let body: unknown = null;
    try {
      body = res.ok && res.body && (res.headers.get('content-type') ?? '').includes('ndjson') ? await lastLine(res.body, onLine) : await res.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new VoiceCallError(voiceErrorText(0, 'timeout'));
      /* not JSON: the status says enough */
    }
    const code = typeof (body as { error?: unknown } | null)?.error === 'string' ? (body as { error: string }).error : undefined;
    if (!res.ok || code) throw new VoiceCallError(voiceErrorText(res.ok ? 500 : res.status, code));
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}

/** The clip to /api/ai/transcribe; the words come back first (`onWords`, while the order is still being worked out), then the whole answer. */
async function postClip(wav: Uint8Array<ArrayBuffer>, onWords: (words: string) => void): Promise<VoiceReply> {
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'order.wav');
  const reply = readVoiceReply(
    await call('/api/ai/transcribe?stream=1', { method: 'POST', body: form }, (o) => {
      const line = o as { transcript?: unknown; order?: unknown } | null;
      if (typeof line?.transcript === 'string' && line.order === undefined) onWords(line.transcript);
    })
  );
  if (!reply) throw new VoiceCallError(voiceErrorText(500));
  return reply;
}

/** Typed words to /api/ai/order (the fast path has already had its go). */
async function postText(text: string): Promise<VoiceReply> {
  const out = (await call('/api/ai/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })) as { order?: unknown; source?: unknown; ms?: unknown };
  const reply = readVoiceReply({ transcript: text, order: out.order, source: out.source, ms: { asr: 0, order: typeof out.ms === 'number' ? out.ms : 0 } });
  if (!reply) throw new VoiceCallError(voiceErrorText(500));
  return reply;
}
