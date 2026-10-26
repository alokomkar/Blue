// DOM overlay wiring — suspicion bar, hack progress, toasts, blueprint, report. Pure
// presentation: no game-logic decisions live here, game.ts calls these and
// passes in the numbers/text to show.

import { EMPTY_INBOX, EMPTY_TOASTS, addToInbox, ageLabel, clearToasts as clearToastState, expireToast, markAllRead, pushToast, unreadCount, visibleCap, type Inbox, type ToastChange, type ToastItem, type ToastState } from './toasts';
import { withKeys, type ActionId } from '../../shared/controls';
import { BODY_HIDDEN_PCT } from './bodies';
import type { Body } from './outfit';
import type { Community, DailyStatus, Grade, Hairstyle, Leaderboard, Look, StreakInfo, SuitColour } from '../../shared/api';
import { communityLine } from '../../shared/community';
import { queuedLogsText } from './sequence';
import type { Feel } from '../../shared/tries';
import type { FireChoice } from './weapons';
import { drawBlueprint, type BlueprintSheet, type BlueprintView } from './blueprint';

const jobLabel = document.getElementById('job-label') as HTMLSpanElement;
const scoreLabel = document.getElementById('score-label') as HTMLSpanElement;
const documentsLabel = document.getElementById('documents-label') as HTMLSpanElement;
const suspicionFill = document.getElementById('suspicion-fill') as HTMLDivElement;
const weaponFill = document.getElementById('weapon-fill') as HTMLDivElement;
const toastStack = document.getElementById('toast-stack')!;
const spottedBanner = document.getElementById('spotted-banner')!;
const briefCard = document.getElementById('brief-card')!;
const briefBegin = document.getElementById('brief-begin') as HTMLButtonElement;
const briefTrain = document.getElementById('brief-train') as HTMLButtonElement;
const trainingLink = document.getElementById('brief-training-link') as HTMLButtonElement;
const trainingCard = document.getElementById('training-card')!;
const trainingList = document.getElementById('training-list')!;
const trainingBack = document.getElementById('training-back') as HTMLButtonElement;
const briefContinue = document.getElementById('brief-continue') as HTMLButtonElement;
const briefDaily = document.getElementById('brief-daily')!;
const briefWelcome = document.getElementById('brief-welcome')!;
const briefManual = document.getElementById('brief-manual') as HTMLButtonElement;
const briefFile = document.getElementById('brief-file') as HTMLButtonElement;
const turnSlider = document.getElementById('help-turn') as HTMLInputElement;
const turnValue = document.getElementById('help-turn-value')!;
const aimSlider = document.querySelector<HTMLInputElement>('#help-aim')!;
const aimValue = document.getElementById('help-aim-value')!;
const cameraSlider = document.querySelector<HTMLInputElement>('#help-camera')!;
const cameraValue = document.getElementById('help-camera-value')!;
const smoothSetting = document.getElementById('help-smooth') as HTMLInputElement;
const dashSetting = document.getElementById('help-dash') as HTMLInputElement;
const fpsSetting = document.getElementById('help-fps') as HTMLInputElement;
const resetControls = document.getElementById('help-reset') as HTMLButtonElement;
const briefDailyNote = document.getElementById('brief-daily-note')!;
const briefDailyCase = document.getElementById('brief-daily-case')!;
const agentSection = document.getElementById('agent-heading')!.parentElement!;
const briefDailyName = document.getElementById('brief-daily-name')!;
const briefDailyOp = document.getElementById('brief-daily-op')!;
const briefDailyJob = document.getElementById('brief-daily-job')!;
const briefDailyStatus = document.getElementById('brief-daily-status')!;
const briefDailyStreak = document.getElementById('brief-daily-streak')!;
const briefDailyBtn = document.getElementById('brief-daily-btn') as HTMLButtonElement;
const coach = document.getElementById('coach')!;
const coachKicker = document.getElementById('coach-kicker')!;
const coachPips = document.getElementById('coach-pips')!;
const coachTitle = document.getElementById('coach-title')!;
const coachText = document.getElementById('coach-text')!;

const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;

/** Hands keyboard focus back to the game canvas, so a clicked HUD button doesn't keep Space/Enter. */
function refocusGame(): void {
  document.getElementById('bg')?.focus();
}

const trapBtn = document.getElementById('trap-btn') as HTMLButtonElement;
const trapCount = document.getElementById('trap-count')!;
const trapPanel = document.getElementById('trap-panel')!;
const trapTitle = document.getElementById('trap-title')!;
const trapStatus = document.getElementById('trap-status')!;
const trapNext = document.getElementById('trap-next') as HTMLButtonElement;
const trapFeed = document.getElementById('trap-feed')!;
const trapBlast = document.getElementById('trap-blast') as HTMLButtonElement;

/** Wires the trap button (set one), the feed's next-trap button and its detonate button (once per job, via `signal`). */
export function wireTraps(onSet: () => void, onNext: () => void, onBlast: () => void, signal: AbortSignal): void {
  trapBtn.addEventListener('click', onSet, { signal });
  trapNext.addEventListener('click', onNext, { signal });
  trapBlast.addEventListener('click', onBlast, { signal });
}

/** How many traps are left to set. */
const flashBtn = document.getElementById('flash-btn')!;
const flashCount = document.getElementById('flash-count')!;
const kitFlash = document.getElementById('kit-flash') as HTMLButtonElement;
const kitFlashCount = document.getElementById('kit-flash-count')!;
const flashPrompt = document.getElementById('flash-prompt') as HTMLButtonElement;
const flashPromptCount = document.getElementById('flash-prompt-count')!;
const flashPromptKey = document.getElementById('flash-prompt-key')!;
const flashOutEl = document.getElementById('flash-out')!;

/** How many flash grenades are left, on the top-row button, in the kit and on the prompt. */
export function setFlashes(left: number): void {
  for (const el of [flashCount, kitFlashCount, flashPromptCount]) el.textContent = String(left);
  flashBtn.classList.toggle('empty', left === 0);
  kitFlash.classList.toggle('empty', left === 0);
}

const kitSmoke = document.getElementById('kit-smoke') as HTMLButtonElement;
const kitSmokeCount = document.getElementById('kit-smoke-count')!;
const kitShock = document.getElementById('kit-shock') as HTMLButtonElement;
const kitShockCount = document.getElementById('kit-shock-count')!;

/** How many smoke and shock grenades are left, in the kit. */
export function setGrenades(smoke: number, shock: number): void {
  kitSmokeCount.textContent = String(smoke);
  kitShockCount.textContent = String(shock);
  kitSmoke.classList.toggle('empty', smoke === 0);
  kitShock.classList.toggle('empty', shock === 0);
  document.getElementById('smoke-prompt-count')!.textContent = String(smoke);
  document.getElementById('shock-prompt-count')!.textContent = String(shock);
}

const smokePrompt = document.getElementById('smoke-prompt') as HTMLButtonElement;
const shockPrompt = document.getElementById('shock-prompt') as HTMLButtonElement;

/** Offers smoke and/or a shock grenade (pulsing buttons beside the flash's; on a desktop pills that name their keys), or takes the offers away. */
export function showGrenadePrompts(smoke: boolean, shock: boolean, smokeKey: string, shockKey: string): void {
  document.getElementById('smoke-prompt-key')!.textContent = smokeKey;
  document.getElementById('shock-prompt-key')!.textContent = shockKey;
  smokePrompt.classList.toggle('hidden', !smoke);
  shockPrompt.classList.toggle('hidden', !shock);
}

/** The smoke and shock grenades' kit buttons and offers (once per job, via `signal`). */
export function wireGrenades(onSmoke: () => void, onShock: () => void, signal: AbortSignal): void {
  for (const [el, use] of [[kitSmoke, onSmoke], [kitShock, onShock], [smokePrompt, onSmoke], [shockPrompt, onShock]] as const) {
    el.addEventListener(
      'click',
      () => {
        openKit(false);
        use();
      },
      { signal }
    );
  }
}

/** In the gun's training course the kit and the top row show the flash grenade (the course teaches it); in the other courses it stays out of sight. */
export function setFlashLesson(on: boolean): void {
  document.body.classList.toggle('flash-lesson', on);
}

/** The flash grenade's buttons (once per job, via `signal`): the top row's, the kit's and the prompt's. */
export function wireFlash(onUse: () => void, signal: AbortSignal): void {
  for (const el of [flashBtn, kitFlash, flashPrompt]) {
    el.addEventListener(
      'click',
      () => {
        openKit(false);
        onUse();
      },
      { signal }
    );
  }
}

/** Offers the flash grenade (a pulsing button; on a desktop a pill that names `key`), or takes the offer away. */
export function showFlashPrompt(on: boolean, key?: string): void {
  if (key) flashPromptKey.textContent = key;
  flashPrompt.classList.toggle('hidden', !on);
}

/** The white-out of a flash going off: `strength` (0 to 1) is how much of it the agent caught; `slow` is a guard's, the screen clearing over a few seconds. */
export function flashOut(strength: number, slow = false): void {
  flashOutEl.style.setProperty('--flash', String(Math.max(0.15, Math.min(0.95, strength))));
  flashOutEl.classList.remove('go', 'slow');
  void flashOutEl.offsetWidth; // restart it
  flashOutEl.classList.add('go');
  if (slow) flashOutEl.classList.add('slow');
}

const bulletPrompt = document.getElementById('bullet-prompt') as HTMLButtonElement;
const bulletFill = document.getElementById('bullet-bar-fill')!;

