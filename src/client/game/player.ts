// Player: free, continuous third-person movement — turn + throttle relative
// to the player's own facing, not the 2D game's grid-snapped tryMove() or
// fixed compass directions. Modeled after Three.js's own walk-character
// example (threejs.org/examples/#webgl_animation_walk): movement is
// relative to facing (forward/back + turn), and the camera just trails
// behind — here the camera has no free orbit, so "trails behind" is exactly
// "stays locked behind current facing," which turning drives directly.
// Collision is an AABB check ported from
// blueprint/prototype-3d-thirdperson.html:409-416.
//
// The visible character is the agent picked on the mission brief (outfit.ts,
// skins.ts: one of Quaternius's Universal Base Characters, CC0), loaded async
// and swapped in once ready — see loadAgent() below. They come without
// animation, so the idle, walk, crouching set (crouch idle, crouch walk, crouch
// steps left and right, ducking into cover) and the wall hang all come from
// Quaternius's Universal Animation Library (ual.ts, public/models/anims/, CC0),
// retargeted onto the agent (retarget.ts).
//
// The stun gun (weapon.ts) is attached to the loaded model's right-hand
// bone once it's ready (fitted to that hand's bones, equipStunGunInFist),
// so shots have a visible origin point (muzzleWorldPosition) for the tracer
// effect in weapon.ts/game.ts. Since the Idle/Walk clips have no weapon-holding pose (they're plain
// locomotion animations), both arms are held via a small CCD IK
// solve (ik.ts) each frame instead: the primary (right) hand is pinned to a
// stable "ready" spot in front of the chest, and the support (left) hand
// aims at the gun's foregrip — layered on top of whatever the current
// animation clip is doing, not baked into it. Both targets are clamped to
// each chain's actual measured reach (ik.ts's clampToReach/chainReach)
// before solving — an earlier version used a blindly-guessed target
// position, which for some poses landed beyond what the arm could actually
// reach, forcing it fully straight (a stiff, visibly "sticking out" arm,
// not a held one) instead of a natural elbow bend.

import { markCharacter } from './postfx';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BODY_HEIGHT, dressAgent, standTall, type Body } from './outfit';
import { adoptMixamoNames, attachHair, paintSuit, skinFor, DEFAULT_STYLE, type Style } from './skins';
import type { Look } from '../../shared/api';
import { blendClips, leanClip, narrowWalkStance, retimeClip } from './retarget';
import { DROP_S, HOP_CLIP_S, JUMP_CLIP_S, MOUNT_CLIP_S, SHIMMY_CLIP_S } from './highwall';
import { strapLamp, type ShoulderLamp } from './lamp';
import { CELL, FLOOR_HEIGHT, type WallBox } from './scene';
import { rayToBoxes } from './detection';
import { weaponWrist } from './weapon-alignment';
import { buildOffhandGun, equipStunGunInFist, type StunGun } from './weapon';
import { equipBigGun, kickGun, type BigGun } from './bigguns';
import { solveCCD, chainReach, clampToReach, type IKChain } from './ik';
import { stairGroundHeight } from './stairs';
import { preloadUal, turnAbout, ualClips, type UalClip } from './ual';
import type { Stair } from './maze';
import { setupTorchShadow, shadowsWanted } from './shadows';

export type MoveInput = {
  turn: number;
  throttle: number;
  strafe: number;
  /** Sidestep at a normal pace while sneaking too (first-person mode), not just lean out to peek. */
  freeStrafe?: boolean;
  sneak: boolean;
  /** Camo is on — laser beams don't stop the player (see camo.ts). */
  camo?: boolean;
  /** Dragging a stunned bot — slower going. */
  carrying?: boolean;
  /** Pressed up against furniture (cover.ts): strafe slides along it, no walking forward or back. */
  cover?: boolean;
  /** Lying flat (posture.ts): the crawl, with no sidestepping or peeking. */
  prone?: boolean;
  /** Dashing (dash.ts): a run faster than a walk, while forward is held. */
  dash?: boolean;
};

export const PLAYER_R = 0.32; // exported so bots.ts can use the same combined radius when a bot's own movement checks against the player
const MOVE_SPEED = 7; // world units/sec, forward
const BACK_SPEED = 4; // world units/sec, reverse — slower, like most third-person games
const STRAFE_SPEED = 5; // world units/sec, sideways — a sidestep into an open side passage without turning to face it, not a full sprint. Only used while NOT sneaking — see MAX_LEAN_DISTANCE below for the sneaking case.
const SNEAK_SPEED_FACTOR = 0.45; // movement speed multiplier while sneaking
const DASH_FACTOR = 10 / 7; // a dash runs at about 10 against a walk's 7 (dash.ts's DASH_SPEED_FACTOR)
const PRONE_SPEED = 0.16; // and while crawling flat (posture.ts's PRONE_SPEED_FACTOR)
const LIE_S = 0.6; // how long the camera takes to drop to the floor with the agent, or come back up
const CARRY_SPEED_FACTOR = 0.6; // dragging a body
const COVER_SLIDE_SPEED = 2.2; // sliding along furniture in cover
const DODGE_DIST = 2.8;
const DODGE_S = 0.28;
const DASH_SPEED = 11; // m/s: a dash to where a trap's aim line ends (game.ts), flat out
const DASH_CLIP_RATE = 1.4; // the sprint's clip, quickened to keep up (the feet slide a little even so)
// A longer dash ends in a slide: the last SLIDE_DIST + GET_UP_DIST of it, down onto the floor (the library's
// Slide_Start, quickened to SLIDE_S) and back up (Slide_Exit, over GET_UP_S), slowing all the way.
const SLIDE_FROM = 5; // metres: a dash at least this long slides
const SLIDE_DIST = 2.6;
const SLIDE_S = 0.55;
const GET_UP_DIST = 0.9;
const GET_UP_S = 0.4;
// The tower's cover to cover (dashTo with `toCover`): a sprint, then the slide over COVER_SLIDE_DIST metres (the library's Slide_Start, no scramble back up: the agent is crouched where it stops).
const COVER_SLIDE_DIST = 2.6;
const COVER_UP_DIST = 0.5; // and a scramble up that is cut off halfway, as the agent comes up into a crouch
const COVER_UP_S = 0.3;
const COVER_UP_KEEP = 0.5;
const LUNGE_S = 0.2; // a takedown's lunge onto the target
const LUNGE_MAX = 0.7;
const LUNGE_STOP = 0.55; // ends this short of the target's centre
const CAMO_OPACITY = 0.2;
const CAMO_TINT = new THREE.Color(0x3fb6d4);
const TURN_SPEED = 2.6; // radians/sec
// While sneaking, Q/E no longer drive the continuous sidestep above — direct
// request: "look around the corner without exposing themselves too much,"
// i.e. a real lean/peek, not just a slower version of the same full
// sidestep. MAX_LEAN_DISTANCE caps how far `leanOffset` (tick()) can spring
// out from center; released (or sneak toggled off), it eases back to 0,
// pulling the player back behind cover. It's a genuine, if small, shift in
// worldPos — not a separate camera trick — so it costs a proportionally
// small amount of real exposure to bot line-of-sight (detection.ts reads
// the same worldX/worldZ), matching "without exposing themselves too much"
// rather than "completely safe."
const MAX_LEAN_DISTANCE = 0.7; // world units
const LEAN_SPEED = 3.2; // world units/sec the lean offset can change by — reaches full lean in ~0.22s
let CAM_BACK = 7.8;
// Aiming from cover: the shoulder camera.
const AIM_BACK = 2.7;
const AIM_SIDE = 0.55;
const AIM_HEIGHT = 2.05;
// The eyes, from the head bone (the skull's base), when the view is from them: in the head, which is not drawn for it.
/** The head and neck bones (and the ones for the top of the head and the eyes, under them). */
const HEAD_BONE = /^mixamorig(Head|Neck)/;
const KICK_S = 0.22; // how long a shot's kick takes to settle, seconds
const EYE_BEHIND_GUN = 0.45; // how far behind the gun, along the line of fire, the eye is...
const EYE_ABOVE_GUN = 0.14; // ...and how far above it
const AIM_AHEAD = 9;
const AIM_LOOK_Y = 1.2;
let CAM_HEIGHT = 8.5;
/** How far ahead of the agent the camera looks (metres): none at the default angle, more the lower the camera sits, so more of what is ahead is in view. */
let CAM_AHEAD = 0;
const CAM_DEFAULT_DEG = 47.4;
const CAM_DISTANCE = Math.hypot(7.8, 8.5);

