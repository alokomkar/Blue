// Heavy guns: Quaternius's Sci-Fi Modular Gun Pack (CC0, public/models/guns), swapped in for the pistol the agent carries. The pistol's group stays as the
// thing the hand holds, so the grip, the tip (where a shot leaves) and the support hand keep working; what changes is what it looks like, where the handle is in the hand,
// and where the muzzle and the foregrip are. Each gun is laid along -Z, level, with its handle on the pistol's grip point.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StunGun } from './weapon';

/** Where a gun's handle is held, its foregrip, and its muzzle, as fractions of the gun's own box: along from the rear (0) to the muzzle (1), up from the bottom (0) to the top (1). */
type GunSpec = {
  name: string;
  /** A word or so for the kit button. */
  short: string;
  /** What sort of gun it is, and what its shot looks like, for the menu. */
  kind: string;
  blurb: string;
  /** How long it is in the held pistol's own units (about a metre: the character's scale goes on top). */
  length: number;
  grip: readonly [along: number, up: number];
  fore: readonly [along: number, up: number];
  muzzleUp: number;
  /** How far it kicks back and up when fired, in those units. */
  recoil: number;
};

export const BIG_GUN_SPECS = {
  Pistol_1: { name: 'Pulse pistol', short: 'Pulse', kind: 'Pistol', blurb: 'A single fast pulse bolt.', length: 0.5, grip: [0.14, 0.24], fore: [0.6, 0.4], muzzleUp: 0.72, recoil: 0.05 },
  SMG_1: { name: 'Dart SMG', short: 'SMG', kind: 'SMG', blurb: 'Three small darts in a quick rattle.', length: 0.62, grip: [0.5, 0.46], fore: [0.82, 0.3], muzzleUp: 0.78, recoil: 0.03 },
  AR_4: { name: 'Burst rifle', short: 'Rifle', kind: 'Rifle', blurb: 'A burst of three long tracers.', length: 0.62, grip: [0.69, 0.22], fore: [0.86, 0.42], muzzleUp: 0.72, recoil: 0.06 },
  Sniper_2: { name: 'Rail sniper', short: 'Rail', kind: 'Sniper', blurb: 'A blue rail beam that burns out slowly.', length: 1.0, grip: [0.38, 0.2], fore: [0.62, 0.4], muzzleUp: 0.68, recoil: 0.16 },
} as const satisfies Record<string, GunSpec>;

export type BigGun = keyof typeof BIG_GUN_SPECS;
export const BIG_GUNS = Object.keys(BIG_GUN_SPECS) as BigGun[];
export const isBigGun = (n: unknown): n is BigGun => typeof n === 'string' && n in BIG_GUN_SPECS;

/** The held pistol's grip point, in its own frame (weapon.ts GRIP_CENTRE; forward is -Z). */
const HAND = { y: -0.115, z: 0.05 };
const TURN = new THREE.Euler(0, Math.PI / 2, 0); // the pack's guns lie along +X: this turns the muzzle to -Z

const loaded = new Map<string, Promise<THREE.Group>>();
function load(name: BigGun): Promise<THREE.Group> {
  let p = loaded.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`/models/guns/${name}.gltf`).then((g) => g.scene);
    loaded.set(name, p);
  }
  return p;
}

type Fitted = { holder: THREE.Group; spec: GunSpec; restZ: number };
const fitted = new WeakMap<StunGun, Fitted>();
/** The gun last asked for, so a slow load that is overtaken by a newer request drops out. */
const wanted = new WeakMap<StunGun, BigGun | null>();

/** Puts `name` in the gun's place (or the pistol back, for null), the muzzle and foregrip moved with it. */
export async function equipBigGun(gun: StunGun, name: BigGun | null): Promise<void> {
  wanted.set(gun, name);
  const old = fitted.get(gun);
  if (old) {
    gun.group.remove(old.holder);
    fitted.delete(gun);
  }
  if (!name) {
    for (const child of gun.group.children) child.visible = true;
    return;
  }
  const src = await load(name);
  if (wanted.get(gun) !== name || fitted.get(gun)) return; // another gun was asked for meanwhile
  const spec: GunSpec = BIG_GUN_SPECS[name];
  const model = src.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = spec.length / size.x;
  // In the model's own frame (x along the gun, y up), a point given as fractions of its box; then to the gun group's frame.
  const local = (along: number, up: number) => new THREE.Vector3(box.min.x + along * size.x, box.min.y + up * size.y, 0);
  const holder = new THREE.Group();
  holder.add(model);
  holder.rotation.copy(TURN);
  holder.scale.setScalar(k);
  const toGroup = (v: THREE.Vector3) => v.clone().multiplyScalar(k).applyEuler(TURN);
  const grip = toGroup(local(...spec.grip));
  holder.position.set(-grip.x, HAND.y - grip.y, HAND.z - grip.z);
  for (const child of gun.group.children) child.visible = child === gun.tip || child === gun.support;
  gun.group.add(holder);
  const muzzle = toGroup(local(1, spec.muzzleUp)).add(holder.position);
  const fore = toGroup(local(...spec.fore)).add(holder.position);
  gun.tip.position.set(0, muzzle.y, muzzle.z);
  gun.support.position.set(0, fore.y - 0.02, fore.z);
  fitted.set(gun, { holder, spec, restZ: holder.position.z });
}

/** The kick of a shot, 1 at the moment of firing falling to 0: the gun slides back and its muzzle flips up. Pistol-only guns get a shorter slide. */
export function kickGun(gun: StunGun, amount: number): void {
  const f = fitted.get(gun);
  if (!f) return;
  f.holder.position.z = f.restZ + f.spec.recoil * amount;
  f.holder.rotation.set(0, Math.PI / 2, 0);
  f.holder.rotateX(-f.spec.recoil * 1.6 * amount);
}

/** The gun's display name, for the toast when it is changed. */
export const gunLabel = (name: BigGun): string => BIG_GUN_SPECS[name].name;
export const gunShort = (name: BigGun | null): string => (name ? BIG_GUN_SPECS[name].short : 'Stun');

/** The menu's entries: the stun pistol (null), then every heavy gun. */
export const GUN_MENU: ReadonlyArray<{ id: BigGun | null; name: string; short: string; kind: string; blurb: string; image: string }> = [
  { id: null, name: 'Stun pistol', short: 'Stun', kind: 'Pistol', blurb: 'The standard stun pistol: one shot, then the recharge.', image: '/models/guns/thumbs/stun.svg' },
  ...BIG_GUNS.map((id) => ({ id, name: BIG_GUN_SPECS[id].name, short: BIG_GUN_SPECS[id].short, kind: BIG_GUN_SPECS[id].kind, blurb: BIG_GUN_SPECS[id].blurb, image: `/models/guns/thumbs/${id}.png` })),
];
