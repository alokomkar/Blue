// Patrol bot enemy — loosely ported from blueprint/src/index.html's
// hasLineOfSight()/tickBots() (~:3500-3657), redesigned per direct request
// on two points: (1) detection is a forward vision cone plus a small
// all-around awareness radius (detection.ts's botCanSee) — walls block
// both, and bots pause at the end of each patrol leg to sweep their gaze
// side to side, so slipping past behind one is a real tactic; (2) the player can shoot a bot to
// disable it (tryFire(), also in detection.ts), which doesn't exist in the
// 2D game at all (there it's the tranq dart tool, a deferred consumable) —
// this is a deliberate v1 addition, not a port.
//
// Detection stays "recoverable, not instant-fail" per the v1 scope (see the
// plan's "one enemy — the patrol bot — recoverable detection" line): a
// sustained spot adds suspicion (matching the 2D game's BOT_PINPOINT expiry,
// +40, :3657) rather than ending the job outright. That distinction is what
// separates the patrol bot from the deferred, instant-fail watchdog enemy.
//
// Visual: the same Universal Base Character body as the agent (CC0, see skins.ts),
// painted red with a helmet and visor, and moved by the Universal Animation
// Library's guard clips (ual.ts, guard-pose.ts).
//
// Two more stealth tools tie into detection here: sneaking shrinks the
// effective detection radius (SNEAK_DETECT_RADIUS vs. DETECT_RADIUS, both
// in detection.ts) rather than just changing animation/speed, and standing
// near/in a hiding spot (hiding.ts) suppresses detection outright for that
// frame — see tick()'s playerSneaking/playerHidden params. The bot is also
// now a physical obstacle: player.ts's Blocker collision (BOT_RADIUS below)
// stops the player from walking straight through it, AND (below) the bot's
// own movement stops short of the player too — collision only being checked
// on the player's side meant a bot could still walk straight through a
// stationary player, which read as broken rather than merely one-sided.
//
// The bot also now actually reacts once it spots you: while it has a clear
// sight-line, it abandons its patrol path and heads straight for your
// current position (CHASE_SPEED, faster than its patrol pace but still
// outrunnable at a full sprint — not while sneaking, which trades speed for
// a smaller detection radius). Losing the sight-line drops it back to a
// fresh patrol route from wherever it ended up, rather than an old path
// left behind. This is separate from the pinpoint/suspicion mechanic below,
// which still fires purely off sustained sight, independent of movement.
//
// It now also shoots back. Equipped with the same primitive placeholder
// weapon as the player (weapon.ts's equipEnemyWeapon — a palette-swapped
// variant, not a new asset), fitted to the palm with a two-handed hold.
// The barrel is levelled after the clips and both arms stay within reach. While it has a sight-line and is within BOT_FIRE_RANGE — a shorter
// range than detection itself, so closing the gap after being spotted is a
// real, visible escalation rather than instant — it fires on a cooldown,
// landing a suspicion hit (BOT_HIT_SUSPICION) each time; game.ts spawns the
// actual tracer using the bot's muzzleWorldPosition, same pattern as the
// player's own shots. This is on top of, not instead of, the passive
// pinpoint/suspicion accrual below — prolonged close-range exposure is
// worse than being seen from a safe distance.

import { markCharacter } from './postfx';
import { HOLD_RANGE, MIN_ATTACK_ARC, backOffSpot, bearingApart, bearingTo, holdsBack, pickBearing, rangeStep, type HoldRange } from './standoff';
import { PRONE_AWARE, PRONE_SIGHT } from './posture';
import { DASH_SIGHT } from './dash';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, type WallBox } from './scene';
import { bfs, pathFromDist, type MazeCells } from './maze';
import { Avoider, blockedAt, clearSpot } from './avoid';
import { MODEL_NAMES, nextTag, type Tag } from './signage';
import { tagPlate } from './signrender';
import { pickCover } from './coverMove';
import { beatTarget, legPause, lingerTarget, lingerPause, Glance, LINGER_LOOK, type Linger } from './patrol';
import { flankCell, separationPush } from './squad';
import { insideSmoke, smokeBlocks, SMOKE_SIGHT_SCALE, type Smoke } from './smoke';
import { hasLineOfSight, lineClearOver, botCanSee, exposure, tryFire, DETECT_RADIUS, SNEAK_DETECT_RADIUS, AWARE_RADIUS, SNEAK_AWARE_RADIUS } from './detection';
import { PLAYER_R } from './player';
import { equipEnemyWeapon } from './weapon';
import { TorchBeam } from './effects';
import { strapLamp, type ShoulderLamp } from './lamp';
import { guardWeaponHold } from './guard-hold';
import type { Enemy, EnemyContext, EnemyKind, HitResult, Tool } from './enemies/types';
import { WHITE_ARMOUR, WHITE_FIRE_COOLDOWN_S, WHITE_SPEED, whiteDamage } from './white';
import { dressSuit, fitHelmet, paintTrunks, standTall } from './outfit';
import { adoptMixamoNames } from './skins';
import { BODY_LENGTH } from './stash';
import { HACK_S, WARDEN_FIRE_COOLDOWN_S, SHIELD_OPEN_S, afterHit, healthFraction, newWarden, wardenDamage, type WardenState } from './warden';
import { hangDown, turnAbout, ualClips, type UalClip } from './ual';
import { guardPose, poseRate, POSE_CLIP, type GuardPose } from './guard-pose';
import { CREEP_PACE, LASER_CONFIRM_S, LASER_NOTICE_S, laserIn, stepDwell, warning } from './laser';

export { hasLineOfSight, tryFire };

/** A guard's body: the male Universal Base Character, stood 1.83 m tall (stash.ts's BODY_LENGTH). */
const MODEL_URL = '/models/skins/ubc_male.glb';
const MOVE_SPEED = 2.6; // world units/sec — slower than the player's 7, a patrol pace (the walk clip's stride is 0.97: any faster and the feet skate)
const CHASE_SPEED = 4.6; // world units/sec while it has a sight-line on you — faster than patrol, slower than a full sprint
const TURN_RATE = 6; // per-second angle-lerp toward movement direction
export const BOT_RADIUS = 0.34; // physical collision size, also used as the player's blocker radius against it
const MIN_PLAYER_DIST = BOT_RADIUS + PLAYER_R; // combined radius — matches the check player.ts runs the other way
const PINPOINT_SECONDS = 1.8; // sustained unobstructed sight before a spot registers (the job can make it quicker: EnemyContext.guardReactionS)
const PINPOINT_DECAY_RATE = 2; // breaks off ~2x faster than it builds, so brief glimpses don't add up
export const SPOT_SUSPICION = 40; // blueprint/src/index.html:3657
const LOOK_SWEEP = 0.7; // radians either side of where it stopped facing
const SENTRY_SWEEP = 0.6; // radians either side of a sentry's post facing (the job can widen it: EnemyContext.sentrySweep)
const INVESTIGATE_LINGER_S = 1.5; // extra time spent staring at a spent flare
const INVESTIGATE_STOP = 1.1; // how close to the flare it walks
const POST_ARRIVE_R = 0.12;
const PACE_PAUSE_S = 4; // a pacing sentry stops this long at each end of its beat
const FALL_S = 0.55;
const FALLEN_PITCH = Math.PI / 2 - 0.04; // lying flat on its front
const FALLEN_LIFT = 0.16; // keeps the body resting on, not through, the floor
const WAYPOINT_ARRIVE_R = 0.15;
/** A waypoint that is not the last counts as reached this near, so a route is walked round its corners, not to the middle of each cell and a stop. */
const CORNER_ARRIVE_R = 0.75;
const ACCEL = 7; // world units/sec/sec a guard picks up speed at
const BRAKE = 12;
// Fighting from cover (coverMove.ts): once it has seen the agent a guard runs to the nearest cover that brings it closer, waits behind it, leans out to look and shoot, falls back,
// and does it twice before it moves up to the next. It keeps the agent's last place in mind this long after losing sight.
const ENGAGE_MEMORY_S = 8;
/** Closer than this to the agent it is a fight, not a cover: it goes straight at it. */
const COVER_RUSH_DIST = 3.5;
const COVER_HOLD_S = 1.1;
const COVER_HOLD_VAR_S = 1.1;
const COVER_PEEK_S = 1.6;
const COVER_CYCLES = 2;
/** Not getting any nearer to its spot for this long, it gives up on the cover. */
const COVER_STUCK_S = 1.8;
type Engage = {
  mode: 'rush' | 'advance' | 'hold' | 'peek' | 'flank';
  hide: { x: number; z: number } | null;
  peek: { x: number; z: number } | null;
  /** The hold's seconds left, or the peek's once at its spot. */
  t: number;
  arrived: boolean;
  cycles: number;
  /** Where the agent was last seen. */
  lastX: number;
  lastZ: number;
  /** Seconds since it last saw it. */
  lost: number;
  stuck: number;
  bestD: number;
};
// Hit (stunned, taken down): a flinch first, the start of the library's Hit_Knockback, the head snapping back,
// then the topple. Carried, a body lies on its back (LayToIdle's first frame) sagging over the arms: bent at the
// hips (legs down one side, head and shoulders the other), knees bent, arms hanging (SAG, radians).
const FLINCH_FRAMES = 8; // at 30 fps
const FLINCH_S = 0.2;
const SAG = { hips: 1.0, knees: 0.7, spine: 0.35, chest: 0.3, neck: 0.5 };

// Taken down: the library's own falls. A stun from the front drops it onto its back, a takedown from behind onto its face.
const SHOT_CLIP = 'Pistol_Shoot' satisfies UalClip;
const HITS: readonly UalClip[] = ['Hit_Stomach', 'Hit_Chest', 'Hit_Head', 'Hit_Shoulder_L', 'Hit_Shoulder_R'];
const DEATHS = ['Death01', 'Death02'] as const satisfies readonly UalClip[];
const DEATH_S = 1.5; // the fall takes this long: the clip, a touch quickened, so a body is down (and can be picked up) as soon as before

/** A guard's body as loaded: its rig renamed, stood BODY_LENGTH tall and turned to face +Z (the way its toes point), still in its rest pose. */
function readyBody(model: THREE.Object3D): THREE.Object3D {
  adoptMixamoNames(model);
  standTall(model, BODY_LENGTH);
  model.updateMatrixWorld(true);
  const foot = model.getObjectByName('mixamorigLeftFoot')!.getWorldPosition(new THREE.Vector3());
  const toe = model.getObjectByName('mixamorigLeftToe_End')!.getWorldPosition(new THREE.Vector3());
  model.rotation.y = -Math.atan2(toe.x - foot.x, toe.z - foot.z);
  model.updateMatrixWorld(true);
  return model;
}

/** The guards' library clips, retargeted once (onto a body of their own, still in its rest pose) for every guard. */
let guardLibrary: Promise<Map<UalClip, THREE.AnimationClip>> | null = null;
function guardClips(): Promise<Map<UalClip, THREE.AnimationClip>> {
  guardLibrary ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => ualClips(readyBody(gltf.scene), ['Hit_Knockback', 'LayToIdle', ...Object.values(POSE_CLIP), ...HITS, ...DEATHS, SHOT_CLIP]));
  return guardLibrary;
}
const RED_TINT = new THREE.Color(0xb32c2c);
const LAMP_COLOR = 0xffe2b0; // guards' shoulder lamps: warm, unlike the player's cool torch
const LAMP_BEAM = 0.06; // their beam is fainter than the player's — it shows where they look, it doesn't light the way
const LAMP_REACH = 3; // the beam aims at the floor this far ahead
// Hunters (sent by the alarm): near-black with a cyan glow, quicker and sharper-eyed.
const HUNTER_TINT = new THREE.Color(0x1d232b);
const HUNTER_GLOW = new THREE.Color(0x0e5a6b);
const HUNTER_SPEED = 1.3;
const HUNTER_SIGHT = 1.2;