/** Bullet time's button: offered (`'offer'`, with the key it is on), a draining bar while it lasts (`'on'`), or gone. `fraction` is what is left in the meter. */
export function showBullet(mode: 'offer' | 'on' | null, key: string, fraction: number): void {
  bulletPrompt.classList.toggle('hidden', mode === null);
  bulletPrompt.classList.toggle('on', mode === 'on');
  document.getElementById('bullet-prompt-label')!.textContent = mode === 'on' ? 'Slowed' : 'Bullet time';
  document.getElementById('bullet-prompt-key')!.textContent = key;
  bulletFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

const bulletAutoSetting = document.getElementById('help-bullet-auto') as HTMLInputElement;

/** Shows automatic bullet time as on or off in the controls sheet, and tells `onChange` when it is changed. */
export function wireBulletAutoSetting(on: boolean, onChange: (on: boolean) => void): void {
  bulletAutoSetting.checked = on;
  bulletAutoSetting.onchange = () => onChange(bulletAutoSetting.checked);
}

/** The button's click (once per job, via `signal`): the same as Space. */
export function wireBullet(onUse: () => void, signal: AbortSignal): void {
  bulletPrompt.addEventListener('click', onUse, { signal });
}

/** The boss's bar at the top of the screen (a boss): its name, how much of it is left, and what the shield is doing. */
const bossBar = ((): { root: HTMLElement; name: HTMLElement; fill: HTMLElement; note: HTMLElement } => {
  const root = document.createElement('div');
  root.id = 'boss-bar';
  root.hidden = true;
  root.innerHTML = '<span class="boss-name"></span><div class="boss-track"><i class="boss-fill"></i></div><span class="boss-note"></span>';
  document.body.append(root);
  return { root, name: root.querySelector('.boss-name')!, fill: root.querySelector('.boss-fill')!, note: root.querySelector('.boss-note')! };
})();

/** Shows the boss's bar (`fraction` 0 to 1 of his health; `state` what the shield is doing), or takes it away with null. */
export function setBossBar(bar: { name: string; fraction: number; state: 'up' | 'open' | 'held'; note: string } | null): void {
  bossBar.root.hidden = bar === null;
  if (!bar) return;
  bossBar.name.textContent = bar.name;
  bossBar.fill.style.width = `${Math.max(0, Math.min(1, bar.fraction)) * 100}%`;
  bossBar.note.textContent = bar.note;
  bossBar.root.dataset.state = bar.state;
}

/** The beat of slow motion: the screen's edges darken while it lasts. */
export function setSlowmo(on: boolean): void {
  document.body.classList.toggle('slowmo', on);
}

const dogWarns = document.getElementById('dog-warns')!;
const dogVignette = document.getElementById('dog-vignette')!;
const dogMarkers: HTMLElement[] = Array.from({ length: 4 }, () => {
  const el = document.createElement('div');
  el.className = 'dog-marker';
  el.innerHTML = '<i></i><b>!</b><u></u>';
  dogWarns.append(el);
  return el;
});

// A downed partner's marker: the same arrow and ring as a watchdog's, in green, saying how far and how long is left to reach them.
const partnerMarker = (() => {
  const el = document.createElement('div');
  el.className = 'dog-marker partner-marker';
  el.innerHTML = '<i></i><b>+</b><u></u>';
  dogWarns.append(el);
  return el;
})();

/** Marks the downed partner (an arrow on the screen's edge when they are out of view, a ring on them when in view) with `text`; null takes it away. */
export function setPartnerMarker(m: { x: number; y: number; angle: number; onScreen: boolean } | null, text: string): void {
  partnerMarker.classList.toggle('show', m !== null);
  if (!m) return;
  partnerMarker.classList.toggle('on', m.onScreen);
  partnerMarker.style.left = `${m.x * 100}%`;
  partnerMarker.style.top = `${m.y * 100}%`;
  partnerMarker.style.setProperty('--rot', `${(-m.angle * 180) / Math.PI}deg`);
  partnerMarker.style.setProperty('--beat', '0.8s');
  const label = partnerMarker.querySelector('u')!;
  label.textContent = text;
  // Near the left or right edge the label stays on the screen (it is centred under the marker otherwise).
  const side = m.x < 0.2 ? 'left' : m.x > 0.8 ? 'right' : null;
  label.style.left = side === 'left' ? '-20px' : side === 'right' ? 'auto' : '50%';
  label.style.right = side === 'right' ? '-20px' : 'auto';
  label.style.transform = side ? 'none' : 'translateX(-50%)';
}

/** A watchdog's marker (dogwarn.ts Marker): where on the screen (0..1), the way it points, how strong, whether it is on your trail, whether it is in view. */
export type DogMarker = { x: number; y: number; angle: number; level: number; tracking: boolean; dist: number; onScreen: boolean };

/** Draws the watchdog warnings: a marker each (an arrow on the edge for a dog out of view, a ring on one in view), pulsing faster as they close, and the red edge pulse for `vignette` 0..1. */
export function setDogWarnings(markers: readonly DogMarker[], vignette: number): void {
  dogMarkers.forEach((el, i) => {
    const m = markers[i];
    el.classList.toggle('show', !!m);
    if (!m) return;
    el.classList.toggle('track', m.tracking);
    el.classList.toggle('on', m.onScreen);
    el.style.left = `${m.x * 100}%`;
    el.style.top = `${m.y * 100}%`;
    el.style.setProperty('--rot', `${(-m.angle * 180) / Math.PI}deg`);
    el.querySelector('u')!.textContent = `${m.tracking ? 'HUNTING · ' : 'DOG · '}${Math.round(m.dist)} m`;
    el.style.setProperty('--beat', `${(1.35 - 1.2 * m.level).toFixed(2)}s`);
  });
  dogVignette.style.opacity = String(Math.min(1, vignette));
  dogVignette.style.setProperty('--beat', `${(1.2 - 0.9 * vignette).toFixed(2)}s`);
}

const crosshairEl = document.getElementById('crosshair')!;

/** The crosshair while aiming from cover. `zone`: what is in the sights (a guard, a dog, a drone: red; a head: gold), `note` a word beside it (aimassist.ts crosshairNote). */
export function setCrosshair(visible: boolean, zone: 'head' | 'body' | 'leg' | null = null, note = ''): void {
  crosshairEl.classList.toggle('hidden', !visible);
  crosshairEl.classList.toggle('locked', visible && zone !== null);
  crosshairEl.classList.toggle('head', visible && zone === 'head');
  crosshairEl.dataset['note'] = visible ? note : '';
}

export function setTrapsLeft(left: number): void {
  trapCount.textContent = String(left);
  trapBtn.classList.toggle('empty', left === 0);
  kitTrapCount.textContent = String(left);
  kitTrap.classList.toggle('empty', left === 0);
}

// ---- first-use hints and hold captions (touch screens) ----

export type HintId = 'kit' | 'camo' | 'emp' | 'drag' | 'dodge';
const HINTS_KEY = 'mazeHeist.hintsSeen';
const TOUCH_JOBS_KEY = 'mazeHeist.touchJobs';
const HOLD_CAPTION_JOBS = 5; // Fire and Sneak say what a long press does for this many jobs
const HINT_MS = 6500;
const HINTS: Record<HintId, { target: string; text: string }> = {
  kit: { target: 'kit-btn', text: 'Your kit: tap the case for traps, a flare, the torch, night vision and the map.' },
  camo: { target: 'sneak-btn', text: 'Press and hold Sneak to cloak. A tap only sneaks.' },
  emp: { target: 'fire-btn', text: 'Press and hold Fire for an EMP: the only thing that stops dogs and drones.' },
  drag: { target: 'interact-btn', text: 'Tap Carry beside the body, take it somewhere dark, then tap Drop.' },
  dodge: { target: 'strafe-left-btn', text: 'Being shot at? Double-tap ◀ or ▶ to dodge.' },
};
const firstHint = document.getElementById('first-hint')!;
let hintsSeen: Set<string> | null = null;
let hintTimer = 0;
const hintQueue: HintId[] = [];

function seenHints(): Set<string> {
  if (hintsSeen) return hintsSeen;
  try {
    hintsSeen = new Set(JSON.parse(window.localStorage.getItem(HINTS_KEY) ?? '[]') as string[]);
  } catch {
    hintsSeen = new Set(); // storage blocked: hints show once a session instead
  }
  return hintsSeen;
}

function hideHint(): void {
  window.clearTimeout(hintTimer);
  if (firstHint.classList.contains('hidden')) return;
  firstHint.classList.add('hidden');
  const next = hintQueue.shift();
  if (next) hintTimer = window.setTimeout(() => showHint(next), 500);
}

firstHint.addEventListener('click', hideHint);

/**
 * The first time something needs a control that isn't obvious on a phone,
 * a bubble points at it and says how to use it: once per device, touch
 * screens only. One at a time; others wait their turn.
 */
export function showHint(id: HintId): void {
  const seen = seenHints();
  if (!document.body.classList.contains('touch-ui') || seen.has(id)) return;
  if (!firstHint.classList.contains('hidden')) {
    if (!hintQueue.includes(id)) hintQueue.push(id);
    return;
  }
  seen.add(id);
  try {
    window.localStorage.setItem(HINTS_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage blocked: fine, it just may show again next visit.
  }
  const hint = HINTS[id];
  firstHint.textContent = hint.text;
  const rect = document.getElementById(hint.target)?.getBoundingClientRect();
  firstHint.style.left = firstHint.style.right = firstHint.style.top = '';
  if (rect && rect.width > 0) {
    // Beside the control, on the side with room, its arrow pointing at it.
    const onRight = rect.left + rect.width / 2 > window.innerWidth / 2;
    firstHint.dataset.side = onRight ? 'left' : 'right';
    if (onRight) firstHint.style.right = `${Math.round(window.innerWidth - rect.left + 12)}px`;
    else firstHint.style.left = `${Math.round(rect.right + 12)}px`;
    firstHint.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  } else {
    firstHint.dataset.side = 'none'; // the control isn't up (Drag, before you're next to the body): mid-screen
  }
  firstHint.classList.remove('hidden');
  hintTimer = window.setTimeout(hideHint, HINT_MS);
}

/** Counts a job played on a touch screen; for the first few, Fire and Sneak say what holding them does. */
export function noteTouchJob(): void {
  if (!document.body.classList.contains('touch-ui')) return;
  let jobs = 0;
  try {
    jobs = parseInt(window.localStorage.getItem(TOUCH_JOBS_KEY) ?? '0', 10) || 0;
    window.localStorage.setItem(TOUCH_JOBS_KEY, String(jobs + 1));
  } catch {
    // Storage blocked: the captions stay up, which is the safe side to err on.
  }
  document.body.classList.toggle('hold-caps', jobs < HOLD_CAPTION_JOBS);
}

// ---- lining up a trap ----

const trapAimBar = document.getElementById('trap-aim')!;

/** Shows Roll / Set here / Dash / cancel while a trap is being lined up. */
export function setTrapAim(on: boolean): void {
  trapAimBar.classList.toggle('hidden', !on);
  document.body.classList.toggle('trap-aiming', on); // the trap camera steps aside for the buttons
}

export function wireTrapAim(actions: { roll: () => void; here: () => void; dash: () => void; cancel: () => void }, signal: AbortSignal): void {
  document.getElementById('trap-roll')!.addEventListener('click', actions.roll, { signal });
  document.getElementById('trap-dash')!.addEventListener('click', actions.dash, { signal });
  document.getElementById('trap-here')!.addEventListener('click', actions.here, { signal });
  document.getElementById('trap-cancel')!.addEventListener('click', actions.cancel, { signal });
}

// ---- the kit (touch screens) ----

const kit = document.getElementById('kit')!;
const kitBtn = document.getElementById('kit-btn') as HTMLButtonElement;
const kitTrap = document.getElementById('kit-trap') as HTMLButtonElement;
const kitTrapCount = document.getElementById('kit-trap-count')!;
const kitTorch = document.getElementById('kit-torch') as HTMLButtonElement;
const kitGoggles = document.getElementById('kit-goggles') as HTMLButtonElement;
const kitGogglesFill = document.getElementById('kit-goggles-fill')!;
const KIT_IDLE_MS = 8000; // an open kit folds itself away after this long untouched
let kitTimer = 0;
let kitOpened = false; // the case pulses until it's first opened

function openKit(open: boolean): void {
  kit.classList.toggle('open', open);
  kitBtn.setAttribute('aria-expanded', String(open));
  kitBtn.setAttribute('aria-label', open ? 'Close your kit' : 'Open your kit');
  window.clearTimeout(kitTimer);
  if (!open) return;
  kitOpened = true;
  kit.classList.remove('hint');
  kitTimer = window.setTimeout(() => openKit(false), KIT_IDLE_MS);
}

/** Wires the kit: the case opens and closes the fan; each tool does its job and folds the fan away. */
export function wireKit(tools: { trap: () => void; flare: () => void; torch: () => void; goggles: () => void; map: () => void; grapple: () => void; gun: () => void }, signal: AbortSignal): void {
  openKit(false);
  kit.classList.toggle('hint', !kitOpened);
  kitBtn.addEventListener('click', () => openKit(!kit.classList.contains('open')), { signal });
  const use = (id: string, fn: () => void): void => {
    document.getElementById(id)!.addEventListener(
      'click',
      () => {
        openKit(false);
        fn();
      },
      { signal }
    );
  };
  use('kit-trap', tools.trap);
  use('flare-btn', tools.flare);
  use('kit-torch', tools.torch);
  use('kit-goggles', tools.goggles);
  use('kit-map', tools.map);
  use('kit-grapple', tools.grapple);
  // The gun stays open on a tap, so it can be tapped through the lot (each tap restarts the fold-away timer).
  document.getElementById('kit-gun')!.addEventListener(
    'click',
    () => {
      openKit(true);
      tools.gun();
    },
    { signal }
  );
  signal.addEventListener('abort', () => openKit(false));
}

/** The AI partner: a line about them and, while bringing them round, the progress; null hides it. */
export function setPartner(info: { text: string; tone: 'free' | 'down'; fraction?: number } | null): void {
  const pill = document.getElementById('partner-pill')!;
  pill.classList.toggle('hidden', info === null);
  if (!info) return;
  pill.classList.toggle('down', info.tone === 'down');
  document.getElementById('partner-text')!.textContent = info.text;
  const bar = document.getElementById('partner-bar')!;
  bar.classList.toggle('hidden', info.fraction === undefined);
  if (info.fraction !== undefined) document.getElementById('partner-fill')!.style.width = `${Math.max(0, Math.min(1, info.fraction)) * 100}%`;
}

/** The kit's gun button and the chip by the fire pill name the gun being carried. */
export function setGunName(text: string): void {
  document.getElementById('kit-gun-name')!.textContent = text;
  document.getElementById('gun-chip-name')!.textContent = text;
}

const gunMenu = document.getElementById('gun-menu')!;
const gunGrid = document.getElementById('gun-grid')!;
let gunMenuIds: Array<string | null> = [];

/**
 * Builds the gun menu from its entries and wires it (once per job, via `signal`): a card picks its gun and closes the menu; the close button, a click outside the card,
 * and the chip by the fire pill (which opens it) do what they say. The keys (a number to pick, G or Esc to close) are game.ts's.
 */
export function wireGunMenu(entries: ReadonlyArray<{ id: string | null; name: string; kind: string; blurb: string; image: string }>, handlers: { open: () => void; pick: (id: string | null) => void; close: () => void }, signal: AbortSignal): void {
  gunMenuIds = entries.map((e) => e.id);
  gunGrid.replaceChildren();
  entries.forEach((e, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gun-card';
    card.dataset.gun = e.id ?? '';
    const pic = document.createElement('img');
    pic.className = 'gun-pic';
    pic.src = e.image;
    pic.alt = '';
    pic.draggable = false;
    const num = document.createElement('i');
    num.className = 'gun-num';
    num.textContent = String((i + 1) % 10);
    const name = document.createElement('b');
    name.textContent = e.name;
    const kind = document.createElement('small');
    kind.textContent = e.kind;
    const blurb = document.createElement('span');
    blurb.textContent = e.blurb;
    card.append(pic, num, name, kind, blurb);
    card.addEventListener('click', () => handlers.pick(e.id), { signal });
    gunGrid.appendChild(card);
  });
  document.getElementById('gun-menu-close')!.addEventListener('click', handlers.close, { signal });
  gunMenu.addEventListener('click', (ev) => ev.target === gunMenu && handlers.close(), { signal });
  document.getElementById('gun-chip')!.addEventListener('click', handlers.open, { signal });
}

/** The key that opens the gun menu, as the player reads it (the chip and the menu's note). */
export function setGunKey(label: string): void {
  document.getElementById('gun-chip-key')!.textContent = label;
  document.getElementById('gun-note-key')!.textContent = label;
}

/** Shows or hides the gun menu, marking the gun now carried. */
export function showGunMenu(open: boolean, current: string | null = null): void {
  gunMenu.classList.toggle('hidden', !open);
  document.body.classList.toggle('modal-open', open || !briefCard.classList.contains('hidden'));
  if (!open) {
    refocusGame();
    return;
  }
  for (const card of gunGrid.children) card.classList.toggle('current', (card as HTMLElement).dataset.gun === (current ?? ''));
  (gunGrid.querySelector('.gun-card.current') as HTMLElement | null)?.focus();
}

/** The gun the number key picks (1 is the first entry, 0 the tenth), or undefined past the end. */
export function gunForNumber(n: number): string | null | undefined {
  return gunMenuIds[(n + 9) % 10];
}

/** The trap camera panel: which trap it shows, of how many, and whether it's armed; null hides it. */
export function setTrapFeed(feed: { index: number; count: number; armed: boolean } | null): void {
  trapPanel.classList.toggle('hidden', feed === null);
  if (!feed) return;
  trapTitle.textContent = `Trap cam ${feed.index + 1}/${feed.count}`;
  trapStatus.textContent = feed.armed ? 'Sensor live' : 'Arming';
  trapStatus.classList.toggle('live', feed.armed);
  trapNext.hidden = feed.count < 2;
  trapBlast.disabled = !feed.armed;
}

/** Where on screen the feed's window is (CSS pixels), for drawing the trap camera into; null when hidden. */
export function trapFeedRect(): DOMRect | null {
  if (trapPanel.classList.contains('hidden') || document.body.classList.contains('modal-open')) return null;
  return trapFeed.getBoundingClientRect();
}

const torchBtn = document.getElementById('torch-btn') as HTMLButtonElement;

/** Shows the torch as on/off and wires its button (once per job, via `signal`). */
export function wireTorch(onToggle: () => void, signal: AbortSignal): void {
  torchBtn.addEventListener('click', onToggle, { signal });
}

export function setTorch(on: boolean): void {
  torchBtn.setAttribute('aria-pressed', String(on));
  torchBtn.setAttribute('aria-label', on ? 'Switch torch off (T)' : 'Switch torch on (T)');
  kitTorch.setAttribute('aria-pressed', String(on));
  kitTorch.setAttribute('aria-label', on ? 'Switch torch off' : 'Switch torch on');
}

const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
const helpCard = document.getElementById('help-card') as HTMLDivElement;
const helpClose = document.getElementById('help-close') as HTMLButtonElement;
const helpPaused = document.getElementById('help-paused')!;
const helpPanels = { controls: document.getElementById('help-controls')!, manual: document.getElementById('help-manual')! };
const helpTabs = { controls: document.getElementById('help-tab-controls') as HTMLButtonElement, manual: document.getElementById('help-tab-manual') as HTMLButtonElement };

type HelpTab = keyof typeof helpPanels;

/** Shows the controls or the field manual in the help sheet. */
function setHelpTab(tab: HelpTab): void {
  for (const t of Object.keys(helpPanels) as HelpTab[]) {
    helpPanels[t].hidden = t !== tab;
    helpTabs[t].setAttribute('aria-selected', String(t === tab));
  }
  helpPanels[tab].scrollTop = 0;
}
for (const t of Object.keys(helpTabs) as HelpTab[]) helpTabs[t].addEventListener('click', () => setHelpTab(t));
// Opened from the brief, before any job has wired the close button (wireControls), it closes itself.
let helpFromBrief = false;
helpClose.addEventListener('click', () => {
  if (!helpFromBrief) return;
  helpFromBrief = false;
  showControls(false);
});

/** Wires the ? button and the controls sheet's close button (once per job, via `signal`). */
export function wireControls(onToggle: () => void, onClose: () => void, signal: AbortSignal): void {
  helpBtn.addEventListener('click', onToggle, { signal });
  helpClose.addEventListener('click', onClose, { signal });
}

/**
 * Shows or hides the help sheet: the controls, and the field manual (every
 * rule, enemy and tool, which the brief used to hold all at once). `tab`
 * picks which; `inJob` is false when it's opened from the brief, before any
 * job, where there's nothing to pause.
 */
export function showControls(open: boolean, tab?: HelpTab, inJob = true): void {
  if (open && tab) setHelpTab(tab);
  helpPaused.hidden = !inJob;
  helpCard.classList.toggle('hidden', !open);
  // The play controls and gauges step aside, as under the blueprint; the brief, if it's up underneath, keeps them hidden.
  document.body.classList.toggle('modal-open', open || !briefCard.classList.contains('hidden'));
  helpBtn.setAttribute('aria-pressed', String(open));
  if (open) helpClose.focus();
  else refocusGame();
}

const gogglesBtn = document.getElementById('goggles-btn') as HTMLButtonElement;
const gogglesFill = document.getElementById('goggles-fill') as HTMLSpanElement;

/** Wires the night-vision button (once per job, via `signal`). */
export function wireGoggles(onToggle: () => void, signal: AbortSignal): void {
  gogglesBtn.addEventListener('click', onToggle, { signal });
}

/** The goggles as worn or not, and their battery: dim until it holds enough to switch on. */
/** The infrared readout (how many heat signatures are in range), or `null` when infrared is off. */
export function setInfrared(count: number | null, rangeM: number): void {
  const el = document.getElementById('ir-readout')!;
  el.hidden = count === null;
  if (count !== null) el.textContent = `Infrared · ${count} heat signature${count === 1 ? '' : 's'} · range ${rangeM} m`;
}

export function setGoggles(on: boolean, energy: number, canStart: boolean): void {
  gogglesBtn.setAttribute('aria-pressed', String(on));
  gogglesBtn.setAttribute('aria-label', on ? 'Take night vision off (R)' : 'Put night vision on (R)');
  gogglesFill.style.width = `${Math.max(0, Math.min(1, energy)) * 100}%`;
  gogglesFill.classList.toggle('on', on);
  gogglesFill.classList.toggle('ready', !on && canStart);
  kitGoggles.setAttribute('aria-pressed', String(on));
  kitGoggles.setAttribute('aria-label', on ? 'Take night vision off' : 'Put night vision on');
  kitGogglesFill.style.width = gogglesFill.style.width;
}

/** Shows the speaker as muted/unmuted and wires its click (once per job, via `signal`). */
export function wireMute(muted: boolean, onToggle: () => boolean, signal: AbortSignal): void {
  setMuted(muted);
  muteBtn.addEventListener(
    'click',
    () => {
      setMuted(onToggle());
      refocusGame();
    },
    { signal }
  );
}

/** Keeps the speaker icon in step when mute is toggled from the keyboard. */
export function setMuted(muted: boolean): void {
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

export function setJobLabel(level: number | 'training' | { daily: number } | { name: string }): void {
  jobLabel.textContent = level === 'training' ? 'TRAINING' : typeof level === 'number' ? `JOB ${level}` : 'name' in level ? level.name.toUpperCase() : `DAILY #${level.daily}`;
}

/** The training coach: the current station's step, title and instructions; null hides it. */
// The coach folds down to a one-line bar a few seconds into each lesson, so it
// stops covering the top of the screen; clicking it opens it again (and folds it
// back). (A phone folds it sooner: it has far less room.)
const coachNarrow = window.matchMedia('(max-width: 600px), (max-height: 480px)'); // a phone, upright or sideways
const COACH_FOLD_MS = 8000;
/** On a larger screen the lesson stays open a little longer: it is more to read. */
const COACH_FOLD_DESKTOP_MS = 14000;
/** Held sideways there is little height, so the lesson folds away sooner. */
const COACH_FOLD_SIDEWAYS_MS = 4000;
const sideways = window.matchMedia('(max-height: 480px)');
let coachFoldTimer = 0;
let coachStep = -1;

function foldCoach(folded: boolean): void {
  coach.classList.toggle('collapsed', folded);
  coach.setAttribute('aria-expanded', String(!folded));
}

coach.addEventListener('click', () => {
  window.clearTimeout(coachFoldTimer);
  foldCoach(!coach.classList.contains('collapsed'));
});

export function setCoach(c: { step: number; total: number; title: string; text: string; /** What heads it, where it is not a training lesson (a level's name). */ kicker?: string; /** Keep the card shut: the lesson is still on, silently. */ quiet?: boolean } | null): void {
  // (`quiet`: the level is in training's mode, with its stations, beacons and gates, but says nothing: the card stays shut)
  coach.classList.toggle('hidden', c === null || c.quiet === true);
  document.body.classList.toggle('training', c !== null);
  window.clearTimeout(coachFoldTimer);
  if (!c) {
    coachStep = -1;
    return;
  }
  // A new lesson opens in full, then folds away on a phone.
  if (c.step !== coachStep || !coach.classList.contains('collapsed')) {
    coachStep = c.step;
    foldCoach(false);
    coachFoldTimer = window.setTimeout(() => foldCoach(true), sideways.matches ? COACH_FOLD_SIDEWAYS_MS : coachNarrow.matches ? COACH_FOLD_MS : COACH_FOLD_DESKTOP_MS);
  }
  coach.classList.remove('done');
  coachKicker.textContent = `${c.kicker ?? 'Training'} · ${c.step}/${c.total}`;
  coachPips.replaceChildren(
    ...Array.from({ length: c.total }, (_, i) => {
      const pip = document.createElement('i');
      if (i < c.step - 1) pip.className = 'past';
      else if (i === c.step - 1) pip.className = 'now';
      return pip;
    })
  );
  coachTitle.textContent = c.title;
  coachText.textContent = c.text;
}

/** Marks the coach's current station done, for the moment before the next one shows. */
export function coachDone(): void {
  coach.classList.add('done');
  coachKicker.textContent = 'Done';
}

export function setScore(score: number): void {
  scoreLabel.textContent = `SCORE ${score}`;
}

const twistChip = document.getElementById('twist-chip')!;
/** The job's twist on the chip under the top bar (null: none); `urgent` reddens it, for a clock running low. */
export function setTwist(text: string | null, urgent = false, brief?: string): void {
  if (text === null) pinnedTwist = null;
  else if (brief !== undefined || pinnedTwist) pinnedTwist = { text, brief: brief ?? pinnedTwist?.brief ?? '' };
  if (notifOpen) renderNotifPanel();
  twistChip.classList.toggle('hidden', !text);
  if (text !== null && twistChip.textContent !== text) twistChip.textContent = text;
  twistChip.dataset['urgent'] = String(urgent);
}

const sideChip = document.getElementById('side-chip')!;
/** The job's side goal on the chip under the twist's (null: none); `lost` greys and strikes it through. */
export function setSide(text: string | null, lost: boolean, brief?: string): void {
  if (text === null) pinnedSide = null;
  else if (brief !== undefined || pinnedSide) pinnedSide = { text, brief: brief ?? pinnedSide?.brief ?? '' };
  if (notifOpen) renderNotifPanel();
  sideChip.classList.toggle('hidden', !text);
  if (text !== null && sideChip.textContent !== text) sideChip.textContent = text;
  sideChip.dataset['lost'] = String(lost);
}

let unitName = 'FILES';
/** What the job's count is called: FILES on a records job, CHARGES, SPECIMEN, VAULT and so on on the others (shared/contracts.ts). The PDA's row too. */
export function setUnitName(name: string): void {
  unitName = name;
  const label = pdaRows.files.children[1];
  if (label) label.textContent = name.charAt(0) + name.slice(1).toLowerCase();
}

/** What the uplink is called on this job: "Uplink" on a records job, "Alarm link" where the job isn't about the files (the PDA's row). */
export function setUplinkName(name: string): void {
  const label = pdaRows.uplink.children[1];
  if (label) label.textContent = name;
}

/** The job's actual win condition — the exit stays locked until `collected` reaches `total` (game.ts, via scene.ts's setExitUnlocked()). */
export function setDocuments(collected: number, total: number): void {
  documentsLabel.textContent = `${unitName} ${collected}/${total}`;
  documentsLabel.classList.toggle('complete', collected >= total);
}

/** The same top-bar counter with its own wording (the bunker's `CLUES 1/3 · DOSSIER 0/1`), `complete` once all of it is done. */
export function setDocumentsText(text: string, complete: boolean): void {
  documentsLabel.textContent = text;
  documentsLabel.classList.toggle('complete', complete);
}

const dangerVignette = document.getElementById('danger-vignette')!;
let dangerBase = 0;

/** The exit level's bar is a health bar: the same number (damage taken, 0 to 100), shown the other way up, full when unhurt, red as it runs low. */
let healthMode = false;
export function setHealthMode(on: boolean): void {
  healthMode = on;
  const caption = document.querySelector('.suspicion-caption');
  if (caption) caption.textContent = on ? 'HEALTH' : 'SUSPICION';
  suspicionFill.classList.toggle('health', on);
}

export function setSuspicion(value: number): void {
  suspicionFill.style.width = `${healthMode ? 100 - value : value}%`;
  suspicionFill.classList.toggle('high', healthMode ? value >= 70 : value >= 70);
  // Edges start reddening past 40% suspicion, strongest near getting caught.
  dangerBase = Math.max(0, Math.min(1, (value - 40) / 60)) * 0.75;
  dangerVignette.style.opacity = String(dangerBase);
}

const alertChip = document.getElementById('alert-chip')!;

/** The rung the building is on (alertstate.ts), as a chip beside the suspicion bar; `null` (and a quiet building) hides it. */
export function setAlertPhase(phase: 'quiet' | 'caution' | 'alert' | 'evasion' | null, label = ''): void {
  const show = phase !== null && phase !== 'quiet';
  alertChip.classList.toggle('hidden', !show);
  if (!show) return;
  alertChip.dataset['phase'] = phase;
  alertChip.textContent = label;
}

/** A sharp red flash at the screen edges (being hit), easing back to the suspicion level. */
export function pulseDanger(): void {
  dangerVignette.classList.add('pulse');
  dangerVignette.style.opacity = '1';
  requestAnimationFrame(() => {
    dangerVignette.classList.remove('pulse');
    dangerVignette.style.opacity = String(dangerBase);
  });
}

const weaponLabel = document.getElementById('weapon-label')!;
const empCount = document.getElementById('emp-count')!;

/** The gun's current pick (FIRE / EMP ×n / NO EMP) and the EMP charges left. */
export function setWeapon(label: string, choice: FireChoice, charges: number): void {
  if (weaponLabel.textContent !== label) weaponLabel.textContent = label;
  weaponLabel.classList.toggle('takedown', choice === 'takedown');
  weaponLabel.classList.toggle('emp', choice === 'emp');
  weaponLabel.classList.toggle('no-emp', choice === 'none');
  const count = `⚡${charges}`;
  if (empCount.textContent !== count) empCount.textContent = count;
  empCount.classList.toggle('empty', charges === 0);
}

const strainBox = document.getElementById('strain')!;
const strainFill = document.getElementById('strain-fill') as HTMLDivElement;

/** The grapple's grip meter (0 to 1 full), with the sweat drop swelling as it runs out; null hides it. */
export function setStrain(v: { fill: number; state: 'fresh' | 'tired' | 'spent' } | null): void {
  strainBox.hidden = v === null;
  if (!v) return;
  const fill = Math.max(0, Math.min(1, v.fill));
  strainBox.style.setProperty('--sweat', String(1 - fill));
  strainFill.style.setProperty('--fill', String(fill));
  strainBox.classList.toggle('tired', v.state !== 'fresh');
}

const camoFill = document.getElementById('camo-fill') as HTMLDivElement;

/** The camo battery: drains while the cloak is on, refills while it's off; dim until it holds enough to start. */
export function setCamoCharge(energy: number, active: boolean, canStart: boolean): void {
  camoFill.style.width = `${Math.max(0, Math.min(1, energy)) * 100}%`;
  camoFill.classList.toggle('active', active);
  camoFill.classList.toggle('ready', !active && canStart);
}

/** `fraction` 0 (just fired) to 1 (fully recharged, ready to fire again). Always visible — see game.html's comment on why this isn't touch-only like the Fire button's own dimming. */
export function setFireCharge(fraction: number): void {
  const ready = fraction >= 1;
  weaponFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  weaponFill.classList.toggle('ready', ready);
  weaponStatus.classList.toggle('charging', !ready);
  const text = ready ? 'READY' : 'RECHARGING';
  if (weaponState.textContent !== text) weaponState.textContent = text;
}

const weaponStatus = document.getElementById('weapon-status')!;
const weaponState = document.getElementById('weapon-state')!;

/** The gun is charged again: the pill flashes once. */
export function flashReady(): void {
  weaponStatus.classList.remove('flash-ready');
  void weaponStatus.offsetWidth;
  weaponStatus.classList.add('flash-ready');
}

/** The trigger was pulled while it was charging: the pill shakes, red. */
export function flashDenied(): void {
  weaponStatus.classList.remove('flash-denied');
  void weaponStatus.offsetWidth;
  weaponStatus.classList.add('flash-denied');
}

const hackStatus = document.getElementById('hack-status')!;
const hackLabel = document.getElementById('hack-label')!;
const hackFill = document.getElementById('hack-fill') as HTMLDivElement;

/** Terminal hack progress; pass null to hide. `paused` dims it while the player is out of range (progress is kept). */
export function setHack(label: string | null, fraction = 0, paused = false): void {
  hackStatus.classList.toggle('hidden', label === null);
  if (label === null) return;
  hackLabel.textContent = `${label} · ${Math.floor(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  hackFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  hackStatus.classList.toggle('paused', paused);
}

// ---- bodies ----

/** A body's visibility meter, at its screen position (CSS pixels). */
export type BodyMeter = { x: number; y: number; pct: number; found: boolean };

const bodyMeters = document.getElementById('body-meters')!;
const meterPool: Array<{ el: HTMLDivElement; fill: HTMLElement; label: HTMLElement; last: string }> = [];

/** Shows a meter over each body in `meters` (every frame; the rest hide). */
export function setBodyMeters(meters: readonly BodyMeter[]): void {
  while (meterPool.length < meters.length) {
    const el = document.createElement('div');
    el.className = 'body-meter';
    el.innerHTML = '<span class="body-meter-cap">Detection</span><span class="body-meter-row"><span class="body-meter-bar"><i></i></span><b></b></span>';
    bodyMeters.appendChild(el);
    meterPool.push({ el, fill: el.querySelector('i')!, label: el.querySelector('b')!, last: '' });
  }
  meterPool.forEach((m, i) => {
    const b = meters[i];
    m.el.hidden = !b;
    if (!b) return;
    m.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -100%)`;
    const key = b.found ? 'found' : String(b.pct);
    if (key === m.last) return;
    m.last = key;
    m.el.dataset.level = b.found ? 'found' : b.pct <= BODY_HIDDEN_PCT ? 'low' : b.pct <= 70 ? 'mid' : 'high';
    m.fill.style.width = `${b.found ? 100 : b.pct}%`;
    m.label.textContent = b.found ? 'Found' : `${b.pct}%`;
  });
}

// ---- PDA ----

/** The heist loop as the PDA shows it. `secondsLeft`: until the queued access logs go out. */
export type PdaState = {
  uplink: 'online' | 'offline' | 'none';
  files: number;
  totalFiles: number;
  logs: 'none' | 'pending' | 'wiped' | 'burned';
  secondsLeft: number;
  /** Logs are queued, but the console stays locked until the last file is in. */
  logsLocked: boolean;
};

type PdaRow = 'done' | 'todo' | 'alert' | 'urgent';
/** A contract's own line in place of the logs row (the fuse, the specimen's warmth, which container): `hide` takes the row away on jobs with no logs. */
export type PdaExtra = { label: string; value: string; state: PdaRow } | 'hide' | null;
let pdaExtra: PdaExtra = null;
export function setPdaExtra(extra: PdaExtra): void {
  const same = JSON.stringify(extra) === JSON.stringify(pdaExtra);
  pdaExtra = extra;
  if (!same) pdaLast = '';
}
const pda = document.getElementById('pda')!;
const pdaRows = {
  uplink: document.getElementById('pda-uplink')!,
  files: document.getElementById('pda-files')!,
  logs: document.getElementById('pda-logs')!,
  exit: document.getElementById('pda-exit')!,
};
const pdaToggle = document.getElementById('pda-toggle')!;
const pdaChip = document.getElementById('pda-chip')!;
const pdaShot = document.getElementById('pda-shot')!;
const pdaShotLabel = document.getElementById('pda-shot-label')!;
let pdaLast = '';
let pdaShotTimer = 0;
const LOGS_URGENT_S = 20;

function setPdaRow(el: HTMLElement, state: PdaRow, value: string): void {
  el.dataset.state = state;
  el.querySelector('b')!.textContent = value;
}

const guideSetting = document.getElementById('help-guide') as HTMLInputElement;

/** Wires the guide's checkbox in the controls sheet (once, at load: the sheet opens from the brief too). */
export function wireGuideSetting(onChange: (on: boolean) => void): void {
  guideSetting.addEventListener('change', () => onChange(guideSetting.checked));
}

const edgesSetting = document.getElementById('help-edges') as HTMLInputElement;

/** Wires the black edges' checkbox in the controls sheet. */
export function wireEdgesSetting(onChange: (on: boolean) => void): void {
  edgesSetting.addEventListener('change', () => onChange(edgesSetting.checked));
}

/** Shows the black edges as on or off in the controls sheet. */
export function setEdgesSetting(on: boolean): void {
  edgesSetting.checked = on;
  // On a phone or tablet the lines cost battery and warmth: said where the choice is made.
  const hint = edgesSetting.parentElement?.querySelector('small');
  if (hint && window.matchMedia('(pointer: coarse)').matches && !hint.dataset.touch) {
    hint.dataset.touch = '1';
    hint.textContent = `${hint.textContent ?? ''} · uses more battery and can warm a phone (it draws lighter lines here)`;
  }
}

/** Shows the guide as on or off in the controls sheet. */
export function setGuideSetting(on: boolean): void {
  guideSetting.checked = on;
}

// On a touch screen the PDA is a small chip until the agent opens it: it opens itself for a few seconds when something changes (a file
// taken, the uplink down, the logs, a new objective), and the button pins it open or minimises it. Desktop keeps the whole panel.
const PDA_OPEN_KEY = 'mazeHeist.pdaOpen';
const PDA_PEEK_MS = 4500;
let pdaPinned = (() => {
  try {
    return window.localStorage.getItem(PDA_OPEN_KEY) === '1';
  } catch {
    return false;
  }
})();
let pdaPeek = 0;
let pdaMeaning = '';
let guideLabel = '';

function applyPda(): void {
  const open = !document.body.classList.contains('touch-ui') || pdaPinned || pdaPeek !== 0;
  pda.classList.toggle('collapsed', !open);
  pdaToggle.setAttribute('aria-expanded', String(open));
  pdaToggle.setAttribute('aria-label', open ? 'Minimise the PDA' : 'Open the PDA');
}

/** Opens the PDA for a few seconds, then minimises it again, unless the agent has pinned it open. */
function peekPda(): void {
  if (pdaPinned) return;
  window.clearTimeout(pdaPeek);
  pdaPeek = window.setTimeout(() => {
    pdaPeek = 0;
    applyPda();
  }, PDA_PEEK_MS);
  applyPda();
}

pdaToggle.addEventListener('click', () => {
  const open = !pda.classList.contains('collapsed');
  window.clearTimeout(pdaPeek);
  pdaPeek = 0;
  pdaPinned = !open;
  try {
    window.localStorage.setItem(PDA_OPEN_KEY, pdaPinned ? '1' : '0');
  } catch {
    // Storage blocked: it forgets next visit.
  }
  applyPda();
});
// The minimised chip opens with a tap anywhere on it.
pda.addEventListener('click', (e) => {
  if (pda.classList.contains('collapsed') && e.target !== pdaToggle) pdaToggle.click();
});

const pdaNext = document.getElementById('pda-next')!;
const pdaGuide = document.getElementById('pda-guide')!;
let guideLast = '';

/** The guide's line on the PDA: where the next objective is and how many cells of corridor away; null when the guide is off. */
export function setGuide(g: { label: string; steps: number | null; locked?: boolean } | null): void {
  const text = g ? `Next · ${g.label}${g.steps !== null ? ` · ${g.steps} ${g.steps === 1 ? 'cell' : 'cells'}` : ''}${g.locked ? ' · past a locked door' : ''}` : '';
  if (text === guideLast) return;
  guideLast = text;
  // A new objective (not just the cells getting fewer) is news.
  const label = g?.label ?? '';
  if (label !== guideLabel) {
    if (label !== '' && guideLabel !== '') peekPda();
    guideLabel = label;
  }
  pdaNext.textContent = text;
  pdaNext.classList.toggle('hidden', g === null);
  pdaGuide.setAttribute('aria-pressed', String(g !== null));
}

/** Wires the PDA's Guide button (once per job, via `signal`). */
export function wireGuide(onToggle: () => void, signal: AbortSignal): void {
  pdaGuide.addEventListener('click', onToggle, { signal });
}

/** Updates the PDA (cheap to call every frame: it only touches the page when something shows differently); null hides it. */
export function setPda(s: PdaState | null): void {
  const clock = `${Math.floor(s ? Math.ceil(s.secondsLeft) / 60 : 0)}:${String(s ? Math.ceil(s.secondsLeft) % 60 : 0).padStart(2, '0')}`;
  const key = s ? `${s.uplink}|${s.files}/${s.totalFiles}|${s.logs}|${s.logs === 'pending' ? clock : ''}|${s.logsLocked}|${JSON.stringify(pdaExtra)}` : '';
  applyPda();
  if (key === pdaLast) return;
  pdaLast = key;
  pda.classList.toggle('hidden', !s);
  if (!s) {
    pdaMeaning = '';
    return;
  }
  setPdaRow(pdaRows.uplink, s.uplink === 'online' ? 'alert' : s.uplink === 'offline' ? 'done' : 'todo', s.uplink === 'online' ? 'Online' : s.uplink === 'offline' ? 'Down' : '—');
  // While the uplink's up the workstations are locked: the files can't be photographed yet.
  const locked = s.uplink === 'online' && s.files < s.totalFiles;
  setPdaRow(pdaRows.files, s.files >= s.totalFiles ? 'done' : locked ? 'alert' : 'todo', locked ? `Locked · ${s.files}/${s.totalFiles}` : `${s.files}/${s.totalFiles}`);
  // Where to go next: the exit lift opens once every file is in, burned or not.
  setPdaRow(pdaRows.exit, s.files >= s.totalFiles ? 'done' : 'todo', s.files >= s.totalFiles ? 'Open' : 'Locked');
  const logs: Record<PdaState['logs'], [PdaRow, string]> = {
    none: ['todo', 'Clean'],
    pending: [s.secondsLeft <= LOGS_URGENT_S ? 'urgent' : 'alert', queuedLogsText(clock, s.logsLocked)],
    wiped: ['done', 'Wiped'],
    burned: ['urgent', 'Sent'],
  };
  const logsLabel = pdaRows.logs.children[1];
  if (pdaExtra === 'hide') pdaRows.logs.classList.add('hidden');
  else pdaRows.logs.classList.remove('hidden');
  if (logsLabel) logsLabel.textContent = pdaExtra && pdaExtra !== 'hide' ? pdaExtra.label : 'Logs';
  if (pdaExtra && pdaExtra !== 'hide') setPdaRow(pdaRows.logs, pdaExtra.state, pdaExtra.value);
  else setPdaRow(pdaRows.logs, ...logs[s.logs]);
  // What the minimised chip says: the files so far, and a dot that is amber while something is up and red when the logs run out.
  pdaChip.textContent = `${s.files}/${s.totalFiles}`;
  const logState = pdaExtra && pdaExtra !== 'hide' ? pdaExtra.state : pdaExtra === 'hide' ? 'todo' : logs[s.logs][0];
  pda.dataset['alert'] = logState === 'urgent' ? 'urgent' : s.uplink === 'online' || logState === 'alert' ? 'alert' : s.files >= s.totalFiles ? 'done' : 'todo';
  // Something new (not the countdown ticking): show it, then minimise again.
  const meaning = `${s.uplink}|${s.files}/${s.totalFiles}|${s.logs}|${logState}|${s.logsLocked}|${pdaExtra && pdaExtra !== 'hide' ? pdaExtra.value.replace(/[0-9:%]/g, '') : ''}`;
  if (pdaMeaning !== '' && meaning !== pdaMeaning) peekPda();
  pdaMeaning = meaning;
}

/** The PDA's camera: a flash, and the photo of what was captured, for a moment. */
export function pdaCapture(files: number): void {
  peekPda();
  pdaShotLabel.textContent = files === 1 ? 'File captured' : `${files} files captured`;
  pdaShot.classList.remove('hidden', 'flash');
  void pdaShot.offsetWidth; // restart the flash
  pdaShot.classList.add('flash');
  window.clearTimeout(pdaShotTimer);
  pdaShotTimer = window.setTimeout(() => pdaShot.classList.add('hidden'), 2400);
}

// The notices at the bottom of the screen come through toasts.ts's queue: a few at a time (fewer on a small screen), the rest in line, none twice, a warning
// ahead of the rest, and a tap on one clears them all.
let toastState: ToastState = EMPTY_TOASTS;
const toastEls = new Map<number, HTMLElement>();
const toastTimers = new Map<number, number>();
const smallScreen = (): boolean => window.matchMedia('(max-width: 620px), (max-height: 480px)').matches;
const sidewaysScreen = (): boolean => window.matchMedia('(max-height: 480px)').matches;
const toastCap = (): number => visibleCap(smallScreen(), sidewaysScreen());

function mountToast(item: ToastItem): void {
  const el = document.createElement('div');
  el.className = `toast ${item.kind}`;
  el.textContent = item.text;
  el.addEventListener('click', dismissToasts);
  toastStack.appendChild(el);
  toastEls.set(item.id, el);
  toastTimers.set(item.id, window.setTimeout(() => expireShownToast(item.id), item.ms));
}

function unmountToast(item: ToastItem): void {
  toastEls.get(item.id)?.remove();
  toastEls.delete(item.id);
  window.clearTimeout(toastTimers.get(item.id));
  toastTimers.delete(item.id);
}

function applyToasts(change: ToastChange): void {
  toastState = change.state;
  for (const item of change.hide) unmountToast(item);
  for (const item of change.show) mountToast(item);
}

function expireShownToast(id: number): void {
  const gone = toastState.shown.find((t) => t.id === id);
  if (gone) unmountToast(gone);
  applyToasts(expireToast(toastState, id, toastCap()));
}

/** A tap on a notice: all of them go, and the ones waiting. */
function dismissToasts(): void {
  applyToasts(clearToastState(toastState));
}

// ---- the inbox: on a small screen the notices are kept behind a bell instead of floating over the view ----
// A warning (a red notice) still flashes up, one line, for a moment; everything else waits in the inbox, counted on the bell. Opening it pauses the job (game.ts asks
// isNotificationsOpen()), and the night's twist and side goal are pinned at its top, since their chips no longer take room on the screen.
const notifBtn = document.getElementById('notif-btn') as HTMLButtonElement;
const notifBadge = document.getElementById('notif-badge')!;
const notifPanel = document.getElementById('notif-panel')!;
const notifBody = document.getElementById('notif-body')!;
let inbox: Inbox = EMPTY_INBOX;
let notifOpen = false;
let pinnedTwist: { text: string; brief: string } | null = null;
let pinnedSide: { text: string; brief: string } | null = null;
const bellHintKey = 'mazeHeist.bellHint';

/** Whether the messages are open (the job is paused while they are). */
export function isNotificationsOpen(): boolean {
  return notifOpen;
}

function renderBell(): void {
  const n = unreadCount(inbox);
  notifBadge.hidden = n === 0;
  notifBadge.textContent = String(n);
  notifBtn.setAttribute('aria-label', n > 0 ? `Messages, ${n} new` : 'Messages');
}

function renderNotifPanel(): void {
  const rows: HTMLElement[] = [];
  const pins = [
    { label: 'Twist', pin: pinnedTwist },
    { label: '', pin: pinnedSide }, // its text already says "Side goal"

  ].filter((p): p is { label: string; pin: { text: string; brief: string } } => p.pin !== null);
  if (pins.length) {
    const head = document.createElement('div');
    head.className = 'notif-section';
    head.textContent = 'Tonight';
    rows.push(head);
    for (const { label, pin } of pins) {
      const row = document.createElement('div');
      row.className = 'notif-pin';
      const t = document.createElement('div');
      t.className = 'notif-pin-title';
      t.textContent = label ? `${label} · ${pin.text}` : pin.text;
      const b = document.createElement('div');
      b.className = 'notif-pin-brief';
      b.textContent = pin.brief;
      row.append(t, b);
      rows.push(row);
    }
  }
  const head = document.createElement('div');
  head.className = 'notif-section';
  head.textContent = 'Messages';
  rows.push(head);
  if (inbox.items.length === 0) {
    const none = document.createElement('div');
    none.className = 'notif-empty';
    none.textContent = 'Nothing yet. New messages come here.';
    rows.push(none);
  }
  const now = window.performance.now();
  for (const item of inbox.items) {
    const row = document.createElement('div');
    row.className = `notif-item ${item.kind}`;
    const text = document.createElement('span');
    text.className = 'notif-text';
    text.textContent = item.text;
    const age = document.createElement('span');
    age.className = 'notif-age';
    age.textContent = ageLabel(now - item.at);
    row.append(text, age);
    rows.push(row);
  }
  notifBody.replaceChildren(...rows);
}

function setNotifOpen(on: boolean): void {
  if (on === notifOpen) return;
  notifOpen = on;
  notifPanel.classList.toggle('hidden', !on);
  notifBtn.setAttribute('aria-expanded', String(on));
  document.body.classList.toggle('notif-open', on);
  if (on) {
    dismissToasts(); // a warning still up goes: the panel has it
    inbox = markAllRead(inbox);
    renderBell();
    renderNotifPanel();
  }
}

notifBtn.addEventListener('click', () => setNotifOpen(!notifOpen));
document.getElementById('notif-close')!.addEventListener('click', () => setNotifOpen(false));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && notifOpen) setNotifOpen(false);
});
// A tap anywhere else puts the messages away.
window.addEventListener('pointerdown', (e) => {
  if (notifOpen && e.target instanceof Node && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) setNotifOpen(false);
});

