// The animations from Quaternius's Universal Animation Library 1 and 2 (CC0,
// quaternius.com), cut down to the clips the game uses
// (public/models/anims/ual*.glb, keeping every bone's rotation and the
// pelvis's position): the agent's idle, walk and crouches, the mantle onto a platform, the
// takedown, the drop off a pipe, the wall climb and hang, carrying a body, the dash's sprint and
// slide, and, on the guards, a flinch and the limp pose of a body being carried.
//
// The library comes on the same skeleton as the Universal Base Characters (skins.ts), which are
// every body in the game, with its bones named as that rig's are: renamed on load to the
// Mixamo-style names the rest of the game looks bones up by ("mixamorigHips": a naming convention
// only, no Mixamo file is used), its clips' tracks with them, so retarget.ts can move a clip onto
// any of our rigs. Loaded once, however many rigs ask.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { adoptMixamoNames, mixamoName } from './skins';
import { retargetClip } from './retarget';

const URL = '/models/anims/ual.glb';
/** The agent's everyday set, cut from the first library by tools/anim/cut_ual.py (skeleton only): idle, walk, the crouch's idle, steps and enter. Small, so every player loads it. */
const MOVE_URL = '/models/anims/ual_move.glb';
/** The crawl, cut from the first library by tools/anim/cut_ual.py (skeleton only): its clips join the others once both are loaded. */
const GROUND_URL = '/models/anims/ual_ground.glb';
/** The climbing set, cut from the first library by tools/anim/cut_ual.py (skeleton only): the wall climb's enter, loop, idle and ledge pull-up, and its sideways loops (the hang's shimmy). */
const CLIMB_URL = '/models/anims/ual_climb.glb';
/** The jump (cut by tools/anim/cut_ual.py): the push-off and the landing, for coming off a wall's top. */
const JUMP_URL = '/models/anims/ual_jump.glb';
/** The guards' own: idles, walks, jogs, aims, hits and deaths. Loaded only when a guard asks, not for every player. */
const GUARDS_URL = '/models/anims/ual_guards.glb';
/** The agent's melee takedowns: a kick for a guard at its side, a sword's cut from behind (cut by tools/anim/cut_ual.py). */
const MELEE_URL = '/models/anims/ual_melee.glb';
/** The story scenes' own (cut by tools/anim/cut_ual.py): talking and tired idles, sitting, a pick-up and a drink. Loaded only when a cutscene asks. */
const STORY_URL = '/models/anims/ual_story.glb';

const MAIN_CLIPS = ['ClimbUp_1m', 'Sprint_Loop', 'Slide_Start', 'Slide_Exit', 'Melee_Hook', 'Melee_Hook_Rec', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'Walk_Carry_Loop', 'LayToIdle', 'Hit_Knockback'] as const;
const MOVE_CLIPS = ['Idle_Loop', 'Walk_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Crouch_Left_Loop', 'Crouch_Right_Loop', 'Crouch_Enter', 'Crouch_Exit'] as const;
const GROUND_CLIPS = ['Crawl_Idle_Loop', 'Crawl_Fwd_Loop', 'Crawl_Bwd_Loop', 'Crawl_Enter', 'Crawl_Exit'] as const;
const CLIMB_CLIPS = ['Climb_Enter', 'Climb_Up_Loop', 'Climb_Idle_Loop', 'ClimbLedge', 'Climb_Left_Loop', 'Climb_Right_Loop', 'Climb_Exit', 'Climb_Down_Loop'] as const;
const GUARD_CLIPS = [
  'Idle_Loop', 'Idle_LookAround_Loop', 'Idle_Torch_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Crouch_Fwd_Loop', 'Crouch_Bwd_Loop', 'Crouch_Idle_Loop', 'Pistol_Idle_Loop',
  'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Hit_Stomach', 'Hit_Head', 'Hit_Shoulder_L', 'Hit_Shoulder_R', 'Hit_Chest', 'Death01', 'Death02', 'Turn90_L', 'Turn90_R',
] as const;

const JUMP_CLIPS = ['Jump_Start', 'Jump_Land'] as const;
const STORY_CLIPS = ['Idle_Talking_Loop', 'Idle_Tired_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Sitting_Nodding_Loop', 'Sitting_Exit', 'PickUp_Table', 'Interact', 'Drink', 'Walk_Loop', 'Crying'] as const;
const MELEE_CLIPS = ['Kick', 'Sword_Attack', 'Sword_Attack_Standing', 'Punch_Jab', 'Punch_Cross'] as const;

