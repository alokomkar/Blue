// Post-processing: selective bloom — only objects explicitly tagged with
// markBloom() (laser beams, document fragments, screens, server LEDs, light
// fixtures, flares, tracers…) glow; nothing else does.
//
// Plain threshold bloom was tried first and doesn't work in this game: the
// player's torch pool on a nearby wall is brighter in HDR than any emissive
// prop (emissives here sit around 0.3–1.7 linear), so no luminance threshold
// separates them — a low one turns the torch pool into a blinding blob, a
// high one blooms nothing. Tagging is the standard fix (three.js's own
// webgl_postprocessing_unreal_bloom_selective example): each frame, render
// the scene once with every *untagged* mesh swapped to flat black (still
// writing depth, so a wall still hides a laser behind it), bloom that, then
// add just the bloom halo onto the normal render.
//
// GTAO ambient occlusion was also tried and measured, then dropped: at sane
// radii it visibly changed under 2% of pixels in a typical frame (the scene
// is almost entirely dark outside small lit pools, so there's little for
// contact shadow to darken) while being the most expensive pass in the chain.
//
// Black edges (EdgePass): an optional ink line round every shape and along every crease, found from the depth buffer alone (no second render of the scene): a pixel whose
// neighbours do not lie in its own plane is on an edge. The line goes on the nearer side of a silhouette; emissive things (lasers, screens, fixtures) are left unlined so they still glow.
//
// A final grading pass (vignette, split tone, film grain) runs after
// OutputPass, in display space.
//
// Tone mapping moves from the renderer into OutputPass: with an
// EffectComposer the scene renders into a linear HalfFloat target where
// renderer.toneMapping isn't applied, so OutputPass applies the renderer's
// existing ACES tone mapping + sRGB conversion at the very end.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLOOM_LAYER = 1;
const BLOOM_STRENGTH = 0.7; // 1.1 tinted the whole corridor (and the player standing in it) red around a laser trap — hurt readability
const BLOOM_RADIUS = 0.25;
const MSAA_SAMPLES = 4; // the renderer's own `antialias: true` doesn't apply to offscreen targets, so without this every edge goes jaggy

const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);

/** Tags every mesh under `root` to glow. Keeps layer 0 enabled, so it still renders normally too. */
export function markBloom(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.layers.enable(BLOOM_LAYER);
  });
}

export type PostFX = {
  grade: ShaderPass;
  edges: EdgePass;
  scene: THREE.Scene;
  bloomComposer: EffectComposer;
  finalComposer: EffectComposer;
  bloom: UnrealBloomPass;
  darkMaterial: THREE.MeshBasicMaterial;
  stashed: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  camera: THREE.Camera;
  /** Infrared's guards and dogs through the walls (infrared.ts), drawn over the finished frame while `on`. */
  heat: { draw: ((renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) => void) | null; on: boolean };
};

