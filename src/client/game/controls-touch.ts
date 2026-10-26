// Mobile input: a fixed, always-in-the-same-place joystick at the
// bottom-left of the screen — vertical drag = forward/back throttle,
// horizontal drag = turn rate, the same MoveInput shape
// controls-keyboard.ts produces from held W/S/A/D — plus the
// context-sensitive Interact button, a Sneak toggle and a Fire button
// (mobile-only — desktop just uses a mouse click for Fire, no on-screen
// prompt needed there) at bottom-right, and a hold-to-sidestep/peek pair
// (the touch equivalent of Q/E) just above the joystick. The kit above Fire
// (flare, traps, torch, goggles, map) is hud.ts's wireKit().
//
// A previous version spawned an invisible joystick wherever you first
// touched, with no fixed position. On a real device that turned out to be
// unusable: with no visible affordance there's nothing telling you where or
// how to start moving, and if pointer-type detection guesses wrong there's
// no visible fallback either. A fixed, always-shown base fixes both —
// visibility is still best-guessed via matchMedia('(pointer: coarse)'), but
// an actual touch event anywhere always reveals it regardless of that guess.

import type { MoveInput } from './player';
import type { FireChoice } from './weapons';

export type TouchControls = {
  getInput: () => MoveInput;
  setAiming: (aiming: boolean) => void;
  setInteractEnabled: (enabled: boolean) => void;
  setFireEnabled: (enabled: boolean) => void;
  /** What Interact does right now: OPEN, HACK, COVER, DRAG… */
  setInteractLabel: (label: string) => void;
  /** The Fire button's face: what the next press will do (weapons.ts's fireLabel). */
  setFireLabel: (label: string, choice: FireChoice) => void;
  /** Camo on the Sneak button: its battery bar (0–1), glowing while the cloak is on, dimmed while it can't start. */
  setCamo: (energy: number, active: boolean, canStart: boolean) => void;
  /** The Sneak button shows the posture: lit when crouched, a double light when flat (posture.ts). */
  setPosture: (posture: 'stand' | 'crouch' | 'prone') => void;
};

const MAX_DRAG_PX = 46;
const CAMO_HOLD_MS = 450;
const DOUBLE_TAP_MS = 300; // two taps on a sidestep button this close together are a dodge // holding Sneak this long switches camo instead of sneak
const DEADZONE_PX = 8;

