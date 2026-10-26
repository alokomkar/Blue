// A fixed budget of point lights. three.js shades every pixel against every
// light in the scene, wherever it is, so a floor's worth of corridor
// fixtures, laser glows, server hums and watchdog lamps (twenty-odd on a big
// job) costs the GPU on every pixel even though only the few near the player
// light anything on screen. Instead, every point light is taken off the
// camera's layer (so the renderer skips it) and a small pool of real lights
// mirrors whichever ones are nearest the player each frame: position,
// colour, intensity and reach. The code that owns each light keeps moving,
// dimming and recolouring it as before, and the light count the shaders are
// compiled for never changes, so nothing recompiles as the player moves.

import * as THREE from 'three';

const OFF_LAYER = 31; // no camera ever looks at this layer
const RESCAN_EVERY = 20; // frames between looks for newly added lights (flares, a loaded gun's EMP flash)
const FADE_IN_S = 0.25; // a light taking a free slot eases up rather than popping on
const SHADOW_MAP = 512; // each shadow-casting light's map
const SHADOW_RANGE = 14; // lights further than this from the focus never cast
/** The pool lights' shadow maps are redrawn this often (in frames). */
const POOL_SHADOW_EVERY = 2;
const SHADOW_STICKY = 1.5; // metres of lead a light already casting has over one that is not

type Slot = { light: THREE.PointLight; source: THREE.PointLight | null; fade: number; casting: boolean };

export class LightBudget {
  private readonly slots: Slot[] = [];
  private readonly sources = new Set<THREE.PointLight>();
  private frame = 0;

  constructor(
    private readonly scene: THREE.Scene,
    size: number,
    /** How many of the pool's lights, the nearest the focus, cast shadows (shadows.ts): the same number whichever, so nothing recompiles as they change. */
    private readonly shadowCasters = 0
  ) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1);
      light.userData.budgetPool = true;
      scene.add(light);
      this.slots.push({ light, source: null, fade: 0, casting: false });
    }
    this.adopt();
  }

  /** Takes over any point lights not yet in the budget — call it after adding one (a flare), or it's found within a few frames. */
  adopt(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.PointLight && !o.userData.budgetPool && !this.sources.has(o)) {
        o.layers.set(OFF_LAYER);
        this.sources.add(o);
      }
    });
  }

  /** Shown, and still part of the scene (a burnt-out flare is removed; the floor above is hidden while you're below it). */
  private shining(o: THREE.PointLight): boolean | 'gone' {
    if (o.intensity <= 0) return o.parent ? false : 'gone';
    let node: THREE.Object3D | null = o;
    while (node) {
      if (!node.visible) return false;
      if (node === this.scene) return true;
      node = node.parent;
    }
    return 'gone';
  }

  /** Gives the pool to the lights that matter most around (x, y, z): the nearest, allowing for how far each reaches. */
  update(x: number, y: number, z: number, dt: number): void {
    if (++this.frame % RESCAN_EVERY === 0) this.adopt();
    const ranked: Array<{ source: THREE.PointLight; score: number }> = [];
    for (const source of this.sources) {
      const state = this.shining(source);
      if (state === 'gone') {
        this.sources.delete(source);
        continue;
      }
      if (!state) continue;
      const m = source.matrixWorld.elements;
      const d = Math.hypot(m[12]! - x, m[13]! - y, m[14]! - z);
      ranked.push({ source, score: d - (source.distance || 20) * 0.5 });
    }
    ranked.sort((a, b) => a.score - b.score);
    const chosen = new Set(ranked.slice(0, this.slots.length).map((r) => r.source));

    // Lights still chosen keep their slot (no flicker from reshuffling); the rest go to newcomers.
    for (const slot of this.slots) if (slot.source && !chosen.has(slot.source)) slot.source = null;
    for (const slot of this.slots) if (slot.source) chosen.delete(slot.source);
    for (const slot of this.slots) {
      if (!slot.source) {
        const next = chosen.values().next();
        if (next.done) continue;
        slot.source = next.value;
        chosen.delete(next.value);
        slot.fade = 0;
      }
    }

    for (const slot of this.slots) {
      const { light, source } = slot;
      if (!source) {
        light.intensity = 0;
        continue;
      }
      slot.fade = Math.min(1, slot.fade + dt / FADE_IN_S);
      const m = source.matrixWorld.elements;
      light.position.set(m[12]!, m[13]!, m[14]!);
      light.color.copy(source.color);
      light.intensity = source.intensity * slot.fade;
      light.distance = source.distance;
      light.decay = source.decay;
    }
    if (this.shadowCasters > 0) this.castShadows(x, y, z);
    // The ceiling lights barely change: their shadow maps are redrawn every other frame; the agent's torch (which moves with them) every frame.
    for (const slot of this.slots) if (slot.casting) slot.light.shadow.needsUpdate = this.frame % POOL_SHADOW_EVERY === 0;
  }

  /** The pool lights nearest the focus (those already casting count as a little nearer, so two alike don't trade places every frame) cast; the rest don't. */
  private castShadows(x: number, y: number, z: number): void {
    const ranked = this.slots
      .filter((s) => s.source && s.light.intensity > 0)
      .map((s) => ({ s, d: Math.hypot(s.light.position.x - x, s.light.position.y - y, s.light.position.z - z) - (s.casting ? SHADOW_STICKY : 0) }))
      .filter((r) => r.d < SHADOW_RANGE)
      .sort((a, b) => a.d - b.d);
    const next = new Set(ranked.slice(0, this.shadowCasters).map((r) => r.s));
    for (const slot of this.slots) {
      const on = next.has(slot);
      if (on === slot.casting) continue;
      slot.casting = on;
      slot.light.castShadow = on;
      if (on) {
        const sh = slot.light.shadow;
        sh.mapSize.set(SHADOW_MAP, SHADOW_MAP);
        sh.camera.near = 0.2;
        sh.camera.far = 12;
        sh.bias = -0.0006;
        sh.normalBias = 0.04;
        sh.radius = 2;
        sh.autoUpdate = false; // (redrawn only every POOL_SHADOW_EVERY frames: see below)
      } else slot.light.shadow.dispose();
    }
  }

  /** Puts every light back to not casting (the job is over). */
  clearShadows(): void {
    for (const slot of this.slots) {
      if (!slot.casting) continue;
      slot.casting = false;
      slot.light.castShadow = false;
      slot.light.shadow.dispose();
    }
  }
}