export function showToast(text: string, kind: 'good' | 'bad' | 'neutral', ms = 2600): void {
  if (!smallScreen()) {
    applyToasts(pushToast(toastState, text, kind, ms, toastCap()));
    return;
  }
  inbox = addToInbox(inbox, text, kind, window.performance.now());
  if (notifOpen) {
    inbox = markAllRead(inbox); // it arrived while they were reading
    renderNotifPanel();
  }
  renderBell();
  notifBtn.classList.remove('ping');
  void notifBtn.offsetWidth; // restart the bell's little ring
  notifBtn.classList.add('ping');
  let told: boolean;
  try {
    told = window.sessionStorage.getItem(bellHintKey) === '1';
    if (!told) window.sessionStorage.setItem(bellHintKey, '1');
  } catch {
    told = true; // no storage: not worth saying every time
  }
  if (!told) applyToasts(pushToast(toastState, 'MESSAGES ARE KEPT UNDER THE BELL · TAP IT TO READ THEM (THE JOB PAUSES)', 'neutral', 4200, toastCap()));
  else if (kind === 'bad' && !notifOpen) applyToasts(pushToast(toastState, text, kind, Math.min(ms, 2600), toastCap()));
}

/** A new job starts clean: nothing left up or waiting from the last one, and an empty inbox. */
export function resetToasts(): void {
  dismissToasts();
  inbox = EMPTY_INBOX;
  pinnedTwist = null;
  pinnedSide = null;
  setNotifOpen(false);
  renderBell();
}

