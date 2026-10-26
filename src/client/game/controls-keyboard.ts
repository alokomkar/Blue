// Keyboard input for desktop. Every key is the player's to move (shared/controls.ts has the defaults and the rebinding): by default
// W/S drive forward/back throttle and A/D drive the turn rate, matching the tank-style relative controls in player.ts (not
// the 2D game's grid input); Q/E sidestep (a double-tap dodges); Left Shift steps the posture (stand, crouch, prone) and Right Shift fires; Space/Enter
// interacts; and the rest (flare, grapple, traps, torch, goggles, camo, map...) are one key each. The arrow keys also move you,
// Enter also interacts, and ? also opens the controls, unless those keys have been given another job; Escape always closes the map.
//
// Fire was originally left-click only, but a plain click isn't usable for every desktop user (e.g. some trackpad setups) — Right
// Shift was chosen over the more obvious "Cmd to fire" because tapping the bare Windows key opens the Start Menu and steals focus
// from the browser, which would break the game on every shot. Shift has no such OS-level meaning on either platform.
//
// Movement tracks held state directly rather than reacting to individual keydown events, so it's read from game.ts's render loop
// every frame — avoids the browser's native key-repeat, which has a long initial delay before it starts firing. Turning can ease in
// and out (a setting) instead of switching between stopped and full speed.

import type { MoveInput } from './player';

export type KeyboardControls = {
  getInput: () => MoveInput;
};

/** Each action's key as a KeyboardEvent.code, by action name (shared/controls.ts's resolveKeys): the keys are the player's own to move. */
export type KeyMap = Readonly<Record<string, string>>;

/** The arrow keys also move you, unless they've been given another job. */
const ARROW_ALIAS: Readonly<Record<string, string>> = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight' };

/** The action a key does, if any: the one it's bound to, else the arrows' movement, Enter's interact, and Shift+/ (?) for the controls. */
export function actionFor(keys: KeyMap, code: string, shift = false): string | null {
  for (const [action, bound] of Object.entries(keys)) {
    if (bound !== code) continue;
    // (Shift + the aim key, ?, is still the controls sheet.)
    if (action === 'aim' && code === 'Slash' && shift) return 'controls';
    return action;
  }
  const arrow = ARROW_ALIAS[code];
  if (arrow) return arrow;
  if (code === 'Enter') return 'interact';
  if (code === 'Slash' && shift) return 'controls';
  return null;
}

export type KeyboardCallbacks = {
  /** Shift: one step along stand, crouch, prone (posture.ts). */
  onPosture: () => void;
  onInteract: () => void;
  onFire: () => void;
  /** The aim key: the crosshair up, or down again (anywhere, not only from cover). */
  onAim: () => void;
  /** Any key that is not steering (turning, sliding) or Fire: while aiming from cover, it ducks the agent back behind it. */
  onOtherKey: (action: string) => void;
  /** X fires an EMP whatever is in the sights. */
  onForceEmp: () => void;
  onFlare: () => void;
  /** A flash grenade, to blind the guards and dogs on you (flash.ts). */
  onFlash: () => void;
  onSmoke: () => void;
  onShock: () => void;
  /** The gun menu (bigguns.ts): the stun pistol or a heavy gun. */
  onGun: () => void;
  /** Hook the pipe overhead and haul up (grapple.ts). */
  onGrapple: () => void;
  /** Turn the guide arrow to the next objective on or off. */
  onGuide: () => void;
  /** First-person view on or off. */
  onToggleView: () => void;
  onToggleMute: () => void;
  /** N switches the soundtrack on/off. */
  onToggleMusic: () => void;
  /** Double-tap Q (-1) or E (+1): a dodge to that side. */
  onDodge: (dir: number) => void;
  /** C switches camo on/off. */
  onCamo: () => void;
  /** T switches the torch on/off. */
  onTorch: () => void;
  /** R: night-vision goggles on or off. */
  onGoggles: () => void;
  /** G sets a remote trap; B blows the one on camera; V shows the next trap's camera. */
  onTrap: () => void;
  /** Z: a trap at your feet (or, while lining up a roll, there instead). */
  onTrapHere: () => void;
  onDetonate: () => void;
  onNextTrap: () => void;
  /** Tab opens/closes the blueprint; Escape closes it. */
  onToggleMap: () => void;
  /** H (or ?): the controls sheet. */
  onToggleControls: () => void;
  /** L: the briefing for this job, read again. */
  onLetter: () => void;
  /** O: the recon fly-over of the objectives and the way out, again. */
  onRecon: () => void;
  onCloseMap: () => void;
};

const DOUBLE_TAP_MS = 280;

/** How fast smoothed turning reaches full speed (and drops back): the axis crosses its whole range in 1 / this many seconds. */
const TURN_EASE_PER_S = 6;

/** An axis moved toward its target by at most `rate` of its range per second over `dt` seconds. */
export function easeAxis(current: number, target: number, dt: number, rate: number = TURN_EASE_PER_S): number {
  const step = rate * Math.max(0, dt);
  return current + Math.max(-step, Math.min(step, target - current));
}