export function initTouchControls(
  handleInteract: () => void,
  handleFire: (forceEmp: boolean) => void,
  handleCamo: () => void,
  handleDodge: (dir: number) => void,
  handlePosture: () => void,
  dashEnabled: () => boolean,
  signal: AbortSignal,
  handleDuck: () => void
): TouchControls {
  const container = document.getElementById('touch-controls')!;
  const base = document.getElementById('joystick-base')!;
  const thumb = document.getElementById('joystick-thumb')!;
  const interactBtn = document.getElementById('interact-btn') as HTMLButtonElement;
  const sneakBtn = document.getElementById('sneak-btn') as HTMLButtonElement;
  const duckBtn = document.getElementById('duck-btn')!;
  duckBtn.addEventListener('click', handleDuck, { signal });
  const fireBtn = document.getElementById('fire-btn') as HTMLButtonElement;

  // game.html ships with .hidden-controls on by default (avoids a flash of
  // joystick before this runs) — reveal it here on a best guess.
  const looksTouchCapable =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  // body.touch-ui: the kit carries what the top row's icon buttons do, so those step aside.
  const reveal = (): void => {
    container.classList.remove('hidden-controls');
    document.body.classList.add('touch-ui');
  };
  if (looksTouchCapable) reveal();
  // Belt-and-suspenders: whatever the guess above said, a real touch always
  // reveals the controls — there's no scenario where a touch happens and
  // the player is left with no visible way to move.
  window.addEventListener('touchstart', reveal, {
    signal,
    once: true,
    passive: true,
  });

  let turn = 0;
  let throttle = 0;
  let activePointerId: number | null = null;
  // Touch the stick twice, quickly, and hold the second touch: a dash (dash.ts).
  let lastDownAt = -Infinity;
  let dashHeld = false;

  function resetThumb(): void {
    turn = 0;
    throttle = 0;
    thumb.style.transform = 'translate(-50%, -50%)';
  }
  resetThumb();

  base.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      dashHeld = dashEnabled() && e.timeStamp - lastDownAt <= DOUBLE_TAP_MS;
      lastDownAt = e.timeStamp;
      base.setPointerCapture(e.pointerId);
    },
    { signal }
  );

  base.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      const rect = base.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < DEADZONE_PX) {
        resetThumb();
        return;
      }
      const clamped = Math.min(dist, MAX_DRAG_PX);
      const angle = Math.atan2(dy, dx);
      const tx = Math.cos(angle) * clamped;
      const ty = Math.sin(angle) * clamped;
      turn = tx / MAX_DRAG_PX;
      throttle = -ty / MAX_DRAG_PX; // dragging up (negative screen Y) = forward
      thumb.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;
    },
    { signal }
  );

  function endTouch(e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    dashHeld = false;
    resetThumb();
  }
  base.addEventListener('pointerup', endTouch, { signal });
  base.addEventListener('pointercancel', endTouch, { signal });

  interactBtn.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      e.preventDefault();
      handleInteract();
    },
    { passive: false, signal }
  );
  // Also handle a plain click so the same button works when touch controls
  // are force-shown on a desktop for testing.
  interactBtn.addEventListener('click', handleInteract, { signal });

  // Sneak is a toggle here, not a hold — holding a screen button steady
  // while also dragging the joystick thumb with the same hand is awkward,
  // unlike Shift on a physical keyboard alongside WASD. The same button
  // doubles as camo: a tap toggles sneak, a long press (CAMO_HOLD_MS)
  // toggles camo instead and leaves sneak as it was.
  let holdTimer = 0;
  let holdPointer: number | null = null;
  let longPressed = false;
  const endHold = (): void => {
    window.clearTimeout(holdTimer);
    holdPointer = null;
    sneakBtn.classList.remove('holding');
  };
  sneakBtn.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      e.preventDefault();
      holdPointer = e.pointerId;
      longPressed = false;
      sneakBtn.classList.add('holding');
      holdTimer = window.setTimeout(() => {
        longPressed = true;
        sneakBtn.classList.remove('holding');
        navigator.vibrate?.(25);
        handleCamo();
      }, CAMO_HOLD_MS);
    },
    { signal }
  );
  sneakBtn.addEventListener(
    'pointerup',
    (e: PointerEvent) => {
      if (e.pointerId !== holdPointer) return;
      endHold();
      if (longPressed) return;
      handlePosture();
    },
    { signal }
  );
  sneakBtn.addEventListener('pointercancel', endHold, { signal });
  // A long press would otherwise open the browser's own context menu / text callout.
  sneakBtn.addEventListener('contextmenu', (e) => e.preventDefault(), { signal,
  });

  // Fire: a tap fires whatever the gun has picked for the target; holding
  // (the same CAMO_HOLD_MS as Sneak's camo) forces an EMP instead.
  let fireTimer = 0;
  let firePointer: number | null = null;
  let fireHeld = false;
  fireBtn.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      e.preventDefault();
      firePointer = e.pointerId;
      fireHeld = false;
      fireBtn.classList.add('holding');
      fireTimer = window.setTimeout(() => {
        fireHeld = true;
        fireBtn.classList.remove('holding');
        navigator.vibrate?.(25);
        handleFire(true);
      }, CAMO_HOLD_MS);
    },
    { signal }
  );
  fireBtn.addEventListener(
    'pointerup',
    (e: PointerEvent) => {
      if (e.pointerId !== firePointer) return;
      window.clearTimeout(fireTimer);
      firePointer = null;
      fireBtn.classList.remove('holding');
      if (!fireHeld) handleFire(false);
    },
    { signal }
  );
  fireBtn.addEventListener(
    'pointercancel',
    () => {
      window.clearTimeout(fireTimer);
      firePointer = null;
      fireBtn.classList.remove('holding');
    },
    { signal }
  );
  fireBtn.addEventListener('contextmenu', (e) => e.preventDefault(), { signal,
  });


  // Hold-to-move, like Q/E: player.ts turns this into a sidestep normally,
  // or a capped spring-back peek while sneaking. Pointer capture keeps the
  // hold alive if the thumb drifts off the button mid-press.
  let strafeLeft = false;
  let strafeRight = false;
  // A double-tap on either sidestep button is a dodge to that side.
  function wireStrafe(btn: HTMLElement, dir: number, set: (held: boolean) => void): void {
    let lastTap = -Infinity;
    const release = (): void => {
      set(false);
      btn.classList.remove('held');
    };
    btn.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        set(true);
        btn.classList.add('held');
        if (e.timeStamp - lastTap < DOUBLE_TAP_MS) handleDodge(dir);
        lastTap = e.timeStamp;
      },
      { signal }
    );
    btn.addEventListener('pointerup', release, { signal });
    btn.addEventListener('pointercancel', release, { signal });
    btn.addEventListener('lostpointercapture', release, { signal });
  }
  wireStrafe(document.getElementById('strafe-left-btn')!, -1, (held) => (strafeLeft = held));
  wireStrafe(document.getElementById('strafe-right-btn')!, 1, (held) => (strafeRight = held));

  return {
    // The one button that aims and lowers the gun again: Aim, and (once the gun is up) Duck.
    setAiming(aiming: boolean) {
      duckBtn.hidden = false;
      const label = aiming ? 'Duck' : 'Aim';
      if (duckBtn.textContent !== label) duckBtn.textContent = label;
    },
    // Same sign convention as controls-keyboard.ts (Q = -1, E = +1).
    getInput: () => ({ turn, throttle, strafe: (strafeRight ? 1 : 0) - (strafeLeft ? 1 : 0), sneak: false, dash: dashHeld && throttle > 0.3,
    }),
    setInteractEnabled(enabled: boolean) {
      interactBtn.classList.toggle('hidden', !enabled);
    },
    setInteractLabel(label: string) {
      if (interactBtn.textContent !== label) interactBtn.textContent = label;
    },
    // Ammo itself is unlimited, so this isn't hidden the way Interact is —
    // it's just dimmed and unpressable while recharging, so the button stays
    // put (no layout jump) and reads as "will work again shortly."
    setFireEnabled(enabled: boolean) {
      fireBtn.classList.toggle('recharging', !enabled);
    },
    setFireLabel(label: string, choice: FireChoice) {
      if (fireBtn.textContent !== label) fireBtn.textContent = label;
      fireBtn.classList.toggle('takedown', choice === 'takedown');
      fireBtn.classList.toggle('emp', choice === 'emp');
      fireBtn.classList.toggle('no-emp', choice === 'none');
    },
    setCamo(energy: number, active: boolean, canStart: boolean) {
      sneakBtn.style.setProperty('--charge', String(Math.max(0, Math.min(1, energy))));
      sneakBtn.classList.toggle('camo-on', active);
      sneakBtn.classList.toggle('camo-low', !active && !canStart);
    },
    setPosture(posture: 'stand' | 'crouch' | 'prone') {
      sneakBtn.classList.toggle('active', posture !== 'stand');
      sneakBtn.classList.toggle('prone', posture === 'prone');
    },
  };
}