// ---- blueprint ----

const mapCard = document.getElementById('map-card')!;
const mapTabs = document.getElementById('map-tabs')!;
const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const mapJob = document.getElementById('map-job')!;
const mapSheet = document.getElementById('map-sheet')!;
const mapBtn = document.getElementById('map-btn') as HTMLButtonElement;
const musicBtn = document.getElementById('music-btn') as HTMLButtonElement;

/** The soundtrack switch on the blueprint sheet (once per job, via `signal`). */
export function wireMusic(on: boolean, onToggle: () => boolean, signal: AbortSignal): void {
  setMusic(on);
  musicBtn.addEventListener('click', () => setMusic(onToggle()), { signal });
}

/** Keeps the switch in step when N toggles the music. */
export function setMusic(on: boolean): void {
  musicBtn.setAttribute('aria-pressed', String(on));
  musicBtn.setAttribute('aria-label', on ? 'Turn music off' : 'Turn music on');
}
const mapClose = document.getElementById('map-close') as HTMLButtonElement;

/** One floor's sheet; a disabled tab is a floor not reached yet. */
export type MapTab = { name: string; sheet: BlueprintSheet | null };

let mapState: { tabs: MapTab[]; active: number } | null = null;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
let mapView: BlueprintView = { zoom: 1, panX: 0, panY: 0 };