export function buildPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): PostFX {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = renderer.getPixelRatio();

  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  // Threshold 0: in the bloom render everything untagged is black, so
  // whatever has any brightness at all is, by construction, meant to glow.
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, 0);
  bloomComposer.addPass(bloom);

  // renderTargetsHorizontal[0] holds the bloom pass's composited halo on
  // its own (half resolution — fine for a blur). Adding that, rather than
  // the bloom composer's final output, avoids counting each tagged object's
  // own pixels twice (UnrealBloomPass blends its halo over its input).
  const mix = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloom.renderTargetsHorizontal[0]!.texture },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(bloomTexture, vUv).rgb, 0.0); }',
    }),
    'baseTexture'
  );
  mix.needsSwap = true;

  // The depth is kept (a texture) for the edge pass; the composer's second target is a clone of this one, so it gets its own.
  const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: MSAA_SAMPLES, stencilBuffer: true, depthTexture: new THREE.DepthTexture(w * pr, h * pr, THREE.UnsignedInt248Type, undefined, undefined, undefined, undefined, undefined, undefined, THREE.DepthStencilFormat) });
  const finalComposer = new EffectComposer(renderer, target);
  finalComposer.addPass(new RenderPass(scene, camera));
  const edges = new EdgePass(camera as THREE.PerspectiveCamera);
  edges.enabled = edgesPreferred();
  finalComposer.addPass(edges);
  finalComposer.addPass(mix);
  finalComposer.addPass(new OutputPass());

  // Final grade, in display space after tone mapping: a soft vignette,
  // cool shadows / warm highlights, and faint animated film grain.
  const grade = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uBullet: { value: 0 },
        uShadowTint: { value: new THREE.Vector3(...GRADES.campus.shadow) },
        uHighTint: { value: new THREE.Vector3(...GRADES.campus.high) },
        uSat: { value: GRADES.campus.sat },
        uVig: { value: GRADES.campus.vignette },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uNight; // night-vision goggles, 0 off to 1 on
        uniform float uBullet; // bullet time, 0 off to 1 full: colour drains to cold blue-grey, the edges split into fringes and the corners close in
        uniform vec3 uShadowTint; // the place's colour grade (GRADES): what the shadows lean toward, and the highlights
        uniform vec3 uHighTint;
        uniform float uSat;
        uniform float uVig; // how dark the vignette goes at the corners (1 = not at all)
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c;
          if (uBullet > 0.01) {
            vec2 ca = (vUv - 0.5) * 0.007 * uBullet;
            c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
          } else c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          c += mix(uShadowTint, uHighTint, smoothstep(0.1, 0.7, l));
          float v = smoothstep(1.05, 0.35, length(vUv - 0.5) * 1.25);
          c *= mix(uVig, 1.0, v);
          float grain = hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
          c += grain * 0.035;
          // Night vision: brightness amplified onto green phosphor, with heavy grain, faint scan lines and the round edge of the tube.
          float amp = pow(clamp(l * 1.8, 0.0, 1.0), 0.7);
          vec3 nv = vec3(0.32, 1.0, 0.45) * (amp + grain * 0.14) * (0.94 + 0.06 * sin(vUv.y * 900.0));
          vec2 tube = (vUv - 0.5) * vec2(1.0, 0.72);
          nv *= smoothstep(0.62, 0.42, length(tube));
          c = mix(c, nv, uNight);
          // Bullet time: most of the colour goes, what is left leans cold, the contrast stiffens and the corners close in.
          float bl = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec3 cold = vec3(bl * 0.78, bl * 0.95, bl * 1.3);
          c = mix(c, mix(vec3(bl), cold, 0.7) * 1.06, uBullet * 0.8);
          c *= 1.0 - uBullet * 0.4 * smoothstep(0.3, 0.85, length(vUv - 0.5) * 1.5);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    })
  );
  finalComposer.addPass(grade);

  return { grade, edges, scene, bloomComposer, finalComposer, bloom, darkMaterial: new THREE.MeshBasicMaterial({ color: 0x000000 }), stashed: new Map(), camera, heat: { draw: null, on: false } };
}

/** A touch screen is the main (or any) pointer: a phone or tablet. */
export function coarsePointer(): boolean {
  try {
    // `?coarse=1|0` on localhost: to try the touch-screen settings on a desktop.
    if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
      const q = new URLSearchParams(window.location.search).get('coarse');
      if (q === '1' || q === '0') return q === '1';
    }
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * The renderer's pixel ratio: the device's, up to 2, but at most 1.5 on a touch screen while the black edges are on: the edge pass runs once for every pixel and a phone's screen has a great many
 * (the cost of the lines goes with the square of this).
 */
export function renderPixelRatio(edgesOn: boolean): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, edgesOn && coarsePointer() ? 1.5 : 2);
}

/** Edges are on by default only where there is a mouse: no touch screen as the main pointer. */
function desktopDefault(): boolean {
  return !coarsePointer();
}