/** Sets how high the chase camera looks down from, in degrees above the floor, keeping its distance from the agent (settings: shared/controls.ts's camera). */
export function setCameraAngle(degrees: number): void {
  const a = (degrees * Math.PI) / 180;
  CAM_BACK = CAM_DISTANCE * Math.cos(a);
  CAM_HEIGHT = CAM_DISTANCE * Math.sin(a);
  CAM_AHEAD = Math.max(0, (CAM_DEFAULT_DEG - degrees) / (CAM_DEFAULT_DEG - 28)) * 3.5;
}
// The agents come without animation: all of it is Quaternius's Universal Animation Library (ual.ts), retargeted onto the agent (retarget.ts).
type Pose = 'idle' | 'walk' | 'crouchIdle' | 'crouchWalk' | 'crouchLeft' | 'crouchRight' | 'hide' | 'carry' | 'strike' | 'kick' | 'sword' | 'fall' | 'land' | 'mantle' | 'sprint' | 'jog' | 'slide' | 'getUp' | 'proneIdle' | 'proneCrawl' | 'proneBack' | 'proneEnter' | 'proneExit' | 'wallEnter' | 'wallUp' | 'wallIdle' | 'wallLedge' | 'hangShimmyL' | 'hangShimmyR' | 'hangHopL' | 'hangHopR' | 'hangDrop' | 'hangJump' | 'hangMount' | 'jumpStart' | 'jumpLand' | 'freeShimmyL' | 'freeShimmyR' | 'death' | 'hitA' | 'hitB' | 'hitC' | 'hitD';
/** The crouching set: sneaking standing still, forward (or back, played in reverse), sideways (Q and E, and sliding along cover), and ducking into cover (played once and held). */
const CROUCH_POSES = { crouchIdle: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop', crouchLeft: 'Crouch_Left_Loop', crouchRight: 'Crouch_Right_Loop', hide: 'Crouch_Enter' } as const satisfies Partial<Record<Pose, UalClip>>;
// Hanging from a tall wall's shelf (highwall.ts, game.ts): the library has no braced hang, so the sideways wall climb (hands and feet on the face, going left or right) stands in for the
// shimmy and the hop, its jump for the leap, its ledge pull-up for the mount, and each is stretched to the length highwall.ts's timing was written for. Without a hand-hanging clip, a rail's
// free shimmy (legs dangling) is the same sideways climb, so its legs are braced rather than hanging.
const HANG_POSES = {
  hangShimmyL: ['Climb_Left_Loop', SHIMMY_CLIP_S],
  hangShimmyR: ['Climb_Right_Loop', SHIMMY_CLIP_S],
  hangHopL: ['Climb_Left_Loop', HOP_CLIP_S.left],
  hangHopR: ['Climb_Right_Loop', HOP_CLIP_S.right],
  hangDrop: ['NinjaJump_Idle_Loop', DROP_S],
  hangJump: ['Jump_Start', JUMP_CLIP_S],
  // (the pull-up's first 12 frames: hands up on the ledge, then up on the feet with the hands at the hips, crouched, where the game blends into its own crouch)
  hangMount: ['ClimbLedge', MOUNT_CLIP_S, 12],
  freeShimmyL: ['Climb_Left_Loop', 1.38],
  freeShimmyR: ['Climb_Right_Loop', 1.38],
} as const satisfies Partial<Record<Pose, readonly [UalClip, number, number?]>>;
/** The walk's cycle, stretched to the pace the footsteps (FOOTFALL_PHASES) and the game's walking speed were set for. */
const WALK_CYCLE_S = 1.033;
/**
 * How the library's clips are restyled and paced to match the original set (radians, forward positive): the ready stance leans into the gun and its feet are one behind the other,
 * the sneak keeps the chest up (the library's crouch hunches over the knees), and its walk is a half crouch. Cycle lengths in seconds.
 */
const STYLE = { idleS: 2.5, idleLean: { spine: 0.05, head: -0.2 }, idleStance: 0.15, walkLean: { spine: 0, head: -0.25 }, creepS: 1.733, creepBlend: 0.45, creepLean: { spine: -0.15, head: -0.35 }, crouchIdleS: 2.133, crouchLean: { spine: -1.0, head: 0.3 }, sideS: 1.033 };
const WALL_CLIP_POSE = { Climb_Enter: 'wallEnter', Climb_Up_Loop: 'wallUp', ClimbLedge: 'wallLedge', Crawl_Enter: 'proneEnter', NinjaJump_Idle_Loop: 'fall', Climb_Idle_Loop: 'wallIdle', HangShimmyL: 'hangShimmyL', HangShimmyR: 'hangShimmyR', HangHopL: 'hangHopL', HangHopR: 'hangHopR', HangDrop: 'hangDrop', HangJump: 'hangJump', HangMount: 'hangMount', CrouchIdle: 'crouchIdle', JumpStart: 'jumpStart', FreeShimmyL: 'freeShimmyL', FreeShimmyR: 'freeShimmyR' } as const satisfies Record<string, Pose>;
/** A clip holdWall() can show: the wall climb's (wallclimb.ts) and the hang's (highwall.ts). */
export type WallClip = keyof typeof WALL_CLIP_POSE;
/** Where the limbs go in a wall run (by IK, each `w` of the way from where the clip has it): the hands to the edge, the feet to the face. */
export type WallLimbs = { hands?: { right: { x: number; y: number; z: number }; left: { x: number; y: number; z: number }; w: number }; feet?: { right: { x: number; y: number; z: number; w: number }; left: { x: number; y: number; z: number; w: number } } };
/** Where a wall climb's hands rest on the wall's top, and the wall's centre line (a point on it and its normal), for holdWall(). */
export type WallPin = { hands: { x: number; y: number; z: number }; settle: number; centre: { x: number; z: number }; normal: { x: number; z: number } };
/** The poses from the Universal Animation Library (ual.ts): standing and walking, the crouches, carrying a body, a takedown's hook, falling from a pipe and the landing, the crawl, the wall climb. */
const UAL_POSES = { idle: 'Idle_Loop', walk: 'Walk_Loop', ...CROUCH_POSES, carry: 'Walk_Carry_Loop', strike: 'Melee_Hook', kick: 'Kick', sword: 'Sword_Attack', fall: 'NinjaJump_Idle_Loop', land: 'NinjaJump_Land', mantle: 'ClimbUp_1m', sprint: 'Sprint_Loop', slide: 'Slide_Start', getUp: 'Slide_Exit', proneIdle: 'Crawl_Idle_Loop', proneCrawl: 'Crawl_Fwd_Loop', proneBack: 'Crawl_Bwd_Loop', proneEnter: 'Crawl_Enter', proneExit: 'Crawl_Exit', wallEnter: 'Climb_Enter', wallUp: 'Climb_Up_Loop', wallIdle: 'Climb_Idle_Loop', wallLedge: 'ClimbLedge', jumpStart: 'Jump_Start', jumpLand: 'Jump_Land', death: 'Death01', hitA: 'Hit_Chest', hitB: 'Hit_Stomach', hitC: 'Hit_Shoulder_L', hitD: 'Hit_Shoulder_R' } as const satisfies Partial<Record<Pose, UalClip>>;
/** Played once, start to finish, whatever the player does meanwhile; then back to the pose that fits. */
/** The jog the rooftop level walks in (opts.jog): the library's, at the stride of the agent's own speed, so the feet don't slide. */
const JOG_CLIP: UalClip = 'Jog_Fwd_Loop';
const ONE_SHOTS: ReadonlySet<Pose> = new Set(['strike', 'kick', 'sword', 'land', 'jumpLand', 'slide', 'getUp', 'proneEnter', 'proneExit', 'death', 'hitA', 'hitB', 'hitC', 'hitD']);
/** How long getting down flat or up from it takes: the library's clips run about two seconds, played quicker to fit a game's pace. */
const PRONE_SHIFT_S = 0.9;
/** How much of the crawl-exit clip is played when getting up into a crouch rather than to standing. */
const PRONE_TO_CROUCH = 0.45;
/** Flat on the floor, slower than this (m/s) is lying still, not crawling. */
const PRONE_MOVE_MIN = 0.2;
/** How fast each moving crouch clip covers ground at 1×, m/s (from its own root motion), so it's played to match the player's speed. */
const CLIP_SPEED: Partial<Record<Pose, number>> = { crouchWalk: 0.84, crouchLeft: 0.97, crouchRight: 0.97, carry: 1.4, proneCrawl: 0.6, proneBack: 0.52, jog: 5.36 };
const MIN_CLIP_RATE = 0.6;
const MAX_CLIP_RATE = 1.8; // any faster reads as scurrying: past this the feet slide a little instead, as the walk's do
/** A pose whose clip didn't load stands in with the nearest one that did. */
const FALLBACK: Partial<Record<Pose, Pose>> = { crouchIdle: 'idle', crouchWalk: 'walk', crouchLeft: 'crouchWalk', crouchRight: 'crouchWalk', hide: 'crouchIdle', hangShimmyL: 'wallIdle', hangShimmyR: 'wallIdle', hangHopL: 'hangShimmyL', hangHopR: 'hangShimmyR', hangDrop: 'fall', hangJump: 'fall', hangMount: 'wallLedge', freeShimmyL: 'hangShimmyL', freeShimmyR: 'hangShimmyR', jumpStart: 'fall', jumpLand: 'land', carry: 'walk', strike: 'idle', kick: 'strike', sword: 'strike', land: 'idle', fall: 'idle', sprint: 'walk', jog: 'walk', slide: 'crouchWalk', getUp: 'idle', proneIdle: 'crouchIdle', proneCrawl: 'crouchWalk', proneBack: 'crouchWalk', proneEnter: 'crouchIdle', proneExit: 'crouchIdle', wallEnter: 'idle', wallUp: 'idle', wallIdle: 'idle', wallLedge: 'idle', death: 'idle', hitA: 'idle', hitB: 'idle', hitC: 'idle', hitD: 'idle' };
const MOVING_POSES: ReadonlySet<Pose> = new Set(['walk', 'crouchWalk', 'crouchLeft', 'crouchRight', 'sprint', 'jog', 'proneCrawl', 'proneBack']);
const ANIM_BLEND_S = 0.25;
const TORCH_INTENSITY = 130;
// The torch light shines from this far ahead of the chest lamp, past the gun and hands. From the lamp itself
// it lit them from behind, burning them white; the beam you see (effects.ts) still starts at the lamp.
const TORCH_AHEAD = 0.6;
const FOOT_LIGHT = 55;
const FOOT_LIGHT_DARK = 18; // torch off: just enough to see yourself and the floor around you
// Where the ground light hangs: over the player's head and a little in front. At hip height it sat inside the
// body, lighting the face from below and the suit from within, so the agent read as black with white streaks.
const FOOT_LIGHT_HEIGHT = 2.3;
const FOOT_LIGHT_AHEAD = 0.7;
// Where in the library's Walk_Loop clip (as a fraction of its cycle) each foot
// lands — measured from the toe bones' lowest point: left ~0.10, right ~0.60.
// Footstep sounds fire on these, so they keep the animation's walking pace.
const FOOTFALL_PHASES = [0.1, 0.6];
/** How far each knuckle joint of the gun hand is closed round the grip, radians, the three joints of each finger in turn: the trigger finger lies along the frame, the rest wrap the handle. */
const GRIP_CURL: Record<string, readonly [number, number, number]> = {
  Index: [0.45, 0.55, 0.25],
  Middle: [1.15, 1.35, 0.9],
  Ring: [1.2, 1.4, 0.95],
  Pinky: [1.2, 1.4, 0.95],
};
/** Which way round the knuckle line the fingers close (a mirrored rig flips it). */
const GRIP_CURL_SIGN = 1;
const SUPPORT_CURL = 0.8; // the off hand wraps the foregrip a little less tightly
const SUPPORT_CURL_SIGN = -1; // the left hand is the right's mirror image: it closes the other way about the same line
const AIM_HAND_BELOW_EYES = 0.17; // aiming, the gun hand is this far under the head
const AIM_HAND_OUT = 0.3; // and this much further out in front of the chest
const HAND_READY_Y = 1.15; // the gun hand's ready spot, standing; it drops as far as the hips do in a crouch
// At a terminal or a station: gun away, both hands out on the console at this height and reach, tapping keys.
const WORK_HAND_Y = 1.0;
const WORK_HAND_AHEAD = 0.46;
const WORK_HAND_APART = 0.15;
/** At a console the forearms are turned this much about their length after the IK (radians), so the palms face the keys. */
const WORK_FOREARM_TWIST = Math.PI;
const TYPING_RATE = 17; // radians/s: a few taps a second per hand
const TYPING_LIFT = 0.018;

/** What the player's hands are busy with: working a console (hacks, uplinks, captures, wipes), carrying a body, or nothing (the gun up). */
export type Busy = 'work' | 'carry' | null;

/** Up off the floor (pipes.ts): climbing a tower's ladder, standing on its platform, hanging from a pipe, or letting go. See hold(). */
export type Aloft = 'climb' | 'mantle' | 'perch' | 'hang' | 'fall';
// Climbing: hands on the rungs in front, one over the other, a rung apart.
const RUNG_AHEAD = 0.3;
const RUNG_APART = 0.19;
const RUNG_STEP = 0.32; // pipeRig.ts's rung spacing
// Hanging, facing along the pipe: both hands on it overhead, going hand over hand as the agent shimmies.
const HANG_APART = 0.05; // either side of the pipe's top
const HANG_STRIDE = 0.5; // metres shimmied per hand-over-hand
const LEDGE_HANDS_AHEAD = 0.28; // hanging from a ledge (a rail's slab edge, which runs across the body): the hands on the edge, this far in front of the body
const LEDGE_HAND_SHIFT = 0.09; // metres each hand reaches along the edge, alternating, while shimmying
const HANG_REACH = 0.18; // how far the leading hand is ahead of the head (the other as far behind)
const HANG_KNEES = 0.9; // radians: the knees bent, so the feet clear the walls under the pipe
const HANG_HIPS = 0.35;
const HANG_SHRUG = 0.4; // radians the collarbones lift, hanging: the shoulders ride up toward the ears
const WRIST_TO_GRIP = 0.07;
/** A foot planted on a wall is turned toes-up by this much (radians), the sole flat to the face. */
const WALL_FOOT_PITCH = 1.25;
/** Hovering over a console, the agent hangs flat, face down, parallel to the floor: the hips this far above where the feet would be (hips and not feet, since it pivots about them), so the hands reach the desk. */
const HOVER_BODY_LIFT = 0.8;
/** How far down from the shoulders each hand reaches, as a share of the arm, working the console below, and how far apart the hands are. */
const HOVER_REACH = 0.9;
const HOVER_HANDS_APART = 0.2;
// A carried body rides the hands (carryAnchor()): a little out in front of them, and just above.
const CARRY_OUT = 0.14;
const CARRY_LIFT = 0.02;

export function collides(x: number, z: number, wallBoxes: WallBox[], crawling = false, ducking = false): boolean {
  for (const b of wallBoxes) {
    if (crawling && b.under) continue; // flat on the floor, the agent fits under it
    if (ducking && b.duct) continue; // crouched, a duct (the bunker's) is open too
    if (x + PLAYER_R > b.minX && x - PLAYER_R < b.maxX && z + PLAYER_R > b.minZ && z - PLAYER_R < b.maxZ) {
      return true;
    }
  }
  return false;
}

/**
 * How far the player at (x, z) is inside things: for each wall box, the
 * shortest push that would clear it; for each body, how far the two
 * overlap. 0 means free. Used so that someone who has ended up inside
 * something (an ambush spawning on top of them, a gate shutting on them,
 * a cover slide into a wall) can always step back out: a move that makes
 * this smaller is allowed even if it doesn't clear it yet.
 */
function overlap(x: number, z: number, wallBoxes: WallBox[], blockers: Blocker[], crawling = false, ducking = false): number {
  let depth = 0;
  for (const b of wallBoxes) {
    if (crawling && b.under) continue;
    if (ducking && b.duct) continue;
    const push = Math.min(x + PLAYER_R - b.minX, b.maxX - (x - PLAYER_R), z + PLAYER_R - b.minZ, b.maxZ - (z - PLAYER_R));
    if (push > 0) depth += push;
  }
  for (const b of blockers) depth += Math.max(0, PLAYER_R + b.r - Math.hypot(x - b.x, z - b.z));
  return depth;
}

/** A circular obstacle (a bot's body) — separate from wallBoxes since these move every frame. */
export type Blocker = { x: number; z: number; r: number };

function collidesBlockers(x: number, z: number, blockers: Blocker[]): boolean {
  for (const b of blockers) {
    if (Math.hypot(x - b.x, z - b.z) < PLAYER_R + b.r) return true;
  }
  return false;
}

function buildPlaceholderPlayer(): THREE.Group {
  // Shown instantly, before the skinned model finishes loading; replaced by
  // loadAgent() once it's ready.
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x232c42, roughness: 0.7 })
  );
  body.position.y = 0.77;
  g.add(body);
  const facingWedge = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0xe0bd6c, roughness: 0.6 })
  );
  facingWedge.rotation.x = Math.PI / 2;
  facingWedge.position.set(0, 0.77, 0.4);
  g.add(facingWedge);
  return g;
}

export class Player {
  readonly mesh: THREE.Group;
  readonly light: THREE.SpotLight;
  private readonly footLight: THREE.PointLight;
  private readonly lightTarget: THREE.Object3D;
  private readonly lampPos = new THREE.Vector3();
  private worldPos: THREE.Vector3;
  private angle = 0; // 0 = facing south; local +Z (the facing wedge) maps to world (sinθ, cosθ)
  private leanOffset = 0; // signed world-units offset from center, current peek/lean amount — see MAX_LEAN_DISTANCE
  private floorIdx = 0;
  /** How far apart the building's floors are (scene.ts's FLOOR_HEIGHT, or TALL_FLOOR_HEIGHT where there are pipes). */
  floorHeight = FLOOR_HEIGHT; // which stacked floor the player is currently considered "on" — see tick()'s stair-height resolution

  private running = false; // dashing this frame (MoveInput.dash)
  private lie = 0; // 0 standing to 1 lying flat
  private lieTarget = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Pose, THREE.AnimationAction>();
  private pose: Pose | null = null;
  private isMoving = false;
  private lastWalkPhase = -1;
  private footfalls = 0;
  /** The hips, and their height above the feet at rest: how far they've dropped says how deep the crouch is. */
  private hips: THREE.Object3D | null = null;
  private hipsRestHeight = 0;
  /** 0–1: how flat the agent hangs over a console (hold()'s `hover`). */
  private hoverFlat = 0;