function redrawMap(): void {
  if (!mapState) return;
  const { tabs, active } = mapState;
  const sheet = tabs[active]?.sheet;
  mapSheet.textContent = `${active + 1} of ${tabs.length} · ${tabs[active]?.name ?? ''}`;
  if (sheet) drawBlueprint(mapCanvas, sheet, mapView);
}

/** Zooms by `factor` about a point on the canvas (CSS px), keeping that point still. */
function zoomMapAt(factor: number, px: number, py: number): void {
  const z1 = mapView.zoom;
  const z2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z1 * factor));
  const cx = mapCanvas.clientWidth / 2;
  const cy = mapCanvas.clientHeight / 2;
  mapView = {
    zoom: z2,
    panX: px - cx - ((px - cx - mapView.panX) * z2) / z1,
    panY: py - cy - ((py - cy - mapView.panY) * z2) / z1,
  };
  redrawMap();
}

// Drag to pan, pinch or wheel to zoom.
const mapPointers = new Map<number, { x: number; y: number }>();
const localPoint = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
  const r = mapCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
mapCanvas.addEventListener('pointerdown', (e) => {
  try {
    mapCanvas.setPointerCapture(e.pointerId); // a drag that leaves the sheet keeps panning
  } catch {
    // Capture can be refused (e.g. a pointer that's already gone) — panning still works inside the sheet.
  }
  mapPointers.set(e.pointerId, localPoint(e));
});
mapCanvas.addEventListener('pointermove', (e) => {
  const prev = mapPointers.get(e.pointerId);
  if (!prev) return;
  const next = localPoint(e);
  if (mapPointers.size === 1) {
    mapView = { ...mapView, panX: mapView.panX + next.x - prev.x, panY: mapView.panY + next.y - prev.y };
    mapPointers.set(e.pointerId, next);
    redrawMap();
    return;
  }
  const others = [...mapPointers.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
  const other = others[0];
  if (!other) return;
  const before = Math.hypot(prev.x - other.x, prev.y - other.y);
  const after = Math.hypot(next.x - other.x, next.y - other.y);
  mapPointers.set(e.pointerId, next);
  if (before > 0) zoomMapAt(after / before, (next.x + other.x) / 2, (next.y + other.y) / 2);
});
const dropPointer = (e: PointerEvent): void => {
  mapPointers.delete(e.pointerId);
};
mapCanvas.addEventListener('pointerup', dropPointer);
mapCanvas.addEventListener('pointercancel', dropPointer);
mapCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = localPoint(e);
    zoomMapAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  },
  { passive: false }
);

function renderMapTabs(): void {
  if (!mapState) return;
  mapTabs.replaceChildren(
    ...mapState.tabs.map((tab, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === mapState!.active));
      const num = document.createElement('span');
      num.textContent = `Floor ${i + 1}`;
      const name = document.createElement('span');
      name.className = 'map-tab-name';
      name.textContent = ` · ${tab.name}`;
      b.replaceChildren(num, name);
      b.disabled = tab.sheet === null;
      b.onclick = () => {
        mapState!.active = i;
        mapView = { zoom: 1, panX: 0, panY: 0 };
        renderMapTabs();
        redrawMap();
      };
      return b;
    })
  );
}

window.addEventListener('resize', redrawMap);

/** The map button and the sheet's close button both toggle it (once per job, via `signal`). */
export function wireMap(onToggle: () => void, signal: AbortSignal): void {
  mapBtn.addEventListener('click', onToggle, { signal });
  mapClose.addEventListener('click', onToggle, { signal });
}

/** A mission briefing laid over the blueprint: the level's name and place, its tasks in order, and the one button that begins it (the sheet cannot be closed any other way). */
export type Briefing = { kicker: string; title: string; sub: string; tasks: string[]; begin: string; onBegin: () => void };

const mapBriefing = document.getElementById('map-briefing')!;
const mbBegin = document.getElementById('mb-begin') as HTMLButtonElement;

export function openMap(job: number | string, tabs: MapTab[], active: number, briefing?: Briefing): void {
  mapBriefing.classList.toggle('hidden', !briefing);
  mapCard.classList.toggle('briefing', !!briefing);
  if (briefing) {
    document.getElementById('mb-kicker')!.textContent = briefing.kicker;
    document.getElementById('mb-title')!.textContent = briefing.title;
    document.getElementById('mb-sub')!.textContent = briefing.sub;
    document.getElementById('mb-tasks')!.replaceChildren(
      ...briefing.tasks.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      })
    );
    mbBegin.textContent = briefing.begin;
    mbBegin.onclick = briefing.onBegin;
  }
  mapState = { tabs, active };
  mapView = { zoom: 1, panX: 0, panY: 0 };
  mapJob.textContent = job === 'training' ? 'Training' : String(job);
  mapCard.classList.remove('hidden');
  document.body.classList.add('modal-open', 'map-open');
  renderMapTabs();
  redrawMap();
  (briefing ? mbBegin : mapClose).focus();
}

export function closeMap(): void {
  mapState = null;
  mapBriefing.classList.add('hidden');
  mapCard.classList.remove('briefing');
  mapCard.classList.add('hidden');
  document.body.classList.remove('modal-open', 'map-open');
  refocusGame();
}

// ---- end-of-job report ----

const reportCard = document.getElementById('report-card')!;
const reportKicker = document.getElementById('report-kicker')!;
const reportTitle = document.getElementById('report-title')!;
const reportStamp = document.getElementById('report-stamp')!;
const reportGrade = document.getElementById('report-grade')!;
const reportStampLabel = document.getElementById('report-stamp-label')!;
const reportNote = document.getElementById('report-note')!;
const reportStats = document.getElementById('report-stats')!;
const reportPoints = document.getElementById('report-points')!;
const reportBoard = document.getElementById('report-board')!;
const reportBoardList = document.getElementById('report-board-list')!;
const reportBoardNote = document.getElementById('report-board-note')!;
const reportContinue = document.getElementById('report-continue') as HTMLButtonElement;
const reportSecondary = document.getElementById('report-secondary') as HTMLButtonElement;
const reportBoardTitle = document.getElementById('report-board-title')!;
const reportShare = document.getElementById('report-share')!;
const reportShareText = document.getElementById('report-share-text')!;
const reportShareBtn = document.getElementById('report-share-btn') as HTMLButtonElement;

/** One line of fallout: a consequence or a carry-over, good, bad or just so. */
export type FalloutLine = { tone: 'good' | 'bad' | 'neutral'; text: string };

/** The case's part of the report: what the mission did to it, and what the next one carries in. */
export type FalloutView = {
  title: string;
  lines: FalloutLine[];
  nextTitle: string;
  next: FalloutLine[];
};

/** The community's case for the week, as a bar with a notch for each tier. */
export type CaseMeterView = {
  /** 0–1 along the bar. */
  fill: number;
  ticks: Array<{ at: number; name: string; reached: boolean }>;
  caption: string;
};

