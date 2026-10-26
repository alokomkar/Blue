// The smoke grenade and the shock grenade: what they do and for how long. Smoke blinds guards: the cloud grows over a second or so, holds, and thins out over about eleven seconds, and
// while it is up no guard can see through it, and a guard standing in it sees no further than a few steps. (Dogs hunt by ear and nose, and a drone looks down over it: it hides
// from neither.) A shock grenade blinds and deafens the dogs near it, nothing else. Pure, so the rules are unit-tested under Node.

/** Grenades a job starts with. */
export const SMOKE_START = 2;
export const SHOCK_START = 2;
export const GRENADE_COOLDOWN_S = 1.2;

export const SMOKE_S = 11;
export const SMOKE_MAX_R = 2.7;
/** How fast the cloud spreads, metres a second. */
export const SMOKE_GROW = 3.2;
/** The last seconds in which it thins to nothing. */
export const SMOKE_FADE_S = 2.2;
/** A guard standing inside the cloud sees this share of what it normally does (about a metre). */
export const SMOKE_SIGHT_SCALE = 0.11;
/** Noise: guards this many cells' walk from a smoke pop come to look (it is a quiet hiss). */
export const SMOKE_NOISE_CELLS = 3;

/** Dogs with a clear line to a shock grenade this close are blinded and deafened for this long. */
export const SHOCK_RADIUS = 6;
export const SHOCK_DAZE_S = 9;
/** A shock is a loud crack: guards this many cells away come to look (the dogs it hit, stumbling about, do not). */
export const SHOCK_NOISE_CELLS = 5;

/** A guard onto the agent within this many metres is a reason to offer smoke; a dog onto them, a reason to offer a shock. */
export const SMOKE_OFFER_M = 11;
export const SHOCK_OFFER_M = 10;
/** A sniper locked on the agent is a reason to offer smoke from as far as it can see: the cloud is what breaks its line. */
export const SNIPER_SMOKE_OFFER_M = 34;

/** Which grenade is worth offering for the hunters about: smoke for a guard with the agent in sight, a shock for a dog on their trail. */
export function grenadeOffer(hunters: ReadonlyArray<{ kind: string; alert: boolean; disabled: boolean; dazed: boolean; dist: number }>, smokeLeft: number, shockLeft: number, inCloud: boolean): { smoke: boolean; shock: boolean } {
  const guard = hunters.some((h) => h.alert && !h.disabled && !h.dazed && h.kind !== 'watchdog' && h.kind !== 'crawler' && h.kind !== 'drone' && h.dist <= (h.kind === 'sniper' ? SNIPER_SMOKE_OFFER_M : SMOKE_OFFER_M));
  const dog = hunters.some((h) => h.alert && !h.disabled && !h.dazed && h.kind === 'watchdog' && h.dist <= SHOCK_OFFER_M);
  return { smoke: smokeLeft > 0 && guard && !inCloud, shock: shockLeft > 0 && dog };
}

export type Smoke = { x: number; z: number; /** Seconds since it went off. */ age: number };

/** The cloud's radius `age` seconds after it went off: spreading, holding, then thinning away. */
export function smokeRadius(age: number): number {
  if (age < 0 || age >= SMOKE_S) return 0;
  const grown = Math.min(SMOKE_MAX_R, 0.2 + age * SMOKE_GROW);
  return age > SMOKE_S - SMOKE_FADE_S ? grown * Math.max(0, (SMOKE_S - age) / SMOKE_FADE_S) : grown;
}

/** Whether (x, z) stands inside a cloud. */
export function insideSmoke(x: number, z: number, smokes: ReadonlyArray<Smoke>): boolean {
  return smokes.some((s) => Math.hypot(x - s.x, z - s.z) < Math.max(0.6, smokeRadius(s.age)) && smokeRadius(s.age) > 0);
}

/** Whether the straight line from a to b goes through a cloud thick enough to hide behind (a thin new puff or a nearly spent one does not count). */
export function smokeBlocks(ax: number, az: number, bx: number, bz: number, smokes: ReadonlyArray<Smoke>): boolean {
  for (const s of smokes) {
    const r = smokeRadius(s.age);
    if (r < 0.8) continue;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / len2));
    if (Math.hypot(ax + dx * t - s.x, az + dz * t - s.z) < r * 0.85) return true;
  }
  return false;
}