/** Whether the black edges are on: the choice kept in this browser (the controls sheet), or `?edges=1|0` on localhost; with no choice, on for a desktop and off for a touch screen. */
const EDGES_KEY = 'mazeHeist.edges';
export function edgesPreferred(): boolean {
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
      const q = new URLSearchParams(window.location.search).get('edges');
      if (q === '1') return true;
      if (q === '0') return false;
    }
    // The player's own choice wins; with none, on for a desktop (a mouse), off for a phone or tablet (a touch screen: slower, and a smaller picture to ink).
    const saved = window.localStorage.getItem(EDGES_KEY);
    if (saved === '1' || saved === '0') return saved === '1';
  } catch {
    // Storage blocked: the default below.
  }
  return desktopDefault();
}

/** Remembers the choice of black edges in this browser. */
export function rememberEdges(on: boolean): void {
  try {
    window.localStorage.setItem(EDGES_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: it holds for this visit.
  }
}

// Characters (the agents, guards, dogs, drones) get no ink: their meshes write 1 into the stencil buffer, and the edge pass draws only where it is not 1.
const characters = new WeakMap<THREE.Scene, Set<THREE.Object3D>>();

/** Keeps `root` (an agent, a guard, a dog, a drone) free of the black edges. Its meshes are found each frame, so a model that loads later is covered too. */
export function markCharacter(scene: THREE.Scene, root: THREE.Object3D): void {
  let set = characters.get(scene);
  if (!set) characters.set(scene, (set = new Set()));
  set.add(root);
}

function tagStencil(mat: THREE.Material): void {
  if (mat.userData.edgeFree) return;
  mat.userData.edgeFree = true;
  mat.stencilWrite = true;
  mat.stencilFunc = THREE.AlwaysStencilFunc;
  mat.stencilRef = 1;
  mat.stencilZPass = THREE.ReplaceStencilOp;
  mat.stencilFail = THREE.KeepStencilOp;
  mat.stencilZFail = THREE.KeepStencilOp;
}

function tagCharacters(scene: THREE.Scene): void {
  const set = characters.get(scene);
  if (!set) return;
  for (const root of set) {
    if (!root.parent) {
      set.delete(root);
      continue;
    }
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m && (o as THREE.Mesh).isMesh) for (const mat of Array.isArray(m) ? m : [m]) tagStencil(mat);
    });
  }
}

/**
 * The edge pass: draws over the scene in place (multiplying the colour down where a pixel is on an edge, adding a faint light band beside it), from the scene's own depth. It does not
 * swap buffers, so it can use the render target's stencil buffer to leave the characters alone.
 */