export type ReportView = {
  kicker: string;
  title: string;
  /** One line under the title — how the job ended. */
  note: string;
  /** null for a failed job — the stamp reads FAILED instead of a grade. */
  grade: Grade | null;
  /** Overrides the grade stamp — training ends with a pass, not a grade. */
  stamp?: { text: string; label: string };
  rows: Array<[label: string, value: string]>;
  /** "+ 420 HEIST POINTS", or null when there are none (a failed job). */
  points: string | null;
  continueLabel: string;
  onContinue: () => void;
  /** Shows the "how did that job feel?" buttons; called with the pick. */
  feel?: ((f: Feel) => void) | undefined;
  /** A second way on, under the first (a daily run's "Replay for practice"). */
  secondary?: { label: string; onClick: () => void };
  /** A daily run's share line, with a Copy button. */
  share?: string;
  /** The board's heading: "Leaderboard" unless said otherwise. */
  boardTitle?: string;
  /** What the mission did to the run, and what the next one carries in. */
  fallout?: FalloutView;
};

const communityBox = document.getElementById('report-community')!;
const communityText = document.getElementById('community-line')!;
const communityList = document.getElementById('community-list')!;
const briefCommunity = document.getElementById('brief-community')!;

/** The community's progress under the leaderboard: the funnel in a line, and the furthest along (null hides it). */
export function setReportCommunity(c: Community | null): void {
  communityBox.hidden = c === null;
  if (!c) return;
  communityText.textContent = c.cleared === 0 ? `${communityLine(c)}. Be the first.` : `${communityLine(c)}.`;
  communityList.replaceChildren(
    ...c.top.map((t) => {
      const li = document.createElement('li');
      li.className = c.you?.rank === t.rank ? 'you' : '';
      const name = document.createElement('span');
      name.textContent = `${t.rank}. ${t.username}`;
      const job = document.createElement('b');
      job.textContent = `Job ${t.job} cleared`;
      li.append(name, job);
      return li;
    })
  );
  if (c.you && c.you.rank > c.top.length) {
    const li = document.createElement('li');
    li.className = 'you';
    const name = document.createElement('span');
    name.textContent = `${c.you.rank}. You`;
    const job = document.createElement('b');
    job.textContent = `Job ${c.you.job} cleared`;
    li.append(name, job);
    communityList.append(li);
  }
}

/** The line on the brief about who's played here (null hides it). */
export function setBriefCommunity(c: Community | null): void {
  briefCommunity.hidden = c === null || c.played === 0;
  if (c) briefCommunity.textContent = communityLine(c);
}

const falloutBox = document.getElementById('report-fallout')!;
const feelBox = document.getElementById('report-feel')!;
const feelQuestion = document.getElementById('report-feel-q')!;
const feelButtons = feelBox.querySelectorAll<HTMLButtonElement>('button[data-feel]');
const falloutTitle = document.getElementById('fallout-title')!;
const falloutLines = document.getElementById('fallout-lines')!;
const falloutNextTitle = document.getElementById('fallout-next-title')!;
const falloutNext = document.getElementById('fallout-next')!;
const caseMeter = document.getElementById('case-meter')!;
const caseBar = document.getElementById('case-bar')!;
const caseFill = document.getElementById('case-fill') as HTMLElement;
const caseCaption = document.getElementById('case-caption')!;

const fallLine = (l: FalloutLine): HTMLLIElement => {
  const li = document.createElement('li');
  li.dataset.tone = l.tone;
  li.textContent = l.text;
  return li;
};

/** The community's case meter on the report (null hides it: nothing heard from the server). */
export function setReportCase(v: CaseMeterView | null): void {
  caseMeter.hidden = v === null;
  if (!v) return;
  caseFill.style.width = `${Math.round(v.fill * 100)}%`;
  for (const old of caseBar.querySelectorAll('.case-tick')) old.remove();
  for (const t of v.ticks) {
    const tick = document.createElement('span');
    tick.className = `case-tick${t.reached ? ' reached' : ''}`;
    tick.style.left = `${Math.round(t.at * 100)}%`;
    tick.title = t.name;
    tick.innerHTML = '<b></b>';
    tick.firstElementChild!.textContent = t.name;
    caseBar.append(tick);
  }
  caseCaption.textContent = v.caption;
}

export function showReport(v: ReportView): void {
  reportKicker.textContent = v.kicker;
  reportTitle.textContent = v.title;
  reportNote.textContent = v.note;
  reportCard.classList.toggle('failed', v.grade === null && !v.stamp);
  reportStamp.dataset.grade = v.stamp ? 'pass' : (v.grade ?? 'fail');
  reportGrade.textContent = v.stamp?.text ?? v.grade ?? 'Failed';
  reportStampLabel.textContent = v.stamp?.label ?? (v.grade ? 'Stealth' : 'Job');
  reportStats.replaceChildren(
    ...v.rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    })
  );
  reportPoints.textContent = v.points ?? '';
  feelBox.hidden = !v.feel;
  feelQuestion.textContent = 'How did that job feel?';
  for (const b of feelButtons) {
    b.hidden = false;
    b.onclick = () => {
      v.feel?.(b.dataset['feel'] as Feel);
      for (const other of feelButtons) other.hidden = true;
      feelQuestion.textContent = 'Thanks, noted.';
    };
  }
  falloutBox.hidden = !v.fallout;
  caseMeter.hidden = true;
  if (v.fallout) {
    falloutTitle.textContent = v.fallout.title;
    falloutLines.replaceChildren(...v.fallout.lines.map(fallLine));
    falloutNextTitle.textContent = v.fallout.nextTitle;
    falloutNext.replaceChildren(...(v.fallout.next.length ? v.fallout.next : [{ tone: 'neutral' as const, text: 'Nothing carries over.' }]).map(fallLine));
  }
  reportBoardTitle.textContent = v.boardTitle ?? 'Leaderboard';
  setReportLeaderboard(null, 'Loading leaderboard…');
  reportShare.hidden = !v.share;
  reportShareText.textContent = v.share ?? '';
  reportShareBtn.textContent = 'Copy';
  reportShareBtn.onclick = () => {
    const text = v.share ?? '';
    const copied = (): void => {
      reportShareBtn.textContent = 'Copied';
    };
    // Some embeds don't allow the clipboard: the line is selectable text, so select it for a manual copy.
    const selectIt = (): void => {
      const range = document.createRange();
      range.selectNodeContents(reportShareText);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      reportShareBtn.textContent = 'Selected · copy it';
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(copied, selectIt);
    else selectIt();
  };
  reportSecondary.hidden = !v.secondary;
  reportSecondary.textContent = v.secondary?.label ?? '';
  reportSecondary.onclick = () => {
    reportCard.classList.add('hidden');
    document.body.classList.remove('modal-open');
    v.secondary?.onClick();
  };
  reportContinue.textContent = v.continueLabel;
  reportContinue.onclick = () => {
    reportCard.classList.add('hidden');
    document.body.classList.remove('modal-open');
    v.onContinue();
  };
  reportCard.classList.remove('hidden');
  document.body.classList.add('modal-open');
  reportCard.scrollTop = 0;
  reportContinue.focus({ preventScroll: true }); // on a short screen, open at the title and grade, not scrolled to the button
}

/** Fills in the board once it loads; `board` null with no note hides the section (offline). */
export function setReportLeaderboard(board: Leaderboard | null, note: string): void {
  reportBoard.classList.toggle('hidden', board === null && note === '');
  reportBoardNote.textContent = note;
  reportBoardList.replaceChildren(
    ...(board?.top ?? []).map((e) => {
      const li = document.createElement('li');
      li.classList.toggle('you', board?.you?.rank === e.rank);
      const cells = [`${e.rank}.`, e.username, `J${e.job} ${e.grade}`, String(e.points)];
      li.replaceChildren(
        ...cells.map((text, i) => {
          const span = document.createElement('span');
          span.textContent = text;
          if (i !== 1) span.className = 'num';
          return span;
        })
      );
      return li;
    })
  );
}

const lockerView = document.getElementById('locker-view')!;

/** Peering out of a staff locker's vent slats while hiding in one. */
export function setLockerView(on: boolean): void {
  lockerView.classList.toggle('on', on);
}

const fadeScreen = document.getElementById('fade-screen')!;

/** Fades the scene to black (the lift ride between jobs) or back in. */
export function setFade(on: boolean): void {
  fadeScreen.classList.toggle('on', on);
}

const SPOTTED_BANNER_MS = 1300;

/** A brief, full-screen dramatic flash of text — the "you've been spotted" beat, before the end card takes over. */
export function showSpottedBanner(text: string): void {
  spottedBanner.textContent = text;
  spottedBanner.classList.remove('hidden');
  window.setTimeout(() => spottedBanner.classList.add('hidden'), SPOTTED_BANNER_MS);
}

/** Shown once, before Job 1 starts — content is static in game.html, this wires its two buttons: the job, or training. */
/** Today's Daily Heist, as the brief shows it. */
export type DailyBrief = {
  number: number;
  /** Tonight's operation, one line: "Operation Lantern: Freight". */
  operation: string;
  level: number;
  status: DailyStatus;
  loggedIn: boolean;
  /** The scored run, once it's in. */
  result: { cleared: boolean; grade: Grade | null } | null;
  /** Place on today's board, if cleared. */
  rank: number | null;
  players: number;
  streak: StreakInfo | null;
  /** The week's case, as the community stands: "Case #2: 112 pages from 14 agents · Indicted...". */
  caseLine?: string;
};

export type BriefOptions = {
  trained: boolean;
  /** The agent has been through the opening already (its cutscene, or a job): the welcome letter for a new agent is not shown again. */
  welcomed: boolean;
  /** Null until the server answers (and for good, offline). */
  daily: DailyBrief | null;
  onDaily: () => void;
  /** The agent picked last time (or the default). */
  agent: Body;
  /** The look picked last time (or the default), and the looks to offer: a label and, for the armour, its colours. */
  look: Look;
  looks: ReadonlyArray<{ id: Look; label: string; colours: { suit: number; armour: number; trim: number } | null }>;
  onLook: (look: Look) => void;
  /** The operative's suit colour and hair, picked last time (or the defaults), and the ones to offer. */
  style: { suit: SuitColour; hair: Hairstyle };
  suits: ReadonlyArray<{ id: SuitColour; label: string; colour: number }>;
  hairstyles: ReadonlyArray<{ id: Hairstyle; label: string }>;
  onStyle: (style: { suit: SuitColour; hair: Hairstyle }) => void;
  /** The job to offer as "Continue" (the one after the furthest cleared), or null for none. */
  continueJob: number | null;
  onAgent: (agent: Body) => void;
  /** Whether the AI partner comes along on story jobs, and what changing it does. */
  coopAi: boolean;
  onCoopAi: (on: boolean) => void;
  onBegin: () => void;
  onTrain: () => void;
  /** The training courses, as the Training menu lists them (read each time it opens, so what is done is up to date), and what picking one does. */
  trainingCourses: () => TrainingCourse[];
  onTrainCourse: (id: string) => void;
  onContinue: (job: number) => void;
};

/** One training course on the Training menu. */
export type TrainingCourse = { id: string; title: string; blurb: string; done: boolean };

/** Refreshes the brief once saved progress arrives from the server (it opens before that). */
export type BriefUpdate = (changes: Partial<Pick<BriefOptions, 'trained' | 'welcomed' | 'agent' | 'look' | 'style' | 'continueJob' | 'daily'>>) => void;

function renderDaily(d: DailyBrief | null, trained: boolean): void {
  briefDaily.hidden = d === null;
  if (!d) return;
  // The card (who's played, the streak, the case) sits below the agent pick; its button is with the others, at the foot.
  agentSection.after(briefDaily);
  briefDailyNote.hidden = trained;
  briefDailyNote.textContent = d.level >= 6 ? `Tonight's is job ${d.level}, a tough one. Train first, and come back for it.` : 'Train first, and come back for it.';
  briefDailyCase.hidden = !d.caseLine;
  briefDailyCase.textContent = d.caseLine ?? '';
  briefDailyName.textContent = `Daily Heist #${d.number}`;
  briefDailyJob.textContent = `Job ${d.level}`;
  briefDailyOp.textContent = d.operation;
  const played = `${d.players} played today`;
  if (!d.loggedIn) {
    briefDailyStatus.textContent = 'Log in to Reddit to play it for a score. You can still play it for practice.';
    briefDailyBtn.textContent = `Today’s challenge · practice`;
  } else if (d.status === 'new') {
    briefDailyStatus.textContent = `One scored attempt, and it counts from the moment you start. ${played}.`;
    briefDailyBtn.textContent = `Today’s challenge · Daily #${d.number}`;
  } else {
    briefDailyStatus.textContent = d.result
      ? d.result.cleared
        ? `Done: grade ${d.result.grade}${d.rank ? `, #${d.rank} of ${d.players}` : ''} today. Replays are practice.`
        : `Done: caught this time. ${played}. Replays are practice.`
      : `Today's scored attempt is used up. Replays are practice.`;
    briefDailyBtn.textContent = 'Replay today’s challenge (practice)';
  }
  const streak = d.streak;
  briefDailyStreak.hidden = !streak || streak.count < 1;
  if (streak) briefDailyStreak.textContent = `${streak.count}-day streak${streak.best > streak.count ? ` · best ${streak.best}` : ''}${streak.playedToday ? '' : ' · play today to keep it'}`;
}

const agentCards = [...document.querySelectorAll<HTMLButtonElement>('.agent-card')];

/** Puts a rendered portrait (portrait.ts) on each agent's card. */
const agentPick = document.querySelector('.agent-pick')!;
const lookStatus = document.getElementById('look-status')!;

/**
 * Shows the agents' portraits as loading (a spinner over each, dimmed) while the models for a look that isn't
 * ready yet come in: without it, tapping Operative looks like it did nothing. Off once they're drawn.
 */
export function setAgentPortraitsLoading(on: boolean): void {
  agentPick.classList.toggle('loading', on);
  agentPick.setAttribute('aria-busy', String(on));
  lookStatus.hidden = !on;
}

export function setAgentPortraits(portraits: Partial<Record<Body, string>>): void {
  for (const card of agentCards) {
    const url = portraits[card.dataset.agent as Body];
    const img = card.querySelector('img')!;
    if (!url) continue;
    img.src = url;
    img.classList.add('ready');
  }
}

const lookPick = document.getElementById('look-pick')!;
const coopToggle = document.getElementById('coop-toggle') as HTMLInputElement;
const coopNote = document.getElementById('coop-toggle-note')!;
const stylePick = document.getElementById('style-pick')!;
const suitPick = document.getElementById('suit-pick')!;
const hairPick = document.getElementById('hair-pick')!;