  private weaponTip: THREE.Object3D | null = null;
  private gun: StunGun | null = null;
  /** A heavy gun (bigguns.ts) carried instead of the pistol, and when the last shot kicked it (the clock's seconds). */
  private bigGun: BigGun | null = null;
  private kickedAt = -10;
  private lamp: ShoulderLamp | null = null;
  private torchOn = false;
  private weaponSupport: THREE.Object3D | null = null;
  /** The primary gun's own foregrip (weaponSupport while it is two-handed), and the second gun of a two-gun loadout, held by the left hand beside the first. */
  private primarySupport: THREE.Object3D | null = null;
  private offGun: StunGun | null = null;
  private offOn = false;
  private offName: BigGun | null = null;
  private offKickedAt = -10;
  private supportArmChain: IKChain | null = null;
  private primaryWrist: ((forward: THREE.Vector3) => void) | null = null;
  private supportWrist: ((forward: THREE.Vector3) => void) | null = null;
  private primaryArmChain: IKChain | null = null;
  private primaryReach = 0;
  private supportReach = 0;
  private readonly rightHandTarget: THREE.Object3D;
  private busy: Busy = null;
  private busyTime = 0;
  /** Down for good (die()): the death fall held, and no more walking, until revive(). */
  private dead = false;
  /** A pose playing once through (ONE_SHOTS), and how long it has left. */
  private oneShot: { pose: Pose; left: number } | null = null;
  private legs: Array<{ thigh: THREE.Object3D; shin: THREE.Object3D }> = [];
  /** The two legs as IK chains (thigh and shin to the foot), with how far each reaches: the wall run's foot plants. */
  private legChains: { left: IKChain | null; right: IKChain | null } = { left: null, right: null };
  private legReach = 0.9;
  private collarbones: Array<{ bone: THREE.Object3D; side: 1 | -1 }> = [];
  /** The gun hand's finger joints, each with how far it curls (GRIP_CURL) and the pose it has in the T-pose, which it is put back to before each curl. */
  private gripBones: Array<{ bone: THREE.Object3D; curl: number; rest: THREE.Quaternion }> = [];
  /** The support (left) hand's fingers, closed round the gun's foregrip the same way (curlGrip), a little less tightly. */
  private supportBones: Array<{ bone: THREE.Object3D; curl: number; rest: THREE.Quaternion }> = [];
  private supportIndex: THREE.Object3D | null = null;
  private supportPinky: THREE.Object3D | null = null;
  /** The head and neck, and which way the head looks in its own frame (the way the model faces in its rest pose), to hold it level while aiming. */
  private head: THREE.Object3D | null = null;
  private neck: THREE.Object3D | null = null;
  private headForward = new THREE.Vector3(0, 0, 1);
  private gripIndex: THREE.Object3D | null = null;
  private gripPinky: THREE.Object3D | null = null;
  private shoulderRest = 1.45;
  /** Hanging from a ledge that runs across the body, not a pipe along it: hands spread to the shoulders' width on the edge, straight up, not together over the head (set by game.ts). */
  ledgeGrip = false;
  /** How far below the pipe the agent's feet are, hanging from it at full stretch (hold()'s 'hang'). */
  hangDrop = 2.1;

  /** Walks in the library's jog at the speed it really covers ground (the rooftop level); off, the library's walk plays at its own pace. */
  private readonly jogWalk: boolean;
  /** Seconds to get from standing to a full run (and to stop again): 0 is instant, as the maze has it. */
  moveEase = 0;
  private forwardSpeed = 0;

  constructor(scene: THREE.Scene, startCellX: number, startCellY: number, body: Body = 'male', look: Look = 'classic', style: Style = DEFAULT_STYLE, opts: { jog?: boolean } = {}) {
    this.jogWalk = opts.jog === true;
    this.mesh = buildPlaceholderPlayer();
    this.worldPos = new THREE.Vector3(startCellX * CELL, 0, startCellY * CELL);
    this.mesh.position.copy(this.worldPos);
    this.mesh.rotation.x = 0; // upright again (hold() tips the agent over for a hover)
    this.mesh.rotation.z = 0;
    this.mesh.rotation.y = this.angle;
    scene.add(this.mesh);
    markCharacter(scene, this.mesh);

    // A fixed "weapon ready" spot in front of the chest, parented to the
    // player's own root group so it moves/turns with the player
    // automatically. Without this, the gun hand just follows the stock walk
    // animation's raw arm swing, which can carry it out to the side or
    // behind — too far for the support arm's IK to reach without visibly
    // overextending. Holding the primary hand here first, then aiming the
    // support hand at the now-stable gun, is what keeps both arms in a
    // physically plausible cluster.
    this.rightHandTarget = new THREE.Object3D();
    this.rightHandTarget.position.set(-0.14, HAND_READY_Y, 0.42);
    this.mesh.add(this.rightHandTarget);

    // Lantern/torch rig — ported from blueprint/prototype-3d.html's
    // flashlight setup (~line 176): a SpotLight carried by the player,
    // aimed a couple units ahead along facing. This is purely atmospheric
    // for now; full fog-of-war (dark-until-explored cells) is a later phase.
    this.light = new THREE.SpotLight(0xbfe3ea, TORCH_INTENSITY, 13, Math.PI / 5, 0.65, 1.4);
    this.lightTarget = new THREE.Object3D();
    scene.add(this.lightTarget);
    this.light.target = this.lightTarget;
    scene.add(this.light);
    setupTorchShadow(this.light);

    // The SpotLight above is aimed forward-and-down at a point ahead of the
    // player (see updateLight()) — its cone genuinely doesn't reach the
    // ground directly under/behind where the player is currently standing
    // (that point sits well outside a forward-aimed cone's angle, no matter
    // how bright the light is). Confirmed by direct A/B testing in the live
    // scene: with only the SpotLight, the player's own floor tile stayed
    // essentially black regardless of its vertex-color fog tint (vision.ts's
    // LIT_COLOR) or the floor material's own properties — a PBR material
    // renders black wherever no real light actually reaches it, brightness
    // multipliers on an unlit surface notwithstanding. This small
    // omnidirectional PointLight fixes that directly: it always lights the
    // ground you're standing on, independent of facing. It hangs above the
    // head (FOOT_LIGHT_HEIGHT), so it lights the agent from outside too.
    this.footLight = new THREE.PointLight(0xbfe3ea, FOOT_LIGHT_DARK, 4.5, 1.6);
    scene.add(this.footLight);

    this.updateLight();
    this.setTorch(this.torchOn); // every job starts with the torch off

    this.loadAgent(body, look, style).catch((err) => console.error('Failed to load the agent', err));
  }

  /**
   * Loads the chosen agent, in the chosen look (skins.ts), and gets it moving. The agents come without
   * animation, so the library's idle, walk, crouch and the rest (ual.ts)
   * are retargeted onto them (retarget.ts). The gun is fitted to the hand
   * (weapon.ts's equipStunGunInFist).
   */
  private async loadAgent(body: Body, look: Look, style: Style): Promise<void> {
    const loader = new GLTFLoader();
    preloadUal();
    const skin = skinFor(body, look, style);
    const [agent, ...hair] = await Promise.all([skin.url, ...skin.hair].map((url) => loader.loadAsync(url)));
    const model = agent!.scene;
    if (skin.mannequin) adoptMixamoNames(model);
    if (skin.suit !== null) paintSuit(model, skin.suit, skin.scalp, skin.skinTone);
    for (const piece of hair) attachHair(model, piece.scene);
    // (The plates are fitted in the bind pose, before the body is scaled.)
    if (skin.armour !== null) dressAgent(model, { body: body, suit: null, armour: skin.armour, trim: 0x6fe0ff, helmet: false });
    standTall(model, BODY_HEIGHT[body]);
    // Turned to face +Z, the player root's forward: the way its toes point.
    model.updateMatrixWorld(true);
    const foot = model.getObjectByName('mixamorigLeftFoot')!.getWorldPosition(new THREE.Vector3());
    const toe = model.getObjectByName('mixamorigLeftToe_End')!.getWorldPosition(new THREE.Vector3());
    model.rotation.y = -Math.atan2(toe.x - foot.x, toe.z - foot.z);
    model.updateMatrixWorld(true);
    // The pelvis over the root: this body's rests a little behind its origin, which put the shoulders back from where the gun is held (and the guards' collision circle off its centre).
    const pelvis = model.getObjectByName('mixamorigHips')!.getWorldPosition(new THREE.Vector3());
    model.position.x -= pelvis.x;
    model.position.z -= pelvis.z;
    model.updateMatrixWorld(true);

    // Every clip is the library's (ual.ts), retargeted while the agent still stands in its rest pose; any that fail to load are stood in for (FALLBACK), never holding up the agent.
    const hangFrom = Object.values(HANG_POSES).map(([name]) => name);
    const ual = await ualClips(model, [...new Set<UalClip>([...Object.values(UAL_POSES), ...hangFrom, ...(this.jogWalk ? [JOG_CLIP] : [])])]).catch((error: unknown) => {
      console.error('No agent animations', error);
      return new Map<UalClip, THREE.AnimationClip>();
    });
    const clips = new Map<Pose, THREE.AnimationClip>();
    for (const [pose, name] of Object.entries(UAL_POSES) as Array<[Pose, UalClip]>) {
      const clip = ual.get(name);
      if (clip) clips.set(pose, clip);
    }
    // The library's poses are relaxed; the game's agent holds a gun. Each clip is restyled to the original set's posture and pace (STYLE below).
    const timed = (pose: Pose, length: number): THREE.AnimationClip | undefined => {
      const clip = clips.get(pose);
      return clip && retimeClip(clip, length, pose);
    };
    const idle = timed('idle', STYLE.idleS);
    if (idle) clips.set('idle', narrowWalkStance(leanClip(idle, model, STYLE.idleLean), model, STYLE.idleStance));
    const walk = timed('walk', WALK_CYCLE_S);
    if (walk) clips.set('walk', leanClip(body === 'female' ? narrowWalkStance(walk, model) : walk, model, STYLE.walkLean));
    // Sneaking forward is a half-crouched run, between the walk and the library's low creep (the original's hips stay at about 0.8 of standing).
    const creep = timed('crouchWalk', STYLE.creepS);
    if (walk && creep) clips.set('crouchWalk', leanClip(blendClips(retimeClip(walk, STYLE.creepS), creep, STYLE.creepBlend, 'crouchWalk', -0.1 * STYLE.creepS), model, STYLE.creepLean));
    const crouch = timed('crouchIdle', STYLE.crouchIdleS);
    if (crouch) clips.set('crouchIdle', leanClip(crouch, model, STYLE.crouchLean));
    for (const pose of ['crouchLeft', 'crouchRight'] as const) {
      const step = timed(pose, STYLE.sideS);
      if (step) clips.set(pose, leanClip(step, model, STYLE.crouchLean));
    }
    const hide = clips.get('hide');
    if (hide) clips.set('hide', leanClip(hide, model, STYLE.crouchLean));
    for (const [pose, [name, length, frames]] of Object.entries(HANG_POSES) as Array<[Pose, readonly [UalClip, number, number?]]>) {
      const clip = ual.get(name);
      if (clip) clips.set(pose, retimeClip(frames ? THREE.AnimationUtils.subclip(clip, pose, 0, frames, 30) : clip, length, pose));
    }
    const jog = ual.get(JOG_CLIP);
    if (jog) clips.set('jog', jog);

    // Before any animation plays: the gun and the shoulder lamp are fitted in the T-pose.
    const gun = equipStunGunInFist(model);
    this.lamp = strapLamp(model, 0xbfe3ea);
    this.lamp?.setOn(this.torchOn);

    this.mesh.clear(); // also removes rightHandTarget, added in the constructor — re-add it below
    this.mesh.add(model);
    this.mesh.add(this.rightHandTarget);
    // Measured the same way as each frame (updateAnimation), with the model in place and still in its rest pose.
    this.mesh.updateMatrixWorld(true);
    this.hips = model.getObjectByName('mixamorigHips') ?? null;
    this.hipsRestHeight = this.hips ? this.hips.getWorldPosition(new THREE.Vector3()).y - this.mesh.getWorldPosition(new THREE.Vector3()).y : 0;
    this.camoMats = null; // the cloak re-collects materials from the real model, gun included
    this.gun = gun;
    if (gun && this.bigGun) void equipBigGun(gun, this.bigGun);
    if (gun) {
      this.weaponTip = gun.tip;
      this.weaponSupport = gun.support;
      this.primarySupport = gun.support;
      const rightArm = model.getObjectByName('mixamorigRightArm');
      const rightForeArm = model.getObjectByName('mixamorigRightForeArm');
      const rightHand = model.getObjectByName('mixamorigRightHand');
      if (rightArm && rightForeArm && rightHand) {
        this.primaryArmChain = { joints: [rightArm, rightForeArm], endEffector: rightHand };
        this.primaryReach = chainReach(this.primaryArmChain);
        this.primaryWrist = weaponWrist(rightHand, gun.group.quaternion);
      }
      const leftArm = model.getObjectByName('mixamorigLeftArm');
      const leftForeArm = model.getObjectByName('mixamorigLeftForeArm');
      const leftHand = model.getObjectByName('mixamorigLeftHand');
      if (leftArm && leftForeArm && leftHand) {
        this.supportArmChain = { joints: [leftArm, leftForeArm], endEffector: leftHand };
        this.supportReach = chainReach(this.supportArmChain);
        this.supportWrist = weaponWrist(leftHand);
      }
      if (this.primaryArmChain) {
        this.shoulderRest = this.primaryArmChain.joints[0]!.getWorldPosition(new THREE.Vector3()).y - this.mesh.getWorldPosition(new THREE.Vector3()).y;
        this.hangDrop = this.shoulderRest + Math.min(this.primaryReach, this.supportReach || this.primaryReach) * 0.95 + WRIST_TO_GRIP;
      }
    }
    this.offGun = null; // (the mesh was cleared above: a second gun asked for earlier is hung again)
    if (this.offOn) this.setOffhand(true, this.offName);
    this.collarbones = (['Left', 'Right'] as const).flatMap((side) => {
      const bone = model.getObjectByName(`mixamorig${side}Shoulder`);
      return bone ? [{ bone, side: side === 'Left' ? (1 as const) : (-1 as const) }] : [];
    });
    // The gun hand's fingers, to be closed on the grip (curlGrip). Their T-pose is kept: the clips may or may not move them, so each frame starts from it.
    this.gripBones = [];
    for (const [finger, curls] of Object.entries(GRIP_CURL)) {
      curls.forEach((curl, i) => {
        const bone = model.getObjectByName(`mixamorigRightHand${finger}${i + 1}`);
        if (bone) this.gripBones.push({ bone, curl, rest: bone.quaternion.clone() });
      });
    }
    this.head = model.getObjectByName('mixamorigHead') ?? null;
    this.neck = model.getObjectByName('mixamorigNeck') ?? null;
    if (this.head) {
      // Measured with the model in place and still in its rest pose, facing the way the mesh does (+Z at angle 0).
      this.mesh.updateMatrixWorld(true);
      const inMesh = this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.head.getWorldQuaternion(new THREE.Quaternion()));
      this.headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(inMesh.invert());
    }
    this.supportBones = [];
    for (const [finger, curls] of Object.entries(GRIP_CURL)) {
      curls.forEach((curl, i) => {
        const bone = model.getObjectByName(`mixamorigLeftHand${finger}${i + 1}`);
        if (bone) this.supportBones.push({ bone, curl: curl * SUPPORT_CURL, rest: bone.quaternion.clone() });
      });
    }
    this.supportIndex = model.getObjectByName('mixamorigLeftHandIndex1') ?? null;
    this.supportPinky = model.getObjectByName('mixamorigLeftHandPinky1') ?? null;
    this.gripIndex = model.getObjectByName('mixamorigRightHandIndex1') ?? null;
    this.gripPinky = model.getObjectByName('mixamorigRightHandPinky1') ?? null;
    this.legs = (['Left', 'Right'] as const).flatMap((side) => {
      const thigh = model.getObjectByName(`mixamorig${side}UpLeg`);
      const shin = model.getObjectByName(`mixamorig${side}Leg`);
      return thigh && shin ? [{ thigh, shin }] : [];
    });

