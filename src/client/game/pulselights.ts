// Lights for things thrown or fired (a flare, a flash grenade, an EMP).
//
// Adding a light to a three.js scene, or taking one away, changes how many lights every lit material has, and every one of those materials is then compiled again: a freeze of a second or two
// the first time (measured: a 2.1 s frame on the first EMP of a job), and the enemies falling over in the middle of it look choppy. So the lights are made when the job is built, switched
// off, and lent out: the count never changes, and the programs are compiled before anyone is playing.

import * as THREE from 'three';

type Pool = { free: THREE.PointLight[]; all: THREE.PointLight[] };
const pools = new WeakMap<THREE.Scene, Pool>();

/** How many may be lit at once: a few flares, a flash, an EMP or two. */
export const PULSE_LIGHTS = 6;

function make(scene: THREE.Scene, pool: Pool): THREE.PointLight {
  const l = new THREE.PointLight(0xffffff, 0, 10);
  scene.add(l);
  pool.all.push(l);
  return l;
}

/** Puts the pool in the scene (call once when it is built, before the first frame). */
export function preparePulseLights(scene: THREE.Scene): void {
  if (pools.has(scene)) return;
  const pool: Pool = { free: [], all: [] };
  pools.set(scene, pool);
  for (let i = 0; i < PULSE_LIGHTS; i++) pool.free.push(make(scene, pool));
}

/** A light, off, in this colour and with this reach. If the pool is used up (it should not be) a new one is added, which costs a hitch. */
export function takeLight(scene: THREE.Scene, color: number, distance: number): THREE.PointLight {
  let pool = pools.get(scene);
  if (!pool) {
    pool = { free: [], all: [] };
    pools.set(scene, pool);
  }
  const l = pool.free.pop() ?? make(scene, pool);
  l.color.setHex(color);
  l.distance = distance;
  l.intensity = 0;
  return l;
}

/** Gives the light back: off, and ready to be lent again. */
export function giveLight(scene: THREE.Scene, light: THREE.PointLight): void {
  light.intensity = 0;
  pools.get(scene)?.free.push(light);
}