const HELD_ACTIONS = ['forward', 'back', 'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight'];
/** What does not count as "another key" to someone aiming from cover: turning and sliding steer and place the shot, Fire takes it. */
const STEERING_ACTIONS = ['turnLeft', 'turnRight', 'strafeLeft', 'strafeRight', 'fire', 'aim'];

export function initKeyboardControls(
  callbacks: KeyboardCallbacks,
  signal: AbortSignal,
  smoothTurn: () => boolean,
  getKeys: () => KeyMap,
  dashEnabled: () => boolean
): KeyboardControls {
  // The movement actions currently held (the game reads them every frame, rather than reacting to key repeats).
  const held = new Set<string>();
  // The turn axis the game sees: the keys' own (-1, 0 or 1), or, smoothed, eased toward it.
  let turnAxis = 0;
  let turnAt = performance.now();
  // When the sidestep actions were last pressed, for spotting a double-tap dodge.
  let lastLeft = -Infinity;
  let lastRight = -Infinity;
  // Tap forward twice and hold the second tap: a dash (dash.ts). A double-tap you let go of at once is just two steps.
  let lastForward = -Infinity;
  let forwardDash = false;

  /** The actions that happen once on a key press (not while it's held). */
  const once: Readonly<Record<string, () => void>> = {
    fire: callbacks.onFire,
    aim: callbacks.onAim,
    forceEmp: callbacks.onForceEmp,
    flare: callbacks.onFlare,
    flash: callbacks.onFlash,
    smoke: callbacks.onSmoke,
    shock: callbacks.onShock,
    gun: callbacks.onGun,
    grapple: callbacks.onGrapple,
    guide: callbacks.onGuide,
    map: callbacks.onToggleMap,
    camo: callbacks.onCamo,
    torch: callbacks.onTorch,
    controls: callbacks.onToggleControls,
    goggles: callbacks.onGoggles,
    trap: callbacks.onTrap,
    trapHere: callbacks.onTrapHere,
    detonate: callbacks.onDetonate,
    nextTrap: callbacks.onNextTrap,
    music: callbacks.onToggleMusic,
    mute: callbacks.onToggleMute,
    view: callbacks.onToggleView,
    letter: callbacks.onLetter,
    recon: callbacks.onRecon,
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.code === 'Escape') {
        callbacks.onCloseMap();
        return;
      }
      // Settings inputs keep their native arrow keys and Space behaviour.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const action = actionFor(getKeys(), event.code, event.shiftKey);
      if (!action) return;
      if (!event.repeat && !STEERING_ACTIONS.includes(action)) callbacks.onOtherKey(action);
      if (HELD_ACTIONS.includes(action)) {
        held.add(action);
        event.preventDefault();
        if (action === 'forward' && !event.repeat) {
          forwardDash = dashEnabled() && event.timeStamp - lastForward <= DOUBLE_TAP_MS;
          lastForward = event.timeStamp;
        }
        if (!event.repeat && (action === 'strafeLeft' || action === 'strafeRight')) {
          const left = action === 'strafeLeft';
          if (event.timeStamp - (left ? lastLeft : lastRight) < DOUBLE_TAP_MS) callbacks.onDodge(left ? -1 : 1);
          if (left) lastLeft = event.timeStamp;
          else lastRight = event.timeStamp;
        }
        return;
      }
      if (action === 'sneak') {
        if (!event.repeat) callbacks.onPosture();
        return;
      }
      if (action === 'interact') {
        // A focused button (the report's Continue, a blueprint tab) keeps its own Space/Enter.
        if ((event.code === 'Space' || event.code === 'Enter') && event.target instanceof HTMLButtonElement && event.target.closest('[role="dialog"]')) return;
        if (!event.repeat) {
          event.preventDefault();
          callbacks.onInteract();
        }
        return;
      }
      if (event.code === 'Tab') event.preventDefault();
      if (!event.repeat) once[action]?.();
    },
    { signal }
  );

  window.addEventListener(
    'keyup',
    (event) => {
      const action = actionFor(getKeys(), event.code);
      if (action) held.delete(action);
      if (action === 'forward') forwardDash = false;
    },
    { signal }
  );

  // Losing window focus can drop a keyup event — clear held movement state
  // so a direction doesn't get stuck "on." Sneak is a toggle, not a held
  // state, so it deliberately survives a focus change.
  window.addEventListener(
    'blur',
    () => {
      held.clear();
      turnAxis = 0;
      forwardDash = false;
    },
    { signal }
  );

  const axis = (plus: string, minus: string): number => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);

  return {
    getInput: () => {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - turnAt) / 1000));
      turnAt = now;
      const target = axis('turnRight', 'turnLeft');
      turnAxis = smoothTurn() ? easeAxis(turnAxis, target, dt) : target;
      return {
        throttle: axis('forward', 'back'),
        turn: turnAxis,
        strafe: axis('strafeRight', 'strafeLeft'),
        sneak: false, // how low the agent is lives in game.ts's posture
        dash: forwardDash && held.has('forward'),
      };
    },
  };
}
