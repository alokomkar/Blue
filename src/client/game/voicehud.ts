// The voice orders' bit of the HUD (docs/DESIGN.md section 4; the rules and the recording are voice.ts's): a two-line subtitle in the style of the guards' radio feed (radiofeed.ts),
// what you said (or "…" while it is being read) over the partner's answer ("AGENT B: Covering you"), and the push-to-talk button. It never takes a click apart from the button itself.

export type LineTone = 'listening' | 'wait' | 'heard' | 'info' | 'error';
export type ReplyTone = 'reply' | 'dim' | 'error';

/** How long a finished exchange stays up. */
const HOLD_MS = 6500;
const FADE_MS = 500;

let fadeTimer = 0;
let hideTimer = 0;

const byId = (id: string): HTMLElement | null => document.getElementById(id);

function clearTimers(): void {
  window.clearTimeout(fadeTimer);
  window.clearTimeout(hideTimer);
}

/**
 * Puts the two lines up. `you` is null to leave the first line empty. With `holdMs` the subtitle fades out after that long (a finished exchange); without it, it stays (listening, waiting for the answer).
 */
export function showVoice(you: { text: string; tone: LineTone } | null, reply: { text: string; tone: ReplyTone } | null, holdMs: number | null = HOLD_MS): void {
  const box = byId('voice-sub');
  const y = byId('voice-you');
  const r = byId('voice-reply');
  if (!box || !y || !r) return;
  clearTimers();
  box.classList.remove('hidden', 'fading');
  y.className = `voice-you ${you?.tone ?? ''}`;
  y.textContent = you?.text ?? '';
  if (you?.tone === 'listening') {
    const meter = document.createElement('span');
    meter.className = 'voice-meter';
    meter.append(document.createElement('i'));
    y.append(meter);
  }
  r.className = `voice-reply ${reply?.tone === 'reply' || !reply ? '' : reply.tone}`;
  r.textContent = reply?.text ?? '';
  if (holdMs !== null) {
    fadeTimer = window.setTimeout(() => {
      box.classList.add('fading');
      hideTimer = window.setTimeout(() => box.classList.add('hidden'), FADE_MS);
    }, holdMs);
  }
}

/** The "listening" light's level, 0..1. */
export function setVoiceLevel(level: number): void {
  const fill = byId('voice-you')?.querySelector<HTMLElement>('.voice-meter i');
  if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
}

export function hideVoice(): void {
  clearTimers();
  byId('voice-sub')?.classList.add('hidden');
}

/** What the subtitle says now (for tests and the debug hook). */
export function voiceLines(): { you: string; reply: string; hidden: boolean } {
  return { you: byId('voice-you')?.textContent ?? '', reply: byId('voice-reply')?.textContent ?? '', hidden: byId('voice-sub')?.classList.contains('hidden') ?? true };
}

/** The push-to-talk button: shown only on a job with a partner; `key` is the label of the talk key. */
export function showMic(on: boolean, key = 'V'): void {
  const b = byId('voice-mic');
  if (!b) return;
  b.classList.toggle('hidden', !on);
  const label = byId('voice-mic-key');
  if (label) label.textContent = key;
}

/** Lit red while the microphone is open. */
export function setMicLive(live: boolean): void {
  byId('voice-mic')?.classList.toggle('live', live);
}

/** Holding the button is holding the key: press starts, release (or anything that takes the pointer away) ends. Torn down with `signal`. */
export function wireMic(handlers: { down: () => void; up: () => void }, signal: AbortSignal): void {
  const b = byId('voice-mic');
  if (!b) return;
  let held = false;
  const end = () => {
    if (!held) return;
    held = false;
    handlers.up();
  };
  b.addEventListener(
    'pointerdown',
    (ev) => {
      ev.preventDefault();
      try {
        b.setPointerCapture(ev.pointerId);
      } catch {
        /* a synthetic pointer has nothing to capture */
      }
      held = true;
      handlers.down();
    },
    { signal }
  );
  b.addEventListener('pointerup', end, { signal });
  b.addEventListener('pointercancel', end, { signal });
  b.addEventListener('lostpointercapture', end, { signal });
  b.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
  signal.addEventListener('abort', () => {
    hideVoice();
    setMicLive(false);
    showMic(false);
  });
}