    for (const side of ['Left', 'Right'] as const) {
      const thigh = model.getObjectByName(`mixamorig${side}UpLeg`);
      const shin = model.getObjectByName(`mixamorig${side}Leg`);
      const foot = model.getObjectByName(`mixamorig${side}Foot`);
      if (thigh && shin && foot) {
        const chain = { joints: [thigh, shin], endEffector: foot };
        this.legChains[side === 'Left' ? 'left' : 'right'] = chain;
        this.legReach = chainReach(chain);
      }
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const [pose, c] of clips) this.actions.set(pose, this.mixer.clipAction(c));
    for (const pose of ['hide', ...ONE_SHOTS] as Pose[]) {
      const action = this.actions.get(pose);
      if (!action) continue;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    this.playPose('idle');
  }

  /** The pose to show: in cover, hiding (or edging along it); sneaking, the crouches; otherwise standing or walking. */
  private choosePose(m: { forward: number; side: number; sneaking: boolean; cover: boolean }): Pose {
    if (this.dead) return 'death';
    if (this.oneShot) return this.oneShot.pose;
    // Flat on the floor: lying still, or crawling the way the agent moves (the library's crawl has no sidestep: neither does prone).
    // (A thumb resting a hair off the stick's centre moves the agent a few centimetres a second: that is not a crawl.)
    if (this.lieTarget === 1) return m.forward > PRONE_MOVE_MIN ? 'proneCrawl' : m.forward < -PRONE_MOVE_MIN ? 'proneBack' : 'proneIdle';
    if (this.sprinting || this.running) return 'sprint';
    if (this.busy === 'carry') return 'carry';
    if (this.jogWalk && !m.sneaking && !m.cover && m.forward > 0.5) return 'jog';
    const sideways = Math.abs(m.side) > 0.2 ? (m.side > 0 ? 'crouchRight' : 'crouchLeft') : null;
    if (m.cover) return sideways ?? 'hide';
    if (m.sneaking) return Math.abs(m.forward) > 0.2 ? 'crouchWalk' : (sideways ?? 'crouchIdle');
    return Math.abs(m.forward) > 0.05 || Math.abs(m.side) > 0.05 ? 'walk' : 'idle';
  }

  /**
   * Every clip other than `next` that still counts toward the pose, to be faded out as `next` comes in (a cross-fade cut short leaves one
   * behind at weight 1). Paused ones count too: the carry holds mid-step when the agent stands still, and a one-shot that has run
   * to its end stays clamped on its last frame, and neither is "running": left alone they would stay blended in for good, washing out
   * every walk after. They're let go so their fade can play.
   */
  private stillBlended(next: THREE.AnimationAction): THREE.AnimationAction[] {
    const blended = [...this.actions.values()].filter((a) => a !== next && a.isScheduled() && a.getEffectiveWeight() > 0);
    for (const a of blended) a.paused = false;
    return blended;
  }

  /** Cross-fades to `pose`, or the nearest pose that has a clip. */
  private playPose(wanted: Pose): void {
    let pose: Pose | undefined = wanted;
    while (pose && !this.actions.has(pose)) pose = FALLBACK[pose];
    if (!pose || pose === this.pose) return;
    const next = this.actions.get(pose)!;
    const fading = this.stillBlended(next);
    next.reset().play();
    next.weight = 1; // (a wall climb's holdWall() sets weights by hand)
    for (const a of fading) a.crossFadeTo(next, ANIM_BLEND_S, true);
    this.pose = pose;
  }

  /** `forward` and `side`: the player's speed along and across its facing this frame (m/s, + forward / + right). */
  private updateAnimation(m: { forward: number; side: number; sneaking: boolean; cover: boolean }, dt: number): void {
    // Held to the end of a dash stage it's timed to, not a frame short of it.
    if (this.oneShot && (this.oneShot.left -= dt) <= 0 && this.lungeLeft <= 0) this.oneShot = null;
    this.playPose(this.choosePose(m));
    const pose = this.pose;
    const carrying = pose === 'carry';
    this.isMoving = pose !== null && (MOVING_POSES.has(pose) || (carrying && Math.hypot(m.forward, m.side) > 0.05));
    // A crouching clip keeps pace with the player: faster or slower to match (within reason), and backwards when backing up.
    // The carry does too, and stands still with the player (its walk frozen mid-step).
    const clipSpeed = pose ? CLIP_SPEED[pose] : undefined;
    if (pose && clipSpeed) {
      // (The crawl back is its own clip, so it plays forward at any speed: reversed, it would crawl forward while backing up.)
      const speed = pose === 'proneBack' ? Math.abs(m.forward) : pose === 'crouchWalk' || pose === 'jog' || pose === 'proneCrawl' || carrying ? m.forward || Math.abs(m.side) : Math.abs(m.side);
      const rate = THREE.MathUtils.clamp(Math.abs(speed) / clipSpeed, MIN_CLIP_RATE, MAX_CLIP_RATE);
      const action = this.actions.get(pose)!;
      action.timeScale = speed < 0 ? -rate : rate;
      // Standing still, the carry holds mid-step: paused, not a time scale of 0, which a cross-fade still under
      // way (three.js's warp) would turn into a pause for good, leaving the agent gliding along frozen.
      if (carrying) action.paused = !this.isMoving;
    }

    this.mixer?.update(dt);
    if (!carrying) this.countFootfalls();

    // The gun hand's ready spot drops with the hips, so crouching keeps the gun at the chest rather than reaching up for it.
    if (this.hips) {
      const drop = this.hipsRestHeight - (this.hips.getWorldPosition(new THREE.Vector3()).y - this.mesh.getWorldPosition(new THREE.Vector3()).y);
      this.rightHandTarget.position.y = HAND_READY_Y - Math.max(0, drop);
    }
    this.poseAim();

    // Hands busy: the gun is put away. Working, both hands go to the console (still, not walking); carrying a
    // body, or mid-takedown or landing, the arms are the clip's.
    const working = this.busy === 'work' && !this.isMoving;
    const clipArms = this.busy === 'carry' || this.oneShot !== null || this.lieTarget === 1;
    // (Crawling the gun stays in the hand, so it reads that the agent can fire from the floor: its crawl clip has the arms, the gun is in the fist.)
    if (this.gun) this.gun.group.visible = (!clipArms && !working) || (this.lieTarget === 1 && this.busy !== 'carry' && this.oneShot === null);
    if (this.offGun) this.offGun.group.visible = this.offOn && !!this.gun?.group.visible;
    if (clipArms) return;
    if (working) {
      this.busyTime += dt;
      const t = this.busyTime * TYPING_RATE;
      this.workHand(this.primaryArmChain, this.primaryReach, -WORK_HAND_APART, Math.max(0, Math.sin(t)) * TYPING_LIFT);
      this.workHand(this.supportArmChain, this.supportReach, WORK_HAND_APART, Math.max(0, Math.sin(t + Math.PI)) * TYPING_LIFT);
      return;
    }

    this.readyArms();
  }

  /**
   * Runs after the mixer, so IK is the final word on both arms' pose for
   * this frame — the whole point is to override whatever the stock
   * walk/idle clip put them at. Primary (gun) hand solves first, holding
   * it at a stable "ready" spot instead of the clip's raw arm swing; the
   * support hand then aims at the gun's now-settled foregrip, so it
   * never has to reach further than a real off-hand would.
   */
  private readyArms(): void {
    if (this.primaryArmChain) {
      const shoulder = this.primaryArmChain.joints[0]!.getWorldPosition(new THREE.Vector3());
      const rawTarget = this.rightHandTarget.getWorldPosition(new THREE.Vector3());
      solveCCD(this.primaryArmChain, clampToReach(shoulder, rawTarget, this.primaryReach));
    }
    this.pointGun();
    this.placeOffhand();
    if (this.supportArmChain && this.weaponSupport) {
      const shoulder = this.supportArmChain.joints[0]!.getWorldPosition(new THREE.Vector3());
      const rawTarget = this.weaponSupport.getWorldPosition(new THREE.Vector3());
      solveCCD(this.supportArmChain, clampToReach(shoulder, rawTarget, this.supportReach));
    }
    if (this.gun) this.supportWrist?.(new THREE.Vector3(0, 0, -1).applyQuaternion(this.gun.group.getWorldQuaternion(new THREE.Quaternion())));
    this.curlGrip();
  }

  /**
   * Aiming: the gun comes up to just under the eyes, arms out toward the target, and the head looks along the shot instead of down at the floor. Runs after the clip has posed the
   * body and before the arms' IK, with the gun hand's resting target already set.
   */
  private poseAim(): void {
    const aimK = this.aimK * this.aimK * (3 - 2 * this.aimK);
    if (aimK > 0 && this.head && !this.oneShot) {
      this.mesh.updateMatrixWorld(true);
      const headY = this.head.getWorldPosition(new THREE.Vector3()).y - this.mesh.getWorldPosition(new THREE.Vector3()).y;
      const ready = this.rightHandTarget.position.y;
      this.rightHandTarget.position.set(-0.14 - aimK * 0.06, ready + (headY - AIM_HAND_BELOW_EYES - ready) * aimK, 0.42 + aimK * AIM_HAND_OUT);
      this.levelHead(aimK);
    } else {
      this.rightHandTarget.position.x = -0.14;
      this.rightHandTarget.position.z = 0.42;
    }
  }

