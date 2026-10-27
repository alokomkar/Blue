// Each player's controls: how fast the agent turns (a multiplier on the keys' and the stick's turn), whether turning from the keys
// eases in instead of snapping to full speed, and which keys do what on the desktop. Kept on the account (so they follow the player
// between devices) and in the browser. The keys are KeyboardEvent.code values, which name the key's place on the board, not its
// letter, so a rebinding means the same thing on every layout. Pure, so it's unit-tested under Node.

/** Everything the keyboard does that can be moved to another key. Escape (closes the map) and the arrow keys' and Enter's extra duties are fixed. */
export const ACTIONS = [
  'forward',
  'back',
  'turnLeft',
  'turnRight',
  'strafeLeft',
  'strafeRight',
  'sneak',
  'fire',
  'aim',
  'interact',
  'forceEmp',
  'flare',
  'flash',
  'smoke',
  'shock',
  'gun',
  'grapple',
  'guide',
  'trap',
  'trapHere',
  'detonate',
  'nextTrap',
  'talk',
  'torch',
  'goggles',
  'camo',
  'controls',
  'letter',
  'recon',
  'map',
  'music',
  'mute',
  'view',
] as const;
export type ActionId = (typeof ACTIONS)[number];

/** The keys as shipped. */
export const DEFAULT_KEYS: Readonly<Record<ActionId, string>> = {
  forward: 'KeyW',
  back: 'KeyS',
  turnLeft: 'KeyA',
  turnRight: 'KeyD',
  strafeLeft: 'KeyQ',
  strafeRight: 'KeyE',
  sneak: 'ShiftLeft',
  fire: 'ShiftRight',
  aim: 'Slash',
  interact: 'Space',
  forceEmp: 'KeyX',
  flare: 'KeyF',
  flash: 'Digit1',
  smoke: 'Digit3',
  shock: 'Digit4',
  gun: 'Digit2',
  grapple: 'KeyU',
  guide: 'KeyP',
  trap: 'KeyG',
  trapHere: 'KeyZ',
  detonate: 'KeyB',
  nextTrap: 'KeyJ',
  talk: 'KeyV',
  torch: 'KeyT',
  goggles: 'KeyR',
  camo: 'KeyC',
  controls: 'KeyH',
  letter: 'KeyL',
  recon: 'KeyO',
  map: 'Tab',
  music: 'KeyN',
  mute: 'KeyM',
  view: 'KeyK',
};

/** What each action is called in the settings. */
export const ACTION_LABELS: Readonly<Record<ActionId, string>> = {
  forward: 'Move forward (tap twice and hold: dash)',
  back: 'Move back',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  strafeLeft: 'Sidestep left (double-tap: dodge)',
  strafeRight: 'Sidestep right (double-tap: dodge)',
  sneak: 'Crouch, lie flat, stand (steps)',
  fire: 'Takedown / fire',
  aim: 'Aim (toggle): steer with A / D and W / S, fire to shoot',
  interact: 'Interact, carry',
  forceEmp: 'Force an EMP',
  flare: 'Flare',
  flash: 'Flash grenade',
  smoke: 'Smoke grenade (blinds guards)',
  shock: 'Shock grenade (blinds dogs)',
  gun: 'Choose a gun (menu)',
  grapple: 'Grapple',
  guide: 'Guide arrow on / off',
  trap: 'Trap: aim, then roll',
  trapHere: 'Trap: set here',
  detonate: 'Blow the trap',
  nextTrap: 'Next trap camera',
  talk: 'Talk to your AI partner (hold)',
  torch: 'Torch',
  goggles: 'Night vision',
  camo: 'Camo (toggle)',
  controls: 'These controls',
  letter: 'Briefing letter, again',
  recon: 'Recon, again',
  map: 'Blueprint map',
  music: 'Music on / off',
  mute: 'Sound on / off',
  view: 'First-person view on / off',
};

/** How the sensitivity runs: half speed to double, one being what the game has always done. */
export const AIM_MIN = 0.25;
export const AIM_MAX = 2;
export const TURN_MIN = 0.5;
export const TURN_MAX = 2;
/** The camera's angle above the floor, in degrees: low and behind (more of what is ahead) to almost straight down. 47 is how it has always sat. */
export const CAMERA_MIN = 28;
export const CAMERA_MAX = 72;

export type ControlSettings = {
  /** A multiplier on how fast the agent turns, from the keys and from the stick. */
  turn: number;
  /** Fine aim speed multiplier on both axes, independent of walking. */
  aim: number;
  /** How high the chase camera looks down from, in degrees above the floor (CAMERA_MIN to CAMERA_MAX): lower sees further ahead, higher sees the maze from above. */
  camera: number;
  /** Turning from the keys eases up to full speed over a fraction of a second, and back down, instead of switching. */
  smooth: boolean;
  /** Tap forward twice and hold (or double-touch the stick and hold) to dash; off, nothing happens on a double-tap. */
  dash: boolean;
  /** First-person mode: the aim view stays up and the agent walks in it (W/S walk, Q/E sidestep, A/D and the pointer turn, a click fires). */
  fps: boolean;
  /** The keys moved from their defaults, by action. */
  keys: Partial<Record<ActionId, string>>;
};