export type UalClip = (typeof MAIN_CLIPS)[number] | (typeof MOVE_CLIPS)[number] | (typeof GROUND_CLIPS)[number] | (typeof CLIMB_CLIPS)[number] | (typeof GUARD_CLIPS)[number] | (typeof MELEE_CLIPS)[number] | (typeof JUMP_CLIPS)[number] | (typeof STORY_CLIPS)[number];

type Library = { root: THREE.Object3D; clips: THREE.AnimationClip[] };
const files = new Map<string, Promise<Library | null>>();

/** One of the library's files, loaded once: its bones and clips renamed to the Mixamo rig's, so retargeting finds them by name. */
function loadFile(url: string, optional: boolean): Promise<Library | null> {
  let file = files.get(url);
  if (!file) {
    file = new GLTFLoader().loadAsync(url).then(
      (gltf) => {
        adoptMixamoNames(gltf.scene);
        for (const clip of gltf.animations) {
          for (const track of clip.tracks) {
            const dot = track.name.lastIndexOf('.');
            const renamed = mixamoName(track.name.slice(0, dot));
            if (renamed) track.name = renamed + track.name.slice(dot);
          }
        }
        return { root: gltf.scene, clips: gltf.animations };
      },
      (error: unknown) => {
        if (optional) return null;
        throw error;
      }
    );
    files.set(url, file);
  }
  return file;
}

/** The cut files and the clips each holds; a clip held by more than one is read from the first listed, so a small file is preferred to a big one that repeats it. */
const SOURCES: ReadonlyArray<{ url: string; clips: readonly string[] }> = [
  { url: MOVE_URL, clips: MOVE_CLIPS },
  { url: GROUND_URL, clips: GROUND_CLIPS },
  { url: CLIMB_URL, clips: CLIMB_CLIPS },
  { url: JUMP_URL, clips: JUMP_CLIPS },
  { url: MELEE_URL, clips: MELEE_CLIPS },
  { url: GUARDS_URL, clips: GUARD_CLIPS },
  { url: STORY_URL, clips: STORY_CLIPS },
];

/** The files that hold `names`: the main one always (its skeleton is the retarget source), the cut ones only when a clip asked for lives in them. */
async function loadLibrary(names: readonly UalClip[]): Promise<Library> {
  const wanted = SOURCES.filter((s) => names.some((n) => !(MAIN_CLIPS as readonly string[]).includes(n) && SOURCES.find((o) => o.clips.includes(n)) === s));
  // The cut files hold just the skeleton's names and the clips: the same bones, so the tracks bind by name.
  const [main, ...cut] = await Promise.all([loadFile(URL, false), ...wanted.map((s) => loadFile(s.url, true))]);
  return { root: main!.root, clips: [...main!.clips, ...cut.flatMap((c) => c?.clips ?? [])] };
}

/** Starts fetching the library, ahead of the first ualClips() call. */
export function preloadUal(): void {
  void loadFile(URL, true);
  void loadFile(MOVE_URL, true);
  void loadFile(GROUND_URL, true);
}

/**
 * `names`, retargeted onto `target` (a Mixamo-named rig, in its rest pose
 * when this resolves: nothing may have animated it yet), keyed by name.
 * The hips keep their rise and fall (a landing crouches, a body lies on the
 * floor).
 */
export async function ualClips(target: THREE.Object3D, names: readonly UalClip[]): Promise<Map<UalClip, THREE.AnimationClip>> {
  const lib = await loadLibrary(names);
  const out = new Map<UalClip, THREE.AnimationClip>();
  for (const name of names) {
    const clip = lib.clips.find((c) => c.name === name);
    if (clip) out.set(name, retargetClip(clip, lib.root, target, 30, true));
  }
  return out;
}

/** Turns `bone` by `angle` about a world-space `axis` through it. */
export function turnAbout(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(parent.invert()), angle));
  bone.updateMatrixWorld(true);
}

/** Swings `bone` so the direction from it to `child` points straight down. */
export function hangDown(bone: THREE.Object3D, child: THREE.Object3D): void {
  const from = bone.getWorldPosition(new THREE.Vector3());
  const dir = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, -1, 0));
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
  bone.updateMatrixWorld(true);
}