// Heavy enforcers (guarding server rooms): bigger, dark-armoured, slow, with
// a narrower view; three stuns (one armour plate each) or one EMP to drop.
const HEAVY_TINT = new THREE.Color(0x3a4148);
const HEAVY_GLOW = new THREE.Color(0x4a1d04);
const HEAVY_SPEED = 0.7;
const HEAVY_SCALE = 1.22;
const HEAVY_HALF_ANGLE = (35 * Math.PI) / 180;
const HEAVY_ARMOUR = 3;
const STAGGER_S = 0.9; // knocked off balance by a stun that didn't drop it — and open to a takedown

// White guards (white.ts): a heavy in white.
const WHITE_TINT = new THREE.Color(0xe6eaee);
const WHITE_GLOW = new THREE.Color(0xb4bec8); // (a little of it keeps the paint white in the dim, and not so much that the armour's shape is lost)

/** A guard (patrol bot or sentry), a hunter sent by the alarm, a heavy enforcer, or a white guard (a heavy in white). */
export type BotProfile = 'guard' | 'hunter' | 'heavy' | 'white' | 'warden';
const DISABLED_TINT = new THREE.Color(0x4a4a4a);
const ANIM_BLEND_S = 0.25;
// Guards this far from the player (at the edge of the screen or off it)
// animate every third frame: the mixer and arm IK are most of a guard's cost.
const FAR_ANIM_DIST = 20;
const FAR_ANIM_EVERY = 3;
/** The fastest a guard backs off, crouched and facing the agent, in metres a second. */
const BACKOFF_PACE = 1.8;
export const BOT_FIRE_RANGE = 8; // shorter than DETECT_RADIUS (10) — being seen from afar doesn't get you shot at immediately, closing the distance does
const BOT_FIRE_COOLDOWN_S = 1.3;
export const BOT_HIT_SUSPICION = 30; // a landed shot costs more suspicion than passive detection (SPOT_SUSPICION, 40, but that's a slower sustained-sight accrual) — being shot at is a sharper escalation

/** True if a point this close to the player would overlap them — mirrors player.ts's own check on the bot. */
function blockedByPlayer(x: number, z: number, playerWorldX: number, playerWorldZ: number): boolean {
  return Math.hypot(x - playerWorldX, z - playerWorldZ) < MIN_PLAYER_DIST;
}

function shortestAngleLerp(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function buildPlaceholderBot(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color: RED_TINT, roughness: 0.7 })
  );
  body.position.y = 0.77;
  g.add(body);
  return g;
}

export class Bot implements Enemy {
  readonly mesh: THREE.Group;
  private lamp: ShoulderLamp | null = null;
  private readonly beam: TorchBeam;
  private shown = true;
  /** Put away out of sight (a locker, a crate, a vent): not a body to find or to pick up any more. */
  private stashedAway = false;
  readonly stunImmune = false;
  readonly radius = BOT_RADIUS;
  disabled = false;
  private worldPos: THREE.Vector3;
  private angle = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private flinchAction: THREE.AnimationAction | null = null;
  private flinchLeft = 0;
  private limpClip: THREE.AnimationClip | null = null;
  /** The library's walks, jogs and idles (guard-pose.ts), once they've loaded; until then the model's own Idle and Walk do. */
  private readonly poseActions = new Map<GuardPose, THREE.AnimationAction>();
  private hitClips: THREE.AnimationClip[] = [];
  private shotClip: THREE.AnimationClip | null = null;
  private aiming = false;
  /** The model and serial painted small on its back. */
  readonly tag: Tag;
  /** Where the agent was at the last tick, and how high their chest is, for pointing the gun at them. */
  private aimAt: { x: number; z: number; chest: number } | null = null;
  private deathClips = new Map<string, THREE.AnimationClip>();
  /** A hit's reaction is playing: the pose logic leaves it alone until it ends. */
  private reactionLeft = 0;
  private reacted: THREE.AnimationAction | null = null;
  /** Taken down by one of the library's falls rather than the toppling placeholder. */
  private deathAction: THREE.AnimationAction | null = null;
  /** The fall was onto its back (a stun), so the body is turned about when dragged to keep its head leading. */
  private fellBack = false;
  /** Stopped at the end of a leg of its beat, looking round. */
  private scanning = false;
  /** Set once the agent is seen: how it is fighting (cover, or straight at it), until it has lost it for ENGAGE_MEMORY_S. */
  private engage: Engage | null = null;
  /** What stands on the floor (walls, crates, furniture) as of the last tick, to walk round, and the steering that does it. */
  private obstacles: WallBox[] = [];
  private readonly avoider = new Avoider();
  private speedNow = 0;
  /** The pace it is walking at now: it picks up to the pace it is told, and brakes at a stop, rather than going from nothing to full speed. */
  private cmdSpeed = 0;
  /** Each guard walks a little differently (0.9 to 1.1 of the pace). */
  private readonly gait = 0.9 + Math.random() * 0.2;
  private readonly glance = new Glance();
  /** The other guards, dogs and the like on the floor this frame, to keep from standing in. */
  private crowd: ReadonlyArray<Enemy> = [];
  /** In a fight with the agent this frame (it has seen them, or remembers where they are): the others look at it to take a different line. */
  attacking = false;
  /** Sent for the agent by an alarm (the exit level's waves): it has them in its sights whenever it has a clear line, however dark it is. */
  knowsAgent = false;
  /** The bearing round the agent this guard attacks from, when another is already attacking along its line (standOff); and how long it has been stuck getting there. */
  private attackBearing: number | null = null;
  private bearingStuck = 0;
  private noFlankFor = 0;
  /** The cells of the container roofs it patrols (the bunker's), as "x,y" keys: it will not step off them. Null for a guard on the floor. */
  private roofCells: ReadonlySet<string> | null = null;
  /** What stops its sight when that is not what stops its feet (the agent up on a container's roof: the containers do not hide them). */
  private sightBoxes: WallBox[] | null = null;
  /** For a look between different heights (a roof and the floor): every box on the floor, the agent's height, and the floor's. */
  private occluders: WallBox[] | null = null;
  private playerY = 0;
  private floorBase = 0;
  /** The nav grid as of the last tick, for a call that arrives between ticks. */
  private nav: { cells: MazeCells; cols: number; rows: number } | null = null;
  private lastX: number;
  private lastZ: number;
  /** Picked up (or put down after): lying on its back in the library's pose, not toppled on its front. */
  private limp = false;
  private isMoving = false;
  private animFrame = Math.floor(Math.random() * FAR_ANIM_EVERY); // staggered, so far guards don't all animate on the same frame
  private animDt = 0;
  private beat: Array<{ x: number; y: number }> = [];
  /** An authored round (the tower's): the cells it walks in order, round and round, in place of a beat and wandering. */
  private route: Array<{ x: number; y: number }> = [];
  private routeAt = 0;
  /** This leg ends at a beat point, where it stops longer and looks right round. */
  private legToBeat = false;
  /** Stops beside places to hide (patrol.ts): it stops there longer, with its back to the hiding place. */
  private lingers: readonly Linger[] = [];
  /** The facing of the lingering stop this leg ends at, or null. */
  private lingerFacing: number | null = null;
  private justLingered = false;
  /** The cell the agent is hiding in (the game tells the patrols), which draws the stop nearest to it. */
  private hider: { x: number; y: number } | null = null;
  private idleLook = LOOK_SWEEP;
  private path: Array<{ x: number; y: number }> = [];
  private pathIdx = 1;
  private repathTimer = 0;
  private idleFor = 0;
  private fall = 0; // 0 → 1 as a disabled bot topples forward onto the floor
  private idleBase = 0;
  private pinpointTime = 0;
  private wasChasing = false;
  /** Sentries hold a post (world coords) instead of patrolling. */
  private post: { x: number; z: number; facing: number } | null = null;
  /** Walking to / watching a thrown flare, with the time left before giving up. */
  private investigating: { x: number; z: number; remaining: number } | null = null;
  private weaponTip: THREE.Object3D | null = null;
  private weaponHold: ReturnType<typeof guardWeaponHold> | null = null;
  private readonly rightHandTarget: THREE.Object3D;
  private fireCooldown = 0;
  // World-space offset of the floor this bot belongs to (0,0 for floor 0,
  // matching every call site before multi-floor content existed). Needed
  // for two things a plain worldPos alone can't cover: (1) worldPos.y
  // itself — a floor-1 bot needs to sit at that floor's real height, the
  // same class of hardcoded-Y bug already caught for the torch and flares;
  // (2) pickNewPath()'s cell-index math, which divides worldPos by CELL to
  // find the bot's current maze cell — on a non-zero-origin floor that only
  // gives the right answer once the origin is subtracted first.
  private readonly originX: number;
  private readonly originZ: number;