export const DEFAULT_CONTROLS: ControlSettings = { turn: 0.65, aim: 1, camera: 47, smooth: false, dash: true, fps: false, keys: {} };

/** Whether a key may be given to an action: a letter, digit, arrow, shift, space or the tab key, or a common punctuation key. Not Escape, Enter or the Meta/Ctrl/Alt keys. */
export function isBindable(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space|Tab|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Backslash)$/.test(code)
  );
}

const isAction = (v: string): v is ActionId => (ACTIONS as readonly string[]).includes(v);

const clampTurn = (n: number): number => Math.min(TURN_MAX, Math.max(TURN_MIN, Math.round(n * 20) / 20));

/** Settings as stored, whatever shape they've come back in: a good copy, or null if it isn't settings at all. Keys that aren't bindable or are bound twice are dropped. */
export function parseControls(raw: unknown): ControlSettings | null {
  if (typeof raw === 'string') {
    try {
      return parseControls(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { turn, aim, camera, smooth, dash, fps, keys } = raw as Record<string, unknown>;
  const out: ControlSettings = {
    turn: typeof turn === 'number' && Number.isFinite(turn) ? clampTurn(turn) : DEFAULT_CONTROLS.turn,
    aim: typeof aim === 'number' && Number.isFinite(aim) ? Math.min(AIM_MAX, Math.max(AIM_MIN, Math.round(aim * 20) / 20)) : DEFAULT_CONTROLS.aim,
    camera: typeof camera === 'number' && Number.isFinite(camera) ? Math.min(CAMERA_MAX, Math.max(CAMERA_MIN, Math.round(camera))) : DEFAULT_CONTROLS.camera,
    smooth: smooth === true,
    dash: dash !== false,
    fps: fps === true,
    keys: {},
  };
  if (typeof keys === 'object' && keys !== null) {
    const used = new Set<string>();
    for (const [action, code] of Object.entries(keys)) {
      if (!isAction(action) || !isBindable(code) || used.has(code)) continue;
      used.add(code);
      out.keys[action] = code;
    }
  }
  return resolved(out) ? out : { ...out, keys: {} };
}

/** Every action's key: the player's where they've moved it, the default where they haven't. */
export function resolveKeys(settings: ControlSettings): Record<ActionId, string> {
  const keys = { ...DEFAULT_KEYS } as Record<ActionId, string>;
  for (const action of ACTIONS) {
    const code = settings.keys[action];
    if (code) keys[action] = code;
  }
  return keys;
}

/** Whether no two actions share a key once the settings are resolved (a moved key landing on a default that wasn't moved would). */
function resolved(settings: ControlSettings): boolean {
  const codes = Object.values(resolveKeys(settings));
  return new Set(codes).size === codes.length;
}

/** The action whose key is `code`, if any. */
export function actionOf(keys: Readonly<Record<ActionId, string>>, code: string): ActionId | null {
  return ACTIONS.find((a) => keys[a] === code) ?? null;
}

/**
 * Gives `code` to `action`. A key can only do one thing: if another action had it, that action takes `action`'s old key (the two swap),
 * so nothing is ever left without a key. Moving a key back to its default drops it from the stored list.
 */
export function bind(settings: ControlSettings, action: ActionId, code: string): ControlSettings {
  if (!isBindable(code)) return settings;
  const keys = resolveKeys(settings);
  const old = keys[action];
  if (old === code) return settings;
  const other = actionOf(keys, code);
  keys[action] = code;
  if (other) keys[other] = old;
  const moved: Partial<Record<ActionId, string>> = {};
  for (const a of ACTIONS) if (keys[a] !== DEFAULT_KEYS[a]) moved[a] = keys[a];
  return { ...settings, keys: moved };
}

/** A key as the player reads it: "G", "Left Shift", "Space", "↑". */
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return code.startsWith('Numpad') ? `Num ${digit[1]}` : digit[1]!;
  const named: Record<string, string> = {
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    Space: 'Space',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: '\'',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Backslash: '\\',
  };
  return named[code] ?? code;
}

/** Fills the `{action}` tokens in a line of text with the player's own keys: "Press {trap} to roll" reads "Press G to roll" until they move it. */
export function withKeys(text: string, keys: Readonly<Record<ActionId, string>>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => (isAction(name) ? keyLabel(keys[name]) : whole));
}

/** Whether settings differ from the defaults at all (to offer a reset). */
export function isCustom(settings: ControlSettings): boolean {
  return settings.aim !== DEFAULT_CONTROLS.aim || settings.camera !== DEFAULT_CONTROLS.camera || settings.turn !== DEFAULT_CONTROLS.turn || settings.smooth || !settings.dash || settings.fps || Object.keys(settings.keys).length > 0;
}
