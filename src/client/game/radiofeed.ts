// The guards' radio feed on the HUD (docs/GAMEPLAY.md, section 1): a few short lines, newest at the bottom, each fading after a few seconds. A routine check-in is quiet; a missed one, the alert and
// the control room's counters to the player's habits stay up longer and are coloured, so the feed reads with the sound off. It never takes a click and never covers the toasts (game.css's .radio-feed).
// The rules for what is said and when are radio.ts's and habits.ts's; this is only the DOM.

export type RadioKind = 'routine' | 'miss' | 'alert' | 'counter' | 'static';

/** How many lines show at once. */
export const FEED_LINES = 3;
/** How long each kind stays up, in milliseconds. */
export const FEED_MS: Record<RadioKind, number> = { routine: 5000, static: 6000, miss: 9000, alert: 10000, counter: 10000 };
const FADE_MS = 600;

type Shown = { el: HTMLElement; kind: RadioKind; timer: number };
const shown: Shown[] = [];

function host(): HTMLElement | null {
  return document.getElementById('radio-feed');
}

function drop(s: Shown): void {
  window.clearTimeout(s.timer);
  s.el.remove();
  const i = shown.indexOf(s);
  if (i >= 0) shown.splice(i, 1);
}

/** Puts a line on the feed. The same words already up are not added twice; with the feed full, the oldest routine line goes first (a missed check-in or a counter is never pushed off by chatter). */
export function pushRadio(text: string, kind: RadioKind = 'routine'): void {
  const el = host();
  if (!el) return;
  if (shown.some((s) => s.el.textContent === text)) return;
  while (shown.length >= FEED_LINES) {
    const victim = shown.find((s) => s.kind === 'routine' || s.kind === 'static') ?? (kind === 'routine' ? null : shown[0]);
    if (!victim) return; // (only routine chatter: it waits its turn, the important lines stay)
    drop(victim);
  }
  const line = document.createElement('div');
  line.className = `radio-line ${kind}`;
  line.textContent = text;
  el.append(line);
  const s: Shown = { el: line, kind, timer: 0 };
  s.timer = window.setTimeout(() => {
    line.classList.add('fading');
    s.timer = window.setTimeout(() => drop(s), FADE_MS);
  }, FEED_MS[kind]);
  shown.push(s);
}

/** A new job starts with an empty feed. */
export function clearRadio(): void {
  for (const s of [...shown]) drop(s);
}

/** What the feed says now, oldest first (for tests and the debug hook). */
export function radioLines(): string[] {
  return shown.map((s) => s.el.textContent ?? '');
}
