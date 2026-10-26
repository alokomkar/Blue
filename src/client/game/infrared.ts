// Infrared (the mockup's fifth section): the night-vision goggles' second mode. The room goes dark and grainy (postfx.ts's uIr), and every guard and dog within RANGE_M shows through
// the walls as itself: its own model drawn as a silhouette (the whole scene redrawn for those models only, in one flat value that carries how near it is), then turned into a red
// outline with a faint red-lined fill, hotter and brighter the nearer. A ring on the floor marks the edge of the range. Nothing here adds a light, so nothing recompiles.

import * as THREE from 'three';

export const INFRARED_RANGE_M = 14;
const HEAT_LAYER = 2; // (postfx.ts uses 1 for bloom)
const SCALE = 0.75; // the silhouette is drawn at this fraction of the screen
const MIN_HEAT = 0.06;

export type HeatSource = { root: THREE.Object3D; x: number; z: number };

const QUAD_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const QUAD_FRAG = `
  uniform sampler2D tMask;
  uniform vec2 uTexel;
  uniform float uRows;
  varying vec2 vUv;
  float cover(vec2 uv) { return step(0.01, texture2D(tMask, uv).r); }
  void main() {
    vec4 m = texture2D(tMask, vUv);
    float inside = step(0.01, m.r);
    float heat = m.r;
    // The outline: the pixels just outside the silhouette, found by looking two pixels each way.
    float around = 0.0;
    float nearHeat = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = 6.2831853 * float(i) / 8.0;
      vec2 off = vec2(cos(a), sin(a)) * uTexel * 2.0;
      float c = cover(vUv + off);
      around = max(around, c);
      nearHeat = max(nearHeat, c * texture2D(tMask, vUv + off).r);
    }
    float edge = clamp(around - inside, 0.0, 1.0);
    float lines = 0.55 + 0.45 * step(0.5, fract(vUv.y * uRows));
    vec3 hot = mix(vec3(0.85, 0.08, 0.05), vec3(1.0, 0.5, 0.38), clamp(max(heat, nearHeat), 0.0, 1.0));
    float a = edge * 0.95 + inside * 0.26 * lines;
    gl_FragColor = vec4(hot, a);
  }`;

export class Infrared {
  /** The ring on the floor at the edge of the range: the only thing drawn the ordinary way. */
  readonly scene = new THREE.Scene();
  private readonly ring: THREE.Mesh;
  private readonly mask = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
  private readonly heatOf = new WeakMap<THREE.Object3D, number>();
  private readonly hooked = new WeakSet<THREE.Object3D>();
  private readonly rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  /** How many heat signatures are in range this frame. */
  count = 0;

  constructor() {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(INFRARED_RANGE_M - 0.035, INFRARED_RANGE_M + 0.035, 96), new THREE.MeshBasicMaterial({ color: 0x4cff8a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 8;
    this.scene.add(this.ring);
    this.quad = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uRows: { value: 100 } },
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quad));
  }

  /** The models of the guards and dogs on the agent's floor, with where each stands: those within range are given their heat. */
  update(px: number, py: number, pz: number, sources: HeatSource[]): void {
    let count = 0;
    for (const s of sources) {
      const d = Math.hypot(s.x - px, s.z - pz);
      const heat = d >= INFRARED_RANGE_M ? 0 : Math.max(MIN_HEAT, 1 - d / INFRARED_RANGE_M);
      if (heat > 0) count++;
      this.heatOf.set(s.root, heat);
      if (this.hooked.has(s.root)) continue;
      this.hooked.add(s.root);
      s.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh)) return;
        o.layers.enable(HEAT_LAYER);
        const before = o.onBeforeRender;
        // In the silhouette pass the flat value is this body's heat (in any other pass the material is the model's own, and left alone).
        o.onBeforeRender = (r, sc, cam, geo, material, group) => {
          before.call(o, r, sc, cam, geo, material, group);
          if (material === this.mask) this.mask.color.setScalar(this.heatOf.get(s.root) ?? 0);
        };
      });
    }
    this.ring.position.set(px, py + 0.05, pz);
    this.count = count;
  }

  /** Draws the silhouettes and the outline over the finished frame. */
  draw(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(2, Math.round(this.size.x * SCALE));
    const h = Math.max(2, Math.round(this.size.y * SCALE));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const clear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const mask = camera.layers.mask;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    camera.layers.set(HEAT_LAYER);
    const was = scene.overrideMaterial;
    scene.overrideMaterial = this.mask;
    renderer.render(scene, camera);
    scene.overrideMaterial = was;
    camera.layers.mask = mask;
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.clearDepth();
    (this.quad.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    this.quad.uniforms.uRows!.value = h / 3;
    renderer.render(this.quadScene, this.quadCam);
    renderer.render(this.scene, camera);
    renderer.autoClear = clear;
  }

  dispose(): void {
    this.rt.dispose();
    this.mask.dispose();
    this.quad.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