class EdgePass extends Pass {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  constructor(cam: THREE.PerspectiveCamera) {
    super();
    this.cam = cam;
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({
      // A touch screen gets the lite lines: no light band beside them (four depth reads fewer a pixel). A phone's GPU is what gets hot.
      defines: coarsePointer() ? { LITE: '' } : {},
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uInvProj: { value: new THREE.Matrix4() },
        uThick: { value: 1.2 },
        uStrength: { value: 0.92 },
        uLo: { value: 0.3 },
        uHi: { value: 0.65 },
        uFade: { value: 38 },
        uNear: { value: 0.3 },
        uLift: { value: 0.03 },
        uDepthEps: { value: 1.5e-5 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform mat4 uInvProj;
        uniform float uThick;      // line width in pixels
        uniform float uStrength;   // how black the line goes
        uniform float uLo;         // an edge starts to show at this angle off the plane (as a sine), and is full at uHi
        uniform float uHi;
        uniform float uFade;       // lines fade out by this distance
        uniform float uLift;       // how bright the band beside a line is
        uniform float uNear;       // the camera's near plane, and how fine its depth buffer is (a fraction of a unit of 1/z)
        uniform float uDepthEps;
        varying vec2 vUv;
        vec3 pos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        float off(vec3 q, vec3 pc, vec3 n, float dz) {
          vec3 v = q - pc;
          float len = length(v);
          // The angle the neighbour makes with this pixel's plane (the sine of it): 0 on the same plane, near 1 across a crease or off a silhouette. A neighbour that is clearly nearer belongs
          // to another, nearer object, so the line goes on the near side. The depth buffer is not exact: a neighbour within dz of the plane is on it.
          if (q.z > pc.z + 0.7 * len) return 0.0;
          return max(abs(dot(n, v)) - dz, 0.0) / len;
        }
        void main() {
          float d0 = texture2D(tDepth, vUv).x;
          if (d0 > 0.99999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec2 o = uTexel * uThick;
          vec3 pc = pos(vUv);
          // Lines fade out by uFade metres: nothing further is worked out at all.
          if (-pc.z > uFade) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 pr = pos(vUv + vec2(o.x, 0.0));
          vec3 pl = pos(vUv - vec2(o.x, 0.0));
          vec3 pu = pos(vUv + vec2(0.0, o.y));
          vec3 pd = pos(vUv - vec2(0.0, o.y));
          vec3 dx = abs(pr.z - pc.z) < abs(pl.z - pc.z) ? pr - pc : pc - pl;
          vec3 dy = abs(pu.z - pc.z) < abs(pd.z - pc.z) ? pu - pc : pc - pd;
          vec3 n = normalize(cross(dx, dy));
          float dz = pc.z * pc.z * uDepthEps / uNear;
          float e = max(max(off(pr, pc, n, dz), off(pl, pc, n, dz)), max(off(pu, pc, n, dz), off(pd, pc, n, dz)));
          // A surface seen almost edge-on (a long floor, a far wall) cannot be told from a crease by its depth: the multisampled depth wobbles by a fraction of a pixel there.
          float graze = smoothstep(0.14, 0.4, abs(dot(n, normalize(pc))));
          float edge = smoothstep(uLo, uHi, e) * graze;
          // The scene is dark, and a black line on black cannot be seen: a faint, narrow light band along each side of a line gives the ink something to sit against (the same test, at a wider step).
          #ifdef LITE
          float halo = 0.0;
          #else
          vec2 o2 = o * 2.6;
          float e2 = max(max(off(pos(vUv + vec2(o2.x, 0.0)), pc, n, dz), off(pos(vUv - vec2(o2.x, 0.0)), pc, n, dz)), max(off(pos(vUv + vec2(0.0, o2.y)), pc, n, dz), off(pos(vUv - vec2(0.0, o2.y)), pc, n, dz)));
          float halo = smoothstep(uLo, uHi, e2) * graze * (1.0 - edge);
          #endif
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float lit = 1.0 - smoothstep(1.5, 4.0, l);
          float fade = 1.0 - smoothstep(uFade * 0.5, uFade, -pc.z);
          vec3 add = uLift * halo * (1.0 - smoothstep(0.0, 0.12, l)) * fade * vec3(0.9, 1.0, 1.1);
          float mul = 1.0 - edge * uStrength * lit * fade;
          gl_FragColor = vec4(add, mul); // blended as: colour = add + colour * mul
        }`,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilRef: 1,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse!.value = readBuffer.texture;
    u.tDepth!.value = readBuffer.depthTexture;
    (u.uTexel!.value as THREE.Vector2).set(1 / readBuffer.width, 1 / readBuffer.height);
    (u.uInvProj!.value as THREE.Matrix4).copy(this.cam.projectionMatrixInverse);
    u.uNear!.value = this.cam.near;
    u.uThick!.value = 1.5 * renderer.getPixelRatio();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = auto;
  }
  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

const hiddenForBloom: THREE.Object3D[] = [];

export function renderPostFX(fx: PostFX, dt: number): void {
  tagCharacters(fx.scene); // (before the bloom pass swaps their materials)
  fx.scene.traverseVisible((o) => {
    // See-through effects (torch beam, dust, vision cones) would turn into
    // opaque black occluders under darkMaterial — hide them for this pass.
    if (o.userData.fx) {
      o.visible = false;
      hiddenForBloom.push(o);
      // They do not write depth either: the edge pass reads the depth buffer, and a glow's layers are not surfaces.
      const m = o instanceof THREE.Mesh ? o.material : null;
      if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.depthWrite = false;
    } else if (o instanceof THREE.Mesh && !bloomLayer.test(o.layers)) {
      fx.stashed.set(o, o.material);
      o.material = fx.darkMaterial;
    }
  });
  // One shadow update per frame, in the first render (the bloom pass, whose swapped-in black materials don't matter to the depth passes); the second reuses it. Every frame: the agent's torch
  // moves with it (a shadow redrawn only every other frame shows as the agent and its shadow shaking when it walks). The ceiling lights' own maps, which barely change, are redrawn less often
  // (lightbudget.ts).
  fx.bloomComposer.renderer.shadowMap.needsUpdate = true;
  fx.bloomComposer.render(dt);
  for (const [mesh, mat] of fx.stashed) mesh.material = mat;
  fx.stashed.clear();
  for (const o of hiddenForBloom) o.visible = true;
  hiddenForBloom.length = 0;
  fx.grade.uniforms.uTime!.value = performance.now() / 1000;
  // The bloom pass has already brought every object's matrix up to date this frame; walking the scene again is wasted.
  const auto = fx.scene.matrixWorldAutoUpdate;
  fx.scene.matrixWorldAutoUpdate = false;
  fx.finalComposer.render(dt);
  fx.scene.matrixWorldAutoUpdate = auto;
  if (fx.heat.on && fx.heat.draw) fx.heat.draw(fx.finalComposer.renderer, fx.camera, fx.scene);
}

/** A place's colour grade, applied last: what its shadows lean toward and its highlights, how saturated, and how dark the corners go. */
export type Grade = { shadow: [number, number, number]; high: [number, number, number]; sat: number; vignette: number };

/** One per place (locations.ts): the same game, but a campus at night reads cool and clean, a museum warm and gilded, a refinery sodium and sick-green, a bank steel, a warehouse dusty, a lab chill. */
export const GRADES: Record<'campus' | 'museum' | 'refinery' | 'bank' | 'warehouse' | 'lab', Grade> = {
  campus: { shadow: [-0.012, 0, 0.028], high: [0.03, 0.012, -0.018], sat: 1, vignette: 0.62 },
  museum: { shadow: [0.022, 0.006, -0.012], high: [0.05, 0.024, -0.034], sat: 1.06, vignette: 0.55 },
  refinery: { shadow: [-0.022, 0.014, 0.004], high: [0.055, 0.024, -0.046], sat: 1.12, vignette: 0.58 },
  bank: { shadow: [-0.016, 0.004, 0.044], high: [-0.004, 0.012, 0.036], sat: 0.88, vignette: 0.6 },
  warehouse: { shadow: [0.002, 0.008, -0.012], high: [0.04, 0.028, -0.024], sat: 0.94, vignette: 0.6 },
  lab: { shadow: [-0.03, 0.016, 0.03], high: [-0.012, 0.034, 0.024], sat: 1, vignette: 0.66 },
};

/** Switches the colour grade to a place's. */
export function setGrade(fx: PostFX, place: keyof typeof GRADES): void {
  const g = GRADES[place];
  (fx.grade.uniforms.uShadowTint!.value as THREE.Vector3).set(...g.shadow);
  (fx.grade.uniforms.uHighTint!.value as THREE.Vector3).set(...g.high);
  fx.grade.uniforms.uSat!.value = g.sat;
  fx.grade.uniforms.uVig!.value = g.vignette;
}

/** How far night vision is on, 0 to 1 (eased in and out by game.ts). */
export function setNightVision(fx: PostFX, amount: number): void {
  fx.grade.uniforms.uNight!.value = amount;
}

/** How far bullet time is in, 0 to 1 (eased by game.ts). */
export function setBulletTime(fx: PostFX, k: number): void {
  fx.grade.uniforms.uBullet!.value = k;
}

export function resizePostFX(fx: PostFX, width: number, height: number): void {
  const pr = fx.finalComposer.renderer.getPixelRatio();
  fx.bloomComposer.setPixelRatio(pr);
  fx.finalComposer.setPixelRatio(pr);
  fx.bloomComposer.setSize(width, height);
  fx.finalComposer.setSize(width, height);
}

/** Frees the composers' GPU render targets — each job builds a fresh PostFX, so the previous job's must be released or they accumulate. */
export function disposePostFX(fx: PostFX): void {
  fx.bloom.dispose();
  fx.bloomComposer.dispose();
  fx.finalComposer.dispose();
  fx.darkMaterial.dispose();
}
