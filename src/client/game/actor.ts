// A character for the story scenes (storycinema.ts): the agent's body and look, dressed as in the game, and the library's clips (ual.ts) for what a scene needs: waking, looking round,
// talking, walking, picking something up. It has no gameplay in it (no gun, torch or controls), and it is driven by the clock, not by input: `apply(clip, seconds)` shows that clip that
// many seconds in, so a scene can be played, skipped or held at any moment and look the same.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Look } from '../../shared/api';
import { BODY_HEIGHT, dressAgent, standTall, type Body } from './outfit';
import { adoptMixamoNames, attachHair, paintSuit, skinFor, DEFAULT_STYLE, type Style } from './skins';
import { markCharacter } from './postfx';
import { ualClips, type UalClip } from './ual';

export type ActorClip = 'idle' | 'look' | 'talk' | 'walk' | 'wake' | 'pickup' | 'interact' | 'tired' | 'turnL' | 'turnR' | 'sitIdle' | 'sitTalk' | 'sitNod' | 'sitDown' | 'sitUp' | 'drink';

/** The library clip each shows, and whether it plays once (and holds its last frame) or loops. */
export const ACTOR_CLIPS: Readonly<Record<ActorClip, { clip: UalClip; once: boolean }>> = {
  idle: { clip: 'Idle_Loop', once: false },
  look: { clip: 'Idle_LookAround_Loop', once: false },
  talk: { clip: 'Idle_Talking_Loop', once: false },
  walk: { clip: 'Walk_Loop', once: false },
  wake: { clip: 'LayToIdle', once: true },
  pickup: { clip: 'PickUp_Table', once: true },
  interact: { clip: 'Interact', once: true },
  tired: { clip: 'Idle_Tired_Loop', once: false },
  turnL: { clip: 'Turn90_L', once: true },
  turnR: { clip: 'Turn90_R', once: true },
  sitIdle: { clip: 'Sitting_Idle_Loop', once: false },
  sitTalk: { clip: 'Sitting_Talking_Loop', once: false },
  sitNod: { clip: 'Sitting_Nodding_Loop', once: false },
  sitDown: { clip: 'Sitting_Enter', once: true },
  sitUp: { clip: 'Sitting_Exit', once: true },
  drink: { clip: 'Drink', once: true },
};

/** The clip's own time for `seconds` into it: wrapped for a loop, held at the end for a clip that plays once. */
export function clipTime(duration: number, seconds: number, once: boolean): number {
  if (duration <= 0) return 0;
  const s = Math.max(0, seconds);
  return once ? Math.min(s, duration) : s % duration;
}

export class Actor {
  readonly group = new THREE.Group();
  /** Resolves once the body and its clips are loaded (a scene waits for it before it plays). */
  readonly ready: Promise<void>;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<ActorClip, THREE.AnimationAction>();

  constructor(scene: THREE.Scene, private readonly body: Body, look: Look, style: Style = DEFAULT_STYLE) {
    scene.add(this.group);
    markCharacter(scene, this.group);
    this.ready = this.load(look, style);
  }

  private async load(look: Look, style: Style): Promise<void> {
    const loader = new GLTFLoader();
    const skin = skinFor(this.body, look, style);
    const [agent, ...hair] = await Promise.all([skin.url, ...skin.hair].map((url) => loader.loadAsync(url)));
    const model = agent!.scene;
    if (skin.mannequin) adoptMixamoNames(model);
    if (skin.suit !== null) paintSuit(model, skin.suit, skin.scalp, skin.skinTone);
    for (const piece of hair) attachHair(model, piece.scene);
    // (The plates are fitted in the bind pose, before the body is scaled.)
    if (skin.armour !== null) dressAgent(model, { body: this.body, suit: null, armour: skin.armour, trim: 0x6fe0ff, helmet: false });
    standTall(model, BODY_HEIGHT[this.body]);
    // Turned to face +Z, the group's forward: the way its toes point.
    model.updateMatrixWorld(true);
    const foot = model.getObjectByName('mixamorigLeftFoot')!.getWorldPosition(new THREE.Vector3());
    const toe = model.getObjectByName('mixamorigLeftToe_End')!.getWorldPosition(new THREE.Vector3());
    model.rotation.y = -Math.atan2(toe.x - foot.x, toe.z - foot.z);
    model.updateMatrixWorld(true);
    const clips = await ualClips(model, Object.values(ACTOR_CLIPS).map((c) => c.clip));
    this.group.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, { clip, once }] of Object.entries(ACTOR_CLIPS) as Array<[ActorClip, { clip: UalClip; once: boolean }]>) {
      const c = clips.get(clip);
      if (!c) continue;
      const action = this.mixer.clipAction(c);
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = true;
      action.play();
      action.weight = 0;
      this.actions.set(name, action);
    }
    this.apply('idle', 0);
  }

  /** Where it stands, which way it faces (0 is +Z) and how high off the floor. */
  place(x: number, z: number, facing: number, y = 0): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = facing;
  }

  /** How long a clip runs, in seconds (0 until it is loaded). */
  duration(clip: ActorClip): number {
    return this.actions.get(clip)?.getClip().duration ?? 0;
  }

  /**
   * Shows `clip` `seconds` in, blended with `from` (the clip it was in, `fromSeconds` in) by `blend`, 0 for all of `from` and 1 for all of `clip`.
   * The same inputs always give the same pose.
   */
  apply(clip: ActorClip, seconds: number, from?: { clip: ActorClip; seconds: number }, blend = 1): void {
    if (!this.mixer) return;
    for (const [name, action] of this.actions) {
      const isNext = name === clip;
      const isFrom = from !== undefined && name === from.clip && name !== clip;
      action.weight = isNext ? (from && from.clip !== clip ? blend : 1) : isFrom ? 1 - blend : 0;
      if (action.weight > 0) {
        const spec = ACTOR_CLIPS[name];
        action.time = clipTime(action.getClip().duration, isNext ? seconds : from!.seconds, spec.once);
      }
    }
    this.mixer.update(0);
  }
}