/** A row of radio chips: one per option, a swatch in front when it has a colour. */
function chipRow<T extends string>(
  row: HTMLElement,
  options: ReadonlyArray<{ id: T; label: string; swatch?: HTMLElement }>,
  onPick: (id: T) => void
): (chosen: T) => void {
  const chips = options.map((o) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'look-chip';
    chip.setAttribute('role', 'radio');
    chip.dataset.id = o.id;
    if (o.swatch) chip.append(o.swatch);
    chip.append(o.label);
    chip.onclick = () => onPick(o.id);
    return chip;
  });
  row.replaceChildren(...chips);
  return (chosen) => {
    for (const chip of chips) chip.setAttribute('aria-checked', String(chip.dataset.id === chosen));
  };
}

export function showMissionBrief(options: BriefOptions): BriefUpdate {
  const state = { trained: options.trained, welcomed: options.welcomed, agent: options.agent, look: options.look, style: options.style, continueJob: options.continueJob, daily: options.daily };
  const pick = (chosen: Body): void => {
    for (const card of agentCards) card.setAttribute('aria-checked', String(card.dataset.agent === chosen));
    // The partner is the other one of the two.
    coopNote.textContent = `${chosen === 'male' ? 'Agent B' : 'Agent A'} comes out of the lift with you, follows, covers and shoots; the lift takes you both. Not on the scored Daily, nor in training.`;
  };
  coopToggle.checked = options.coopAi;
  coopToggle.onchange = () => options.onCoopAi(coopToggle.checked);
  const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
  const chips = options.looks.map((l) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'look-chip';
    chip.setAttribute('role', 'radio');
    chip.dataset.look = l.id;
    const swatch = document.createElement('span');
    swatch.className = l.colours ? 'look-swatch' : 'look-swatch classic';
    if (l.colours) {
      swatch.style.setProperty('--suit', hex(l.colours.suit));
      swatch.style.setProperty('--armour', hex(l.colours.armour));
      swatch.style.setProperty('--trim', hex(l.colours.trim));
    }
    chip.append(swatch, l.label);
    chip.onclick = () => {
      state.look = l.id;
      pickLook(l.id);
      options.onLook(l.id);
    };
    return chip;
  });
  lookPick.replaceChildren(...chips);
  const pickLook = (chosen: Look): void => {
    for (const chip of chips) chip.setAttribute('aria-checked', String(chip.dataset.look === chosen));
    stylePick.hidden = chosen === 'classic';
  };
  const suitSwatch = (colour: number): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'look-swatch suit';
    s.style.setProperty('--suit', hex(colour));
    return s;
  };
  const pickSuit = chipRow(
    suitPick,
    options.suits.map((s) => ({ id: s.id, label: s.label, swatch: suitSwatch(s.colour) })),
    (suit) => {
      state.style = { ...state.style, suit };
      pickSuit(suit);
      options.onStyle(state.style);
    }
  );
  const pickHair = chipRow(hairPick, options.hairstyles, (hair) => {
    state.style = { ...state.style, hair };
    pickHair(hair);
    options.onStyle(state.style);
  });
  for (const card of agentCards) {
    card.onclick = () => {
      const chosen = card.dataset.agent as Body;
      state.agent = chosen;
      pick(chosen);
      options.onAgent(chosen);
    };
  }
  // The buttons, always in this order: training, then the campaign (resume it, or begin it), then today's challenge.
  // A new agent is led to training; once it's done, the campaign leads, and training moves to the foot as a replay.
  const render = (): void => {
    pick(state.agent);
    pickLook(state.look);
    pickSuit(state.style.suit);
    pickHair(state.style.hair);
    renderDaily(state.daily, state.trained);
    briefWelcome.hidden = state.trained || state.welcomed || state.continueJob !== null;
    const cont = state.continueJob;
    const trained = state.trained;
    briefContinue.hidden = cont === null;
    if (cont !== null) briefContinue.textContent = `Resume campaign · Job ${cont}`;
    briefTrain.textContent = trained ? 'Training' : 'Start training (recommended)';
    trainingLink.hidden = trained;
    briefDailyBtn.hidden = state.daily === null;
    let lead: HTMLButtonElement;
    let order: HTMLButtonElement[];
    if (!trained) {
      // A new agent: training, then the campaign if there's one to resume, then today's challenge; skipping is a small link.
      briefBegin.textContent = 'Skip training, start at Job 1';
      lead = briefTrain;
      order = [briefTrain, briefContinue, briefDailyBtn, briefBegin];
    } else if (cont !== null) {
      briefBegin.textContent = 'Start over from Job 1';
      lead = briefContinue;
      order = [briefContinue, briefDailyBtn, briefTrain, briefBegin];
    } else {
      briefBegin.textContent = 'Begin campaign · Job 1';
      lead = briefBegin;
      order = [briefBegin, briefDailyBtn, briefTrain];
    }
    for (const b of order) b.className = b === lead ? 'btn btn-primary' : 'btn btn-secondary';
    if (briefBegin !== lead) briefBegin.className = 'brief-link';
    briefTrain.parentElement!.append(...order, trainingLink);
  };
  render();
  briefCard.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const close = (then: () => void) => () => {
    briefCard.classList.add('hidden');
    document.body.classList.remove('modal-open');
    then();
  };
  briefBegin.onclick = close(options.onBegin);
  briefManual.onclick = () => {
    helpFromBrief = true;
    showControls(true, 'manual', false);
  };
  briefDailyBtn.onclick = close(options.onDaily);
  // A new agent's Training button goes straight to the first course; once it's done the button opens the menu of all of them (the link does for a new agent who wants one).
  const openTraining = (): void => {
    const rows = options.trainingCourses().map((c) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = c.done ? 'training-row done' : 'training-row';
      const head = document.createElement('span');
      head.className = 'training-row-head';
      const name = document.createElement('span');
      name.className = 'training-row-title';
      name.textContent = c.title;
      const tag = document.createElement('span');
      tag.className = 'training-row-tag';
      tag.textContent = c.done ? 'Done' : '';
      head.append(name, tag);
      const blurb = document.createElement('span');
      blurb.className = 'training-row-blurb';
      blurb.textContent = c.blurb;
      row.append(head, blurb);
      row.onclick = () => {
        trainingCard.classList.add('hidden');
        document.body.classList.remove('modal-open');
        options.onTrainCourse(c.id);
      };
      return row;
    });
    trainingList.replaceChildren(...rows);
    briefCard.classList.add('hidden');
    trainingCard.classList.remove('hidden');
  };
  trainingBack.onclick = () => {
    trainingCard.classList.add('hidden');
    briefCard.classList.remove('hidden');
  };
  trainingLink.onclick = openTraining;
  briefTrain.onclick = () => (state.trained ? openTraining() : close(options.onTrain)());
  briefContinue.onclick = close(() => {
    if (state.continueJob !== null) options.onContinue(state.continueJob);
  });
  return (changes) => {
    Object.assign(state, changes);
    render();
  };
}

// ---- the handler's messages (shared/story.ts) ----

const dossier = document.getElementById('dossier')!;
const dossierKicker = document.getElementById('dossier-kicker')!;
const dossierGreeting = document.getElementById('dossier-greeting')!;
const dossierBody = document.getElementById('dossier-body')!;
const dossierParams = document.getElementById('dossier-params')!;
const dossierParamsTitle = document.getElementById('dossier-params-title')!;
const dossierClosing = document.getElementById('dossier-closing')!;
const dossierCase = document.getElementById('dossier-case')!;
const dossierNotes = document.getElementById('dossier-notes')!;
const dossierPrimary = document.getElementById('dossier-primary') as HTMLButtonElement;
const dossierSecondary = document.getElementById('dossier-secondary') as HTMLButtonElement;

export type DossierLetter = {
  kicker: string;
  greeting: string;
  paragraphs: string[];
  /** `met` marks a parameter in a debrief; left out in a briefing. */
  parameters: Array<{ text: string; met?: boolean }>;
  /** What the list is called; "Mission parameters" if left out. A letter with no list has no title either. */
  parametersTitle?: string;
  /** Notes that change the rules for this job (a twist, the laser gates), each in a box of its own. */
  notes?: Array<{ title: string; text: string }>;
  closing: string;
};

/** Shows the brief's letter, with a button (or two) to go on. Either button closes it first. */
export function showDossier(letter: DossierLetter, primary: { label: string; onClick: () => void }, secondary?: { label: string; onClick: () => void }): void {
  dossierKicker.textContent = letter.kicker;
  dossierGreeting.textContent = letter.greeting;
  dossierBody.replaceChildren(
    ...letter.paragraphs.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    })
  );
  dossierNotes.replaceChildren(
    ...(letter.notes ?? []).map((note) => {
      const box = document.createElement('div');
      box.className = 'dossier-note';
      const label = document.createElement('div');
      label.className = 'dossier-note-label';
      label.textContent = `Note from Control · ${note.title}`;
      const p = document.createElement('p');
      p.textContent = note.text;
      box.append(label, p);
      return box;
    })
  );
  dossierNotes.hidden = !letter.notes?.length;
  dossierParams.replaceChildren(
    ...letter.parameters.map((param) => {
      const li = document.createElement('li');
      li.textContent = param.text;
      if (param.met !== undefined) li.className = param.met ? 'met' : 'missed';
      return li;
    })
  );
  dossierParamsTitle.textContent = letter.parametersTitle ?? 'Mission parameters';
  dossierParamsTitle.hidden = letter.parameters.length === 0;
  dossierClosing.textContent = letter.closing;
  setDossierCase(null);
  setDossierEntries(null);
  setDossierCoop(null);
  const close = (then: () => void) => () => {
    dossier.classList.add('hidden');
    if (reportCard.classList.contains('hidden')) document.body.classList.remove('modal-open');
    then();
  };
  dossierPrimary.textContent = primary.label;
  dossierPrimary.onclick = close(primary.onClick);
  dossierSecondary.hidden = !secondary;
  dossierSecondary.textContent = secondary?.label ?? '';
  dossierSecondary.onclick = secondary ? close(secondary.onClick) : null;
  dossier.classList.remove('hidden');
  document.body.classList.add('modal-open');
  dossier.scrollTop = 0;
  dossierPrimary.focus({ preventScroll: true });
}

/** Takes the letter down without either button (Escape, mid-job). */
export function closeDossier(): void {
  if (dossier.classList.contains('hidden')) return;
  dossier.classList.add('hidden');
  if (reportCard.classList.contains('hidden')) document.body.classList.remove('modal-open');
}

/** The PDA's message button: the letter for this job, read again. */
export function wirePdaMessage(onOpen: () => void, signal: AbortSignal): void {
  document.getElementById('pda-msg')!.addEventListener('click', onOpen, { signal });
}

// ---- recon: the fly-over of the objectives and the way out ----

const tourEl = document.getElementById('tour')!;
const tourKicker = document.getElementById('tour-kicker')!;
const tourTitle = document.getElementById('tour-title')!;
const tourText = document.getElementById('tour-text')!;
const tourPin = document.getElementById('tour-pin')!;
const tourPinLabel = document.getElementById('tour-pin-label')!;
const tourNext = document.getElementById('tour-next')!;

/** What the caption shows: the stop (`step` of `total`), and where on screen its marker goes (null while flying). */
export type TourView = { step: number; total: number; kind: string; title: string; text: string; last: boolean; pin: { x: number; y: number } | null };

export function hideTour(): void {
  document.body.classList.remove('touring');
  tourEl.classList.add('hidden');
}

/** Shows the recon's letterbox and caption (cheap to call every frame). */
export function setTour(v: TourView): void {
  document.body.classList.add('touring');
  tourEl.classList.remove('hidden');
  const kicker = `Recon · ${v.step} of ${v.total}`;
  if (tourKicker.textContent !== kicker) tourKicker.textContent = kicker;
  if (tourTitle.textContent !== v.title) tourTitle.textContent = v.title;
  if (tourText.textContent !== v.text) tourText.textContent = v.text;
  const next = v.last ? 'Done' : 'Next';
  if (tourNext.textContent !== next) tourNext.textContent = next;
  tourEl.dataset.kind = v.kind;
  tourPin.classList.toggle('hidden', v.pin === null);
  if (v.pin) {
    tourPin.style.transform = `translate(${v.pin.x.toFixed(1)}px, ${v.pin.y.toFixed(1)}px)`;
    if (tourPinLabel.textContent !== v.title) tourPinLabel.textContent = v.title;
  }
}

/**
 * Next (its button, or a tap anywhere else) goes on to the next stop; Skip ends the recon; the PDA's Recon
 * button starts it again.
 */
export function wireTour(onNext: () => void, onSkip: () => void, onStart: () => void, signal: AbortSignal): void {
  const press = (el: Element, go: () => void): void =>
    el.addEventListener('pointerdown', (e) => (e.preventDefault(), e.stopPropagation(), go()), { signal });
  tourEl.addEventListener('pointerdown', (e) => (e.preventDefault(), onNext()), { signal });
  press(tourNext, onNext);
  press(document.getElementById('tour-skip')!, onSkip);
  document.getElementById('pda-recon')!.addEventListener('click', onStart, { signal });
}

// ---- the way in, picked on the letter ----

const dossierEntries = document.getElementById('dossier-entries')!;
const dossierEntryList = document.getElementById('dossier-entry-list')!;
let dossierEntry: string | null = null;

export type EntryOption = { id: string; title: string; blurb: string };

/** Offers a choice of ways in on the letter, `selected` picked; null (or a single option) shows none. */
export function setDossierEntries(options: readonly EntryOption[] | null, selected?: string): void {
  dossierEntry = options?.some((o) => o.id === selected) ? selected! : (options?.[0]?.id ?? null);
  dossierEntries.hidden = !options || options.length < 2;
  if (dossierEntries.hidden || !options) return;
  const buttons = options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dossier-entry';
    b.setAttribute('role', 'radio');
    const title = document.createElement('span');
    title.className = 'dossier-entry-title';
    title.textContent = o.title;
    const blurb = document.createElement('span');
    blurb.className = 'dossier-entry-blurb';
    blurb.textContent = o.blurb;
    b.append(title, blurb);
    b.onclick = () => {
      dossierEntry = o.id;
      for (const other of buttons) other.setAttribute('aria-checked', String(other === b));
    };
    b.setAttribute('aria-checked', String(o.id === dossierEntry));
    return b;
  });
  dossierEntryList.replaceChildren(...buttons);
}

