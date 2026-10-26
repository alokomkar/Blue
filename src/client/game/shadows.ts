// Real shadows, kept cheap. The scene is lit by dozens of ceiling point lights and the agent's torch, and none of them cast shadows: light went through walls and nothing grounded the
// crates, the guards or the agent. A shadow map per light is far too much (a point light is six renders), so:
//   - the agent's torch (a spotlight, one render) casts whenever it is on;
//   - of the lights that really shine (the pool of lightbudget.ts, which mirrors the nearest of the scene's), only SHADOW_LAMPS, the nearest the agent, cast. Swapping which cast, while
//     keeping how many do the same, doesn't make three.js rebuild its shaders.
// Which meshes cast and which receive is set once for each mesh the scene gets (tagMeshes): the opaque ones. Glowing and see-through things (beams, halos, bloom-tagged bits) don't cast,
// and the floor only receives.
// Touch screens start with shadows off (a phone in Reddit's web view has little to spare); `?shadows=1|0` forces them on localhost.

import * as THREE from 'three';

/** Whether shadows are drawn: on a mouse-and-keyboard machine, off on a touch screen, unless localhost's `?shadows=` says otherwise. */
export function shadowsWanted(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('shadows');
    if (q !== null && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) return q !== '0';
    return !window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** How many of the shining point lights (the nearest the agent) cast shadows at once (`?lamps=N` on localhost, to compare costs). */
export function shadowLamps(): number {
  try {
    const q = new URLSearchParams(window.location.search).get('lamps');
    if (q !== null && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) return Math.max(0, Math.min(4, Number(q) || 0));
  } catch {
    // No window: the unit tests.
  }
  return 2;
}

const TORCH_MAP = 1024;

const tagged = new WeakSet<THREE.Object3D>();
const BLOOM_LAYER = 1;

/** Sets cast/receive on every mesh under `root` not seen before. Cheap to call often: it skips what it has already done. */
export function tagMeshes(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (tagged.has(o)) return;
    tagged.add(o);
    if (!(o instanceof THREE.Mesh) || o.userData.fx || o.userData.noShadow) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || (m as THREE.Material).transparent || !((m as THREE.Material) instanceof THREE.MeshStandardMaterial)) return;
    const glows = o.layers.isEnabled(BLOOM_LAYER);
    // The floor tiles receive only: a floor casting onto itself is all acne.
    const floor = o instanceof THREE.InstancedMesh && o.userData.floor === true;
    o.receiveShadow = true;
    o.castShadow = !glows && !floor;
  });
}

/** Configures a spotlight to cast (the torch). */
export function setupTorchShadow(light: THREE.SpotLight): void {
  light.shadow.mapSize.set(TORCH_MAP, TORCH_MAP);
  light.shadow.camera.near = 0.15;
  light.shadow.camera.far = 14;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  light.shadow.radius = 3;
}