  /** Turns `bone` by the world-space rotation `q`. */
  private turnWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
    const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    bone.quaternion.premultiply(parent.clone().invert().multiply(q).multiply(parent));
    bone.updateMatrixWorld(true);
  }

  /** Holds the head level and looking along the agent's facing, `k` of the way (the crouch clip's head is down at the floor): the neck takes some of the turn and the head the rest. */
  private levelHead(k: number): void {
    if (!this.head) return;
    const along = new THREE.Vector3(Math.sin(this.angle) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.angle) * Math.cos(this.aimPitch));
    const turnToward = (bone: THREE.Object3D, share: number): void => {
      const look = this.headForward.clone().applyQuaternion(this.head!.getWorldQuaternion(new THREE.Quaternion())).normalize();
      this.turnWorld(bone, new THREE.Quaternion().identity().slerp(new THREE.Quaternion().setFromUnitVectors(look, along), k * share));
    };
    if (this.neck) turnToward(this.neck, 0.4);
    turnToward(this.head, 1);
  }

  /** Aiming, turns the gun hand so the muzzle points level along the agent's facing (the arm's IK only places the hand), as far as the aim is up. */
  private pointGun(): void {
    if (!this.gun || !this.primaryArmChain || this.oneShot) return;
    // Up from the hand's own aim, round and up or down toward whatever the auto-aim has in the sights (aimGunAt).
    const pitch = this.aimPitch * this.aimK + this.gunPitch * this.gunK;
    const yaw = this.angle + this.gunYaw * this.gunK;
    this.primaryWrist?.(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
  }

  /** How far the gun has swung toward what the auto-aim has in the sights (0 level along the agent's facing, 1 on it), and the yaw and pitch it swings to. */
  private gunK = 0;
  private gunYaw = 0;
  private gunPitch = 0;

  /** The auto-aim: the gun turns, up or down and round, toward `at` (a chest in the sights), or eases back level along the agent's facing with null. Call once a frame. */
  aimGunAt(at: { x: number; y: number; z: number } | null, dt: number): void {
    if (at) {
      const dx = at.x - this.worldPos.x;
      const dz = at.z - this.worldPos.z;
      const flat = Math.hypot(dx, dz);
      let yaw = Math.atan2(dx, dz) - this.angle;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const goalYaw = Math.max(-0.9, Math.min(0.9, yaw));
      const goalPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(at.y - (this.worldPos.y + 1.2), Math.max(0.5, flat))));
      const e = Math.min(1, dt * 12);
      this.gunYaw += (goalYaw - this.gunYaw) * e;
      this.gunPitch += (goalPitch - this.gunPitch) * e;
    }
    this.gunK += ((at ? 1 : 0) - this.gunK) * Math.min(1, dt * 10);
    if (this.gunK < 0.01) this.gunK = 0;
  }

  /**
   * Closes the gun hand's fingers round the grip: the model's own hand is open and flat, so the gun looked held in a palm held out. Each finger joint is put back to its T-pose
   * and curled about the line across the knuckles (the way the hand closes), the trigger finger less than the rest.
   */
  private curlGrip(): void {
    if (this.gun && this.supportIndex && this.supportPinky && this.supportBones.length > 0) {
      this.mesh.updateMatrixWorld(true);
      const acrossLeft = this.supportIndex.getWorldPosition(new THREE.Vector3()).sub(this.supportPinky.getWorldPosition(new THREE.Vector3())).normalize();
      for (const { bone, curl, rest } of this.supportBones) {
        bone.quaternion.copy(rest);
        turnAbout(bone, acrossLeft, curl * SUPPORT_CURL_SIGN);
      }
    }
    if (!this.gun || !this.gripIndex || !this.gripPinky || this.gripBones.length === 0) return;
    this.mesh.updateMatrixWorld(true);
    const across = this.gripIndex.getWorldPosition(new THREE.Vector3()).sub(this.gripPinky.getWorldPosition(new THREE.Vector3())).normalize();
    for (const { bone, curl, rest } of this.gripBones) {
      bone.quaternion.copy(rest);
      turnAbout(bone, across, curl * GRIP_CURL_SIGN);
    }
  }

  /**
   * Climbing a wall (wallclimb.ts): the clips to show, each held at `time` seconds with `weight` (they sum to 1), the agent's root at (x, y, z) facing `angle`. The climb clips are timed to how
   * far the body has risen, so nothing here plays on its own. With a `pin`, the root is then moved so the hands rest on `pin.hands` (the wall's top, going over it), and as `pin.settle`
   * goes from 0 to 1 the hips are brought onto the wall's centre line (`pin.centre` with its normal) so the agent ends up lying along the top, not off one side of it. With `reach`, the hands
   * are put on those two points instead (the pop's arms reaching for the edge).
   */
  holdWall(layers: ReadonlyArray<{ clip: WallClip; time: number; weight: number }>, x: number, y: number, z: number, angle: number, dt: number, pin: WallPin | null = null, limbs: WallLimbs | null = null): void {
    this.worldPos.set(x, y, z);
    this.angle = angle;
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.set(0, angle, 0);
    this.mesh.position.copy(this.worldPos);
    this.oneShot = null;
    this.isMoving = false;
    this.lastWalkPhase = -1;
    const shown = new Map<Pose, (typeof layers)[number]>(layers.map((l) => [WALL_CLIP_POSE[l.clip] as Pose, l]));
    for (const [pose, a] of this.actions) {
      const l = shown.get(pose);
      if (!l) {
        if (a.isScheduled()) a.enabled = false; // off (not weight 0: a weight left at 0 would silence the clip for good: fades scale it)
        continue;
      }
      if (!a.isScheduled()) {
        a.reset();
        a.play();
      }
      a.paused = true;
      a.enabled = true;
      a.time = THREE.MathUtils.clamp(l.time, 0, a.getClip().duration * 0.999);
      a.setEffectiveWeight(l.weight);
    }
    this.mixer?.update(dt);
    if (this.gun) this.gun.group.visible = false;
    this.mesh.updateMatrixWorld(true);
    // The wall run: the feet planted flat on the face, one after the other, and both hands stretched for the top edge, each as far along from where the clip has it as its weight says.
    if (limbs?.feet) {
      for (const [chain, f] of [[this.legChains.right, limbs.feet.right], [this.legChains.left, limbs.feet.left]] as const) {
        if (!chain || f.w <= 0.001) continue;
        const now = chain.endEffector.getWorldPosition(new THREE.Vector3());
        this.handTo(chain, this.legReach, now.lerp(new THREE.Vector3(f.x, f.y, f.z), f.w), 0.98);
        this.mesh.updateMatrixWorld(true);
        // Flat on the face: the toes turned up (about the agent's lateral axis), the sole against the wall.
        const foot = chain.endEffector;
        const lateral = new THREE.Vector3(-Math.cos(this.angle), 0, Math.sin(this.angle));
        const turned = new THREE.Quaternion().setFromAxisAngle(lateral, WALL_FOOT_PITCH * f.w).multiply(foot.getWorldQuaternion(new THREE.Quaternion()));
        const parentQ = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
        foot.quaternion.copy(parentQ.invert().multiply(turned));
        this.mesh.updateMatrixWorld(true);
      }
    }
    if (limbs?.hands && limbs.hands.w > 0.001) {
      const { right, left, w } = limbs.hands;
      for (const [chain, reachLen, p] of [[this.primaryArmChain, this.primaryReach, right], [this.supportArmChain, this.supportReach, left]] as const) {
        if (!chain) continue;
        const now = chain.endEffector.getWorldPosition(new THREE.Vector3());
        this.handTo(chain, reachLen, now.lerp(new THREE.Vector3(p.x, p.y, p.z), w));
      }
      this.mesh.updateMatrixWorld(true);
    }
    if (pin) {
      const hl = this.mesh.getObjectByName('mixamorigLeftHand')?.getWorldPosition(new THREE.Vector3());
      const hr = this.mesh.getObjectByName('mixamorigRightHand')?.getWorldPosition(new THREE.Vector3());
      if (hl && hr) {
        const mid = hl.add(hr).multiplyScalar(0.5);
        let sx = pin.hands.x - mid.x;
        const sy = pin.hands.y - mid.y;
        let sz = pin.hands.z - mid.z;
        if (pin.settle > 0 && this.hips) {
          // After the hands' shift, how far the hips are from the wall's centre line (across it): brought in as the agent settles.
          const hips = this.hips.getWorldPosition(new THREE.Vector3());
          const across = (hips.x + sx - pin.centre.x) * pin.normal.x + (hips.z + sz - pin.centre.z) * pin.normal.z;
          sx -= across * pin.normal.x * pin.settle;
          sz -= across * pin.normal.z * pin.settle;
        }
        this.mesh.position.x += sx;
        this.mesh.position.y += sy;
        this.mesh.position.z += sz;
        this.worldPos.copy(this.mesh.position);
        this.mesh.updateMatrixWorld(true);
      }
    }
    this.pose = null; // the next ordinary pose starts afresh, fading from whatever is showing
    this.updateLight();
  }

  /** Lying on the wall top and rolling over its edge: the lying pose turned `roll` radians about the way the agent faces (wallclimb.ts), on its way to the fall. */
  holdRoll(x: number, y: number, z: number, angle: number, roll: number, dt: number): void {
    this.hold(x, y, z, angle, 'perch', dt);
    this.mesh.rotation.z = roll;
    this.mesh.updateMatrixWorld(true);
  }

  /** The upright body tipped `roll` radians about the way it faces (a fall that starts off a roll, straightening as it comes down). Reset by the next hold() or place(). */
  tilt(roll: number): void {
    this.mesh.rotation.z = roll;
    this.mesh.updateMatrixWorld(true);
  }

  /** Where the hips are, in the world: the body's centre when lying. */
  hipsPosition(): THREE.Vector3 {
    this.mesh.updateMatrixWorld(true);
    return this.hips ? this.hips.getWorldPosition(new THREE.Vector3()) : this.worldPos.clone();
  }

  /** Lying flat (or not) at once, with no crawl-enter or -exit to play: for going over a wall's top, where the climb's own clips have just done it. */
  snapProne(on: boolean): void {
    this.lieTarget = on ? 1 : 0;
    this.lie = this.lieTarget;
    this.oneShot = null;
    this.pose = null;
  }

  /**
   * Off the floor (game.ts's climbing and hanging): puts the agent at (x, y, z) facing `angle`, and
   * poses it for `aloft`. Climbing, hand over hand up the rungs in front; on the platform, standing with the
   * gun up; hanging, from both hands on the pipe `handY` overhead (world), knees bent, going hand over
   * hand as it shimmies; letting go, arms still up and knees bent as it falls. `travel` is how far it has
   * climbed or shimmied so far, which paces the hands. Call once a frame instead of tick().
   */
  hold(x: number, y: number, z: number, angle: number, aloft: Aloft, dt: number, travel = 0, handY = y + this.hangDrop, hover = 0): void {
    this.worldPos.set(x, y, z);
    this.angle = angle;
    this.mesh.rotation.z = 0; // (holdRoll() and tilt() set it again after)
    // Lowered on the line over a console (`hover` 0–1, how far down), the agent tips forward about the hips until it is flat, face down, like a thief on a cable over a vault floor.
    const flat = aloft === 'hang' ? THREE.MathUtils.clamp(hover, 0, 1) : 0;
    this.hoverFlat = flat;
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.x = flat * (Math.PI / 2);
    this.mesh.rotation.y = angle;
    if (flat > 0) {
      // The hips stay over the agent's place, rising to the hover height as it tips; the mesh's own origin (the feet) goes wherever that puts it.
      const pitch = flat * (Math.PI / 2);
      const hipY = y + this.hipsRestHeight * (1 - flat) + HOVER_BODY_LIFT * flat;
      const hipH = this.hipsRestHeight;
      this.mesh.position.set(x - Math.sin(angle) * hipH * Math.sin(pitch), hipY - hipH * Math.cos(pitch), z - Math.cos(angle) * hipH * Math.sin(pitch));
    } else {
      this.mesh.position.copy(this.worldPos);
    }
    // Pulling up onto a platform: the library's ClimbUp_1m, held at `travel` (0–1) of the way through, so a
    // climb down can run it backwards. Without it, the hands stay on the rungs the whole way.
    const mantle = this.actions.get('mantle');
    if (aloft === 'mantle' && mantle) {
      this.oneShot = null;
      this.playPose('mantle');
      mantle.paused = true;
      mantle.time = THREE.MathUtils.clamp(travel, 0, 1) * mantle.getClip().duration;
      this.mixer?.update(dt);
      if (this.gun) this.gun.group.visible = false;
      this.updateLight();
      return;
    }
    if (aloft === 'mantle') aloft = 'climb';
    // Falling, the drop's own clip if it loaded (the arms-up, knees-bent pose below stands in if not).
    const falling = aloft === 'fall' && this.actions.has('fall');
    // Lying down on the platform to aim, or getting up from it: the crawl's enter and exit clips play through (the arms are theirs) instead of the agent popping between the two poses.
    const shifting = aloft === 'perch' && (this.oneShot?.pose === 'proneEnter' || this.oneShot?.pose === 'proneExit');
    if (shifting && this.oneShot) {
      this.oneShot.left -= dt;
      if (this.oneShot.left <= 0) this.oneShot = null;
    } else this.oneShot = null;
    // Lying flat on the platform to aim: the crawl's own idle (the arms come from the aim pose).
    if (!this.oneShot) this.playPose(aloft === 'climb' ? 'walk' : falling ? 'fall' : aloft === 'perch' && this.lieTarget === 1 ? 'proneIdle' : 'idle');
    this.isMoving = false;
    this.lastWalkPhase = -1;
    const walk = this.actions.get('walk');
    if (walk) walk.timeScale = 1;
    this.mixer?.update(dt);
    if (this.gun) this.gun.group.visible = aloft === 'perch';
    this.mesh.updateMatrixWorld(true);
    if (falling) {
      this.updateLight();
      return;
    }
    if (aloft === 'perch' && !this.oneShot) {
      if (this.hips) this.rightHandTarget.position.y = HAND_READY_Y - Math.max(0, this.hipsRestHeight - (this.hips.getWorldPosition(new THREE.Vector3()).y - this.mesh.getWorldPosition(new THREE.Vector3()).y));
      this.poseAim();
      this.readyArms();
    }
    else if (aloft === 'climb') {
      // One hand a rung above the other, swapping each rung climbed.
      const phase = (travel / RUNG_STEP) * Math.PI;
      const lift = (Math.sin(phase) * RUNG_STEP) / 2;
      const h = this.shoulderRest + 0.2;
      this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-0.6, this.shoulderRest, 0.2)));
      this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-RUNG_APART, h + lift, RUNG_AHEAD)));
      this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(0.6, this.shoulderRest, 0.2)));
      this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(RUNG_APART, h - lift, RUNG_AHEAD)));
    } else {
      this.bendLegs(aloft === 'hang' ? 1 - flat : 0.6);
      // The shoulders ride up with the weight on the arms (about the way the agent faces: the left side up is a positive turn).
      const forward = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle));
      for (const { bone, side } of this.collarbones) turnAbout(bone, forward, side * HANG_SHRUG * (1 - flat));
      // Hand over hand: the hands swap places along the pipe, the back one passing the front one, each stride.
      // Each arm is swung out to the side first: from hanging down, straight up is the one direction CCD can't
      // find a way to turn toward (ik.ts's solveCCD rotates about the cross product, which is nothing there).
      const reach = Math.sin((travel / HANG_STRIDE) * Math.PI) * HANG_REACH;
      const up = handY - WRIST_TO_GRIP - y;
      const side = this.shoulderRest;
      // With the shoulders up, the body hangs that much lower for straight arms: game.ts reads this next frame.
      if (aloft === 'hang' && this.primaryArmChain) {
        const shoulder = this.primaryArmChain.joints[0]!.getWorldPosition(new THREE.Vector3()).y - y;
        this.hangDrop = shoulder + this.primaryReach * 0.96 + WRIST_TO_GRIP;
      }
      if (flat <= 0.001 && this.ledgeGrip && this.primaryArmChain && this.supportArmChain) {
        // A ledge across the body: each hand straight above its own shoulder, on the edge ahead; shimmying, they take turns reaching along it.
        const shoulderX = (chain: IKChain): number => Math.abs(this.mesh.worldToLocal(chain.joints[0]!.getWorldPosition(new THREE.Vector3())).x);
        const shift = Math.sin((travel / HANG_STRIDE) * Math.PI) * LEDGE_HAND_SHIFT;
        this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-0.6, side + 0.3, 0)));
        this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-shoulderX(this.primaryArmChain) + shift, up, LEDGE_HANDS_AHEAD)), 0.99);
        this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(0.6, side + 0.3, 0)));
        this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(shoulderX(this.supportArmChain) - shift, up, LEDGE_HANDS_AHEAD)), 0.99);
      } else if (flat <= 0.001) {
        this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-0.6, side + 0.3, 0)));
        this.handTo(this.primaryArmChain, this.primaryReach, this.mesh.localToWorld(new THREE.Vector3(-HANG_APART, up, reach)), 0.99);
        this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(0.6, side + 0.3, 0)));
        this.handTo(this.supportArmChain, this.supportReach, this.mesh.localToWorld(new THREE.Vector3(HANG_APART, up, -reach)), 0.99);
      } else {
        // Tipping over: the hands go from the line overhead (held in the upright frame, which the body is leaving) to the console below, reaching straight down from the
        // shoulders (the body's own front is down now), tapping when the hands are busy.
        const s = flat * flat * (3 - 2 * flat);
        const yaw = new THREE.Matrix4().makeRotationY(angle);
        const base = new THREE.Vector3(x, y, z);
        const tap = this.busy === 'work' ? Math.max(0, Math.sin(this.busyTime * TYPING_RATE)) * 0.03 : 0;
        const tap2 = this.busy === 'work' ? Math.max(0, Math.sin(this.busyTime * TYPING_RATE + Math.PI)) * 0.03 : 0;
        if (this.busy === 'work') this.busyTime += dt;
        const blend = (sideSign: number, ahead: number, lift: number, chain: IKChain | null, reachLen: number): void => {
          const overhead = new THREE.Vector3(sideSign * HANG_APART, up, ahead).applyMatrix4(yaw).add(base);
          const console = this.mesh.localToWorld(new THREE.Vector3(sideSign * HOVER_HANDS_APART, this.shoulderRest + 0.05, reachLen * HOVER_REACH - lift));
          this.handTo(chain, reachLen, overhead.lerp(console, s), 0.99);
        };
        blend(-1, reach, tap, this.primaryArmChain, this.primaryReach);
        blend(1, -reach, tap2, this.supportArmChain, this.supportReach);
      }
    }
    this.updateLight();
  }

  /**
   * Where the line meets the agent: the hands, overhead, hanging upright; the middle of the back, flat over a console (the cable is clipped to a harness there). Blends
   * between the two as the agent tips over. `handsPoint` is where the hands are while upright.
   */
  ropeAnchor(handsPoint: THREE.Vector3): THREE.Vector3 {
    if (this.hoverFlat <= 0.001) return handsPoint;
    this.mesh.updateMatrixWorld(true);
    const back = this.mesh.localToWorld(new THREE.Vector3(0, this.shoulderRest * 0.8, -0.18));
    const s = this.hoverFlat * this.hoverFlat * (3 - 2 * this.hoverFlat);
    return handsPoint.clone().lerp(back, s);
  }

  /** Swings the thighs forward and bends the knees back (`amount` of HANG_HIPS / HANG_KNEES), about the body's own left–right axis. */
  private bendLegs(amount: number): void {
    const right = new THREE.Vector3(-Math.cos(this.angle), 0, Math.sin(this.angle));
    for (const { thigh, shin } of this.legs) {
      turnAbout(thigh, right, HANG_HIPS * amount);
      turnAbout(shin, right, -HANG_KNEES * amount);
    }
  }

  /** One hand to a world point (clamped to its reach, at `safety` of it). */
  private handTo(chain: IKChain | null, reach: number, target: THREE.Vector3, safety?: number): void {
    if (!chain) return;
    solveCCD(chain, clampToReach(chain.joints[0]!.getWorldPosition(new THREE.Vector3()), target, reach, safety));
  }

  /** One hand onto the console: `side` across the body (+ left, the root's local +x), `lift` above it, mid-tap. */
  private workHand(chain: IKChain | null, reach: number, side: number, lift: number): void {
    if (!chain) return;
    const target = this.mesh.localToWorld(new THREE.Vector3(side, WORK_HAND_Y + lift, WORK_HAND_AHEAD));
    solveCCD(chain, clampToReach(chain.joints[0]!.getWorldPosition(new THREE.Vector3()), target, reach));
    this.twistForearm(chain, WORK_FOREARM_TWIST);
  }

  /** Turns the forearm (and so the hand on it) about its own length by `angle`: the hand stays where it is, the palm comes round (the IK only places the hand, not which way it faces). */
  private twistForearm(chain: IKChain, angle: number): void {
    const fore = chain.joints[1];
    if (!fore || angle === 0) return;
    const elbow = fore.getWorldPosition(new THREE.Vector3());
    const axis = chain.endEffector.getWorldPosition(new THREE.Vector3()).sub(elbow);
    if (axis.lengthSq() < 1e-8) return;
    const turned = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle).multiply(fore.getWorldQuaternion(new THREE.Quaternion()));
    const parentQ = fore.parent!.getWorldQuaternion(new THREE.Quaternion());
    fore.quaternion.copy(parentQ.invert().multiply(turned));
    fore.updateMatrixWorld(true);
  }

  /** A takedown's blow: the hook, a kick (a guard at its side) or a sword's cut (from behind), played through once, gun away, then back to whatever fits. */
  strike(kind: 'strike' | 'kick' | 'sword' = 'strike'): void {
    const pose = this.actions.has(kind) ? kind : 'strike';
    this.playOnce(pose, pose === 'kick' ? 0.75 : pose === 'sword' ? 0.9 : undefined);
  }

  /** Landing from a drop: a crouch to take the fall, played through once. */
  land(seconds?: number, soft = false): void {
    // (`soft`: Jump_Land, the library's landing out of a jump: a deep crouch that comes up again, for off a wall's top)
    this.playOnce(soft && this.actions.has('jumpLand') ? 'jumpLand' : 'land', seconds);
  }

  /** Cuts a landing short (the agent has set off again): the jog or the idle takes over. */
  endLanding(): void {
    if (this.oneShot?.pose === 'land' || this.oneShot?.pose === 'jumpLand') this.oneShot = null;
  }

  /** Plays `pose` through once, over `seconds` if given (quickened or slowed to fit), else at its own pace. */
  /** The agent is hit: a quick reaction (the library's, a different one each time), not while they are going down. */
  flinch(): void {
    if (this.dead) return;
    const pose = (['hitA', 'hitB', 'hitC', 'hitD'] as const)[Math.floor(Math.random() * 4)]!;
    if (this.actions.has(pose)) this.playOnce(pose, 0.5, 0.5);
  }

  /** The agent goes down: the library's death fall, played quickly and held on its last frame, turned toward where the blow came from (so they fall away from it). */
  die(from?: { x: number; z: number }): void {
    if (this.dead || !this.actions.has('death')) return;
    this.dead = true;
    if (from) {
      this.angle = Math.atan2(from.x - this.worldPos.x, from.z - this.worldPos.z);
      this.mesh.rotation.y = this.angle;
    }
    this.playOnce('death', Infinity, 1.6);
  }

  /** Back on their feet (a checkpoint resume after going down). */
  revive(): void {
    if (!this.dead) return;
    this.dead = false;
    this.oneShot = null;
    this.pose = null;
    this.playPose('idle');
  }

  get isDown(): boolean {
    return this.dead;
  }

  private playOnce(pose: Pose, seconds?: number, playSeconds = seconds): void {
    const action = this.actions.get(pose);
    if (!action) return;
    const duration = action.getClip().duration;
    action.timeScale = playSeconds ? duration / playSeconds : 1;
    this.oneShot = { pose, left: seconds ?? duration };
    this.pose = null; // so playPose starts it over even if it's the pose already showing
    const fading = this.stillBlended(action);
    action.reset().play();
    action.weight = 1;
    for (const a of fading) a.crossFadeTo(action, 0.1, true);
    this.pose = pose;
  }

  /**
   * Where a carried body rides (world): its hips a little out in front of the agent's hands and just
   * above them, so it rests on the forearms. Follows the hands as the carry walks.
   */
  carryAnchor(): THREE.Vector3 {
    const model = this.mesh.children.find((c) => c.getObjectByName('mixamorigLeftHand'));
    const l = model?.getObjectByName('mixamorigLeftHand')?.getWorldPosition(new THREE.Vector3());
    const r = model?.getObjectByName('mixamorigRightHand')?.getWorldPosition(new THREE.Vector3());
    const at = l && r ? l.add(r).multiplyScalar(0.5) : new THREE.Vector3(this.worldPos.x, this.worldPos.y + 1, this.worldPos.z);
    at.x += Math.sin(this.angle) * CARRY_OUT;
    at.z += Math.cos(this.angle) * CARRY_OUT;
    at.y += CARRY_LIFT;
    return at;
  }

  /** Puts the gun away while the hands are busy (see Busy), and brings it back up after. */
  setBusy(busy: Busy): void {
    if (busy !== this.busy) this.busyTime = 0;
    this.busy = busy;
  }

  // Real bug report ("torch light still stays on bottom floor"): this used
  // fixed absolute Y values (1.4/0.5/0.9), never offset by worldPos.y — the
  // same class of oversight already caught and fixed for updateCamera() and
  // muzzleWorldPosition() when Y movement was first added, just missed here.
  // Harmless on a single floor (worldPos.y was always 0), but on floor 1 the
  // torch/footLight stayed pinned near world y≈1, well below the player's
  // actual y≈4 — reading as "the light got left behind downstairs."
  private updateLight(): void {
    // From the shoulder lamp once the agent has loaded (its pose from the last frame); chest height until then.
    const fx = Math.sin(this.angle);
    const fz = Math.cos(this.angle);
    if (this.lamp) this.lamp.anchor.getWorldPosition(this.lampPos);
    else this.lampPos.set(this.worldPos.x, this.worldPos.y + 1.4, this.worldPos.z);
    this.light.position.set(this.lampPos.x + fx * TORCH_AHEAD, this.lampPos.y, this.lampPos.z + fz * TORCH_AHEAD);
    this.lightTarget.position.set(this.worldPos.x + fx * 2, this.worldPos.y + 0.5, this.worldPos.z + fz * 2);
    this.footLight.position.set(this.worldPos.x + fx * FOOT_LIGHT_AHEAD, this.worldPos.y + FOOT_LIGHT_HEIGHT, this.worldPos.z + fz * FOOT_LIGHT_AHEAD);
  }

  /**
   * Turn + move forward/back/sideways along current facing, with
   * axis-separated wall sliding. `input.strafe` (-1 left, +1 right) is Q/E
   * in controls-keyboard.ts, and means two different things depending on
   * `input.sneak`: not sneaking, it's a brisk, unlimited-distance sidestep
   * into an open side passage, without turning to face it. Sneaking, it
   * instead drives `leanOffset` — a small spring-loaded peek (capped at
   * MAX_LEAN_DISTANCE) that eases back to center the instant it's released
   * or sneak is toggled off, rather than committing the body further and
   * further sideways. `laserBoxes` (optional) are corridor obstacles that
   * block unless camo is on — see lasers.ts and camo.ts. `stairs` (optional) are
   * multi-floor connectors — see stairs.ts's stairGroundHeight(), which
   * drives worldPos.y/currentFloorIdx directly rather than any
   * jump/gravity physics, since stairs are walked, not fallen onto. Call
   * once per frame.
   */
  tick(input: MoveInput, dt: number, wallBoxes: WallBox[], blockers: Blocker[] = [], laserBoxes: WallBox[] = [], stairs: Stair[] = []): void {
    // Down: nothing moves, and the fall plays out.
    if (this.dead) {
      this.running = false;
      this.updateAnimation({ forward: 0, side: 0, sneaking: false, cover: false }, dt);
      return;
    }
    // Turn is subtracted, not added: this chase camera sits behind the
    // player looking back toward +Z (not Three.js's default -Z), which
    // mirrors its local right axis relative to world +X (verified directly
    // against Three.js's own camera matrix) — so increasing `angle` the
    // "naive" way actually swings the view left instead of right.
    this.running = !!input.dash && input.throttle > 0 && !input.prone && !input.sneak;
    this.angle -= input.turn * TURN_SPEED * dt;
    if (this.angle > Math.PI) this.angle -= Math.PI * 2;
    else if (this.angle < -Math.PI) this.angle += Math.PI * 2;
    this.mesh.rotation.x = 0; // upright again (hold() tips the agent over for a hover)
    this.mesh.rotation.z = 0;
    this.mesh.rotation.y = this.angle;

    // Sideways distance to attempt *this frame* — for the lean case this is
    // a raw distance (however far leanOffset moved toward its target this
    // frame), not a velocity, so it's computed up front rather than folded
    // into the same speed*dt shape as throttle below.
    let strafeDist: number;
    if (input.cover) {
      strafeDist = input.strafe * COVER_SLIDE_SPEED * dt;
    } else if (input.prone) {
      // Flat on the floor: no peeking round corners or sidestepping, and any lean eases back.
      const maxStep = LEAN_SPEED * dt;
      strafeDist = THREE.MathUtils.clamp(0 - this.leanOffset, -maxStep, maxStep);
      this.leanOffset += strafeDist;
    } else if (input.sneak && !input.freeStrafe) {
      const targetLean = input.strafe * MAX_LEAN_DISTANCE;
      const maxStep = LEAN_SPEED * dt;
      strafeDist = THREE.MathUtils.clamp(targetLean - this.leanOffset, -maxStep, maxStep);
      this.leanOffset += strafeDist;
    } else {
      // Not sneaking: any lingering lean (e.g. sneak was just toggled off
      // mid-peek) eases back to center too, on top of the normal sidestep.
      const maxStep = LEAN_SPEED * dt;
      const returnDist = THREE.MathUtils.clamp(0 - this.leanOffset, -maxStep, maxStep);
      this.leanOffset += returnDist;
      strafeDist = returnDist + input.strafe * STRAFE_SPEED * (input.carrying ? CARRY_SPEED_FACTOR : 1) * dt;
    }

    let throttleDist = input.cover
      ? 0
      : (input.throttle > 0 ? MOVE_SPEED : BACK_SPEED) * (input.prone ? PRONE_SPEED : input.sneak ? SNEAK_SPEED_FACTOR : input.dash && input.throttle > 0 ? DASH_FACTOR : 1) * (input.carrying ? CARRY_SPEED_FACTOR : 1) * input.throttle * dt;
    // Speed builds up over moveEase seconds and runs down the same way, rather than being full the instant a key goes down.
    if (this.moveEase > 0 && dt > 0 && !input.cover) {
      const rate = (MOVE_SPEED * DASH_FACTOR) / this.moveEase;
      const target = throttleDist / dt;
      this.forwardSpeed += THREE.MathUtils.clamp(target - this.forwardSpeed, -rate * 1.4 * dt, rate * dt);
      throttleDist = this.forwardSpeed * dt;
    } else this.forwardSpeed = throttleDist / (dt || 1);

    // A dash (a takedown's lunge, or a dodge) carries the player on top of any input.
    let lungeX = 0;
    let lungeZ = 0;
    if (this.lungeLeft > 0) {
      const step = Math.min(dt, this.lungeLeft);
      this.lungeLeft -= step;
      lungeX = this.lungeDir.x * step;
      lungeZ = this.lungeDir.z * step;
      if (this.lungeLeft <= 0) this.nextDashStage();
    }

    if (throttleDist !== 0 || strafeDist !== 0 || lungeX !== 0 || lungeZ !== 0) {
      const dirX = Math.sin(this.angle);
      const dirZ = Math.cos(this.angle);
      // Screen-right when facing forward. The naive perpendicular-of-forward
      // formula (cos θ, -sin θ) was backwards in practice — same "mirrored
      // axis" rig quirk noted above for turn, confirmed live (reported as Q/E
      // being swapped), not just derived on paper. This is the corrected sign.
      const rightX = -Math.cos(this.angle);
      const rightZ = Math.sin(this.angle);
      const moveX = dirX * throttleDist + rightX * strafeDist + lungeX;
      const moveZ = dirZ * throttleDist + rightZ * strafeDist + lungeZ;

      // Laser beams stop the player unless camo is on. Someone already
      // standing in a beam (camo ran out mid-crossing) can always walk out.
      const lasersBlock = !input.camo && !collides(this.worldPos.x, this.worldPos.z, laserBoxes);
      // Free, or at least less stuck than now (see overlap()).
      // (Lying flat, a space under furniture is open: wallBoxes' `under` ones.)
      const crawling = this.lieAmount > 0.8;
      const ducking = crawling || !!input.sneak;
      const canStand = (x: number, z: number): boolean => {
        if (!collides(x, z, wallBoxes, crawling, ducking) && !collidesBlockers(x, z, blockers)) return true;
        return overlap(x, z, wallBoxes, blockers, crawling, ducking) < overlap(this.worldPos.x, this.worldPos.z, wallBoxes, blockers, crawling, ducking) - 1e-6;
      };
      const tryX = this.worldPos.x + moveX;
      const laserBlockedX = lasersBlock && collides(tryX, this.worldPos.z, laserBoxes);
      if (canStand(tryX, this.worldPos.z) && !laserBlockedX) {
        this.worldPos.x = tryX;
      }
      const tryZ = this.worldPos.z + moveZ;
      const laserBlockedZ = lasersBlock && collides(this.worldPos.x, tryZ, laserBoxes);
      if (canStand(this.worldPos.x, tryZ) && !laserBlockedZ) {
        this.worldPos.z = tryZ;
      }
    }

    // Vertical resolution — outside the X/Z-moved guard above so standing
    // still on a stair (or right at a floor's base height) still resolves
    // correctly every frame, not just on frames with real movement. A stair
    // claiming this X/Z sets worldPos.y directly from its height field.
    //
    // Real bug, reported live and reproduced ("floating right around the
    // stairs, wrong collision"): floorIdx used to be re-derived from
    // worldPos.y (rounded to the nearest FLOOR_HEIGHT multiple) every single
    // frame, including while still on the stair — meaning it flipped to the
    // floor above at the geometric *midpoint* of the climb, well before the
    // player had actually left the stair cell's own footprint. game.ts picks
    // which floor's wallBoxes apply for collision from this same floorIdx,
    // so for the second half of every climb, the stair cell's own side walls
    // (which belong to the floor the climb *started* on) stopped applying —
    // replaced by the floor above's walls, which live in a totally different
    // XZ region and so don't cover this spot at all. Nothing was left to
    // stop the player drifting sideways off the stairs.
    //
    // Fixed by only updating floorIdx once the player has genuinely left the
    // stair's footprint (onStair false) — while on it, floorIdx stays frozen
    // at whichever floor the climb started on, so its side walls (from that
    // same floor's wallBoxes) keep applying for the entire climb, both
    // directions, not just the first half.
    let onStair = false;
    for (const stair of stairs) {
      const h = stairGroundHeight(stair, this.worldPos.x, this.worldPos.z, CELL);
      if (h !== null) {
        this.worldPos.y = h;
        onStair = true;
        break;
      }
    }
    if (!onStair) {
      this.floorIdx = Math.round(this.worldPos.y / this.floorHeight);
      this.worldPos.y = this.floorIdx * this.floorHeight;
    }
    this.mesh.position.copy(this.worldPos);

    this.updateAnimation({ forward: dt > 0 ? throttleDist / dt : 0, side: dt > 0 ? strafeDist / dt : 0, sneaking: input.sneak, cover: !!input.cover }, dt);
    this.updateLight();
  }

  /** Chase cam: always positioned behind wherever the player currently faces, and now rises/falls with worldPos.y so it follows the player up/down stairs instead of sitting at a fixed world height. */
  private shakeAmt = 0;

  /** Kicks the chase camera; decays over the next few frames. */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Radians the chase camera swings round off straight behind (hanging, so the pipe you hang from doesn't hide you). */
  camSwing = 0;
  /** The camera is at the agent's eyes (setEyeView). */
  private eyeView = false;
  private readonly hideHeadUniform = { value: 0 };
  private headPatched = new Set<THREE.Material>();
  /** The face's parts and the hair the camera would sit inside, hidden while the view is from the eyes. */
  private eyeHidden: THREE.Object3D[] = [];

  /**
   * Aiming from a platform is seen from the agent's own eyes: the body is still there, lying on the platform, but the camera is in the head and looking along the gun, so only the
   * arms and the gun are in front of it. The head's own skin, which the camera would be inside, is not drawn for it (each skinned vertex is tagged with how much of it follows the
   * head and neck, and the fragments that mostly do are discarded), nor are the lashes, brows, eyes, teeth and hair.
   */
  setEyeView(on: boolean): void {
    if (on === this.eyeView) return;
    this.eyeView = on;
    this.hideHeadUniform.value = on ? 1 : 0;
    if (on) {
      this.eyeHidden = [];
      this.mesh.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          this.tagHeadVertices(mesh as THREE.SkinnedMesh);
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.patchHideHead(m);
        } else {
          // Not skinned: a piece of hair (or the lamp) riding on a bone; the gun is the point of it all, and stays.
          for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === (this.gun?.group ?? null)) return;
          if (mesh.visible && this.underHead(o)) {
            mesh.visible = false;
            this.eyeHidden.push(o);
          }
        }
      });
    } else {
      for (const o of this.eyeHidden) o.visible = true;
      this.eyeHidden = [];
    }
  }

  private underHead(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p && p !== this.mesh; p = p.parent) if (HEAD_BONE.test(p.name)) return true;
    return false;
  }

  /** Gives a skinned mesh's geometry a `headWeight` attribute: how much of each vertex follows the head and neck bones (once per geometry). */
  private tagHeadVertices(mesh: THREE.SkinnedMesh): void {
    const geometry = mesh.geometry;
    if (geometry.getAttribute('headWeight')) return;
    const index = geometry.getAttribute('skinIndex');
    const weight = geometry.getAttribute('skinWeight');
    if (!index || !weight) return;
    const head = mesh.skeleton.bones.map((b) => HEAD_BONE.test(b.name));
    const out = new Float32Array(index.count);
    for (let v = 0; v < index.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) if (head[index.getComponent(v, k)]) sum += weight.getComponent(v, k);
      out[v] = sum;
    }
    geometry.setAttribute('headWeight', new THREE.BufferAttribute(out, 1));
  }

  private patchHideHead(material: THREE.Material): void {
    if (this.headPatched.has(material)) return;
    this.headPatched.add(material);
    const previous = material.onBeforeCompile;
    const uniform = this.hideHeadUniform;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.uHideHead = uniform;
      shader.vertexShader = `attribute float headWeight;\nvarying float vHeadWeight;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHeadWeight = headWeight;')}`;
      shader.fragmentShader = `uniform float uHideHead;\nvarying float vHeadWeight;\n${shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (uHideHead > 0.5 && vHeadWeight > 0.5) discard;')}`;
    };
    material.customProgramCacheKey = () => 'hideHead';
    material.needsUpdate = true;
  }

  /** 1 while leaning out of cover to aim (game.ts): the camera comes in behind the shoulder, looking along the aim. It eases in and out by itself. */
  aimGoal = 0;
  /** How far the aim is tilted, radians, up positive: aiming down from a platform (game.ts). The camera, the head and the gun follow it. */
  aimPitch = 0;
  private aimK = 0;
  /** How far into the aim the view is, 0 (the chase camera) to 1 (over the sights). */
  get aimAmount(): number {
    return this.aimK;
  }
  /** The walls the shoulder camera must not back into while aiming (game.ts hands over the floor's, furniture left out). */
  aimWalls: WallBox[] = [];
  private aimReach = 1;

  /** Down flat, or up from it: the library's crawl-enter and crawl-exit clips play through (quickened), and the camera eases down with them (stepLie). */
  setProne(on: boolean, toCrouch = false): void {
    const target = on ? 1 : 0;
    if (target === this.lieTarget) return;
    this.lieTarget = target;
    // Up from flat into a crouch: the crawl-exit clip runs on to standing, so it is played only as far as the crouch (its hips pass crouch height about half way) and the crouch pose takes over.
    if (!on && toCrouch) this.playOnce('proneExit', PRONE_SHIFT_S * PRONE_TO_CROUCH, PRONE_SHIFT_S);
    else this.playOnce(on ? 'proneEnter' : 'proneExit', PRONE_SHIFT_S);
  }

  get prone(): boolean {
    return this.lieTarget === 1;
  }

  /** How far down the agent is, 0 standing to 1 flat (eased): game.ts slides it to the middle of a platform as it lies down on one. */
  get lieAmount(): number {
    return this.lie * this.lie * (3 - 2 * this.lie);
  }

  /** Eases the camera down toward the floor while the agent lies flat (and back up). Call once a frame. */
  stepLie(dt: number): void {
    const gap = this.lieTarget - this.lie;
    if (gap !== 0) this.lie += Math.sign(gap) * Math.min(Math.abs(gap), dt / LIE_S);
  }

  updateCamera(camera: THREE.PerspectiveCamera): void {
    const lowered = this.lie * this.lie * (3 - 2 * this.lie);
    this.aimK += (this.aimGoal - this.aimK) * 0.16;
    if (Math.abs(this.aimGoal - this.aimK) < 0.002) this.aimK = this.aimGoal;
    const camX = this.worldPos.x - Math.sin(this.angle + this.camSwing) * CAM_BACK;
    const camZ = this.worldPos.z - Math.cos(this.angle + this.camSwing) * CAM_BACK;
    const s = this.shakeAmt;
    const jx = (Math.random() - 0.5) * s;
    const jy = (Math.random() - 0.5) * s;
    const jz = (Math.random() - 0.5) * s;
    let px = camX + jx;
    let py = this.worldPos.y + CAM_HEIGHT - lowered * 1.2 + jy;
    let pz = camZ + jz;
    let lx = this.worldPos.x + Math.sin(this.angle + this.camSwing) * CAM_AHEAD + jx * 0.5;
    let ly = this.worldPos.y + 1 - lowered * 0.7;
    let lz = this.worldPos.z + Math.cos(this.angle + this.camSwing) * CAM_AHEAD + jz * 0.5;
    if (this.aimK > 0) {
      // Over the right shoulder, low and close, looking down the line of fire: the middle of the view is where the shot goes.
      const k = this.aimK * this.aimK * (3 - 2 * this.aimK);
      const fx = Math.sin(this.angle);
      const fz = Math.cos(this.angle);
      const rx = -fz; // the agent's right hand, with 0 facing +Z
      const rz = fx;
      // Pulled in toward the agent when a wall is in the way, so the view never ends up behind one.
      const offX = -fx * AIM_BACK + rx * AIM_SIDE;
      const offZ = -fz * AIM_BACK + rz * AIM_SIDE;
      const offLen = Math.hypot(offX, offZ);
      const free = rayToBoxes(this.worldPos.x, this.worldPos.z, offX / offLen, offZ / offLen, offLen + 0.35, this.aimWalls) - 0.35;
      const reach = Math.max(0.2, Math.min(1, free / offLen));
      this.aimReach += (reach - this.aimReach) * (reach < this.aimReach ? 0.6 : 0.15);
      if (this.eyeView && this.gun) {
        // Looking down the gun, as over the sights of a rifle: behind the gun along the line of fire, a little above it, the view square to that line, so the gun sits low in the middle
        // with the hand round its grip and the crosshair where the barrel points. The head, behind the camera, is not drawn.
        this.mesh.updateMatrixWorld(true);
        const cp = Math.cos(this.aimPitch);
        const dir = new THREE.Vector3(fx * cp, Math.sin(this.aimPitch), fz * cp);
        const eye = this.gun.group.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, -EYE_BEHIND_GUN);
        eye.y += EYE_ABOVE_GUN;
        px += (eye.x + jx - px) * k;
        py += (eye.y + jy - py) * k;
        pz += (eye.z + jz - pz) * k;
        lx += (eye.x + dir.x * AIM_AHEAD - lx) * k;
        ly += (eye.y + dir.y * AIM_AHEAD - ly) * k;
        lz += (eye.z + dir.z * AIM_AHEAD - lz) * k;
      } else {
        px += (this.worldPos.x + offX * this.aimReach + jx - px) * k;
        py += (this.worldPos.y + AIM_HEIGHT - lowered * 1.2 + jy - py) * k;
        pz += (this.worldPos.z + offZ * this.aimReach + jz - pz) * k;
      }
      if (!(this.eyeView && this.gun)) {
        lx += (this.worldPos.x + fx * AIM_AHEAD - lx) * k;
        ly += (this.worldPos.y + AIM_LOOK_Y + Math.tan(this.aimPitch) * AIM_AHEAD - ly) * k;
        lz += (this.worldPos.z + fz * AIM_AHEAD - lz) * k;
      }
    }
    camera.position.set(px, py, pz);
    camera.lookAt(lx, ly, lz);
    this.shakeAmt = s > 0.005 ? s * 0.86 : 0;
  }

  get worldX(): number {
    return this.worldPos.x;
  }
  get worldZ(): number {
    return this.worldPos.z;
  }
  get worldY(): number {
    return this.worldPos.y;
  }
  private lungeLeft = 0;
  /** The current dash's velocity (world units per second). */
  private lungeDir = { x: 0, z: 0 };

  /** Mid-dash (a lunge or a dodge) — as loud as walking. */
  get dashing(): boolean {
    return this.lungeLeft > 0;
  }

  /** Mid-dash to a spot (dashTo), sprinting. */
  private sprinting = false;

  /** What's left of a dash after the stage under way: each a distance, a time, and the pose it's run in. */
  private dashStages: Array<{ pose: 'sprint' | 'slide' | 'getUp'; dist: number; seconds: number; keep?: number }> = [];
  private dashHeading = { x: 0, z: 1 };

  /**
   * A sprint to (x, z): turns to face it and runs there flat out; walls stop it as they would a walk. One
   * of SLIDE_FROM or more ends in a slide along the floor and a scramble back up; with `slide`, any dash
   * does (to get under a closing shutter). With `toCover` (the tower's cover to cover), it is a sprint and then a slide over the last stretch, ending where it stops (the caller crouches the agent), with no scramble up.
   */
  dashTo(x: number, z: number, slide = false, toCover = false): void {
    const dx = x - this.worldPos.x;
    const dz = z - this.worldPos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) return;
    this.angle = Math.atan2(dx, dz);
    this.mesh.rotation.x = 0; // upright again (hold() tips the agent over for a hover)
    this.mesh.rotation.z = 0;
    this.mesh.rotation.y = this.angle;
    this.dashHeading = { x: dx / d, z: dz / d };
    const coverSlide = toCover && this.actions.has('slide');
    const sliding = !toCover && (d >= SLIDE_FROM || slide) && this.actions.has('slide') && this.actions.has('getUp');
    const slideDist = Math.min(d - COVER_UP_DIST, COVER_SLIDE_DIST);
    const run = coverSlide ? Math.max(0, d - slideDist - COVER_UP_DIST) : sliding ? Math.max(0, d - SLIDE_DIST - GET_UP_DIST) : d;
    this.dashStages = [
      ...(run > 0.05 ? [{ pose: 'sprint' as const, dist: run, seconds: run / DASH_SPEED }] : []),
      ...(coverSlide && slideDist > 0.3 ? [{ pose: 'slide' as const, dist: slideDist, seconds: SLIDE_S * Math.max(0.7, slideDist / COVER_SLIDE_DIST) }] : []),
      ...(coverSlide && this.actions.has('getUp') ? [{ pose: 'getUp' as const, dist: COVER_UP_DIST, seconds: COVER_UP_S, keep: COVER_UP_KEEP }] : []),
      ...(sliding
        ? [
            { pose: 'slide' as const, dist: SLIDE_DIST, seconds: SLIDE_S },
            { pose: 'getUp' as const, dist: GET_UP_DIST, seconds: GET_UP_S },
          ]
        : []),
    ];
    this.nextDashStage();
  }

  /** Starts the dash's next stage (or ends it). */
  private nextDashStage(): void {
    const stage = this.dashStages.shift();
    this.sprinting = stage?.pose === 'sprint';
    if (!stage) return;
    const speed = stage.dist / stage.seconds;
    this.lungeDir = { x: this.dashHeading.x * speed, z: this.dashHeading.z * speed };
    this.lungeLeft = stage.seconds;
    if (stage.pose === 'sprint') {
      const sprint = this.actions.get('sprint');
      if (sprint) sprint.timeScale = DASH_CLIP_RATE;
    } else this.playOnce(stage.pose, stage.seconds, stage.keep ? stage.seconds / stage.keep : undefined);
  }

  /** Down in a slide: low enough for a sweeping laser to pass over. */
  get low(): boolean {
    return this.oneShot?.pose === 'slide';
  }

  /** A dodge: a quick sidestep dash, `dir` -1 left or +1 right of where the player faces. */
  dodge(dir: number): void {
    this.sprinting = false;
    this.dashStages = [];
    const speed = DODGE_DIST / DODGE_S;
    // Screen-right, with the same corrected sign as tick()'s strafe.
    this.lungeDir = { x: -Math.cos(this.angle) * dir * speed, z: Math.sin(this.angle) * dir * speed };
    this.lungeLeft = DODGE_S;
  }

  /** A takedown: turn to face (x, z) and lunge in, stopping just short of it. */
  lunge(x: number, z: number): void {
    this.sprinting = false;
    this.dashStages = [];
    const dx = x - this.worldPos.x;
    const dz = z - this.worldPos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    this.angle = Math.atan2(dx, dz);
    this.mesh.rotation.x = 0; // upright again (hold() tips the agent over for a hover)
    this.mesh.rotation.z = 0;
    this.mesh.rotation.y = this.angle;
    const reach = Math.max(0, Math.min(LUNGE_MAX, d - LUNGE_STOP));
    this.lungeDir = { x: (dx / d) * (reach / LUNGE_S), z: (dz / d) * (reach / LUNGE_S) };
    this.lungeLeft = LUNGE_S;
  }

  /** Puts the player at a world position facing `angle` — standing in the job's arrival lift; `y` puts them on another floor (a way in from the roof). */
  place(x: number, z: number, angle: number, y?: number): void {
    this.worldPos.x = x;
    this.worldPos.z = z;
    if (y !== undefined) {
      this.worldPos.y = y;
      this.floorIdx = Math.round(y / this.floorHeight);
    }
    this.angle = angle;
    this.mesh.position.copy(this.worldPos);
    this.mesh.rotation.y = angle;
  }

  /** Walking, sidestepping or leaning this frame — standing still (a held peek included) is what camo needs to hide you. */
  get moving(): boolean {
    return this.isMoving;
  }

  private camoMats: Array<{ mat: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }> | null = null;
  private camoShown = false;

  /**
   * The cloak's look: the whole figure (gun included) turns see-through and
   * takes on a faint cyan shimmer. `t` is elapsed time, for the shimmer.
   */
  setCamo(active: boolean, t: number): void {
    if (!active && !this.camoShown) return;
    if (!this.camoMats) {
      const mats: Array<{ mat: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }> = [];
      this.mesh.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (mat instanceof THREE.MeshStandardMaterial) mats.push({ mat, color: mat.color.clone(), emissive: mat.emissive.clone() });
        }
      });
      this.camoMats = mats;
    }
    const shimmer = CAMO_OPACITY + Math.sin(t * 9) * 0.05;
    for (const { mat, color, emissive } of this.camoMats) {
      if (active) {
        mat.transparent = true;
        mat.opacity = shimmer;
        mat.color.copy(color).lerp(CAMO_TINT, 0.6);
        mat.emissive.copy(CAMO_TINT).multiplyScalar(0.35);
      } else {
        mat.transparent = false;
        mat.opacity = 1;
        mat.color.copy(color);
        mat.emissive.copy(emissive);
      }
      mat.needsUpdate = active !== this.camoShown;
    }
    this.camoShown = active;
  }

  /** Which stacked floor (0-indexed) the player is currently considered "on" — see tick()'s stair-height resolution. */
  /** Feet that have landed since the last call — game.ts plays a footstep for each. */
  takeFootfalls(): number {
    const n = this.footfalls;
    this.footfalls = 0;
    return n;
  }

  private countFootfalls(): void {
    const walk = this.pose && this.isMoving ? this.actions.get(this.pose) : undefined;
    if (!walk) {
      this.lastWalkPhase = -1;
      return;
    }
    const duration = walk.getClip().duration;
    const phase = (walk.time % duration) / duration;
    const last = this.lastWalkPhase;
    this.lastWalkPhase = phase;
    if (last < 0) return;
    // Played backwards (backing up crouched), the phase falls: a foot lands when it passes the mark going down, and only a wrap round the
    // loop's end is the other way about. Read the forward way, every frame looked like a wrap and counted both feet: a buzz.
    const backwards = walk.timeScale < 0;
    for (const p of FOOTFALL_PHASES) {
      const crossed = backwards ? (phase <= last ? p < last && p >= phase : p < last || p >= phase) : phase >= last ? last < p && p <= phase : p > last || p <= phase;
      if (crossed) this.footfalls++;
    }
  }

  get currentFloorIdx(): number {
    return this.floorIdx;
  }
  /** Current facing angle — same convention as scene forward vectors: (sin θ, cos θ) in (x, z). */
  get facingAngle(): number {
    return this.angle;
  }

  /** The chest lamp's lens: where the torch beam is drawn from. */
  get torchOrigin(): THREE.Vector3 {
    return this.lampPos;
  }

  /** World-space position of the stun gun's muzzle, for aiming tracer effects — falls back to an approximate hand-height point ahead of the player before the weapon has loaded. */
  get torch(): boolean {
    return this.torchOn;
  }

  /** Switches the torch; off, only a faint glow at your feet is left. */
  setTorch(on: boolean): void {
    this.torchOn = on;
    this.lamp?.setOn(on);
    this.light.intensity = on ? TORCH_INTENSITY : 0;
    this.light.castShadow = on && shadowsWanted();
    this.footLight.intensity = on ? FOOT_LIGHT : FOOT_LIGHT_DARK;
  }

  /** The gun shows its own recharge and EMP charges (weapon.ts). */
  setWeaponState(charge: number, empCharges: number, time: number): void {
    this.gun?.setCharge(charge, time);
    this.gun?.setEmpCharges(empCharges);
    if (this.gun) {
      const age = time - this.kickedAt;
      kickGun(this.gun, age < KICK_S ? (1 - age / KICK_S) ** 2 : 0);
    }
    if (this.offGun) {
      const age = time - this.offKickedAt;
      kickGun(this.offGun, age < KICK_S ? (1 - age / KICK_S) ** 2 : 0);
    }
  }

  /**
   * A second gun in the left hand (the exit levels' two guns, fired one after the other): `on` hangs it by the agent's side, level with the first, and the left arm holds it instead of the first gun's
   * foregrip. `name` is which gun (null: a pulse pistol's stand-in, the stun pistol).
   */
  setOffhand(on: boolean, name: BigGun | null = this.offName): void {
    this.offOn = on;
    this.offName = name;
    if (!this.gun) return; // (applied once the model has loaded)
    if (on && !this.offGun) {
      this.offGun = buildOffhandGun();
      this.offGun.group.rotation.y = Math.PI; // (its barrel, -Z, points along the agent's +Z, ahead)
      this.mesh.add(this.offGun.group);
    }
    if (this.offGun) {
      this.offGun.group.visible = on;
      void equipBigGun(this.offGun, name);
    }
    this.weaponSupport = on && this.offGun ? this.offGun.group : this.primarySupport;
  }

  /** The second gun's muzzle (the first's is muzzleWorldPosition). */
  get offhandMuzzle(): THREE.Vector3 {
    if (this.offGun) return this.offGun.tip.getWorldPosition(new THREE.Vector3());
    return this.muzzleWorldPosition;
  }

  /** Holds the second gun where the first hand's ready spot is, mirrored to the left, and level with the aim. */
  private placeOffhand(): void {
    if (!this.offGun || !this.offOn) return;
    const t = this.rightHandTarget.position;
    this.offGun.group.position.set(-t.x, t.y, t.z);
    this.offGun.group.rotation.x = -this.aimPitch * this.aimK;
  }

  /** Carries `name` instead of the pistol (null: the pistol back). */
  setBigGun(name: BigGun | null): void {
    this.bigGun = name;
    if (this.gun) void equipBigGun(this.gun, name);
  }

  get gunName(): BigGun | null {
    return this.bigGun;
  }

  /** A shot has just gone off at the clock's `time`: the gun kicks (setWeaponState plays it out). */
  kick(time: number, offhand = false): void {
    if (offhand) this.offKickedAt = time;
    else this.kickedAt = time;
  }

  get muzzleWorldPosition(): THREE.Vector3 {
    if (this.weaponTip) {
      const v = new THREE.Vector3();
      this.weaponTip.getWorldPosition(v);
      return v;
    }
    return new THREE.Vector3(this.worldPos.x + Math.sin(this.angle) * 0.4, this.worldPos.y + 1.25, this.worldPos.z + Math.cos(this.angle) * 0.4);
  }
}
