// Agent portraits for the pick screen, rendered live from the same models
// the game uses (so they always match the agent you'll play, and can show
// an outfit later) rather than shipped as pictures. One small offscreen
// renderer poses each agent in the library's idle (ual.ts) and draws it.
//
// The models are megabytes on a phone's connection, so nothing is redone
// that doesn't have to be: each file is fetched and parsed once (a portrait
// works on a clone), one renderer serves every draw, a portrait is handed
// over the moment it's drawn rather than when both are, and the pick screen
// draws the look you haven't picked in the background (warmPortraits), so
// tapping it is usually instant.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { BODY_HEIGHT, dressAgent, standTall, type Body } from './outfit';
import { ualClips } from './ual';
import { adoptMixamoNames, attachHair, paintSuit, skinFor, DEFAULT_STYLE, type Style } from './skins';
import type { Look } from '../../shared/api';

const W = 240;
const H = 320;
const POSE_AT_S = 0.6; // a moment into the idle, off the T-pose

export type Portraits = Partial<Record<Body, string>>;

/** A draw under way or done: what's drawn so far, who wants to hear as each finishes, and the whole when it's over. */
type Job = { promise: Promise<Portraits>; done: Portraits; listeners: Set<(body: Body, url: string) => void>; finished: boolean };
const jobs = new Map<string, Job>();

const keyOf = (look: Look, style: Style): string => (look === 'classic' ? look : `${look}:${style.suit}:${style.hair}`);

/** Whether the portraits for `look` (and `style`) are already drawn, so showing them costs nothing. */
export function portraitsReady(look: Look, style: Style = DEFAULT_STYLE): boolean {
  return jobs.get(keyOf(look, style))?.finished === true;
}

/**
 * A picture of each body in `look` (and `style`), as an image URL; bodies that fail to load are left out. Drawn
 * once per look. `onEach` hears each portrait as it's drawn (at once for those already drawn).
 */
export function renderPortraits(bodies: Body[], look: Look = 'classic', style: Style = DEFAULT_STYLE, onEach?: (body: Body, url: string) => void): Promise<Portraits> {
  const key = keyOf(look, style);
  let job = jobs.get(key);
  if (!job) {
    const made: Job = { promise: Promise.resolve({}), done: {}, listeners: new Set(), finished: false };
    made.promise = draw(bodies, look, style, made).finally(() => {
      made.finished = true;
    });
    jobs.set(key, made);
    job = made;
  }
  if (onEach) {
    for (const [body, url] of Object.entries(job.done)) onEach(body as Body, url);
    if (!job.finished) job.listeners.add(onEach);
  }
  return job.promise;
}

/** Gets the portraits for `look` drawn (and its models fetched) in the background, ahead of anyone asking. */
export function warmPortraits(look: Look, style: Style = DEFAULT_STYLE): void {
  void renderPortraits(['male', 'female'], look, style);
}

// ---- shared pieces, made once ----

const loader = new GLTFLoader();
const files = new Map<string, Promise<GLTF>>();
/** A model file, fetched and parsed once. */
const load = (url: string): Promise<GLTF> => {
  let f = files.get(url);
  if (!f) {
    f = loader.loadAsync(url);
    // A failed fetch is tried again next time.
    f.catch(() => files.delete(url));
    files.set(url, f);
  }
  return f;
};

let stage: { renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera } | null = null;
function theStage(): NonNullable<typeof stage> {
  if (stage) return stage;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  camera.position.set(0, 1.0, 3.9);
  camera.lookAt(0, 0.9, 0);
  stage = { renderer, camera };
  return stage;
}

async function draw(bodies: Body[], look: Look, style: Style, job: Job): Promise<Portraits> {
  const skins = bodies.map((body) => ({ body, skin: skinFor(body, look, style) }));
  // Everything wanted starts downloading at once; each body is drawn as soon as its own files are in.
  for (const { skin } of skins) for (const url of [skin.url, ...skin.hair]) void load(url).catch(() => undefined);
  const { renderer, camera } = theStage();

  for (const { body, skin } of skins) {
    try {
      const [gltf, ...hair] = await Promise.all([skin.url, ...skin.hair].map(load));
      // A clone, so the file stays as loaded for the next look (it's renamed, painted and dressed below).
      const model = clone(gltf!.scene);
      if (skin.mannequin) adoptMixamoNames(model);
      if (skin.suit !== null) paintSuit(model, skin.suit, skin.scalp, skin.skinTone);
      for (const piece of hair) attachHair(model, clone(piece.scene));
      // (The plates are fitted in the bind pose, before the body is scaled.)
      if (skin.armour !== null) dressAgent(model, { body: body, suit: null, armour: skin.armour, trim: 0x6fe0ff, helmet: false });
      standTall(model, BODY_HEIGHT[body]);
      const foot = model.getObjectByName('mixamorigLeftFoot')!.getWorldPosition(new THREE.Vector3());
      const toe = model.getObjectByName('mixamorigLeftToe_End')!.getWorldPosition(new THREE.Vector3());
      // Facing the camera, turned a little to one side.
      model.rotation.y = -Math.atan2(toe.x - foot.x, toe.z - foot.z) - 0.35;
      model.updateMatrixWorld(true);
      const idle = (await ualClips(model, ['Idle_Loop']).catch(() => null))?.get('Idle_Loop');
      if (idle) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idle).play();
        mixer.setTime(POSE_AT_S);
      }

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x10131a, 1.6));
      const key = new THREE.SpotLight(0xfff1dc, 160, 14, 0.7, 0.5);
      key.position.set(2.5, 4, 3.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
      fill.position.set(-2, 2, 4);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0x6fbfff, 1.6);
      rim.position.set(-3, 2.5, -3);
      scene.add(rim);
      scene.add(model);

      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/webp', 0.9);
      job.done[body] = url;
      for (const hear of job.listeners) hear(body, url);
    } catch (err) {
      console.error(`No portrait for the ${body} agent`, err);
    }
  }
  job.listeners.clear();
  return job.done;
}
