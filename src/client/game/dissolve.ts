// A dissolve for any lit material: a wave runs out from a point, and whatever it has passed breaks up into small cubes, with a cyan
// glow along the leading edge, until it is gone. Done in the material's own shader (patched in once, one shared set of uniforms), so a
// whole building's contents can go at once without touching their meshes. Used by takeover.ts.

import * as THREE from 'three';

export type Dissolve = {
  /** The wave's centre (world); only x and z count. */
  origin: THREE.Vector3;
  /** How far out the wave has reached, in metres; negative is off. */
  setRadius: (r: number) => void;
  /** Patches `material` to dissolve (once; false if it isn't a kind that can). */
  patch: (material: THREE.Material) => boolean;
};

/** Metres from the wave's front to where everything behind it has gone. */
const BAND = 3;
/** Edge of a cube, in metres, is 1 / this. */
const CELLS_PER_METRE = 7;

export function makeDissolve(): Dissolve {
  const uniforms = { uDsOrigin: { value: new THREE.Vector3() }, uDsRadius: { value: -1 } };
  const done = new WeakSet<THREE.Material>();
  return {
    origin: uniforms.uDsOrigin.value,
    setRadius: (r) => {
      uniforms.uDsRadius.value = r;
    },
    patch(material) {
      const m = material as THREE.Material & Record<string, unknown>;
      const lit = m['isMeshStandardMaterial'] || m['isMeshBasicMaterial'] || m['isMeshLambertMaterial'] || m['isMeshPhongMaterial'];
      if (!lit || done.has(material)) return false;
      done.add(material);
      const before = material.onBeforeCompile;
      const key = material.customProgramCacheKey.bind(material);
      material.customProgramCacheKey = () => `${key()}|dissolve`;
      material.onBeforeCompile = (shader, renderer) => {
        before.call(material, shader, renderer);
        shader.uniforms['uDsOrigin'] = uniforms.uDsOrigin;
        shader.uniforms['uDsRadius'] = uniforms.uDsRadius;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vDsWorld;')
          .replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            vec4 dsP = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
            dsP = instanceMatrix * dsP;
            #endif
            vDsWorld = (modelMatrix * dsP).xyz;`
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying vec3 vDsWorld;
            uniform vec3 uDsOrigin;
            uniform float uDsRadius;
            float dsHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`
          )
          .replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
            float dsReach = uDsRadius - distance(vDsWorld.xz, uDsOrigin.xz);
            float dsN = dsHash(floor(vDsWorld * ${CELLS_PER_METRE}.0));
            float dsT = clamp(dsReach / ${BAND}.0, 0.0, 1.0);
            if (dsReach > 0.0 && dsN < dsT) discard;
            float dsGlow = (dsReach > 0.0 && dsN < dsT + 0.32) ? 1.0 : 0.0;
            float dsFront = dsReach > 0.0 ? clamp(1.0 - dsReach / 1.3, 0.0, 1.0) : 0.0;`
          )
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.rgb += vec3(0.08, 0.85, 1.0) * (dsGlow * 1.8 + dsFront * 1.1);');
      };
      material.needsUpdate = true;
      return true;
    },
  };
}