  private readonly hunter: boolean;
  private readonly heavy: boolean;
  /** A white guard: a heavy by every rule above, with white.ts's changes. */
  private readonly white: boolean;
  /** The Warden (warden.ts): a white guard grown larger, behind a shield that only a flash opens. */
  private readonly warden: boolean;
  private wardenState: WardenState = newWarden();
  /** Seconds the hack still holds him frozen (the hack), and what happens as it begins. */
  private frozenFor = 0;
  onHack: (() => void) | null = null;
  private shieldMesh: THREE.Mesh | null = null;
  private armour: number;
  private stagger = 0;
  /** Blinded and deafened by a flash grenade: seconds left, how long, and where it went off (where it goes to look afterwards). */
  private dazedFor = 0;
  private dazeClock = 0;
  private dazeSpot: { x: number; z: number } | null = null;
  /** A heavy's armour plates, glowing over its head — one goes dark per stun. */
  private readonly pips: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, startWorldX: number, startWorldZ: number, originX = 0, originY = 0, originZ = 0, profile: BotProfile = 'guard') {
    this.hunter = profile === 'hunter';
    this.warden = profile === 'warden';
    this.white = profile === 'white' || this.warden;
    this.heavy = profile === 'heavy' || this.white;
    // (Warden's health is a bar on the screen, not plates over his head.)
    this.armour = this.warden ? 0 : this.white ? WHITE_ARMOUR : this.heavy ? HEAVY_ARMOUR : 1;
    this.originX = originX;
    this.originZ = originZ;
    this.mesh = buildPlaceholderBot();
    this.worldPos = new THREE.Vector3(startWorldX, originY, startWorldZ);
    this.lastX = startWorldX;
    this.lastZ = startWorldZ;
    this.mesh.position.copy(this.worldPos);
    this.mesh.rotation.order = 'YXZ'; // yaw first, so a fall pitches forward relative to its facing
    if (this.heavy) this.mesh.scale.setScalar(this.warden ? HEAVY_SCALE * 1.12 : HEAVY_SCALE);
    if (this.warden) {
      // The shield: a faint blue shell round him, bright while it holds and gone while a flash has it open.
      this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.22, depthWrite: false }));
      this.shieldMesh.position.y = 0.95;
      this.mesh.add(this.shieldMesh);
    }
    scene.add(this.mesh);
    markCharacter(scene, this.mesh);
    if (this.heavy) {
      for (let i = 0; i < this.armour; i++) {
        const pip = new THREE.Mesh(new THREE.BoxGeometry(this.white ? 0.09 : 0.12, 0.06, 0.03), new THREE.MeshBasicMaterial({ color: this.white ? 0x9fe4ff : 0xff8a2a }));
        pip.position.set((i - (this.armour - 1) / 2) * (this.white ? 0.12 : 0.17), 2.05, 0);
        this.pips.push(pip);
      }
    }

    // Same "ready" spot in front of the chest as player.ts's own
    // rightHandTarget — parented to the bot's root so it turns/moves with
    // it automatically.
    this.tag = nextTag(this.hunter ? 'hunter' : this.heavy ? 'heavy' : 'guard');
    this.rightHandTarget = new THREE.Object3D();
    this.rightHandTarget.position.set(-0.14, 1.15, 0.42);
    this.mesh.add(this.rightHandTarget);

    this.beam = new TorchBeam(scene, LAMP_COLOR, LAMP_BEAM);
    this.beam.setOn(false); // until the lamp is on its shoulder
    this.loadModel();
  }

  private loadModel(): void {
    // The body and the library's clips come together, so a guard is never shown in its bind pose; the clips failing leaves a still guard, not none.
    void Promise.all([
      new GLTFLoader().loadAsync(MODEL_URL),
      guardClips().catch((error: unknown) => {
        console.error('No animations for the guards', error);
        return null;
      }),
    ]).then(
      ([gltf, clips]) => {
        const model = readyBody(gltf.scene);
        const suit = this.hunter ? HUNTER_TINT : this.white ? WHITE_TINT : this.heavy ? HEAVY_TINT : RED_TINT;
        // Painted, not clothed: one flat colour over the whole body (the bare model's skin and underwear dropped, trunks darkened in), and a helmet and visor over the head (blood red on a white guard).
        dressSuit(model, suit.getHex());
        paintTrunks(model);
        model.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
            if (!(mat instanceof THREE.MeshStandardMaterial) || /eye|hair/i.test(mat.name)) continue;
            if (this.hunter || this.heavy) {
              mat.emissive.copy(this.hunter ? HUNTER_GLOW : this.white ? WHITE_GLOW : HEAVY_GLOW);
              mat.emissiveIntensity = this.white ? 0.28 : 0.6;
            }
          }
        });
        fitHelmet(model, 'guard', suit.clone().multiplyScalar(0.8).getHex(), this.white ? 0x6a0810 : 0x0b0d10, this.hunter ? 0x35d6ff : null);
        this.lamp = strapLamp(model, LAMP_COLOR);
        this.mesh.clear(); // also removes rightHandTarget, added in the constructor — re-add it below
        this.mesh.add(model);
        this.mesh.add(this.rightHandTarget);
        for (const pip of this.pips) this.mesh.add(pip);

        this.stencilBack(model);
        const gun = equipEnemyWeapon(model);
        if (gun) {
          this.weaponTip = gun.tip;
          this.weaponHold = guardWeaponHold(model, gun);
        }

        this.mixer = new THREE.AnimationMixer(model);
        if (!clips) return;
        // The flinch and the carried pose, the idles, walks and the rest: shared by every guard.
        const knock = clips.get('Hit_Knockback');
        if (knock) {
          this.flinchAction = this.mixer.clipAction(THREE.AnimationUtils.subclip(knock, 'flinch', 0, FLINCH_FRAMES, 30));
          this.flinchAction.setLoop(THREE.LoopOnce, 1);
          this.flinchAction.clampWhenFinished = true;
        }
        this.limpClip = clips.get('LayToIdle') ?? null;
        this.hitClips = HITS.flatMap((h) => clips.get(h) ?? []);
        this.shotClip = clips.get(SHOT_CLIP) ?? null;
        for (const d of DEATHS) {
          const clip = clips.get(d);
          if (clip) this.deathClips.set(d, clip);
        }
        for (const pose of Object.keys(POSE_CLIP) as GuardPose[]) {
          const clip = clips.get(POSE_CLIP[pose]);
          if (clip) this.poseActions.set(pose, this.mixer.clipAction(clip));
        }
        this.idleAction = this.poseActions.get('idle') ?? null;
        this.walkAction = this.poseActions.get('walk') ?? null;
        if (this.idleAction) {
          this.idleAction.play();
          this.currentAction = this.idleAction;
        }
      },
      (err: unknown) => console.error('Failed to load bot model', err)
    );
  }

  /** The model name and serial, small and dull, on its back (a sentry is a BASTION, a patrol a WARDEN): stuck to the spine so it moves with the body. */
  private stencilBack(model: THREE.Object3D): void {
    const spine = model.getObjectByName('mixamorigSpine1');
    if (!spine) return;
    const tag = this.post && !this.hunter && !this.heavy ? { ...this.tag, model: MODEL_NAMES.sentry } : this.tag;
    const plate = tagPlate(tag, 0.26);
    this.mesh.updateMatrixWorld(true);
    const at = spine.getWorldPosition(new THREE.Vector3());
    // Where the back is: a ray from behind, at the spine's height, along the way the guard faces, until it meets the body.
    const back = new THREE.Vector3(0, 0, -1).transformDirection(this.mesh.matrixWorld);
    const origin = at.clone().addScaledVector(back, 0.7);
    const hit = new THREE.Raycaster(origin, back.clone().negate(), 0, 1.2).intersectObject(model, true).find((h) => !(h.object as THREE.Mesh).userData.tag);
    const surface = hit ? hit.point.clone().addScaledVector(back, 0.012) : at.clone().addScaledVector(back, 0.18);
    const local = this.mesh.worldToLocal(surface);
    plate.position.set(local.x, local.y, local.z);
    plate.rotation.y = Math.PI; // (its front faces the guard's back)
    this.mesh.add(plate);
    this.mesh.updateMatrixWorld(true);
    spine.attach(plate);
  }

  private updateAnimation(moving: boolean, dt: number, far = false): void {
    this.speedNow += ((dt > 0 ? Math.hypot(this.worldPos.x - this.lastX, this.worldPos.z - this.lastZ) / dt : 0) - this.speedNow) * Math.min(1, dt * 8);
    this.lastX = this.worldPos.x;
    this.lastZ = this.worldPos.z;
    if (this.poseActions.size > 0 && this.currentAction) {
      if (this.reactionLeft > 0) this.reactionLeft -= dt;
      else {
        const pose = guardPose({ moving, chasing: this.wasChasing, hunter: this.hunter, scanning: this.scanning, searching: this.investigating !== null, aiming: this.aiming, cautious: this.cautious, backing: this.backing });
        const next = this.poseActions.get(pose);
        if (next) {
          if (next !== this.currentAction) {
            next.reset().play();
            this.currentAction.crossFadeTo(next, ANIM_BLEND_S, false);
            this.currentAction = next;
          }
          next.timeScale = poseRate(pose, this.speedNow);
        }
      }
    } else if (moving !== this.isMoving && this.idleAction && this.walkAction && this.currentAction) {
      const next = moving ? this.walkAction : this.idleAction;
      if (next !== this.currentAction) {
        next.reset().play();
        this.currentAction.crossFadeTo(next, ANIM_BLEND_S, true);
        this.currentAction = next;
      }
    }
    this.isMoving = moving;
    this.backing = false;
    this.animDt += dt;
    if (far && ++this.animFrame % FAR_ANIM_EVERY !== 0) return;
    this.mixer?.update(this.animDt);
    this.animDt = 0;

    // Position both hands and level the weapon after the clip. Hit reactions keep their authored arms.
    if (this.weaponHold && this.reactionLeft <= 0) {
      // On to something (it has the agent, is after a sound, is on the alarm): the muzzle points at the agent (up or down to their chest, round to them), not level along the way the guard faces.
      const alert = this.aiming || this.wasChasing || this.engage !== null || this.hunter || this.cautious || this.investigating !== null;
      let yaw = this.angle;
      let pitch = 0;
      if (this.aimAt && alert) {
        const dx = this.aimAt.x - this.worldPos.x;
        const dz = this.aimAt.z - this.worldPos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.5) {
          const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - this.angle), Math.cos(Math.atan2(dx, dz) - this.angle));
          if (Math.abs(off) < 1.1) yaw = this.angle + off;
          pitch = Math.max(-0.7, Math.min(0.7, Math.atan2(this.playerY + this.aimAt.chest - (this.worldPos.y + 1.25), dist)));
        }
      }
      this.mesh.updateMatrixWorld(true);
      this.weaponHold(
        this.rightHandTarget.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      );
    }
  }

  /**
   * Steps once toward (targetX, targetZ) at `speed`, sliding on whichever
   * axis is still clear if the other is blocked by the player (mirrors the
   * axis-separated wall slide in player.ts). Returns whether it actually
   * moved (i.e. wasn't already touching the target). Used for both patrol
   * waypoint-following and chase, so both stop the same way at the player
   * instead of pushing through.
   */
  private moveToward(targetX: number, targetZ: number, speed: number, dt: number, playerWorldX: number, playerWorldZ: number, faceX?: number, faceZ?: number): boolean {
    const dx = targetX - this.worldPos.x;
    const dz = targetZ - this.worldPos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return false;
    // Round whatever is standing in the way (crates, desks, lockers: avoid.ts), not through it.
    this.cmdSpeed = speed < this.cmdSpeed ? speed : Math.min(speed, this.cmdSpeed + ACCEL * dt);
    const next = this.avoider.step(this.worldPos.x, this.worldPos.z, targetX, targetZ, this.cmdSpeed * dt, BOT_RADIUS - 0.04, this.obstacles, dt);
    const before = { x: this.worldPos.x, z: this.worldPos.z };
    const roofOk = (x: number, z: number): boolean => this.roofCells === null || this.roofCells.has(`${Math.round((x - this.originX) / CELL)},${Math.round((z - this.originZ) / CELL)}`);
    if (!blockedByPlayer(next.x, this.worldPos.z, playerWorldX, playerWorldZ) && roofOk(next.x, this.worldPos.z)) this.worldPos.x = next.x;
    if (!blockedByPlayer(this.worldPos.x, next.z, playerWorldX, playerWorldZ) && roofOk(this.worldPos.x, next.z)) this.worldPos.z = next.z;
    this.mesh.position.copy(this.worldPos);
    // Faces the way it is going, round a box and all; on the spot (held up), the way it was told.
    const mx = this.worldPos.x - before.x;
    const mz = this.worldPos.z - before.z;
    // (A backpedal keeps its face on `face`, the agent, whichever way its feet go.)
    const targetAngle = faceX !== undefined && faceZ !== undefined ? Math.atan2(faceX - this.worldPos.x, faceZ - this.worldPos.z) : Math.hypot(mx, mz) > 1e-4 ? Math.atan2(mx, mz) : Math.atan2(dx / d, dz / d);
    this.angle = shortestAngleLerp(this.angle, targetAngle, Math.min(1, dt * TURN_RATE));
    this.mesh.rotation.y = this.angle;
    // Held at a roof's edge it is not walking, whatever it was told.
    return this.roofCells === null || Math.hypot(mx, mz) > 1e-4;
  }

  private holdRange(): HoldRange {
    return this.white ? HOLD_RANGE.white : this.hunter ? HOLD_RANGE.hunter : this.heavy ? HOLD_RANGE.heavy : HOLD_RANGE.guard;
  }

  /**
   * A guard that has the agent in its sights does not run up to them: it comes on only until it is in range, then stands and shoots (facing them, in the band that is its firing distance),
   * and backs off if the agent comes nearer than that. Several of them hold at different spots on the ring round the agent, one after another, not in a heap on top of them.
   * Returns whether it moved.
   */
  private standOff(dt: number, run: number, tx: number, tz: number, d: number, seen: boolean, playerX: number, playerZ: number): boolean {
    const range = this.holdRange();
    const step = rangeStep(d, range, seen);
    if (step === 'back') {
      const spot = backOffSpot({ x: tx, z: tz }, { x: this.worldPos.x, z: this.worldPos.z }, range);
      const fromX = this.worldPos.x;
      const fromZ = this.worldPos.z;
      // Backs off crouched and facing them, gun up, rather than turning its back to walk away.
      const moved = this.moveToward(spot.x, spot.z, Math.min(run * 0.6, BACKOFF_PACE), dt, playerX, playerZ, tx, tz);
      if (moved && Math.hypot(this.worldPos.x - fromX, this.worldPos.z - fromZ) > 0.002) {
        this.backing = true;
        return true;
      }
      // Nowhere to back into (a wall behind it, furniture): it stands its ground, facing them, and shoots.
      this.faceToward(tx, tz, dt);
      return false;
    }
    // Another guard already coming at them along this line: it takes another, at least 30 degrees off, and goes round to it.
    const line = this.attackLine(tx, tz, d, range);
    if (line) {
      const off = Math.hypot(line.x - this.worldPos.x, line.z - this.worldPos.z);
      if (off > 0.9) {
        const fromX = this.worldPos.x;
        const fromZ = this.worldPos.z;
        const moved = this.moveToward(line.x, line.z, run, dt, playerX, playerZ);
        const progress = Math.hypot(this.worldPos.x - fromX, this.worldPos.z - fromZ);
        this.bearingStuck = progress > 0.004 ? 0 : this.bearingStuck + dt;
        if (this.bearingStuck > 1.4) {
          // Boxed in on the way round: it gives up the angle and fights from where it is.
          this.attackBearing = null;
          this.noFlankFor = 5;
          this.bearingStuck = 0;
        }
        if (moved && progress > 0.002) return true;
      }
    }
    if (step === 'close') return this.moveToward(tx, tz, run, dt, playerX, playerZ);
    this.faceToward(tx, tz, dt);
    return false;
  }

  /**
   * The spot on the ring round the agent that this guard should go to, when another guard in the fight is nearer to them on about the same line (within 30 degrees): a spot at the middle of
   * its firing band on a bearing at least 30 degrees from every other attacker's. Null when no one is in its way, so it goes straight in as before.
   */
  private attackLine(tx: number, tz: number, myD: number, range: HoldRange): { x: number; z: number } | null {
    if (this.noFlankFor > 0) return null;
    const target = { x: tx, z: tz };
    const others = this.crowd.filter((o): o is Bot => o instanceof Bot && o !== this && o.attacking && !o.disabled);
    if (others.length === 0) {
      this.attackBearing = null;
      return null;
    }
    const seen = others.map((o) => ({ b: bearingTo(target, { x: o.worldX, z: o.worldZ }), d: Math.hypot(o.worldX - tx, o.worldZ - tz), id: o.mesh.id }));
    const mine = bearingTo(target, this.worldPos);
    const here = this.attackBearing ?? mine;
    // Whoever is nearer (and, level, whoever came first) keeps its line; the other gives way.
    const blocked = seen.some((o) => bearingApart(here, o.b) < MIN_ATTACK_ARC * 0.85 && (o.d < myD - 0.3 || (Math.abs(o.d - myD) <= 0.3 && o.id < this.mesh.id)));
    if (blocked) this.attackBearing = pickBearing(here, seen.map((o) => o.b));
    if (this.attackBearing === null) return null;
    const out = (range.min + range.max) / 2;
    return { x: tx + Math.sin(this.attackBearing) * out, z: tz + Math.cos(this.attackBearing) * out };
  }

  /**
   * One step of a fight from cover: run to the cover behind (advance), wait in it, lean out at its end to look and shoot (peek), fall back, and after two rounds move up to the
   * next. No cover that brings it nearer, or the agent right on top of it: straight at the agent, as a guard always has.
   */
  private fightFromCover(dt: number, run: number, seen: boolean, playerX: number, playerZ: number): boolean {
    const e = this.engage!;
    const tx = seen ? playerX : e.lastX;
    const tz = seen ? playerZ : e.lastZ;
    const here = this.worldPos;
    const toPlayer = Math.hypot(tx - here.x, tz - here.z);
    const go = (x: number, z: number, speed: number): boolean => this.moveToward(x, z, speed, dt, playerX, playerZ);
    const takeCover = (): boolean => {
      const c = pickCover({ x: here.x, z: here.z }, { x: tx, z: tz }, this.obstacles);
      if (!c) return false;
      e.mode = 'advance';
      e.hide = c.hide;
      e.peek = c.peek;
      e.cycles = 0;
      e.arrived = false;
      e.stuck = 0;
      e.bestD = Infinity;
      return true;
    };
    /** Closing on a spot: false once it has stopped getting nearer for COVER_STUCK_S (boxed in, or the way is blocked). */
    const closing = (d: number): boolean => {
      if (d < e.bestD - 0.05) {
        e.bestD = d;
        e.stuck = 0;
      } else e.stuck += dt;
      return e.stuck <= COVER_STUCK_S;
    };
    if (e.mode === 'flank') {
      // Round the side to a spot well off the way the others come: along the route, then on as any guard in a fight (cover, or straight at the agent).
      e.t -= dt;
      const step = this.followPath(dt, run, playerX, playerZ);
      if (step.done || e.t <= 0 || (seen && toPlayer < COVER_RUSH_DIST)) e.mode = 'rush';
      return step.moving;
    }
    if (e.mode === 'rush') {
      if (toPlayer > COVER_RUSH_DIST && takeCover()) return false;
      return this.standOff(dt, run, tx, tz, toPlayer, true, playerX, playerZ); // (it is in a fight: it knows where they are, seen this instant or not)
    }
    if (e.mode === 'advance' && e.hide) {
      const d = Math.hypot(e.hide.x - here.x, e.hide.z - here.z);
      if (d < 0.35) {
        e.mode = 'hold';
        e.t = COVER_HOLD_S + Math.random() * COVER_HOLD_VAR_S;
        return false;
      }
      if (!closing(d)) {
        e.mode = 'rush';
        return false;
      }
      return go(e.hide.x, e.hide.z, run);
    }
    if (e.mode === 'hold') {
      this.faceToward(tx, tz, dt);
      e.t -= dt;
      if (e.t > 0) return false;
      if (e.cycles >= COVER_CYCLES) {
        if (toPlayer > COVER_RUSH_DIST && takeCover()) return false;
        e.mode = 'rush';
        return false;
      }
      e.mode = 'peek';
      e.arrived = false;
      e.stuck = 0;
      e.bestD = Infinity;
      return false;
    }
    if (e.mode === 'peek' && e.peek) {
      const d = Math.hypot(e.peek.x - here.x, e.peek.z - here.z);
      if (d >= 0.3 && !e.arrived) {
        if (!closing(d)) {
          e.mode = 'rush';
          return false;
        }
        return go(e.peek.x, e.peek.z, run);
      }
      if (!e.arrived) {
        e.arrived = true;
        e.t = COVER_PEEK_S;
      }
      this.faceToward(tx, tz, dt);
      e.t -= dt;
      if (e.t <= 0) {
        e.cycles++;
        e.mode = 'advance';
        e.stuck = 0;
        e.bestD = Infinity;
      }
      return false;
    }
    e.mode = 'rush';
    return false;
  }

  /** How it is fighting, for tests: null when it has not seen the agent. */
  get combatMode(): string | null {
    return this.engage?.mode ?? null;
  }

  /** Where a sentry stands its post (world); null for a patrol. */
  get postSpot(): { x: number; z: number } | null {
    return this.post ? { x: this.post.x, z: this.post.z } : null;
  }

  /** A sentry that paces: between its post and (x, z) it walks to and fro, stopping at each end a moment to look along the hall, instead of standing on its post. Call after setPost. */
  setPace(x: number, z: number): void {
    if (!this.post) return;
    this.pace = { ends: [{ x: this.post.x, z: this.post.z }, { x, z }], at: 1, wait: 0 };
  }

  /** Makes this bot a sentry: it holds (x, z) facing `facing`, sweeping its gaze, instead of patrolling. */
  setPost(x: number, z: number, facing: number): void {
    this.post = { x, z, facing };
    this.worldPos.x = x;
    this.worldPos.z = z;
    this.angle = facing;
    this.mesh.position.copy(this.worldPos);
    this.mesh.rotation.y = facing;
    this.path = [];
  }

  get isSentry(): boolean {
    return this.post !== null;
  }

  /** The spot it is walking over to look at (a flare, a noise), if any. */
  get lookingAt(): { x: number; z: number } | null {
    return this.investigating ? { x: this.investigating.x, z: this.investigating.z } : null;
  }

  /**
   * Walks over to look at a thrown flare, if it's within `maxCells` of
   * walking distance: stands facing it until it burns out (plus a moment),
   * then patrols on or heads back to its post. Ignored while chasing.
   * Returns whether the bot took the bait.
   */
  investigate(x: number, z: number, seconds: number, cells: MazeCells, cols: number, rows: number, maxCells: number): boolean {
    if (this.disabled || this.wasChasing) return false;
    this.pathTo(x, z, cells, cols, rows);
    if (this.path.length === 0 || this.path.length - 1 > maxCells) {
      this.path = [];
      return false;
    }
    this.investigating = { x, z, remaining: seconds + INVESTIGATE_LINGER_S };
    return true;
  }

  /**
   * Brought into a fight by a shout, or by seeing a partner go down, at (x, z): where the agent was last known to be. It goes to cover that brings it nearer, as if it had seen the agent,
   * and for ENGAGE_MEMORY_S keeps coming at that place; a `flank` goes round the side first. Not a hunter or a heavy (they have no cover), and not one that is stunned or blinded.
   * Returns whether it was brought in (one already in a fight only has its last known place brought up to date).
   */
  alertTo(x: number, z: number, role: 'cover' | 'flank' = 'cover'): boolean {
    if (this.disabled || this.hunter || this.heavy || this.dazedFor > 0 || this.stagger > 0) return false;
    if (this.engage) {
      this.engage.lastX = x;
      this.engage.lastZ = z;
      return false;
    }
    this.engage = { mode: 'rush', hide: null, peek: null, t: 0, arrived: false, cycles: 0, lastX: x, lastZ: z, lost: 0, stuck: 0, bestD: Infinity };
    this.wasChasing = true;
    this.investigating = null;
    this.cautious = false;
    this.pinpointTime = 0;
    this.path = [];
    this.pathIdx = 1;
    if (role === 'flank' && this.nav) {
      const { cells, cols, rows } = this.nav;
      const cur = this.cellOf(this.worldPos.x, this.worldPos.z);
      const dist = bfs(cells, cols, rows, cur.x, cur.y);
      const spot = flankCell(this.cellOf(x, z), cur, dist, cells);
      const path = spot ? pathFromDist(cells, dist, spot.x, spot.y, cur.x, cur.y) : null;
      if (path && path.length > 1) {
        this.path = path;
        this.pathIdx = 1;
        this.engage.mode = 'flank';
        this.engage.t = 8;
      }
    }
    return true;
  }

  /** Puts this guard up on the container roofs over `cells`: it walks only there (the edge is the edge), and is not in the way of anyone on the floor below. */
  setRoof(cells: ReadonlySet<string>): void {
    this.roofCells = cells;
  }

  /** Its roof is gone (the container was blown up): it falls to the floor, shaken, and goes back to the ordinary rounds from there. */
  dropFromRoof(floorY: number): void {
    this.roofCells = null;
    // (A body lying up there has its own lift: it keeps it, and is on the floor now.)
    const lift = this.mesh.position.y - this.worldPos.y;
    this.worldPos.y = floorY;
    this.mesh.position.y = floorY + lift;
    this.stagger = 1.2;
    this.path = [];
    this.investigating = null;
  }

  /** Whether it patrols the container roofs. */
  get onRoofLayer(): boolean {
    return this.roofCells !== null;
  }

  /** Creeps (crouched, slowly) to (x, z) to see what is there, as it does for a laser on the agent: false when there is no way, or it is already after the agent. */
  creepTo(x: number, z: number, seconds: number, cells: MazeCells, cols: number, rows: number, maxCells: number): boolean {
    if (!this.investigate(x, z, seconds, cells, cols, rows, maxCells)) return false;
    this.cautious = true;
    return true;
  }

  /** Whether it is in a fight and knows where the agent is: it saw them a moment ago (a guard's sight stops at 10 m, but it fights on from cover at a longer range). */
  get seesAgent(): boolean {
    return this.engage !== null && this.engage.lost < 2;
  }

  /** Whether it is a hunter or a heavy: they rush and carry no grenades. */
  get rusher(): boolean {
    return this.hunter || this.heavy;
  }

  /** Whether it is blinded by a flash. */
  get dazed(): boolean {
    return this.dazedFor > 0;
  }

  /** Steps off any guard or dog it is standing in (squad.ts), unless that would put it in a wall. */
  private stepApart(): void {
    if (this.crowd.length === 0 || this.disabled) return;
    const near: Array<{ x: number; z: number }> = [];
    for (const o of this.crowd) {
      if (o === this || o.disabled || Math.abs(o.worldX - this.worldPos.x) > 1.2 || Math.abs(o.worldZ - this.worldPos.z) > 1.2 || Math.abs(o.floorY - this.worldPos.y) > 1) continue;
      near.push({ x: o.worldX, z: o.worldZ });
    }
    if (near.length === 0) return;
    const push = separationPush({ x: this.worldPos.x, z: this.worldPos.z }, near);
    const r = BOT_RADIUS - 0.04;
    if (push.x !== 0 && !blockedAt(this.worldPos.x + push.x, this.worldPos.z, r, this.obstacles)) this.worldPos.x += push.x;
    if (push.z !== 0 && !blockedAt(this.worldPos.x, this.worldPos.z + push.z, r, this.obstacles)) this.worldPos.z += push.z;
    this.mesh.position.x = this.worldPos.x;
    this.mesh.position.z = this.worldPos.z;
  }

  /** Blinded and deafened by a flash grenade at (x, z): it stumbles about on the spot seeing and hearing nothing, then goes to look at where it went off. */
  daze(seconds: number, x: number, z: number): boolean {
    if (this.disabled) return false;
    this.dazedFor = Math.max(this.dazedFor, this.warden ? SHIELD_OPEN_S : seconds);
    this.dazeSpot = { x, z };
    this.wasChasing = false;
    this.pinpointTime = 0;
    this.investigating = null;
    this.path = [];
    return true;
  }

  /** The player slipped away: the sighting it was building up is gone, and it won't shoot for a moment. */
  calm(): void {
    this.pinpointTime = 0;
    this.fireCooldown = Math.max(this.fireCooldown, 2);
    this.investigating = null;
  }

  relocate(x: number, z: number, cells: MazeCells, cols: number, rows: number): void {
    if (this.post || this.disabled) return;
    this.worldPos.x = x;
    this.worldPos.z = z;
    this.mesh.position.copy(this.worldPos);
    this.engage = null;
    this.investigating = null;
    this.wasChasing = false;
    this.pinpointTime = 0;
    this.dazedFor = 0;
    this.dazeSpot = null;
    this.fireCooldown = Math.max(this.fireCooldown, 2);
    this.pickNewPath(cells, cols, rows);
  }

  /** Done with what it was sent to see to (a light it switched back on): straight back to its post or its rounds. */
  stopInvestigating(cells: MazeCells, cols: number, rows: number): void {
    if (!this.investigating) return;
    this.investigating = null;
    if (this.post) this.pathTo(this.post.x, this.post.z, cells, cols, rows);
    else this.pickNewPath(cells, cols, rows);
  }

  private cellOf(x: number, z: number): { x: number; y: number } {
    return { x: Math.round((x - this.originX) / CELL), y: Math.round((z - this.originZ) / CELL) };
  }

  /** Sets `path` to the route from here to the cell containing world (x, z); empty if unreachable. */
  private pathTo(x: number, z: number, cells: MazeCells, cols: number, rows: number): void {
    const cur = this.cellOf(this.worldPos.x, this.worldPos.z);
    const target = this.cellOf(x, z);
    const dist = bfs(cells, cols, rows, cur.x, cur.y);
    const reachable = (dist[target.y]?.[target.x] ?? -1) >= 0;
    this.path = reachable ? (pathFromDist(cells, dist, target.x, target.y, cur.x, cur.y) ?? []) : [];
    this.pathIdx = 1;
  }

  /** Steps along `path`. `done` once the last waypoint is reached. */
  private followPath(dt: number, speed: number, playerWorldX: number, playerWorldZ: number): { moving: boolean; done: boolean } {
    if (this.pathIdx >= this.path.length) return { moving: false, done: true };
    const wp = this.path[this.pathIdx]!;
    // A route point in the middle of a cell with a pair of crates in it is a spot beside them.
    const spot = clearSpot(wp.x * CELL + this.originX, wp.y * CELL + this.originZ, BOT_RADIUS - 0.04, this.obstacles, this.worldPos);
    const targetX = spot.x;
    const targetZ = spot.z;
    const last = this.pathIdx === this.path.length - 1;
    if (Math.hypot(targetX - this.worldPos.x, targetZ - this.worldPos.z) < (last ? WAYPOINT_ARRIVE_R : CORNER_ARRIVE_R)) {
      this.pathIdx++;
      // Mid-route it does not stop: on to the next point in the same step, so the turn is a curve.
      if (this.pathIdx < this.path.length) return this.followPath(dt, speed, playerWorldX, playerWorldZ);
      return { moving: false, done: true };
    }
    return { moving: this.moveToward(targetX, targetZ, speed, dt, playerWorldX, playerWorldZ), done: false };
  }

  private faceToward(x: number, z: number, dt: number): void {
    const target = Math.atan2(x - this.worldPos.x, z - this.worldPos.z);
    this.angle = shortestAngleLerp(this.angle, target, Math.min(1, dt * TURN_RATE));
    this.mesh.rotation.y = this.angle;
  }

  /** A patrol's beat (patrol.ts): the places most of its legs head for — outside storage and server rooms, the stairs, the lifts. */
  setBeat(points: Array<{ x: number; y: number }>): void {
    this.beat = points;
  }

  /** The stops beside hiding places this patrol lingers at now and then. */
  setLingers(spots: readonly Linger[]): void {
    this.lingers = spots;
  }

  /** Where the agent is hiding (a cell), or null: a patrol is likelier to stop at the lingering spot nearest to it. */
  setHider(cell: { x: number; y: number } | null): void {
    this.hider = cell;
  }

  /** Walks these cells in order, round and round, stopping a moment at each: an authored round. */
  setRoute(points: Array<{ x: number; y: number }>): void {
    this.route = points;
    this.routeAt = 0;
    this.path = [];
    this.pathIdx = 0;
  }

  /** This patrol's beat, to hand on to another at a shift change. */
  getBeat(): Array<{ x: number; y: number }> {
    return this.beat;
  }

  /** Takes a new beat and sets off on a fresh leg of it at once, dropping the one it was on (a shift change). */
  reroute(points: Array<{ x: number; y: number }>): void {
    this.beat = points;
    this.path = [];
    this.pathIdx = 0;
  }

  private pickNewPath(cells: MazeCells, cols: number, rows: number): void {
    const curX = Math.round((this.worldPos.x - this.originX) / CELL);
    const curY = Math.round((this.worldPos.z - this.originZ) / CELL);
    const dist = bfs(cells, cols, rows, curX, curY);
    this.lingerFacing = null;
    if (!this.justLingered && this.lingers.length > 0) {
      const spot = lingerTarget(dist, this.lingers, this.hider);
      const path = spot ? pathFromDist(cells, dist, spot.x, spot.y, curX, curY) : null;
      if (spot && path) {
        this.justLingered = true;
        this.legToBeat = false;
        this.lingerFacing = spot.facing;
        this.path = path;
        this.pathIdx = 1;
        return;
      }
    }
    this.justLingered = false;
    if (this.route.length > 0) {
      // The next point on the round that is not where it already stands, if it can be reached.
      for (let tries = 0; tries < this.route.length; tries++) {
        const to = this.route[this.routeAt % this.route.length]!;
        this.routeAt++;
        if ((to.x === curX && to.y === curY) || (dist[to.y]?.[to.x] ?? -1) < 0) continue;
        this.legToBeat = false;
        this.path = pathFromDist(cells, dist, to.x, to.y, curX, curY) ?? [];
        this.pathIdx = 1;
        return;
      }
    }
    const onBeat = beatTarget(dist, this.beat);
    this.legToBeat = onBeat !== null;
    if (onBeat) {
      this.path = pathFromDist(cells, dist, onBeat.x, onBeat.y, curX, curY) ?? [];
      this.pathIdx = 1;
      return;
    }
    const candidates: Array<{ x: number; y: number }> = [];
    // In a small closed-off area, as far as it can get will do.
    const reach = Math.min(4, Math.max(...dist.flat()));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (reach > 0 && dist[y]![x]! >= reach) candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)]!;
    const path = pathFromDist(cells, dist, target.x, target.y, curX, curY);
    this.path = path ?? [];
    this.pathIdx = 1; // index 0 is the bot's current cell
  }

  /**
   * Advance patrol/chase movement + line-of-sight; call once per frame.
   * `onSpotted` fires when a sustained sight-line completes. `onHit` fires
   * when a shot lands (only possible within `BOT_FIRE_RANGE`, shorter than
   * detection range itself — being seen from afar doesn't get you shot at).
   * `playerSneaking` shrinks the detection radius (sneaking makes you harder
   * to spot from a distance); `playerHidden` (near/in a hiding spot) skips
   * detection entirely for this frame, regardless of distance or line of
   * sight. While it has a sight-line it chases you directly instead of
   * patrolling; losing the sight-line sends it back to a fresh patrol route
   * from wherever it ended up.
   */
  tick(
    dt: number,
    cells: MazeCells,
    cols: number,
    rows: number,
    wallBoxes: WallBox[],
    playerWorldX: number,
    playerWorldZ: number,
    playerSneaking: boolean,
    playerHidden: boolean,
    onSpotted: () => void,
    onHit: () => void,
    sightScale = 1,
    speedScale = 1,
    unreachable = false,
    prone = false,
    running = false,
    laserNotice = false,
    harmless = false
  ): void {
    this.aimAt = { x: playerWorldX, z: playerWorldZ, chest: prone ? 0.3 : playerSneaking ? 0.8 : 1.1 };
    if (this.warden) this.tickShield(dt);
    this.obstacles = wallBoxes;
    this.nav = { cells, cols, rows };
    this.aimBeam(wallBoxes);
    if (this.disabled) {
      // Topples forward from the feet, accelerating like a real fall, and
      // ends up lying flat — raised a touch so the body rests on the floor
      // instead of sinking into it. Once down, the pose freezes. It no longer
      // blocks anyone (game.ts leaves disabled bots out of the player's
      // blockers), so the player can step over it.
      if (this.deathAction) {
        if (this.fall < 1) {
          this.fall = Math.min(1, this.fall + dt / DEATH_S);
          this.mixer?.update(dt);
        }
        return;
      }
      if (this.flinchLeft > 0) {
        this.flinchLeft -= dt;
        this.mixer?.update(dt);
        // Flinched: it goes limp back to standing straight as it topples, so it lands flat on its front,
        // not stuck with its head thrown back and its arms up.
        if (this.flinchLeft <= 0 && this.idleAction && this.currentAction === this.flinchAction) {
          this.flinchAction!.crossFadeTo(this.idleAction.reset().play(), FALL_S * 0.6, false);
          this.currentAction = this.idleAction;
        }
        return;
      }
      if (this.fall < 1 && !this.limp) {
        this.fall = Math.min(1, this.fall + dt / FALL_S);
        const e = this.fall * this.fall;
        this.mesh.rotation.x = FALLEN_PITCH * e;
        this.mesh.position.y = this.worldPos.y + FALLEN_LIFT * e;
        this.mixer?.update(dt);
      }
      return;
    }

    // Staggered by a stun: rocked back, not moving or shooting for a moment.
    if (this.stagger > 0) {
      this.stagger = Math.max(0, this.stagger - dt);
      // The library's hit reaction rocks it back itself; the placeholder tilt is only for a guard whose clips haven't loaded.
      if (!this.reacted) this.mesh.rotation.x = -0.18 * Math.sin((this.stagger / STAGGER_S) * Math.PI);
      else if (this.stagger === 0) this.reacted = null;
      this.updateAnimation(false, dt);
      return;
    }

    // Held (the hack): frozen where he stands, the shield open, facing the agent.
    if (this.frozenFor > 0) {
      this.frozenFor = Math.max(0, this.frozenFor - dt);
      this.faceToward(playerWorldX, playerWorldZ, dt);
      this.isMoving = false;
      this.updateAnimation(false, dt);
      return;
    }

    // Blinded and deafened by a flash: it turns this way and that on the spot, seeing, hearing and shooting nothing, until it comes round and
    // goes to look at where the grenade went off.
    if (this.dazedFor > 0) {
      this.dazedFor = Math.max(0, this.dazedFor - dt);
      this.dazeClock += dt;
      this.angle += (Math.sin(this.dazeClock * 2.3) * 1.6 + Math.sin(this.dazeClock * 0.9) * 0.8) * dt;
      this.mesh.rotation.y = this.angle;
      this.isMoving = false;
      this.scanning = false;
      this.updateAnimation(false, dt);
      if (this.dazedFor === 0 && this.dazeSpot) {
        const spot = this.dazeSpot;
        this.dazeSpot = null;
        this.investigate(spot.x, spot.z, 6, cells, cols, rows, 99);
      }
      return;
    }

    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    const { radius, aware } = this.sightFor(playerSneaking, sightScale, prone, running);
    const pace = speedScale * (this.hunter ? HUNTER_SPEED : this.white ? WHITE_SPEED : this.heavy ? HEAVY_SPEED : 1);
    const walk = MOVE_SPEED * pace * this.gait;
    const run = CHASE_SPEED * pace;
    let seen = !harmless && !playerHidden && botCanSee(this.worldPos.x, this.worldPos.z, this.angle, playerWorldX, playerWorldZ, this.sightBoxes ?? wallBoxes, radius, aware, playerSneaking, this.viewHalfAngle);

    if (!seen && this.knowsAgent && !harmless && !playerHidden && Math.hypot(playerWorldX - this.worldPos.x, playerWorldZ - this.worldPos.z) <= 11 && hasLineOfSight(this.worldPos.x, this.worldPos.z, playerWorldX, playerWorldZ, this.sightBoxes ?? wallBoxes, 12)) seen = true;

    // A guard and an agent at different heights (on a container's roof, and on the floor beside it) see one another along a real 3D line: the container's edge hides someone close under it.
    if (seen && this.occluders && Math.abs(this.worldPos.y - this.playerY) > 1) {
      const targetY = this.playerY + (prone ? 0.3 : playerSneaking ? 0.9 : 1.3) - this.floorBase;
      seen = lineClearOver(this.worldPos.x, this.worldPos.y + 1.6 - this.floorBase, this.worldPos.z, playerWorldX, targetY, playerWorldZ, this.occluders);
    }

    // The laser sight on the agent (laser.ts): long enough, and it takes notice, and creeps up to see; the agent gone when it gets there, it goes back to what it was doing.
    if (laserNotice && !this.disabled) {
      const arc = this.laserArc();
      const lased = !seen && !playerHidden && !prone && !unreachable && laserIn(this.worldPos.x, this.worldPos.z, arc.centre, arc.half, playerWorldX, playerWorldZ, hasLineOfSight(this.worldPos.x, this.worldPos.z, playerWorldX, playerWorldZ, wallBoxes, 16));
      this.laserDwell = seen || this.wasChasing || this.engage ? 0 : stepDwell(this.laserDwell, lased, dt);
      if (this.laserDwell >= LASER_NOTICE_S && !this.cautious && !seen && !this.engage && !this.wasChasing) {
        if (this.investigate(playerWorldX, playerWorldZ, LASER_CONFIRM_S, cells, cols, rows, 99)) this.cautious = true;
      }
      if (this.cautious && lased && this.investigating) {
        // Still on the agent: it keeps coming, to where the agent is now.
        this.investigating.remaining = LASER_CONFIRM_S + INVESTIGATE_LINGER_S;
        this.laserRepath += dt;
        if (this.laserRepath > 0.7) {
          this.laserRepath = 0;
          this.pathTo(playerWorldX, playerWorldZ, cells, cols, rows);
          this.investigating.x = playerWorldX;
          this.investigating.z = playerWorldZ;
        }
      }
    }

    let moving = false;
    this.scanning = false;
    // Seeing the agent starts a fight from cover (hunters, heavies and a player out of reach go straight at it, or hold off, as before); losing it, it remembers where it was a while.
    const coverFighter = !this.hunter && !this.heavy && !unreachable;
    if (seen && coverFighter) {
      if (!this.engage) this.engage = { mode: 'rush', hide: null, peek: null, t: 0, arrived: false, cycles: 0, lastX: playerWorldX, lastZ: playerWorldZ, lost: 0, stuck: 0, bestD: Infinity };
      this.engage.lastX = playerWorldX;
      this.engage.lastZ = playerWorldZ;
      this.engage.lost = 0;
    } else if (this.engage) {
      this.engage.lost += dt;
      if (!coverFighter || this.engage.lost > ENGAGE_MEMORY_S) this.engage = null;
    }
    this.attacking = !!(seen || this.engage);
    if (!this.attacking) this.attackBearing = null;
    if (this.noFlankFor > 0) this.noFlankFor = Math.max(0, this.noFlankFor - dt);
    if (seen || this.engage) {
      // A player up out of reach (a platform, the pipes) can be seen but not got at: it stops short and looks up, rather than
      // crowding in beneath and standing there.
      if (seen && holdsBack(unreachable, this.worldPos.x, this.worldPos.z, playerWorldX, playerWorldZ)) this.faceToward(playerWorldX, playerWorldZ, dt);
      else if (this.engage) moving = this.fightFromCover(dt, run, seen, playerWorldX, playerWorldZ);
      else moving = this.standOff(dt, run, playerWorldX, playerWorldZ, Math.hypot(playerWorldX - this.worldPos.x, playerWorldZ - this.worldPos.z), true, playerWorldX, playerWorldZ);
      this.wasChasing = true;
      this.investigating = null;
    } else if (this.wasChasing) {
      // The old route led from wherever the chase started, which is now
      // stale — a patrol picks a fresh one from here, a sentry heads home.
      this.wasChasing = false;
      if (this.post) this.pathTo(this.post.x, this.post.z, cells, cols, rows);
      else this.pickNewPath(cells, cols, rows);
    } else if (this.investigating) {
      const inv = this.investigating;
      inv.remaining -= dt;
      // On the last leg, it heads straight for the lure rather than to the
      // middle of its cell first — otherwise it can walk past a flare and turn back to face it.
      if (this.pathIdx === this.path.length - 1) this.pathIdx = this.path.length;
      // Called to where a player is up out of reach, it stops at the stand-off and looks up at the spot.
      const holding = holdsBack(unreachable, this.worldPos.x, this.worldPos.z, inv.x, inv.z);
      const stepPace = this.cautious ? walk * CREEP_PACE : walk;
      const step = holding ? { moving: false, done: false } : this.followPath(dt, stepPace, playerWorldX, playerWorldZ);
      moving = step.moving;
      if (holding) this.faceToward(inv.x, inv.z, dt);
      if (step.done) {
        if (Math.hypot(inv.x - this.worldPos.x, inv.z - this.worldPos.z) > INVESTIGATE_STOP) {
          moving = this.moveToward(inv.x, inv.z, stepPace, dt, playerWorldX, playerWorldZ);
        } else {
          this.faceToward(inv.x, inv.z, dt);
        }
      }
      if (inv.remaining <= 0) {
        this.investigating = null;
        if (this.post) this.pathTo(this.post.x, this.post.z, cells, cols, rows);
        else this.pickNewPath(cells, cols, rows);
      }
    } else if (this.post && this.pace) {
      // Pacing its hall: to one end, a moment looking along it, then back (and from wherever a distraction left it, to the end it was bound for).
      const pace = this.pace;
      const end = pace.ends[pace.at]!;
      const step = this.followPath(dt, walk, playerWorldX, playerWorldZ);
      moving = step.moving;
      if (step.done) {
        if (Math.hypot(end.x - this.worldPos.x, end.z - this.worldPos.z) > POST_ARRIVE_R * 2) {
          moving = this.moveToward(end.x, end.z, walk, dt, playerWorldX, playerWorldZ);
        } else {
          pace.wait += dt;
          this.scanning = true;
          if (pace.wait > PACE_PAUSE_S) {
            pace.wait = 0;
            pace.at = 1 - pace.at;
            const next = pace.ends[pace.at]!;
            this.pathTo(next.x, next.z, cells, cols, rows);
          }
        }
      }
    } else if (this.post) {
      const post = this.post;
      const step = this.followPath(dt, walk, playerWorldX, playerWorldZ);
      moving = step.moving;
      if (step.done) {
        if (Math.hypot(post.x - this.worldPos.x, post.z - this.worldPos.z) > POST_ARRIVE_R) {
          moving = this.moveToward(post.x, post.z, walk, dt, playerWorldX, playerWorldZ);
        } else {
          // On post: face out of the doorway, sweeping side to side.
          this.repathTimer += dt;
          this.angle = shortestAngleLerp(this.angle, post.facing + this.glance.step(dt, this.sweep), Math.min(1, dt * TURN_RATE));
          this.mesh.rotation.y = this.angle;
        }
      }
    } else {
      const step = this.followPath(dt, walk, playerWorldX, playerWorldZ);
      moving = step.moving;
      if (step.done) {
        this.scanning = true;
        if (this.repathTimer === 0) {
          if (this.lingerFacing !== null) {
            // Beside a hiding place: it stands a good while with its back to it.
            this.idleBase = this.lingerFacing;
            this.idleFor = lingerPause();
            this.idleLook = LINGER_LOOK;
          } else {
            this.idleBase = this.angle;
            const pause = legPause(this.legToBeat);
            this.idleFor = pause.seconds;
            this.idleLook = pause.look;
          }
        }
        this.repathTimer += dt;
        const lookAt = this.idleBase + this.glance.step(dt, this.idleLook);
        this.angle = this.lingerFacing !== null ? shortestAngleLerp(this.angle, lookAt, Math.min(1, dt * TURN_RATE)) : shortestAngleLerp(this.angle, lookAt, Math.min(1, dt * TURN_RATE * 1.5));
        this.mesh.rotation.y = this.angle;
        if (this.repathTimer > this.idleFor) {
          this.repathTimer = 0;
          this.pickNewPath(cells, cols, rows);
        }
      }
    }

    if (this.cautious && (!this.investigating || seen || this.wasChasing)) this.cautious = false; // (back to its rounds, or it has found the agent)
    if (!moving) this.cmdSpeed = Math.max(0, this.cmdSpeed - BRAKE * dt);
    this.stepApart();
    this.aiming = seen && !moving;
    this.updateAnimation(moving, dt, Math.hypot(playerWorldX - this.worldPos.x, playerWorldZ - this.worldPos.z) > FAR_ANIM_DIST);

    if (seen) {
      this.pinpointTime += dt;
      if (this.pinpointTime >= this.reactionS) {
        this.pinpointTime = 0;
        onSpotted();
      }
      const dist = Math.hypot(playerWorldX - this.worldPos.x, playerWorldZ - this.worldPos.z);
      if (dist <= BOT_FIRE_RANGE && this.fireCooldown <= 0) {
        this.fireCooldown = this.warden ? WARDEN_FIRE_COOLDOWN_S : this.white ? WHITE_FIRE_COOLDOWN_S : BOT_FIRE_COOLDOWN_S;
        this.recoil();
        onHit();
      }
    } else {
      this.pinpointTime = Math.max(0, this.pinpointTime - dt * PINPOINT_DECAY_RATE);
    }
  }

  /** Points the shoulder lamp's beam at the floor ahead of where the bot is looking; off while it's down or out of sight. */
  private aimBeam(wallBoxes: WallBox[]): void {
    const on = this.lamp !== null && !this.disabled && this.shown;
    this.beam.setOn(on);
    if (!on) return;
    const from = this.lamp!.anchor.getWorldPosition(new THREE.Vector3());
    const to = new THREE.Vector3(this.worldPos.x + Math.sin(this.angle) * LAMP_REACH, this.worldPos.y + 0.2, this.worldPos.z + Math.cos(this.angle) * LAMP_REACH);
    this.beam.update(from, to, wallBoxes);
  }

  /** World-space position of the bot's weapon muzzle, for aiming the tracer game.ts spawns on a hit — falls back to an approximate hand-height point ahead of the bot before the weapon has loaded. */
  get muzzleWorldPosition(): THREE.Vector3 {
    if (this.weaponTip) {
      const v = new THREE.Vector3();
      this.weaponTip.getWorldPosition(v);
      return v;
    }
    return new THREE.Vector3(this.worldPos.x + Math.sin(this.angle) * 0.4, this.worldPos.y + 1.25, this.worldPos.z + Math.cos(this.angle) * 0.4);
  }

  /** Down, staggered by a stun, or blinded by a flash: it cannot aim, so its laser sight is off. */
  get incapacitated(): boolean {
    return this.disabled || this.stagger > 0 || this.dazedFor > 0;
  }

  get kind(): EnemyKind {
    return this.hunter ? 'hunter' : this.heavy ? 'heavy' : this.post ? 'sentry' : 'patrol';
  }

  /** How far this bot sees, and how close it notices a player in any direction, given how low they are and how dark it is. */
  private sightFor(sneaking: boolean, sightScale: number, prone: boolean, running: boolean): { radius: number; aware: number } {
    return {
      radius: (sneaking ? SNEAK_DETECT_RADIUS : DETECT_RADIUS) * sightScale * (this.hunter ? HUNTER_SIGHT : 1) * (prone ? PRONE_SIGHT : 1) * (running ? DASH_SIGHT : 1),
      aware: (sneaking ? SNEAK_AWARE_RADIUS : AWARE_RADIUS) * (prone ? PRONE_AWARE : 1),
    };
  }

  /**
   * How exposed the player is to this bot right now (detection.ts's exposure), worked out with the same sight it uses to look for them,
   * and whether they're within the meter's earshot of it: a sight-line and within twice its sight. Null for a bot that's down.
   */
  exposureTo(px: number, pz: number, wallBoxes: WallBox[], sneaking: boolean, sightScale: number, prone: boolean, running = false, smokes: ReadonlyArray<Smoke> = []): { value: number; near: boolean } | null {
    if (this.disabled) return null;
    if (smokeBlocks(this.worldPos.x, this.worldPos.z, px, pz, smokes)) return { value: 0, near: false };
    if (insideSmoke(this.worldPos.x, this.worldPos.z, smokes)) sightScale *= SMOKE_SIGHT_SCALE;
    const { radius, aware } = this.sightFor(sneaking, sightScale, prone, running);
    const value = exposure(this.worldPos.x, this.worldPos.z, this.angle, px, pz, wallBoxes, radius, aware, sneaking, this.viewHalfAngle);
    const d = Math.hypot(px - this.worldPos.x, pz - this.worldPos.z);
    // "Near" is measured against sight as it'd be standing in the light, so the meter wakes before the player is in any danger.
    const wake = (this.hunter ? HUNTER_SIGHT : 1) * DETECT_RADIUS * 1.6;
    return { value, near: d <= wake && hasLineOfSight(this.worldPos.x, this.worldPos.z, px, pz, wallBoxes, wake) };
  }

  /** Its laser on the player (laser.ts): seconds so far, whether that has made it creep up to see for itself, and when it last re-aimed that walk at where the player is. */
  private pace: { ends: Array<{ x: number; z: number }>; at: number; wait: number } | null = null;
  private laserDwell = 0;
  private cautious = false;
  /** Set by the stand-off each tick it gives ground facing the agent; the animation reads it, then clears it. */
  private backing = false;
  private laserRepath = 0;

  /** Where its laser points: a sentry on its post, or a patrol pausing to look round, sweeps the line to and fro over an arc; otherwise it is the line it faces. */
  private laserArc(): { centre: number; half: number } {
    if (this.pace && !this.investigating && !this.wasChasing) return { centre: this.angle, half: this.scanning ? 0.4 : 0 };
    if (this.post && !this.investigating && !this.wasChasing && Math.hypot(this.post.x - this.worldPos.x, this.post.z - this.worldPos.z) <= POST_ARRIVE_R * 1.5) return { centre: this.post.facing, half: this.sweep };
    if (!this.post && this.scanning && !this.investigating) return { centre: this.idleBase, half: this.idleLook };
    return { centre: this.angle, half: 0 };
  }

  /** How near it is to taking notice of the laser lying on the player, 0 to 1; 1 while it creeps up to see. */
  get laserWarn(): number {
    return this.cautious ? 1 : warning(this.laserDwell);
  }

  /** Creeping up crouched, to confirm what its laser found. */
  get creeping(): boolean {
    return this.cautious;
  }

  /**
   * Coming down a rope from above (the exit level's waves): how far above its spot it still is, in metres, and how fast it is sliding. Until it lands it does nothing else (it cannot see, shoot or be
   * seen to move: it only hangs from the line, and a hit brings it straight down).
   */
  airborne = 0;
  private slideV = 0;
  /** Called once as it lands. */
  onLanded: (() => void) | null = null;

  /** Puts it `height` metres up, to come down the rope to where it is. */
  rappelFrom(height: number): void {
    this.airborne = height;
    this.slideV = 2;
    this.mesh.position.y = this.worldPos.y + height;
  }

  private reactionS = PINPOINT_SECONDS;
  private sweep = SENTRY_SWEEP;

  update(ctx: EnemyContext, dt: number): void {
    if (this.airborne > 0) {
      if (this.disabled) this.airborne = 0;
      else {
        // The slide quickens, then it brakes the last of the way (the line pays out, the feet reach for the floor).
        this.slideV = Math.min(9, this.slideV + 14 * dt);
        const speed = this.airborne < 2.2 ? Math.max(2.5, this.slideV * (this.airborne / 2.2)) : this.slideV;
        this.airborne = Math.max(0, this.airborne - speed * dt);
        this.mesh.position.set(this.worldPos.x, this.worldPos.y + this.airborne, this.worldPos.z);
        this.mixer?.update(dt);
        if (this.airborne > 0) return;
        this.mesh.position.copy(this.worldPos);
        this.onLanded?.();
      }
    }
    if (ctx.practiceTarget && !this.disabled) {
      this.stagger = Math.max(0, this.stagger - dt);
      this.mixer?.update(dt);
      return;
    }
    this.crowd = ctx.crowd ?? [];
    this.sightBoxes = ctx.sightWalls ?? null;
    this.occluders = ctx.occluders ?? null;
    this.playerY = ctx.playerY ?? this.worldPos.y;
    this.floorBase = ctx.floorY ?? 0;
    this.reactionS = ctx.guardReactionS ?? PINPOINT_SECONDS;
    this.sweep = ctx.sentrySweep ?? SENTRY_SWEEP;
    // Smoke (smoke.ts): a cloud on the line between them hides the agent, and a guard standing in one sees only a few steps.
    const smokes = ctx.smokes ?? [];
    const hidden = ctx.hidden || smokeBlocks(this.worldPos.x, this.worldPos.z, ctx.playerX, ctx.playerZ, smokes);
    const sight = insideSmoke(this.worldPos.x, this.worldPos.z, smokes) ? ctx.sightScale * SMOKE_SIGHT_SCALE : ctx.sightScale;
    this.tick(dt, ctx.cells, ctx.cols, ctx.rows, ctx.wallBoxes, ctx.playerX, ctx.playerZ, ctx.sneaking, hidden, () => ctx.onSpotted(this), () => ctx.onShot(this), sight, ctx.speedScale, ctx.unreachable === true, ctx.prone === true, ctx.running === true, ctx.laserNotice === true, ctx.harmless === true);
  }

  /** Can be taken down from behind — a heavy only while it's staggered by a stun. */
  get takedownable(): boolean {
    if (this.warden) return false;
    return !this.heavy || this.stagger > 0 || (this.white && this.dazedFor > 0);
  }

  /** How wide it sees (half the cone), for its vision-cone wedge on the floor. */
  get viewHalfAngle(): number | undefined {
    return this.heavy ? HEAVY_HALF_ANGLE : undefined;
  }

  /**
   * An EMP always drops it, and so does one stun or a takedown — except a
   * heavy, which loses an armour plate (and staggers) per stun, and only
   * goes down to a takedown while staggered.
   */
  hit(tool: Tool, zone: 'head' | 'body' = 'body'): HitResult {
    if (this.disabled) return 'immune';
    if (this.warden) return this.hitWarden(tool, zone);
    if (this.white && tool !== 'takedown') return this.hitWhite(tool, zone);
    if (this.heavy && tool === 'takedown' && this.stagger <= 0 && !(this.white && this.dazedFor > 0)) return 'immune';
    if (this.heavy && tool === 'stun' && zone !== 'head') {
      this.armour--;
      const pip = this.pips[this.armour];
      if (pip) pip.visible = false;
      if (this.armour > 0) {
        this.stagger = STAGGER_S;
        this.react();
        return 'damaged';
      }
    }
    this.disable(tool);
    return 'disabled';
  }

  /** Armour plates left (a heavy's, or a white guard's). */
  get plates(): number {
    return this.armour;
  }

  /** Whether it is a white guard (a heavy in white). */
  get isWhite(): boolean {
    return this.white;
  }

  /** Whether this is The Warden. */
  get isWarden(): boolean {
    return this.warden;
  }

  /** The shield is up: shots do nothing (a flash opens it for a while, and the hack too). */
  get shieldUp(): boolean {
    return this.warden && !this.disabled && this.dazedFor <= 0 && this.frozenFor <= 0;
  }

  /** The hack has him held. */
  get held(): boolean {
    return this.frozenFor > 0;
  }

  /** His health, 0 to 1 (the bar). */
  get wardenHealth(): number {
    return healthFraction(this.wardenState);
  }

  /** One hit on Warden (warden.ts): nothing against the shield; with it open it hurts, and at half the controller locks his machine parts. */
  private hitWarden(tool: Tool, zone: 'head' | 'body'): HitResult {
    const open = this.dazedFor > 0 || this.frozenFor > 0;
    const dmg = wardenDamage(tool, zone === 'head', open, this.frozenFor > 0);
    if (dmg === 0) return 'immune';
    const r = afterHit(this.wardenState, dmg);
    this.wardenState = r.state;
    if (r.down) {
      this.disable(tool);
      return 'disabled';
    }
    if (r.hack) {
      this.frozenFor = HACK_S;
      this.dazedFor = 0;
      this.onHack?.();
    }
    return 'damaged';
  }

  /** The shield's glow: bright while it holds, nearly gone while a flash or the hack has it open. */
  private tickShield(dt: number): void {
    if (!this.shieldMesh) return;
    const mat = this.shieldMesh.material as THREE.MeshBasicMaterial;
    const target = this.disabled ? 0 : this.shieldUp ? 0.24 : 0.03;
    mat.opacity += (target - mat.opacity) * Math.min(1, dt * 8);
    this.shieldMesh.visible = mat.opacity > 0.02;
  }

  /** A white guard's plates (see `whiteDamage`): no stagger, so its fire goes on, until it is dazed, which is what stops it. */
  private hitWhite(tool: Tool, zone: 'head' | 'body'): HitResult {
    const taken = whiteDamage(tool, zone === 'head', this.dazedFor > 0);
    for (let i = 0; i < taken && this.armour > 0; i++) {
      this.armour--;
      const pip = this.pips[this.armour];
      if (pip) pip.visible = false;
    }
    if (this.armour > 0) return 'damaged';
    this.disable(tool);
    return 'disabled';
  }

  /** The shot's kick, when it stands to fire (running, it fires on the move with no pose of its own). */
  private recoil(): void {
    if (!this.mixer || !this.shotClip || !this.aiming || !this.currentAction) return;
    const action = this.mixer.clipAction(this.shotClip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    this.currentAction.crossFadeTo(action, 0.04, false);
    this.currentAction = action;
    this.reactionLeft = Math.min(0.3, this.shotClip.duration);
  }

  /** Rocks back from a blow, in one of the library's hit reactions (a random one, so a run of stuns doesn't repeat itself). */
  private react(): void {
    if (!this.mixer || this.hitClips.length === 0 || !this.currentAction) return;
    const clip = this.hitClips[Math.floor(Math.random() * this.hitClips.length)]!;
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = Math.max(1, clip.duration / STAGGER_S);
    action.reset().play();
    this.currentAction.crossFadeTo(action, 0.06, false);
    this.currentAction = action;
    this.reacted = action;
    this.reactionLeft = Math.min(clip.duration / action.timeScale, STAGGER_S);
  }

  /** Disabled by a player shot or a takedown — stops patrolling/detecting, greys out, and falls: onto its face from a takedown, onto its back from a stun. */
  disable(tool?: Tool): void {
    if (this.disabled) return;
    this.disabled = true;
    this.pinpointTime = 0;
    for (const pip of this.pips) pip.visible = false;
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.copy(DISABLED_TINT);
            mat.emissive.setHex(0x000000);
          }
        }
      }
    });
    const death = this.mixer ? this.deathClips.get(tool === 'takedown' ? 'Death02' : 'Death01') : undefined;
    if (death && this.mixer && this.currentAction) {
      const fall = this.mixer.clipAction(death);
      fall.setLoop(THREE.LoopOnce, 1);
      fall.clampWhenFinished = true;
      fall.timeScale = death.duration / DEATH_S;
      fall.reset().play();
      this.currentAction.crossFadeTo(fall, 0.08, false);
      this.currentAction = fall;
      this.deathAction = fall;
      this.fellBack = tool !== 'takedown';
      this.mesh.rotation.x = 0;
      // The hips are the body's middle: on its back they'd sink half a body's depth into the floor.
      if (this.fellBack) this.mesh.position.y = this.worldPos.y + 0.12;
    } else if (this.flinchAction) {
      // Jerks back from the hit, then topples.
      this.currentAction?.crossFadeTo(this.flinchAction.reset().play(), 0.06, true);
      this.currentAction = this.flinchAction;
      this.flinchLeft = FLINCH_S;
    } else if (this.idleAction && this.currentAction !== this.idleAction) {
      this.currentAction?.crossFadeTo(this.idleAction.reset().play(), ANIM_BLEND_S, true);
      this.currentAction = this.idleAction;
    }
  }

  /** Animated head centre, including the heavy's scale. */
  get headWorldPosition(): THREE.Vector3 {
    const head = this.mesh.getObjectByName('mixamorig:Head');
    const top = this.mesh.getObjectByName('mixamorig:HeadTop_End');
    this.mesh.updateMatrixWorld(true);
    if (head && top) return head.getWorldPosition(new THREE.Vector3()).lerp(top.getWorldPosition(new THREE.Vector3()), 0.5);
    return new THREE.Vector3(this.worldX, this.floorY + 1.65 * this.bodyScale, this.worldZ);
  }

  /** How much bigger than the standard guard body this is: a heavy is the same model scaled up. */
  get bodyScale(): number {
    return this.heavy ? HEAVY_SCALE : 1;
  }

  /** Whether the body can be picked up and carried (its limp pose has loaded); if not, it's dragged. */
  get carriable(): boolean {
    return this.limpClip !== null && this.mixer !== null;
  }

  /** Lies it on its back, limp (the library's LayToIdle, first frame), turned `yaw`; `sag`, bent over a carrier's arms. */
  private goLimp(yaw: number, sag: boolean): void {
    if (!this.mixer || !this.limpClip) return;
    this.limp = true;
    this.fall = 1;
    this.mixer.stopAllAction();
    const lie = this.mixer.clipAction(this.limpClip);
    lie.play();
    this.mixer.update(0);
    this.currentAction = lie;
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.position.set(0, 0, 0);
    this.mesh.updateMatrixWorld(true);
    if (!sag) return;
    const bone = (n: string): THREE.Object3D | undefined => this.mesh.getObjectByName(`mixamorig${n}`);
    const l = bone('LeftUpLeg');
    const r = bone('RightUpLeg');
    if (!l || !r) return;
    const across = l.getWorldPosition(new THREE.Vector3()).sub(r.getWorldPosition(new THREE.Vector3())).normalize();
    for (const side of ['Left', 'Right']) {
      const thigh = bone(`${side}UpLeg`);
      const shin = bone(`${side}Leg`);
      if (thigh) turnAbout(thigh, across, SAG.hips);
      if (shin) turnAbout(shin, across, -SAG.knees);
    }
    for (const [n, a] of [['Spine', SAG.spine], ['Spine2', SAG.chest], ['Neck', SAG.neck]] as const) {
      const b = bone(n);
      if (b) turnAbout(b, across, -a);
    }
    for (const side of ['Left', 'Right']) {
      const arm = bone(`${side}Arm`);
      const fore = bone(`${side}ForeArm`);
      const hand = bone(`${side}Hand`);
      if (arm && fore) hangDown(arm, fore);
      if (fore && hand) hangDown(fore, hand);
    }
  }

  /** Moves the body so its hips are at world (x, y, z), keeping its turn. */
  private hipsTo(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
    this.mesh.updateMatrixWorld(true);
    const hips = this.mesh.getObjectByName('mixamorigHips')?.getWorldPosition(new THREE.Vector3());
    if (hips) this.mesh.position.add(new THREE.Vector3(x - hips.x, y - hips.y, z - hips.z));
    this.worldPos.x = x;
    this.worldPos.z = z;
  }

  /** Picked up: limp and sagging, ready to ride a carrier's arms (carryAt). */
  pickUp(): void {
    this.goLimp(this.angle, true);
  }

  /** Carried: its hips at `anchor` (the carrier's arms, player.ts's carryAnchor), lying across a carrier facing `facing`. */
  carryAt(anchor: THREE.Vector3, facing: number): void {
    this.angle = facing;
    this.mesh.rotation.set(0, facing + Math.PI / 2, 0);
    this.hipsTo(anchor.x, anchor.y, anchor.z);
  }

  /** Put down: flat on its back on the floor, its hips at (x, z), lying across `facing`. */
  layDown(x: number, z: number, facing: number): void {
    this.goLimp(facing + Math.PI / 2, false);
    this.angle = facing;
    this.mesh.position.set(x, this.worldPos.y, z);
    this.mesh.updateMatrixWorld(true);
    const hips = this.mesh.getObjectByName('mixamorigHips')?.getWorldPosition(new THREE.Vector3());
    if (hips) {
      this.mesh.position.x += x - hips.x;
      this.mesh.position.z += z - hips.z;
    }
    this.worldPos.x = x;
    this.worldPos.z = z;
  }

  /** Lying where it was put, at height `y` (a body hung below a rail): like layDown, but off the floor. */
  layDownAt(x: number, y: number, z: number, facing: number): void {
    this.worldPos.y = y;
    this.layDown(x, z, facing);
  }

  /** Down and finished falling — a body the player can drag. */
  get downed(): boolean {
    return this.disabled && this.fall >= 1 && !this.stashedAway;
  }

  /** Hides the body away for good: it isn't seen, found or carried again. */
  stash(): void {
    this.stashedAway = true;
    this.mesh.visible = false;
  }

  get stashed(): boolean {
    return this.stashedAway;
  }

  /** Where the body lies: halfway along it, from its feet if it fell forward; at its hips if it was carried there. */
  get bodyCenter(): { x: number; z: number } {
    if (this.limp) return { x: this.worldPos.x, z: this.worldPos.z };
    if (this.deathAction) {
      const hips = this.mesh.getObjectByName('mixamorigHips')?.getWorldPosition(new THREE.Vector3());
      if (hips) return { x: hips.x, z: hips.z };
    }
    return { x: this.worldPos.x + Math.sin(this.angle) * 0.85, z: this.worldPos.z + Math.cos(this.angle) * 0.85 };
  }

  /** Drags the body: its feet at (x, z), lying along `facing`. */
  dragTo(x: number, z: number, facing: number): void {
    this.worldPos.x = x;
    this.worldPos.z = z;
    this.angle = facing;
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    // Fallen onto its back, its head is behind it: turned about so it still leads along the drag.
    this.mesh.rotation.y = facing + (this.deathAction && this.fellBack && !this.limp ? Math.PI : 0);
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.mesh.visible = visible && !this.stashedAway;
    if (!visible) this.beam.setOn(false);
  }

  /** Direction the bot is looking (0 = +Z), which its vision cone follows. */
  get facing(): number {
    return this.angle;
  }

  /** Walking this frame — drives its footstep sounds. */
  get moving(): boolean {
    return this.isMoving && !this.disabled;
  }

  /** True while it has the player in sight and is giving chase. */
  get alert(): boolean {
    return this.wasChasing;
  }

  get floorY(): number {
    return this.worldPos.y;
  }

  get worldX(): number {
    return this.worldPos.x;
  }
  get worldZ(): number {
    return this.worldPos.z;
  }
}