const dossierCoop = document.getElementById('dossier-coop')!;
const dossierCoopToggle = document.getElementById('dossier-coop-toggle') as HTMLInputElement;
const dossierCoopNote = document.getElementById('dossier-coop-note')!;

/** Offers the AI partner on the letter (for this job, and kept for the next), `on` as it is now; null hides it. */
export function setDossierCoop(options: { on: boolean; note: string; onChange: (on: boolean) => void } | null): void {
  dossierCoop.hidden = options === null;
  if (!options) return;
  dossierCoopToggle.checked = options.on;
  dossierCoopNote.textContent = options.note;
  dossierCoopToggle.onchange = () => options.onChange(dossierCoopToggle.checked);
}

/** The way in picked on the letter. */
export function chosenEntry(): string | null {
  return dossierEntry;
}

// ---- abandoning a job, from the pause sheet ----

const helpAbandon = document.getElementById('help-abandon') as HTMLButtonElement;
const ABANDON_CONFIRM_MS = 3000;

/** Wires the pause sheet's Abandon button: a first tap asks, a second within a few seconds abandons. */
export function wireAbandon(label: string, onAbandon: () => void, signal: AbortSignal): void {
  let armed = 0;
  helpAbandon.textContent = label;
  helpAbandon.classList.remove('armed');
  const reset = (): void => {
    armed = 0;
    helpAbandon.textContent = label;
    helpAbandon.classList.remove('armed');
  };
  helpAbandon.addEventListener(
    'click',
    () => {
      if (armed) {
        window.clearTimeout(armed);
        reset();
        onAbandon();
        return;
      }
      helpAbandon.textContent = 'Tap again to confirm';
      helpAbandon.classList.add('armed');
      armed = window.setTimeout(reset, ABANDON_CONFIRM_MS);
    },
    { signal }
  );
  signal.addEventListener('abort', () => {
    window.clearTimeout(armed);
    reset();
  });
}

/** The line about the run so far at the foot of the letter; null hides it. */
export function setDossierCase(text: string | null): void {
  dossierCase.hidden = text === null;
  dossierCase.textContent = text ?? '';
}

/** Puts the mission brief away without its buttons (a job started some other way). */
export function closeMissionBrief(): void {
  briefCard.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

/** Puts the mission brief back up (the player turned a briefing down). */
export function reopenMissionBrief(): void {
  briefCard.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

// ---- file pages (shared/memories.ts) ----

let memoryCard: HTMLDivElement | null = null;
let memoryTimer = 0;

/** A file page turns up in a capture: a small card at the side of the screen that fades after a few seconds, and never blocks play. */
export function showMemory(text: string, page: number, total: number): void {
  memoryCard?.remove();
  window.clearTimeout(memoryTimer);
  const card = document.createElement('div');
  card.className = 'memory-card';
  card.setAttribute('role', 'status');
  const kicker = document.createElement('div');
  kicker.className = 'memory-kicker';
  kicker.textContent = `From the file · ${page} of ${total}`;
  const body = document.createElement('p');
  body.textContent = text;
  card.append(kicker, body);
  (document.querySelector('.overlay') ?? document.body).appendChild(card);
  memoryCard = card;
  requestAnimationFrame(() => card.classList.add('on'));
  memoryTimer = window.setTimeout(() => {
    card.classList.remove('on');
    window.setTimeout(() => card.remove(), 900);
  }, 8000);
}

/** A page of a captured file, read with the job paused under it (game.ts). */
export type ReaderPage = { kicker: string; count: string; title: string; body: string; note: string | null };

let readerEl: HTMLElement | null = null;

/**
 * The file you just took, on a page of its own: the room dims, the text types out, the last note comes in last, and the job waits until you are done (Enter, Space or Escape:
 * the first of those finishes the typing, the next closes it).
 */
export function showReader(page: ReaderPage, onClose: () => void): void {
  closeReader();
  const wrap = document.createElement('div');
  wrap.className = 'reader';
  const paper = document.createElement('div');
  paper.className = 'reader-paper';
  paper.setAttribute('role', 'dialog');
  paper.setAttribute('aria-modal', 'true');
  const top = document.createElement('div');
  top.className = 'reader-top';
  const kicker = document.createElement('span');
  kicker.textContent = page.kicker;
  const count = document.createElement('span');
  count.textContent = page.count;
  top.append(kicker, count);
  const title = document.createElement('h3');
  title.textContent = page.title;
  const body = document.createElement('p');
  body.className = 'reader-body';
  const note = document.createElement('p');
  note.className = 'reader-note';
  note.textContent = page.note ?? '';
  const row = document.createElement('div');
  row.className = 'reader-row';
  const paused = document.createElement('span');
  paused.textContent = 'Job paused';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'reader-back';
  back.textContent = 'Back to the job';
  row.append(paused, back);
  paper.append(top, title, body, note, row);
  wrap.append(paper);
  (document.querySelector('.overlay') ?? document.body).appendChild(wrap);
  document.body.classList.add('modal-open');
  readerEl = wrap;
  requestAnimationFrame(() => wrap.classList.add('on'));

  let n = 0;
  let done = false;
  const finish = (): void => {
    done = true;
    window.clearInterval(typing);
    body.textContent = page.body;
    if (page.note) note.classList.add('on');
  };
  const typing = window.setInterval(() => {
    n += 2;
    body.textContent = page.body.slice(0, n);
    if (n >= page.body.length) finish();
  }, 22);
  const close = (): void => {
    window.clearInterval(typing);
    window.removeEventListener('keydown', onKey, true);
    wrap.remove();
    if (readerEl === wrap) readerEl = null;
    document.body.classList.remove('modal-open');
    onClose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (done) close();
    else finish();
  };
  window.addEventListener('keydown', onKey, true);
  back.onclick = close;
  back.focus({ preventScroll: true });
}

/** Takes an open reader down without its button (the job ended under it). */
export function closeReader(): void {
  if (!readerEl) return;
  readerEl.remove();
  readerEl = null;
  document.body.classList.remove('modal-open');
}

/** The brief's link to the file: shown once there's a page in it, saying how many. */
export function setBriefFile(pages: number, total: number, onOpen: () => void): void {
  briefFile.hidden = pages === 0;
  briefFile.textContent = `The file · ${pages} of ${total} pages`;
  briefFile.onclick = onOpen;
}

// ---- the player's controls (shared/controls.ts): turn sensitivity, smooth turning, and the way back to the defaults ----

/** Shows the settings in the controls sheet. */
export function showControlSettings(settings: { turn: number; aim: number; camera: number; smooth: boolean; dash: boolean; fps: boolean }, custom: boolean): void {
  cameraSlider.value = String(settings.camera);
  cameraValue.textContent = `${settings.camera}°`;
  aimSlider.value = String(settings.aim);
  aimValue.textContent = `${settings.aim.toFixed(2).replace(/0$/, '')}×`;
  turnSlider.value = String(settings.turn);
  turnValue.textContent = `${settings.turn.toFixed(2).replace(/0$/, '')}×`;
  smoothSetting.checked = settings.smooth;
  dashSetting.checked = settings.dash;
  fpsSetting.checked = settings.fps;
  resetControls.hidden = !custom;
}

/** What the sheet's slider, checkbox, reset and key buttons do. `onKey` says whether the key was taken (a key that can't be used isn't). */
export function wireControlSettings(on: {
  onTurn: (turn: number) => void;
  onAim: (aim: number) => void;
  onCamera: (camera: number) => void;
  onSmooth: (smooth: boolean) => void;
  onDash: (dash: boolean) => void;
  onFps: (fps: boolean) => void;
  onReset: () => void;
  onKey: (action: string, code: string) => boolean;
}): void {
  aimSlider.addEventListener('input', () => on.onAim(Number(aimSlider.value)));
  cameraSlider.addEventListener('input', () => on.onCamera(Number(cameraSlider.value)));
  turnSlider.addEventListener('input', () => on.onTurn(Number(turnSlider.value)));
  smoothSetting.addEventListener('change', () => on.onSmooth(smoothSetting.checked));
  dashSetting.addEventListener('change', () => on.onDash(dashSetting.checked));
  fpsSetting.addEventListener('change', () => on.onFps(fpsSetting.checked));
  resetControls.addEventListener('click', on.onReset);
  // While a key button is waiting for a key, the next key press is that key's, and nothing else sees it (Escape cancels).
  window.addEventListener(
    'keydown',
    (e) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock'].includes(e.code)) return;
      if (e.code === 'Escape') {
        stopCapturing();
        return;
      }
      if (on.onKey(capturing, e.code)) stopCapturing();
      else keyHint.textContent = 'That key can’t be used. Try another, or Escape to cancel.';
    },
    { capture: true }
  );
  keyList.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const was = capturing;
    stopCapturing();
    if (was === button.dataset.action) return;
    capturing = button.dataset.action ?? null;
    button.classList.add('capturing');
    button.textContent = 'Press a key…';
  });
}

const keyList = document.getElementById('help-keys')!;
const keyHint = document.querySelector<HTMLElement>('.help-key-hint')!;
const KEY_HINT = keyHint.textContent ?? '';
let capturing: string | null = null;
const keyButtons = new Map<string, HTMLButtonElement>();
let keyLabels = new Map<string, string>();

function stopCapturing(): void {
  capturing = null;
  keyHint.textContent = KEY_HINT;
  for (const [id, button] of keyButtons) {
    button.classList.remove('capturing');
    button.textContent = keyLabels.get(id) ?? '';
  }
}

/** The key list in the controls sheet: each action with the key it's on now. */
export function showKeyList(rows: ReadonlyArray<{ id: string; label: string; key: string }>): void {
  keyLabels = new Map(rows.map((r) => [r.id, r.key]));
  if (keyButtons.size === 0) {
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'help-key-row';
      const name = document.createElement('span');
      name.textContent = row.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'help-key';
      button.dataset.action = row.id;
      button.setAttribute('aria-label', `${row.label}: change key`);
      line.append(name, button);
      keyList.appendChild(line);
      keyButtons.set(row.id, button);
    }
  }
  stopCapturing();
}

// Every line of text in the controls sheet and the trap buttons that names a key holds a {action} token, filled with the player's own key.
const labelNodes: Array<{ node: Text; template: string }> = [];
let labelsCollected = false;

/** Fills the key tokens in the controls sheet and the trap buttons with the player's keys. */
export function setKeyLabels(keys: Readonly<Record<ActionId, string>>): void {
  if (!labelsCollected) {
    labelsCollected = true;
    for (const root of [document.getElementById('help-card'), document.getElementById('trap-aim')]) {
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue?.includes('{')) labelNodes.push({ node: n as Text, template: n.nodeValue });
    }
  }
  for (const { node, template } of labelNodes) node.nodeValue = withKeys(template, keys);
}

// ---- how low the agent is (posture.ts): three pips, the current one lit and the one the next press goes to outlined ----

const postureEl = document.getElementById('posture')!;
const posturePips = [...postureEl.querySelectorAll<HTMLElement>('.posture-pip')];
const POSTURE_NAMES = { stand: 'Standing', crouch: 'Crouched', prone: 'Prone' } as const;
let postureShown = '';

/** Shows the posture and where the next press of the sneak key would take it. */
export function setPosture(current: 'stand' | 'crouch' | 'prone', next: 'stand' | 'crouch' | 'prone'): void {
  const key = `${current}>${next}`;
  if (key === postureShown) return;
  postureShown = key;
  for (const pip of posturePips) {
    pip.classList.toggle('on', pip.dataset['p'] === current);
    pip.classList.toggle('next', pip.dataset['p'] === next);
  }
  postureEl.setAttribute('aria-label', `${POSTURE_NAMES[current]}. The sneak key goes to ${POSTURE_NAMES[next].toLowerCase()}`);
}

// ---- the visibility meter: how exposed the agent is to the guards near them (detection.ts's exposure) ----

const visEl = document.getElementById('visibility')!;
const visFill = document.getElementById('visibility-fill')!;
const visWord = document.getElementById('visibility-word')!;
let visLevel = 0;
let visUntil = 0;
let visBand = '';

/**
 * Up while a guard is near enough to matter and for a couple of seconds after, down otherwise. `value` is the highest exposure to
 * any guard nearby (1 is seen); `concealed` is true while something hides the agent outright (the cloak, cover, a locker).
 */
export function setVisibility(value: number | null, concealed: boolean): void {
  const now = performance.now();
  if (value !== null) visUntil = now + 2000;
  const show = now < visUntil;
  if (visEl.hidden === show) visEl.hidden = !show;
  if (!show) {
    visLevel = 0;
    return;
  }
  const target = value === null || concealed ? 0 : value;
  visLevel += (target - visLevel) * 0.25;
  visFill.style.width = `${Math.round(Math.max(0.04, visLevel) * 100)}%`;
  const band = concealed && value !== null ? 'hidden' : visLevel >= 0.97 ? 'seen' : visLevel >= 0.6 ? 'high' : 'low';
  if (band === visBand) return;
  visBand = band;
  visEl.dataset['band'] = band;
  visWord.textContent = { hidden: 'HIDDEN', seen: 'SEEN', high: 'EXPOSED', low: 'LOW' }[band]!;
}

// ---- the dash's energy (dash.ts): a thin bar by the posture pips, shown only while it's in use or refilling ----

const dashBar = document.getElementById('dash-bar')!;
const dashFill = document.getElementById('dash-fill')!;
let dashShown = '';

/** The dash's energy, 0 to 1, and whether the agent is dashing right now. */
export function setDash(energy: number, active: boolean): void {
  const show = active || energy < 0.995;
  const key = `${show}:${active}:${Math.round(energy * 40)}`;
  if (key === dashShown) return;
  dashShown = key;
  dashBar.classList.toggle('show', show);
  dashBar.classList.toggle('active', active);
  dashFill.style.width = `${Math.round(Math.max(0, Math.min(1, energy)) * 100)}%`;
}
