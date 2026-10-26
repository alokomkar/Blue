import { rayHitVolumes, type AimedHit, type HitVolume } from './game/detection';
import { coverPitch, coverBackAction, aimInput } from './game/cover-aim';
// Entry point — thin orchestration only. Builds the scene, wires input to
// the player, and runs the tick loop. Game-logic modules live in ./game/*.
//
// Phase 4 (this file, current state): maze + free movement + mobile
// controls + fog-of-war + document fragments — the job's actual win
// condition (how many: difficulty.ts, which sets every count per job; always-visible/no-risk,
// see fragments.ts; the exit lift stays locked, elevator.ts,
// until every one is recovered) + the lead/locker decision loop as an
// optional score/suspicion side gamble + suspicion + patrol bots
// (several per job, not just one — line of sight,
// shoot-to-disable with a visible tracer beam and an equipped stun gun, see
// weapon.ts, ambush spawn on a rigged locker, and each bot shoots back once
// it closes to BOT_FIRE_RANGE — see bots.ts) + stealth tools (hiding spots,
// sneak shrinking detection range, flares, Q/E sidestep — a plain sidestep
// normally, a small spring-loaded corner-peek while sneaking, see
// player.ts's leanOffset) + laser trip-beams (a few per job — block a straight corridor entirely while standing,
// pass through freely while sneaking, see lasers.ts) + security rooms
// (security.ts: locked doors seal off sections of each floor; hacking the
// matching terminal readies its server, and powering the server's grid
// opens the door — rooms are dead-end pockets, see rooms.ts/doors.ts) + a
// multi-floor building (true 3D
// vertical movement, not a portal-style floor swap — a staircase connects
// floor 0 to an independently-generated floor 1 stacked above it in the
// same scene, see stairs.ts and player.ts's currentFloorIdx). Floor 1 now
// gets full content parity with floor 0 — its own bots/leads/lockers/
// hiding-spots/laser-traps/room-zones and a share of the job's document
// fragments (populateFloor(), below, builds either floor identically) —
// rather than being an empty proof-of-concept shell; animate()'s per-frame
// gameplay block runs against whichever floor is currently active
// (activeFloorIdx) instead of being hardcoded to floor 0. The player's own
// fire is unlimited-ammo but rate-limited (FIRE_COOLDOWN_S, below) rather
// than magazine-based. See docs/eventual-munching-elephant plan for the
// full build sequence.

import * as THREE from 'three';
import {
  generateMaze,
  bfs,
  farthestCell,
  placeBotSpawn,
  placeHidingSpots,
  placeLaserTraps,
  placeStair,
  stairReserved,
  type MazeCells,
  type Stair,
} from './game/maze';
import { markBloom, disposePostFX, edgesPreferred, renderPixelRatio, rememberEdges, renderPostFX, setBulletTime, setGrade, setNightVision, type PostFX } from './game/postfx';
import { Infrared, INFRARED_RANGE_M, type HeatSource } from './game/infrared';
import { shadowLamps, shadowsWanted, tagMeshes } from './game/shadows';
import { Takeover } from './game/takeover';
import { playIntro } from './game/intro';
import { planBlackouts } from './game/blackout';
import { planCircuits, breakerSpot, wallFor, LIGHT_LURE_CELLS, BREAKER_DISPATCH_S, RESET_TAKES_S } from './game/power';
import { buildLightSwitch, buildBreaker, type PowerFittingRig } from './game/switches';
import { FULL_GOGGLES, GOGGLES_MIN_START, tickGoggles, toggleGoggles } from './game/goggles';
import { LightBudget } from './game/lightbudget';
import { saveRun, fetchBoards, fetchLeaderboard, fetchInit, saveProfile, fetchDaily, startDaily, submitDaily, markPlayed, reportTry } from './game/api';
import { causeOf, readOf, type Feel } from '../shared/tries';
import { continueJob, isHairstyle, isLook, isSuitColour } from '../shared/progress';
import type { CaseStanding, DailyBoard, DailyResponse, Grade, LastRun, Leaderboard, Look, StreakInfo } from '../shared/api';
import { shareLine, nextDay, type DailyResult } from '../shared/daily';
import { briefing, debrief, jobOperation, salutation, type LetterNote, type SideBrief } from '../shared/story';
import { ARC_JOBS, TRAINING_LINE, arcOpening, choiceLetter, endingLetter, fragmentFor, isEnding, type Ending } from '../shared/arc';
import { playCinematic } from './game/cinema';
import { playStory } from './game/storycinema';
import { STANDING, isLow, nextPosture, press, pressSilent, type PostureState } from './game/posture';
import { FULL_DASH, tickDash, type DashState } from './game/dash';
import { ACTION_LABELS, ACTIONS, AIM_MIN, AIM_MAX, CAMERA_MAX, CAMERA_MIN, bind, DEFAULT_CONTROLS, isBindable, isCustom, keyLabel as keyName, parseControls, resolveKeys, TURN_MAX, TURN_MIN, withKeys, type ActionId, type ControlSettings } from '../shared/controls';
import { MEMORY_TOTAL, memoryText, nextMemory, pagesOf, parseSeen } from '../shared/memories';
import { NO_CARRY, carryOver, describeCarry, easeFor, ladderCarry, mergeCarry, type Carry, type RunOutcome } from '../shared/campaign';
import { CASE_TIERS, caseStrength, communityCarry } from '../shared/case';
import { CONTRACTS, type ContractId } from '../shared/contracts';
import { falloutFor, runOutcomeOf, type MissionOutcome } from '../shared/fallout';
import { contractFor } from './game/contracts';
import { tonight } from './tonight';
import { roofHatch, tunnelGrate, withinSteps, facingOut, entriesFor, ENTRIES, ROOF_QUIET_CELLS, type EntryId } from './game/entries';
import { buildRoofHatch, buildTunnelGrate } from './game/hatches';
import { seedRandom, restoreRandom } from './game/seeded';
import { buildSceneRoot, buildFloor, handleResize, flashCaughtLights, revealFloorCell, CELL, WALL_H, WALL_T, FLOOR_HEIGHT, TALL_FLOOR_HEIGHT, EXPLORED_COLOR, type WallBox, type FloorRig, type SceneRoot } from './game/scene';
import { buildGateMesh, buildLaserMesh, buildLineMesh, buildSliderMesh, buildSweeperMesh, laserTrapBox, type GateRig, type LaserTrap, type MovingLaserRig } from './game/lasers';
import { lineHits, LINE_HINT, LINE_NOTE, placeLines, type LineLaser } from './game/linelasers';
import { gateHits, GATE_HINT, GATE_NOTE, placeGates, type Gate, type GateKind } from './game/evade';
import { placeShutters, shutterBlocks, shutterClosure, SHUTTER_HACK_S, SHUTTER_HOLD_S, SHUTTER_OPEN_S, SHUTTER_RISE_S, type ShutterPlan } from './game/shutters';
import { buildShutter, type ShutterRig } from './game/shutterRig';
import { placeSliders, placeSweepers, slidePosition, sliderHits, sweeperHits, SLIDE_SPEED, type Slider, type Sweeper } from './game/movingLasers';
import { buildRoom, DOORWAY_W, type BuiltRoom } from './game/rooms';
import { SHUT, stepRoomDoor, OPEN_R, type RoomDoorState } from './game/roomdoors';
import { buildDoor, type DoorRig } from './game/doors';
import { decorateFloor } from './game/decor';
import { TorchBeam, VisionCones, Dust, NoiseRing, TakedownMarker, AimMarker, TagMarkers, AlarmLights, Ambient, Bursts, Beacon } from './game/effects';
import { alarmState, sendsHunters, ALARM_OFF, ALARM_ON, ALARM_SPEED, HUNTERS_PER_WAVE } from './game/alarm';
import type { LockerRig } from './game/lockers';
import { planSecurity, navCellsFor, setPassage, KEY_COLORS, keyLabel, DIR_DELTA, OPPOSITE, type Dir, type Room, type RoomKind, type SecurityPlan } from './game/security';
import type { Linger } from './game/patrol';
import {
  parseTraining,
  advance,
  TRAINING_MAP,
  STATIONS,
  TRAINED_KEY,
  GUARD_GATES,
  TRAINING_PACK_ROAM_S,
  TRAINING_BLACKOUT,
  TRAINING_SWITCHES,
  TRAINING_KIT,
  TRAINING_DRONE_YARD,
  CEILING_MAP,
  CEILING_STATIONS,
  CEILING_SWEEPERS,
  CEILING_SLIDERS,
  CEILING_SHUTTERS,
  CEILING_PIPES,
  CEILING_GUARD,
  CEILING_PULSES_FROM,
  CEILING_BEFORE_JOB,
  TRAINED_CEILING_KEY,
  GRAPPLE_MAP,
  GRAPPLE_STATIONS,
  GRAPPLE_PIPES,
  GRAPPLE_GUARD,
  TRAINED_GRAPPLE_KEY,
  STEALTH_MAP,
  RANGE_MAP,
  RANGE_STATIONS,
  RANGE_TARGETS,
  STEALTH_STATIONS,
  STEALTH_GUARD,
  TRAINED_STEALTH_KEY,
  WEAPONS_MAP,
  WEAPONS_STATIONS,
  WEAPONS_SENTRY_FACING,
  WEAPONS_HEAVY_FACING,
  WEAPONS_TRAP_HEAVY_FACING,
  TRAINED_WEAPONS_KEY,
  COVER_MAP,
  COVER_STATIONS,
  COVER_GUARD_FACING,
  TRAINED_COVER_KEY,
  DOCK_MAP,
  DOCK_STATIONS,
  TOWER_STATIONS,
  EXIT_STATIONS,
  CORNERS_MAP,
  CORNERS_STATIONS,
  CORNERS_PIPES,
  CORNERS_GUARDS,
  TRAINED_CORNERS_KEY,
  WALL_MAP,
  WALL_STATIONS,
  WALL_GUARDS,
  TRAINED_WALL_KEY,
  HIGHWALL_MAP,
  HIGHWALL_STATIONS,
  HIGHWALL_GUARDS,
  HIGHWALL_COLUMNS,
  TRAINED_HIGHWALL_KEY,
  type Station,
  type TrainingLayout,
  type TrainingProgress,
} from './game/tutorial';
import { clueOn, space as bunkerSpace, openContainers, type BunkerContainer, BUNKER_EXIT, BUNKER_EXIT_LEVEL, BUNKER_LEVELS, BUNKER_LEVEL_NAMES, BUNKER_SHAFTS, BUNKER_STAIRS, BUNKER_START, BUNKER_STATIONS, BUNKER_WALL_H, DUCT_H, DUCT_LANE, alphasOn, bunkerMap, bunkerPieces, camerasOn, dogsOn, ductCellSolids, ductsOn, roofNav, roofRoutes, gatesOn, linesOn, packOn, patrolsOn, postsOn, slidersOn, stairCells, stairEnds, sweepersOn, type Rect, type Shaft } from './game/bunkerplan';
import { buildStairMesh, openFlightEnd, stairGroundHeight } from './game/stairs';
import type { Box3 } from './game/wallfade';
import { buildYard, type BuiltYard } from './game/yard';
import { PropFader } from './game/propfade';
import { towerThemes, dressTowerLevel, buildCameras, furnishPieces, FABRICS, ANNEX_FABRIC, STORE_FABRIC, DEPOT_FABRIC, CORE_FABRIC, type CameraRig, type Destructible, type OfficeDoorRig, type HeistLook } from './game/tower';
import { activePlan, selectTowerPlan, sectionOf, towerBlocked, startOpening, exitOpening, TOWER_START, TOWER_STAIRS, TOWER_BRIDGES, TOWER_LEVELS, TOWER_COLS, TOWER_ROWS, TOWER_LIFTS, TOWER_PATROLS, TOWER_POSTS, TOWER_DOGS, TOWER_ALPHAS, TOWER_LASERS, TOWER_KEYCARD, TOWER_CARDS, TOWER_BRIDGE_BONUS, STAIR_OPEN_S, ledgeNear, ledgeSpans, type LedgeSpan, OFFICES, levelMap, drawCells, gameStairs, walkable, sightAcross } from './game/towerplan';
import { GUN_MENU, gunLabel, gunShort, isBigGun, type BigGun } from './game/bigguns';
import { shotSound, spawnShot } from './game/projectiles';
import { BRIDGE_ROW, CANAL_COL, CONTAINER_H, CONTAINER_W, DOCK_ZIPLINE, YARD_CELL, YARD_COLS, YARD_ROWS, YARD_PLANS, type YardPlanData, zipPoint } from './game/yardplan';
import { DOCK_YARD, FARM_YARD } from './game/locations';
import { buildElevator, AIRLOCK_STYLE, TRUCK_STYLE, VAULT_STYLE, type ElevatorRig } from './game/elevator';
import { freshExplored, updateVision, tickFloorTransitions, revealAround, dimLive, type Sight, type VisionState } from './game/vision';
import { LOCATIONS, CORE_LOCATION, CAMPUS_JOBS, locationFor, arrivesAt, type Location, type LocationId } from './game/locations';
import { orderTour, describe as describeStop, stationText, flyDuration, type TourKind, type TourShot, type TourSpot } from './game/tour';
import type { BlueprintSheet, SheetRoom } from './game/blueprint';
import { stealthRating, gradeFor, heistPoints, reportRows, parSeconds, formatTime, type JobStats } from './game/report';
import { SIDE_GOALS, SIDE_BONUS, SIDE_GOAL_IDS, storySideGoal, dailySideGoal, sideBroken, type SideGoalId, type SideStats } from './game/sidegoals';
import { lockerOutcome, RIG_FUSE_S, RIG_ALARM_SUSPICION, RIG_AMBUSH_BOTS, type Outcome } from './game/decisions';
import { FULL_CAMO, toggleCamo, tickCamo, camoConceals, bumpedInto, CAMO_MIN_START } from './game/camo';
import { applySuspicion, isCaught } from './game/suspicion';
import { CALL_EVERY_S, CALL_RANGE_M, WITNESS_RANGE_M, reachedBy, sawItHappen } from './game/squad';
import { Bot, tryFire, SPOT_SUSPICION, BOT_HIT_SUSPICION, type BotProfile } from './game/bots';
import { FIRE_RANGE, AIM_HALF_ANGLE, DETECT_RADIUS, hasLineOfSight, lineClearOver, rayToBoxes, canTakedown, inViewCone, botCanSee } from './game/detection';
import { hasFloor as hasTowerFloor, HEIST_DOOR, stairHigh, stairLow } from './game/towerplan';
import { playInterlude } from './game/interludeview';
import { selectBunkerPlan } from './game/bunkerplan';
import { SLIDE_S, closeCells, nearBox, openCells, shiftedBox, slideEase, type Box as SlideBox, type Cell as SlideCell } from './game/slideshelf';
import { callInScene, descentScene, streetScene, toHeistScene, toTowerScene, towerTasks, uploadScene } from './game/interlude';
import { CORE_OP, noteCleared, nextOperation, operationFor, operationOf, operationRun, opsCleared, paLine, type Operation } from './game/operations';
import { KIT, WHITE_WAVES, WAVE_MAX_WAIT_S, restock } from './game/white';
import { evenBearings, ringCell, spreadSpots } from './game/wavespots';
import { cornerBridges } from './game/roofbridge';
import { buildClueSystem, type ClueRig } from './game/cluerig';
import { addressOf, advance as advanceRun, isStackSite, isYardSite, reverseExit, SITE_PLACE, SITE_TITLE, type StackSite, type Site, clearRun, clueScreen, crateOutcome, openableCrates, clearStats, finaleRows, loadStats, noteStat, clueLevels, dossierPage, dossierPlan, loadRun, newRun, runOptions, saveRun as keepRun, type Run as ArcRun } from './game/arc';
import { buildDossierMarker, type DossierRig } from './game/dossierrig';
import { yardDossierIndex, yardOpenContainers, type YardContainer } from './game/yardsite';
import * as bunkerPlan from './game/bunkerplan';
import * as signageText from './game/signage';
import { textFor } from './game/stacksigns';
import { containerSigns, roomSigns } from './game/bunkersigns';
import { buildSigns, type SignLayer } from './game/signrender';
import { BACKUP_DROP_M, CAMERA_BODY_S, SEARCH_EVERY_S, SEARCH_FOR_S, mayCallBackup, pickDropCell, searchCell, DROP_MAX_CELLS, DROP_MIN_CELLS, type DropCandidate } from './game/backup';
import { cameraYaw, cameraSees, spotMeter, CAMERA_SPOT_S, CAMERA_COOLDOWN_S, CAMERAS_OFF_S } from './game/cameras';
import { furnitureFor, KINDS, TOWER_SETS, type Placed, type TowerSetId } from './game/towerfurniture';
import type { Enemy, EnemyContext } from './game/enemies/types';
import { Watchdog } from './game/enemies/watchdog';
import { markerFor, pingGap, strongest } from './game/dogwarn';
import { Blasts } from './game/blasts';
import { decayedSuspicion, EVASION_S, PHASE_LABEL, QUIET, standsDown, stepAlert, SWEEP_CELLS, SWEEP_EVERY_S, type AlertState } from './game/alertstate';
import { approaching, bulletPace, BULLET_AUTO_MIN, BULLET_MIN_START, BULLET_REARM_S, FULL_BULLET, tickBullet, toggleBullet, type BulletState } from './game/bullettime';
import { insideSmoke } from './game/smoke';
import { SmokeClouds, spawnThrown, type Thrown } from './game/grenades';
import { grenadeOffer, SMOKE_START, SHOCK_START, GRENADE_COOLDOWN_S, SHOCK_RADIUS, SHOCK_DAZE_S, SMOKE_NOISE_CELLS, SHOCK_NOISE_CELLS, SMOKE_S, type Smoke } from './game/smoke';
import { documentFor } from './game/documents';
import { buildSkylight, pickSkylight, type Skylight } from './game/glass';
import { Sights, traceEnd, type EnemySight } from './game/sights';
import { bodySamples, blocking, stepFade } from './game/wallfade';
import { CLIMB, MIN_RUN_UP, faceAngle, faceStand, lieDirection, poseAt, riseNeeded, rollSides, runAngle, topPoint, wallContact, type WallContact } from './game/wallclimb';
import { assistPitch, crosshairNote, headPitch } from './game/aimassist';
import { WatchdogPack } from './game/enemies/dogpack';
import { meetingPoint, PACK_RANGE_CELLS } from './game/enemies/pack';
import { Crawler } from './game/enemies/crawler';
import { Alpha, ALPHA_BLAST_R } from './game/enemies/alpha';
import { Drone } from './game/enemies/drone';
import { difficultyFor, MIN_LOG_WINDOW_S, type Difficulty } from './game/difficulty';
import { buildTrap, sensorBeam, TRAP_RADIUS, MAX_ARMED_TRAPS, type TrapRig } from './game/traps';
import { brokeBeam } from './game/trapSensor';
import { rollStop, ROLL_DISTANCE, ROLL_WALL_MARGIN, type RollStop } from './game/trapRoll';
import { buildTrapAim } from './game/trapAim';
import { bodyVisibility, callsOthers, foundSuspicion, lightAt, noticeRange, noticeRate, BODY_HIDDEN_PCT, BODY_MIN_NOTICE, NOTICE_DECAY_PER_S } from './game/bodies';
import { startLayoutDemo } from './game/layoutdemo';
import { LANDSCAPE_KEY, inLandscapeFrame, rotateHintWanted, shouldEnterLandscape } from './game/orientation';
import { noiseRadius } from './game/enemies/noise';
import { pickTool, fireLabel, empVictims, EMP_BLAST_RADIUS } from './game/weapons';
import { sound, type Loop } from './game/audio';
import { threatLevel, heartPace, easeBpm, CALM_BPM } from './game/heart';
import { musicMix } from './game/music';
import { hopSpot, type Threat as HopThreat } from './game/coverhop';
import { coverSpotNear, cornerSpotNear, clampToCover, coverFacing, CORNER_AIM_YAW, type CoverSpot } from './game/cover';
import { Avoider, blockedAt } from './game/avoid';
import { Trail, followInput, followTarget, holdProgress, CATCH_UP, seenFor, sightOf, together, RESCUE_REACH, REVIVE_S, DOWN_FAIL_S, LEAVE_DOWNED_S, mayLeaveWithout, SEEN_DOWN_S, BACKUP_COOLDOWN_S, BACKUP_RANGE, LOOKOUT_RANGE, AUTO_COOLDOWN_S, shouldEngage, goInput, turnToward, headingTo, threatBearings, coverScore, nextLink, flightEnds, nearestOpenCell, wedged, byCorridors, NAV_FAR, NO_WAY_S, UP_HOLD_REACH, LOST_FAR_M, LOST_FAR_S, type Bearing, type FloorLink, type PartnerState } from './game/companion';
import { placeStaffLockers, placeVents, type StaffLockerSpot } from './game/props';
import { updateScreens } from './game/screens';
import { buildStaffLocker, buildVentGrille, type StaffLockerRig, type VentRig } from './game/stealthprops';
import type { ClutterProp } from './game/decor';
import { spawnAssemblyEffect, type AssemblyEffect } from './game/assembly';
import { spawnEmpPulse, ENEMY_TRACER_COLOR, type Tracer } from './game/weapon';
import { buildHidingSpotMesh, hidingSpotWallBox, isPlayerHidden, type CratePairRig } from './game/hiding';
import { TIMELINE, firstThatFits, openness, ramp, type Container } from './game/stash';
import { spawnFlare, type Flare } from './game/flare';
import { preparePulseLights } from './game/pulselights';
import { spawnFlashbang, spawnDazeStars, type Flashbang, type DazeStars } from './game/flashbang';
import { GUARD_FLASH_RADIUS, STUMBLE_PACE, STUMBLE_S, carries, flashStrength, stumbleLeft, throwsFlash } from './game/guardflash';
import { FLASH_START, FLASH_RADIUS, FLASH_NOISE_CELLS, FLASH_COOLDOWN_S, SUSPICION_AFTER, NO_SLOW, panicking, endSlow, dazeFor, type Slow, type Threat } from './game/flash';
import { Player, PLAYER_R, collides, setCameraAngle, type Blocker, type WallClip } from './game/player';
import { HIGH_RUN_UP, LEVEL_HOLD_S, LOWER_S, MOUNT_S, DISMOUNT_S, MOUNT_CLIP_S, OVER_TURN_S, mountOut, mountGrip, RISE_BLEND_S, RISE_S, ledgeY, DROP_REACH, DROP_S, HOP_BLEND_S, HOP_CLIP_S, HOP_HEARD_CELLS, HOP_S, JUMP_CLIP_S, JUMP_OUT, JUMP_REACH, JUMP_S, LEDGE_OUT as SHELF_OUT, LEDGE_Y, SHIMMY_CLIP_M, SHIMMY_CLIP_S, SHIMMY_SPEED as BRACED_SHIMMY_SPEED, clampAlong, cornerAt, crossTarget, floorPoint, handsPoint, highRuns, hopTarget, runOf, type Hang, type Run } from './game/highwall';
import { initKeyboardControls } from './game/controls-keyboard';
import { initTouchControls } from './game/controls-touch';
import * as hud from './game/hud';
import { portraitsReady, renderPortraits, warmPortraits } from './game/portrait';
import type { Body } from './game/outfit';
import { DEFAULT_STYLE, HAIRSTYLE_PIECES, SUIT_SHADES, type Style } from './game/skins';
import { planPipes, reachSpots, gripAtTower, gripFacing, hookPoint, pointOnLine, shimmy, towerUnder, turnOnto, PIPE_HEIGHT, type Grip, type PipePlan } from './game/pipes';
import { GOAL_LABEL, pickBunkerGoal, pickGoal, resolveGoalTarget, stepToward, type Goal } from './game/guide';
import { generateBuilding } from './game/building';
import { generateLayout, landmarkOf, inLandmark, stairSpurOf } from './game/layouts';
import { buildLandmark, type LandmarkSpot } from './game/landmarks';
import { HIDEOUTS, hideCounts } from './game/hideouts';
import { WAYS, ENTRY_TITLE, EXIT_NAME, EXIT_SOUND } from './game/ways';
import { TWISTS, TWIST_NOTES, TIMER_S, SILENT_MAX_COLS, SILENT_MAX_ROWS, storyTwist, dailyTwists, timedTwists, applyTwists, chipText, TWIST_IDS, type TwistId } from './game/twists';
import { buildEntryPortal, buildExitDoors, buildExitHatch } from './game/portals';
import { planObjectives, stepBlocked, nextStep, fuseLeft, specimenWarmth, type ObjectivePlan, type Step } from './game/objectives';
import { buildStation, ObjectiveMarkers, type StationPlacement, type StationRig } from './game/objstations';
import { locksFor, logDeadline } from './game/sequence';
import { HARD_LAND_SUSPICION, HAUL_COST, HAUL_S, HOOK_RANGE, HOVER_HEIGHT, LOWER_SPEED, MIN_TO_HOOK, hoverPose, nearestTarget, stepStrength, strainChanged, strainView, type Effort, type Spot, type StrainView } from './game/grapple';
import { buildPipes, fadeDecks, fadeLines, movePulses, MANTLE_S, MANTLE_UP, type ClimbTower, type PipeRig, type Pulse } from './game/pipeRig';

let level = 1;
/** Testing on your own machine: `?loc=museum` (or refinery, bank, warehouse, lab, campus) holds every job in that place. */
let forcedLocation: LocationId | null = null;

/** A Daily Heist run: the day's seed builds the same job for everyone; `scored` is false for practice (a replay, or logged out). */
/** A Daily Heist run: the scored attempt or practice, what last night carries into it, and how this week's earlier nights went. */
type DailyRun = { day: string; number: number; seed: number; scored: boolean; carry: Carry; week: RunOutcome[];
};

/** A job's settings with last night's carry-over applied (campaign.ts): only what leaves the building itself alone. */
function withCarry(d: Difficulty, carry: Carry | null): Difficulty {
  if (!carry) return d;
  return {
    ...d,
    guardReactionS: Math.max(0.8, d.guardReactionS + carry.reactionS),
    logWindowS: Math.max(MIN_LOG_WINDOW_S, d.logWindowS + carry.logWindowS),
    empAtStart: d.empAtStart + carry.extraEmp,
    guards: d.guards > 0 ? Math.max(1, d.guards + carry.guards) : d.guards,
    trapsAtStart: d.trapsAtStart + carry.extraTraps,
    blackouts: d.blackouts + carry.darkSections,
  };
}

/** The last job cleared on the ladder, which carries into the next (from the server on the way in, then from each clear). */
let ladderLast: LastRun | null = null;
const ladderCarryNow = (job: number): Carry => mergeCarry(ladderCarry(ladderLast?.outcome ?? null, ladderLast?.contract), easeFor(triesFailed(job)));

/**
 * How many times in a row each ladder job has beaten the player (kept on this device), which is what its help
 * (campaign.ts easeFor) goes by. A clear wipes the job's count; the scored Daily and training never count.
 */
const FAILS_KEY = 'mazeHeist.fails';
const failsByJob: Record<string, number> = ((): Record<string, number> => {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAILS_KEY) ?? '{}');
    if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw).filter(([, v]) => Number.isInteger(v) && (v as number) > 0)) as Record<string, number>;
  } catch {
    // No storage, or a mangled entry: nothing remembered.
  }
  return {};
})();
/** Playtesting on localhost (`?ease=3`): every job acts as if it had beaten you this many times. */
let easeOverride: number | null = null;
/** Local practice only (?bodies=N): how many guards are laid out stunned beside where the agent comes in, so the stash actions can be tried at once. */
let practiceBodies = 0;
const triesFailed = (job: number): number => easeOverride ?? failsByJob[job] ?? 0;
function noteJobResult(job: number, cleared: boolean): void {
  const n = cleared ? 0 : (failsByJob[job] ?? 0) + 1;
  if (n === (failsByJob[job] ?? 0)) return;
  if (n > 0) failsByJob[job] = n;
  else delete failsByJob[job];
  try {
    window.localStorage.setItem(FAILS_KEY, JSON.stringify(failsByJob));
  } catch {
    // Storage blocked: remembered for this visit only.
  }
}

/** What the Daily carries in tonight: last night's result and contract (campaign.ts), and how last week's case ended for everyone (case.ts). */
const dailyCarry = (d: DailyResponse): Carry => mergeCarry(carryOver(d.lastNight, d.week, d.lastContract), communityCarry(d.case.lastWeekPages));

/** The community's case as a meter for the report, with the viewer's share. */
function caseMeterView(c: CaseStanding): hud.CaseMeterView {
  const st = caseStrength(c.pages);
  const top = CASE_TIERS[CASE_TIERS.length - 1]!.pages;
  const to = st.next ? ` · ${st.next.pages - c.pages} more to reach ${st.next.name}` : ' · the top tier';
  return {
    fill: st.fraction,
    ticks: CASE_TIERS.map((t) => ({ at: t.pages / top, name: t.name, reached: c.pages >= t.pages })),
    caption: `Case #${c.number}: ${c.pages} ${c.pages === 1 ? 'page' : 'pages'} from ${c.agents} ${c.agents === 1 ? 'agent' : 'agents'}${st.name ? ` · ${st.name}` : ''}${to}. You’ve added ${c.mine}.`,
  };
}

/** The daily brief's line about the week's case. */
function caseLine(c: CaseStanding): string {
  const st = caseStrength(c.pages);
  return `Case #${c.number}: ${c.pages} ${c.pages === 1 ? 'page' : 'pages'} from ${c.agents} ${c.agents === 1 ? 'agent' : 'agents'}${st.name ? ` · ${st.name}` : ''}${st.next ? ` · ${st.next.pages - c.pages} more for ${st.next.name}` : ''}`;
}
/** Today's Daily Heist as the server last described it — null until it answers, and for good offline. */
let today: DailyResponse | null = null;
/** The streak as last heard from the server (null logged out). */
let streakKnown: StreakInfo | null = null;
/** The viewer's Reddit username, for Control's letters (null logged out, or until the server answers). */
let username: string | null = null;
/** Where "back to the ladder" goes after a daily run: the ladder job being played, or the one after the furthest cleared. */
let ladderJob = 1;
/** The way in last picked on a letter (entries.ts), offered first next time and used for a retry. */
const ENTRY_KEY = 'mazeHeist.entry';
let lastEntry: EntryId = ((): EntryId => {
  try {
    const e = window.localStorage.getItem(ENTRY_KEY);
    return e === 'roof' || e === 'tunnel' ? e : 'dock';
  } catch {
    return 'dock';
  }
})();

/** Counts this play toward the streak, and says so the first time today once it's more than a day long. */
function notePlayed(): void {
  void markPlayed().then((res) => {
    if (!res) return;
    const firstToday = !streakKnown?.playedToday;
    streakKnown = res.streak;
    if (firstToday && res.streak.count >= 2) hud.showToast(`${res.streak.count}-DAY STREAK · KEEP IT GOING TOMORROW`, 'good', 3200);
  });
}

/** The daily board in the shape the report's leaderboard shows. */
function dailyBoardView(board: DailyBoard, job: number): Leaderboard {
  return { top: board.top.map((e) => ({ rank: e.rank, username: e.username, points: e.points, job, grade: e.grade })), you: board.you };
}
const AGENT_KEY = 'mazeHeist.agent';
const AI_COOP_KEY = 'mazeHeist.aiCoop';
/** Whether the AI partner comes along on a job (the brief's option, kept in this browser; `?coop=ai` forces it on localhost). */
let aiCoopOn = ((): boolean => {
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('coop') === 'ai') return true;
    return window.localStorage.getItem(AI_COOP_KEY) === '1';
  } catch {
    return false;
  }
})();
function setAiCoop(on: boolean): void {
  aiCoopOn = on;
  try {
    window.localStorage.setItem(AI_COOP_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: it holds for this visit.
  }
}
/** Whether bullet time starts by itself when something closes in (a setting in the controls sheet; on unless it was turned off). */
const BULLET_AUTO_KEY = 'mazeHeist.bulletAuto';
let bulletAuto = ((): boolean => {
  try {
    return window.localStorage.getItem(BULLET_AUTO_KEY) !== '0';
  } catch {
    return true;
  }
})();
hud.wireBulletAutoSetting(bulletAuto, (on) => {
  bulletAuto = on;
  try {
    window.localStorage.setItem(BULLET_AUTO_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: it holds for this visit.
  }
});
const LOOK_KEY = 'mazeHeist.look';
const SUIT_KEY = 'mazeHeist.suit';
const HAIR_KEY = 'mazeHeist.hair';
/** The furthest job cleared in this browser — what "Continue" offers when there's no account to ask (logged out). */
const BEST_JOB_KEY = 'mazeHeist.bestJob';

function localBestJob(): number | null {
  try {
    const n = parseInt(window.localStorage.getItem(BEST_JOB_KEY) ?? '', 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function rememberCleared(job: number): void {
  try {
    if (job > (localBestJob() ?? 0)) window.localStorage.setItem(BEST_JOB_KEY, String(job));
  } catch {
    // Storage blocked: the account (if logged in) still has it.
  }
}
/** How the campaign ended for this player (arc.ts), once they've made the choice at the final level: remembered here, and on the account when logged in. */
const ENDING_KEY = 'mazeHeist.ending';
let ending: Ending | null = ((): Ending | null => {
  try {
    const e = window.localStorage.getItem(ENDING_KEY);
    return isEnding(e) ? e : null;
  } catch {
    return null;
  }
})();

/** Makes the choice at the final level, once: remembered in this browser and on the account. */
function chooseEnding(choice: Ending): void {
  if (ending) return;
  ending = choice;
  try {
    window.localStorage.setItem(ENDING_KEY, choice);
  } catch {
    // Storage blocked: the account (if logged in) still has it.
  }
  void saveProfile({ ending: choice });
}

/** The pages of Control's file found so far (shared/memories.ts), remembered in this browser. */
const MEMORIES_KEY = 'mazeHeist.memories';
const seenMemories: Set<string> = ((): Set<string> => {
  try {
    return parseSeen(window.localStorage.getItem(MEMORIES_KEY));
  } catch {
    return new Set<string>();
  }
})();

/** Keeps a page of the file, and tells the brief how many there are now. */
function keepMemory(id: string): void {
  seenMemories.add(id);
  try {
    window.localStorage.setItem(MEMORIES_KEY, JSON.stringify([...seenMemories]));
  } catch {
    // Storage blocked: the page lasts this visit.
  }
  refreshFileLink();
}

/** Reads Control's file: every page found so far, in the order of the story. */
function openFile(): void {
  const pages = pagesOf(seenMemories);
  hud.showDossier(
    {
      kicker: `Control’s file · ${pages.length} of ${MEMORY_TOTAL} pages`,
      greeting: 'Pages from my own file.',
      paragraphs: pages.map((p) => p.text),
      parameters: [],
      closing: 'More turn up in the files you bring out.',
    },
    { label: 'Close', onClick: () => {} }
  );
}

function refreshFileLink(): void {
  hud.setBriefFile(seenMemories.size, MEMORY_TOTAL, openFile);
}

/** The agent the player picked on the brief (remembered between visits). */
let agent: Body = ((): Body => {
  try {
    return window.localStorage.getItem(AGENT_KEY) === 'female' ? 'female' : 'male';
  } catch {
    return 'male';
  }
})();

/** What the agent wears (skins.ts): their own clothes, or the operative's black bodysuit. Remembered like the agent. */
let look: Look = ((): Look => {
  try {
    const saved = window.localStorage.getItem(LOOK_KEY);
    return isLook(saved) ? saved : 'classic';
  } catch {
    return 'classic';
  }
})();
/** The operative's suit colour and hair (skins.ts), remembered the same way. */
let style: Style = ((): Style => {
  try {
    const suit = window.localStorage.getItem(SUIT_KEY);
    const hair = window.localStorage.getItem(HAIR_KEY);
    return { suit: isSuitColour(suit) ? suit : DEFAULT_STYLE.suit, hair: isHairstyle(hair) ? hair : DEFAULT_STYLE.hair };
  } catch {
    return DEFAULT_STYLE;
  }
})();
/** The looks the brief offers: their own clothes, or the operative (its swatch a black suit, ringed in skin). */
const LOOK_CHOICES = [
  { id: 'classic' as Look, label: 'Classic', colours: null },
  { id: 'operative' as Look, label: 'Operative', colours: { suit: SUIT_SHADES.black.colour, armour: SUIT_SHADES.black.colour, trim: 0xc9956b } },
];
const SUIT_CHOICES = (Object.entries(SUIT_SHADES) as Array<[Style['suit'], { label: string; colour: number }]>).map(([id, s]) => ({ id, ...s }));
const HAIR_CHOICES = (Object.entries(HAIRSTYLE_PIECES) as Array<[Style['hair'], { label: string }]>).map(([id, h]) => ({ id, label: h.label }));

/** Redraws the agent cards' portraits in the current look and style (unless the pick changes again first). */
function refreshPortraits(): void {
  const want = `${look}:${style.suit}:${style.hair}`;
  const current = (): boolean => `${look}:${style.suit}:${style.hair}` === want;
  // A look whose models aren't in yet takes a moment (a phone's connection): say so, instead of looking dead.
  if (!portraitsReady(look, style)) hud.setAgentPortraitsLoading(true);
  void renderPortraits(['male', 'female'], look, style, (body, url) => {
    if (current()) hud.setAgentPortraits({ [body]: url });
  }).then(() => {
    if (!current()) return;
    hud.setAgentPortraitsLoading(false);
    warmOtherLook();
  });
}

let warmed = false;
/** Once the pick screen has its portraits, the other look's are drawn in the background, so tapping it is usually instant. */
function warmOtherLook(): void {
  if (warmed) return;
  warmed = true;
  // A little after the screen is up, so it doesn't compete with drawing it.
  window.setTimeout(() => warmPortraits(look === 'classic' ? 'operative' : 'classic', style), 300);
}

function clampAxis(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

const FLARE_COOLDOWN_S = 3.5;
const FIRE_COOLDOWN_S = 1.4; // ammo itself is unlimited — this is the recharge time between shots
const HACK_S = 3; // seconds of standing at a terminal to hack it
const HACK_RADIUS = 1.6; // hack progresses while within this of the terminal
const HACK_ABANDON_RADIUS = 7; // walking this far away drops the active hack (progress is kept on the terminal)
const CONSOLE_RADIUS = 1.4;
// The heist loop: take the uplink down, photograph the files, wipe the access logs before they go out.
const TASK_S = { uplink: 3, capture: 4, wipe: 3, cutLine: 3, clue: 4, crate: 2.5, slide: 1.2 } as const; // seconds of standing at each, like a terminal hack
const LOCKDOWN_CLEAR_M = 3; // a door shuts in a lockdown only when nothing is this close to it
const DECOY_SUSPICION = 40; // the wrong container: its lock trips an alarm
const DECOY_CALLS_M = 40; // guards this close (metres) come to look
const KEYCARD_REACH = 2.4; // how close to the downed guard carrying the keycard to take it
const NO_TRACE_BONUS = 150; // bringing the uplink back once the logs are wiped: nobody will know it was down
// Up in the ceiling (pipes.ts): climbing a tower, on its platform, hanging from the pipes, letting go.
const TOWER_REACH = 0.9; // how close to the foot of a tower's ladder to climb it
const CLIMB_SPEED = 1.7; // m/s up or down the ladder
const CLIMB_STEP_S = 0.4; // onto the ladder at the bottom, out onto the platform at the top
const GRAB_S = 0.35; // from the platform up onto the pipe, or back down onto it
const SHIMMY_SPEED = 1.6; // m/s, hand over hand
const HANG_TURN_RATE = 9; // how quickly the body swings round to a new heading along the pipes
const FALL_G = 16; // m/s², a little brisker than the real thing
const LEDGE_IN_S = 0.7; // vaulting a rail to hang from the ledge, or climbing back over
const LEDGE_PULL_S = 1.25; // pulling over the edge, from the hang to standing on the floor
const LEDGE_OUT = 0.34; // metres outside the rail's line the agent hangs
const LEDGE_SHIMMY = 0.6; // m/s along a tower rail's ledge, hand over hand (Mixamo's Left and Right Shimmy, the legs dangling: 0.37 m/s at the clips' own pace, played a little quicker)
const FREE_SHIMMY_M = 0.37; // one cycle of those clips covers this much, in FREE_SHIMMY_S
const FREE_SHIMMY_S = 1.38;
const GUARD_PULL_S = 1.15; // a guard yanked over the rail: dragged to the edge, tipped over it, dropped to hang below
const PULL_REACH = 2.5; // a guard this close to where the agent hangs can be pulled over the rail
const PULL_BONUS = 120; // points for a guard pulled over and hung
const AERIAL_REACH = 1.7; // an unaware guard this close under the hanging agent (across the floor) can be dropped on
const AERIAL_LAND = 0.55; // landing this far short of the guard's centre, on its back
const WALL_CAP = 0.07; // the wall-top trim's thickness (scene.ts): the top the hands and belly rest on is WALL_H + this
const WALL_LIE_S = 30; // seconds a body can lie on a wall top before the arms give out and it rolls off
const WALL_WARN_S = 8;
const WALL_JUMP_S = 0.75; // getting up from lying and pushing off over the edge, before the fall
const WALL_ROLL_REACH = 0.8; // how far past the wall's face the landing spot is
const WALL_REACH = 2.6; // an unaware guard this close (across the floor) to an agent lying on a wall can be dropped on
const FATAL_FALL_M = 2.5; // a takedown from higher than this (the agent's feet this far off the floor: from a tall wall's second level, not its first) kills the guard, and the sound of it carries
 // a hop along a tall wall's shelf costs this much of the grip (a shimmy costs by the second)
const WALL_THUMP_CELLS = 2; // guards this many cells off hear the agent hit the wall
const AERIAL_BONUS = 150; // points for a takedown from above
const DROP_HEARD_CELLS = 2; // a landing (without a guard to break the fall) brings guards this many cells away
// The top of a tower is a lookout: the camera rises a little, you see over the walls around it, and every
// enemy in that circle is tagged, shown through walls for a while.
const LOOKOUT_RADIUS = 14; // metres
const LOOKOUT_SIGHT = 0.75; // how bright the cells right around it show
const LOOKOUT_RISE = 4; // metres the camera rises
const LOOKOUT_BACK = 2.5; // and pulls back
const LOOKOUT_EASE_S = 0.6;
const TAG_S = 25; // how long a tag lasts
const TAG_FADE_S = 4; // fading out over its last seconds
// Recon (tour.ts): the fly-over of the objectives and the way out, at the start of a job.
const TOUR_HEIGHT = 11.5; // metres the camera hangs over a stop, and how far back it sits
const TOUR_BACK = 6.5;
const TOUR_RADIUS = 9; // the ground it lights around a stop
const TOUR_SIGHT = 0.9;
const TOUR_SETTLE_S = 1.1; // seconds to glide back behind the agent
const TOUR_PRESS_AFTER_S = 0.35; // a press this soon after it starts is the one that started it
const TOUR_HOLD_MIN_S = 0.5; // a stop is held at least this long before Next moves on (a press during the flight waits for it)
const TOUR_SKIPS_KEY = 'mazeHeist.reconSkips';
const TOUR_QUIET_AFTER = 3; // skipped this many times running, it stops playing by itself
const TOUR_COLOURS: Record<TourKind, number> = { uplink: 0x6fd6f0, files: 0xffb04a, logs: 0xb79cff, stairs: 0xe7e1cf, exit: 0x6fcf97 };
const HIGH_UP = 2; // metres off the floor: above this, up in the dark, only a lamp shows you
const PULSE_HIT = 0.45; // a pulse this close along the pipe to the hanging agent's hands: fatal
const PULSE_WARN = 8; // metres: a pulse this close, heading your way along your pipe, is warned of (about four seconds' notice)
const PULSE_WARN_S = 3; // at most one warning this often
const PULSE_VOLUME = 0.55;
const HANG_CAM_SWING = 0.7; // radians the chase camera swings off straight behind while hanging
const LADDER_FACING = 1; // radians: on a platform, facing this close to the ladder, Interact climbs down
const PERCH_TURN_SPEED = 2.6; // radians/s, turning on the platform (player.ts's TURN_SPEED)
const DOOR_HINT_RADIUS = 2.4;
const LOCKER_RADIUS = 0.6; // how close to a locker's front to open it — under the 0.76 locker spacing, so a second press never opens the neighbour
const DISTRACT_CELLS = 3; // bots within this many cells of walking distance go look at a flare
const LASER_HUM = 0.7;
const LASER_TRIP_SUSPICION = 25; // caught by a moving laser (a sweeper or a curtain)
const LASER_TRIP_COOLDOWN_S = 2; // the same one can't catch you again straight away
const LIFT_HEARD_CELLS = 7; // guards this many cells from a lift's doors come to look when it runs
const SENTRY_WAVE_M = 26; // guards this many metres from a sentry who has spotted the agent come to look
const PAIR_M = 18; // the offices' guards this far from a partner who goes to look at something go with him
const CAMERA_CALLS_CELLS = 8; // guards this many cells from a camera that has spotted the agent come to look
const LASER_CALLS_CELLS = 3; // guards this many cells from a tripped laser come to look
const LASER_HINT_CELLS = 1.6; // coming this close to a moving laser the first time says how to get past it
// When a dash would get you out of the way, the first time a job: a fast curtain heading your way down your
// corridor, or a guard walking straight at you with cover near.
const DASH_HINT_RANGE = 12; // metres
const PERCH_AIM_START_PITCH = -0.45; // radians: the crosshair starts a good way down from the platform
const PERCH_AIM_PITCH_RATE = 0.9; // radians/s at full stick or key
const PERCH_AIM_MIN_PITCH = -1.3;
const PERCH_AIM_MAX_PITCH = 0.3;
const PERCH_EYE_UP = 0.5; // lying on the platform, the eye is this far above it
const PERCH_AIM_RANGE = 22; // metres a shot from the platform reaches: it looks down over the walls, so none of them are in the way
const CORNER_LEAN_SPEED = 3.2; // m/s: stepping out to look round a corner, and back
const AIM_MAX_YAW = 1.15; // how far from the way the cover faces the crosshair can swing, radians (~66°)
const AIM_TURN_RATE = 1.15; // radians/s at full stick (before the player's turn sensitivity)
const AIM_MOUSE_RAD = 0.0028; // radians of aim per pixel of mouse travel, at the default sensitivity
const DASH_HINT_COVER = 8; // metres to the nearest cover, for the guard's
const TAKEDOWN_COOLDOWN_S = 0.5;
const CHASE_MUSIC_HOLD_S = 4; // after being shot, the chase layer holds this long
const DODGE_COOLDOWN_S = 2.5;
const DASH_COOLDOWN_S = 2.5; // after a dash to the trap's aim, before another (or a dodge)
const SHUTTER_CLEAR = 1.7; // a dash through an open shutter ends this far past it: its slide (player.ts) carries you under
const MIN_SLIDE_DASH = 3.6; // and runs at least this far, room for the slide and getting up
const HEAVY_HIT_SUSPICION = 45; // a heavy's shot lands harder than a patrol bot's
const MINE_SUSPICION = 35; // a crawler mine going off — and it trips the alarm
const DRONE_CALLS_CELLS = 4; // bots this many cells away come running when a drone spots you
const ROTOR_VOLUME = 0.8;
const PROP_REACH = 0.8; // how close to a staff locker's door or a vent grille to use it
const SWITCH_REACH = 1.1; // how close to a light switch or breaker panel's standing spot to use it
const LURE_ALLOWANCE_S = 20; // a guard noticing a light go off has this long to walk over and switch it back on
const DISPATCH_ALLOWANCE_S = 90; // a guard sent to a breaker may have the length of the floor to cross
const GIVE_UP_S = 90; // nobody's reached it by now: send someone else (a breaker), or leave it off (a switch)
const AT_FITTING = 1.5; // a guard this close to a fitting's standing spot is at it
const VENT_S = 1.2; // the crawl through a vent, half of it with the screen dark
const DARK_RADIUS = 7; // around a shot-out light, bots see less far…
const DARK_SIGHT = 0.6; // …this much less
const LURE_CELLS = 3; // bots this many cells away go to look at a knocked-over bin
const DODGE_SAFE_S = 0.35; // shots fired this soon after a dodge starts miss
const BLACKOUT_SIGHT = 0.4; // in a blackout with your torch off, bots spot you only this much as far
const BLACKOUT_AMBIENT = 0.04; // what's left of the building's ambient glow inside a blackout
const GOGGLES_GAIN = 3; // night vision amplifies what light there is…
const GOGGLES_FLOOR = 0.6; // …and its own infrared lamp gives it this much to work with, even in a blackout
const AMBIENT_FADE_RATE = 2.2; // walking into or out of a blackout, the glow eases over about half a second
const TORCH_OFF_SIGHT = 0.6; // torch off, bots spot you only this much as far (the same as in a shot-out light's dark)
const LIGHT_BUDGET = 10; // point lights shining at once, the nearest the player (lightbudget.ts)
const PACK_TRAP_NEAR = 2; // a trap this close to a pack's meeting point counts as set there (training)
const PACK_SPOT_RANGE = 14; // seeing a watchdog pack gathered from this close marks its meeting point on the blueprint
const BEAM_NOTICE_RANGE = 15; // how far off a bot notices your torch's beam on the floor (a lit patch stands out in the dark)…
const BEAM_REACH = 5; // …the lit patch it sees: this far along the beam, or up to the wall in the way
const BEAM_NOTICE_CELLS = 4; // …and how far it will walk over to look
const BEAM_NOTICE_COOLDOWN_S = 10; // before the same bot is drawn by it again
const BEAM_CHECK_S = 0.25;
// Up close, it's the guard's own sight and awareness that decide, not the beam — otherwise creeping up
// behind one with the torch on (a takedown) would light the floor in front of it and turn it round.
const BEAM_IGNORED_WITHIN = 4;
const GATE_COLOR = 0xe0bd6c;
const NIGHT_VISION = 2.5; // the trap camera's feed is this much brighter than the main view
const TRAP_LAMP = 40; // its infrared lamp, while the feed is drawn
const TRAP_LURE_CELLS = 4; // guards this many cells from a blast come to see
const NEWS_TOAST_MS = 7000; // what a job brings in stays up long enough to read // training gates, in the coach's amber
const TRAINING_FAIL_S = 1.6; // after a training failure, how long before the station restarts

/** What the Interact button says for each kind of target. */
const INTERACT_LABELS: Record<Target['kind'], string> = {
  clue: 'Hack',
  crate: 'Open',
  slide: 'Slide',
  towerLift: 'Ride',
  towerKey: 'Take',
  towerConsole: 'Loop feed',
  towerConsoleDone: '✓ Cameras off',
  cameraPanel: 'Switch camera off',
  stairConsole: 'Lower stair',
  ledgeHang: 'Hang',
  ledgePull: 'Pull over',
  ledgeUp: 'Climb up',
  towerDoor: 'Ride down',
  zip: 'Ride',
  stash: 'Stash',
  release: 'Release',
  climb: 'Climb',
  shutter: 'Hack',
  climbDown: 'Climb down',
  hang: 'Hang',
  perch: 'Platform',
  letGo: 'Drop',
  wallRoll: 'Jump off',
  glass: 'Break glass',
  revive: 'Revive',
  wallDrop: 'Takedown',
  wallJump: 'Jump',
  hideLocker: 'Hide',
  switch: 'Lights',
  breaker: 'Breaker',
  exitLocker: 'Step out',
  vent: 'Crawl',
  cover: 'Cover',
  leaveCover: 'Leave',
  body: 'Carry',
  drop: 'Drop',
  locker: 'Open',
  terminal: 'Hack',
  server: 'Power',
  uplink: 'Uplink',
  capture: 'Capture',
  wipe: 'Wipe',
  cutLine: 'Cut',
};
const SHOT_HEARD_CELLS = 2; // bots this many cells away walk over to where a shot was fired
const BODY_RADIUS = 1.3; // how close to a downed bot's body to pick it up
const BODY_SET_DOWN = 0.8; // a carried body is put down this far in front
const STASH_REACH = 1.7; // how close to a crate, locker or vent a carried body can be put away
const CRATE_HALF_LENGTH = 0.95; // half the length of a crate pair (hiding.ts's CRATE_L)
const CRATE_CLEAR = 1.35; // how far from the middle of a pair, across it, the agent must be for the near crate to slide out clear of it (half a crate's depth, the slide and the agent's radius)
// How a body lies when laid along the pair's X axis / along a grille's facing: facing + this, in layDown's terms.
const STASH_BODY_ALONG_X = 0;
const STASH_BODY_ALONG_FACING = -Math.PI / 2;
const VENT_PUSH = 2.4; // how far a body is pushed into a vent: past the grille, into the wall

/** Somewhere a carried body could be put away: what kind, and the piece of the level that opens for it. */
type StashSpot = { container: Container; what: string; locker?: StaffLockerRig; crates?: CratePairRig; vent?: VentRig; at: { x: number; z: number };
};
const BODY_CALLS_CELLS = 4; // guards this many cells from a found body come to look
const BODY_METER_RANGE = 14;
const CROUCH_HIPS = 0.62; // how high the hips are over the wall top, crouched (Braced Hang To Crouch's last frame)
const ALPHA_TRACER_COLOR = 0x4fb4ff; // an alpha's shots are blue, apart from a guard's
const ALPHA_HINT_DIST = 14; // an alpha unit this close says, the first time, what it does and how to stop it
const MINE_HINT_RANGE = 7; // a crawler mine this close says, the first time, what it is and how to stop it
const EMP_HINT_RANGE = 9; // a dog or drone this close says, the first time, how to stop one // bodies this close to the player show how visible they are
const ARRIVAL_OPEN_S = 1.1; // the arrival lift's doors open this long into a job
const ARRIVAL_WALK_THROTTLE = 0.45; // the agent walks out of the lift at this share of full speed
const ARRIVAL_WALK_S = 5; // and is given back to the player if it hasn't got out by then
const LIFT_HINT_RADIUS = 1.7; // walking up to the locked exit lift says what it needs
const LIFT_CAM_HEIGHT = 7.5;
const LIFT_CAM_EASE_S = 0.8; // seconds to hand the shot back to the chase camera

type Terminal = { keyId: number; room: BuiltRoom; x: number; z: number; /** Which way the agent faces there, toward the console. */ facing?: number; progress: number; hacked: boolean };
type ServerConsole = { keyId: number; room: BuiltRoom; x: number; z: number; online: boolean };
/** A storage-room locker; x/z is the floor-local spot in front of it the player opens it from. */
type Locker = { rig: LockerRig; x: number; z: number; section: number };
type StorageRoom = { built: BuiltRoom; section: number };
/** The network cabinet in the uplink closet: while it's online, a captured file streams straight out. */
type Uplink = { room: BuiltRoom; x: number; z: number; facing?: number; progress: number; online: boolean; restored: boolean };
/** A records-room workstation: `files` of the job's documents, photographed on the PDA. */
type Workstation = { room: BuiltRoom; x: number; z: number; /** Which way the agent faces there, toward the console. */ facing?: number; progress: number; files: number; captured: boolean; /** A contract's step (objectives.ts), worked at a station of its own instead of a records room's screen. */ step?: StationRuntime };
/** A contract step's station on a floor: what it is, its prop, and which floor it's on. */
type StationRuntime = { step: Step; rig: StationRig; floorIdx: number };
/** The uplink's line at the roof hatch (entries.ts): cut it there and the uplink is down for good. */
type RoofLine = { x: number; z: number; progress: number; cut: boolean; setCut: (cut: boolean) => void;
};
/** The log server: files whose access logs are queued, and when (job clock) the batch goes out unless they're wiped. */
type LogServer = { room: BuiltRoom; x: number; z: number; facing?: number; progress: number; pending: number; deadline: number };

/** Everything a single floor's worth of gameplay content owns — one of these per floor, built by populateFloor() below. */
type FloorContent = {
  /** Where this floor's static content meshes live — floor.group, so adding/removing a mesh through it inherits the floor's own world transform automatically. */
  parent: THREE.Object3D;
  /** The ceiling's pipes and towers (pipes.ts, pipeRig.ts) (null in training). */
  pipes: PipePlan | null;
  pipeRig: PipeRig | null;
  // This floor's own maze data — a bot roster needs its *own* floor's cells/cols/rows for pathfinding (bots.ts's pickNewPath), not floor 0's.
  cells: MazeCells;
  /** `cells` with locked door passages closed — what bots path on, reopened as doors unlock. */
  navCells: MazeCells;
  cols: number;
  rows: number;
  /** Door id whose section each cell lies in, or -1 for the always-open region. */
  section: number[][];
  doors: DoorRig[];
  /** The exact box object each locked door pushed into floor.wallBoxes, so unlocking can remove it. */
  doorBoxes: Map<DoorRig, WallBox>;
  /** The doors in the mouths of the rooms that are only there to fill the building: they slide open for anything that comes near, and shut again (roomdoors.ts). */
  roomDoors: Array<{ rig: DoorRig; box: WallBox; state: RoomDoorState }>;
  terminals: Terminal[];
  servers: ServerConsole[];
  rooms: BuiltRoom[];
  storage: StorageRoom[];
  lockers: Locker[];
  /** Documents placed on this floor — all on records-room workstations. */
  documents: number;
  workstations: Workstation[];
  /** The contract's stations on this floor (each also a workstation, so the task machinery works them). */
  stations: StationRuntime[];
  /** The guard carrying the keycard on this floor (a swap or a vault), if there is one. */
  carrier: Bot | null;
  /** Steps with nowhere to put a station: counted done from the start, so the job can't be stuck on them. */
  skippedSteps: string[];
  /** The way in this floor holds (the roof hatch, the tunnel grate), in its open part; null if none fit. */
  entrySpot: { x: number; y: number } | null;
  /** Null when the floor has none (training, or no room for it): captures are then safe / never logged. */
  uplink: Uplink | null;
  logServer: LogServer | null;
  /** Cells with the power cut (blackout.ts): lights dead, and the ambient glow fades out while you're in one. */
  dark: boolean[][];
  /** Every light switches and breakers control. */
  lamps: Lamp[];
  /** Light switches and breaker panels (power.ts). */
  fittings: PowerFitting[];
  /** Which breaker circuit each cell is wired to (null before job 10). */
  circuit: number[][] | null;
  /** Cells whose breaker is cut right now: dark like a blackout until a guard resets it. */
  powerCut: boolean[][];
  /** Every enemy on this floor — patrol bots, sentries, watchdogs. */
  enemies: Enemy[];
  /** Watchdogs hunting together, with the meeting point they regroup at. */
  packs: WatchdogPack[];
  hidingSpots: Array<{ x: number; y: number }>;
  /** The crate pairs at those spots, in order (they slide apart when a body is stashed). */
  crates: CratePairRig[];
  laserBoxes: WallBox[];
  /** Laser trap cells, for the blueprint. */
  laserCells: Array<{ x: number; y: number }>;
  /** Moving lasers (movingLasers.ts): sweepers turning in junctions, curtains running up and down corridors. */
  sweepers: Array<{ laser: Sweeper; rig: MovingLaserRig }>;
  sliders: Array<{ laser: Slider; rig: MovingLaserRig }>;
  /** Line lasers (linelasers.ts): single beams that rise and fall or sweep across a corridor; crossed lying flat or crouched. */
  lines: Array<{ laser: LineLaser; rig: MovingLaserRig }>;
  /** Laser gates (evade.ts): beams across a corridor to duck, crawl under or wait out; camo is no use against them. */
  gates: Array<{ gate: Gate; rig: GateRig }>;
  /** Timed shutters (shutters.ts): `openedAt`, stats.seconds when last unlocked (null: shut); `box`, its world collider. */
  shutters: Shutter[];
  /** Staff lockers the player can hide inside. */
  staffLockers: Array<{ rig: StaffLockerRig; cell: { x: number; y: number } }>;
  /** Vents through a wall: crawl in at one grille, out at the other. */
  vents: Array<{ ends: [VentRig, VentRig]; cells: [{ x: number; y: number }, { x: number; y: number }];
  }>;
  /** Corridor clutter a stun shot can knock over as a lure (world position, `disabled` once knocked). */
  props: Array<ClutterProp & { worldX: number; worldZ: number; disabled: boolean }>;
  /** Ceiling fixtures a stun shot can put out (world position, `disabled` once broken). */
  lights: Array<{ worldX: number; worldZ: number; disabled: boolean; light: THREE.PointLight; mesh: THREE.Mesh;
  }>;
  /** How to make a fresh copy of each posted guard and dog — training puts them back when a station restarts. */
  spawners: Map<Enemy, () => Enemy>;
};

/** What each first level built on the stacks engine is furnished and its cargo drawn as (tower.ts). */
const STACK_FABRICS: Record<StackSite, typeof ANNEX_FABRIC> = { annex: ANNEX_FABRIC, store: STORE_FABRIC, depot: DEPOT_FABRIC };

/** A light a switch or breaker controls (power.ts): a corridor fixture or a room light, with its full brightness remembered. */
type Lamp = {
  light: THREE.PointLight;
  base: number;
  /** A fixture's glowing bulb, and the fixture's entry in FloorContent.lights (shootable, darkening guards' sight). */
  bulb: THREE.MeshStandardMaterial | null;
  bulbBase: number;
  fixture: FloorContent['lights'][number] | null;
  cell: { x: number; y: number };
  /** Shot out, or in a blackout: dark for good. */
  broken: boolean;
  /** Switched off at its switch. */
  off: boolean;
  /** Its circuit's breaker is cut. */
  cut: boolean;
};

/** A light switch or a breaker panel on a wall, and the lamps it controls. */
type PowerFitting = {
  kind: 'switch' | 'breaker';
  rig: PowerFittingRig;
  cell: { x: number; y: number };
  lamps: Lamp[];
  on: boolean;
  /** A breaker's circuit (-1 for a switch) and its label. */
  circuit: number;
  label: string;
  /** Off, and: nobody's coming ('none'), a breaker waiting to send a guard at `dispatchAt`, or a guard on the way since `comingSince`. */
  reset: 'none' | 'waiting' | 'coming';
  dispatchAt: number;
  comingSince: number;
  /** Seconds a guard has spent at it, putting it back. */
  resetting: number;
};

/** Lights or darkens a lamp to match its switch, its breaker, and whether it's been shot out. */
function applyLamp(l: Lamp): void {
  const lit = !l.broken && !l.off && !l.cut;
  l.light.intensity = lit ? l.base : 0;
  l.light.userData.broken = !lit; // effects.ts's flicker leaves a dark light alone
  if (l.bulb) l.bulb.emissiveIntensity = lit ? l.bulbBase : 0.03;
  if (l.fixture) l.fixture.disabled = !lit; // dark: nothing to shoot, and guards see less far near it
}

/** A hand-placed floor (training): stands in for populateFloor's random placement. */
type FloorScript = {
  plan: SecurityPlan;
  /** Guards holding a post: their cell and the way they face. */
  guards: Array<{ x: number; y: number; facing: number; /** Paces between its post and this cell instead of standing on it. */ paceTo?: { x: number; y: number } }>;
  /** Heavy enforcers holding a post, and the way they face. */
  heavies?: Array<{ x: number; y: number; facing: number }>;
  /** Guards that patrol (on whatever route they pick, within the gates). */
  patrols: Array<{ x: number; y: number }>;
  dogs: Array<{ x: number; y: number; zone?: number[][] }>;
  /** Alpha units (enemies/alpha.ts): robot dogs that run at the agent and go off. */
  alphas?: Array<{ x: number; y: number; zone?: number[][] }>;
  /** Drones, and the cells they keep to. */
  drones?: { at: Array<{ x: number; y: number }>; area: ReadonlyArray<{ x: number; y: number }>;
  };
  /** Watchdogs hunting as a pack, the meeting point they regroup at, and how long they roam apart between regroups. */
  packs: Array<{ dogs: Array<{ x: number; y: number }>; meet: { x: number; y: number }; roamS: readonly [number, number];
  }>;
  crates: Array<{ x: number; y: number }>;
  lasers: LaserTrap[];
  staffLockers: StaffLockerSpot[];
  /** Which way storage-room sentries face, instead of straight out of the doorway. */
  sentryFacing?: number;
  /** Blacked-out cells. */
  dark?: Array<{ x: number; y: number }>;
  /** Light switches, on a wall of a cell with a corridor light (training's lesson). */
  switches?: ReadonlyArray<{ x: number; y: number; wall: Dir }>;
  /** Moving lasers, timed shutters, and the ceiling's towers and pipes (the ceiling course). */
  shutters?: readonly ShutterPlan[];
  sweepers?: readonly Sweeper[];
  sliders?: readonly Slider[];
  lines?: readonly LineLaser[];
  /** Laser gates (evade.ts): the beams a cloak does nothing about. */
  gates?: readonly Gate[];
  pipes?: PipePlan;
  /** A hall that dresses itself: no corridor tape, route chevrons or clutter (the tower's). */
  plain?: boolean;
  /** Stops beside places to hide, which the patrols linger at (patrol.ts). */
  lingers?: Linger[];
  /** Authored rounds, one per patrol in the same order: the cells that patrol walks, round and round. */
  rounds?: Array<Array<{ x: number; y: number }>>;
};

/** A timed shutter on a floor: its plan, its 3D rig, its world collider, and when it was last unlocked (null: shut). */
type Shutter = { plan: ShutterPlan; rig: ShutterRig; box: WallBox; walls: WallBox[]; openedAt: number | null;
};

/** A floor's rig plus the gameplay content that lives on it — bundled together since almost everything per-frame needs both at once. */
type ActiveFloor = { rig: FloorRig; content: FloorContent };
/** A floor with its blueprint/vision state: what the building's list of storeys holds. */
type Storey = ActiveFloor & { explored: VisionState };

/** Whatever Interact would act on right now — the nearest in range. */
type Target =
  | { kind: 'climb'; tower: number; floor: ActiveFloor }
  | { kind: 'shutter'; shutter: Shutter; panel: number; floor: ActiveFloor }
  | { kind: 'climbDown' }
  | { kind: 'hang' }
  | { kind: 'perch' }
  | { kind: 'letGo' }
  | { kind: 'wallRoll' }
  | { kind: 'revive' }
  | { kind: 'wallDrop' }
  | { kind: 'wallJump' }
  | { kind: 'hideLocker'; locker: StaffLockerRig; floor: ActiveFloor }
  | { kind: 'zip'; floor: ActiveFloor }
  | { kind: 'towerLift' }
  | { kind: 'towerKey' }
  | { kind: 'towerConsole' }
  | { kind: 'towerConsoleDone' }
  | { kind: 'cameraPanel'; cam: number }
  | { kind: 'stairConsole' }
  | { kind: 'ledgeHang'; near: { span: LedgeSpan; at: number; dist: number } }
  | { kind: 'ledgePull'; guard: Enemy }
  | { kind: 'ledgeUp' }
  | { kind: 'towerDoor' }
  | { kind: 'switch'; fitting: PowerFitting; floor: ActiveFloor }
  | { kind: 'breaker'; fitting: PowerFitting; floor: ActiveFloor }
  | { kind: 'exitLocker' }
  | { kind: 'vent'; to: VentRig; floor: ActiveFloor }
  | { kind: 'cover'; spot: CoverSpot }
  | { kind: 'leaveCover' }
  | { kind: 'body'; bot: Bot }
  | { kind: 'drop' }
  | { kind: 'glass' }
  | { kind: 'stash'; spot: StashSpot; floor: ActiveFloor }
  | { kind: 'release'; door: DoorRig; floor: ActiveFloor }
  | { kind: 'locker'; locker: Locker; floor: ActiveFloor }
  | { kind: 'terminal'; terminal: Terminal; floor: ActiveFloor }
  | { kind: 'server'; server: ServerConsole; floor: ActiveFloor }
  | Task;

/** A heist-loop station the player stands at while a bar fills (TASK_S). */
type Task =
  | { kind: 'uplink'; station: Uplink; floor: ActiveFloor }
  | { kind: 'capture'; station: Workstation; floor: ActiveFloor }
  | { kind: 'wipe'; station: LogServer; floor: ActiveFloor }
  | { kind: 'cutLine'; station: RoofLine; floor: ActiveFloor }
  /** The bunker's clue system: a console that knows where the dossier is (tasks/plan.md). */
  | { kind: 'clue'; station: ClueSystem; floor: ActiveFloor }
  /** A cargo container's door, worked open; the dossier is in one of them. */
  | { kind: 'crate'; station: CrateStation; floor: ActiveFloor }
  /** A bank of sliding shelving's wheel (the Records Annex): worked, it slides the bank across its lane, or back. */
  | { kind: 'slide'; station: ShelfStation; floor: ActiveFloor };

/** A clue system in the bunker: where it is worked from (floor-local), how far the hack is, whether it is done, and the prop. */
/** A bunker container's door end: where it is worked from (floor-local), how far it is open, and which container it is. */
type CrateStation = { x: number; z: number; progress: number; done: boolean; level: number; container: { id: string; cx: number; cz: number } };

/** A bank of sliding shelving: its model and collision box, where it started, the step it slides by, and where it is in a slide (`at` 0 is where it stood, 1 slid; `anim` is a slide under way). */
type ShelfBank = { level: number; group: THREE.Object3D; box: WallBox; home: SlideBox; cells: SlideCell[]; dx: number; dy: number; at: 0 | 1; anim: { from: number; to: number; t: number } | null; station: ShelfStation };
/** The wheel end a bank is slid from, where it is worked from (floor-local: it moves with the bank), and how far the hold is. */
type ShelfStation = { x: number; z: number; progress: number; done: boolean; level: number; bank: ShelfBank };

type ClueSystem = { x: number; z: number; progress: number; done: boolean; /** Which stop of the chain it is (a bunker's: the storey), and the storey it stands on. */ level: number; floor: number; rig: ClueRig };

/**
 * Up off the floor, on `floor` (pipes.ts): climbing tower `tower`'s ladder
 * (`t` seconds in, up or down; going down, turning from `from`, the way the
 * agent faced on the platform); standing on its platform, facing `angle`;
 * hanging from the pipes (`lift` 0 on the platform to 1 hanging, rising or,
 * `back`, sinking back onto it; `travel` how far shimmied so far); or falling
 * from `from` to land at `to`, `t` seconds in, onto `target` if a guard was
 * under it (`hard`: the grip gave out, and the landing is loud); or being
 * hauled up a grapple line from `from` to the pipe at `grip` (`hooked`: a
 * hang that started that way, on the agent's own strength).
 */
type Aloft =
  | { kind: 'climb'; floor: ActiveFloor; tower: number; t: number; up: boolean; from?: number;
    }
  | { kind: 'perch'; floor: ActiveFloor; tower: number; angle: number }
  | { kind: 'hang'; floor: ActiveFloor; tower: number; grip: Grip; angle: number; lift: number; back: boolean; travel: number; turned: boolean; hooked?: boolean; low?: number; lowering?: boolean; /** 0–1: how far over a console it has swung and flattened (grapple.ts's hover helpers). */ flat?: number; /** The console it is swinging to, kept while it eases away. */ aimAt?: Spot }
  | { kind: 'zip'; floor: ActiveFloor; t: number }
  /** The tower's rail hang: over the balustrade and hanging from the slab's edge, `along` the run `span`; 'in' vaulting over, 'out' climbing back, `travel` for the hands' animation. */
  | { kind: 'ledge'; floor: ActiveFloor; span: LedgeSpan; along: number; phase: 'in' | 'hang' | 'out'; t: number; from: { x: number; y: number; z: number }; angle: number; travel: number; /** Seconds the vault or the haul takes. */ dur: number; /** Hauled up on the grapple line to this rail point (world), not vaulted. */ haul: THREE.Vector3 | null; /** Hanging: seconds into the shimmy clip, and which way (the agent's side) it last went. */ cycle: number; side: 'L' | 'R' }
  | {
      kind: 'wall';
      /** A container's roof (the bunker's): the climb ends standing on it, not lying along it. */
      roof?: boolean;
      /** Up onto a roof: where the hips and the root were (above the floor) when the pull-up began. */
      mountHips?: number | undefined;
      mountRoot?: number | undefined;
      /** The height of the top above the floor: an ordinary wall's, or a tall wall's (climbed up from its shelf). */
      top: number;
      floor: ActiveFloor;
      /** 'climb': up the face and over the top (wallclimb.ts poseAt, `t` seconds in); 'lie': flat along the top; 'roll': over the edge, before the fall. */
      phase: 'climb' | 'lie' | 'roll' | 'down';
      contact: WallContact;
      /** Where along the wall (its run axis) the climb goes up, which way along it the agent will face, and how far there is to climb. */
      along: number;
      dir: 1 | -1;
      rise: number;
      t: number;
      /** Lying: where, how far off the wall's line the agent has turned to aim, and seconds of strength left. */
      lie: { x: number; y: number; z: number };
      /** Lying: where the hips are (the body turns about them, on the wall's centre line) and how far the root is ahead of them along the way the body faces. */
      hips: { x: number; z: number };
      back: number;
      yaw: number;
      lieLeft: number;
      /** Climbing down (the climb played backwards): the angle the body lay at when it began, which it turns from. */
      downFrom: number;
      /** Rolling: the side it goes off and the guard it comes down on, if any. */
      roll: { side: { x: number; z: number; nx: number; nz: number }; target: Enemy | null } | null;
    }
  | { kind: 'shaft'; floor: ActiveFloor; shaft: Shaft; t: number; angle: number }
  | { kind: 'haul'; floor: ActiveFloor; grip: Grip; from: { x: number; y: number; z: number }; angle: number; t: number }
  | {
      /** Up a tall wall (highwall.ts): the run up its face, then hanging from its shelf, shimmying, hopping along it, and dropping or leaping off. */
      kind: 'highwall';
      floor: ActiveFloor;
      contact: WallContact;
      run: Run;
      along: number;
      phase: 'pop' | 'hang' | 'hop' | 'rise' | 'lower' | 'drop' | 'jump' | 'mount' | 'top' | 'over' | 'dismount' | 'corner' | 'cross';
      /** Going round a corner of the wall, or across to another one by a jump: where from and to, and how long it takes. */
      turn?: { from: Hang; to: Hang; convex: boolean; cross: boolean; dur: number; dir: 1 | -1 } | undefined;
      t: number;
      /** Which shelf the agent hangs from (1 the lower, 2 the one at the wall's top), where the root was when a rise or a lower began (above the floor), and how long forward and back have been held. */
      level: 1 | 2;
      fromY: number;
      hold: number;
      holdBack: number;
      /** Forward and back are free to start a rise or a lower: they were let go of since the last climb (a key held through the run up must not carry on up). */
      armed: boolean;
      /** Where the hips and the root stood when a rise began (hips height above the floor, root x and z): the rise starts from there and ends back on that line. */
      fromHips: number;
      fromX: number;
      fromZ: number;
      /** How far the root rises in the run up. */
      rise: number;
      /** Hanging: seconds into the shimmy clip, which way it goes (the agent's side) and how far it has got (0 still, 1 going). */
      cycle: number;
      side: 'L' | 'R';
      speed: number;
      /** Hopping: where the hop goes from and to along the run, and to which side. */
      hopFrom: number;
      hopTo: number;
      hopSide: 'L' | 'R';
      /** Over the top: this coming down is the far side's (the contact has been turned about), and the hips' height the pull-up started from. */
      over: boolean;
      mountFrom: number;
      /** Dropping or leaping: where the body goes from and to, and the guard it lands on. */
      out: { from: { x: number; y: number; z: number }; to: { x: number; z: number }; target: Enemy | null; /** Off the top onto a container's roof (the height to land at), or onto a piece of furniture that breaks under the landing. */ roofAt?: number; smash?: Destructible; level?: number } | null;
    }
  | { kind: 'fall'; floor: ActiveFloor; from: { x: number; y: number; z: number }; to: { x: number; z: number }; angle: number; t: number; target: Enemy | null; hard?: boolean; /** Off a wall top: lands crouched, and starts on its side (radians about the way it faces), straightening as it falls. */ crouch?: boolean; tilt?: number; /** A clip has already brought the agent down onto its feet (a drop or a leap off a tall wall): no landing crouch after it. */ settled?: boolean; /** Off a wall's top: the push-off was Jump_Start, so the landing is Jump_Land. */ soft?: boolean };

/** How far up the ladder the feet go before the pull up onto the platform. */
function rungsTop(c: ClimbTower): number {
  return Math.max(0, c.top.y - MANTLE_UP);
}

/** How long a climb up (or down) tower `c` takes. */
function climbSeconds(c: ClimbTower): number {
  return CLIMB_STEP_S * 2 + rungsTop(c) / CLIMB_SPEED + MANTLE_S;
}

/**
 * Where a climb up `c` has got to `t` seconds in (a climb down runs it
 * backwards), floor-local, and how the agent holds itself: stepping up to the
 * ladder; on the `rungs`, hand over hand (`travel` how far up); pulling up
 * onto the platform (`mantle`, `travel` 0 to 1 through it), moved along the
 * pull's own straight line (pipeRig.ts's MANTLE_*); then stepping out
 * under the pipe, turning to face out (`perch`).
 */
function climbAt(c: ClimbTower, t: number): { x: number; y: number; z: number; angle: number; mode: 'perch' | 'rungs' | 'mantle'; travel: number;
} {
  const high = rungsTop(c);
  const rise = high / CLIMB_SPEED;
  const ease = (k: number): number => k * k * (3 - 2 * k);
  if (t < CLIMB_STEP_S) {
    const k = ease(Math.max(0, t) / CLIMB_STEP_S);
    return { x: c.foot.x + (c.rungs.x - c.foot.x) * k, y: 0, z: c.foot.z + (c.rungs.z - c.foot.z) * k, angle: c.facing, mode: 'perch', travel: 0 };
  }
  if (t < CLIMB_STEP_S + rise) {
    const y = (t - CLIMB_STEP_S) * CLIMB_SPEED;
    return { x: c.rungs.x, y, z: c.rungs.z, angle: c.facing, mode: 'rungs', travel: y };
  }
  if (t < CLIMB_STEP_S + rise + MANTLE_S) {
    const k = (t - CLIMB_STEP_S - rise) / MANTLE_S;
    return { x: c.rungs.x + (c.ledge.x - c.rungs.x) * k, y: high + (c.top.y - high) * k, z: c.rungs.z + (c.ledge.z - c.rungs.z) * k, angle: c.facing, mode: 'mantle', travel: k };
  }
  const k = ease(Math.min(1, (t - CLIMB_STEP_S - rise - MANTLE_S) / CLIMB_STEP_S));
  return { x: c.ledge.x + (c.top.x - c.ledge.x) * k, y: c.top.y, z: c.ledge.z + (c.top.z - c.ledge.z) * k, angle: c.facing + angleTo(c.facing, c.out) * k, mode: 'perch', travel: 0 };
}

/** The shortest turn from angle `a` to `b`, in (-π, π]. */
function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** A WallBox shifted by a floor's own world-space origin — every placement function below (hidingSpotWallBox, laserTrapBox, rooms/doors) computes its box assuming a zero-origin floor (true for floor 0, not floor 1), so their result needs this before joining a non-zero-origin floor's own wallBoxes list. */
/** World position of a floor-local point, `height` above that floor — where to put a sound. */
function worldAt(floor: FloorRig, x: number, z: number, height = 1): { x: number; y: number; z: number } {
  return { x: x + floor.group.position.x, y: floor.group.position.y + height, z: z + floor.group.position.z };
}

/** A contract station dressed as a room, so the heist loop's task code (which works records-room workstations) works it: its screen's states are the prop's. */
function stationRoom(rig: StationRig): BuiltRoom {
  return {
    room: { kind: 'storage', x: 0, y: 0, cells: [], openDir: 'S', keyId: null, docs: 1 },
    group: rig.group,
    boxes: rig.boxes,
    interact: { ...rig.stand, facing: 0 }, // (the station's own facing is on its workstation: game.ts)
    // A records screen's 'ready' is locked red (the uplink up), 'idle' open for work, 'active' done.
    setState: (state) => rig.setState(state === 'active' ? 'done' : state === 'idle' ? 'ready' : 'idle'),
    glows: [],
    lockers: [],
    guardPost: null,
  };
}

function offsetBox(box: WallBox, dx: number, dz: number): WallBox {
  return { ...box, minX: box.minX + dx, maxX: box.maxX + dx, minZ: box.minZ + dz, maxZ: box.maxZ + dz };
}

/**
 * Populates one floor with a full set of gameplay content — security doors
 * and their terminal/server rooms, guarded storage rooms whose lockers hold
 * this floor's share of the job's documents, patrol bots, hiding spots,
 * laser traps, and decorative rooms. Called once per floor (floor 0 always; floor 1 too,
 * when a stair was successfully placed), each with its own maze/`used` set
 * so the two floors' content never collides with each other.
 *
 * Every static content mesh (rooms and their lockers, doors, hiding-spot
 * crates, laser beams) is parented to `floor.group`
 * itself rather than the shared root scene — its own transform (the
 * floor's world origin and height, see scene.ts's buildFloor) then places
 * everything correctly for free, since each mesh-building function already
 * computes a plain cell-index-scaled *local* position. Their matching
 * collision boxes (`hidingSpotWallBox` etc.) aren't parented to anything —
 * they're plain data — so `offsetBox()` shifts those by the floor's origin
 * before they join `floor.wallBoxes`.
 *
 * Bots are handled differently: they're dynamic (constantly repositioned
 * every frame via worldPos, checked against the player's own world
 * position for collision/detection/tracers), so parenting them to a
 * transformed group would double-apply the origin. They're added directly
 * to the shared root scene instead, constructed with fully-computed world
 * coordinates up front — see bots.ts's own originX/originZ, used only
 * internally for its pathfinding cell-index math, never for positioning.
 */
/** How many of a floor's patrol guards are the final level's white clones (set by startJob for operation 6, 0 elsewhere). */
let whitePerFloor = 0;

function populateFloor(
  root: SceneRoot,
  floor: FloorRig,
  cells: MazeCells,
  cols: number,
  rows: number,
  dist: number[][],
  used: Set<string>,
  diff: Difficulty,
  documentCount: number,
  /** The building's network rooms that go on this floor (security.ts). */
  network: ReadonlyArray<'uplink' | 'logs'>,
  route: { target: { x: number; y: number }; label: string },
  lifts: Array<{ x: number; y: number }> = [],
  script?: FloorScript,
  /** A way in this floor holds (entries.ts): the roof hatch upstairs, the tunnel grate on the ground floor. */
  spot?: { kind: 'hatch' } | { kind: 'grate'; exitDist: number },
  /** The contract's steps (objectives.ts) and which floor this is: their stations go in the big room and along the walls. */
  objective?: { plan: ObjectivePlan; floor: 0 | 1 } | null
): FloorContent {
  const originX = floor.group.position.x;
  const originY = floor.group.position.y;
  const originZ = floor.group.position.z;
  let whiteLeft = whitePerFloor;
  const patrolProfile = (): BotProfile | undefined => (whiteLeft-- > 0 ? 'white' : undefined);

  // Security layout first, so doors and rooms get first pick of cells (dead
  // ends especially) before leads/bots/crates claim them. Each floor's
  // spawn is its own (0,0): the job start on floor 0, the stair landing on
  // floor 1.
  const plan =
    script?.plan ??
    planSecurity(
      cells,
      cols,
      rows,
      dist,
      { x: 0, y: 0 },
      used,
      {
        doors: diff.doors,
        storage: documentCount,
        decor: diff.decorRooms,
        chain: diff.chainedDoors,
        network,
        // The way in this floor holds (entries.ts), picked where no locked door seals it off (security.ts):
        // an agent coming in there must never be shut inside a section whose terminal is outside it.
        entry:
          spot?.kind === 'hatch'
            ? (unsealed, taken) => roofHatch(cells, cols, rows, dist, taken, unsealed)
            : spot?.kind === 'grate'
              ? (unsealed, taken) => tunnelGrate(cells, cols, rows, dist, taken, spot.exitDist, unsealed)
              : undefined,
      },
      floor.theme.decorKinds
    );
  const navCells = navCellsFor(cells, plan.doors, cols, rows);
  // The way in (picked in planSecurity, whichever is chosen, so the building never changes with it), and around
  // the roof hatch a few steps where no guard or crate goes down: the quiet way in.
  const entrySpot = plan.entry ?? null;
  if (entrySpot && spot?.kind === 'hatch') {
    for (const c of withinSteps(cells, cols, rows, entrySpot.x, entrySpot.y, ROOF_QUIET_CELLS)) used.add(`${c.x},${c.y}`);
  }
  // The ceiling's pipes and the towers up to them (pipes.ts), on every job: the towers take their dead ends before
  // crates, lockers and the rest do, and only where no locked door seals them off.
  const basePipes = script ? (script.pipes ?? null) : diff.pipes ? planPipes(cells, cols, rows, dist, used, 2, (x, y) => plan.section[y]?.[x] === -1) : null;
  // A pipe over every records room, the uplink and the log room too, so a grapple line can be lowered onto their consoles.
  const pipePlan =
    basePipes && !script
      ? reachSpots(
          basePipes,
          plan.rooms.filter((r) => (r.kind === 'storage' && r.docs > 0) || r.kind === 'uplink' || r.kind === 'logs').map((r) => ({ x: r.x, y: r.y })),
          cols,
          rows
        )
      : basePipes;
  const doors: DoorRig[] = [];
  const doorBoxes = new Map<DoorRig, WallBox>();
  for (const d of plan.doors) {
    const rig = buildDoor(d, KEY_COLORS[d.id]!);
    floor.group.add(rig.group);
    const box = offsetBox(rig.box, originX, originZ);
    floor.wallBoxes.push(box);
    doorBoxes.set(rig, box);
    doors.push(rig);
  }
  const rooms: BuiltRoom[] = [];
  const roomDoors: FloorContent['roomDoors'] = [];
  const terminals: Terminal[] = [];
  const servers: ServerConsole[] = [];
  const storage: StorageRoom[] = [];
  const lockers: Locker[] = [];
  const workstations: Workstation[] = [];
  let uplink: Uplink | null = null;
  let logServer: LogServer | null = null;
  const enemies: Enemy[] = [];
  const spawners = new Map<Enemy, () => Enemy>();
  const spawn = (make: () => Enemy): void => {
    const e = make();
    spawners.set(e, make);
    enemies.push(e);
  };
  for (const room of plan.rooms) {
    const built = buildRoom(room, room.keyId === null ? null : KEY_COLORS[room.keyId]!, floor.theme.wall, floor.theme.edge.kind);
    floor.group.add(built.group);
    for (const b of built.boxes) floor.wallBoxes.push(offsetBox(b, originX, originZ));
    // Every room gets a door in its mouth, shut until something comes to it: a place to hide, or to work out of sight. (A room with a
    // sentry at its post inside is held open by the sentry.) A terminal's or a server's door carries the key's colour.
    if (!script) {
      const outer = room.cells[room.cells.length - 1]!;
      const rig = buildDoor({ id: -1, x: outer.x, y: outer.y, dir: room.openDir }, room.keyId === null ? 0x7fb2d9 : KEY_COLORS[room.keyId]!, { span: DOORWAY_W, frame: false, openS: 0.45, closedLight: 0x35b8e0, openLight: 0x4ee08a });
      floor.group.add(rig.group);
      const box = offsetBox(rig.box, originX, originZ);
      floor.wallBoxes.push(box);
      roomDoors.push({ rig, box, state: SHUT });
    }
    rooms.push(built);
    // Each kind of working room has its own hue on the floor and the walls round it: green terminals, cyan servers, amber records.
    const roomHue = ROOM_HUES[room.kind];
    if (roomHue !== undefined) floor.setZone(room.cells, roomHue);
    if (room.keyId !== null && built.interact) {
      if (room.kind === 'terminal') terminals.push({ keyId: room.keyId, room: built, ...built.interact, progress: 0, hacked: false });
      else if (room.kind === 'server') servers.push({ keyId: room.keyId, room: built, ...built.interact, online: false });
    }
    if (room.kind === 'uplink' && built.interact) uplink = { room: built, ...built.interact, progress: 0, online: true, restored: false };
    if (room.kind === 'logs' && built.interact) logServer = { room: built, ...built.interact, progress: 0, pending: 0, deadline: 0 };
    if (room.kind === 'storage') {
      const section = plan.section[room.y]![room.x]!;
      storage.push({ built, section });
      for (const l of built.lockers) lockers.push({ ...l, section });
      if (built.interact && room.docs > 0) workstations.push({ room: built, ...built.interact, progress: 0, files: room.docs, captured: false });
    }
    // A sentry holds the doorway of each records room and the log room: it blocks the way in until it's
    // drawn off (a flare) or disabled (the stun gun).
    if ((room.kind === 'storage' || room.kind === 'logs') && built.guardPost && !diff.silent) {
      const gx = built.guardPost.x + originX;
      const gz = built.guardPost.z + originZ;
      const facing = (room.kind === 'storage' ? script?.sentryFacing : undefined) ?? built.guardPost.facing;
      spawn(() => {
        const sentry = new Bot(root.scene, gx, gz, originX, originY, originZ);
        sentry.setPost(gx, gz, facing);
        return sentry;
      });
    }
  }
  // The floor's landmark: the one big open room, dressed for the place (layouts.ts, landmarks.ts).
  const lm = script ? null : landmarkOf(cells);
  const lmSpots: LandmarkSpot[] = [];
  if (lm) {
    const built = buildLandmark(lm);
    floor.group.add(built.group);
    for (const b of built.boxes) floor.wallBoxes.push(offsetBox(b, originX, originZ));
    lmSpots.push(...built.spots);
  }
  // The contract's stations (objectives.ts): on the big room's back wall where a step wants the big room, else a console against a corridor wall.
  const stations: StationRuntime[] = [];
  const skippedSteps: string[] = [];
  const addStation = (step: Step, at: StationPlacement): void => {
    const rig = buildStation(step.kind, at, step.letter ? { letter: step.letter } : {});
    floor.group.add(rig.group);
    for (const b of rig.boxes) floor.wallBoxes.push(offsetBox(b, originX, originZ));
    const runtime: StationRuntime = { step, rig, floorIdx: objective?.floor ?? 0 };
    stations.push(runtime);
    workstations.push({ room: stationRoom(rig), x: rig.stand.x, z: rig.stand.z, facing: at.facing + Math.PI, progress: 0, files: 1, captured: false, step: runtime }); // the stand is in front of the prop: it is faced from the other way
    rig.setState('idle');
  };
  if (objective && !script) {
    const mine = objective.plan.steps.filter((st) => st.floor === objective.floor && st.kind !== 'keycard');
    const wall = placeStaffLockers(cells, cols, rows, used, mine.length + 1).map((w): StationPlacement => {
      const [dx, dz] = DIR_DELTA[w.wall];
      const back = CELL / 2 - WALL_T / 2 - 0.4;
      return { x: w.x * CELL + dx * back, z: w.y * CELL + dz * back, facing: Math.atan2(-dx, -dz) };
    });
    for (const st of mine) {
      const at = st.where === 'landmark' ? (lmSpots.shift() ?? wall.shift()) : (wall.shift() ?? lmSpots.shift());
      if (at) addStation(st, at);
      else skippedSteps.push(st.id);
    }
  }
  let documents =
    plan.rooms.reduce((n, r) => n + r.docs, 0) + stations.filter((st) => st.step.unit && st.step.kind !== 'keycard').length + (objective?.plan.carrier && objective.floor === 0 ? 1 : 0);

  // A scripted floor places its guards and dogs by hand, and nothing else.
  for (const g of script?.guards ?? []) {
    const gx = g.x * CELL + originX;
    const gz = g.y * CELL + originZ;
    spawn(() => {
      const guard = new Bot(root.scene, gx, gz, originX, originY, originZ);
      guard.setPost(gx, gz, g.facing);
      if (g.paceTo) guard.setPace(g.paceTo.x * CELL + originX, g.paceTo.y * CELL + originZ);
      return guard;
    });
  }
  for (const h of script?.heavies ?? []) {
    const hx = h.x * CELL + originX;
    const hz = h.y * CELL + originZ;
    spawn(() => {
      const heavy = new Bot(root.scene, hx, hz, originX, originY, originZ, 'heavy');
      heavy.setPost(hx, hz, h.facing);
      return heavy;
    });
  }
  (script?.patrols ?? []).forEach((p, i) =>
    spawn(() => {
      const guard = new Bot(root.scene, p.x * CELL + originX, p.y * CELL + originZ, originX, originY, originZ, patrolProfile());
      const round = script?.rounds?.[i];
      if (round) guard.setRoute(round);
      return guard;
    })
  );
  for (const d of script?.dogs ?? [])
    spawn(() => {
      const dog = new Watchdog(root.scene, d.x * CELL + originX, d.y * CELL + originZ, originX, originY, originZ);
      if (d.zone) dog.setZone(d.zone);
      return dog;
    });
  for (const a of script?.alphas ?? [])
    spawn(() => {
      const alpha = new Alpha(root.scene, a.x * CELL + originX, a.y * CELL + originZ, originX, originY, originZ);
      if (a.zone) alpha.setZone(a.zone);
      return alpha;
    });
  for (const d of script?.drones?.at ?? [])
    spawn(() => new Drone(root.scene, d.x * CELL + originX, d.y * CELL + originZ, originX, originY, originZ, cols, rows, script!.drones!.area));
  const packs: WatchdogPack[] = [];
  for (const p of script?.packs ?? []) {
    const members = p.dogs.map((d) => {
      spawn(() => new Watchdog(root.scene, d.x * CELL + originX, d.y * CELL + originZ, originX, originY, originZ));
      return enemies[enemies.length - 1] as Watchdog;
    });
    packs.push(new WatchdogPack(members, p.meet, navCells, cols, rows, originX, originZ, p.roamS));
  }
  const randomEnemies = !script;

  // The job's patrol guards, each a good walk (SPAWN_MIN_CELLS) from the floor's own spawn
  // cell and from each other — placeBotSpawn reserves its cell in `used`
  // each call, so repeated calls don't overlap.
  for (let i = 0; randomEnemies && i < diff.guards; i++) {
    const botSpawn = placeBotSpawn(cols, rows, dist, used);
    if (botSpawn) enemies.push(new Bot(root.scene, botSpawn.x * CELL + originX, botSpawn.y * CELL + originZ, originX, originY, originZ, patrolProfile()));
  }

  // Patrols walk a beat: most legs head past the places the player has to go (patrol.ts) — the doorways of the
  // storage, server and terminal rooms, the stairs and the lifts — instead of anywhere in the building.
  if (randomEnemies) {
    const beat = [
      ...plan.rooms
        .filter((r) => r.kind === 'storage' || r.kind === 'server' || r.kind === 'terminal' || r.kind === 'uplink' || r.kind === 'logs')
        .map((r) => ({ x: r.x + DIR_DELTA[r.openDir][0], y: r.y + DIR_DELTA[r.openDir][1] })),
      // Guards walk past the contract's stations too, so a plant or a swap is done with a patrol about to come round.
      ...stations.map((st) => ({ x: Math.round(st.rig.stand.x / CELL), y: Math.round(st.rig.stand.z / CELL) })),
      route.target,
      ...lifts,
    ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows);
    for (const e of enemies) if (e instanceof Bot && e.kind === 'patrol') e.setBeat(beat);
  }

  // The keycard (a swap or a vault) is carried by one of the patrol guards on the ground floor; with no patrol to take it from, a card reader on a wall stands in.
  let carrier: Bot | null = null;
  if (objective?.plan.carrier && objective.floor === 0 && randomEnemies) {
    carrier = (enemies.find((e) => e instanceof Bot && e.kind === 'patrol') as Bot | undefined) ?? null;
    if (!carrier) {
      const desk = objective.plan.steps.find((st) => st.kind === 'keycard');
      const w = desk ? placeStaffLockers(cells, cols, rows, used, 1)[0] : undefined;
      if (desk && w) {
        const [dx, dz] = DIR_DELTA[w.wall];
        const back = CELL / 2 - WALL_T / 2 - 0.4;
        addStation(desk, { x: w.x * CELL + dx * back, z: w.y * CELL + dz * back, facing: Math.atan2(-dx, -dz) });
      } else if (desk) {
        skippedSteps.push(desk.id);
        documents -= 1; // nowhere to put a card reader: the keycard is taken as given
      }
    }
  }

  // Heavy enforcers hold the doorways of server rooms.
  const serverPosts = rooms.filter((r) => r.room.kind === 'server' && r.guardPost).slice(0, randomEnemies ? diff.heavies : 0);
  for (const r of serverPosts) {
    const post = r.guardPost!;
    const heavy = new Bot(root.scene, post.x + originX, post.z + originZ, originX, originY, originZ, 'heavy');
    heavy.setPost(post.x + originX, post.z + originZ, post.facing);
    enemies.push(heavy);
  }

  // Crawler mines lie dormant in the corridors.
  for (let i = 0; randomEnemies && i < diff.crawlers; i++) {
    const spawn = placeBotSpawn(cols, rows, dist, used);
    if (spawn) enemies.push(new Crawler(root.scene, spawn.x * CELL + originX, spawn.y * CELL + originZ, originX, originY, originZ));
  }

  // Alpha units prowl too: they hunt by ear and by scent, howl, run you down and go off (alpha.ts).
  for (let i = 0; randomEnemies && i < diff.alphas; i++) {
    const spawn = placeBotSpawn(cols, rows, dist, used);
    if (spawn) enemies.push(new Alpha(root.scene, spawn.x * CELL + originX, spawn.y * CELL + originZ, originX, originY, originZ));
  }

  // Drones sweep the floor from above the walls.
  for (let i = 0; randomEnemies && i < diff.drones; i++) {
    const spawn = placeBotSpawn(cols, rows, dist, used);
    if (spawn) enemies.push(new Drone(root.scene, spawn.x * CELL + originX, spawn.y * CELL + originZ, originX, originY, originZ, cols, rows));
  }

  // Watchdogs: they roam and hunt by ear, and only an EMP stops them. Two or
  // more on a floor hunt as a pack, regrouping every so often at a meeting
  // point central to them — reserved, so no crate or laser lands on it.
  const dogs: Watchdog[] = [];
  let packGround: number[][] | null = null; // walking distance from the first dog: the rest start a few cells off, on ground it can reach
  for (let i = 0; randomEnemies && i < diff.watchdogs; i++) {
    const near = packGround;
    const spawn = (near && placeBotSpawn(cols, rows, dist, used, (x, y) => near[y]![x]! >= 3 && near[y]![x]! <= PACK_RANGE_CELLS)) ?? placeBotSpawn(cols, rows, dist, used);
    if (!spawn) continue;
    packGround ??= bfs(navCells, cols, rows, spawn.x, spawn.y);
    const dog = new Watchdog(root.scene, spawn.x * CELL + originX, spawn.y * CELL + originZ, originX, originY, originZ);
    enemies.push(dog);
    dogs.push(dog);
  }
  if (dogs.length >= 2) {
    // Only dogs that can reach one another (a locked door can split the floor) make up the pack.
    const cellOf = (d: Watchdog) => ({ x: Math.round((d.worldX - originX) / CELL), y: Math.round((d.worldZ - originZ) / CELL) });
    let members: Watchdog[] = [];
    for (const lead of dogs) {
      const from = cellOf(lead);
      const reach = bfs(navCells, cols, rows, from.x, from.y);
      const group = dogs.filter((d) => reach[cellOf(d).y]![cellOf(d).x]! >= 0);
      if (group.length > members.length) members = group;
    }
    const point =
      members.length >= 2
        ? meetingPoint(navCells, cols, rows, members.map(cellOf), (x, y) => used.has(`${x},${y}`) || dist[y]![x]! < 4)
        : null;
    if (point) {
      used.add(`${point.x},${point.y}`);
      packs.push(new WatchdogPack(members, point, navCells, cols, rows, originX, originZ));
    }
  }

  // A few crates to duck behind — guaranteed cover, unlike sneaking (which
  // only shrinks detection range) or corners (which only work if the bot
  // isn't already looking your way).
  // Each place leans on a different way to hide a body: how many of each kind a floor has, and what each is (hideouts.ts).
  const hide = HIDEOUTS[planPlace ?? 'campus'];
  const hideN = hideCounts(diff, hide);
  const hidingSpots = script?.crates ?? placeHidingSpots(cols, rows, dist, used, hideN.crates);
  const crates: CratePairRig[] = [];
  for (const spot of hidingSpots) {
    const pair = buildHidingSpotMesh(spot.x, spot.y, script ? undefined : hide.crates);
    crates.push(pair);
    floor.group.add(pair.group);
    floor.wallBoxes.push(offsetBox(hidingSpotWallBox(spot), originX, originZ));
  }

  // Laser trip-beams — block a straight corridor entirely while standing,
  // pass through freely while sneaking (Left Shift). Kept separate from
  // floor.wallBoxes (lasers.ts) since a bot's own line of sight and the
  // torch's floor-reveal shouldn't be blocked by a thin beam the way they
  // are by a real wall — player.ts's tick() checks these on its own.
  const laserTraps = script?.lasers ?? placeLaserTraps(cols, rows, cells, dist, used, diff.lasers);
  const laserBoxes: WallBox[] = [];
  for (const t of laserTraps) {
    floor.group.add(buildLaserMesh(t));
    laserBoxes.push(offsetBox(laserTrapBox(t), originX, originZ));
  }
  // Moving lasers, on later jobs: they catch you rather than block you (the game loop's tickMovingLasers).
  const sweepers = (script ? (script.sweepers ?? []) : placeSweepers(cells, cols, rows, dist, used, diff.sweepers)).map((laser) => {
    const rig = buildSweeperMesh(laser);
    // Its post stands in the middle of the junction, right where you walk: it doesn't block (you'd jam on it head-on).
    floor.group.add(rig.group);
    return { laser, rig };
  });
  const sliders = (script ? (script.sliders ?? []) : placeSliders(cells, cols, rows, dist, used, diff.sliders, 4, diff.fastSliders)).map((laser) => {
    const rig = buildSliderMesh(laser);
    floor.group.add(rig.group);
    return { laser, rig };
  });
  // Line lasers (linelasers.ts): single beams that rise and fall or sweep across a corridor, from job 2.
  const lines = (script ? (script.lines ?? []) : placeLines(cells, cols, rows, dist, used, diff.lines, diff.lineSize)).map((laser) => {
    const rig = buildLineMesh(laser);
    floor.group.add(rig.group);
    return { laser, rig };
  });
  // Laser gates (evade.ts): beams a cloak does nothing about, on every job. An extraction can't offer a crawl (the specimen keeps your hands full).
  const gateKinds: GateKind[] = objective?.plan.contract === 'extract' ? ['duck', 'pulse'] : ['duck', 'crawl', 'pulse'];
  const gates = (script ? (script.gates ?? []) : placeGates(cells, cols, rows, dist, used, diff.gates, gateKinds)).map((gate) => {
    const rig = buildGateMesh(gate);
    floor.group.add(rig.group);
    return { gate, rig };
  });
  // Timed shutters, on later jobs: shut to everything until a panel's hacked, and never open to guards.
  const shutters: Shutter[] = (script ? (script.shutters ?? []) : placeShutters(cells, cols, rows, dist, used, diff.shutters)).map((plan) => {
    const rig = buildShutter(plan);
    floor.group.add(rig.group);
    const box = offsetBox(rig.box, originX, originZ);
    floor.wallBoxes.push(box);
    setPassage(navCells, { id: -1, x: plan.x, y: plan.y, dir: plan.dir }, false, cols, rows);
    return { plan, rig, box, walls: floor.wallBoxes, openedAt: null };
  });

  // Staff lockers to hide in, and vents that short-cut a long way round.
  const staffLockers = (script?.staffLockers ?? placeStaffLockers(cells, cols, rows, used, hideN.staffLockers)).map((spot) => {
    const rig = buildStaffLocker(spot.x, spot.y, spot.wall, script ? undefined : hide.locker);
    floor.group.add(rig.group);
    floor.wallBoxes.push(offsetBox(rig.box, originX, originZ));
    return { rig, cell: { x: spot.x, y: spot.y } };
  });
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
  // Every console a hover can work has a pipe over its cell too (the hover swings the last stretch): the contract's stations and the terminals, as well as the records rooms,
  // the uplink and the log room planned above.
  const consoleCells = [...stations.map((st) => ({ x: Math.round(st.rig.stand.x / CELL), y: Math.round(st.rig.stand.z / CELL) })), ...terminals.map((t) => ({ x: Math.round(t.x / CELL), y: Math.round(t.z / CELL) }))];
  const hoverPipes = pipePlan && !script ? reachSpots(pipePlan, consoleCells, cols, rows) : pipePlan;
  const pipeRig = hoverPipes ? buildPipes(floor.group, hoverPipes, CELL, TALL_FLOOR_HEIGHT, floor.wallBoxes, { x: originX, z: originZ }) : null;
  const vents = (script ? [] : placeVents(cells, cols, rows, plan.section, used, hideN.vents)).map((v) => {
    const a = buildVentGrille(v.a.x, v.a.y, v.side, hide.vent);
    const b = buildVentGrille(v.b.x, v.b.y, OPPOSITE[v.side], hide.vent);
    floor.group.add(a.group, b.group);
    return { ends: [a, b] as [VentRig, VentRig], cells: [v.a, v.b] as [{ x: number; y: number }, { x: number; y: number }] };
  });

  // Patrols stop now and then beside a place to hide, with their back to it (patrol.ts): beside a staff locker, beside a crate pair; the tower's floors say theirs (towerLingers).
  const lingers: Linger[] = [...(script?.lingers ?? [])];
  if (!script) {
    for (const l of staffLockers) lingers.push({ x: l.cell.x, y: l.cell.y, facing: l.rig.front.facing });
    for (const spot of hidingSpots) {
      const open = (['S', 'E', 'N', 'W'] as const).find((d) => navCells[spot.y]?.[spot.x]?.[d]);
      if (open) lingers.push({ x: spot.x + DIR_DELTA[open][0], y: spot.y + DIR_DELTA[open][1], facing: Math.atan2(DIR_DELTA[open][0], DIR_DELTA[open][1]) });
    }
  }
  if (lingers.length > 0) for (const e of enemies) if (e instanceof Bot && e.kind === 'patrol') e.setLingers(lingers);

  // Last, so clutter only goes in cells nothing else claimed.
  const clutter = decorateFloor({ rig: floor, cells, cols, rows, used, doors: plan.doors, rooms: plan.rooms, lasers: laserTraps, routeTarget: route.target, routeLabel: route.label, lifts, plain: script?.plain === true });
  for (const c of clutter) floor.wallBoxes.push(offsetBox(c.box, originX, originZ));
  const props = clutter.map((c) => ({ ...c, worldX: c.x + originX, worldZ: c.z + originZ, disabled: false }));
  const lights = floor.fixtures.map((f) => ({ worldX: f.light.position.x + originX, worldZ: f.light.position.z + originZ, disabled: false, light: f.light, mesh: f.mesh }));

  const laserCells = laserTraps.map((t) => ({ x: t.x, y: t.y }));
  // Blackouts (blackout.ts): every light inside one is dead — ceiling fixtures (which then count as shot out, so
  // there's nothing to aim at and guards see less far) and room lights alike. Lasers keep their own glow.
  const dark = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  if (script) for (const c of script.dark ?? []) dark[c.y]![c.x] = true;
  else planBlackouts(cells, cols, rows, dist, diff.blackouts, diff.blackoutCells).forEach((row, y) => row.forEach((d, x) => (dark[y]![x] = d)));
  floor.group.updateMatrixWorld(true);
  const at = new THREE.Vector3();
  const lamps: Lamp[] = [];
  floor.group.traverse((o) => {
    if (!(o instanceof THREE.PointLight) || o.userData.keepInDark) return;
    o.getWorldPosition(at);
    const fixture = lights.find((l) => l.light === o) ?? null;
    const bulb = fixture ? (fixture.mesh.material as THREE.MeshStandardMaterial) : null;
    lamps.push({
      light: o,
      base: o.intensity,
      bulb,
      bulbBase: bulb?.emissiveIntensity ?? 0,
      fixture,
      cell: { x: Math.round((at.x - originX) / CELL), y: Math.round((at.z - originZ) / CELL) },
      broken: false,
      off: false,
      cut: false,
    });
  });
  for (const l of lamps) {
    if (!dark[l.cell.y]?.[l.cell.x]) continue;
    l.broken = true;
    applyLamp(l);
  }

  // Light switches (power.ts): one on a wall by each corridor light, and one inside the doorway of each lit room.
  // Breaker panels from job 10, one per wiring circuit. Not on the hand-made training floor.
  const fittings: PowerFitting[] = [];
  const fit = (kind: PowerFitting['kind'], rig: PowerFittingRig, cell: { x: number; y: number }, controls: Lamp[], circuit = -1, label = ''): void => {
    floor.group.add(rig.group);
    rig.setOn(true);
    fittings.push({ kind, rig, cell, lamps: controls, on: true, circuit, label, reset: 'none', dispatchAt: 0, comingSince: 0, resetting: 0 });
  };
  // Not where a switch would end up behind a staff locker, a vent grille, or inside a lift.
  const propAt = new Set([...staffLockers.map((s) => s.cell), ...vents.flatMap((v) => v.cells), ...lifts].map((c) => `${c.x},${c.y}`));
  let circuit: number[][] | null = null;
  // The hand-made floor has only the switches its lessons use.
  for (const sw of script?.switches ?? []) {
    const lamp = lamps.find((l) => l.fixture && l.cell.x === sw.x && l.cell.y === sw.y);
    if (lamp) fit('switch', buildLightSwitch(sw.x, sw.y, sw.wall), { x: sw.x, y: sw.y }, [lamp]);
  }
  if (!script) {
    for (const lamp of lamps) {
      if (!lamp.fixture || lamp.broken || propAt.has(`${lamp.cell.x},${lamp.cell.y}`)) continue;
      const wall = wallFor(cells, lamp.cell.x, lamp.cell.y);
      if (wall) fit('switch', buildLightSwitch(lamp.cell.x, lamp.cell.y, wall), lamp.cell, [lamp]);
    }
    for (const built of rooms) {
      const inside = new Set(built.room.cells.map((c) => `${c.x},${c.y}`));
      const roomLamps = lamps.filter((l) => !l.fixture && !l.broken && inside.has(`${l.cell.x},${l.cell.y}`));
      const { x, y, openDir } = built.room;
      // On a side wall just inside the doorway, clear of the furniture along the back.
      const wall = (['N', 'E', 'S', 'W'] as const).find((d) => d !== openDir && d !== OPPOSITE[openDir] && !cells[y]![x]![d]);
      if (roomLamps.length && wall) fit('switch', buildLightSwitch(x, y, wall), { x, y }, roomLamps);
    }
    if (diff.breakers > 0) {
      const plan = planCircuits(cells, cols, rows, diff.breakers);
      circuit = plan.circuit;
      plan.seeds.forEach((seed, k) => {
        const spot = breakerSpot(cells, cols, rows, plan.circuit, k, seed, used);
        if (!spot) return;
        used.add(`${spot.x},${spot.y}`);
        const label = String(k + 1);
        const wired = lamps.filter((l) => plan.circuit[l.cell.y]?.[l.cell.x] === k);
        fit('breaker', buildBreaker(spot.x, spot.y, spot.wall, label, 0xe0bd6c), spot, wired, k, label);
      });
    }
  }

  return {
    parent: floor.group,
    cells,
    navCells,
    cols,
    rows,
    section: plan.section,
    doors,
    doorBoxes,
    roomDoors,
    terminals,
    servers,
    rooms,
    storage,
    lockers,
    documents,
    workstations,
    stations,
    carrier,
    skippedSteps,
    uplink,
    logServer,
    entrySpot,
    dark,
    lamps,
    fittings,
    circuit,
    powerCut: Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false)),
    enemies,
    packs,
    hidingSpots,
    crates,
    laserBoxes,
    laserCells,
    sweepers,
    sliders,
    lines,
    gates,
    shutters,
    staffLockers,
    vents,
    pipes: hoverPipes,
    pipeRig,
    props,
    lights,
    spawners,
  };
}

/** The training floor's hand-placed content, read off its map (tutorial.ts). */
function trainingScript(layout: TrainingLayout): FloorScript {
  const { cells, cols, rows, marks } = layout;
  const openDir = (p: { x: number; y: number }): Dir => (['N', 'S', 'E', 'W'] as const).find((d) => cells[p.y]![p.x]![d])!;
  const room = (kind: Room['kind'], p: { x: number; y: number }, keyId: number | null, extra: Partial<Room> = {}): Room => ({
    kind,
    x: p.x,
    y: p.y,
    cells: [p],
    openDir: openDir(p),
    keyId,
    docs: 0,
    ...extra,
  });
  // Each door faces into the section it seals: the side the lift can't reach while it's shut.
  const shut = navCellsFor(cells, layout.doors, cols, rows);
  const fromLift = bfs(shut, cols, rows, 0, 0);
  const doors = layout.doors.map((d) =>
    fromLift[d.y]![d.x]! >= 0 ? d : { id: d.id, x: d.x + DIR_DELTA[d.dir][0], y: d.y + DIR_DELTA[d.dir][1], dir: OPPOSITE[d.dir] }
  );
  const section = fromLift.map((row) => row.map(() => -1));
  for (const d of doors) {
    const beyond = bfs(shut, cols, rows, d.x + DIR_DELTA[d.dir][0], d.y + DIR_DELTA[d.dir][1]);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (beyond[y]![x]! >= 0 && fromLift[y]![x]! < 0) section[y]![x] = d.id;
  }
  const laser = marks.L!;
  const lockerWall = (p: { x: number; y: number }): Dir => (['E', 'W', 'N', 'S'] as const).find((d) => !cells[p.y]![p.x]![d])!;
  return {
    plan: {
      doors,
      rooms: [
        room('office', marks.o!, null),
        room('terminal', marks.t!, 0),
        room('server', marks.s!, 0),
        room('storage', marks.$!, null, { docs: 1, stock: ['loot', 'loot'] }),
        // The network closet and the log room, for the heist's order (sequence.ts): uplink down, file, logs, out.
        room('uplink', marks.u!, null),
        room('logs', marks.l!, null),
      ],
      section,
    },
    guards: [{ ...marks.g!, facing: Math.PI / 2 }], // facing east, down the hall: its back to you as you come
    patrols: [marks.p!],
    dogs: [marks.d!],
    drones: { at: [marks.q!], area: TRAINING_DRONE_YARD },
    packs: [{ dogs: layout.packDogs, meet: marks.M!, roamS: TRAINING_PACK_ROAM_S }],
    crates: [marks.c!, marks.b!],
    lasers: [{ ...laser, spanX: cells[laser.y]![laser.x]!.N }],
    staffLockers: [marks.h!, marks.k!, marks.e!].map((p) => ({ ...p, wall: lockerWall(p) })),
    // The storage sentry watches the hall toward the exit, its back to the way you come in, so there's
    // a safe spot to throw a flare from. Facing out of its doorway, it would see you at the corner.
    sentryFacing: Math.PI / 2,
    dark: [...TRAINING_BLACKOUT],
    switches: TRAINING_SWITCHES,
  };
}

/** The ceiling course's floor (tutorial.ts's CEILING_*): the moving lasers, two towers and their pipes, and the walled-in guard. */
function ceilingScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: [CEILING_GUARD],
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
    sweepers: CEILING_SWEEPERS.map((s) => ({ ...s })),
    sliders: CEILING_SLIDERS.map((s) => ({ ...s })),
    shutters: CEILING_SHUTTERS,
    pipes: CEILING_PIPES,
  };
}

/** The grapple course's floor (tutorial.ts's GRAPPLE_*): the pipes, the guard shut in its pocket, and a records room with its sentry. */
function grappleScript(layout: TrainingLayout): FloorScript {
  const p = layout.marks.$!;
  const openDir = (['N', 'S', 'E', 'W'] as const).find((d) => layout.cells[p.y]![p.x]![d])!;
  return {
    plan: {
      doors: [],
      rooms: [{ kind: 'storage', x: p.x, y: p.y, cells: [p], openDir, keyId: null, docs: 1, stock: ['loot', 'loot'] }],
      section: layout.cells.map((row) => row.map(() => -1)),
    },
    guards: [GRAPPLE_GUARD],
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
    // The sentry watches the hall away from where you come in, so it has its back to you.
    sentryFacing: -Math.PI / 2,
    pipes: GRAPPLE_PIPES,
  };
}

/** The dock yard's floor (yardplan.ts): its guards, patrols and dogs, the crate pairs among the containers, and the port office's records room. */
function dockScript(layout: TrainingLayout, plan: YardPlanData): FloorScript {
  const p = layout.marks.$!;
  const openDir = (['N', 'S', 'E', 'W'] as const).find((d) => layout.cells[p.y]![p.x]![d])!;
  return {
    plan: {
      doors: [],
      rooms: [{ kind: 'storage', x: p.x, y: p.y, cells: [p], openDir, keyId: null, docs: 1, stock: ['loot', 'loot'] }],
      section: layout.cells.map((row) => row.map(() => -1)),
    },
    guards: plan.guards.map((g) => ({ ...g })),
    patrols: plan.patrols.map((g) => ({ ...g })),
    dogs: plan.dogs.map((g) => ({ ...g })),
    packs: [],
    crates: plan.crates.map((c) => ({ ...c })),
    lasers: [],
    staffLockers: [],
  };
}


/** The way out of a first level played backwards: one lesson, said once, ended by the lift (or the gate). The checkpoint is set where the run starts (game.ts). */
const OUT_STATIONS: readonly Station[] = [
  {
    title: 'Get out',
    keys: 'The alarm is up and they are coming for you. You start where you left, and the way out is where you came in: down every floor to the lift you rode in on (or, in a yard, across it to the gate). Enemies come in waves, and being seen costs nothing: being hit does.',
    touch: 'The alarm is up and they are coming for you. You start where you left, and the way out is where you came in: down every floor to the lift you rode in on (or, in a yard, across it to the gate). Enemies come in waves, and being seen costs nothing: being hit does.',
    done: () => false,
    checkpoint: { x: 0, y: 0 },
  },
];

/** One storey of the bunker (bunkerplan.ts, docs/levels/bunker.md): its sentries on their posts, its patrols on their rings, its dogs, its alphas and its lasers. */
function bunkerScript(layout: TrainingLayout, level: number): FloorScript {
  const mask = (r: Rect): number[][] => layout.cells.map((row, y) => row.map((_, x) => (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 ? 0 : -1)));
  const pack = packOn(level);
  const patrols = patrolsOn(level);
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: postsOn(level).map((p) => ({ ...p })),
    patrols: patrols.map((p) => ({ x: p.x, y: p.y })),
    rounds: patrols.map((p) => p.round.map((c) => ({ ...c }))),
    dogs: dogsOn(level).map((d) => ({ x: d.x, y: d.y, zone: mask(d.zone) })),
    alphas: alphasOn(level).map((a) => ({ x: a.x, y: a.y, zone: mask(a.zone) })),
    packs: pack ? [{ dogs: pack.dogs.map((d) => ({ ...d })), meet: { ...pack.meet }, roamS: pack.roamS }] : [],
    crates: [],
    lasers: [],
    staffLockers: [],
    sweepers: sweepersOn(level).map((s) => ({ ...s })),
    sliders: slidersOn(level).map((s) => ({ ...s })),
    gates: gatesOn(level).map((g) => ({ ...g })),
    lines: linesOn(level).map((l) => ({ ...l })),
    plain: true,
  };
}

/** The bunker's stations: a beacon and a checkpoint at each hall's mouth and each stair's head; the last has no beacon, the lift in the corner ends it. `floorNow` is the storey the agent is on. */
function bunkerStations(floorNow: () => number): Station[] {
  return BUNKER_STATIONS.map((s, i) => ({
    title: s.title,
    keys: s.text,
    touch: s.text,
    done: i === BUNKER_STATIONS.length - 1 ? () => false : (p) => floorNow() === s.goal.level && Math.abs(p.cell.x - s.goal.x) + Math.abs(p.cell.y - s.goal.y) <= 1,
    ...(i === BUNKER_STATIONS.length - 1 ? {} : { goal: { x: s.goal.x, y: s.goal.y } }),
    level: s.goal.level,
    checkpoint: { x: s.checkpoint.x, y: s.checkpoint.y },
    checkpointLevel: s.checkpoint.level,
  }));
}

/** One storey of the tower (towerplan.ts): its guards at their posts, its patrols on their rounds, its dog. */
/** The cells beside a sofa or a desk to crawl under, where patrols stop with their back to it: the nearest cell centre within a pace or two of each piece, facing away. */
function towerLingers(layout: TrainingLayout, level: number, setId: string): Linger[] {
  const out: Linger[] = [];
  for (const p of furnitureFor(level, setId as TowerSetId)) {
    if (!p.spec.crawl) continue;
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = 0; y < layout.cells.length; y++) {
      for (let x = 0; x < layout.cells[y]!.length; x++) {
        const c = layout.cells[y]![x]!;
        if (!(c.N || c.S || c.E || c.W) || towerBlocked(level, x, y)) continue;
        const d = Math.hypot(x * CELL - p.cx, y * CELL - p.cz);
        if (d < 1.2 || d > 2.9 || (best && d >= best.d)) continue;
        best = { x, y, d };
      }
    }
    if (best && !out.some((o) => o.x === best!.x && o.y === best!.y)) out.push({ x: best.x, y: best.y, facing: Math.atan2(best.x * CELL - p.cx, best.y * CELL - p.cz) });
  }
  return out;
}

function towerScript(layout: TrainingLayout, level: number, setId: string, noLasers = false): FloorScript {
  const rounds = TOWER_PATROLS.filter((p) => p.level === level);
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: TOWER_POSTS.filter((g) => g.level === level).map((g) => ({ x: g.x, y: g.y, facing: g.facing })),
    patrols: rounds.map((p) => ({ ...p.route[0]! })),
    rounds: rounds.map((p) => p.route.map((c) => ({ ...c }))),
    lingers: towerLingers(layout, level, setId),
    dogs: TOWER_DOGS.filter((d) => d.level === level).map((d) => {
      // The dog's own section: it roams there (a chase takes it anywhere).
      const zone = layout.cells.map((row) => row.map(() => -1));
      for (const c of sectionOf(level, d.x, d.y)) zone[c.y]![c.x] = 0;
      return { x: d.x, y: d.y, zone };
    }),
    alphas: TOWER_ALPHAS.filter((d) => d.level === level).map((d) => {
      const zone = layout.cells.map((row) => row.map(() => -1));
      for (const c of sectionOf(level, d.x, d.y)) zone[c.y]![c.x] = 0;
      return { x: d.x, y: d.y, zone };
    }),
    sweepers: noLasers ? [] : (TOWER_LASERS[level]?.sweepers ?? []).map((s) => ({ ...s })),
    sliders: noLasers ? [] : (TOWER_LASERS[level]?.sliders ?? []).map((s) => ({ ...s })),
    gates: noLasers ? [] : (TOWER_LASERS[level]?.gates ?? []).map((g) => ({ ...g })),
    lines: noLasers ? [] : (TOWER_LASERS[level]?.lines ?? []).map((l) => ({ ...l })),
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
    plain: true,
  };
}

/** The range's floor (tutorial.ts's RANGE_*): an open hall of still targets, nothing else. */
function rangeScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: RANGE_TARGETS.map((t) => ({ ...t })),
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
  };
}

/** The stealth course's floor (tutorial.ts's STEALTH_*): a hall with a sentry watching down it, and nothing else. */
function stealthScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: [STEALTH_GUARD],
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    // The laser gates (U to duck, V to crawl, W to wait out), in the hall past the dash.
    gates: (
      [
        ['U', 'duck', 0],
        ['V', 'crawl', 0],
        ['W', 'pulse', 0.1],
      ] as const
    ).flatMap(([mark, kind, phase]) => (layout.marks[mark] ? [{ ...layout.marks[mark]!, spanX: false, kind, phase }] : [])),
    staffLockers: [],
  };
}

/** The cover course's floor (tutorial.ts's COVER_*): a crate across the hall, and a guard shut in beyond it, his back to you until he's sent up the hall. */
function coverScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: [{ ...layout.marks.g!, facing: COVER_GUARD_FACING }],
    patrols: [],
    dogs: [],
    packs: [],
    crates: [layout.marks.c!,
      ...COVER_STATIONS.flatMap((st) => (st.enemy && st.goal ? [st.goal] : [])),
    ],
    lasers: [],
    staffLockers: [],
  };
}

/** The corners course's floor (tutorial.ts's CORNERS_*): a guard at the foot of a long hall round a corner, a tower over a second hall, and a second guard at its far end. */
function cornersScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: CORNERS_GUARDS.map((g) => ({ ...g })),
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
    pipes: CORNERS_PIPES,
  };
}

/** The wall course's floor (tutorial.ts's WALL_*): a corridor with two walls across it and a practice guard past each. */
function wallScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: WALL_GUARDS.map((g) => ({ ...g })),
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
  };
}

/** The high wall course's floor (tutorial.ts's HIGHWALL_*): a corridor with a tall wall along its south side (over which is a second corridor) and a practice guard under it near each end. */
function highwallScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: HIGHWALL_GUARDS.map((g) => ({ ...g })), // (on their posts: the pacing option is there (paceTo) but off, for now)
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
  };
}

/** The high wall course's tall wall: the north side of the corridor, from one column to another (scene.ts's `tall`, asked of each wall by its ends). */
const highwallTall = (x1: number, z1: number, x2: number, z2: number): boolean =>
  z1 === z2 && Math.abs(z1 - CELL / 2) < 1e-6 && (x1 + x2) / 2 >= HIGHWALL_COLUMNS.from * CELL - 0.01 && (x1 + x2) / 2 <= HIGHWALL_COLUMNS.to * CELL + 0.01;

/** The weapons course's floor (tutorial.ts's WEAPONS_*): two sentries with their backs to you, a heavy enforcer facing you, and a second, with its back to you, to trap. */
function weaponsScript(layout: TrainingLayout): FloorScript {
  return {
    plan: { doors: [], rooms: [], section: layout.cells.map((row) => row.map(() => -1)) },
    guards: [{ ...layout.marks.g!, facing: WEAPONS_SENTRY_FACING }, { ...layout.marks.G!, facing: WEAPONS_SENTRY_FACING }],
    heavies: [{ ...layout.marks.H!, facing: WEAPONS_HEAVY_FACING }, { ...layout.marks.K!, facing: WEAPONS_TRAP_HEAVY_FACING }],
    patrols: [],
    dogs: [],
    packs: [],
    crates: [],
    lasers: [],
    staffLockers: [],
  };
}

/** What the tower hands on to the heist: how the climb went. */
type Approach = { suspicion: number };
/** Suspicion at which the climb hands on a wary heist (alertstate.ts's CAUTION_ON): a close call on the way up. */
const CAUTION_ON_CARRY = 35;

/** A training course: the first, which everyone starts with; staying hidden and the grapple, offered after it and before a first job; or the ceiling, before job 8. */
type Course = 'basics' | 'ceiling' | 'grapple' | 'stealth' | 'weapons' | 'cover' | 'corners' | 'wall' | 'highwall' | 'dock' | 'range' | 'tower' | 'bunker';

/** How many times running the start-of-job recon has been skipped (this browser). */
function tourSkips(): number {
  try {
    return Number(window.localStorage.getItem(TOUR_SKIPS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setTourSkips(n: number): void {
  try {
    window.localStorage.setItem(TOUR_SKIPS_KEY, String(n));
  } catch {
    // Storage blocked: it just keeps playing.
  }
}

/** Skipped enough times running that the recon no longer plays by itself. */
function tourQuiet(): boolean {
  return tourSkips() >= TOUR_QUIET_AFTER;
}

/** Whether this browser has finished the grapple course. */
function grappleTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_GRAPPLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the stealth course. */
function stealthTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_STEALTH_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the weapons course. */
function weaponsTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_WEAPONS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the cover-fire course. */
function coverTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_COVER_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the corners course. */
function cornersTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_CORNERS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the high wall course. */
function highwallTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_HIGHWALL_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the wall course. */
function wallTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_WALL_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser has finished the ceiling course. */
function ceilingTrained(): boolean {
  try {
    return window.localStorage.getItem(TRAINED_CEILING_KEY) === '1';
  } catch {
    return false;
  }
}

/** Starts job `n`, or a training course (`course`; the ceiling is built with job `n`'s settings, job 8's). */
/** How near a watchdog comes before the first tip about them (world units). */
const DOG_HINT_DIST = 9;

/** The hue of each kind of working room's floor and walls (scene.ts's zones): where you are is also what colour you are standing in. */
const ROOM_HUES: Partial<Record<RoomKind, number>> = { terminal: 0x35d27a, server: 0x35b6ff, storage: 0xffb02e, uplink: 0x4a7dff, logs: 0xd23fff };

/** How a job's floors are laid out: like a building (halls with rooms off them), or the old maze (`?layout=maze` on localhost, to compare). */
let layoutStyle: 'building' | 'maze' = 'building';
/** The place the job being built is in, so its floors take that place's layouts (layouts.ts): each place has its own shape, and a big open room. */
let planPlace: LocationId | null = null;
const freshPlan = (cols: number, rows: number, floor = 0): MazeCells => {
  if (layoutStyle === 'maze') return generateMaze(cols, rows);
  if (!planPlace) return generateBuilding(cols, rows);
  const place = LOCATIONS[planPlace];
  return generateLayout(place.layouts[floor === 0 ? 0 : 1], cols, rows, place.landmark, generateBuilding);
};
/** The floor plans laid out as the building was rebuilt after a catch (takeover.ts), in the order the floors are built, for the retry to be built from. */
let pendingPlans: Array<{ cols: number; rows: number; cells: MazeCells }> = [];
/** A floor's plan: the one the protocol just showed being built if it's the right size, else a fresh one. */
const floorPlan = (cols: number, rows: number, floor = 0): MazeCells => {
  const next = pendingPlans.shift();
  if (next && next.cols === cols && next.rows === rows) return next.cells;
  pendingPlans = [];
  return freshPlan(cols, rows, floor);
};

/** Whether the guide (the floor arrow to the next objective) is on: it is, until the player turns it off. */
const GUIDE_KEY = 'mazeHeist.guide';
const GUIDE_HINT_KEY = 'mazeHeist.guideHint';
let guideOn = ((): boolean => {
  try {
    return window.localStorage.getItem(GUIDE_KEY) !== '0';
  } catch {
    return true;
  }
})();

/** Turns the guide on or off, remembers it, and shows it in the controls sheet (from the PDA, P, or that sheet's checkbox). */
function setGuideOn(on: boolean): void {
  guideOn = on;
  try {
    window.localStorage.setItem(GUIDE_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: it stays as chosen for this visit.
  }
  hud.setGuideSetting(on);
}
hud.setGuideSetting(guideOn);
hud.wireGuideSetting(setGuideOn);
// Black edges (postfx.ts's EdgePass): the controls sheet's checkbox, on the job that is running and kept for the next.
let liveFx: PostFX | null = null;
let liveRoot: SceneRoot | null = null;
hud.wireEdgesSetting((on) => {
  rememberEdges(on);
  if (liveFx) {
    liveFx.edges.enabled = on;
    // On a phone the lines also bring the picture's pixel count down a little (renderPixelRatio), and back up when they are off.
    if (liveRoot) {
      liveRoot.renderer.setPixelRatio(renderPixelRatio(on));
      handleResize(liveRoot);
    }
  }
});
hud.setEdgesSetting(edgesPreferred());

/** This player's controls (shared/controls.ts): kept in this browser, and on the account when logged in, so they follow them between devices. */
const CONTROLS_KEY = 'mazeHeist.controls';
let controlSettings: ControlSettings = ((): ControlSettings => {
  try {
    return parseControls(window.localStorage.getItem(CONTROLS_KEY)) ?? DEFAULT_CONTROLS;
  } catch {
    return DEFAULT_CONTROLS;
  }
})();
let controlsSaveTimer = 0;

/** The keys as the player has them: every action's KeyboardEvent.code. */
let keyMap: Record<ActionId, string> = resolveKeys(controlSettings);

/** Redraws the training coach's text (it names keys), while a training floor is up: set by the job, cleared when it ends. */
let refreshCoach: () => void = () => {};

/** Puts settings in force: the keys, the sheet's slider and key list, and every line of text that names a key. */
function applyControls(next: ControlSettings): void {
  controlSettings = next;
  setCameraAngle(next.camera);
  keyMap = resolveKeys(next);
  hud.showControlSettings(next, isCustom(next));
  hud.showKeyList(ACTIONS.map((id) => ({ id, label: ACTION_LABELS[id], key: keyName(keyMap[id]) })));
  hud.setKeyLabels(keyMap);
  refreshCoach();
}

/** Changes the controls: remembered here at once, sent to the account a moment after the last change (a slider fires many). */
function setControls(next: ControlSettings): void {
  applyControls(next);
  try {
    window.localStorage.setItem(CONTROLS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: they hold for this visit.
  }
  window.clearTimeout(controlsSaveTimer);
  controlsSaveTimer = window.setTimeout(() => void saveProfile({ controls: next }), 700);
}

/** A line of text with the player's own keys in it: "Press {trap} to roll" reads "Press G to roll" until they move it. */
const keyed = (text: string): string => withKeys(text, keyMap);

hud.wireControlSettings({
  onAim: (aim) => setControls({ ...controlSettings, aim: Math.min(AIM_MAX, Math.max(AIM_MIN, aim)) }),
  onCamera: (camera) => setControls({ ...controlSettings, camera: Math.min(CAMERA_MAX, Math.max(CAMERA_MIN, Math.round(camera))) }),
  onTurn: (turn) => setControls({ ...controlSettings, turn: Math.min(TURN_MAX, Math.max(TURN_MIN, turn)) }),
  onSmooth: (smooth) => setControls({ ...controlSettings, smooth }),
  onDash: (dash) => setControls({ ...controlSettings, dash }),
  onFps: (fps) => setControls({ ...controlSettings, fps }),
  onReset: () => setControls(DEFAULT_CONTROLS),
  onKey: (action, code) => {
    if (!isBindable(code)) return false;
    const before = resolveKeys(controlSettings);
    const next = bind(controlSettings, action as ActionId, code);
    const swapped = ACTIONS.find((a) => a !== action && before[a] !== resolveKeys(next)[a]);
    setControls(next);
    if (swapped) hud.showToast(`${ACTION_LABELS[swapped].toUpperCase()} NOW ON ${keyName(resolveKeys(next)[swapped]).toUpperCase()}`, 'neutral', 2600);
    return true;
  },
});
applyControls(controlSettings);

function startJob(n: number, course: Course | null = null, dailyRun: DailyRun | null = null, entry: EntryId = 'dock', approach: Approach | null = null): void {
  signageText.resetTags(n); // (the guards' and dogs' serial numbers start again, the same for the same job)
  const training = course !== null;
  const grapple = course === 'grapple';
  const stealth = course === 'stealth';
  const weapons = course === 'weapons';
  const cover = course === 'cover';
  const corners = course === 'corners';
  const wall = course === 'wall';
  const highwall = course === 'highwall'; // the tall wall's lesson: hanging from its shelf (highwall.ts)
  const dock = course === 'dock';
  const range = course === 'range';
  const bunker = course === 'bunker'; // the Sump: an underground bunker, linear, with ducts (bunkerplan.ts)
  const tower = course === 'tower'; // the entry level: a hall of four storeys (towerplan.ts), hands on to a job at its heist door
  // The exit level (`?job=tower&exit=1`): the tower the other way. The agent starts at the top with everything open and every camera and laser off, the alarm is a fact, enemies come in waves,
  // two guns are carried and fired one after the other (twice as often), the furniture can be shot to bits, and the way out is the lift in the lobby.
  // What the URL and the run say about this level (arc.ts): the URL wins, so a level can still be looked at on its own; otherwise the run's place and stage decide.
  const runStore = ((): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('newrun') === '1') clearRun(runStore);
  const savedRun = loadRun(runStore);
  const options = runOptions(new URLSearchParams(window.location.search), savedRun);
  const exitMode = tower && options.exit;
  /** The campaign operation this level belongs to (operations.ts), from the saved run; null for a free run, a ladder job or a level looked at on its own. */
  const campaignOp: Operation | null = savedRun ? operationOf(savedRun) : null;
  /** The first level is the Records Annex (the campaign's first operation; `?plan=annex` on localhost looks at it alone), not the Sump: the bunker engine, another plan. */
  /** The campaign run is at its exit and goes out the way it came in: through its first level, from the lift at the top down to the one at the bottom, or from the truck to the gate. */
  const reverseOut = reverseExit(savedRun);
  /** The Tank Farm: the yard laid out as a refinery's tank farm (`?plan=farm` on localhost looks at it alone). */
  const farmSite = dock && ((savedRun?.site === 'farm' && (savedRun.stage === 'bunker' || reverseOut)) || (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('plan') === 'farm'));
  const yardPlan: YardPlanData = YARD_PLANS[farmSite ? 'farm' : 'dock'];
  const stackSite: StackSite | null = bunker ? ((savedRun?.stage === 'bunker' || reverseOut) && isStackSite(savedRun?.site) ? (savedRun!.site as StackSite) : /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && isStackSite(new URLSearchParams(window.location.search).get('plan')) ? (new URLSearchParams(window.location.search).get('plan') as StackSite) : null) : null;
  const annexSite = stackSite === 'annex';
  /** The first level, played backwards: the alarm is up, waves come, and the way out is where the run began. */
  const stackExit = bunker && reverseOut && stackSite !== null;
  const yardExit = dock && reverseOut && isYardSite(savedRun?.site);
  selectBunkerPlan(stackSite ?? 'sump');
  /** The final level's white lab: operation 6, or the lab hall looked at on its own. */
  const coreLook = options.core;
  /** A place as this run has it: the lab is the final level's white lab in operation 6 (`options.core`). */
  const placed = (id: LocationId): Location => (coreLook && id === 'lab' ? CORE_LOCATION : LOCATIONS[id]);
  // The final level's white clones patrol its tower and its maze (a few to a floor, never a flood); the lab hall (the bunker) has none, and the exit level brings its own in waves.
  whitePerFloor = options.core && !bunker && !exitMode && !dock ? (tower ? 1 : 2) : 0;
  /** The scenes between the run's levels and the briefing before each (`?cutscenes=0` on localhost leaves them out). */
  const CUTSCENES = !(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('cutscenes') === '0');
  /** The exit level with white guards instead of hunters: three waves, a weapons kit before the first and after each (`?job=tower&exit=1&white=1` on localhost; the final level's exit level will turn it on itself). */
  const WHITE_EXIT = exitMode && (options.core || (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('white') === '1'));
  /** The bar at the top is health, not suspicion: being seen costs nothing (the guards know the agent is in the building), being hit, shot or burnt does, and the bar fills back while nothing hurts. The exit level's, and the bunker's. */
  const healthMode = exitMode || bunker || (dock && reverseOut);
  /** What the level is called, where it is one of the run's (the bunker, the tower, the way out, the dock yard): no "training" about them. Null: a training course, or a job. */
  const levelName = bunker ? (stackSite ? SITE_TITLE[stackSite] : options.core ? 'The lab hall' : 'The Sump') : exitMode ? 'The way out' : tower ? 'The tower' : dock ? (farmSite ? 'The Tank Farm' : 'The dock yard') : null;
  /** Each storey's container roofs (the bunker's): the guards' nav grid up there, by the storey's content. */
  const roofNavs = new Map<FloorContent, MazeCells>();
  /** The containers' roofs, by storey; the cells the containers cover; and the little patches bridging containers that touch only at a corner. */
  type RoofSurface = { level: number; key: string; stair: Stair; cells: string[] };
  const roofSurfaces: RoofSurface[] = [];
  const roofCellSets = new Map<number, Set<string>>();
  const roofBridges = new Map<number, Stair[]>();
  /** Each storey's writing (signrender.ts): its walls', floors' and containers'. */
  const signLayers = new Map<number, SignLayer>();
  /** The bunker's clue systems, one to a storey (cluerig.ts). */
  const clueSystems: ClueSystem[] = [];
  /**
   * The run's seed (the URL's `?seed=`, else one kept in the browser, so a retry is the same puzzle) and what it makes of the bunker: each storey's containers that can be opened, the one the
   * dossier is in (arc.ts), and whether it has been read.
   */
  /** The first level of a run: the bunker, or the dock yard with the dossier hunt on (`?objective=1`, or the saved run is the yard's). Neither: no hunt, and the level is what it always was. */
  const huntSite: Site | null = stackExit || yardExit ? null : bunker ? (stackSite ?? 'bunker') : dock && (new URLSearchParams(location.search).get('objective') === '1' || (isYardSite(savedRun?.site) && savedRun?.stage === 'bunker') || farmSite) ? (farmSite ? 'farm' : 'yard') : null;
  const hunt = huntSite !== null;
  const yardRun = huntSite === 'yard' || huntSite === 'farm';
  const runSeed = ((): number => {
    const asked = Number(new URLSearchParams(location.search).get('seed'));
    if (Number.isInteger(asked) && asked > 0) return asked;
    // A try again at the first level is the same puzzle: the saved run's seed, while it is still at that level.
    if (savedRun && (savedRun.stage === 'bunker' || !hunt)) return savedRun.seed;
    return 1 + Math.floor(Math.random() * 1e9);
  })();
  /** The run this level is a part of, saved from the moment it starts (a new one, unless the saved one is this very puzzle) and again at each stage. */
  let bunkerRun: ArcRun | null = null;
  if (huntSite) {
    bunkerRun = savedRun && savedRun.seed === runSeed && savedRun.stage === 'bunker' && savedRun.site === huntSite ? savedRun : { ...newRun(runSeed), site: huntSite };
    if (bunkerRun !== savedRun) keepRun(runStore, bunkerRun);
  }
  const bunkerOpen: BunkerContainer[][] = [];
  const dossier = { found: false };
  /** The yard's containers that can be opened (yardsite.ts), when the hunt is there. */
  let yardOpen: YardContainer[] = [];
  const crateStations: CrateStation[] = [];
  /** The Annex's sliding banks, and which cells of each storey are shut (furniture and banks: what the guards' map keeps closed). */
  const shelfBanks: ShelfBank[] = [];
  const crateCandidates: CrateStation[] = []; // every container with a free door: only some of them (below) offer to be opened
  let dossierMark: DossierRig | null = null;
  let clueScreenPct = -1;
  let lastBunkerProgress = 0; // when (job seconds) the last terminal was hacked, or the hint last spoke
  const BUNKER_HINT_S = 300;
  /** Reading the dossier sets the squad on the agent (`?lockdown=0` on localhost turns it off). */
  const LOCKDOWN = !(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('lockdown') === '0');
  const roofKey = (b: { minX: number; minZ: number }): string => `${b.minX.toFixed(2)},${b.minZ.toFixed(2)}`;
  const bulletOk = !training || tower || bunker; // bullet time runs on the real jobs and in the tower (the other courses teach one thing at a time)
  // The cover and corners courses' enemies are practice targets: still, and not shooting back.
  const practice = cover || corners || wall || highwall || range;
  // The grapple course is built like the ceiling course (its pipes, an exit that stands open behind a gate), only quieter.
  const ceiling = course === 'ceiling' || grapple;
  // Recon plays before anything else at the start of a job, so what's said at the start waits for it (later()).
  let tourPending = !training && !tourQuiet();
  const afterTour: Array<() => void> = [];
  /** Runs `fn` `ms` from now, or from when the recon's over. */
  const later = (fn: () => void, ms: number): void => {
    const go = (): void => void window.setTimeout(() => !signal.aborted && fn(), ms);
    if (tourPending) afterTour.push(go);
    else go();
  };
  /** The way-out lesson, with its checkpoint where the agent starts: the cell in front of the lift it left by (the truck's, in a yard). */
  const outStations = (): readonly Station[] => {
    const d = (['S', 'E', 'N', 'W'] as const).find((s) => parseTraining(bunkerMap(BUNKER_EXIT_LEVEL, false)).cells[BUNKER_EXIT.y]?.[BUNKER_EXIT.x]?.[s]) ?? 'S';
    const cp = bunker ? { x: BUNKER_EXIT.x + DIR_DELTA[d][0], y: BUNKER_EXIT.y + DIR_DELTA[d][1] } : { x: 16, y: 5 };
    return [{ ...OUT_STATIONS[0]!, checkpoint: cp, ...(bunker ? { checkpointLevel: BUNKER_EXIT_LEVEL } : {}) }];
  };
  const stations = range ? RANGE_STATIONS : stackExit || yardExit ? outStations() : bunker ? bunkerStations(() => activeFloorIdx) : tower ? (exitMode ? EXIT_STATIONS : TOWER_STATIONS) : dock ? DOCK_STATIONS : highwall ? HIGHWALL_STATIONS : wall ? WALL_STATIONS : corners ? CORNERS_STATIONS : cover ? COVER_STATIONS : weapons ? WEAPONS_STATIONS : stealth ? STEALTH_STATIONS : grapple ? GRAPPLE_STATIONS : ceiling ? CEILING_STATIONS : STATIONS;
  level = n;
  if (!training && !dailyRun) ladderJob = n;
  hud.setJobLabel(levelName ? { name: levelName } : training ? 'training' : dailyRun ? { daily: dailyRun.number } : level);
  notePlayed();
  hud.setCoach(null);

  // Each job re-wires input listeners onto the same reused <canvas>/window,
  // so scope them all to one AbortController and abort it the instant the
  // next job starts — otherwise the previous job's listeners (and its
  // render loop) keep running forever, stacking up job after job and
  // occasionally driving the new player from a stale closure with no real
  // input from the user.
  const controller = new AbortController();
  const { signal } = controller;

  const canvas = document.getElementById('bg') as HTMLCanvasElement;
  // Grabs keyboard focus for the canvas explicitly — this runs inside an
  // iframe (Reddit's expanded-mode view), where keydown only fires once
  // something inside the iframe actually has focus.
  canvas.tabIndex = 0;
  canvas.style.outline = 'none';
  canvas.focus();
  canvas.addEventListener('pointerdown', () => canvas.focus(), { signal });

  // The tower is the entry to a place: its set of furniture, its looks and its floors' names are that place's (job n's, or `?place=` on localhost to look at another).
  const towerSetId: TowerSetId = (() => {
    return tower ? ((options.towerPlace ?? locationFor(n).id) as TowerSetId) : 'campus';
  })();
  // The briefing before a run's tower, the first time it is played (not after a catch, or a reload): the blueprint with the tasks on it. What waits for the recon waits for it too.
  const briefedKey = savedRun ? `tower:${savedRun.seed}` : '';
  const BRIEFED = 'mazeHeist.briefed';
  const wasBriefed = (): boolean => {
    try {
      return window.localStorage.getItem(BRIEFED) === briefedKey;
    } catch {
      return false;
    }
  };
  const showBriefing = CUTSCENES && tower && !exitMode && savedRun?.stage === 'tower' && savedRun.place === towerSetId && !wasBriefed();
  if (showBriefing) tourPending = true;
  // ...and its plan: where the stairs, lifts, rooms and doors are (towerplan.ts), made the active one before anything is built from it.
  // What the layout is generated from: a day's seed for the Daily (the same tower for everyone, like its maze), `?seed=N` on localhost to replay one, otherwise a fresh one each run.
  const seedParam = new URLSearchParams(location.search).get('seed');
  const towerSeed = dailyRun ? dailyRun.seed : seedParam !== null && Number.isFinite(Number(seedParam)) ? Math.floor(Number(seedParam)) : Math.floor(Math.random() * 1_000_000_000);
  if (tower) selectTowerPlan(towerSetId, towerSeed);
  const layout = training ? parseTraining(bunker ? bunkerMap(0, false) : tower ? levelMap(0) : range ? RANGE_MAP : dock ? DOCK_MAP : highwall ? HIGHWALL_MAP : wall ? WALL_MAP : corners ? CORNERS_MAP : cover ? COVER_MAP : weapons ? WEAPONS_MAP : stealth ? STEALTH_MAP : grapple ? GRAPPLE_MAP : ceiling ? CEILING_MAP : TRAINING_MAP) : null;
  const script = layout ? (bunker ? bunkerScript(layout, 0) : tower ? towerScript(layout, 0, towerSetId, exitMode) : range ? rangeScript(layout) : dock ? dockScript(layout, yardPlan) : highwall ? highwallScript(layout) : wall ? wallScript(layout) : corners ? cornersScript(layout) : cover ? coverScript(layout) : weapons ? weaponsScript(layout) : stealth ? stealthScript(layout) : grapple ? grappleScript(layout) : ceiling ? ceilingScript(layout) : trainingScript(layout)) : undefined;
  // A daily heist is built like the campaign's job of the same number (with last night's carry-over).
  // What the last mission carries in: last night's, for a daily; the last job cleared, on the ladder.
  const carryIn: Carry | null = dailyRun ? dailyRun.carry : training ? null : ladderCarryNow(level);
  hud.resetToasts();
  const baseDiff = withCarry(difficultyFor(level), carryIn);
  // A daily heist is built from the day's seed, so it's the same building for everyone (seeded.ts) — from the maze
  // through every room, guard and blackout, up to the ambient effects below.
  if (dailyRun) seedRandom(dailyRun.seed);
  else restoreRandom();
  // Where the job takes place: the campus for training, otherwise by job number (locations.ts).
  const towerFloorNames: readonly string[] = tower ? TOWER_SETS[towerSetId].floors : TOWER_LEVELS.map((l) => l.name);
  const tThemes = tower ? towerThemes(towerSetId, towerFloorNames, placed(towerSetId)) : [];
  // (The bunker is dressed as a place: the lab first; `?place=` on localhost picks another.)
  const bunkerPlace: TowerSetId = stackSite ? SITE_PLACE[stackSite] : options.bunkerPlace;
  // (A maze job the run is at is held in the dossier's place; a looked-at one, `?loc=`, in that. Not the Daily, which is everyone's.)
  const heldIn: LocationId | null = forcedLocation ?? (dailyRun || training ? null : options.mazePlace);
  const place = tower ? placed(towerSetId) : bunker ? placed(bunkerPlace) : dock ? (farmSite ? LOCATIONS.refinery : LOCATIONS.warehouse) : training ? LOCATIONS.campus : heldIn ? placed(heldIn) : locationFor(level);
  planPlace = place.id;
  /** What this job asks of the player (contracts.ts): records, or a contract of the place's own (objectives.ts). */
  const contract: ContractId = training ? 'records' : contractFor(level, place.id);
  // The job's twist(s) (twists.ts): the campaign deals one from the fourth job on, a Daily two from its seed. Localhost: `?twist=lockdown,timer` forces them.
  const forcedTwists = ((window as unknown as { __twists?: string[] }).__twists ?? (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? (new URLSearchParams(window.location.search).get('twist') ?? '').split(',') : [])).filter((t): t is TwistId => (TWIST_IDS as readonly string[]).includes(t));
  const twists: TwistId[] = training ? [] : forcedTwists.length ? forcedTwists : dailyRun ? dailyTwists(Math.random, contract) : storyTwist(level, contract);
  const forcedSide = (((window as unknown as { __side?: string }).__side ?? (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? new URLSearchParams(window.location.search).get('side') : null)) ?? '') as SideGoalId;
  const sideGoal: SideGoalId | null = training ? null : (SIDE_GOAL_IDS as readonly string[]).includes(forcedSide) ? forcedSide : dailyRun ? dailySideGoal(Math.random, twists) : storySideGoal(level, twists);
  const twisted = applyTwists(baseDiff, twists);
  /** A silent night (twists.ts): no guards, sentries, heavies, mines or drones, only dogs listening, on a smaller floor for the slower pace. */
  const silent = twists.includes('silent');
  const { cols, rows } = layout ?? (silent ? { cols: Math.min(baseDiff.cols, SILENT_MAX_COLS), rows: Math.min(baseDiff.rows, SILENT_MAX_ROWS) } : baseDiff);
  const diff = {
    ...baseDiff,
    guards: twisted.guards,
    watchdogs: twisted.watchdogs,
    blackouts: twisted.blackouts,
    blackoutCells: twisted.blackoutCells,
    trapsAtStart: twisted.trapsAtStart,
    ...(silent ? { silent: true, heavies: 0, crawlers: 0, alphas: 0, drones: 0 } : {}),
  };
  const cells = layout?.cells ?? floorPlan(cols, rows, 0);
  // (A tower's plan says where: its street door can be anywhere along the north or west wall.)
  const startCell: { x: number; y: number } = tower ? { x: TOWER_START.x, y: TOWER_START.y } : bunker ? { x: BUNKER_START.x, y: BUNKER_START.y } : { x: 0, y: 0 };
  // The exit is never in the landmark: that is a big open room, not a dead end for a lift.
  const landmark0 = landmarkOf(cells);
  // Nor is it in the stair's spur, where the way up goes (layouts.ts).
  const spur0 = stairSpurOf(cells);
  const { x: exitX, y: exitY, dist } = layout ? { ...(bunker ? BUNKER_EXIT : layout.marks.X!), dist: bfs(cells, cols, rows, startCell.x, startCell.y) } : farthestCell(cells, cols, rows, 0, 0, (x, y) => !inLandmark(landmark0, x, y) && !spur0?.some((c) => c.x === x && c.y === y));

  const root = buildSceneRoot(canvas);
  setGrade(root.postfx, place.id); // the place's colour grade (postfx.ts)
  liveFx = root.postfx;
  liveRoot = root;
  preparePulseLights(root.scene); // (flare, flash and EMP lights: made now, so the first throw does not recompile every material)
  hud.setEdgesSetting(root.postfx.edges.enabled);
  // How the job begins and ends depends on the place (ways.ts): a lift on the campus; elsewhere a doorway in the outer wall to walk in through, and a way out
  // of its own. A doorway means the start cell's outer wall is left out of the plan the floor is drawn from (not the one the game plays on), and the doorway
  // built into the gap.
  // The yard's way in is a gate in the fence, and its way out a truck backed up to it.
  const ways = dock ? { entry: 'gate' as const, exit: 'truck' as const } : bunker ? { entry: 'lift' as const, exit: 'lift' as const } : WAYS[place.id];
  const entryDir: Dir = tower ? startOpening(startCell, TOWER_COLS, TOWER_ROWS) : cells[0]![0]!.S ? 'S' : 'E';
  // (The tower's floors are drawn as a plain hall: no walls round what is not floor, towerplan.ts.)
  // (The bunker's ducts are drawn as corridors, but the guards' map keeps them shut: nobody but the agent crawls in.)
  const baseCells = tower ? drawCells(0) : bunker ? parseTraining(bunkerMap(0, true)).cells : cells;
  const drawnCells =
    ways.entry === 'lift'
      ? baseCells
      : baseCells.map((row, y) => row.map((c, x) => (x === startCell.x && y === startCell.y ? { ...c, [OPPOSITE[entryDir]]: true } : c)));
  // The canal's quay is fenced along both banks and across its south end (the dock yard's water: yardplan.ts).
  const quay = (x: number, y: number, dir: 'N' | 'W'): boolean =>
    dock && ((dir === 'W' && (x === CANAL_COL || x === CANAL_COL + 1) && y < BRIDGE_ROW) || (dir === 'N' && x === CANAL_COL && y === BRIDGE_ROW));
  const floor0 = buildFloor(root, drawnCells, cols, rows, 0, 0, 0, tower ? tThemes[0]! : dock ? (farmSite ? FARM_YARD : DOCK_YARD) : place.floors[0], ways.entry === 'lift' ? undefined : { dir: OPPOSITE[entryDir], cell: entryDir === 'S' || entryDir === 'N' ? startCell.x : startCell.y }, quay, bunker ? () => true : highwall ? highwallTall : undefined, bunker ? BUNKER_WALL_H : undefined, bunker);
  // The tower's lobby: the floor cut out where there is none, the stairs and their rails, the balustrades, the lift.
  const towerLifts: Array<{ level: number; id: string; rig: ElevatorRig }> = [];
  /** The keycards' little desks, by storey, until each is taken; and the storeys whose card the agent holds. */
  const towerCards = new Map<number, THREE.Group>();
  const cardsHeld = new Set<number>();
  /** The bonus on the bridge's deck, until it is taken. */
  let bridgeBonus: THREE.Group | null = null;
  /** The security cameras, and what each has seen. */
  const towerCams: Array<{ rig: CameraRig; seen: number; quietUntil: number; lockUntil: number; offUntil: number; perm: boolean }> = [];
  let camerasOffUntil = 0; // the console's looped feed blinds them until then
  /** The core stair folds away until its console lowers it for STAIR_OPEN_S seconds: its folding flight, and the gates that shut its two ends while it is up. */
  let coreMesh: THREE.Object3D | null = null;
  const coreBarriers: Array<{ level: number; box: WallBox }> = [];
  let stairOpenUntil = 0;
  let coreOpen = false;
  let coreK = 0; // 0 folded, 1 down (eased)
  let hasKey = false; // (the gallery's card: it also opens the service lift and the back offices' doors)
  /** The keycard doors of the back offices: they slide open for a guard coming up to them, and for the agent once the keycard is taken. */
  const officeDoors: Array<{ rig: OfficeDoorRig; level: number; k: number; open: boolean }> = [];
  /** The heist door and the lift beyond it (the offices' way on): the doors slide open as the agent comes up, latched open once they have. */
  let towerHeist: { lift: ElevatorRig; door: { box: WallBox; position: { x: number; z: number }; slide: (k: number) => void; setLocked: (locked: boolean) => void }; k: number } | null = null;
  /** The tower's passage walls, office doors and lift cabs, by storey: they ghost out like the walls when they stand between the camera and the agent (propfade.ts). */
  const towerFaders = new Map<FloorRig, PropFader>();
  /** The furniture of each storey (tower.ts's furnish) that a shot can break (the exit level), by the storey's number. */
  const storeyPieces: Destructible[][] = [];
  const registerFadables = (rig: FloorRig, props: ReadonlyArray<{ objects: THREE.Object3D[]; box: Box3 }>): void => {
    const fader = new PropFader({ blocking, stepFade });
    for (const p of props) fader.add(p);
    if (fader.count > 0) towerFaders.set(rig, fader);
  };
  if (tower) {
    const dressed0 = dressTowerLevel(floor0, 0, FLOOR_HEIGHT, undefined, towerSetId);
    registerFadables(floor0, dressed0.fadables);
    storeyPieces[0] = dressed0.pieces;
    for (const l of dressed0.lifts) towerLifts.push({ level: 0, ...l });
    for (const c of dressed0.cameras) towerCams.push({ rig: c, seen: 0, quietUntil: 0, lockUntil: 0, offUntil: 0, perm: false });
    if (dressed0.keycard) towerCards.set(0, dressed0.keycard);
    if (dressed0.timedStair) coreMesh = dressed0.timedStair;
  }
  // The dock yard's own scene: containers, the canal, the zipline and the floodlights.
  const yard: BuiltYard | null = dock ? buildYard(CELL, yardPlan.id) : null;
  if (yard) {
    floor0.group.add(yard.group);
    floor0.wallBoxes.push(...yard.boxes);
    // Night in the open: moonlight and floodlit concrete, not the dark of a building's corridors. The ground is visible from the start and the torch only brightens it.
    root.ambientLight.intensity = 1.05;
    root.sunLight.intensity = 0.6;
    if (root.scene.fog instanceof THREE.FogExp2) root.scene.fog.density = 0.011;
    const ground = new THREE.Color(0x56606c);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) revealFloorCell(floor0, x, y, ground);
  }

  // The lifts: the job starts inside one standing in the start cell (its
  // back to the always-closed west or north boundary wall) and ends in one
  // in the farthest dead end, facing that dead end's only opening. Both
  // keep their doors shut — solid — until they open.
  const openDir = (x: number, y: number): 'N' | 'S' | 'E' | 'W' => (['S', 'E', 'N', 'W'] as const).find((d) => cells[y]![x]![d]) ?? 'S';
  const arrival = ways.entry === 'lift' ? buildElevator(startCell.x, startCell.y, tower ? entryDir : cells[0]![0]!.E ? 'E' : 'S') : buildEntryPortal(ways.entry, startCell.x, startCell.y, entryDir);
  const exitOpens = tower ? exitOpening({ x: exitX, y: exitY }, cols, rows) : bunker ? ((['S', 'E', 'N', 'W'] as const).find((d) => parseTraining(bunkerMap(BUNKER_EXIT_LEVEL, false)).cells[exitY]![exitX]![d]) ?? 'S') : openDir(exitX, exitY);
  const exitLift =
    ways.exit === 'doors'
      ? buildExitDoors(exitX, exitY, exitOpens)
      : ways.exit === 'hatch'
        ? buildExitHatch(exitX, exitY, exitOpens)
        : buildElevator(exitX, exitY, exitOpens, ways.exit === 'airlock' ? AIRLOCK_STYLE : ways.exit === 'truck' ? TRUCK_STYLE : ways.exit === 'vault' ? VAULT_STYLE : undefined);
  /** What the way out is called in the toasts, per place. */
  const EXIT = EXIT_NAME[ways.exit];
  // (The tower has no way out in its lobby: it is a climb that leads on to the heist, through the door on the top floor. The way-out cell is left an empty recess.)
  for (const lift of (tower && !exitMode) || bunker ? [arrival] : [arrival, exitLift]) {
    floor0.group.add(lift.group);
    floor0.wallBoxes.push(...lift.boxes, lift.doorBox);
  }
  if (ways.entry === 'lift') arrival.setState('arrival', training ? (levelName ? `▼ ${levelName.toUpperCase()}` : '▼ TRAINING') : dailyRun ? `▼ DAILY #${dailyRun.number}` : approach ? '▼ FROM THE TOWER' : `▼ JOB ${level}`);
  exitLift.setState('locked');
  /** Opens or shuts a lift, keeping its doorway's collision box in step. */
  /** The floor the way out stands on: the ground floor of the bunker, the first floor otherwise. */
  let exitRig: FloorRig = floor0;
  const setLiftOpen = (lift: ElevatorRig, open: boolean): void => {
    if (lift.isOpen() === open) return;
    lift.setOpen(open);
    const boxes = (lift === exitLift ? exitRig : floor0).wallBoxes;
    const i = boxes.indexOf(lift.doorBox);
    if (open && i !== -1) boxes.splice(i, 1);
    if (!open && i === -1) boxes.push(lift.doorBox);
    sound.play('liftDoors', { x: lift.front.x, y: 1.2, z: lift.front.z }, 0.8);
  };
  let arrivalPhase: 'waiting' | 'open' | 'done' = 'waiting';
  let arrivalTimer = ARRIVAL_OPEN_S;
  // The keys and the stick do nothing inside the lift: the doors open, and the agent walks out by itself, so nobody is left
  // wedged in a corner of the cab. If something is somehow in the way, control comes back after this many seconds.
  let arrivalWalkLeft = ARRIVAL_WALK_S;
  // The chase camera would sit behind the player — out past the lift's back
  // wall, which hides them. Until they step out, the shot comes from in front
  // of the doors instead, then eases back to the chase camera.
  let liftCam = 1;
  const liftCamPos = new THREE.Vector3(
    arrival.front.x + Math.sin(arrival.spawn.facing) * 5.5,
    LIFT_CAM_HEIGHT,
    arrival.front.z + Math.cos(arrival.spawn.facing) * 5.5
  );
  const chaseCamPos = new THREE.Vector3();

  const player = new Player(root.scene, 0, 0, agent, look, style);

  // ---- AI co-op: the partner (game/companion.ts) ----
  // An option on the brief (and `?coop=ai` on localhost): the agent's other half, Agent A if you are Agent B and the reverse, comes out of the lift with you. It follows your path, copies how you move
  // (sneaking, lying flat, dashing), takes cover when you do, backs your shots up and shoots guards that come at either of you, and watches your back while you work a console. A guard that gets
  // a good look at it puts it down (not dead): hold Interact beside it to bring it round, or it is lost after a while and the job goes on without it. The exit lift takes the two of you together.
  // The tower, the bunker and the exit level are levels of their own here, not lessons, so the partner comes along on them too.
  const partnerOn = aiCoopOn && (!training || tower || bunker) && !dailyRun?.scored; // (a scored Daily is the same for everyone: no partner there)
  const partnerName = agent === 'male' ? 'Agent B' : 'Agent A';
  let partner: Player | null = null;
  let partnerState: PartnerState = 'free';
  const partnerTrail = new Trail();
  let partnerHold = 0;
  let partnerWorking = false;
  let partnerSeen = 0;
  let partnerDownFor = 0;
  const partnerProj = new THREE.Vector3();
  let partnerPingLeft = 0;
  let partnerCooldown = 0;
  let partnerExitHintAt = -10;
  let partnerCalledAt = -10;
  /** The furniture the partner is heading for or sheltering behind while you are in cover, and whether it has got there. */
  let partnerCover: CoverSpot | null = null;
  let partnerCoverReady = false;
  let partnerCoverLookAt = -10;
  let partnerCoverTry = 0;
  /** Whether it was trying to walk this frame (for telling stuck from standing by on purpose). */
  let partnerTrying = false;
  /** How long you have stood in the exit waiting for the partner (past 3 s, near enough is enough, so a stuck partner never holds the job up). */
  let partnerLiftWait = 0;
  /** Where the partner was when it last moved, and how long it has been stuck there while you are away. */
  const partnerStuck = { x: 0, z: 0, t: 0 };
  /** How long it has been a long way from you on your floor (past a while, however it got there, it is put back on your path). */
  let partnerFarFor = 0;
  /** How long it has been on another floor from you with no stairs or lift that lead to yours. */
  let partnerNoWayFor = 0;
  /** How long it has stood about, not walking, a long way from you on your floor. */
  let partnerIdleFar = 0;
  /** How much longer to count it as trying to walk (a moment after the last frame it was). */
  let partnerTryLeft = 0;
  if (partnerOn) {
    partner = new Player(root.scene, 0, 0, agent === 'male' ? 'female' : 'male', look, style);
    partner.setTorch(false);
    // Behind you in the cab, a little to the side: single file out of the door, you first.
    const f = arrival.spawn.facing;
    partner.place(arrival.spawn.x - Math.sin(f) * 1.1 - Math.cos(f) * 0.2, arrival.spawn.z - Math.cos(f) * 1.1 + Math.sin(f) * 0.2, f, 0);
  }

  if (!partnerOn) hud.setPartner(null);

  /** The storey the way out stands on (the lift in the tower's lobby, or the bunker's ground floor). */
  const exitFloorIdx = bunker ? BUNKER_EXIT_LEVEL : 0;

  /** The floor the partner is on (it climbs the stair on its own). The tower's flights have their side rails on both storeys they join, so there the storey follows its height, as yours does. */
  function partnerFloor(): ActiveFloor {
    const idx = partner ? (tower ? Math.round(partner.worldY / floorHeight) : partner.currentFloorIdx) : 0;
    return storeys[Math.max(0, Math.min(idx, storeys.length - 1))]!;
  }

  /** You are somewhere it cannot walk to (hanging on a ledge, up a wall, on a container's roof, on the pipes): it waits at the nearest place it can get to instead of trying the walls. */
  const leaderUp = (): boolean => aloft !== null || roofY !== null;

  /** The walls the partner sees through: all of its floor's, bar the furniture it is crouched behind (it shoots over that). */
  function partnerWalls(): WallBox[] {
    const walls = partnerFloor().rig.wallBoxes;
    return partnerCover && partnerCoverReady ? walls.filter((b) => b !== partnerCover!.box) : walls;
  }

  /** The directions guards are likely to come from, given where they are, which way they face and walk, and what they are onto (companion.ts). */
  function partnerBearings(): Bearing[] {
    const threats = partnerFloor().content.enemies
      .filter((e) => !e.disabled && e.kind !== 'drone' && e.kind !== 'crawler' && e.kind !== 'alpha')
      .map((e) => ({ x: e.worldX, z: e.worldZ, facing: e.facing, alert: e.alert, moving: e.moving, kind: e.kind }));
    return threatBearings({ x: player.worldX, z: player.worldZ }, threats);
  }

  /**
   * Where the partner should take cover while you are in cover: furniture near you (never far), reachable, and chosen for what is likely to arrive. If the guards are coming at
   * the side your own cover shields, it covers that too; if they come at another (a patrol rounding the other way), it faces that one. Nothing in sight: your side.
   */
  function findPartnerCover(bearings: Bearing[]): { spot: CoverSpot; score: number } | null {
    if (!partner || !inCover) return null;
    const walls = partnerFloor().rig.wallBoxes;
    const mine = inCover;
    const me = { x: partner.worldX, z: partner.worldZ };
    const leader = { x: player.worldX, z: player.worldZ };
    let best: { spot: CoverSpot; score: number } | null = null;
    const seen = new Set<string>();
    for (const r of [1.8, 3, 4.2, 5.4]) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        const x = leader.x + Math.sin(a) * r;
        const z = leader.z + Math.cos(a) * r;
        if (collides(x, z, walls)) continue;
        const spot = coverSpotNear(walls, x, z, 1.5);
        if (!spot || spot.corner) continue;
        const key = `${spot.px.toFixed(1)},${spot.pz.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (spot.box === mine.box && Math.hypot(spot.px - mine.px, spot.pz - mine.pz) < 1.7) continue;
        if (Math.hypot(spot.px - leader.x, spot.pz - leader.z) > 6.5) continue;
        if (!hasLineOfSight(me.x, me.z, spot.px, spot.pz, walls.filter((b) => b !== spot.box), 14)) continue;
        const score = coverScore(spot, me, leader, { nx: mine.nx, nz: mine.nz }, bearings);
        if (!best || score < best.score) best = { spot, score };
      }
    }
    return best;
  }

  /** The awake guard nearest the partner that it can see (and shoot), within `range`. */
  function partnerTarget(range: number, not: Enemy | null): Enemy | null {
    if (!partner) return null;
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of partnerFloor().content.enemies) {
      if (e.disabled || e === not || e.kind === 'watchdog' || e.kind === 'drone' || e.kind === 'crawler' || e.kind === 'alpha') continue;
      const d = Math.hypot(e.worldX - partner.worldX, e.worldZ - partner.worldZ);
      if (d < bestD && hasLineOfSight(partner.worldX, partner.worldZ, e.worldX, e.worldZ, partnerWalls(), range)) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** The guard (or dog) that is worth a shot right now: the one onto you or nearest to either of you, that the partner can see. */
  function partnerThreat(stance: { sneak: boolean; prone: boolean }): Enemy | null {
    if (!partner) return null;
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of partnerFloor().content.enemies) {
      if (e.disabled || e.kind === 'drone' || e.kind === 'crawler' || e.kind === 'alpha') continue; // (the partner leaves an alpha to you: a hit sets it off)
      const dP = Math.hypot(e.worldX - partner.worldX, e.worldZ - partner.worldZ);
      if (dP > BACKUP_RANGE) continue;
      const nearest = Math.min(dP, Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ));
      // A dog is only worth a (slowing) shot when it is right on top of you.
      if (e.kind === 'watchdog' && nearest > 4.5) continue;
      if (!shouldEngage({ alerted: e.alert, nearest, kind: e.kind }, stance.sneak, stance.prone)) continue;
      if (!hasLineOfSight(partner.worldX, partner.worldZ, e.worldX, e.worldZ, partnerWalls(), BACKUP_RANGE)) continue;
      const score = nearest - (e.alert ? 4 : 0);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  /** The partner fires on `e`: turns to it, a tracer and a shot, and the same stun a shot of yours has. */
  function partnerShoot(e: Enemy): void {
    if (!partner || partnerState !== 'free' || e.disabled) return;
    partnerCooldown = BACKUP_COOLDOWN_S;
    partner.place(partner.worldX, partner.worldZ, Math.atan2(e.worldX - partner.worldX, e.worldZ - partner.worldZ));
    const from = partner.muzzleWorldPosition;
    const to = new THREE.Vector3(e.worldX, e.floorY + enemyAimHeight(e), e.worldZ);
    activeTracers.push(spawnShot(root.scene, partner.gunName, from, to));
    partner.kick(clock.elapsedTime);
    sound.play(shotSound(partner.gunName), { x: from.x, y: from.y, z: from.z });
    const result = e.hit('stun');
    if (result === 'disabled') {
      enemyDown(e, to);
      hud.showToast(`${partnerName.toUpperCase()} · GUARD DOWN`, 'good');
    } else if (result === 'damaged') bursts.sparks(to, 0xffa040);
  }

  /** Your shot or takedown: a beat later the partner takes the guard you did not (or, when yours only dented a heavy's armour, that one too). */
  function partnerBackup(target: Enemy | null): void {
    if (!partner || partnerState !== 'free' || partnerCooldown > 0) return;
    const heavy = target && target.kind === 'heavy' && !target.disabled ? target : null;
    const pick = heavy && hasLineOfSight(partner.worldX, partner.worldZ, heavy.worldX, heavy.worldZ, partnerWalls(), BACKUP_RANGE) ? heavy : partnerTarget(BACKUP_RANGE, target);
    if (!pick) return;
    partnerCooldown = BACKUP_COOLDOWN_S; // held for the beat before the shot
    window.setTimeout(() => !signal.aborted && !caught && !cleared && partnerShoot(pick), 350);
  }

  function partnerGoesDown(): void {
    if (!partner || partnerState !== 'free') return;
    partnerState = 'down';
    partnerHold = 0;
    partnerWorking = false;
    partnerDownFor = 0;
    partnerSeen = 0;
    partner.setProne(true);
    sound.play('hurt');
    hud.showToast(`${partnerName.toUpperCase()} IS DOWN · GET TO THEM AND HOLD INTERACT`, 'bad', 3400);
    suspicion = applySuspicion(suspicion, healthMode ? 5 : 15); // (a bar of health in the exit level and the bunker: not a fifth of it for a partner who is put down)
    hud.setSuspicion(suspicion);
  }

  /** What Interact does beside a downed partner: start bringing them round (hold it). */
  function startPartnerWork(): void {
    partnerWorking = true;
    hud.showToast(`BRINGING ${partnerName.toUpperCase()} ROUND · STAY CLOSE`, 'neutral', 1800);
  }

  function finishPartnerWork(): void {
    if (!partner || !partnerWorking) return;
    partnerWorking = false;
    partnerHold = 0;
    partnerState = 'free';
    partnerSeen = 0;
    partnerDownFor = 0;
    partner.setProne(false);
    hud.showToast(`${partnerName.toUpperCase()} IS BACK ON THEIR FEET`, 'good');
  }

  /** Left down too long: the guards take the partner away, and the job goes on without them (the lift no longer waits). */
  function losePartner(): void {
    if (!partner) return;
    hud.showToast(`${partnerName.toUpperCase()} WAS TAKEN · YOU ARE ON YOUR OWN`, 'bad', 4200);
    sound.play('alert');
    partner.mesh.visible = false;
    partner.place(0, -500, 0, -50);
    partner = null;
    hud.setPartner(null);
  }

  /** The partner's distance fields over its floor's corridors, one per goal cell (the goal moves cell to cell, so they are kept a moment). */
  const partnerNav = new Map<string, number[][]>();
  /** The opening it is heading for, kept for a moment: re-picking every frame from its rounded cell made it dither between two goals at a cell boundary while it turned. */
  let navLock: { x: number; z: number; key: string; until: number } | null = null;

  let partnerByCorridors = false; // (going to you by the corridors, not along your path: kept until it is near, so it does not dither at the edge)

  /** Steering round what stands in a corridor (a desk, a pair of crates): the corridors know the walls, not the furniture, so a straight line to the next opening walks into it. */
  const partnerAvoid = new Avoider();
  /** The point to steer for on the way to (x, z): the target itself when the way is clear, else a step turned aside round the box in the way. */
  function partnerAim(me: { x: number; z: number }, target: { x: number; z: number }, walls: WallBox[], stance: { sneak: boolean; prone: boolean }, dt: number): { x: number; z: number } {
    const near = walls.filter((b) => b.maxX > me.x - 3 && b.minX < me.x + 3 && b.maxZ > me.z - 3 && b.minZ < me.z + 3 && !(stance.prone && b.under) && !(stance.sneak && b.duct));
    // (Brushing against a box already, which the steering would take for being inside it and go straight on into: it works out the way round with a slimmer body.)
    const r = PLAYER_R + 0.04;
    const step = partnerAvoid.step(me.x, me.z, target.x, target.z, 1.1, blockedAt(me.x, me.z, r, near) ? 0.2 : r, near, dt);
    return Math.hypot(step.x - me.x, step.z - me.z) < 1e-6 ? target : step;
  }

  /** The flight it has started to cross (and from which floor), for a moment. */
  let partnerCross: { stair: Stair; floor: number; until: number } | null = null;

  /** A way between two floors the partner can use: a flight (walked) or a lift (ridden, where you would). */
  type PartnerWay = FloorLink & { stair?: Stair; lift?: { from: { level: number; rig: ElevatorRig }; to: { level: number; rig: ElevatorRig } } };

  /** Every stair and lift between floors the partner can take now: the flights that are open, the lifts that are not locked (a lift takes it one storey, as it takes you). */
  function partnerWays(): PartnerWay[] {
    const ways: PartnerWay[] = [];
    for (const st of stairs) {
      if (st.fromFloorY === st.toFloorY || ((st as { id?: string }).id === 'core' && !coreOpen)) continue; // (a container's roof is no way between floors)
      const a = Math.round(st.fromFloorY / floorHeight);
      const b = Math.round(st.toFloorY / floorHeight);
      // (The bunker's flights go both ways: the wall at the foot of the flight, on the storey above, is open to whoever comes down it.)
      if (a !== b) ways.push(bunker ? { a: Math.min(a, b), b: Math.max(a, b), kind: 'stair', ref: 0, stair: st } : { a, b, kind: 'stair', ref: 0, stair: st });
    }
    for (const l of towerLifts) {
      const def = TOWER_LIFTS.find((t) => t.id === l.id);
      if (!def || (def.locked && !hasKey)) continue;
      const next = def.serves[def.serves.indexOf(l.level) + 1];
      const to = next === undefined ? undefined : towerLifts.find((t) => t.id === l.id && t.level === next);
      if (to) ways.push({ a: l.level, b: to.level, kind: 'lift', ref: 0, lift: { from: l, to } });
    }
    return ways;
  }

  /** What the partner is doing to get to another floor: where it heads now, and the lift to ride when it has got to the doors. */
  type PartnerGoal = { x: number; z: number; waypoint?: boolean; ride?: PartnerWay; direct?: boolean };
  let partnerCabLined = false; // (in a lift's cab, lined up on the way out through its doors)

  /**
   * Where the partner heads when the straight way to its spot is shut (a wall between, you came by the pipes or a vent, you are on another floor): the middle of the next corridor cell
   * on the way to you, by the floor's own passages (doors that are locked count as walls). On another floor: by the stairs and lifts (partnerWays) that lead to yours, to the foot of the flight
   * and straight up it, or to the lift's doors to ride it. Null when there is no way (then it walks straight, or waits).
   */
  function partnerNavGoal(floor: ActiveFloor, sameFloor: boolean): PartnerGoal | null {
    if (!partner) return null;
    const { navCells, cols, rows } = floor.content;
    const o = floor.rig.group.position;
    const fi = partner.currentFloorIdx;
    // In a lift's cab (after a ride): out through its doors, along the line from the middle of the cab to them, not at a slant across the door jamb; and on out to just past them.
    for (const l of towerLifts) {
      if (l.level !== fi) continue;
      const mid = { x: l.rig.spawn.x + o.x, z: l.rig.spawn.z + o.z };
      const door = { x: l.rig.front.x + o.x, z: l.rig.front.z + o.z };
      const toDoor = Math.hypot(partner.worldX - door.x, partner.worldZ - door.z);
      const inside = l.rig.contains(partner.worldX - o.x, partner.worldZ - o.z);
      if (!inside && !(partnerCabLined && toDoor < 2.4)) continue;
      if (toDoor < 0.6) {
        partnerCabLined = false; // (out: the way on is the usual one)
        break;
      }
      const len = Math.hypot(door.x - mid.x, door.z - mid.z) || 1;
      const off = Math.abs((door.x - mid.x) * (partner.worldZ - mid.z) - (door.z - mid.z) * (partner.worldX - mid.x)) / len; // how far it is from that line
      // (At the middle it is lined up: from there it heads straight out, and keeps to it however it is nudged off the line.)
      if (Math.hypot(partner.worldX - mid.x, partner.worldZ - mid.z) < 0.5) partnerCabLined = true;
      return partnerCabLined || off <= 0.35 ? { x: door.x, z: door.z, waypoint: true, direct: true } : { x: mid.x, z: mid.z, waypoint: true, direct: true };
    }
    const here0 = { x: partner.worldX - o.x, z: partner.worldZ - o.z };
    if (!towerLifts.some((l) => l.level === fi && l.rig.contains(here0.x, here0.z))) partnerCabLined = false;
    let goal: { x: number; z: number };
    if (sameFloor) {
      goal = { x: player.worldX, z: player.worldZ };
    } else {
      const all = partnerWays();
      let way = nextLink(all, fi, activeFloorIdx);
      if (!way) return null;
      // Two ways between the same pair of floors (a flight at each end of the hall, a flight and a lift): the one whose entrance is nearest to it.
      const first = way;
      const twins = all.filter((w) => (w.a === first.a && w.b === first.b) || (w.a === first.b && w.b === first.a));
      if (twins.length > 1) {
        const entrance = (w: PartnerWay): { x: number; z: number } => {
          if (w.stair) {
            const e = flightEnds(w.stair, CELL);
            return Math.round(w.stair.fromFloorY / floorHeight) === fi ? e.foot : e.head;
          }
          const rec = w.lift!.from.level === fi ? w.lift!.from : w.lift!.to;
          return { x: rec.rig.front.x + o.x, z: rec.rig.front.z + o.z };
        };
        let bestD = Infinity;
        for (const w of twins) {
          // (One it is already on, or has set off along, is the one it takes.)
          if (w.stair && (stairGroundHeight(w.stair, partner.worldX, partner.worldZ, CELL) !== null || (partnerCross && partnerCross.stair === w.stair && partnerCross.floor === fi && stats.seconds < partnerCross.until))) {
            way = w;
            break;
          }
          const e = entrance(w);
          const d = Math.hypot(e.x - partner.worldX, e.z - partner.worldZ);
          if (d < bestD) {
            bestD = d;
            way = w;
          }
        }
      }
      if (way.stair) {
        // Up (or down) a flight: to the cell before its first step, then straight along it to the cell past the last. (Its run is not part of the corridors on either floor, so only the two ends are reached by them.)
        const e = flightEnds(way.stair, CELL);
        const fromHere = Math.round(way.stair.fromFloorY / floorHeight) === fi;
        const end = fromHere ? e.head : e.foot;
        const start = fromHere ? e.foot : e.head;
        // (Once it has set off along the flight it keeps going for a few seconds, however near or far the foot is measured from: it does not turn back at the first step.)
        if (partnerCross && partnerCross.floor === fi && partnerCross.stair === way.stair && stats.seconds < partnerCross.until) return { x: end.x, z: end.z };
        if (stairGroundHeight(way.stair, partner.worldX, partner.worldZ, CELL) !== null || Math.hypot(partner.worldX - start.x, partner.worldZ - start.z) < 1.4) {
          partnerCross = { stair: way.stair, floor: fi, until: stats.seconds + 3.5 };
          return { x: end.x, z: end.z };
        }
        goal = start;
      } else {
        const lift = way.lift!;
        const here = lift.from.level === fi ? lift.from : lift.to;
        const doors = { x: here.rig.front.x + o.x, z: here.rig.front.z + o.z };
        if (here.rig.contains(partner.worldX - o.x, partner.worldZ - o.z) || Math.hypot(partner.worldX - doors.x, partner.worldZ - doors.z) < 1.2) return { x: doors.x, z: doors.z, ride: way };
        goal = doors;
      }
    }
    // (The cell a point is in, or when that one has no way out of it, as a lift's cab has not, the nearest of its neighbours that has.)
    let gcx = Math.round((goal.x - o.x) / CELL);
    let gcy = Math.round((goal.z - o.z) / CELL);
    const opens = (cx: number, cy: number): boolean => {
      const c = navCells[cy]?.[cx];
      return !!c && (c.N || c.S || c.E || c.W);
    };
    if (!opens(gcx, gcy)) {
      let bestD = Infinity;
      let pick: readonly [number, number] | null = null;
      for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]] as const) {
        const d = Math.hypot(o.x + (gcx + dx) * CELL - goal.x, o.z + (gcy + dy) * CELL - goal.z);
        if (opens(gcx + dx, gcy + dy) && d < bestD) {
          bestD = d;
          pick = [dx, dy];
        }
      }
      if (pick) {
        gcx += pick[0];
        gcy += pick[1];
      } else if (sameFloor) {
        // You are somewhere no corridor leads (a duct, the middle of a stairwell): it waits at the nearest place it can reach.
        return partnerWaitGoal(floor);
      }
    }
    const key = `${fi}:${gcx},${gcy}`;
    let dist = partnerNav.get(key);
    if (!dist) {
      if (partnerNav.size > 24) partnerNav.clear();
      dist = bfs(navCells, cols, rows, gcx, gcy);
      partnerNav.set(key, dist);
    }
    const mx = Math.max(0, Math.min(cols - 1, Math.round((partner.worldX - o.x) / CELL)));
    const my = Math.max(0, Math.min(rows - 1, Math.round((partner.worldZ - o.z) / CELL)));
    const here = dist[my]?.[mx] ?? -1;
    if (here === 0) navLock = null; // (in the goal's own cell: nothing left to hold on to)
    else if (navLock && navLock.key === key && stats.seconds < navLock.until && Math.hypot(partner.worldX - navLock.x, partner.worldZ - navLock.z) > 0.5) return { x: navLock.x, z: navLock.z, waypoint: true };
    // On a floor of its own, shut off from where you are by the corridors (you went by a duct, or a shaft): it waits at the nearest place to you that it can reach.
    if (here < 0 && sameFloor && opens(mx, my)) return partnerWaitGoal(floor);
    if (here < 0) {
      // Standing where no corridor goes (a lift's cab, a flight's last step, a cell the plan shut): to the nearest cell that does lead to the goal.
      // (One it can see: a cell the other side of a wall would be a walk into the wall.)
      const seen = (x: number, y: number): boolean => clearWalk(partner!.worldX, partner!.worldZ, o.x + x * CELL, o.z + y * CELL, floor.rig.wallBoxes);
      const near = nearestOpenCell(dist, mx, my, seen) ?? nearestOpenCell(dist, mx, my);
      return near && (near.x !== mx || near.y !== my) ? { x: o.x + near.x * CELL, z: o.z + near.y * CELL, waypoint: true } : null;
    }
    if (here === 0) return { x: goal.x, z: goal.z };
    let best: PartnerGoal | null = null;
    let bestD = here;
    for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]] as const) {
      if (!navCells[my]?.[mx]?.[d]) continue;
      const nd = dist[my + dy]?.[mx + dx] ?? -1;
      if (nd >= 0 && nd < bestD) {
        bestD = nd;
        // The middle of the opening into that cell, not the middle of the cell itself: a straight line from anywhere in this cell to the opening stays inside it (no wall corner to catch on),
        // and it goes on pointing the same way as the partner crosses, so it cannot dither between two goals at a cell boundary.
        best = { x: o.x + (mx + dx / 2) * CELL + dx * 0.4, z: o.z + (my + dy / 2) * CELL + dy * 0.4, waypoint: true }; // (a step past the opening, so it is across it, not stopped on the line where the cell it is in changes)
        navLock = { x: best.x, z: best.z, key, until: stats.seconds + 3 };
      }
    }
    return best;
  }

  /** Whether a body can walk straight from (ax, az) to (bx, bz): nothing across the way, at its own width (a line that just clears a wall's corner is no way through). */
  function clearWalk(ax: number, az: number, bx: number, bz: number, walls: WallBox[]): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    for (let k = 1; k <= Math.ceil(d / 0.4); k++) {
      const t = (k * 0.4) / d;
      if (t < 1 && collides(ax + (bx - ax) * t, az + (bz - az) * t, walls)) return false;
    }
    return !collides(bx, bz, walls);
  }

  /** The cell the partner waits in while you are up where it cannot follow (kept for a moment): the one on its floor that it can reach, nearest to you. */
  const partnerWait = { x: 0, z: 0, until: -1, floor: -1 };
  function partnerWaitGoal(floor: ActiveFloor): { x: number; z: number } | null {
    if (!partner) return null;
    if (stats.seconds < partnerWait.until && partnerWait.floor === partner.currentFloorIdx) return partnerWait;
    const o = floor.rig.group.position;
    const { navCells, cols, rows } = floor.content;
    const dist = bfs(navCells, cols, rows, Math.round((partner.worldX - o.x) / CELL), Math.round((partner.worldZ - o.z) / CELL));
    const lx = Math.round((player.worldX - o.x) / CELL);
    const ly = Math.round((player.worldZ - o.z) / CELL);
    const cell = nearestOpenCell(dist, lx, ly);
    if (!cell) return null;
    // (Two cells as near as each other: it stays at the one it was at, rather than going back and forth.)
    const kx = Math.round((partnerWait.x - o.x) / CELL);
    const ky = Math.round((partnerWait.z - o.z) / CELL);
    const keep = partnerWait.floor === partner.currentFloorIdx && (dist[ky]?.[kx] ?? -1) >= 0 && Math.hypot(kx - lx, ky - ly) <= Math.hypot(cell.x - lx, cell.y - ly) + 1;
    if (!keep) Object.assign(partnerWait, { x: o.x + cell.x * CELL, z: o.z + cell.y * CELL, floor: partner.currentFloorIdx });
    partnerWait.until = stats.seconds + 0.8;
    return partnerWait;
  }

  /** A free spot on the partner's floor to be put at, near (x, z): the middle of the nearest cell that has a way out and nothing standing in it. */
  function partnerFreeSpot(floor: ActiveFloor, x: number, z: number): { x: number; z: number } {
    const o = floor.rig.group.position;
    const { navCells, cols, rows } = floor.content;
    let best = { x, z };
    let bestD = Infinity;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = navCells[cy]![cx]!;
        if (!(c.N || c.S || c.E || c.W)) continue;
        const px = o.x + cx * CELL;
        const pz = o.z + cy * CELL;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD && !collides(px, pz, floor.rig.wallBoxes)) {
          bestD = d;
          best = { x: px, z: pz };
        }
      }
    }
    return best;
  }

  /** Where to put the partner back on your floor: on your path, a few metres behind you; not where that is inside a wall (you came over it) or you are up where it cannot stand. */
  function partnerBackSpot(floor: ActiveFloor, here: { x: number; z: number }): { x: number; z: number } {
    const back = partnerTrail.pointBehind(here, 3.4);
    if (!leaderUp() && !collides(back.x, back.z, floor.rig.wallBoxes)) return back;
    return partnerFreeSpot(floor, here.x, here.z);
  }

  /** Whether (x, z) is within `cells` cells of one of the bunker's ducts on storey `level` (a lane through the cells of a duct, crouched or flat). */
  const inDuct = (x: number, z: number, level: number, cells: number): boolean => ductsOn(level).some((d) => d.cells.some((c) => Math.hypot(x - c.x * CELL, z - c.y * CELL) < CELL * cells));

  /** The partner rides a lift where you would: out in a flash at its doors, in again in the cab of the next storey it serves. */
  function partnerRideLift(way: PartnerWay): void {
    if (!partner || !way.lift || partnerBlink) return; // (already on its way: the blink takes a moment)
    const to = partner.currentFloorIdx === way.lift.from.level ? way.lift.to : way.lift.from;
    const at = to.rig.spawn;
    const o = storeys[to.level]!.rig.group.position;
    sound.play('liftDoors', { x: o.x + to.rig.front.x, y: to.level * floorHeight + 1.2, z: o.z + to.rig.front.z }, 0.5);
    regroupPartner(o.x + at.x, o.z + at.z, at.facing, to.level * floorHeight);
  }

  /** One frame of the partner, from inside the main loop (it needs this frame's posture and the stair). */
  // A partner that has lost the agent is put back with them. Done by popping from one place to the other it reads as a glitch, so it phases: out in a column of light where it
  // stood, gone for a moment, in again where it belongs.
  let partnerBlink: { left: number; to: { x: number; z: number; f: number; y: number | undefined } } | null = null;
  const BLINK_S = 0.4;
  function regroupPartner(x: number, z: number, f: number, y?: number): void {
    if (!partner || partnerBlink) return;
    blasts.phase(new THREE.Vector3(partner.worldX, partner.worldY, partner.worldZ));
    sound.play('gogglesOn', { x: partner.worldX, y: partner.worldY + 1, z: partner.worldZ }, 0.35);
    partner.mesh.visible = false;
    partnerBlink = { left: BLINK_S, to: { x, z, f, y } };
  }

  function updatePartner(dt: number, stance: { sneak: boolean; prone: boolean; dash: boolean }): void {
    if (!partner) return;
    if (partnerBlink) {
      partnerBlink.left -= dt;
      if (partnerBlink.left > 0) return;
      const to = partnerBlink.to;
      partnerBlink = null;
      partner.place(to.x, to.z, to.f, to.y);
      partner.mesh.visible = true;
      partnerTrail.clear();
      blasts.phase(new THREE.Vector3(partner.worldX, partner.worldY, partner.worldZ));
    }
    // Shut in the arrival cab (the doors closed with it still inside): out in front of the doors.
    if (arrivalPhase === 'done' && partner.currentFloorIdx === 0 && partner.worldY < 1 && arrival.contains(partner.worldX, partner.worldZ)) {
      partner.place(arrival.front.x, arrival.front.z, arrival.spawn.facing, 0);
      partnerTrail.clear();
    }
    const floor = partnerFloor();
    const walls = floor.rig.wallBoxes;
    const lasers = floor.content.laserBoxes;
    const sameFloor = partner.currentFloorIdx === activeFloorIdx;
    const stairsNow = stairsAt(partner.worldY); // (the flights it can be on at its height: the tower's are stacked in one footprint)
    const up = leaderUp();
    const blockers: Blocker[] = floor.content.enemies.filter((b) => !b.disabled && b.radius > 0).map((b) => ({ x: b.worldX, z: b.worldZ, r: b.radius }));
    partnerCooldown = Math.max(0, partnerCooldown - dt);
    partnerTrying = false;
    const idle = { turn: 0, throttle: 0, strafe: 0, sneak: false, prone: false, dash: false, camo: false, carrying: false, cover: false };
    const here = { x: player.worldX, z: player.worldZ };
    const reach = Math.hypot(partner.worldX - here.x, partner.worldZ - here.z);
    partner.setWeaponState(1, 0, clock.elapsedTime);
    // The cloak goes on and off with yours (so the laser beams don't stop it either, and it shimmers the same).
    const partnerCamo = partnerState === 'free' && camo.active;
    partner.setCamo(partnerCamo, clock.elapsedTime);
    partnerTrail.push(here.x, here.z);
    if (partnerState === 'down') {
      // Waiting in the open exit for a partner who is down: after a few seconds the lift takes the agent without them (exitReady).
      partnerLiftWait = player.currentFloorIdx === exitFloorIdx && exitLift.contains(here.x, here.z) ? partnerLiftWait + dt : 0;
      partner.tick({ ...idle, prone: true }, dt, walls, [], [], stairsNow);
      partner.stepLie(dt);
      partnerDownFor += dt;
      if (partnerWorking) {
        partnerHold = holdProgress(partnerHold, reach <= RESCUE_REACH && sameFloor && !caught && !cleared, dt, REVIVE_S);
        if (partnerHold >= 1) finishPartnerWork();
        else if (partnerHold <= 0 && reach > RESCUE_REACH) partnerWorking = false;
      }
      if (partnerDownFor >= DOWN_FAIL_S && !caught && !cleared) {
        losePartner();
        return;
      }
    } else if (arrivalPhase === 'waiting') {
      // Still in the lift, the doors shut: standing about.
      partner.tick(idle, dt, walls, [], [], stairsNow);
    } else {
      const leader = { x: here.x, z: here.z, angle: player.facingAngle, sneak: stance.sneak, prone: stance.prone, dash: stance.dash, moving: player.moving };
      const me = { x: partner.worldX, z: partner.worldZ, angle: partner.facingAngle };
      const blockersNow = sameFloor ? [{ x: here.x, z: here.z, r: PLAYER_R }, ...blockers] : blockers;
      const inExit = player.currentFloorIdx === exitFloorIdx && exitLift.contains(here.x, here.z);
      partnerLiftWait = inExit ? partnerLiftWait + dt : 0;
      // You are in cover: it finds furniture of its own near you and takes cover there, and holds it until you leave yours.
      if (!inCover || inExit || !sameFloor) {
        partnerCover = null;
        partnerCoverReady = false;
        partnerCoverTry = 0;
      } else if (stats.seconds - partnerCoverLookAt > (partnerCover ? 1.5 : 0.5)) {
        partnerCoverLookAt = stats.seconds;
        const bearings = partnerBearings();
        const pick = findPartnerCover(bearings);
        if (!partnerCover) {
          partnerCover = pick?.spot ?? null;
          partnerCoverReady = false;
        } else if (pick && pick.spot !== partnerCover && !(Math.hypot(pick.spot.px - partnerCover.px, pick.spot.pz - partnerCover.pz) < 0.5)) {
          // Already behind something: only move if somewhere is clearly better now (a patrol turned the other way), not for a small gain.
          const nowScore = coverScore(partnerCover, me, leader, inCover ? { nx: inCover.nx, nz: inCover.nz } : null, bearings);
          if (pick.score + 2.5 < nowScore) {
            partnerCover = pick.spot;
            partnerCoverReady = false;
          }
        }
      }
      let input: { turn: number; throttle: number; sneak: boolean; prone: boolean; dash: boolean };
      let inCoverNow = false;
      if (arrivalPhase === 'open' && !arrival.isOutside(me.x, me.z)) {
        // The arrival doors are open and it is still in the cab: out through them (they stay open until it is).
        input = goInput(me, arrival.front, { sneak: false, prone: false }, 0.4, false);
      } else if (inExit) {
        // You are in the exit: it comes in after you, as far as the cab lets it (by the corridors if a wall is in the way, and straight in at the doors).
        const inCab = partner.currentFloorIdx === exitFloorIdx && exitLift.contains(me.x, me.z);
        const toFront = Math.hypot(me.x - exitLift.front.x, me.z - exitLift.front.z);
        const aim = inCab || toFront < 1.2 ? here : exitLift.front;
        const blocked = !sameFloor || !hasLineOfSight(me.x, me.z, aim.x, aim.z, walls, 40);
        const nav = blocked ? partnerNavGoal(floor, sameFloor) : null;
        const step = goInput(me, nav ?? aim, { sneak: false, prone: false }, nav?.waypoint ? 0.25 : 0.9, true);
        input = inCab || step.arrived ? { turn: turnToward(me.angle, leader.angle), throttle: 0, sneak: false, prone: false, dash: false } : step;
        // Stuck outside for long enough (a door, a corner, the other floor): it is brought to the cab, beside you.
        if (!inCab && partnerLiftWait > 5) {
          const f = exitLift.spawn.facing;
          regroupPartner(exitLift.spawn.x - Math.sin(f) * 0.9, exitLift.spawn.z - Math.cos(f) * 0.9, f, exitFloorIdx * floorHeight);
        }
      } else if (partnerCover) {
        const spot = partnerCover;
        if (!partnerCoverReady) {
          partnerCoverTry += dt;
          // Not there after a good while (something in the way): it forgets that spot and goes back to following you.
          if (partnerCoverTry > 5) {
            partnerCover = null;
            partnerCoverTry = 0;
          }
          const step = goInput(me, { x: spot.px, z: spot.pz }, { sneak: true, prone: false }, 0.3, true);
          if (step.arrived) {
            partnerCoverReady = true;
            partner.place(spot.px, spot.pz, coverFacing(spot));
          }
          input = step;
        } else {
          input = { turn: 0, throttle: 0, sneak: true, prone: false, dash: false };
        }
        inCoverNow = partnerCoverReady;
      } else {
        // Along your path; but where the straight way to its spot is shut (a wall, another floor), by the corridors.
        // (You up where it cannot walk: it waits at the nearest place it can reach, and looks your way.)
        const spot = followTarget(me, leader, partnerTrail);
        // (Well behind it goes by the corridors, the shortest way: your own path may have gone the long way round, to a door and back.)
        partnerByCorridors = sameFloor && byCorridors(partnerByCorridors, reach);
        // (A duct is no corridor of the plan: where you crawl in, it crouches and comes after you along your path, and out again.)
        const ductWay = bunker && sameFloor && !up && (inDuct(here.x, here.z, activeFloorIdx, 0.75) || inDuct(me.x, me.z, partner.currentFloorIdx, 0.75)) && inDuct(me.x, me.z, partner.currentFloorIdx, 2.2);
        const blocked = !ductWay && (!sameFloor || up || partnerByCorridors || !hasLineOfSight(me.x, me.z, spot.x, spot.z, walls, 40));
        const goal: PartnerGoal | null = up && sameFloor ? partnerWaitGoal(floor) : blocked ? partnerNavGoal(floor, sameFloor) : null;
        if (goal?.ride) {
          // At a lift's doors on the way to your floor: it rides.
          input = { turn: 0, throttle: 0, sneak: false, prone: false, dash: false };
          partnerRideLift(goal.ride);
        } else if (goal) {
          // (A waypoint at the opening into the next cell is never 'arrived at': it is walked through, and the next one takes over as the partner crosses.)
          // (Far behind a sneaking leader it runs to catch up; near, it creeps as they do.)
          const gait = { sneak: stance.sneak && (reach < CATCH_UP || stance.prone), prone: false };
          const stepGoal = goInput(me, goal, gait, goal.waypoint ? 0.25 : up ? UP_HOLD_REACH * 0.3 : 0.5, true);
          // (It steers for a point aside when something stands in the way, but is there when it is at the goal.)
          const step = stepGoal.arrived || goal.direct ? stepGoal : goInput(me, partnerAim(me, goal, walls, gait, dt), gait, 0.25, true);
          input = up && step.arrived ? { turn: turnToward(me.angle, headingTo(me, here)), throttle: 0, sneak: false, prone: false, dash: false } : { ...step, dash: stepGoal.dash && reach > CATCH_UP && !stance.prone && !up }; // (it runs only along a straight stretch: at full tilt it overshoots a waypoint and has to turn round to it)
        } else if (!sameFloor) {
          // No stairs or lift to you (you went up by a climb, a shaft or a drop): it stays put; after a while it is put beside you.
          input = { turn: 0, throttle: 0, sneak: false, prone: false, dash: false };
          partnerNoWayFor += dt;
        } else {
          input = followInput(me, ductWay ? { ...leader, sneak: true, prone: false } : leader, partnerTrail); // (crouched in a duct: a lane it fits at a creep, not the crawl, which would have it a long way behind)
          if (input.throttle > 0) input = { ...input, turn: turnToward(me.angle, headingTo(me, partnerAim(me, spot, walls, input, dt))) };
        }
        if (sameFloor || goal) partnerNoWayFor = 0;
      }
      partnerTrying = input.throttle > 0.2;
      partnerTryLeft = partnerTrying ? 0.6 : Math.max(0, partnerTryLeft - dt); // (a throttle that flickers about the threshold is still trying)
      partner.tick({ ...idle, turn: input.turn, throttle: input.throttle, sneak: input.sneak && !input.prone, prone: input.prone, dash: input.dash && !input.sneak, cover: inCoverNow, camo: partnerCamo }, dt, walls, blockersNow, lasers, stairsNow);
      partner.setProne(input.prone);
      partner.stepLie(dt);
      // Watching your back while you work a console: a guard that comes up on you gets shot.
      if ((activeHack !== null || activeTask !== null) && partnerCooldown <= 0 && sameFloor) {
        const threat = partnerTarget(LOOKOUT_RANGE, null);
        if (threat) {
          partnerCooldown = BACKUP_COOLDOWN_S;
          hud.showToast(`${partnerName.toUpperCase()} · COVERING YOU`, 'good', 1400);
          partnerShoot(threat);
        }
      }
      // Backup on its own: a guard coming up on either of you gets shot, whether or not you have fired.
      if (partnerCooldown <= 0) {
        const threat = partnerThreat(stance);
        if (threat) {
          partnerCooldown = AUTO_COOLDOWN_S;
          if (stats.seconds - partnerCalledAt > 6) {
            partnerCalledAt = stats.seconds;
            hud.showToast(`${partnerName.toUpperCase()} · CONTACT · COVERING`, 'good', 1400);
          }
          window.setTimeout(() => !signal.aborted && !caught && !cleared && partnerShoot(threat), 250);
        }
      }
      // A guard with a clear look at the partner, for long enough, puts it down.
      let seen = false;
      const range = sightOf(DETECT_RADIUS, input.sneak, input.prone);
      for (const e of floor.content.enemies) {
        if (!(e instanceof Bot) || e.disabled) continue;
        const dx = partner.worldX - e.worldX;
        const dz = partner.worldZ - e.worldZ;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        let off = Math.abs(Math.atan2(dx, dz) - e.facing) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        if ((off < 1.0 || e.kind === 'hunter') && hasLineOfSight(e.worldX, e.worldZ, partner.worldX, partner.worldZ, walls, range)) {
          seen = true;
          break;
        }
      }
      partnerSeen = seenFor(partnerSeen, seen, dt);
      // (In the exit level the hunters are all over both of you: it takes them longer to put it down, and a loud shoot-up is not made worse by it.)
      if (partnerSeen >= (exitMode ? SEEN_DOWN_S * 2.2 : SEEN_DOWN_S)) partnerGoesDown();
    }
    // Lost for good (outside the walls, round a loop it can't close): a long way off for a long time puts it back on your path.
    partnerFarFor = partnerState === 'free' && sameFloor && reach > LOST_FAR_M && !inCover && !up ? partnerFarFor + dt : 0;
    if (partnerFarFor > LOST_FAR_S) {
      const back = partnerBackSpot(floor, here);
      regroupPartner(back.x, back.z, partner.facingAngle);
      partnerFarFor = 0;
    }
    // On another floor with nothing that leads to yours (you climbed, drew up a shaft or dropped): beside you after a while.
    if (sameFloor) partnerNoWayFor = 0;
    else if (partnerState === 'free' && partnerNoWayFor > NO_WAY_S) {
      partnerNoWayFor = 0;
      const spot = partnerFreeSpot(storeys[activeFloorIdx]!, here.x - Math.sin(player.facingAngle) * 2.2, here.z - Math.cos(player.facingAngle) * 2.2);
      regroupPartner(spot.x, spot.z, player.facingAngle, activeFloorIdx * floorHeight);
    }
    // Standing about a long way from you, not trying to walk anywhere (a goal it thinks it has reached, a wait that never ends): put back on your path.
    partnerIdleFar = partnerState === 'free' && sameFloor && !up && partnerTryLeft <= 0 && !partnerCoverReady && !partnerWorking && reach > NAV_FAR && arrivalPhase === 'done' ? partnerIdleFar + dt : 0;
    if (partnerIdleFar > 3) {
      partnerIdleFar = 0;
      const back = partnerBackSpot(floor, here);
      regroupPartner(back.x, back.z, partner.facingAngle);
    }
    // A partner that is trying to walk but is not getting anywhere (wedged in a doorway or on a corner, or on the wrong floor with no way down) for a while: put back with you.
    if (partnerState === 'free' && !partnerCoverReady) {
      if (Math.hypot(partner.worldX - partnerStuck.x, partner.worldZ - partnerStuck.z) > 0.7 || partnerTryLeft <= 0) { // (a creep to and fro against a corner is not getting anywhere)
        partnerStuck.x = partner.worldX;
        partnerStuck.z = partner.worldZ;
        partnerStuck.t = 0;
      } else {
        partnerStuck.t += dt;
        if (wedged(partnerStuck.t, sameFloor)) {
          // On your floor: back on your path behind you. On another: beside you, on your floor.
          if (sameFloor) {
            const back = partnerBackSpot(floor, here);
            regroupPartner(back.x, back.z, partner.facingAngle);
          } else {
            const f = player.facingAngle;
            const spot = partnerFreeSpot(storeys[activeFloorIdx]!, here.x - Math.sin(f) * 2.2, here.z - Math.cos(f) * 2.2);
            regroupPartner(spot.x, spot.z, f, activeFloorIdx * floorHeight);
          }
          partnerStuck.x = partner.worldX;
          partnerStuck.z = partner.worldZ;
          partnerStuck.t = 0;
        }
      }
    }
    // The line about them on screen.
    const label = partnerName.toUpperCase();
    if (partnerState === 'down') {
      hud.setPartner(
        partnerWorking
          ? { text: `Bringing ${label} round`, tone: 'down', fraction: partnerHold }
          : { text: `${label} down · ${Math.max(0, Math.ceil(DOWN_FAIL_S - partnerDownFor))}s · hold Interact beside them`, tone: 'down' }
      );
    } else hud.setPartner({ text: `${label} · backing you up`, tone: 'free' });
  }

  // Heavy guns for the agent (game/bigguns.ts): the gun menu (key 2, the chip by the fire bar, the kit's Gun button) changes gun and the choice is kept in this browser. On localhost `?gun=AR_4` picks one.
  {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('mazeHeist.gun');
    } catch {
      /* no storage here */
    }
    const asked = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? new URLSearchParams(window.location.search).get('gun') : null;
    const pick = asked ?? saved;
    if (isBigGun(pick)) player.setBigGun(pick);
    hud.setGunName(gunShort(player.gunName));
  }
  // Two guns (the exit level): the left hand's gun, and whose turn it is. Fired one after the other, each shot comes twice as often as a single gun's. On localhost `&guns=SMG_1,AR_4` picks both.
  const dualOn = exitMode;
  let offhandGun: BigGun | null = null;
  let offTurn = false;
  const gunChip = (): string => (dualOn ? `${gunShort(player.gunName)} + ${gunShort(offhandGun)}` : gunShort(player.gunName));
  if (dualOn) {
    const asked = new URLSearchParams(window.location.search).get('guns')?.split(',') ?? [];
    let saved2: string | null = null;
    try {
      saved2 = localStorage.getItem('mazeHeist.gun2');
    } catch {
      /* no storage here */
    }
    if (isBigGun(asked[0])) player.setBigGun(asked[0]);
    offhandGun = isBigGun(asked[1]) ? asked[1] : isBigGun(saved2) ? saved2 : 'AR_4';
    player.setOffhand(true, offhandGun);
    hud.setGunName(gunChip());
  }
  // The gun menu (paused while it is up): its key (2), the chip by the fire pill and the kit's Gun button open it; a card or a number picks; its key or Esc closes.
  let gunMenuOpen = false;
  function openGunMenu(): void {
    if (gunMenuOpen || cleared || caught || paused()) return;
    gunMenuOpen = true;
    hud.showGunMenu(true, player.gunName);
  }
  function closeGunMenu(): void {
    if (!gunMenuOpen) return;
    gunMenuOpen = false;
    hud.showGunMenu(false);
  }
  /** Carries the gun with this id (null: the stun pistol) and closes the menu. */
  function pickGun(id: string | null): void {
    const next = id !== null && isBigGun(id) ? id : null;
    player.setBigGun(next);
    try {
      if (next) localStorage.setItem('mazeHeist.gun', next);
      else localStorage.removeItem('mazeHeist.gun');
    } catch {
      /* no storage here */
    }
    hud.setGunName(gunChip());
    hud.showToast(next ? `${dualOn ? 'RIGHT HAND' : 'GUN'} · ${gunLabel(next).toUpperCase()}` : 'GUN · STUN PISTOL', 'neutral');
    closeGunMenu();
  }
  /** The left hand's gun (the exit level): Shift and the gun's number in the menu. */
  function pickOffhand(id: string | null): void {
    const next = id !== null && isBigGun(id) ? id : null;
    offhandGun = next;
    player.setOffhand(true, next);
    try {
      if (next) localStorage.setItem('mazeHeist.gun2', next);
    } catch {
      /* no storage here */
    }
    hud.setGunName(gunChip());
    hud.showToast(`LEFT HAND · ${next ? gunLabel(next).toUpperCase() : 'STUN PISTOL'}`, 'neutral');
    closeGunMenu();
  }
  window.addEventListener(
    'keydown',
    (ev) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      if (gunMenuOpen) {
        if (ev.code === keyMap.gun || ev.code === 'Escape') {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          closeGunMenu();
        } else if (/^Digit[0-9]$/.test(ev.code)) {
          const id = hud.gunForNumber(Number(ev.code.slice(5)));
          if (id !== undefined) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (dualOn && ev.shiftKey) pickOffhand(id);
            else pickGun(id);
          }
        }
        return;
      }
    },
    { signal, capture: true }
  );
  player.place(arrival.spawn.x, arrival.spawn.z, arrival.spawn.facing);
  const explored = freshExplored(cols, rows);
  updateVision(floor0, explored, player.worldX, player.worldZ, player.facingAngle, floor0.wallBoxes); // reveal the spawn cell immediately

  const beam = new TorchBeam(root.scene);
  const cones = new VisionCones(root.scene);
  const dust = new Dust(root.scene);
  const activeAssemblies: AssemblyEffect[] = [];
  const activeTracers: Tracer[] = [];
  const activeFlares: Flare[] = [];

  // A staircase connects floor 0 to a second, independently-generated maze
  // layer stacked FLOOR_HEIGHT above it in the same scene — true 3D
  // vertical movement, not a portal-style floor swap (see stairs.ts and
  // player.ts's currentFloorIdx). Placed first, before any other content,
  // so it gets first pick of a qualifying cell rather than competing with
  // leads/bots/hiding-spots/etc. for one.
  const used = new Set<string>([`${startCell.x},${startCell.y}`, `${exitX},${exitY}`]);
  // Nothing else goes in the landmark: its own dressing is all there is.
  if (landmark0) for (let y = landmark0.y0; y < landmark0.y0 + landmark0.h; y++) for (let x = landmark0.x0; x < landmark0.x0 + landmark0.w; x++) used.add(`${x},${y}`);
  // Training is all one floor, laid out by hand: nothing random goes anywhere in it.
  if (layout) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) used.add(`${x},${y}`);
  // Every stair takes two cells, so the climb is a gentle 27° (41° on a tall floor) rather than a 45° one; if there's nowhere for a straight two-cell run, a steep single cell.
  const floorHeight = bunker || (layout ? script?.pipes : diff.pipes) ? TALL_FLOOR_HEIGHT : FLOOR_HEIGHT;
  // One floor on the first job (difficulty.ts's floors), and in training.
  const upstairs = !layout && diff.floors > 1;
  const longStair = upstairs ? placeStair(cols, rows, cells, dist, used, 2, spur0?.[0]) : null;
  const stairCell = upstairs ? (longStair ?? placeStair(cols, rows, cells, dist, used)) : null;
  const stairRun = longStair ? 2 : 1;
  player.floorHeight = floorHeight;
  if (partner) partner.floorHeight = floorHeight;
  // The rest of the stair's run, and the floor-0 cell past the top of it,
  // only reachable by climbing — which lands you on floor 1 — so on floor 0
  // they're unreachable. Reserve them, or a fragment or room could land
  // somewhere no one can get to.
  if (stairCell) for (const c of stairReserved(stairCell, stairRun)) used.add(`${c.x},${c.y}`);
  // Nor does anything stand at the foot of the stair, where the way up begins.
  if (stairCell) used.add(`${stairCell.x - (stairCell.spanX ? 0 : 1)},${stairCell.y - (stairCell.spanX ? 1 : 0)}`);
  let stair: Stair | null = null;
  let floor1: FloorRig | null = null;
  let floor1Content: FloorContent | null = null;
    let explored1: ReturnType<typeof freshExplored> | null = null;

  // The job's actual win condition — the exit (scene.ts's setExitUnlocked())
  // stays locked until every document, from *either* floor, is taken from
  // its locker. Split roughly evenly, floor 1 rounded up, so once a stair
  // exists both floors always hold at least one (difficulty.ts's documents start
  // at 3) — that's what makes climbing mandatory rather than optional.
  // A contract other than records has its own steps and stations (objectives.ts) in place of the records rooms' files.
  const objectivePlan = planObjectives(contract, stairCell ? 2 : 1, Math.floor(Math.random() * 4));
  const objective = objectivePlan.steps.length > 0 ? objectivePlan : null;
  const requestedDocs = objective ? 0 : diff.documents;
  const floor1FragCount = stairCell ? Math.ceil(requestedDocs / 2) : 0;
  const floor0FragCount = requestedDocs - floor1FragCount;

  if (stairCell) {
    stair = { x: stairCell.x, y: stairCell.y, spanX: stairCell.spanX, fromFloorY: 0, toFloorY: floorHeight, run: stairRun };
    root.scene.add(buildStairMesh(stair, CELL));

    const { cols: cols1, rows: rows1 } = diff;
    const cells1 = floorPlan(cols1, rows1, 1);
    // The stairwell doorway: generateMaze never connects row 0 northward or
    // column 0 westward (there's no neighbor there), so that boundary wall
    // is otherwise always drawn regardless of cell (0,0)'s real
    // connections — punched open here so climbing the stairs doesn't just
    // walk the player straight into a wall the instant they arrive.
    if (stair.spanX) cells1[0]![0]!.N = true;
    else cells1[0]![0]!.W = true;

    const stairWorldX = stairCell.x * CELL;
    const stairWorldZ = stairCell.y * CELL;
    const originX = stairWorldX + (stair.spanX ? 0 : CELL * stairRun);
    const originZ = stairWorldZ + (stair.spanX ? CELL * stairRun : 0);
    floor1 = buildFloor(root, cells1, cols1, rows1, originX, originZ, floorHeight, place.floors[1]);
    // The second floor starts at the stairs and can spread out past the first: the ground, lamps and skyline round the building go
    // round both, instead of towers standing in the upper floor's maze.
    floor0.relayoutEdge?.([{ minX: originX - CELL / 2, maxX: originX + (cols1 - 1) * CELL + CELL / 2, minZ: originZ - CELL / 2, maxZ: originZ + (rows1 - 1) * CELL + CELL / 2 }]);
    explored1 = freshExplored(floor1.cols, floor1.rows);

    // Floor 1's own reachability/reservation state — entirely independent
    // of floor 0's `used`/`dist`, since it's a separate generated maze.
    const dist1 = bfs(cells1, cols1, rows1, 0, 0);
    const used1 = new Set<string>(['0,0']);
    const landmark1 = landmarkOf(cells1);
    if (landmark1) for (let y = landmark1.y0; y < landmark1.y0 + landmark1.h; y++) for (let x = landmark1.x0; x < landmark1.x0 + landmark1.w; x++) used1.add(`${x},${y}`);
    floor1Content = populateFloor(root, floor1, cells1, cols1, rows1, dist1, used1, diff, floor1FragCount, objective ? [] : ['logs'], { target: { x: 0, y: 0 }, label: 'STAIRS' }, [], undefined, {
      kind: 'hatch',
    }, objective ? { plan: objective, floor: 1 } : null);
  }

  const floor0Content = populateFloor(
    root,
    floor0,
    cells,
    cols,
    rows,
    dist,
    used,
    diff,
    floor0FragCount,
    // One network per building: the uplink on the ground floor, the log server upstairs when there is one.
    floor1Content || objective ? ['uplink'] : ['uplink', 'logs'],
    { target: { x: exitX, y: exitY }, label: 'EXIT' },
    [
      { x: 0, y: 0 },
      { x: exitX, y: exitY },
    ],
    script,
    layout ? undefined : { kind: 'grate', exitDist: dist[exitY]![exitX]! },
    objective ? { plan: objective, floor: 0 } : null
  );

  // Training gates: a door at the end of each station, opened as it's done.
  const gates = new Map<number, DoorRig>();
  for (const g of layout?.gates ?? []) {
    const rig = buildDoor(g, GATE_COLOR);
    floor0.group.add(rig.group);
    floor0.wallBoxes.push(rig.box);
    setPassage(floor0Content.navCells, g, false, cols, rows);
    gates.set(g.id, rig);
  }

  /** Every storey of the building, ground first: the heist has one or two (floor0 and floor1 are its first two), the tower more. Everything that asks "which floor" goes by index into this. */
  const storeys: Storey[] = [{ rig: floor0, content: floor0Content, explored }];
  if (floor1 && floor1Content && explored1) storeys.push({ rig: floor1, content: floor1Content, explored: explored1 });
  /** Every stair in the building: the heist's one, or the tower's. */
  const stairs: Stair[] = stair ? [stair] : [];
  // The tower's upper storeys: each its own floor in the same footprint, one above the other (towerplan.ts). Nobody is on them yet.
  if (tower) {
    for (let l = 1; l < TOWER_LEVELS.length; l++) {
      const rig = buildFloor(root, drawCells(l), TOWER_COLS, TOWER_ROWS, 0, 0, l * floorHeight, tThemes[l]!);
      // The passage to the lift is dressed in the heist's own look, so the other side is seen from the doorway.
      const heistPlace = placed(towerSetId);
      const heistLook: HeistLook = { wall: heistPlace.floors[0].wall, cap: heistPlace.floors[0].cap, fixture: heistPlace.floors[0].fixture, marking: heistPlace.floors[0].marking, label: `HEIST · ${heistPlace.name.toUpperCase()}` };
      const dressed = dressTowerLevel(rig, l, floorHeight, heistLook, towerSetId);
      registerFadables(rig, dressed.fadables);
      storeyPieces[l] = dressed.pieces;
      if (dressed.heist) towerHeist = { ...dressed.heist, k: 0 };
      for (const lift of dressed.lifts) towerLifts.push({ level: l, ...lift });
      if (dressed.keycard) towerCards.set(l, dressed.keycard);
      if (dressed.bonus) bridgeBonus = dressed.bonus;
      for (const d of dressed.officeDoors) officeDoors.push({ rig: d, level: l, k: 0, open: false });
      for (const c of dressed.cameras) towerCams.push({ rig: c, seen: 0, quietUntil: 0, lockUntil: 0, offUntil: 0, perm: false });
      if (dressed.timedStair) coreMesh = dressed.timedStair;
      for (const b of dressed.timedBarriers) {
        coreBarriers.push({ level: l, box: b });
        rig.wallBoxes.push(b); // (shut: the stair starts folded away)
      }
      const upper = parseTraining(levelMap(l));
      const start = (() => {
        for (let y = 0; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) if (walkable(l, x, y)) return { x, y };
        return { x: 0, y: 0 };
      })();
      const everything = new Set<string>();
      for (let y = 0; y < TOWER_ROWS; y++) for (let x = 0; x < TOWER_COLS; x++) everything.add(`${x},${y}`);
      const content = populateFloor(root, rig, upper.cells, TOWER_COLS, TOWER_ROWS, bfs(upper.cells, TOWER_COLS, TOWER_ROWS, start.x, start.y), everything, diff, 0, [], { target: start, label: 'STAIRS' }, [], towerScript(upper, l, towerSetId, exitMode), undefined, null);
      storeys.push({ rig, content, explored: freshExplored(TOWER_COLS, TOWER_ROWS) });
    }
    stairs.push(...gameStairs(floorHeight));
  }
  // The bunker's storeys (bunkerplan.ts): each its own floor in the same footprint, one above the other, joined by open stairs; the lowest is floor 0. Nobody is on the upper ones yet.
  if (bunker) {
    const sizes = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { len: v.len, depth: v.depth }]));
    for (let l = 0; l < BUNKER_LEVELS; l++) {
      let rig = floor0;
      if (l > 0) {
        rig = buildFloor(root, parseTraining(bunkerMap(l, true)).cells, cols, rows, 0, 0, l * floorHeight, place.floors[l % place.floors.length]!, undefined, undefined, () => true, BUNKER_WALL_H, true);
        const nav = parseTraining(bunkerMap(l, false));
        const from = stairEnds(BUNKER_STAIRS.find((s) => s.high === l)!).head[0]!;
        const everything = new Set<string>();
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) everything.add(`${x},${y}`);
        const content = populateFloor(root, rig, nav.cells, cols, rows, bfs(nav.cells, cols, rows, from.x, from.y), everything, diff, 0, [], { target: from, label: 'STAIRS' }, [], bunkerScript(nav, l), undefined, null);
        storeys.push({ rig, content, explored: freshExplored(cols, rows) });
      }
      // its furniture in pairs (the place's set; the lab first), its ducts, its shafts, its cameras
      const placed: Placed[] = bunkerPieces(sizes, coreLook ? 'core' : bunkerPlace, l).map((p) => ({
        level: l,
        kind: p.kind as Placed['kind'],
        x: Math.round(p.cx / CELL),
        y: Math.round(p.cz / CELL),
        edge: 'N' as const,
        along: 0,
        cx: p.cx,
        cz: p.cz,
        yaw: p.yaw,
        box: p.box,
        ...(p.slide ? { slide: p.slide } : {}),
        spec: KINDS[p.kind as keyof typeof KINDS],
      }));
      storeyPieces[l] = furnishPieces(rig, placed, stackSite ? STACK_FABRICS[stackSite] : coreLook ? CORE_FABRIC : FABRICS[bunkerPlace]);
      bunkerOpen[l] = openContainers(l, sizes, coreLook ? 'core' : bunkerPlace);
      // The sliding banks (the Annex): each with its model, its collision box and the wheel it is slid from, at the +x end (the north end when it lies the other way), as a container's door is.
      for (const p of placed) {
        if (p.kind !== 'bank' || !p.slide) continue;
        const d = storeyPieces[l]!.find((q) => q.kind === 'bank' && Math.abs(q.cx - p.cx) < 0.01 && Math.abs(q.cz - p.cz) < 0.01);
        if (!d?.group) continue;
        const along = p.yaw === 0;
        const bx = Math.round(p.cx / CELL - (along ? 0.5 : 0));
        const by = Math.round(p.cz / CELL - (along ? 0 : 0.5));
        const reach = p.spec.len / 2 + 1.2;
        const bank = { level: l, group: d.group, box: d.box, home: { ...p.box }, cells: [{ x: bx, y: by }, along ? { x: bx + 1, y: by } : { x: bx, y: by + 1 }], dx: p.slide.dx, dy: p.slide.dy, at: 0, anim: null } as unknown as ShelfBank;
        bank.station = { x: p.cx + (along ? reach : 0), z: p.cz + (along ? 0 : -reach), progress: 0, done: false, level: l, bank };
        shelfBanks.push(bank);
      }
      for (const c of bunkerOpen[l]!) {
        const dir = c.yaw === 0 ? [1, 0] : [0, -1];
        const reach = KINDS.cargo.len / 2 + 1.2;
        crateCandidates.push({ x: c.cx + dir[0]! * reach, z: c.cz + dir[1]! * reach, progress: 0, done: false, level: l, container: { id: c.id, cx: c.cx, cz: c.cz } });
      }
      // What the walls, floors and containers say.
      {
        const deps = { plan: bunkerPlan, text: stackSite ? textFor(stackSite) : signageText };
        const cargo = placed.filter((p) => p.kind === 'cargo').map((p) => ({ cx: p.cx, cz: p.cz, yaw: p.yaw, len: p.spec.len, depth: p.spec.depth, height: p.spec.height, key: roofKey(p.box) }));
        signLayers.set(l, buildSigns(rig.group, [...roomSigns(deps, l, parseTraining(bunkerMap(l, true)).cells), ...containerSigns(deps, l, cargo)]));
      }
      // The clue system on this storey's wall: a console in the aisle, worked from the cell in front.
      {
        const clue = clueOn(l);
        if (clue) {
          const dir = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[clue.side];
          const back = CELL / 2 - WALL_T / 2 - 0.42;
          const prop = buildClueSystem({ x: clue.x * CELL + dir[0]! * back, z: clue.y * CELL + dir[1]! * back, facing: Math.atan2(-dir[0]!, -dir[1]!) });
          rig.group.add(prop.group);
          rig.wallBoxes.push(...prop.boxes);
          prop.setState('idle');
          clueSystems.push({ x: prop.stand.x, z: prop.stand.z, progress: 0, done: false, level: l, floor: l, rig: prop });
        }
      }
      // A container's roof is a flat 'flight' at its height, one for each (a container is two cells long and one wide, standing on whole cells): the agent on it walks on that.
      for (const p of placed) {
        if (!p.spec.roof) continue;
        const b = p.box;
        const along = p.yaw === 0;
        const x = Math.round(p.cx / CELL - (along ? 0.5 : 0));
        const y = Math.round(p.cz / CELL - (along ? 0 : 0.5));
        const stair: Stair = { x, y, spanX: !along, run: 2, width: 1, fromFloorY: l * floorHeight + p.spec.height, toFloorY: l * floorHeight + p.spec.height };
        stairs.push(stair);
        roofSurfaces.push({ level: l, key: roofKey(b), stair, cells: [`${x},${y}`, along ? `${x + 1},${y}` : `${x},${y + 1}`] });
      }
      // Guards on the roofs: the cells the containers cover, their own nav grid, and a patrol on each big enough roof.
      const roofCells = new Set<string>();
      for (const p of placed) {
        if (p.kind !== 'cargo') continue;
        const along = p.yaw === 0;
        const x = Math.round(p.cx / CELL - (along ? 0.5 : 0));
        const y = Math.round(p.cz / CELL - (along ? 0 : 0.5));
        roofCells.add(`${x},${y}`);
        roofCells.add(along ? `${x + 1},${y}` : `${x},${y + 1}`);
      }
      roofNavs.set(storeys[l]!.content, roofNav(roofCells, cols, rows) as MazeCells);
      roofCellSets.set(l, roofCells);
      refreshBridges(l);
      for (const r of roofRoutes(roofCells, 2)) {
        const make = (): Bot => {
          // (If its roof has been destroyed by the time it is put back, it starts on the floor under it.)
          const up = roofCells.has(`${r.start.x},${r.start.y}`);
          const guard = new Bot(root.scene, r.start.x * CELL, r.start.y * CELL, 0, rig.group.position.y + (up ? KINDS.cargo.height : 0), 0);
          if (up) {
            guard.setRoof(roofCells);
            guard.setRoute(r.route.map((c) => ({ ...c })));
          }
          return guard;
        };
        const guard = make();
        storeys[l]!.content.spawners.set(guard, make);
        storeys[l]!.content.enemies.push(guard);
      }
      buildBunkerDucts(rig, l, floorHeight);
      for (const c of buildCameras(rig, l, camerasOn(l))) towerCams.push({ rig: c, seen: 0, quietUntil: 0, lockUntil: 0, offUntil: 0, perm: false });
      // the way out, on the ground floor
      if (l === BUNKER_EXIT_LEVEL) {
        rig.group.add(exitLift.group);
        rig.wallBoxes.push(...exitLift.boxes, exitLift.doorBox);
        exitRig = rig;
      }
    }
    // The stairs: a flight each way between two storeys, and a hole in the floor above where it comes up.
    const gone = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const st of BUNKER_STAIRS) {
      const lo = st.low * floorHeight;
      const hi = st.high * floorHeight;
      const flight: Stair = { x: st.x, y: st.y, spanX: false, run: st.run, width: st.width, fromFloorY: st.dir === 1 ? lo : hi, toFloorY: st.dir === 1 ? hi : lo };
      stairs.push(flight);
      root.scene.add(buildStairMesh(flight, CELL));
      const upper = storeys[st.high]!.rig;
      for (const c of stairCells(st)) upper.floorTiles.setMatrixAt(c.y * cols + c.x, gone);
      upper.floorTiles.instanceMatrix.needsUpdate = true;
      // On the lower storey the stairwell's far end is shut by a wall, and beyond it is the grid of solid cells' walls (nothing is drawn there): the flight rises over them, and the agent has to be able to walk on at the top, so the first cell's worth stops being solid.
      // (Walked down it is the same on the storey above: the player's floor is held to the one the flight was entered from for the whole of it, so the wall that shuts the hole's foot end stops anyone who comes down short of the landing: it stops being solid too.)
      const z0 = st.y * CELL - CELL / 2;
      const z1 = (st.y + st.width) * CELL - CELL / 2;
      const opened = (boxes: WallBox[], edgeX: number, outward: 1 | -1): void => void openFlightEnd(boxes, edgeX, outward, z0, z1, CELL);
      const eastX = (st.x + st.run) * CELL - CELL / 2;
      const westX = st.x * CELL - CELL / 2;
      opened(storeys[st.low]!.rig.wallBoxes, st.dir === 1 ? eastX : westX, st.dir === 1 ? 1 : -1); // the head end, on the lower storey (climbing)
      opened(storeys[st.high]!.rig.wallBoxes, st.dir === 1 ? westX : eastX, st.dir === 1 ? -1 : 1); // the foot end, on the storey above (coming down)
    }
    // Every floor's shaders are built now, while they are all shown once: climbing to a floor for the first time must not stall the picture compiling them.
    const shown = storeys.map((f) => f.rig.group.visible);
    for (const f of storeys) f.rig.group.visible = true;
    root.renderer.compile(root.scene, root.camera);
    storeys.forEach((f, i) => (f.rig.group.visible = shown[i]!));
  }
  // The dock yard's hunt (yardsite.ts): a clue console on each of its cells, every openable container's doors, and then (for both sites) the marking on the dossier's container.
  if (yardRun) {
    yardOpen = yardOpenContainers({ containers: yardPlan.containers, width: CONTAINER_W, cell: YARD_CELL, cols: YARD_COLS, rows: YARD_ROWS, height: CONTAINER_H });
    yardPlan.clues.forEach((c, i) => {
      const prop = buildClueSystem({ x: c.x * CELL, z: c.y * CELL, facing: c.facing });
      floor0.group.add(prop.group);
      floor0.wallBoxes.push(...prop.boxes);
      prop.setState('idle');
      clueSystems.push({ x: prop.stand.x, z: prop.stand.z, progress: 0, done: false, level: i, floor: 0, rig: prop });
    });
    for (const c of yardOpen) crateCandidates.push({ x: c.station.x, z: c.station.z, progress: 0, done: false, level: 0, container: { id: c.id, cx: c.cx, cz: c.cz } });
  }
  if (hunt) {
    const c = huntPlan()?.dossier;
    if (c) {
      // Only the dossier's container and a few decoys on the way to it offer to open (arc.ts's openableCrates); the rest are just containers.
      const byLevel = yardRun ? [yardOpen.map((y) => y.id)] : bunkerOpen.map((a) => a.map((b) => b.id));
      const decoys = yardRun ? [3] : byLevel.map((_, l) => (l < c.floor ? 1 : l === c.floor ? 2 : 0));
      const open = openableCrates(runSeed, byLevel, decoys, c.id);
      for (const k of crateCandidates) if (open.has(k.container.id)) crateStations.push(k);
      dossierMark = buildDossierMarker({ cx: c.cx, cz: c.cz, yaw: c.yaw, len: c.len, depth: c.depth, height: c.height }, coreLook ? { color: 0x5fd4ff, tag: ['TARGET', 'FILE'] } : undefined);
      storeys[c.floor]!.rig.group.add(dossierMark.group);
    }
  }
  // The hall is known from the first step (it is a lobby you walk into, not a maze): every floor's tiles are lit as explored, and the light is the warm light of a lit building,
  // not a maze's dark (the remembered tier's colour is a shared constant, put back to its own for every other job).
  // (`?dark=0` on localhost puts the tower's lights back on: by default it is dark like the heist's floors, the torch lighting the way and the floors remembered as they are walked.)
  // The tower is dark like the heist's floors, the torch lighting the way; the exit level is lit (warm, every storey known) like the lobby you fight back through, and so is the bunker (cool
  // strip lighting, the floors still remembered as they are walked). `?dark=1` on localhost puts the bunker's dark back; `?dark=0` lights the tower.
  const towerDark = tower && !exitMode && new URLSearchParams(location.search).get('dark') !== '0';
  const bunkerLit = bunker && new URLSearchParams(location.search).get('dark') !== '1';
  EXPLORED_COLOR.set(tower && !towerDark ? 0x74685a : bunkerLit ? 0x5c6674 : 0x20262e);
  if (bunkerLit) {
    root.ambientLight.color.set(0xdde8f4);
    root.ambientLight.groundColor.set(0x3b4452);
    root.ambientLight.intensity = 0.9;
    root.sunLight.color.set(0xdde8f4);
    root.sunLight.intensity = 0.5;
  }
  if (tower && !towerDark) {
    root.ambientLight.color.set(0xffe2b8);
    root.ambientLight.groundColor.set(0x4a3a28);
    root.ambientLight.intensity = 0.85;
    root.sunLight.color.set(0xffe2b8);
    root.sunLight.intensity = 0.5;
    if (root.scene.fog instanceof THREE.FogExp2) root.scene.fog.density = 0.011;
    for (const f of storeys) {
      for (let y = 0; y < f.rig.rows; y++) {
        for (let x = 0; x < f.rig.cols; x++) {
          f.explored.explored[y]![x] = true;
          revealFloorCell(f.rig, x, y, EXPLORED_COLOR);
        }
      }
    }
  }
  // Where a catch puts the agent back: the first step onto the storey they last reached (the street door to begin with).
  let towerLanding = { x: TOWER_START.x * CELL, z: TOWER_START.y * CELL + 0.5, y: 0, angle: 0 };
  let towerLandingLabel = 'The street door';
  let towerBest = exitMode ? 3 : 0; // the highest storey reached (the exit level: the lowest): only going further is a checkpoint
  let towerAwake = false; // the agent has got half way up the first stair: every storey's guards and dogs are on their rounds
  /** A checkpoint in the tower: a catch puts the agent back here (what they have taken, looped or unlocked stays so). */
  function towerCheckpoint(label: string): void {
    if (!tower || caught || cleared || aloft) return;
    towerLanding = { x: player.worldX, z: player.worldZ, y: player.worldY, angle: player.facingAngle };
    towerLandingLabel = label;
    hud.showToast(`CHECKPOINT · ${label.toUpperCase()}`, 'good', 2600);
  }
  /** The stairs a walker at this height can be on. The heist's one joins two floors that sit side by side, so any height will do; the tower's flights are stacked in the same footprint, so only the ones that start or end at this height count. */
  const stairsAt = (y: number): Stair[] =>
    tower || bunker ? stairs.filter((s) => Math.min(s.fromFloorY, s.toFloorY) - 0.05 <= y && y <= Math.max(s.fromFloorY, s.toFloorY) + 0.05 && !((s as { id?: string }).id === 'core' && !coreOpen)) : stairs;

  const ambient = new Ambient(
    storeys.flatMap((f) => f.content.rooms.map((r) => ({ kind: r.room.kind, glows: r.glows }))),
    storeys.flatMap((f) => f.rig.fixtures)
  );
  // ---- the skylight (glass.ts): a cell of the upper floor is glass, over a ground-floor corridor where the guards pass ----

  let sky: { rig: Skylight; x1: number; y1: number; x0: number; y0: number; wx: number; wz: number } | null = null;
  if (floor1 && floor1Content && !layout && !dock) {
    const takenOf = (c: FloorContent, base: ReadonlySet<string> | null): Set<string> => {
      const t = new Set(base ?? []);
      for (const r of c.rooms) for (const cell of r.room.cells) t.add(`${cell.x},${cell.y}`);
      for (const h of c.hidingSpots) t.add(`${h.x},${h.y}`);
      for (const l of c.laserCells) t.add(`${l.x},${l.y}`);
      for (const s of c.sweepers) t.add(`${s.laser.x},${s.laser.y}`);
      for (const l of c.lines) t.add(`${l.laser.x},${l.laser.y}`);
      for (const s of c.sliders) for (let k = s.laser.from; k <= s.laser.to; k++) t.add(s.laser.axis === 'x' ? `${k},${s.laser.at}` : `${s.laser.at},${k}`);
      return t;
    };
    // (Not everything the contents reserved: a corridor may be reserved for a guard's post or a crate, and the glass can sit over those. What is kept clear is the way in and out, the landmark and the rooms.)
    const keep = (c: FloorContent, landmark: { x0: number; y0: number; w: number; h: number } | null, extra: Array<{ x: number; y: number }>): Set<string> => {
      const t = takenOf(c, null);
      for (const e of extra) t.add(`${e.x},${e.y}`);
      if (landmark) for (let y = landmark.y0; y < landmark.y0 + landmark.h; y++) for (let x = landmark.x0; x < landmark.x0 + landmark.w; x++) t.add(`${x},${y}`);
      return t;
    };
    const taken1 = keep(floor1Content, landmarkOf(floor1Content.cells), [{ x: 0, y: 0 }]);
    if (floor1Content.entrySpot) taken1.add(`${floor1Content.entrySpot.x},${floor1Content.entrySpot.y}`);
    const pick = pickSkylight({
      cells1: floor1Content.cells,
      section1: floor1Content.section,
      cols1: floor1Content.cols,
      rows1: floor1Content.rows,
      taken1,
      cells0: floor0Content.navCells,
      cols0: cols,
      rows0: rows,
      taken0: keep(floor0Content, landmark0, [startCell, { x: exitX, y: exitY }]),
      offX: Math.round((floor1.group.position.x - floor0.group.position.x) / CELL),
      offY: Math.round((floor1.group.position.z - floor0.group.position.z) / CELL),
      rand: Math.random,
    });
    if (pick) {
      const rig = buildSkylight(CELL);
      rig.group.position.set(pick.x1 * CELL, 0, pick.y1 * CELL);
      floor1.group.add(rig.group);
      const gone = new THREE.Matrix4().makeScale(0, 0, 0);
      floor1.floorTiles.setMatrixAt(pick.y1 * floor1.cols + pick.x1, gone);
      floor1.floorTiles.instanceMatrix.needsUpdate = true;
      // The ground below shows through it from the start.
      explored.explored[pick.y0]![pick.x0] = true;
      revealFloorCell(floor0, pick.x0, pick.y0, EXPLORED_COLOR);
      sky = { rig, ...pick, wx: floor1.group.position.x + pick.x1 * CELL, wz: floor1.group.position.z + pick.y1 * CELL };
    }
  }
  restoreRandom(); // the building is laid out: from here on (guards wandering, sparks), everyone's run goes its own way

  // The way in (entries.ts). The dock is the arrival lift, as built above; the roof and the tunnel put the player
  // at the hatch or the grate instead, and the lift stays shut. Without a spot for it, it's the dock.
  const hatchSpot = floor1Content?.entrySpot ?? null;
  const hatchCell: { x: number; y: number; dir: Dir } | null = hatchSpot && floor1Content && { ...hatchSpot, dir: facingOut(floor1Content.cells, hatchSpot.x, hatchSpot.y) };
  const grateCell = floor0Content.entrySpot;
  const way: EntryId = entry === 'roof' && hatchCell && floor1 ? 'roof' : entry === 'tunnel' && grateCell ? 'tunnel' : 'dock';
  if (way !== entry) {
    later(() => hud.showToast(`${entry === 'roof' ? 'THE ROOF HATCH' : 'THE SERVICE TUNNEL'} IS SEALED TONIGHT · IN THROUGH ${ENTRY_TITLE[ways.entry].title.toUpperCase()}`, 'neutral', 4200), 1500);
  }
  let roofLine: RoofLine | null = null;

  // Local practice (?bodies=N): a few guards go down on the floor the agent comes in on (the dock on the office floor, the roof
  // hatch on the data-centre floor), each in the open beside a staff locker, a pair of crates or a vent, to carry to it.
  if (practiceBodies > 0 && !training) {
    const onRoof = way === 'roof' && floor1 && floor1Content;
    const [rig, content] = onRoof ? [floor1!, floor1Content!] : [floor0, floor0Content];
    const spots: Array<{ x: number; z: number; a: number }> = [];
    const away = (x: number, z: number, facing: number, d: number): { x: number; z: number; a: number } => ({ x: x + Math.sin(facing) * d, z: z + Math.cos(facing) * d, a: facing });
    for (const l of content.staffLockers) spots.push(away(l.rig.front.x, l.rig.front.z, l.rig.front.facing, 1.1));
    for (const c of content.hidingSpots) spots.push({ x: c.x * CELL, z: c.y * CELL + 1.8, a: 0 });
    for (const v of content.vents) spots.push(away(v.ends[0].stand.x, v.ends[0].stand.z, v.ends[0].stand.facing + Math.PI, 1.0));
    // one of each kind first: locker, crates, vent
    const firstOf = [content.staffLockers.length ? 0 : -1, content.hidingSpots.length ? content.staffLockers.length : -1, content.vents.length ? content.staffLockers.length + content.hidingSpots.length : -1].filter((i) => i >= 0);
    const order = [...firstOf, ...spots.map((_, i) => i).filter((i) => !firstOf.includes(i))];
    const guards = content.enemies.filter((e): e is Bot => e instanceof Bot && !e.disabled).slice(0, practiceBodies);
    const o = rig.group.position;
    guards.forEach((bot, i) => {
      const at = spots[order[i % Math.max(1, order.length)] ?? 0] ?? { x: 0, z: 0, a: 0 };
      bot.setPost(at.x + o.x, at.z + o.z, at.a);
    });
    window.setTimeout(() => {
      if (!signal.aborted) for (const bot of guards) bot.hit('takedown');
    }, 2500);
  }
  if (way === 'roof' && floor1 && hatchCell) {
    const rig = buildRoofHatch(hatchCell.x, hatchCell.y, hatchCell.dir);
    floor1.group.add(rig.group);
    const o = floor1.group.position;
    player.place(rig.spawn.x + o.x, rig.spawn.z + o.z, rig.spawn.facing, o.y);
    if (explored1) updateVision(floor1, explored1, player.worldX, player.worldZ, player.facingAngle, floor1.wallBoxes);
    roofLine = { ...rig.junction, progress: 0, cut: false, setCut: rig.setCut };
  } else if (way === 'tunnel' && grateCell) {
    const rig = buildTunnelGrate(grateCell.x, grateCell.y, facingOut(cells, grateCell.x, grateCell.y));
    floor0.group.add(rig.group);
    player.place(rig.spawn.x, rig.spawn.z, rig.spawn.facing);
    // Pitch dark down here: the grate's dead end and the cell outside it.
    const near = withinSteps(cells, cols, rows, grateCell.x, grateCell.y, 1);
    for (const c of near) floor0Content.dark[c.y]![c.x] = true;
    for (const l of floor0Content.lamps) {
      if (!near.some((c) => c.x === l.cell.x && c.y === l.cell.y)) continue;
      l.broken = true;
      applyLamp(l);
    }
    // And a watchdog prowls the tunnel's end of the building, from the jobs that have them.
    if (diff.watchdogs > 0) {
      const d = bfs(floor0Content.navCells, cols, rows, grateCell.x, grateCell.y);
      const spots: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (d[y]![x]! >= 3 && d[y]![x]! <= 5 && !used.has(`${x},${y}`)) spots.push({ x, y });
      const at = spots[Math.floor(Math.random() * spots.length)];
      if (at) floor0Content.enemies.push(new Watchdog(root.scene, at.x * CELL, at.y * CELL, 0, 0, 0));
    }
    updateVision(floor0, explored, player.worldX, player.worldZ, player.facingAngle, floor0.wallBoxes);
  }
  if (way !== 'dock') {
    // No lift ride: the lift stays shut, the chase camera takes the shot from the start.
    arrivalPhase = 'done';
    liftCam = 0;
    arrival.setState('idle');
    if (!training) later(() => hud.showHint('kit'), 2500);
  }
  const bursts = new Bursts(root.scene);
  const blasts = new Blasts(root.scene);
  const sights = new Sights(root.scene);
  const beacons: Beacon[] = [];
  // Counted from what was actually placed, so the exit can always open.
  const totalFragments = yardRun ? 0 : storeys.reduce((n, f) => n + f.content.documents, 0); // (the yard's hunt is for the dossier, not the port office's file)
  // The ceiling and stealth courses have no files to take: the exit stands open behind the last gate.
  // (The final level's exit level is a forced fight: its lift stays shut until Warden is down, tickWarden.)
  if (ceiling || stealth || weapons || cover || corners || wall || highwall || range || (exitMode && !(options.core && campaignOp?.n === CORE_OP))) {
    exitLift.setState('ready');
    setLiftOpen(exitLift, true);
  }

  let documentsCollected = 0;
  hud.setDocuments(documentsCollected, totalFragments);
  /** The bunker's top bar: the terminals hacked of the ones this run needs, and the dossier read. */
  function showBunkerCounter(): void {
    if (!hunt) return;
    const needed = huntPlan()?.stops ?? [];
    const hacked = needed.filter((l) => clueSystems.some((c) => c.level === l && c.done)).length;
    hud.setDocumentsText(`CLUES ${hacked}/${needed.length} · DOSSIER ${dossier.found ? 1 : 0}/1`, dossier.found);
  }
  showBunkerCounter();

  let score = 0;
  let suspicion = approach?.suspicion ?? 0; // (the tower hands on how the climb went)
  hud.setScore(score);
  hud.setSuspicion(suspicion);

  let cleared = false;
  let caught = false;
  /** The reset after the agent is caught (takeover.ts): it runs the screen until it ends. */
  let takeover: Takeover | null = null;
  let activeFloorIdx = 0; // which floor's content/wallBoxes/vision is currently live — see player.ts's currentFloorIdx
  let nearbyTarget: Target | null = null;
  let activeHack: { terminal: Terminal; floor: ActiveFloor } | null = null;
  let activeTask: Task | null = null; // the uplink, a capture or a log wipe in progress
  let shutterHack: { shutter: Shutter; panel: number; floor: ActiveFloor; progress: number;
  } | null = null; // a shutter's panel being worked
  let burned = false; // what was read went out: the access logs, or the files themselves through a live uplink
  let logsWiped = 0;
  const uplinkWarned = new Set<Workstation>(); // one "uplink's still up" warning per workstation
  let wipeWarned = false; // and one "files still to take" warning at the log console
  const doorHintShown = new Set<DoorRig>(); // one "locked" hint per approach, cleared on walking away
  let flareCooldown = 0;
  // Flash grenades (flash.ts): how many are left, the ones in the air, the stars over the dazed, and the beat of slow motion when a chase turns into a panic.
  let flashesLeft = training ? (weapons ? TRAINING_KIT.flash : tower ? 2 : 0) : (twisted.flashes ?? FLASH_START);
  let flashesUsed = 0;
  let flashDazed = 0; // enemies blinded by a flash (training counts them)
  let flashCooldown = 0;
  let blindedFor = 0; // seconds the agent still stumbles from a guard's flash
  const activeFlashes: Flashbang[] = [];
  // Smoke and shock grenades (smoke.ts): how many are left, the ones in the air, and the clouds that are up (each on the floor it went off on).
  let smokesLeft = training && !tower ? 0 : tower ? 2 : SMOKE_START;
  let shocksLeft = training && !tower ? 0 : tower ? 2 : SHOCK_START;
  let grenadeCooldown = 0;
  let smokeOfferHold = 0; // seconds the smoke / shock offers stay up after the reason for them passes (so they do not flicker)
  let shockOfferHold = 0;
  const thrownGrenades: Thrown[] = [];
  const smokeClouds = new SmokeClouds(root.scene);
  const smokes: Array<Smoke & { content: FloorContent }> = [];
  const dazeStars: DazeStars[] = [];
  let slow: Slow = NO_SLOW;
  let slowScale = 1;
  // Bullet time (bullettime.ts): Space, while something closes in, slows the world and leaves the agent most of their speed. The meter, how long the offer has been up, and the camera's base field of view.
  let bullet: BulletState = FULL_BULLET;
  let bulletOfferHold = 0;
  let bulletFresh = true;
  let bulletQuiet = 99; // seconds since nothing was closing in: it starts by itself only on a fresh approach, not again and again in one chase
  const BASE_FOV = root.camera.fov;
  let bulletFovK = 0;
  let panicHold = 0;
  let fireCooldown = 0;
  let dogPingLeft = 0; // seconds to the watchdog warning's next ping
  /** The gun is recharging after a shot (not after a takedown): it hums as it fills and chimes when ready, and a press meanwhile just clicks. */
  let charging = false;
  let dryFires = 0;
  let exitLockedToastShown = false; // avoids re-spamming the "locked" toast every single frame the player stands at the exit
  let mapOpen = false; // the blueprint is up — the job is paused underneath it
  let briefingOpen = false; // ...as the mission briefing, which only its Begin button closes
  let controlsOpen = false; // the controls sheet is up — paused too
  let letterOpen = false; // Control's letter, read again from the PDA — paused too
  let readerOpen = false; // a captured file is open on a page of its own, the job paused under it
  let resumeOffer = false; // the offer to resume from a checkpoint (below) is up: the game waits for the answer
  // Control's letter for this job, to read again mid-job (not in training, which has none).
  const jobLetter = training
    ? null
    : {
        ...(dailyRun
          ? briefing(tonight(dailyRun.day), diff.documents, agent, username, dailyRun.scored ? 'scored' : 'replay', dailyRun.carry, null, contract, sideBrief(sideGoal), letterNotes(twists, level, true))
          : ladderBriefing(n)),
        closing: `You’re inside. ${contract === 'records' ? 'Get the files' : 'Do the job'} and get out.`,
      };

  // Last night's carry-over (campaign.ts). A clean night's favour: the network closet and the log room, and the
  // cell outside each doorway, are on the blueprint from the start.
  const carry = carryIn;
  if (carry?.markNetwork) {
    const floors: Array<[FloorRig, FloorContent, VisionState]> = storeys.map((f) => [f.rig, f.content, f.explored]);
    for (const [rig, content, vision] of floors) {
      for (const { room } of content.rooms) {
        if (room.kind !== 'uplink' && room.kind !== 'logs') continue;
        const outside = { x: room.cells[room.cells.length - 1]!.x + DIR_DELTA[room.openDir][0], y: room.cells[room.cells.length - 1]!.y + DIR_DELTA[room.openDir][1] };
        for (const c of [...room.cells, outside]) {
          const row = vision.explored[c.y];
          if (!row || row[c.x] !== false) continue; // off the floor, or already known
          row[c.x] = true;
          revealFloorCell(rig, c.x, c.y, EXPLORED_COLOR);
        }
      }
    }
  }
  let navVersion = 0; // bumped when a door opens, so the sound map is rebuilt
  // A contract's access and wiring plans: the breaker panels on the blueprint, and a locked door already open.
  if (carry?.markBreakers) {
    const floors: Array<[FloorRig, FloorContent, VisionState]> = storeys.map((f) => [f.rig, f.content, f.explored]);
    for (const [rig, content, vision] of floors) {
      for (const f of content.fittings) {
        if (f.kind !== 'breaker') continue;
        const row = vision.explored[f.cell.y];
        if (!row || row[f.cell.x] !== false) continue;
        row[f.cell.x] = true;
        revealFloorCell(rig, f.cell.x, f.cell.y, EXPLORED_COLOR);
      }
    }
  }
  for (let n = 0; n < (carry?.openDoors ?? 0); n++) {
    const floor = { rig: floor0, content: floor0Content };
    const rig = floor.content.doors.find((d) => !d.isOpen());
    if (!rig) break;
    rig.open();
    const box = floor.content.doorBoxes.get(rig);
    const i = box ? floor.rig.wallBoxes.indexOf(box) : -1;
    if (i !== -1) floor.rig.wallBoxes.splice(i, 1);
    setPassage(floor.content.navCells, rig.door, true, floor.content.cols, floor.content.rows);
    navVersion++;
  }
  // Once per browser, a line on the guide, where to turn it off.
  if (!training && guideOn) {
    const told = ((): boolean => {
      try {
        const seen = window.localStorage.getItem(GUIDE_HINT_KEY) === '1';
        if (!seen) window.localStorage.setItem(GUIDE_HINT_KEY, '1');
        return seen;
      } catch {
        return true;
      }
    })();
    if (!told) later(() => hud.showToast('GUIDE ON · AN ARROW BY YOUR FEET POINTS THE WAY TO YOUR NEXT OBJECTIVE · TURN IT OFF WITH GUIDE ON THE PDA, OR P', 'neutral', 7000), 2600);
  }
  if (carry) {
    const lines = describeCarry(carry);
    if (lines.length) later(() => hud.showToast(`${carry.eased ? 'GOING EASIER ON YOU' : 'CARRIED IN'} · ${lines.map((l) => l.text.toUpperCase()).join(' · ')}`, lines.some((l) => l.tone === 'good') ? 'good' : 'bad', 6800), 1800);
  }

  /** A sheet is up over the job (the blueprint, the controls or Control's letter): everything holds still and ignores input. */
  function paused(): boolean {
    return mapOpen || controlsOpen || letterOpen || readerOpen || resumeOffer || gunMenuOpen || tour !== null || hud.isNotificationsOpen();
  }


  // ---- recon: the fly-over of the objectives and the way out (tour.ts) ----
  type TourStop = TourShot & { room?: BuiltRoom };
  type TourRun = {
    shots: TourStop[];
    /** The way the camera comes in to each stop: a unit vector on the ground. */
    heading: Array<{ x: number; z: number }>;
    /** Metres from wherever the camera was to each stop. */
    legs: number[];
    /** The stop being flown to, or looked at (held until Next is pressed). */
    idx: number;
    phase: 'fly' | 'hold';
    /** Seconds in this phase, and how long the flight lasts. */
    t: number;
    flyS: number;
    /** Since it started. */
    age: number;
    /** Next was pressed: go on from this stop as soon as it's held a moment. */
    want: boolean;
    /** The floor being looked at now (the other's hidden). */
    floor: number;
    startFloor: number;
    beacons: Array<Beacon | undefined>;
    /** The stop whose ground is lit, and its floor. */
    lit: { shot: number; floor: number } | null;
    skipped: boolean;
    auto: boolean;
    /** Where the camera's looking, for the lights. */
    focus: THREE.Vector3;
  };
  let tour: TourRun | null = null;
  /** After the recon: the camera gliding back to the chase view from where it ended (`w` 1 to 0). */
  let tourBack: { pos: THREE.Vector3; aim: THREE.Vector3; w: number } | null = null;
  /** After the recon, the floor it lit that the agent isn't on still has to fade back to memory. */
  let tourFade = false;
  const tourA = { pos: new THREE.Vector3(), aim: new THREE.Vector3() };
  const tourB = { pos: new THREE.Vector3(), aim: new THREE.Vector3() };
  const tourPos = new THREE.Vector3();
  const tourAim = new THREE.Vector3();
  const tourPin = new THREE.Vector3();

  const floorOf = (idx: number): { rig: FloorRig; state: VisionState | null } => {
    const f = storeys[Math.min(idx, storeys.length - 1)]!;
    return { rig: f.rig, state: f.explored };
  };

  /** Every place worth a look: the uplink, each records room still to photograph, the log server, the stairs, and the way out. */
  function tourSpots(): Array<TourSpot & { room?: BuiltRoom }> {
    const spots: Array<TourSpot & { room?: BuiltRoom }> = [];
    for (const [idx, { rig, content }] of storeys.entries()) {
      const o = rig.group.position;
      if (content.uplink) spots.push({ kind: 'uplink', floor: idx, x: content.uplink.x + o.x, z: content.uplink.z + o.z, alarm: contract !== 'records' });
      for (const w of content.workstations) {
        if (w.captured) continue;
        const st = w.step?.step;
        spots.push({ kind: 'files', floor: idx, x: w.x + o.x, z: w.z + o.z, files: w.files, room: w.room, ...(st ? { title: st.name, text: stationText(st.kind, st.letter) } : {}) });
      }
      if (content.logServer) spots.push({ kind: 'logs', floor: idx, x: content.logServer.x + o.x, z: content.logServer.z + o.z });
    }
    if (stair && floor1) spots.push({ kind: 'stairs', floor: 0, x: stair.x * CELL, z: stair.y * CELL });
    spots.push({ kind: 'exit', floor: bunker ? BUNKER_EXIT_LEVEL : 0, x: exitX * CELL, z: exitY * CELL });
    return spots;
  }

  /** The camera's place and aim over stop `i`: up, and back along the way it came in. */
  function stopPose(t: TourRun, i: number, out: { pos: THREE.Vector3; aim: THREE.Vector3 }): void {
    const s = t.shots[i]!;
    const y = floorOf(s.floor).rig.group.position.y;
    const h = t.heading[i]!;
    out.aim.set(s.x, y + 0.8, s.z);
    out.pos.set(s.x - h.x * TOUR_BACK, y + TOUR_HEIGHT, s.z - h.z * TOUR_BACK);
  }

  /**
   * Recon: lifts off the agent, visits each objective and the way out (lighting the ground around each, so it's
   * on the blueprint afterwards), and settles back. `auto` is the one at the start of a job, which stops playing
   * itself if it keeps being skipped; the PDA's Recon (or O) plays it again whenever.
   */
  function startTour(auto: boolean): void {
    if (tour || training || cleared || caught || paused() || aloft || hiddenIn || ventTransit) {
      if (auto) endPending();
      return;
    }
    cancelTrapAim();
    const from = { floor: activeFloorIdx, x: player.worldX, z: player.worldZ };
    const ordered = orderTour(tourSpots(), from);
    if (!ordered.length) {
      if (auto) endPending();
      return;
    }
    const shots: TourStop[] = ordered.map((s) => ({ ...s, ...describeStop(s) }));
    const heading: TourRun['heading'] = [];
    const legs: number[] = [];
    let prev = { x: player.worldX, z: player.worldZ };
    for (const s of shots) {
      const dx = s.x - prev.x;
      const dz = s.z - prev.z;
      const d = Math.hypot(dx, dz);
      // Straight over the agent's own spot (a stop right where they stand): the way they're facing.
      heading.push(d > 1 ? { x: dx / d, z: dz / d } : { x: Math.sin(player.facingAngle), z: Math.cos(player.facingAngle) });
      legs.push(d);
      prev = s;
    }
    tourPending = false;
    tour = { shots, heading, legs, idx: 0, phase: 'fly', t: 0, flyS: flyDuration(legs[0]!), age: 0, want: false, floor: activeFloorIdx, startFloor: activeFloorIdx, beacons: [], lit: null, skipped: false, auto, focus: new THREE.Vector3() };
    tourBack = null;
    sound.play('vent', undefined, 0.35);
  }

  /** Nothing to run after all: whatever waited for the recon goes ahead. */
  function endPending(): void {
    tourPending = false;
    for (const fn of afterTour.splice(0)) fn();
  }

  /** Next (a tap, Space, Enter or the right arrow): on to the next stop, or, at the last, back to the job. */
  function nextTour(): void {
    if (tour && tour.age > TOUR_PRESS_AFTER_S) tour.want = true;
  }

  /** Skip (the button, or Escape): straight back to the job. */
  function skipTour(): void {
    if (tour && tour.age > TOUR_PRESS_AFTER_S) tour.skipped = true;
  }

  function endTour(): void {
    const t = tour;
    if (!t) return;
    tourBack = { pos: root.camera.position.clone(), aim: tourAim.clone(), w: 1 };
    tour = null;
    hud.hideTour();
    for (const b of t.beacons) b?.remove();
    for (const f of storeys) dimLive(f.explored);
    tourFade = true;
    // Skipped three times running, it stops playing itself; watched (or asked for), it's forgotten.
    if (t.auto || !t.skipped) {
      const skips = t.skipped ? tourSkips() + 1 : 0;
      setTourSkips(skips);
      if (t.skipped && skips === TOUR_QUIET_AFTER) later(() => hud.showToast(`RECON WON’T PLAY BY ITSELF ANY MORE · ${onTouch() ? 'THE PDA’S RECON' : keyed('{recon}').toUpperCase()} PLAYS IT AGAIN`, 'neutral', 4600), 600);
    }
    endPending();
  }

  /** One frame of it, over the chase camera already placed: the shot, the lit ground, the caption. */
  function tickTour(dtv: number): void {
    const t = tour!;
    t.t += dtv;
    t.age += dtv;
    if (t.skipped) {
      endTour();
      return;
    }
    // Next, once the stop's been held a moment: on to the next, or done.
    if (t.phase === 'hold' && t.want && t.t >= TOUR_HOLD_MIN_S) {
      t.want = false;
      if (t.idx >= t.shots.length - 1) {
        endTour();
        return;
      }
      t.idx++;
      t.phase = 'fly';
      t.t = 0;
      t.flyS = flyDuration(t.legs[t.idx]!);
    }
    if (t.phase === 'fly' && t.t >= t.flyS) {
      t.phase = 'hold';
      t.t = 0;
    }
    const shot = t.shots[t.idx]!;
    const flying = t.phase === 'fly';
    const k = flying ? t.t / t.flyS : 1;
    const e = k * k * (3 - 2 * k);
    if (flying) {
      if (t.idx === 0) {
        tourA.pos.copy(root.camera.position);
        tourA.aim.set(player.worldX, player.worldY + 1, player.worldZ);
      } else stopPose(t, t.idx - 1, tourA);
      stopPose(t, t.idx, tourB);
      tourPos.lerpVectors(tourA.pos, tourB.pos, e);
      tourAim.lerpVectors(tourA.aim, tourB.aim, e);
      tourPos.y += Math.min(5, tourA.pos.distanceTo(tourB.pos) * 0.12) * Math.sin(Math.PI * e);
      t.floor = e < 0.5 ? (t.idx === 0 ? t.startFloor : t.shots[t.idx - 1]!.floor) : shot.floor;
    } else {
      // Held over the stop, drifting slowly to and fro around it while it waits.
      stopPose(t, t.idx, tourB);
      const a = Math.sin(t.t * 0.45) * 0.3;
      const ox = tourB.pos.x - tourB.aim.x;
      const oz = tourB.pos.z - tourB.aim.z;
      tourPos.set(tourB.aim.x + ox * Math.cos(a) - oz * Math.sin(a), tourB.pos.y, tourB.aim.z + ox * Math.sin(a) + oz * Math.cos(a));
      tourAim.copy(tourB.aim);
      t.floor = shot.floor;
    }
    root.camera.position.copy(tourPos);
    root.camera.lookAt(tourAim);
    root.camera.updateMatrixWorld();
    t.focus.copy(tourAim);

    // A beacon over each stop once the camera's nearly there, kept up for the rest of it.
    const arriving = !flying || k > 0.55;
    if (arriving && !t.beacons[t.idx]) {
      const { rig } = floorOf(shot.floor);
      t.beacons[t.idx] = new Beacon(rig.group, shot.x - rig.group.position.x, shot.z - rig.group.position.z, TOUR_COLOURS[shot.kind]);
      sound.play('beep', undefined, 0.45);
    }
    for (const b of t.beacons) b?.update(clock.elapsedTime);

    // The ground around the stop lights up as the camera settles on it, and stays on the blueprint (with its records marked).
    const lit = flying ? Math.max(0, (k - 0.35) / 0.65) : 1;
    const { rig, state } = floorOf(shot.floor);
    if (t.lit && t.lit.floor !== shot.floor) {
      const old = floorOf(t.lit.floor).state;
      if (old) dimLive(old);
    }
    t.lit = { shot: t.idx, floor: shot.floor };
    if (state) {
      revealAround(rig, state, shot.x, shot.z, TOUR_RADIUS, TOUR_SIGHT * lit);
      if (lit > 0.5 && shot.room) reconRooms.add(shot.room);
    }
    for (const f of storeys) tickFloorTransitions(f.rig, f.explored, dtv);

    const canvasEl = root.renderer.domElement;
    let pin: { x: number; y: number } | null = null;
    if (arriving) {
      tourPin.set(shot.x, rig.group.position.y + 0.1, shot.z).project(root.camera);
      if (tourPin.z < 1) pin = { x: ((tourPin.x + 1) / 2) * canvasEl.clientWidth, y: ((1 - tourPin.y) / 2) * canvasEl.clientHeight };
    }
    hud.setTour({ step: t.idx + 1, total: t.shots.length, kind: shot.kind, title: shot.title, text: shot.text, last: t.idx === t.shots.length - 1, pin });
  }

  /** After the recon, the chase camera takes the shot back from where the recon left it. */
  function tickTourBack(dtv: number): void {
    const b = tourBack!;
    b.w = Math.max(0, b.w - dtv / TOUR_SETTLE_S);
    const s = b.w * b.w * (3 - 2 * b.w);
    tourPos.lerpVectors(root.camera.position, b.pos, s);
    tourAim.set(player.worldX, player.worldY + 1, player.worldZ).lerp(b.aim, s);
    root.camera.position.copy(tourPos);
    root.camera.lookAt(tourAim);
    if (b.w <= 0) tourBack = null;
  }

  /** The PDA's Recon, or O. */
  function replayTour(): void {
    startTour(false);
  }

  // ---- what a mission leaves behind: the pages it adds to the case, and what the next one carries in (fallout.ts) ----

  /** What the pages of evidence are: a records night's documents, or the contract's own kind of proof. */
  function pagesWhat(): string {
    if (contract !== 'records') return CONTRACTS[contract].evidence;
    return (dailyRun ? tonight(dailyRun.day) : jobOperation(level)).documents;
  }

  function missionOutcome(cleared: boolean): MissionOutcome {
    return { contract, cleared, alarms: stats.alarms, burned, units: documentsCollected, totalUnits: Math.max(1, totalFragments) };
  }

  /** Pulls out of the job from the pause sheet: a failed run, as if caught; training just goes back to the menu. */
  function abandonJob(): void {
    closeControls();
    if (training) {
      controller.abort();
      hud.setCoach(null);
      hud.reopenMissionBrief();
      return;
    }
    triggerCaught('Job abandoned', 'You pulled out before the job was done.');
  }

  /** Reads Control's letter again, the job paused under it. */
  function openLetter(): void {
    if (!jobLetter || letterOpen || cleared || caught) return;
    closeBlueprint();
    closeControls();
    letterOpen = true;
    hud.showDossier(jobLetter, { label: 'Back to the job', onClick: () => (letterOpen = false) });
  }

  function closeLetter(): void {
    if (!letterOpen) return;
    letterOpen = false;
    hud.closeDossier();
  }

  function toggleControls(): void {
    if (!controlsOpen && (cleared || caught)) return;
    if (mapOpen) closeBlueprint();
    controlsOpen = !controlsOpen;
    hud.showControls(controlsOpen);
  }

  function closeControls(): void {
    if (!controlsOpen) return;
    controlsOpen = false;
    hud.showControls(false);
  }
  const markedRooms = new Set<BuiltRoom>(); // storage rooms a powered grid has marked with a beacon
  const reconRooms = new Set<BuiltRoom>(); // records rooms the recon showed: their files are marked on the blueprint (but no beacon: they're not behind a key)
  // Tallied over the job for the end-of-job report.
  const stats = { seconds: 0, botsStunned: 0, empsUsed: 0, takedowns: 0, shotsFired: 0, alarms: 0, timesSpotted: 0, timesHit: 0, lockersOpened: 0, riggedLockers: 0, gridsPowered: 0, bodiesFound: 0 };
  let empCharges = training ? TRAINING_KIT.emp : diff.empAtStart;
  // Remote traps set this job, and which one's camera is on screen.
  const traps: TrapRig[] = [];
  let trapsLeft = training ? TRAINING_KIT.traps : diff.trapsAtStart;
  let trapAiming = false; // lining up a roll: its path is drawn on the floor (trapAim.ts)
  const trapAim = buildTrapAim(root.scene);
  let trapView = 0;
  let trapsSet = 0;
  let torchOns = 0; // times the torch has been switched on (training's torch lesson)
  let trapKills = 0; // enemies a trap has knocked out
  let packTraps = 0; // traps set at a watchdog pack's meeting point
  let bestBlast = 0; // the most enemies one trap blast has taken out
  // The trap camera's infrared lamp: lit only while its feed is drawn. Made once, up front, so
  // setting a trap never changes the scene's light count (which would recompile every shader).
  const trapLamp = new THREE.SpotLight(0xd8ffe4, 0, 14, Math.PI / 3.2, 0.5, 1.2);
  root.scene.add(trapLamp, trapLamp.target);
  let lastShotAt = -Infinity; // stats.seconds when the player last fired — a shot is loud for a moment (noise.ts)
  // Walking distance from the player's cell to every cell of their floor, for enemies that hunt by ear.
  let soundMap: { key: string; dist: number[][] } | null = null;
  const noiseRing = new NoiseRing(root.scene);
  const takedownMarker = new TakedownMarker(root.scene);
  const aimMarker = new AimMarker(root.scene); // a reticle on the enemy the gun has in its sights
  let aloft: Aloft | null = null; // up a tower or on the pipes (pipes.ts)
  let guardPull: { guard: Bot; t: number; from: THREE.Vector3; thudded: boolean } | null = null; // a guard being hauled over the rail by the hanging agent
  /** The agent's own strength (grapple.ts): what a hang from a grapple line runs on, 1 full. */
  let strength = 1;
  let strainShown: StrainView | null = null;
  let aerialTarget: Enemy | null = null; // the unaware guard under the hanging agent, refreshed each frame
  let lookout = 0; // 0 the chase camera, 1 risen for the lookout from the top of a tower
  const tags = new Map<Enemy, number>(); // enemies tagged from a lookout, and when each tag runs out (stats.seconds)
  const tagMarkers = new TagMarkers(root.scene);
  const onceToasts = new Set<string>(); // each how-to said once a job
  let takedownTarget: Enemy | null = null; // the enemy a takedown would hit right now, refreshed each frame
  let inCover: CoverSpot | null = null; // pressed up against a piece of furniture
  let aiming = false; // leaning out of cover with the crosshair up (setAiming)
  /** First-person shooter mode (the controls sheet, or `?fps=1` on localhost): the aim view is kept up all the time and the agent moves in it: W and S walk, Q and E sidestep, A and D (and the mouse or trackpad) turn, the pointer looks up and down, a click fires. */
  const fpsUrl = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('fps') === '1';
  /** First-person mode is on: from the controls sheet (the checkbox), or `?fps=1` on localhost. Read every time, so it can be switched mid-job. */
  let fpsUrlOn = fpsUrl; // (`?fps=1` starts it on; the key then switches it like the checkbox)
  const fpsOn = (): boolean => fpsUrlOn || controlSettings.fps;
  /** The view key: first-person on, or off again. */
  function toggleFpsView(): void {
    const on = !fpsOn();
    fpsUrlOn = false;
    setControls({ ...controlSettings, fps: on });
    hud.showToast(on ? 'FIRST-PERSON VIEW' : 'TOP-DOWN VIEW', 'neutral', 1800);
  }
  let fpsWas = false;
  let aimYaw = 0; // where the crosshair points, radians off the way the cover faces
  let aimMouse = 0; // mouse travel since the last frame, while aiming
  let aimManualAt = -99; // when the player last tilted the aim by hand (stats.seconds)
  let aimMouseY = 0; // and up and down, which tilts the aim on a platform
  let aimPitch = 0; // how far the aim is tilted, radians, up positive (platform aim only)
  let perchPosture: typeof postureState | null = null; // the posture to get back up to after aiming lying down on a platform
  let duckLatch = false; // a duck was just made: stepping out of cover waits for the stick or key to be let go
  let aimHintShown = false;
  let aimsBegun = 0; // times the agent has leaned out to aim, and guards downed by a shot fired doing it (training counts them)
  let aimedDowns = 0;
  let wallTops = 0; // times a climb got to the top, and rolls off it, for training
  /** Standing on a cargo container's roof (the bunker's): the height (world) they walk at, or null on the floor. */
  let roofY: number | null = null;
  let wallRolls = 0;
  let wallHangs = 0; // times a dash up a tall wall caught its shelf, the metres shimmied along it, the hops and the leaps off it, for training
  let hangMetres = 0;
  let wallHops = 0;
  let wallCrosses = 0; // times the agent has gone over a tall wall's top to its far side
  let wallLowers = 0; // drops from a tall wall's top shelf to its first
  let wallJumps = 0;
  let coverEncounterSpawned = -1;
  let lastCoverX = 0; // where cover last held the player, clear of walls
  let lastCoverZ = 0;
  let coverHintShown = false;
  // Automatic cover (the default; `?autocover=0` on localhost brings the old hold-to-cover back): cover is an indicator, not a hold. Near something to take cover behind, the agent goes see-through (and counts
  // as crouched to the guards and cameras); nothing stops them, slows them or turns them. Aiming is the `aim` key's (below), anywhere.
  const AUTO_COVER = !(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('autocover') === '0');
  const COVER_TAKE = 0.9; // how near a face the agent is covered
  const COVER_KEEP = 1.25; // ...and how far off it they stay so (so the edge does not flicker)
  let covered: CoverSpot | null = null;
  let coverFrom = { x: 0, z: 0 }; // where the agent was a frame ago, for how still they stand
  let coverIdle = 0; // seconds standing still
  let coveredToldOnce = false;
  let aimBase = 0; // the way the agent faced when aiming began, away from cover: the crosshair swings from it
  let dodgeCooldown = 0;
  let dodgeUntil = -Infinity; // stats.seconds until which bot shots miss (a dodge in progress)
  let hiddenIn: { rig: StaffLockerRig; floor: ActiveFloor } | null = null; // shut inside a staff locker
  let alarmOn = false;
  let alert: AlertState = QUIET; // the rung the building is on (alertstate.ts), shown as a chip beside the suspicion bar
  let lastSeen: { x: number; z: number; floor: number } | null = null; // where the agent was when something last had them: where a search starts
  let sweepLeft = 0;
  let hunterWaves = 0;
  let klaxon: Loop | null = null;
  const alarmLights = new AlarmLights(root.ambientLight);
  let lockerHintShown = false;
  let ventTransit: { left: number; moved: boolean; to: VentRig; floor: ActiveFloor;
  } | null = null;
  const tipping: Array<{ group: THREE.Group; t: number }> = []; // knocked-over clutter, falling
  let camo = FULL_CAMO;
  let goggles = FULL_GOGGLES;
  let nightVision = 0; // the goggles' look, eased in and out
  const infrared = new Infrared();
  root.postfx.heat.draw = (r, cam, sc) => infrared.draw(r, cam, sc);
  let ambientScale = 1; // the building's ambient glow: fades out in a blackout, amplified through goggles
  let blackoutSeen = false;
  const AMBIENT_BASE = root.ambientLight.intensity;
  const SUN_BASE = root.sunLight.intensity;
  let carried: Bot | null = null; // a stunned bot being dragged somewhere out of sight
  /** A body being put away (stash.ts): the agent is working the container; `loaded` once the body's in, `sealed` once it's shut again. */
  let stashing: { spot: StashSpot; floor: ActiveFloor; body: Bot; t: number; opened?: boolean; loaded: boolean; sealed: boolean; stand: { x: number; z: number }; facing: number;
  } | null = null;
  const bodies = new Map<Bot, { vis: number; found: boolean; notice: number }>(); // every guard that's down: how visible it lies (bodies.ts), how far a guard's noticing of it has got (1 = found), and whether it's been found
  let exposureNow = 0; // the visibility meter's reading this frame (0 with no guard near), for training
  let dashesBegun = 0; // dashes started, for training
  let trapsPlacedHere = 0; // traps set at the agent's feet, and traps rolled along the aim line: training's trap lessons
  let trapsPlacedRolled = 0;
  let bodiesHidden = 0; // dropped at BODY_HIDDEN_PCT or under — training's "hide the body"
  let bodiesStashed = 0; // put away in a locker, crate, vent or behind furniture
  const roomCellSets = new WeakMap<FloorContent, Set<string>>();
  /** Opened rigged lockers counting down to the alarm. */
  const fuses: Array<{ locker: Locker; floor: ActiveFloor; left: number; shown: number;
  }> = [];
  hud.setHack(null);
  hud.setFireCharge(1); // starts fully charged — avoids a stale bar from a previous job flashing for one frame before the loop's own per-frame update corrects it

  /** Whichever floor the player is currently on, bundled with its own gameplay content — read fresh every time, since activeFloorIdx changes as the player climbs/descends. */
  /** Standing in a blacked-out cell. */
  function inBlackout(): boolean {
    const { rig, content } = currentFloor();
    const x = Math.round((player.worldX - rig.group.position.x) / CELL);
    const y = Math.round((player.worldZ - rig.group.position.z) / CELL);
    return content.dark[y]?.[x] === true || content.powerCut[y]?.[x] === true;
  }

  function sight(): Sight {
    return goggles.on ? 'goggles' : player.torch ? 'torch' : 'bare';
  }

  function currentFloor(): ActiveFloor {
    return storeys[Math.min(activeFloorIdx, storeys.length - 1)]!;
  }

  // Only the point lights nearest the player shine (lightbudget.ts).
  const lightBudget = new LightBudget(root.scene, LIGHT_BUDGET, shadowsWanted() ? shadowLamps() : 0); // (the nearest few cast shadows: shadows.ts)
  let shadowTagAt = 0;

  // Sound (audio.ts): the listener follows the player, and anything with a
  // wall between it and the player is muffled.
  sound.start();
  sound.setOcclusion((x, z) => !hasLineOfSight(player.worldX, player.worldZ, x, z, currentFloor().rig.wallBoxes, Infinity));
  const ambienceFor = (rig: FloorRig): Loop => sound.loop(rig.theme.floor === 'raised' ? 'ambienceData' : 'ambience');
  /** Steel underfoot rings: the raised floors and the refinery's grating. */
  const metalFloor = (rig: FloorRig): boolean => rig.theme.floor === 'raised' || rig.theme.floor === 'grating';
  let ambience = ambienceFor(floor0);
  let soundFloorIdx = 0;
  const laserHums = storeys.flatMap(({ rig, content }, idx) => {
    const o = rig.group.position;
    return [
      ...content.laserBoxes.map((b) => ({
        idx,
        follow: null as MovingLaserRig | null,
        loop: sound.loop('laser', { x: (b.minX + b.maxX) / 2, y: o.y + 1, z: (b.minZ + b.maxZ) / 2 }, idx === 0 ? LASER_HUM : 0.0001),
      })),
      // The moving ones hum from wherever they are (tickMovingLasers moves them).
      ...[...content.sweepers, ...content.sliders, ...content.lines].map(({ rig: m }) => ({
        idx,
        follow: m,
        loop: sound.loop('laser', { x: m.hum.x + o.x, y: o.y + m.hum.y, z: m.hum.z + o.z }, idx === 0 ? LASER_HUM : 0.0001),
      })),
    ];
  });
  const flareHums: Loop[] = [];
  const music = sound.score(); // the soundtrack, with the heartbeat as its kick
  let lastHitAt = -Infinity; // stats.seconds when a bot's shot last landed — the chase music holds a few seconds after
  let heartBpm = CALM_BPM;
  const stepTimers = new Map<Enemy, number>();
  const chasing = new Set<Enemy>();
  const rotorHums = new Map<Drone, Loop>(); // each active drone's buzz, following it
  const pulseHums = new Map<Pulse, Loop>(); // each of this floor's pipe pulses' crackle, following it
  let pulseWarnedAt = -Infinity;
  /** When a pulse was last heading down the pipe the agent hangs from, within warning range: while it is, the hover's Interact is Drop, not the console's task. */
  let pulseThreatAt = -Infinity;
  let pulseWarnings = 0; // training's pulse lesson
  let aerialTakedowns = 0; // guards dropped on from the pipes
  let hackKeyTimer = 0;
  // The torch: on, you see far and guards notice its beam; off, you see only what's around you and they see less of you.
  const beamNoticed = new Map<Enemy, number>(); // stats.seconds until each bot can be drawn by the beam again
  let beamCheck = 0;
  let beamToastAt = -Infinity;
  let soundRefreshTimer = 0;

  // ---- training: the coach, and restarting a station after a failure ----
  let coverEnemy: Enemy | null = cover ? floor0Content.enemies[0] ?? null : null;
  let coverEnemyStation = 2;
  let station = 0;
  let stationStart: TrainingProgress | null = null; // progress when the current station began
  let trainingBegin: TrainingProgress | null = null; // progress when training began: what can't be done twice counts from here
  let lures = 0; // sentries a flare has drawn off their post
  let mapOpened = false;
  let goalBeacon: Beacon | null = null;
  const toExit = bfs(cells, cols, rows, exitX, exitY);

  /** The controls the coach should name: the touch ones once they're showing. */
  const onTouch = (): boolean => !document.getElementById('touch-controls')!.classList.contains('hidden-controls');

  refreshCoach = () => {
    if (training && !signal.aborted) showStation();
  };
  function showStation(): void {
    goalBeacon?.remove();
    goalBeacon = null;
    const st = stations[station];
    if (!st) return;
    // (The bunker and the tower keep their stations, beacons, gates and checkpoints, and say nothing: the training card in the top corner stays shut there.)
    hud.setCoach({ step: station + 1, total: stations.length, ...(levelName ? { kicker: levelName } : {}), ...(bunker || (tower && !exitMode) ? { quiet: true } : {}), title: st.title, text: onTouch() ? st.touch : keyed(st.keys) });
    if (st.goal) goalBeacon = new Beacon((storeys[st.level ?? 0]?.rig ?? floor0).group, st.goal.x * CELL, st.goal.y * CELL, GATE_COLOR);
  }

  function openGate(id: number): void {
    const rig = gates.get(id);
    if (!rig || rig.isOpen()) return;
    rig.open();
    sound.play('doorOpen', worldAt(floor0, rig.center.x, rig.center.z, 1.5));
    const i = floor0.wallBoxes.indexOf(rig.box);
    if (i !== -1) floor0.wallBoxes.splice(i, 1);
    if (ceiling || stealth || weapons || cover || corners || wall || highwall || range || !GUARD_GATES.includes(id)) setPassage(floor0Content.navCells, rig.door, true, cols, rows);
    navVersion++;
  }

  function closeGate(id: number): void {
    const rig = gates.get(id);
    if (!rig?.isOpen()) return;
    rig.close();
    sound.play('doorOpen', worldAt(floor0, rig.center.x, rig.center.z, 1.5));
    floor0.wallBoxes.push(rig.box);
    setPassage(floor0Content.navCells, rig.door, false, cols, rows);
    navVersion++;
  }

  function trainingProgress(): TrainingProgress {
    const { enemies, lights, terminals, servers } = floor0Content;
    return {
      cell: { x: Math.round(player.worldX / CELL), y: Math.round(player.worldZ / CELL) },
      takedowns: stats.takedowns,
      bodiesHidden,
      inCover: inCover !== null || covered !== null, // (the training lessons ask for cover: being covered counts)
      lightsOut: lights.filter((l) => l.disabled).length,
      torchOff: !player.torch,
      torchOns,
      switchedOff: floor0Content.fittings.filter((f) => f.kind === 'switch' && !f.on).length,
      gogglesOn: goggles.on,
      trapsSet,
      trapKills,
      patrolsDown: enemies.filter((e) => e instanceof Bot && !e.isSentry && e.disabled).length,
      hidden: hiddenIn !== null,
      dogsDown: enemies.filter((e) => e.kind === 'watchdog' && e.disabled).length,
      dronesDown: enemies.filter((e) => e.kind === 'drone' && e.disabled).length,
      packSpotted: floor0Content.packs.some((p) => p.spotted),
      packTraps,
      packLeft: floor0Content.packs.reduce((n, p) => n + p.members.filter((d) => !d.disabled).length, 0),
      bestBlast,
      hacked: terminals.some((t) => t.hacked),
      gridOn: servers.some((sv) => sv.online),
      lures,
      sentriesDown: enemies.filter((e) => e instanceof Bot && e.isSentry && e.disabled).length,
      documents: documentsCollected,
      mapOpened,
      aloft: aloft?.kind === 'haul' || aloft?.kind === 'shaft' ? 'climb' : aloft?.kind === 'zip' || aloft?.kind === 'ledge' || aloft?.kind === 'highwall' ? 'hang' : aloft?.kind === 'wall' ? null : (aloft?.kind ?? null),
      tagged: tags.size,
      gripLine: aloft?.kind === 'hang' ? aloft.grip.line : null,
      aerialTakedowns,
      pulseWarnings,
      uplinkDown: jobUplink !== null && !jobUplink.online,
      logsWiped,
      stashes: bodiesStashed,
      exposure: exposureNow,
      posture: postureState.posture,
      dashes: dashesBegun,
      trapsHere: trapsPlacedHere,
      trapsRolled: trapsPlacedRolled,
      shots: stats.shotsFired,
      dryFires,
      aimsBegun,
      aimedDowns,
      wallTops,
      wallRolls,
      wallHangs,
      hangMetres,
      wallHops,
      wallJumps,
      wallLowers,
      wallCrosses,
      flashes: flashesUsed,
      flashDazed,
      coverEncounter: coverEnemy ? { station: coverEnemyStation, disabled: coverEnemy.disabled } : null,
      enemiesDown: enemies.filter((e) => e.disabled).length,
      heaviesDown: enemies.filter((e) => e instanceof Bot && e.kind === 'heavy' && e.disabled).length,
    };
  }

  /** One live opponent at a time, sharing the course's cover and retry machinery. */
  function spawnCoverEncounter(): void {
    const kind = stations[station]?.enemy;
    if (!cover || !kind || !layout) return;
    const bay = stations[station]!.goal;
    if (
      !inCover ||
      !bay ||
      Math.hypot(player.worldX - bay.x * CELL, player.worldZ - bay.y * CELL) > 2
    )
      return;
    goalBeacon?.remove();
    goalBeacon = null;
    if (coverEncounterSpawned === station) return;
    const point = stations[station]!.enemyAt;
    if (!point) return;
    const x = point.x * CELL,
      z = point.y * CELL;
    const make = (): Enemy => {
      if (kind === 'watchdog') return new Watchdog(root.scene, x, z, 0, 0, 0);
      if (kind === 'crawler') return new Crawler(root.scene, x, z, 0, 0, 0);
      if (kind === 'drone')
        return new Drone(root.scene, x, z, 0, 0, 0, cols, rows, [point]);
      const bot = new Bot(
        root.scene,
        x,
        z,
        0,
        0,
        0,
        kind === 'heavy' ? 'heavy' : kind === 'hunter' ? 'hunter' : 'guard'
      );
      if (kind === 'heavy') bot.setPost(x, z, Math.PI);
      return bot;
    };
    const enemy = make();
    coverEnemy = enemy;
    coverEnemyStation = station;
    coverEncounterSpawned = station;
    floor0Content.enemies.push(enemy);
    floor0Content.spawners.set(enemy, make);
    suspicion = 0;
    hud.setSuspicion(0);
  }

  /** Moves the coach on once the current station is done, opening its gate. Every frame, in training. */
  function tickTraining(): void {
    spawnCoverEncounter();
    // The trap lessons can't strand you: out of traps with none armed, one more is found.
    if (weapons && trapsLeft === 0 && traps.length === 0 && /trap|Blow/i.test(stations[station]?.title ?? '')) {
      trapsLeft = 1;
      hud.setTrapsLeft(trapsLeft);
    }
    const now = trainingProgress();
    stationStart ??= now;
    trainingBegin ??= now;
    const next = advance(station, now, stationStart, stations, trainingBegin);
    for (const id of next.opened) openGate(id);
    for (const id of next.closed) closeGate(id);
    for (const note of next.notes) hud.showToast(note, 'neutral');
    // The kit tops itself back up, everywhere in training: a wasted EMP or a trap rolled to the wrong spot
    // mustn't leave you with no way past a dog or a pack. (Two traps out at once still means blowing one first.)
    if (empCharges < TRAINING_KIT.emp) {
      empCharges = TRAINING_KIT.emp;
      hud.showToast(levelName ? 'EMP RESTOCKED' : 'TRAINING · EMP RESTOCKED', 'neutral');
    }
    if (trapsLeft < TRAINING_KIT.traps) {
      trapsLeft = TRAINING_KIT.traps;
      hud.setTrapsLeft(trapsLeft);
      hud.showToast(levelName ? 'TRAPS RESTOCKED' : 'TRAINING · TRAPS RESTOCKED', 'neutral');
    }
    if (weapons && flashesLeft < TRAINING_KIT.flash) {
      flashesLeft = TRAINING_KIT.flash;
      hud.setFlashes(flashesLeft);
      hud.showToast(levelName ? 'FLASH GRENADES RESTOCKED' : 'TRAINING · FLASH GRENADES RESTOCKED', 'neutral');
    }
    if (next.index === station) return;
    station = next.index;
    stationStart = now;
    spawnCoverEncounter();
    if (course && !tower && !highwall && !bunker && station < stations.length) reportTry({ kind: 'train', course, event: 'reach', station: station + 1 });
    strength = 1; // each station starts with fresh arms
    sound.play('ding', undefined, 0.5);
    hud.coachDone();
    window.setTimeout(() => {
      if (!signal.aborted) showStation();
    }, 900);
  }

  /** In training, getting caught restarts the station instead of ending the job. */
  function failStation(title: string): void {
    if (course && !tower && !highwall && !bunker) reportTry({ kind: 'train', course, event: 'fail', station: station + 1 });
    caught = true; // holds everything still until the restart
    endFlashOffer();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    closeBlueprint();
    closeControls();
    sound.play('caught');
    hud.showSpottedBanner(title);
    window.setTimeout(() => {
      if (signal.aborted) return;
      hud.setFade(true);
      window.setTimeout(() => {
        if (signal.aborted) return;
        restartStation();
        hud.setFade(false);
        caught = false;
      }, 400);
    }, (TRAINING_FAIL_S + (player.isDown ? 1.5 : 0)) * 1000); // (a fall is let play out, and lie a moment)
  }

  /** Back to the station's checkpoint: suspicion cleared, and every guard and dog still standing back where it began. */
  function restartStation(): void {
    player.revive(); // (down, if that was what failed it)
    if (hiddenIn) exitLocker();
    leaveCover();
    aloft = null;
    roofY = null;
    blindedFor = 0;
    strength = 1;
    drawRope(null, null);
    player.camSwing = 0;
    // A body in your arms is set down where it is (not left hanging in the air).
    if (carried?.carriable) carried.layDown(carried.worldX, carried.worldZ, carried.facing);
    carried = null;
    stashing = null;
    ventTransit = null;
    const replaced = new Map<Enemy, Enemy>();
    for (const { content } of tower || bunker ? storeys : [storeys[0]!]) {
      const fresh: Enemy[] = [];
      content.enemies = content.enemies.filter((e) => {
        if (e.disabled) return true;
        // Anyone called in (hunters) just goes; the hand-placed ones start over.
        e.setVisible(false);
        chasing.delete(e);
        const make = content.spawners.get(e);
        content.spawners.delete(e);
        if (make) {
          const again = make();
          content.spawners.set(again, make);
          fresh.push(again);
          replaced.set(e, again);
        }
        return false;
      });
      content.enemies.push(...fresh);
      // A pack whose dogs started over is a new pack of the fresh dogs, on the same meeting point.
      content.packs = content.packs.map((p) =>
        p.members.some((d) => replaced.has(d))
          ? new WatchdogPack(
              p.members.map((d) => (replaced.get(d) as Watchdog | undefined) ?? d),
              p.cell,
              content.navCells,
              cols,
              rows,
              0,
              0,
              p.roamS
            )
          : p
      );
    }
    if (coverEnemy) coverEnemy = replaced.get(coverEnemy) ?? coverEnemy;
    const cp = stations[station]!.checkpoint;
    // Facing on, toward the way out.
    const onward = (['N', 'S', 'E', 'W'] as const).find((d) => cells[cp.y]![cp.x]![d] && toExit[cp.y + DIR_DELTA[d][1]]?.[cp.x + DIR_DELTA[d][0]] === toExit[cp.y]![cp.x]! - 1);
    const facing = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[onward ?? 'E'];
    // On the ground floor: without a height, place() would keep the one you had, up on a pipe.
    if (tower) player.place(towerLanding.x, towerLanding.z, towerLanding.angle, towerLanding.y);
    // (The cameras look away for a few seconds, so the agent put back at a stair's head is not caught again before they can move.)
    if (bunker) for (const c of towerCams) { c.seen = 0; c.quietUntil = stats.seconds + 4; c.lockUntil = 0; }
    if (tower) for (const c of towerCams) { c.seen = 0; c.quietUntil = stats.seconds + 4; c.lockUntil = 0; }
    else player.place(cp.x * CELL, cp.y * CELL, facing, (stations[station]!.checkpointLevel ?? 0) * floorHeight);
    // A station up on the pipes starts over on its tower's platform, ready to grab the pipe again.
    const perchOn = stations[station]!.perch;
    const perchTower = perchOn !== undefined ? floor0Content.pipeRig?.towers[perchOn] : undefined;
    if (perchOn !== undefined && perchTower) aloft = { kind: 'perch', floor: { rig: floor0, content: floor0Content }, tower: perchOn, angle: perchTower.out };
    suspicion = 0;
    hud.setSuspicion(suspicion);
    empCharges = Math.max(empCharges, 1);
    camo = FULL_CAMO;
    stationStart = null;
    hud.showToast(tower ? `BACK AT THE CHECKPOINT · ${towerLandingLabel.toUpperCase()}` : 'TRY AGAIN', 'neutral');
    showStation();
  }

  function showTrainingDone(): void {
    try {
      window.localStorage.setItem(dock ? 'mazeHeist.dockPlayed' : highwall ? TRAINED_HIGHWALL_KEY : wall ? TRAINED_WALL_KEY : corners ? TRAINED_CORNERS_KEY : cover ? TRAINED_COVER_KEY : weapons ? TRAINED_WEAPONS_KEY : stealth ? TRAINED_STEALTH_KEY : grapple ? TRAINED_GRAPPLE_KEY : ceiling ? TRAINED_CEILING_KEY : TRAINED_KEY, '1');
    } catch {
      // Storage blocked: the brief just offers training first again next time.
    }
    if (!ceiling && !dock) void saveProfile({ trained: true });
    if (stealth) void saveProfile({ stealthTrained: true });
    if (grapple) reportTry({ kind: 'grapple', use: 'course' });
    if (course && !tower && !highwall && !bunker) reportTry({ kind: 'train', course, event: 'done' });
    hud.setCoach(null);
    const next = ceiling && !grapple ? CEILING_BEFORE_JOB : 1;
    // Straight after the first course, staying hidden is offered (once), and after that the grapple: the primary button learns it, the other skips it.
    // And before the staying-hidden course, the gun's: the first course ends by offering it (it can be skipped).
    const offerWeapons = !ceiling && !dock && !stealth && !weapons && !cover && !corners && !wall && !highwall && !weaponsTrained();
    // The gun's course ends by offering cover fire (it can be skipped).
    const offerCover = weapons && !coverTrained();
    // And the cover course ends by offering the corners and the high ground.
    const offerCorners = cover && !cornersTrained();
    // And the corners course ends by offering the wall climb.
    const offerWall = corners && !wallTrained();
    const offerStealth = !ceiling && !dock && !stealth && !stealthTrained();
    const offerGrapple = !ceiling && !dock && !grappleTrained();
    // (Offered here, so the letter before the job does not offer it again.)
    if (offerGrapple) markOffered('grapple');
    hud.showReport({
      kicker: dock ? 'Dock yard · Complete' : wall ? 'Training · Over the wall · Complete' : corners ? 'Training · Corners & high ground · Complete' : cover ? 'Training · Cover fire & enemies · Complete' : weapons ? 'Training · The gun · Complete' : stealth ? 'Training · Staying hidden · Complete' : grapple ? 'Training · Grapple · Complete' : ceiling ? 'Training · Up high · Complete' : 'Training · Complete',
      title: dock ? 'Out through the gate' : wall ? 'Ready to go over the wall' : corners ? 'Ready for corners and rooftops' : cover ? 'Ready to fight from cover' : weapons ? 'Ready to shoot straight' : stealth ? 'Ready to stay out of sight' : grapple ? 'Ready to go over their heads' : ceiling ? 'Ready for the ceiling' : 'Ready for a real job',
      note: dock
        ? 'Open air: the fence is a boundary you can see through, containers are the walls, and a zipline is a shortcut that shows you to everyone who looks up.'
        : wall
        ? 'On a job any maze wall is cover for a dash and a climb: lie along the top out of sight of guards and dogs, shoot or drop from there, and keep an eye on the sky, because a drone still sees you.'
        : corners
        ? 'On a job a wall that ends at a turn or a doorway is a corner to hold, and a tower’s platform sees over the walls: lie flat, tilt down, and remember a wall still hides what is behind it.'
        : cover
        ? 'On a job the crate is a desk, a rack, a statue’s plinth: tall cover blocks your shot as well as their eyes, so lean out past its end, shoot, and duck back before the chime.'
        : weapons
        ? 'On a job every shot works the same way: one, then the chime. Count the wait before you step out, and never fire into a recharge.'
        : stealth
        ? 'On a job it’s light, distance and how low you are that decide it: watch the meter, and go lower the moment it climbs.'
        : grapple
          ? 'On a job the pipes run over the whole building, and your arms are all that keeps you up there: mind the sweat.'
          : ceiling
            ? 'On a job the towers, pipes and lasers are wherever the building puts them, and the pulses don’t wait for the lesson.'
            : 'On a real job it all comes at once, the maze is new every time, and nothing waits for you to read the manual.',
      grade: null,
      stamp: { text: 'Done', label: dock ? 'Yard' : 'Training' },
      // No par time: there's no clock on training.
      rows: reportRows(jobStats(true)).map(([label, value]) => [label, label === 'Time' ? value.split(' / ')[0]! : value]),
      points: null,
      continueLabel: offerWall ? 'Learn the wall climb' : offerCorners ? 'Learn corners and high ground' : offerCover ? 'Learn cover fire' : offerWeapons ? 'Learn the gun' : offerStealth ? 'Learn to stay hidden' : stealth && stealthResume ? 'Back to the mission' : offerGrapple ? 'Learn the grapple' : `Start job ${next}`,
      onContinue: () => {
        controller.abort();
        if (offerWall) startJob(1, 'wall');
        else if (offerCorners) startJob(1, 'corners');
        else if (offerCover) startJob(1, 'cover');
        else if (offerWeapons) startJob(1, 'weapons');
        else if (offerStealth) startJob(1, 'stealth');
        else if (stealth && stealthResume) {
          // The lesson was in the way of a mission: on to it.
          const go = stealthResume;
          stealthResume = null;
          go();
        }
        else if (offerGrapple) startJob(1, 'grapple');
        else if (ceiling || dock) briefThenStart(next);
        else startJob(next);
      },
      // The stealth course can't be skipped; the grapple's offer can.
      ...(offerWall
        ? {
            secondary: {
              label: 'Skip the wall climb',
              onClick: () => {
                controller.abort();
                if (offerStealth) startJob(1, 'stealth');
                else if (offerGrapple) startJob(1, 'grapple');
                else startJob(next);
              },
            },
          }
        : offerCorners
        ? {
            secondary: {
              label: 'Skip corners and high ground',
              onClick: () => {
                controller.abort();
                if (offerStealth) startJob(1, 'stealth');
                else if (offerGrapple) startJob(1, 'grapple');
                else startJob(next);
              },
            },
          }
        : offerCover
        ? {
            secondary: {
              label: 'Skip the cover lesson',
              onClick: () => {
                controller.abort();
                if (offerStealth) startJob(1, 'stealth');
                else if (offerGrapple) startJob(1, 'grapple');
                else startJob(next);
              },
            },
          }
        : offerWeapons
        ? {
            secondary: {
              label: 'Skip the gun lesson',
              onClick: () => {
                controller.abort();
                if (offerStealth) startJob(1, 'stealth');
                else if (offerGrapple) startJob(1, 'grapple');
                else startJob(next);
              },
            },
          }
        : !offerStealth && !(stealth && stealthResume) && offerGrapple
        ? {
            secondary: {
              label: 'Straight to job 1',
              onClick: () => {
                controller.abort();
                startJob(1);
              },
            },
          }
        : {}),
    });
    hud.setReportLeaderboard(null, '');
  }

  // Each capture on a job of the campaign can turn up a page of Control's file (shared/memories.ts).
  let captures = 0;
  let filesRead = 0; // every file taken this job, for the page it opens to
  function collectDocument(files = 1, say?: { step: string; all: string }): void {
    documentsCollected += files;
    filesRead++;
    // A file page turns up in some of them (the campaign, the first time).
    let page: ReturnType<typeof nextMemory> = null;
    if (!training && !dailyRun) {
      captures++;
      page = nextMemory(level, captures, seenMemories);
      if (page) {
        keepMemory(page.id);
        reportTry({ kind: 'story', what: 'memory', job: level, n: page.n });
      }
    }
    // Every file taken opens to be read, on a page of its own, the job waiting while it is: a moment after the shutter, or the keycard, or the sample.
    if (!training) {
      const note = page;
      const n = filesRead;
      later(() => {
        if (cleared || caught || readerOpen) return;
        const doc = documentFor(place.id, level, n);
        readerOpen = true;
        hud.showReader(
          { ...doc, count: note ? `From Control’s file · ${seenMemories.size} of ${MEMORY_TOTAL}` : `File ${Math.min(n, Math.max(1, totalFragments))} of ${Math.max(1, totalFragments)}`, note: note ? `Control: ${note.text}` : null },
          () => (readerOpen = false)
        );
      }, 900);
    }
    music.stinger('document');
    hud.setDocuments(documentsCollected, totalFragments);
    if (documentsCollected >= totalFragments) {
      exitLift.setState('ready');
      setLiftOpen(exitLift, true);
      sound.play('ding', { x: exitLift.front.x, y: 2.5, z: exitLift.front.z });
      hud.showToast(say?.all ?? `ALL FILES CAPTURED · ${EXIT.open}`, 'good');
    } else {
      hud.showToast(say?.step ?? `FILE CAPTURED · ${documentsCollected}/${totalFragments}`, 'good');
    }
  }

  // ---- the contract's steps (objectives.ts) ----

  const doneSteps = new Set<string>(storeys.flatMap((f) => f.content.skippedSteps));
  const contentList: FloorContent[] = storeys.map((f) => f.content);
  const objectiveMarkers = new ObjectiveMarkers(root.scene);
  const carrierBot = floor0Content.carrier;
  const realContainer = objective?.steps.find((st) => st.kind === 'tracker' && !st.decoy)?.letter ?? null;
  let specimen: { since: number; mesh: THREE.Group } | null = null;
  let fuseLitAt: number | null = null;
  let manifestRead = false;
  hud.setUnitName(tower ? 'CARDS' : objective ? objective.unitName : 'FILES');
  hud.setUplinkName(contract === 'records' ? 'Uplink' : 'Alarm link');
  hud.setPdaExtra(objective ? 'hide' : null);

  /** Both hands busy: a body in the arms, or a specimen in its case. */
  const handsFull = (): boolean => carried !== null || specimen !== null;

  /** Whether the exit takes you: every unit done and, on an extraction, the specimen still in hand. */
  const exitReady = (): boolean =>
    documentsCollected >= totalFragments &&
    (!hunt || dossier.found) &&
    (contract !== 'extract' || specimen !== null) &&
    // With an AI partner, the lift takes the two of you together: it is in the cab, or beside you in it (or has waited long enough for a partner that can't get through).
    (!partner ||
      mayLeaveWithout(partnerState, partnerLiftWait) ||
      (partnerState === 'free' &&
        ((partner.currentFloorIdx === exitFloorIdx && exitLift.contains(partner.worldX, partner.worldZ)) ||
          (exitLift.contains(player.worldX, player.worldZ) && partner.currentFloorIdx === player.currentFloorIdx && Math.hypot(partner.worldX - player.worldX, partner.worldZ - player.worldZ) <= 1.4) ||
          (partnerLiftWait > 3 && partner.currentFloorIdx === player.currentFloorIdx && together(partnerState, { x: player.worldX, z: player.worldZ }, { x: partner.worldX, z: partner.worldZ })))));

  /** Why a contract station can't be worked yet (a step it needs), or null. */
  function stepBlockedNow(w: Workstation): string | null {
    return w.step ? stepBlocked(w.step.step, doneSteps) : null;
  }

  function newSpecimenCase(): THREE.Group {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.46, 14), new THREE.MeshStandardMaterial({ color: 0xbfeaf0, transparent: true, opacity: 0.4, roughness: 0.1, emissive: 0x4ee0d0, emissiveIntensity: 0.9, depthWrite: false }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x2a3338, roughness: 0.4, metalness: 0.6 }));
    cap.position.y = 0.25;
    const base = cap.clone();
    base.position.y = -0.25;
    g.add(glass, cap, base);
    return g;
  }

  /** The specimen is out of its pod and in the agent's arms: slower, no grapple, no dash, no bodies, and warming. */
  function takeSpecimen(): void {
    const mesh = newSpecimenCase();
    root.scene.add(mesh);
    specimen = { since: stats.seconds, mesh };
  }

  /** It warmed through: back in its pod (the unit is undone, the lift shuts) to be fetched again. */
  function spoilSpecimen(): void {
    if (!specimen) return;
    root.scene.remove(specimen.mesh);
    specimen = null;
    documentsCollected = Math.max(0, documentsCollected - 1);
    hud.setDocuments(documentsCollected, totalFragments);
    doneSteps.delete('cryo');
    for (const c of contentList) for (const w of c.workstations) if (w.step?.step.id === 'cryo') {
      w.captured = false;
      w.step.rig.setState('ready');
    }
    if (!cleared) {
      setLiftOpen(exitLift, false);
      exitLift.setState('locked');
    }
    sound.play('denied');
    hud.showToast('SPECIMEN SPOILED · IT WARMED THROUGH · FETCH ANOTHER FROM THE POD, AND KEEP MOVING', 'bad', 5200);
  }

  /** A contract step's task finished at its station. */
  function finishStep(w: Workstation, floor: ActiveFloor): void {
    const st = w.step!;
    const step = st.step;
    const at = worldAt(floor.rig, w.x, w.z);
    w.captured = true;
    if (step.decoy) {
      // The wrong container: its lock trips an alarm. Suspicion jumps and the guards come to see.
      st.rig.setState('wrong');
      sound.play('alert', at);
      hud.showToast(step.done, 'bad', 4400);
      suspicion = applySuspicion(suspicion, DECOY_SUSPICION);
      const o = floor.rig.group.position;
      for (const e of floor.content.enemies) {
        if (e instanceof Bot && !e.disabled && Math.hypot(e.worldX - w.x - o.x, e.worldZ - w.z - o.z) < DECOY_CALLS_M) e.investigate(w.x + o.x, w.z + o.z, 6, floor.content.navCells, floor.content.cols, floor.content.rows, 99);
      }
      return;
    }
    doneSteps.add(step.id);
    markGoal(`${step.name ?? 'Objective'} done`);
    st.rig.setState('done');
    sound.play(step.kind === 'charge' ? 'clatter' : step.kind === 'tracker' || step.kind === 'cryo' ? 'ding' : 'hackDone', at);
    if (step.kind === 'manifest') {
      manifestRead = true;
      st.rig.setScreen?.(`CONTAINER ${realContainer ?? '?'}`);
    }
    if (step.kind === 'cryo') takeSpecimen();
    completeUnit(step);
  }

  /** One of the contract's units done (a station worked, or the keycard taken): the count, the exit and the words for it. */
  function completeUnit(step: Step): void {
    if (!step.unit) return;
    let all = `${step.done} · ${EXIT.open}`;
    if (step.kind === 'charge' && objective && objective.steps.filter((c) => c.kind === 'charge').every((c) => doneSteps.has(c.id))) {
      fuseLitAt = stats.seconds;
      all = `ALL CHARGES SET · THE FUSE IS LIT · ${objective.fuseS} SECONDS · ${EXIT.open} · RUN`;
      sound.play('alert');
    }
    collectDocument(1, { step: `${step.done} · ${documentsCollected + 1}/${totalFragments}`, all });
  }

  /** The charges went off, and so did the agent. */
  function blast(): void {
    sound.play('boom');
    flashCaughtLights(root);
    triggerCaught('Caught in the blast', 'The charges went off with you still inside.');
  }

  /** The contract's per-frame upkeep: the keycard off the carrier, the specimen warming, the fuse, the PDA's line and the markers. */
  function objectiveTick(): void {
    if (!objective) return;
    const pda = (label: string, value: string, state: 'done' | 'todo' | 'alert' | 'urgent'): void => hud.setPdaExtra({ label, value, state });
    if (cleared || caught) return;
    // The keycard: the marked guard, once down and within reach of the agent.
    if (carrierBot && !doneSteps.has('keycard') && carrierBot.disabled && Math.hypot(carrierBot.worldX - player.worldX, carrierBot.worldZ - player.worldZ) < KEYCARD_REACH && Math.abs(carrierBot.floorY - player.worldY) < 1.2) {
      doneSteps.add('keycard');
      sound.play('loot');
      const step = objective.steps.find((st) => st.kind === 'keycard')!;
      completeUnit(step);
    }
    // The specimen warming.
    const warm = specimen ? specimenWarmth(stats.seconds - specimen.since) : 0;
    if (specimen && warm >= 1) spoilSpecimen();
    // The fuse.
    const left = fuseLeft(fuseLitAt, stats.seconds, objective.fuseS);
    if (left !== null && left <= 0 && fuseLitAt !== null) {
      fuseLitAt = null;
      blast();
      return;
    }
    switch (objective.contract) {
      case 'sabotage': {
        const fuseText = left === null ? 'Unlit' : `${Math.floor(Math.ceil(left) / 60)}:${String(Math.ceil(left) % 60).padStart(2, '0')}`;
        pda('Fuse', fuseText, left === null ? 'todo' : left <= 20 ? 'urgent' : 'alert');
        break;
      }
      case 'extract':
        pda('Specimen', specimen ? `Warming ${Math.round(warm * 100)}%` : doneSteps.has('cryo') ? 'Out' : 'In its pod', specimen ? (warm >= 0.7 ? 'urgent' : 'alert') : 'todo');
        break;
      case 'shipment':
        pda('Container', manifestRead ? (realContainer ?? '?') : '?', manifestRead ? 'done' : 'todo');
        break;
      case 'swap':
      case 'vault':
        pda('Keycard', doneSteps.has('keycard') ? 'Taken' : 'On the guard', doneSteps.has('keycard') ? 'done' : 'alert');
        break;
      default:
        break;
    }
    // Markers: the guard with the card, and the station to go to next.
    const marks: Array<{ x: number; y: number; z: number }> = [];
    if (carrierBot && !doneSteps.has('keycard') && !carrierBot.disabled) marks.push({ x: carrierBot.worldX, y: carrierBot.floorY + 2.95, z: carrierBot.worldZ });
    const next = nextStep(objective, doneSteps);
    if (next && stepBlocked(next, doneSteps) === null && !(jobUplink?.online)) {
      for (const c of contentList) {
        const st = c.stations.find((q) => q.step.id === next.id);
        const rig = storeys.find((f) => f.content === c)?.rig.group.position;
        if (st && rig && !workstationDone(st)) marks.push({ x: st.rig.at.x + rig.x, y: rig.y + 3.0, z: st.rig.at.z + rig.z });
      }
    }
    objectiveMarkers.update(marks, clock.elapsedTime);
  }

  const workstationDone = (st: StationRuntime): boolean => doneSteps.has(st.step.id);

  // ---- the job's twists (twists.ts) ----

  const clockLimit = twists.includes('timer') ? TIMER_S[contract] : 0;
  let lockdownUntil = 0;
  const twistFired = new Set<TwistId>();
  hud.setTwist(twists.length ? chipText(twists) : null, false, twists.map((id) => TWIST_NOTES[id].text).join(' '));

  /** The shift changes: each patrol takes the next one's beat and sets off on it, so the rounds learned so far stop holding. */
  function shiftChange(): void {
    let changed = 0;
    for (const c of contentList) {
      const patrols = c.enemies.filter((e): e is Bot => e instanceof Bot && e.kind === 'patrol' && !e.disabled);
      const beats = patrols.map((p) => p.getBeat());
      patrols.forEach((p, i) => p.reroute(beats[(i + 1) % patrols.length]!));
      changed += patrols.length;
    }
    sound.play('alert');
    hud.showToast(`SHIFT CHANGE · ${changed} PATROL${changed === 1 ? '' : 'S'} ON NEW ROUTES`, 'bad', 4200);
  }

  /** The twists that happen during the job: when they fire, the lockdown's end, the clock, and the chip that says so. */
  function twistTick(): void {
    if (twists.length === 0 || cleared || caught) return;
    const now = stats.seconds;
    for (const t of timedTwists(twists)) {
      if (twistFired.has(t.id) || now < t.at) continue;
      twistFired.add(t.id);
      if (t.id === 'lockdown') {
        lockdownUntil = now + t.lasts;
        sound.play('alert');
        hud.showToast(`LOCKDOWN · EVERY ROOM DOOR IS SEALED FOR ${t.lasts} SECONDS · KEEP MOVING`, 'bad', 5000);
      }
      if (t.id === 'shiftchange') shiftChange();
    }
    if (lockdownUntil > 0 && now >= lockdownUntil) {
      lockdownUntil = 0;
      hud.showToast('LOCKDOWN LIFTED · THE ROOM DOORS WORK AGAIN', 'good', 3200);
    }
    const mmss = (sec: number): string => `${Math.floor(Math.ceil(sec) / 60)}:${String(Math.ceil(sec) % 60).padStart(2, '0')}`;
    let urgent = false;
    const parts = twists.map((id) => {
      if (id === 'lockdown' && lockdownUntil > 0) return `LOCKDOWN ${Math.ceil(lockdownUntil - now)}s`;
      if (id === 'timer') {
        const left = Math.max(0, clockLimit - now);
        urgent = left <= 30;
        if (left <= 0 && !twistFired.has('timer')) {
          twistFired.add('timer');
          suspicion = Math.max(suspicion, ALARM_ON);
          hud.showToast('THE WINDOW HAS CLOSED · THE ALARM IS UP', 'bad', 5000);
        }
        return left > 0 ? `${TWISTS.timer.name} ${mmss(left)}` : 'TOO LATE';
      }
      return TWISTS[id].name;
    });
    hud.setTwist(parts.join(' · '), urgent);
  }

  // ---- the side goal (sidegoals.ts) ----

  const sideStats = (): SideStats => ({
    alarms: stats.alarms,
    timesSpotted: stats.timesSpotted,
    bodiesFound: stats.bodiesFound,
    shotsFired: stats.shotsFired,
    empsUsed: stats.empsUsed,
    trapsSet,
    flashesUsed,
    seconds: stats.seconds,
    parS: parSeconds(cols * rows + upperCells),
  });
  hud.setSide(null, false);
  let sideLostSaid = false;
  /** The chip under the twist's: the side goal, and whether it is still in play. */
  function sideTick(): void {
    if (!sideGoal || cleared || caught) return;
    const lost = sideBroken(sideGoal, sideStats());
    hud.setSide(`SIDE GOAL · ${SIDE_GOALS[sideGoal].name.toUpperCase()}${lost ? ' · LOST' : ''}`, lost, `${SIDE_GOALS[sideGoal].ask} Worth +${SIDE_BONUS} heist points.`);
    if (lost && !sideLostSaid) {
      sideLostSaid = true;
      hud.showToast(`SIDE GOAL LOST · ${SIDE_GOALS[sideGoal].name.toUpperCase()}`, 'bad', 3200);
    }
  }
  /** What the side goal earned on a cleared job: the bonus, and the line for the report. */
  function sideResult(): { bonus: number; row: [string, string] | null } {
    if (!sideGoal) return { bonus: 0, row: null };
    const ok = !sideBroken(sideGoal, sideStats());
    return { bonus: ok ? SIDE_BONUS : 0, row: ['Side goal', `${SIDE_GOALS[sideGoal].name} · ${ok ? `+${SIDE_BONUS}` : 'missed'}`] };
  }

  // ---- the heist loop: uplink, capture, wipe ----

  /** The cells on the floors above the first (the par time and the stats count them). */
  const upperCells = storeys.slice(1).reduce((n, f) => n + f.rig.cols * f.rig.rows, 0);
  const floorContents = (): FloorContent[] => storeys.map((f) => f.content);
  // One network per building: the uplink and the log server may be on different floors.
  const jobUplink = floorContents().find((c) => c.uplink)?.uplink ?? null;
  const jobLogServer = floorContents().find((c) => c.logServer)?.logServer ?? null;
  const allWorkstations = floorContents().flatMap((c) => c.workstations);
  // Records-room screens show red while the uplink is up: a capture now would go straight out.
  if (jobUplink) for (const w of allWorkstations) w.room.setState('ready');

  /** The uplink, a workstation or the log console, done. */
  function finishTask(task: Task): void {
    const { floor } = task;
    if (task.kind === 'slide') {
      startSlide(task.station.bank);
      return;
    }
    markGoal(task.kind === 'capture' ? 'File captured' : task.kind === 'uplink' ? (task.station.online ? (contract === 'records' ? 'Uplink down' : 'Alarm link down') : 'Uplink restored') : task.kind === 'wipe' ? 'Logs wiped' : task.kind === 'clue' ? 'Terminal hacked' : task.kind === 'crate' ? (task.station.container.id === dossierContainer()?.id ? 'Dossier found' : 'Container opened') : 'Line cut');
    if (task.kind === 'capture' && !training && aloft?.kind === 'hang' && (aloft.low ?? 0) >= 1) reportTry({ kind: 'grapple', use: 'capture' });
    const at = worldAt(floor.rig, task.station.x, task.station.z);
    if (task.kind === 'uplink') {
      const up = task.station;
      up.online = !up.online;
      up.room.setState(up.online ? 'idle' : 'active');
      sound.play(up.online ? 'powerUp' : 'hackDone', at);
      if (up.online) {
        up.restored = true;
        score += NO_TRACE_BONUS;
        hud.setScore(score);
        hud.showToast(`${contract === 'records' ? 'UPLINK' : 'ALARM LINK'} RESTORED · NO TRACE · +${NO_TRACE_BONUS}`, 'good');
        return;
      }
      for (const w of allWorkstations) if (!w.captured) w.room.setState('idle');
      hud.showToast(contract === 'records' ? 'UPLINK DOWN · NOTHING YOU OPEN LEAVES THE BUILDING' : 'ALARM LINK DOWN · NOBODY CAN CALL IT IN', 'good');
      return;
    }
    if (task.kind === 'cutLine') {
      // Cut at the roof: the uplink is down for good (no bringing it back for a clean exit).
      task.station.cut = true;
      task.station.setCut(true);
      sound.play('hackDone', at);
      if (jobUplink) {
        jobUplink.online = false;
        jobUplink.restored = true;
        jobUplink.room.setState('active');
      }
      for (const w of allWorkstations) if (!w.captured) w.room.setState('idle');
      hud.showToast(contract === 'records' ? 'UPLINK LINE CUT AT THE ROOF · NOTHING YOU OPEN LEAVES THE BUILDING' : 'ALARM LINE CUT AT THE ROOF · NOBODY CAN CALL IT IN', 'good');
      return;
    }
    if (task.kind === 'wipe') {
      task.station.pending = 0;
      task.station.room.setState('active');
      logsWiped++;
      sound.play('hackDone', at);
      const left = allWorkstations.some((w) => !w.captured);
      const upDown = jobUplink && !jobUplink.online;
      hud.showToast(`ACCESS LOGS WIPED${!left && upDown ? ' · BRING THE UPLINK BACK TO LEAVE NO TRACE' : ''}`, 'good');
      return;
    }
    if (task.kind === 'crate') {
      task.station.done = true;
      sound.play('hackDone', at);
      if (task.station.container.id !== dossierContainer()?.id) {
        // A wrong guess is cheap and visible: nothing in it (most), or a tripwire that tells this storey's guards where you are.
        const out = crateOutcome(runSeed, task.station.container.id);
        hud.showToast(out.text, 'bad', 3200);
        if (out.kind === 'alarm') callSquadTo(task.station.level);
        return;
      }
      dossier.found = true;
      bunkerRun = { ...(bunkerRun ?? newRun(runSeed)), found: true };
      keepRun(runStore, bunkerRun);
      dossierMark?.setState('opened');
      showBunkerCounter();
      lastBunkerProgress = stats.seconds;
      if (LOCKDOWN) {
        // Taking it sets the squad on you: the storey's guards come to where you stand, and the lift is the only way out.
        callSquadTo(task.station.level);
        later(() => hud.showToast('LOCKDOWN · THE SQUAD IS COMING · THE LIFT IS OPEN, GO', 'bad', 4200), 2600);
      }
      exitLift.setState('ready');
      setLiftOpen(exitLift, true);
      sound.play('ding', { x: exitLift.front.x, y: 2.5, z: exitLift.front.z });
      hud.showToast(`DOSSIER FOUND · ${addressOf(bunkerRun).name.toUpperCase()}`, 'good', 4200);
      later(() => {
        if (cleared || caught || readerOpen || !bunkerRun) return;
        readerOpen = true;
        hud.showReader({ ...dossierPage(bunkerRun, campaignOp?.consignee), count: 'Dossier', note: dossierPage(bunkerRun, campaignOp?.consignee).note }, () => (readerOpen = false));
      }, 900);
      return;
    }
    if (task.kind === 'clue') {
      task.station.done = true;
      task.station.rig.setState('done');
      const stops = huntPlan()?.stops ?? [];
      task.station.rig.setScreen(clueScreen(task.station.level, stops.length ? stops[stops.length - 1]! : task.station.level, huntSite ?? 'bunker', coreLook));
      lastBunkerProgress = stats.seconds;
      clueScreenPct = -1;
      sound.play('hackDone', at);
      hud.showToast('TERMINAL HACKED · ACCESS GRANTED', 'good', 3600);
      showBunkerCounter();
      return;
    }
    const w = task.station;
    if (w.step) {
      finishStep(w, floor);
      return;
    }
    w.captured = true;
    w.room.setState('active');
    sound.play('shutter', at);
    hud.pdaCapture(w.files);
    collectDocument(w.files);
    if (burned) return;
    const uplink = jobUplink;
    const logServer = jobLogServer;
    if (uplink?.online) {
      burn('THE UPLINK WAS UP · THE FILES WENT STRAIGHT OUT');
      return;
    }
    if (!logServer) return;
    logServer.deadline = logDeadline(stats.seconds, diff.logWindowS);
    logServer.pending += w.files;
    logServer.room.setState('ready');
    hud.showToast('ACCESS LOGGED · WIPE THE LOGS BEFORE THE BATCH GOES OUT', 'neutral', 4200);
  }

  /** What was read got out: the alarm goes up, and the debrief marks the run burned. */
  function burn(reason: string): void {
    if (burned) return;
    burned = true;
    if (jobLogServer && jobLogServer.pending > 0) {
      jobLogServer.pending = 0;
      jobLogServer.room.setState('idle');
    }
    if (activeTask?.kind === 'wipe') {
      activeTask = null;
      hud.setHack(null);
    }
    suspicion = Math.max(suspicion, ALARM_ON);
    hud.setSuspicion(suspicion);
    hud.showToast(`${reason} · YOU'RE BURNED`, 'bad', 4200);
    // Burned isn't over: say what's left to do.
    window.setTimeout(() => {
      if (signal.aborted || cleared || caught) return;
      const left = totalFragments - documentsCollected;
      hud.showToast(
        left > 0 ? `THE JOB ISN'T OVER · ${left} MORE FILE${left === 1 ? '' : 'S'}, THEN THE ${EXIT.name}` : `THE JOB ISN'T OVER · GET TO THE ${EXIT.name}`,
        'neutral',
        4200
      );
    }, 2200);
  }

  /** The log batch goes out when its timer runs down. Every frame. */
  function tickLogs(): void {
    // (In training the batch waits: the lesson is wiping it, not the clock.)
    if (!training && jobLogServer && jobLogServer.pending > 0 && stats.seconds >= jobLogServer.deadline) burn('THE ACCESS LOGS WENT OUT');
    updatePda();
  }

  /** Workstations stay locked while the uplink is online: nothing can be captured until it's down (or its line is cut at the roof). */
  function captureLocked(): boolean {
    return locksFor(jobUplink !== null && jobUplink.online, 0).capture;
  }

  /** The log console stays locked until every file is photographed: a wipe done early would only be undone by the next capture. */
  function wipeLocked(): boolean {
    return locksFor(false, allWorkstations.filter((w) => !w.captured).length).wipe;
  }

  // ---- the guide: an arrow on the floor, and a line on the PDA, toward the next objective ----

  const guideArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(
      new THREE.Shape([new THREE.Vector2(0, -0.6), new THREE.Vector2(0.44, 0.16), new THREE.Vector2(0.18, 0.16), new THREE.Vector2(0, -0.2), new THREE.Vector2(-0.18, 0.16), new THREE.Vector2(-0.44, 0.16)])
    ).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  guideArrow.visible = false;
  guideArrow.frustumCulled = false;
  root.scene.add(guideArrow);
  let guideTimer = 0;
  let guideField: { base: string; key: string; dist: number[][]; cells: MazeCells;
  } | null = null;
  let guideHeading: { to: { x: number; y: number }; left: number } | null = null;
  let guideFloor = 0;

  /** The cell a station stands in, on its floor. */
  const cellOf = (x: number, z: number): { x: number; y: number } => ({ x: Math.round(x / CELL), y: Math.round(z / CELL) });

  /** Steps from the player's cell to each of `cells` over the corridors (doors as they stand), or a large number when there's no way. */
  function costs(content: FloorContent, from: { x: number; y: number }): (c: { x: number; y: number }) => number {
    const dist = bfs(content.navCells, content.cols, content.rows, from.x, from.y);
    const raw = bfs(content.cells, content.cols, content.rows, from.x, from.y);
    return (c) => {
      const d = dist[c.y]?.[c.x] ?? -1;
      return d >= 0 ? d : (raw[c.y]?.[c.x] ?? -1) >= 0 ? 200 + raw[c.y]![c.x]! : 900;
    };
  }

  /** What the hunt is on this level: the stops of the clue chain (the bunker's: a storey each; the yard's: three consoles on one floor), where each is, the dossier's container, and the way out. */
  type HuntPlan = {
    stops: number[];
    stop: (i: number) => { level: number; x: number; y: number } | null;
    dossier: { floor: number; id: string; cx: number; cz: number; yaw: number; len: number; depth: number; height: number; door: { x: number; y: number } } | null;
    exit: { level: number; x: number; y: number };
  };
  function huntPlan(): HuntPlan | null {
    if (yardRun) {
      const c = yardOpen[yardDossierIndex(runSeed, yardOpen.length)];
      return {
        stops: yardPlan.clues.map((_, i) => i),
        stop: (i) => (yardPlan.clues[i] ? { level: 0, x: yardPlan.clues[i]!.x, y: yardPlan.clues[i]!.y } : null),
        dossier: c ? { floor: 0, id: c.id, cx: c.cx, cz: c.cz, yaw: c.yaw, len: c.len, depth: c.depth, height: c.height, door: { x: Math.round(c.station.x / CELL), y: Math.round(c.station.z / CELL) } } : null,
        exit: { level: 0, x: exitX, y: exitY },
      };
    }
    if (!bunker) return null;
    // (The Annex keeps its dossier in the registry's vault, on the top storey: the lower storeys' containers are only decoys.)
    const plan = dossierPlan(runSeed, bunkerOpen.map((c, i) => (stackSite && i < BUNKER_LEVELS - 1 ? 0 : c.length)));
    const c = plan ? bunkerOpen[plan.level]?.[plan.container] : undefined;
    return {
      stops: plan ? clueLevels(plan.level) : [],
      stop: (l) => clueOn(l),
      dossier: plan && c ? { floor: plan.level, id: c.id, cx: c.cx, cz: c.cz, yaw: c.yaw, len: KINDS.cargo.len, depth: KINDS.cargo.depth, height: KINDS.cargo.height, door: c.door } : null,
      // (the arrow ends at the cell in front of the lift's door, not in its cab: the cab's other walls would be walked into)
      exit: { level: BUNKER_EXIT_LEVEL, x: BUNKER_EXIT.x + DIR_DELTA[exitOpens][0], y: BUNKER_EXIT.y + DIR_DELTA[exitOpens][1] },
    };
  }

  /** The container the run's dossier is in. */
  function dossierContainer(): { id: string } | undefined {
    return huntPlan()?.dossier ?? undefined;
  }

  /** Every guard still up on the storey goes to where the agent is (a tripwire, or the lockdown after the dossier). */
  function callSquadTo(storey: number): void {
    const content = storeys[storey]?.content;
    if (!content) return;
    for (const e of content.enemies) if (e instanceof Bot && !e.disabled) e.investigate(player.worldX, player.worldZ, 8, content.navCells, content.cols, content.rows, 999);
  }

  /** Five minutes with no progress in the bunker: Control says where the next terminal (or the dossier) is. */
  function bunkerHintTick(): void {
    if (!hunt || dossier.found || stats.seconds - lastBunkerProgress < BUNKER_HINT_S) return;
    lastBunkerProgress = stats.seconds;
    const hp = huntPlan();
    const next = (hp?.stops ?? []).find((l) => !clueSystems.some((c) => c.level === l && c.done));
    const where = next === undefined ? null : yardRun ? (yardPlan.clues[next]?.name ?? null) : `${bunkerSpace(clueOn(next)!.space).name}, ${BUNKER_LEVEL_NAMES[next]!}`;
    hud.showToast(where ? `Control: THERE IS A TERMINAL IN THE ${where.toUpperCase()}` : hp?.dossier ? (yardRun ? 'Control: THE MARKED CONTAINER IS IN THE YARD' : `Control: THE MARKED CONTAINER IS ON ${BUNKER_LEVEL_NAMES[hp.dossier.floor]!.toUpperCase()}`) : 'Control: KEEP MOVING', 'neutral', 6000);
  }

  /** Where the bunker's arrow points: the next terminal, the dossier's container, or the way out (guide.ts's pickBunkerGoal); null before the first terminal is hacked. */
  function bunkerGoalNow(): Goal | null {
    const hp = huntPlan();
    return pickBunkerGoal(
      { needed: hp?.stops ?? [], hacked: new Set(clueSystems.filter((c) => c.done).map((c) => c.level)), found: dossier.found },
      { clue: (l) => hp?.stop(l) ?? null, dossier: hp?.dossier ? { level: hp.dossier.floor, x: hp.dossier.door.x, y: hp.dossier.door.y } : null, exit: hp?.exit ?? { level: 0, x: exitX, y: exitY } }
    );
  }

  /** The cell on storey `from` to head for to take the stairs one storey up (the foot of the flight) or down (the head of the flight that comes up here). */
  function bunkerStairCell(from: number, up: boolean): { x: number; y: number } | null {
    const st = BUNKER_STAIRS.find((s) => (up ? s.low === from : s.high === from));
    return st ? (up ? stairEnds(st).foot[0] : stairEnds(st).head[0]) ?? null : null;
  }

  /** Works out the next objective and the way to it, a few times a second; draws the arrow every frame. */
  function tickGuide(): void {
    // Off in training, except at the station that teaches it.
    const guideAllowed = !training || hunt || stations[station]?.guide === true; // (the bunker's objective is the guide's: the arrow after each hack)
    const showing = guideOn && guideAllowed && !paused() && !aloft && !hiddenIn && !ventTransit && !cleared && !caught && !carried;
    if (!guideOn || !guideAllowed) {
      hud.setGuide(null);
      guideArrow.visible = false;
      return;
    }
    if (stats.seconds >= guideTimer) {
      guideTimer = stats.seconds + 0.3;
      const active = currentFloor();
      const idx = activeFloorIdx;
      const o = active.rig.group.position;
      const here = cellOf(player.worldX - o.x, player.worldZ - o.z);
      const goals: Goal[] = [];
      storeys.forEach(({ content }, fi) => {
        const cost = fi === idx ? costs(content, here) : (): number => 1000;
        const add = (kind: Goal['kind'], x: number, z: number): void => {
          const c = cellOf(x, z);
          goals.push({ kind, floor: fi, x: c.x, y: c.y, cost: cost(c) });
        };
        if (content.uplink) add('uplink', content.uplink.x, content.uplink.z);
        // A records job points at every records room still to photograph; a contract at the next step only (and the guard carrying the card).
        const aimed = objective ? nextStep(objective, doneSteps) : null;
        for (const w of content.workstations) {
          if (w.captured) continue;
          if (w.step && w.step.step.id !== aimed?.id) continue;
          add('files', w.x, w.z);
        }
        if (fi === 0 && carrierBot && !doneSteps.has('keycard') && aimed?.kind === 'keycard') add('files', carrierBot.worldX - floor0.group.position.x, carrierBot.worldZ - floor0.group.position.z);
        if (content.logServer && content.logServer.pending > 0) add('logs', content.logServer.x, content.logServer.z);
      });
      goals.push({ kind: 'exit', floor: 0, x: exitX, y: exitY, cost: idx === 0 ? costs(floor0Content, here)({ x: exitX, y: exitY }) : 1000 });
      const filesLeft = objective ? totalFragments - documentsCollected : allWorkstations.filter((w) => !w.captured).length;
      const goal = hunt ? bunkerGoalNow() : pickGoal(goals, { uplinkOnline: jobUplink?.online === true, filesLeft: Math.max(filesLeft, totalFragments > documentsCollected ? 1 : 0), logsPending: (jobLogServer?.pending ?? 0) > 0 });
      guideHeading = null;
      if (!goal) {
        hud.setGuide({ label: hunt ? 'Find a system that knows where the dossier is' : 'Nothing left to do', steps: null });
      } else {
        // On the wrong floor, the way to the stairs first (the bunker's: the foot of the flight up, or the head of the flight down).
        const rawTarget = bunker && goal.floor !== idx ? bunkerStairCell(idx, goal.floor > idx) : goal.floor === idx ? { x: goal.x, y: goal.y } : idx === 0 ? (stair ? { x: stair.x, y: stair.y } : null) : { x: 0, y: 0 };
        const rawLabel =
          goal.floor === idx ? (goal.kind === 'files' && objective ? (nextStep(objective, doneSteps)?.name ?? 'Objective') : goal.kind === 'uplink' && contract !== 'records' ? 'Take down the alarm link' : GOAL_LABEL[goal.kind]) : goal.floor > idx ? 'Stairs up' : 'Stairs down';
        if (rawTarget) {
          const resolved = resolveGoalTarget({
            bfs,
            navCells: active.content.navCells,
            cells: active.content.cells,
            cols: active.content.cols,
            rows: active.content.rows,
            from: here,
            target: rawTarget,
            defaultLabel: rawLabel,
            doors: active.content.doors.map((d) => ({
              id: d.door.id,
              x: d.door.x,
              y: d.door.y,
              dir: d.door.dir,
              isOpen: d.isOpen(),
            })),
            terminals: active.content.terminals.map((t) => {
              const c = cellOf(t.x, t.z);
              return { keyId: t.keyId, x: c.x, y: c.y, hacked: t.hacked };
            }),
            servers: active.content.servers.map((s) => {
              const c = cellOf(s.x, s.z);
              return { keyId: s.keyId, x: c.x, y: c.y, online: s.online };
            }),
            keyLabel,
          });
          const target = resolved.target;
          const label = resolved.label;
          const key = `${idx}:${target.x},${target.y}:${navVersion}`;
          if (guideField?.base !== key) {
            const open = bfs(active.content.navCells, active.content.cols, active.content.rows, target.x, target.y);
            const useRaw = (open[here.y]?.[here.x] ?? -1) < 0;
            const cellsUsed = useRaw ? active.content.cells : active.content.navCells;
            guideField = {
              base: key,
              key: `${key}:${useRaw ? 'raw' : 'nav'}`,
              dist: useRaw ? bfs(active.content.cells, active.content.cols, active.content.rows, target.x, target.y) : open,
              cells: cellsUsed,
            };
          }
          guideHeading = stepToward(guideField.dist, guideField.cells, here, 3);
          guideFloor = idx;
          hud.setGuide({ label, steps: guideHeading?.left ?? null, locked: resolved.locked || guideField.key.endsWith('raw') });
        } else hud.setGuide({ label: rawLabel, steps: null });
      }
    }
    // The arrow: just ahead of the agent's feet, along the corridors toward where the next few cells lead.
    const h = guideHeading;
    if (!showing || !h || h.left <= 1 || guideFloor !== activeFloorIdx) {
      guideArrow.visible = false;
      return;
    }
    const o = currentFloor().rig.group.position;
    const dx = h.to.x * CELL + o.x - player.worldX;
    const dz = h.to.y * CELL + o.z - player.worldZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.4) {
      guideArrow.visible = false;
      return;
    }
    const pulse = 1 + 0.1 * Math.sin(clock.elapsedTime * 4);
    guideArrow.position.set(player.worldX + (dx / len) * 1.9, o.y + 0.07, player.worldZ + (dz / len) * 1.9);
    guideArrow.rotation.y = Math.atan2(dx, dz);
    guideArrow.scale.setScalar(pulse);
    guideArrow.visible = true;
  }

  function toggleGuide(): void {
    setGuideOn(!guideOn);
    guideTimer = 0;
    hud.showToast(guideOn ? 'GUIDE ON · AN ARROW ON THE FLOOR POINTS THE WAY TO YOUR NEXT OBJECTIVE' : 'GUIDE OFF', 'neutral', 3200);
  }

  function updatePda(): void {
    const pending = jobLogServer !== null && jobLogServer.pending > 0;
    hud.setPda({
      uplink: jobUplink ? (jobUplink.online ? 'online' : 'offline') : 'none',
      files: documentsCollected,
      totalFiles: totalFragments,
      logs: burned ? 'burned' : pending ? 'pending' : logsWiped > 0 ? 'wiped' : 'none',
      secondsLeft: pending ? Math.max(0, jobLogServer.deadline - stats.seconds) : 0,
      logsLocked: pending && wipeLocked(),
    });
  }

  /** The community's progress on the report: who's played here and how far they've got. */
  async function showCommunity(): Promise<void> {
    hud.setReportCommunity((await fetchBoards())?.community ?? null);
  }

  /** Saves the run, then fills the report card's leaderboard (the save response carries it; logged-out players fetch it). */
  function reportRun(jobCleared: number | null, heist?: { points: number; grade: Grade }, run?: { outcome: RunOutcome; contract: ContractId; pages: number }): void {
    void saveRun({ jobCleared, score, ...(heist ? { heist } : {}), ...(run ? { run } : {}) }).then(async (res) => {
      if (res?.case) hud.setReportCase(caseMeterView(res.case));
      if (res?.community) hud.setReportCommunity(res.community);
      else void showCommunity();
      if (res?.newBestJob) hud.showToast(`NEW PERSONAL BEST · JOB ${res.best.bestJob} CLEARED`, 'good');
      else if (res?.newBestScore) hud.showToast(`NEW PERSONAL BEST · SCORE ${res.best.bestScore}`, 'good');
      const board = res?.leaderboard ?? (await fetchLeaderboard());
      let note = '';
      if (board && board.top.length === 0) note = 'No one on the board yet. Clear a job to be first.';
      else if (board && !res) note = 'Log in to Reddit to get on the leaderboard.';
      else if (board?.you && res?.newBestHeist) note = `New personal best: you're #${board.you.rank} on the board.`;
      else if (board?.you) note = `Your best: #${board.you.rank} · ${board.you.points} pts`;
      hud.setReportLeaderboard(board, note); // no board at all (offline): the section hides
    });
  }

  function jobStats(clearedJob: boolean): JobStats {
    return {
      level,
      cleared: clearedJob,
      ...stats,
      cells: cols * rows + upperCells,
      documents: documentsCollected,
      totalDocuments: totalFragments,
      ...(contract === 'records' ? {} : { unitLabel: CONTRACTS[contract].report }),
      logs: burned ? 'burned' : logsWiped > 0 ? 'wiped' : 'none',
      score,
    };
  }

  /** The end of a daily run, cleared or caught: its own report, the scored result sent in, and today's board. */
  function showDailyReport(run: DailyRun, cleared: boolean, title: string, reason: string): void {
    const s = jobStats(cleared);
    const grade = cleared ? gradeFor(stealthRating(s)) : null;
    const side = cleared ? sideResult() : { bonus: 0, row: null };
    const points = grade ? heistPoints(level, grade, score, stats.takedowns) + side.bonus : 0;
    // What the night did to the case, and what tomorrow carries in (only a scored run counts, as only it is kept).
    const mo = missionOutcome(cleared);
    const outcome = runOutcomeOf(mo);
    const fall = falloutFor(mo, pagesWhat(), describeCarry(carryOver(outcome, run.week, contract)));
    const result: DailyResult = {
      day: run.day,
      cleared,
      points,
      grade,
      seconds: Math.max(1, Math.round(stats.seconds)),
      documents: documentsCollected,
      totalDocuments: Math.max(1, totalFragments),
      spotted: stats.timesSpotted,
      takedowns: stats.takedowns,
      burned,
      alarms: stats.alarms,
      contract,
      pages: fall.pages,
    };
    // The scored run gets Control's debrief over the report: how it went, the parameters marked, and tomorrow's target.
    if (run.scored) {
      const letter = debrief(
        tonight(run.day),
        tonight(nextDay(run.day)),
        { cleared, documents: documentsCollected, totalDocuments: Math.max(1, totalFragments), alarms: stats.alarms, burned },
        agent,
        username,
        run.week,
        fragmentFor(tonight(run.day).chapter?.number ?? 1),
        contract,
        sideGoal ? { name: SIDE_GOALS[sideGoal].name, kept: side.bonus > 0, bonus: SIDE_BONUS } : null
      );
      // Control says what to expect tomorrow, as the report card lists it.
      if (fall.expect.length) letter.paragraphs.push(`What carries into tomorrow: ${fall.expect.map((e) => e.text.toLowerCase()).join('; ')}.`);
      window.setTimeout(() => {
        hud.showDossier(letter, { label: 'Read the full report', onClick: () => {} });
        hud.setDossierCase('Sending your report to Control…');
      }, 0);
    }
    hud.showReport({
      kicker: `Daily Heist #${run.number} · Job ${level} · ${run.scored ? 'Scored run' : 'Practice'}`,
      title,
      note: reason,
      grade,
      rows: [...reportRows(s), ...(side.row ? [side.row] : [])],
      points: grade ? `+${points} heist points` : null,
      fallout: run.scored
        ? { title: 'The case', lines: fall.consequences, nextTitle: 'Carried into tomorrow', next: fall.expect }
        : { title: 'The case', lines: [{ tone: 'neutral', text: 'Practice run: nothing goes in the case, and nothing carries over' }], nextTitle: 'Carried into tomorrow', next: [] },
      boardTitle: `Daily #${run.number} · today`,
      feel: feelPrompt(),
      ...(run.scored ? { share: shareLine(result) } : {}),
      continueLabel: `Back to job ${ladderJob}`,
      onContinue: () => {
        controller.abort();
        startJob(ladderJob);
      },
      // Replaying reads Control's message again first, as practice.
      secondary: {
        label: 'Replay for practice',
        onClick: () => {
          const letter = today?.day === run.day ? dailyBriefing({ ...today, status: 'done' }) : null;
          const replay = (): void => {
            controller.abort();
            startJob(level, null, { ...run, scored: false }, lastEntry);
          };
          if (!letter) {
            replay();
            return;
          }
          hud.showDossier(letter, { label: PLAY_LABEL[letter.mode], onClick: replay }, {
            label: `Back to job ${ladderJob}`,
            onClick: () => {
              controller.abort();
              startJob(ladderJob);
            },
          });
        },
      },
    });
    if (run.scored) {
      void submitDaily(result).then((res) => {
        if (!res) {
          hud.setReportLeaderboard(null, 'Could not send today’s run. Check your connection.');
          hud.setDossierCase('Your report didn’t get through to Control. Check your connection.');
          return;
        }
        hud.setDossierCase(
          `${res.caseEvidence} document${res.caseEvidence === 1 ? '' : 's'} recovered by agents here. Your record: ${res.missions} mission${res.missions === 1 ? '' : 's'} completed.`
        );
        hud.setReportCase(caseMeterView(res.case));
        if (today?.day === run.day) today = { ...today, status: 'done', result, board: res.board, case: res.case, lastNight: outcome, lastContract: contract };
        const b = res.board;
        const note = cleared && b.you ? `You're #${b.you.rank} of ${b.players} today.` : `Caught, so not on today's board. ${b.players} played.`;
        hud.setReportLeaderboard(dailyBoardView(b, level), note);
        void showCommunity();
      });
    } else {
      void fetchDaily().then((d) => {
        if (d) today = d;
        hud.setReportLeaderboard(d ? dailyBoardView(d.board, level) : null, d ? 'Practice run: not scored.' : '');
        void showCommunity();
      });
    }
  }

  /** The report's "how did that job feel?" buttons (scored dailies and the ladder; practice runs aren't counted). */
  const feelPrompt = (): ((f: Feel) => void) | undefined =>
    dailyRun && !dailyRun.scored ? undefined : (feel) => reportTry({ kind: 'feel', job: level, daily: dailyRun !== null, feel });

  /** Whether this is the maze the run is at (held in the dossier's place, from a tower's heist door): its end is the exit level. */
  const inRunMaze = !tower && !training && !dailyRun && !!options.mazePlace && heldIn === options.mazePlace;

  /** The run's maze is done: a short card, and the way out is the way they came, the same building from the top, with the alarm up. */
  function showMazeDone(): void {
    hud.setCoach(null);
    const s = jobStats(true);
    hud.showReport({
      kicker: `${place.name} · Files out`,
      title: 'The way out',
      note: 'The files are out. The building knows now: the way out is the way you came, from the top, with everything awake.',
      grade: null,
      stamp: { text: 'Out', label: 'Next' },
      rows: reportRows(s),
      points: null,
      continueLabel: 'Go back down',
      onContinue: () => {
        if (savedRun?.stage === 'maze') {
          noteStat(runStore, 'maze', { seconds: s.seconds, hits: s.timesSpotted + s.timesHit });
          keepRun(runStore, advanceRun(savedRun));
        }
        controller.abort();
        // A campaign operation: the case item goes up to H., and then the descent into the exit level.
        // The way out: the tower of the place, or, for the operations whose first level is the way out played backwards, that level.
        const out = loadRun(runStore);
        const goOut = (): void => {
          if (!reverseExit(out)) startJob(level, 'tower');
          else if (isYardSite(out!.site)) reloadAt('?job=dock');
          else startJob(1, 'bunker');
        };
        if (campaignOp && CUTSCENES && savedRun?.stage === 'maze') void playInterlude(uploadScene(campaignOp)).then(() => playInterlude(descentScene(campaignOp))).then(goOut);
        else goOut();
      },
    });
  }

  function showClearedReport(): void {
    if (dailyRun) {
      if (dailyRun.scored) reportTry({ kind: 'try', job: level, daily: true, cleared: true });
      showDailyReport(dailyRun, true, 'Job cleared', stats.timesSpotted + stats.timesHit === 0 ? 'In and out without a single alarm.' : 'The documents are out. The guards will remember you.');
      return;
    }
    // A maze the run is at ends in the way out, not in the ladder's report (and is not a job cleared on the ladder: nothing is remembered, carried or scored).
    if (inRunMaze) {
      showMazeDone();
      return;
    }
    rememberCleared(level);
    noteJobResult(level, true);
    reportTry({ kind: 'try', job: level, daily: false, cleared: true });
    const s = jobStats(true);
    const grade = gradeFor(stealthRating(s));
    const side = sideResult();
    const points = heistPoints(level, grade, score, stats.takedowns) + side.bonus;
    // What it did to the case, and what the next job carries in: the last job cleared is the one that carries.
    const mo = missionOutcome(true);
    const outcome = runOutcomeOf(mo);
    const fall = falloutFor(mo, pagesWhat(), describeCarry(ladderCarry(outcome, contract)));
    ladderLast = { outcome: outcome as LastRun['outcome'], contract };
    hud.showReport({
      kicker: `Job ${level} · After-action report`,
      title: 'Job cleared',
      note: s.timesSpotted + s.timesHit === 0 ? 'In and out without a single alarm.' : 'The documents are out. The guards will remember you.',
      grade,
      rows: [...reportRows(s), ...(side.row ? [side.row] : [])],
      points: `+${points} heist points`,
      fallout: { title: 'The case', lines: fall.consequences, nextTitle: `Carried into job ${level + 1}`, next: fall.expect },
      feel: feelPrompt(),
      continueLabel: level === ARC_JOBS && !ending ? 'Make your choice' : `Start job ${level + 1}`,
      onContinue: () => {
        // The final level is the end of the story: the files are out, and the choice is the agents'.
        if (level === ARC_JOBS && !ending) {
          const who = { greeting: `${salutation(agent, username)},` };
          const finish = (choice: Ending): void => {
            chooseEnding(choice);
            // The job is over: its scene comes down, the ending plays on the canvas, and then Control writes the last letter.
            controller.abort();
            void playCinematic({ ending: choice, canvas, agent, look, style, documents: documentsCollected }).then((skipped) => {
              reportTry({ kind: 'story', what: 'ending', ending: choice, skipped });
              hud.showDossier(endingLetter(choice, who), {
                label: `Start job ${level + 1}`,
                onClick: () => briefThenStart(level + 1),
              });
            });
          };
          hud.showDossier(choiceLetter(who), { label: 'Make it public', onClick: () => finish('public') }, { label: 'Keep it private', onClick: () => finish('private') });
          return;
        }
        controller.abort();
        briefThenStart(level + 1);
      },
    });
    reportRun(level, { points, grade }, { outcome: fall.outcome, contract, pages: fall.pages });
  }

  // ---- the grace after a checkpoint resume ----
  // Picked up at a checkpoint, the agent has a moment before the next catch can count: the guards have only just dropped what they were doing.

  const RESUME_GRACE_S = 6;
  let graceUntil = -Infinity;

  /** Whether a catch right now is called off, in the moment after a checkpoint resume. */
  function inResumeGrace(): boolean {
    return stats.seconds < graceUntil;
  }

  // ---- checkpoints ----
  // Each goal reached (a file captured, the uplink or the logs done, a terminal hacked, a contract step, the other floor) is a checkpoint: where the agent stood. Caught, the job can be
  // picked up there instead of being lost: everything done stays done (files, the uplink, the terminals), the guards drop what they were doing and the alarm goes down, and it costs
  // points and counts as being spotted. Nothing is kept past the job: leave it and the next try begins at the way in. Not in training, and not in the scored Daily.
  const CHECKPOINT_PENALTY = 100;
  const checkpointsOn = !training && !dailyRun?.scored;
  let checkpoint: { x: number; z: number; y: number; angle: number; label: string } | null = null;
  let checkpointsUsed = 0;
  let declinedResume = false;

  /** A goal is reached: here is where the next try starts from. */
  function markGoal(label: string): void {
    if (!checkpointsOn || caught || cleared || aloft || hiddenIn || ventTransit) return;
    checkpoint = { x: player.worldX, z: player.worldZ, y: player.worldY, angle: player.facingAngle, label };
    hud.showToast(`CHECKPOINT · ${label}`, 'good', 2600);
  }

  /** Caught with a checkpoint to go back to: the game waits while Control's message offers it. */
  function offerResume(title: string, reason: string): void {
    resumeOffer = true;
    hud.setHack(null);
    hud.showDossier(
      {
        kicker: `Encrypted message · ${title}`,
        greeting: `They had you, ${salutation(agent, username)}.`,
        paragraphs: [reason, 'But you got this far. I can put you back at your last checkpoint: the files you took are still yours, what you switched off is still off, and the guards go back to what they were doing.'],
        parameters: [{ text: `Your last checkpoint: ${checkpoint!.label.toLowerCase()}.` }, { text: `It counts as being spotted, and costs ${CHECKPOINT_PENALTY} points.` }],
        closing: 'Or give the job up: the next try starts at the way in.',
      },
      { label: 'Resume from checkpoint', onClick: resumeAtCheckpoint },
      {
        label: 'Give up the job',
        onClick: () => {
          resumeOffer = false;
          declinedResume = true;
          triggerCaught(title, reason);
        },
      }
    );
  }

  /** Back at the checkpoint, calm, with a few seconds' grace. */
  function resumeAtCheckpoint(): void {
    const cp = checkpoint;
    resumeOffer = false;
    if (!cp) return;
    leaveCover();
    if (aiming) setAiming(false);
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    player.place(cp.x, cp.z, cp.angle, cp.y);
    suspicion = 0;
    hud.setSuspicion(suspicion);
    // First, whatever was after the agent and is near the checkpoint is taken away from it (before calming, which would hide which ones had them).
    const moved = moveHuntersAway(cp);
    for (const content of floorContents()) {
      for (const e of content.enemies) {
        e.calm?.();
        // The hunters the alarm sent are called off (they stood down with it).
        if (e instanceof Bot && e.kind === 'hunter' && !e.disabled) {
          e.disabled = true;
          e.mesh.visible = false;
        }
      }
    }
    chasing.clear();
    camo = FULL_CAMO;
    stats.timesSpotted++;
    checkpointsUsed++;
    score = Math.max(0, score - CHECKPOINT_PENALTY);
    hud.setScore(score);
    graceUntil = stats.seconds + RESUME_GRACE_S;
    player.revive(); // (down, if that was what caught them)
    if (partner) {
      const f = cp.angle;
      partner.place(cp.x - Math.sin(f) * 1.6, cp.z - Math.cos(f) * 1.6, f, cp.y);
      partnerTrail.clear();
    }
    player.shake(0.5);
    hud.pulseDanger();
    sound.play('alert');
    hud.showToast(`BACK AT THE CHECKPOINT · ${cp.label} · -${CHECKPOINT_PENALTY} POINTS${moved > 0 ? ` · ${moved} GUARD${moved === 1 ? '' : 'S'} AND DOG${moved === 1 ? '' : 'S'} SENT ELSEWHERE` : ''}`, 'neutral', 4800);
  }

  const RESUME_CLEAR_M = 10; // anything this close to the checkpoint, or after the agent, is taken away from it
  const RESUME_ALERT_M = 20; // (or, if they were after the agent, this close)
  const RESUME_FAR_CELLS = [6, 12] as const; // and put this many cells' walk away

  /** Whatever had the agent (the dog that got them, the guards near) is not standing at the checkpoint: it is put a good walk away, back on its rounds. Returns how many were moved. */
  function moveHuntersAway(cp: { x: number; z: number; y: number }): number {
    const pair = storeys.find((f) => Math.abs(f.rig.group.position.y - cp.y) < 2);
    if (!pair) return 0;
    const { rig, content } = pair;
    const o = rig.group.position;
    const cx = Math.round((cp.x - o.x) / CELL);
    const cy = Math.round((cp.z - o.z) / CELL);
    const dist = bfs(content.navCells, content.cols, content.rows, cx, cy);
    const spots: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < content.rows; y++) for (let x = 0; x < content.cols; x++) if (dist[y]![x]! >= RESUME_FAR_CELLS[0] && dist[y]![x]! <= RESUME_FAR_CELLS[1] && content.section[y]![x] === -1) spots.push({ x, y });
    if (spots.length === 0) return 0;
    let n = 0;
    for (const e of content.enemies) {
      if (e.disabled || !e.relocate) continue;
      if (e instanceof Bot && e.isSentry) continue;
      const d = Math.hypot(e.worldX - cp.x, e.worldZ - cp.z);
      if (d > RESUME_CLEAR_M && !(e.alert && d <= RESUME_ALERT_M)) continue;
      const s = spots.splice(Math.floor(Math.random() * spots.length), 1)[0];
      if (!s) break;
      e.relocate(o.x + s.x * CELL, o.z + s.y * CELL, content.navCells, content.cols, content.rows);
      n++;
    }
    return n;
  }

  /** The catches that are the agent going down (shot, blown up), not a guard's eye on them: the agent falls. */
  const FALLS = new Set(['Hit by enemy fire', 'Blown up by an alpha', 'Caught in the blast']);

  function triggerCaught(title: string, reason: string, from?: { x: number; z: number }): void {
    if (caught || resumeOffer) return;
    // Going down: the death fall, away from where the blow came from (even if a checkpoint is offered, the agent lies there until they take it, and in a level that restarts at its station, until it does).
    const down = FALLS.has(title) && !aloft;
    if (training) {
      if (down) player.die(from);
      failStation(title);
      return;
    }
    if (inResumeGrace()) return;
    if (down) player.die(from);
    if (checkpoint && !declinedResume && title !== 'Job abandoned') {
      offerResume(title, reason);
      return;
    }
    caught = true;
    endFlashOffer();
    // Pulling out isn't a failed try: it neither counts against the job nor earns it help.
    if (title !== 'Job abandoned') {
      if (!dailyRun) noteJobResult(level, false);
      if (!dailyRun || dailyRun.scored) reportTry({ kind: 'try', job: level, daily: dailyRun !== null, cleared: false, cause: causeOf(title) });
    }
    hud.setHack(null);
    closeBlueprint();
    closeControls();
    flashCaughtLights(root);
    sound.play('caught');
    hud.showSpottedBanner(title);
    /** What comes after: the report (or the daily's), once the building has been taken over and the loop stopped. */
    const showResult = (): void => {
      controller.abort();
      if (dailyRun) {
        showDailyReport(dailyRun, false, title, reason);
        return;
      }
      hud.showReport({
        kicker: `Job ${level} · After-action report`,
        title,
        note: reason,
        grade: null,
        rows: reportRows(jobStats(false)),
        points: null,
        // Getting caught costs the pages, not the next try: a retry carries what the last cleared job left.
        fallout: {
          title: 'The case',
          lines: falloutFor(missionOutcome(false), pagesWhat(), []).consequences,
          nextTitle: ladderCarryNow(level).eased ? `Going easier on you: job ${level}, next try` : `Carried into job ${level}`,
          next: describeCarry(ladderCarryNow(level)),
        },
        feel: feelPrompt(),
        continueLabel: 'Choose your way in',
        onContinue: () => offerWayIn(level),
        secondary: { label: 'Main menu', onClick: () => hud.reopenMissionBrief() },
      });
      reportRun(null);
    };
    if (title === 'Job abandoned') {
      // Pulling out is the player's own choice: no takeover, straight to the report.
      controller.abort();
      window.setTimeout(showResult, 1400);
      return;
    }
    // The loop keeps running (so there is a building to take over) until the takeover ends or is skipped.
    takeover = new Takeover({
      root,
      player,
      cue: (name, volume) => sound.play(name as Parameters<typeof sound.play>[0], undefined, volume),
      floors: storeys.map((f) => f.rig),
      // A daily's building is the same for everyone, so it is laid again as it was; any other job gets a new floor plan.
      layout: dailyRun
        ? null
        : ((): ((cols: number, rows: number) => MazeCells) => {
            let n = 0;
            return (cols, rows) => {
              const cells = freshPlan(cols, rows, n++ % 2);
              pendingPlans.push({ cols, rows, cells });
              return cells;
            };
          })(),
      onDone: showResult,
    });
  }

  // ---- blueprint ----

  function roomSheet(built: BuiltRoom, content: FloorContent): SheetRoom {
    const { room } = built;
    let status: string | null = null;
    if (room.kind === 'terminal' && content.terminals.find((t) => t.room === built)?.hacked) status = 'HACKED';
    if (room.kind === 'server' && content.servers.find((sv) => sv.room === built)?.online) status = 'ONLINE';
    if (room.kind === 'uplink' && content.uplink) status = content.uplink.online ? 'ONLINE' : 'DOWN';
    if (room.kind === 'logs' && content.logServer) status = content.logServer.pending > 0 ? 'QUEUED' : logsWiped > 0 ? 'WIPED' : null;
    const ws = content.workstations.find((w) => w.room === built);
    if (ws?.captured) status = 'CAPTURED';
    const docsMarked = (markedRooms.has(built) || reconRooms.has(built)) && ws && !ws.captured ? ws.files : 0;
    return { kind: room.kind, x: room.x, y: room.y, cells: room.cells, keyId: room.keyId, status, docsMarked };
  }

  function sheetFor(floor: ActiveFloor, vision: VisionState, idx: number): BlueprintSheet {
    const { rig, content } = floor;
    return {
      cols: content.cols,
      rows: content.rows,
      cells: content.cells,
      explored: vision.explored,
      doors: content.doors.map((d) => ({ door: d.door, open: d.isOpen() })),
      rooms: content.rooms.map((b) => roomSheet(b, content)),
      ...(contract === 'records' ? {} : { alarmLink: true }),
      beacons: content.storage.filter((st) => markedRooms.has(st.built)).map((st) => ({ x: st.built.room.x, y: st.built.room.y, keyId: st.section })),
      crates: content.hidingSpots,
      lasers: [...content.laserCells, ...content.gates.map(({ gate }) => ({ x: gate.x, y: gate.y })), ...content.lines.map(({ laser }) => ({ x: laser.x, y: laser.y }))],
      hideouts: content.staffLockers.map((l) => l.cell),
      vents: content.vents.map((v) => ({ a: v.cells[0], b: v.cells[1] })),
      dark: content.dark.map((row, y) => row.map((d, x) => d || content.powerCut[y]![x]!)),
      breakers: content.fittings.filter((f) => f.kind === 'breaker').map((f) => ({ x: f.cell.x, y: f.cell.y, label: f.label, on: f.on })),
      packs: content.packs.filter((p) => p.spotted).map((p) => p.cell),
      exit: idx === (bunker ? BUNKER_EXIT_LEVEL : 0) ? { x: exitX, y: exitY, unlocked: exitReady() } : null,
      stair: bunker ? null : idx === 0 ? (stair ? { x: stair.x, y: stair.y, up: true } : null) : { x: 0, y: 0, up: false },
      player:
        idx === activeFloorIdx
          ? { u: (player.worldX - rig.group.position.x) / CELL, v: (player.worldZ - rig.group.position.z) / CELL, facing: player.facingAngle }
          : null,
    };
  }

  function toggleBlueprint(): void {
    if (mapOpen) {
      closeBlueprint();
      return;
    }
    if (cleared || caught) return;
    closeControls();
    mapOpen = true;
    mapOpened = true;
    const tabs: hud.MapTab[] = storeys.map((f, i) => {
      const visited = i === 0 || f.explored.explored.some((row) => row.some(Boolean));
      return { name: f.rig.theme.name, sheet: visited ? sheetFor(f, f.explored, i) : null };
    });
    hud.openMap(levelName ?? (training ? 'training' : level), tabs, activeFloorIdx);
  }

  function closeBlueprint(): void {
    if (!mapOpen || briefingOpen) return;
    mapOpen = false;
    hud.closeMap();
  }

  /** The mission briefing over the blueprint of the tower, every floor in full, with its tasks marked: the way in, the stairs and lifts, and a keycard on each floor and the heist door. */
  function openBriefing(): void {
    if (!savedRun) return;
    const a = addressOf(savedRun);
    const everywhere = (f: Storey): VisionState => ({ ...f.explored, explored: f.explored.explored.map((row) => row.map(() => true)) });
    const tabs: hud.MapTab[] = storeys.map((f, i) => {
      const sheet = sheetFor(f, everywhere(f), i);
      const marks: NonNullable<BlueprintSheet['marks']> = [];
      if (i === 0) marks.push({ x: TOWER_START.x, y: TOWER_START.y, label: 'WAY IN' });
      for (const c of TOWER_CARDS) if (c.level === i) marks.push({ x: c.x, y: c.y, label: 'KEYCARD', task: true });
      if (i === OFFICES) marks.push({ x: HEIST_DOOR.x, y: HEIST_DOOR.y, label: 'HEIST DOOR', task: true });
      for (const s of TOWER_STAIRS) {
        const what = s.climb ? 'CLIMB' : s.timed ? 'STAIRS (CONSOLE)' : 'STAIRS';
        if (stairLow(s) === i) marks.push({ x: s.x, y: s.y, label: `${what} ▲` });
        if (stairHigh(s) === i) marks.push({ x: s.x, y: s.y, label: `${what} ▼` });
      }
      for (const l of TOWER_LIFTS) if (l.serves.includes(i)) marks.push({ x: l.x, y: l.y, label: l.locked ? 'LIFT ⊘' : 'LIFT' });
      return { name: f.rig.theme.name, sheet: { ...sheet, player: null, marks } };
    });
    briefingOpen = true;
    mapOpen = true;
    hud.openMap('The tower', tabs, 0, {
      kicker: 'Mission briefing',
      title: a.name,
      sub: a.street,
      tasks: towerTasks(storeys.map((f) => f.rig.theme.name), [...new Set(TOWER_CARDS.map((c) => c.level))].sort()),
      begin: 'Begin',
      onBegin: () => {
        briefingOpen = false;
        closeBlueprint();
        try {
          window.localStorage.setItem(BRIEFED, briefedKey);
        } catch {
          // no storage: it may show again after a reload
        }
        tourPending = false;
        for (const fn of afterTour.splice(0)) fn();
      },
    });
  }

  function applyOutcome(floor: ActiveFloor, o: Outcome, locker: Locker): void {
    score += o.scoreDelta;
    suspicion = applySuspicion(suspicion, o.suspicionDelta);
    hud.setScore(score);
    hud.setSuspicion(suspicion);
    if (o.document) collectDocument();
    else hud.showToast(o.toast.text, o.toast.kind);
    if (o.emp) {
      empCharges += o.emp;
      sound.play('powerUp', undefined, 0.5);
    }

    // A rigged locker lights its fuse; the alarm comes when it runs out (tickFuses).
    if (o.ambush) {
      fuses.push({ locker, floor, left: RIG_FUSE_S, shown: RIG_FUSE_S });
      locker.rig.setCountdown(RIG_FUSE_S);
    }

    if (isCaught(suspicion)) {
      triggerCaught('Caught', 'One too many rigged lockers tipped off the guards.');
    }
  }

  /**
   * Runs every rigged locker's fuse down: a beep each second, then the alarm —
   * suspicion jumps and RIG_AMBUSH_BOTS guards assemble at the locker (the
   * second one a step toward the room's doorway, so they don't stand in one another).
   */
  function tickFuses(dt: number): void {
    for (let i = fuses.length - 1; i >= 0; i--) {
      const f = fuses[i]!;
      const { locker, floor } = f;
      f.left -= dt;
      const whole = Math.max(0, Math.ceil(f.left));
      if (whole !== f.shown) {
        f.shown = whole;
        locker.rig.setCountdown(whole);
        if (whole > 0) sound.play('beep', worldAt(floor.rig, locker.x, locker.z, 1.9), whole <= 3 ? 1 : 0.7);
      }
      if (f.left > 0) continue;
      fuses.splice(i, 1);
      locker.rig.setCountdown(null);
      sound.play('alarm', worldAt(floor.rig, locker.x, locker.z, 1.9));
      const room = floor.content.storage.find((st) => st.built.lockers.some((l) => l.rig === locker.rig));
      const [dx, dy] = room ? DIR_DELTA[room.built.room.openDir] : [0, 0];
      const originX = floor.rig.group.position.x;
      const originY = floor.rig.group.position.y;
      const originZ = floor.rig.group.position.z;
      for (let n = 0; n < RIG_AMBUSH_BOTS; n++) {
        const spawnX = locker.x + originX + dx * n * 1.2;
        const spawnZ = locker.z + originZ + dy * n * 1.2;
        activeAssemblies.push(
          spawnAssemblyEffect(
            root.scene,
            spawnX,
            spawnZ,
            () => {
              floor.content.enemies.push(new Bot(root.scene, spawnX, spawnZ, originX, originY, originZ));
            },
            originY
          )
        );
      }
      suspicion = applySuspicion(suspicion, RIG_ALARM_SUSPICION);
      hud.setSuspicion(suspicion);
      hud.pulseDanger();
      hud.showToast(`ALARM · ${RIG_AMBUSH_BOTS} GUARDS AT THE LOCKER · SUSPICION +${RIG_ALARM_SUSPICION}%`, 'bad');
      if (isCaught(suspicion)) triggerCaught('Caught', 'A rigged locker sounded the alarm.');
    }
  }

  /** Shows the trap camera for whichever trap is on screen, or hides it when none are out. */
  function refreshTrapFeed(): void {
    trapView = Math.max(0, Math.min(trapView, traps.length - 1));
    const trap = traps[trapView];
    hud.setTrapFeed(trap ? { index: trapView, count: traps.length, armed: trap.armingLeft === 0 } : null);
  }

  /** Whether a trap can go out now: one left, fewer than the most out at once. Says why not. */
  function canSetTrap(): boolean {
    if (cleared || caught || paused() || hiddenIn || ventTransit || handsFull() || aloft) return false;
    if (trapsLeft <= 0) {
      sound.play('denied');
      hud.showToast('NO TRAPS LEFT', 'bad');
      return false;
    }
    if (traps.length >= MAX_ARMED_TRAPS) {
      sound.play('denied');
      hud.showToast(`${MAX_ARMED_TRAPS} TRAPS OUT ALREADY · BLOW ONE FIRST`, 'neutral');
      return false;
    }
    return true;
  }

  /**
   * Where a trap rolled from here would stop (trapRoll.ts): up to two cells the way the player faces, short of
   * the first wall, or in a pack's meeting point or a sentry's post on the way.
   */
  function rollTarget(floor: ActiveFloor): RollStop {
    const f = player.facingAngle;
    const clear = rayToBoxes(player.worldX, player.worldZ, Math.sin(f), Math.cos(f), ROLL_DISTANCE + ROLL_WALL_MARGIN, aimWalls(floor));
    const slots = [
      ...floor.content.packs.map((p) => ({ x: p.meetX, z: p.meetZ, kind: 'pack' as const })),
      ...floor.content.enemies.flatMap((e) => (e instanceof Bot && !e.disabled && e.postSpot ? [{ ...e.postSpot, kind: 'sentry' as const }] : [])),
    ];
    return rollStop(player.worldX, player.worldZ, f, clear, slots);
  }

  /**
   * The trap button: lines up a roll, the path and blast drawn on the floor; pressed again, it rolls.
   * Lined up, Interact dashes along the line instead (dashToAim), so it aims with no traps left too.
   */
  function handleTrap(): void {
    if (trapAiming) {
      rollTrap();
      return;
    }
    if (cleared || caught || paused() || hiddenIn || ventTransit || handsFull() || aloft) return;
    trapAiming = true;
    hud.setTrapAim(true);
    const go = 'DASH';
    if (trapsLeft <= 0) hud.showToast(onTouch() ? `NO TRAPS LEFT · YOU CAN STILL ${go} THERE` : keyed(`NO TRAPS LEFT · {interact} STILL DASHES THERE`).toUpperCase(), 'neutral');
    else toastOnce('aim', onTouch() ? `ROLL A TRAP ALONG THE LINE, OR ${go} TO ITS END` : keyed(`{trap} ROLLS A TRAP ALONG THE LINE · {interact} DASHES TO ITS END`).toUpperCase(), 4200);
  }

  let dashing = false; // mid-dash to the aim's end: into cover there, if there's any, on arrival
  /** Cover to cover: the spot behind the next desk the agent is facing, if the dash would go there (coverhop.ts); where the dash is bound, and the ring that shows it. */
  let hopTo: CoverSpot | null = null;
  const HOP_COOLDOWN_S = 1; // a hop from cover to cover is quick: the next can follow after this
  const hopRing = (() => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fd6f0, transparent: true, opacity: 0.9, depthWrite: false });
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const dotGeo = new THREE.CircleGeometry(0.14, 20);
    dotGeo.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(ringGeo, mat), new THREE.Mesh(dotGeo, mat));
    for (const o of g.children) o.renderOrder = 3;
    g.visible = false;
    root.scene.add(g);
    return g;
  })();

  /** The cover the agent would hop to from here, facing as they are: in front, in reach, a clear way, on the side that hides them best from the guards who are up. */
  function hopCandidate(floor: ActiveFloor): CoverSpot | null {
    const walls = aimWalls(floor);
    const threats: HopThreat[] = floor.content.enemies.filter((e) => e instanceof Bot && !e.disabled).map((e) => ({ x: e.worldX, z: e.worldZ }));
    return hopSpot(
      walls,
      player.worldX,
      player.worldZ,
      player.facingAngle,
      threats,
      (x1, z1, x2, z2) => {
        const d = Math.hypot(x2 - x1, z2 - z1);
        return d < 1e-6 ? 0 : rayToBoxes(x1, z1, (x2 - x1) / d, (z2 - z1) / d, d, walls);
      },
      inCover
    );
  }

  /** Sprints to where the trap's aim line ends: a quick run into cover before something comes round the corner. */
  function dashToAim(): void {
    if (!trapAiming) return;
    if (silent) {
      hud.showToast('NO DASHING ON A SILENT NIGHT', 'neutral', 2200);
      return;
    }
    // Straight along the line, to where it would end without the roll's pull toward a sentry's post or a
    // pack's meeting point: a dash there would run you into them.
    const floor = currentFloor();
    const f = player.facingAngle;
    const [dirX, dirZ] = [Math.sin(f), Math.cos(f)];
    const clear = rayToBoxes(player.worldX, player.worldZ, dirX, dirZ, ROLL_DISTANCE + ROLL_WALL_MARGIN, aimWalls(floor));
    // Facing a desk or a cabinet in reach with a clear way: the dash goes behind it (cover to cover), not just along the line.
    const hop = hopCandidate(floor);
    let stop: { x: number; z: number } = hop ? { x: hop.px, z: hop.pz } : rollStop(player.worldX, player.worldZ, f, clear, []);
    // Through an open shutter: the dash ends just past it, so its slide goes under.
    const opened = floor.content.shutters.filter((s) => s.openedAt !== null).map((s) => s.box);
    const reach = Math.hypot(stop.x - player.worldX, stop.z - player.worldZ);
    const under = !hop && opened.length ? rayToBoxes(player.worldX, player.worldZ, dirX, dirZ, reach, opened) * reach : Infinity;
    if (under < reach) {
      const to = Math.min(reach, Math.max(under + SHUTTER_CLEAR, MIN_SLIDE_DASH));
      stop = { x: player.worldX + dirX * to, z: player.worldZ + dirZ * to };
    }
    cancelTrapAim();
    if (dodgeCooldown > 0) {
      sound.play('denied');
      return;
    }
    leaveCover();
    hopTo = hop;
    // (In the tower it is a sprint, then a slide, and the agent is crouched where it ends.)
    player.dashTo(stop.x, stop.z, under < reach, tower && !(under < reach));
    dashing = true;
    dashesBegun++;
    dodgeCooldown = hop ? HOP_COOLDOWN_S : DASH_COOLDOWN_S;
    sound.play('dodge');
  }

  /** What an aim line stops at: the walls, less any shutter that's been opened (a dash slides under it as it closes). */
  function aimWalls(floor: ActiveFloor): WallBox[] {
    const opened = floor.content.shutters.filter((s) => s.openedAt !== null).map((s) => s.box);
    return opened.length ? floor.rig.wallBoxes.filter((b) => !opened.includes(b)) : floor.rig.wallBoxes;
  }

  /**
   * Each timed shutter: where it is in its timeline since its panel was hacked, shown on its rig, and in the way
   * (in its floor's walls) whenever it's down too far to get under: upright, or sliding (player.ts's low).
   */
  function tickShutters(dt: number): void {
    for (const { rig, content } of storeys) {
      for (const s of content.shutters) {
        let t = s.openedAt === null ? null : stats.seconds - s.openedAt;
        if (t !== null && t >= SHUTTER_OPEN_S) {
          s.openedAt = null;
          t = null;
        }
        const closure = shutterClosure(t);
        const falling = SHUTTER_RISE_S + SHUTTER_HOLD_S;
        if (t !== null && t >= falling && t - dt < falling) {
          const y = rig.group.position.y + 2;
          sound.play('liftDoors', { x: (s.box.minX + s.box.maxX) / 2, y, z: (s.box.minZ + s.box.maxZ) / 2 }, 0.9);
        }
        s.rig.set(closure, t === null ? 0 : 1 - t / SHUTTER_OPEN_S, shutterHack?.shutter === s);
        const i = s.walls.indexOf(s.box);
        if (shutterBlocks(closure, player.low)) {
          if (i < 0) s.walls.push(s.box);
        } else if (i >= 0) s.walls.splice(i, 1);
      }
    }
  }

  function cancelTrapAim(): void {
    if (!trapAiming) return;
    trapAiming = false;
    trapAim.hide();
    hopRing.visible = false;
    hud.setTrapAim(false);
  }

  /** Rolls a trap along the aimed line. */
  function rollTrap(): void {
    cancelTrapAim();
    if (!canSetTrap()) return;
    placeTrap(rollTarget(currentFloor()));
  }

  /** Sets a trap down where the player stands, its camera looking the way they face. */
  function setTrapHere(): void {
    cancelTrapAim();
    if (!canSetTrap()) return;
    placeTrap(null);
  }

  /** Puts a trap out: rolled to `stop`, or (null) set at the player's feet. Its camera looks the way they face. */
  function placeTrap(stop: RollStop | null): void {
    const floor = currentFloor();
    const at = stop ?? { x: player.worldX, z: player.worldZ, slot: null };
    traps.push(buildTrap(root.scene, player.worldX, player.worldZ, at.x, floor.rig.group.position.y, at.z, player.facingAngle, activeFloorIdx, aimWalls(floor)));
    trapsLeft--;
    trapsSet++;
    if (stop) trapsPlacedRolled++;
    else trapsPlacedHere++;
    if (floor.content.packs.some((p) => Math.hypot(p.meetX - at.x, p.meetZ - at.z) < PACK_TRAP_NEAR)) packTraps++;
    trapView = traps.length - 1;
    hud.setTrapsLeft(trapsLeft);
    refreshTrapFeed();
    sound.play(stop ? 'drag' : 'key', worldAt(floor.rig, at.x - floor.rig.group.position.x, at.z - floor.rig.group.position.z, 0.2), stop ? 0.35 : 0.9);
    hud.showToast(
      !stop
        ? 'TRAP SET · ITS SENSOR ARMS ITSELF AND BLOWS IT ON ANYTHING THAT CROSSES THE BLUE BEAM'
        : at.slot === 'pack'
          ? 'TRAP ROLLED INTO THE PACK’S MEETING POINT'
          : at.slot === 'sentry'
            ? 'TRAP ROLLED TO THE SENTRY’S POST'
            : 'TRAP ROLLED · ITS SENSOR ARMS ITSELF AND BLOWS IT ON ANYTHING THAT CROSSES THE BLUE BEAM',
      'neutral'
    );
  }

  function handleNextTrap(): void {
    if (traps.length < 2) return;
    trapView = (trapView + 1) % traps.length;
    refreshTrapFeed();
  }

  /** Blows the trap on camera by hand: the trap in view goes off (blowTrap). */
  function handleDetonate(): void {
    if (cleared || caught || paused()) return;
    const trap = traps[trapView];
    if (!trap) return;
    if (trap.armingLeft > 0) {
      hud.showToast('TRAP STILL ARMING', 'neutral');
      return;
    }
    blowTrap(trap, false);
  }

  /**
   * Sets a trap off: everything within TRAP_RADIUS is knocked out, and the bang brings guards nearby to look. By hand (the detonate key) or, `sensed`, because something
   * broke its beam.
   */
  function blowTrap(trap: TrapRig, sensed: boolean): void {
    const at0 = traps.indexOf(trap);
    if (at0 < 0) return;
    const floor = storeys[Math.min(trap.floorIdx, storeys.length - 1)]!;
    const at = new THREE.Vector3(trap.x, floor.rig.group.position.y + 0.3, trap.z);
    const inRange = floor.content.enemies.filter((e) => !e.disabled && Math.hypot(e.worldX - trap.x, e.worldZ - trap.z) <= TRAP_RADIUS);
    const downed = inRange.filter((e) => e.hit('emp') === 'disabled');
    for (const e of downed) enemyDown(e, new THREE.Vector3(e.worldX, e.floorY + 0.6, e.worldZ));
    trapKills += downed.length;
    bestBlast = Math.max(bestBlast, downed.length);
    sound.play('boom', { x: at.x, y: at.y, z: at.z });
    bursts.sparks(at, sensed ? 0x6fc8ff : 0xffb050);
    blasts.boom(at, 1);
    for (const e of downed) zapEnemy(at, e, sensed ? 0x6fc8ff : 0xffb050);
    if (trap.floorIdx === activeFloorIdx && Math.hypot(player.worldX - trap.x, player.worldZ - trap.z) < 8) player.shake(0.6);
    for (const e of floor.content.enemies) {
      if (!e.disabled && e instanceof Bot) e.investigate(trap.x, trap.z, 5, floor.content.navCells, floor.content.cols, floor.content.rows, TRAP_LURE_CELLS);
    }
    trap.remove();
    traps.splice(at0, 1);
    if (at0 < trapView) trapView--;
    refreshTrapFeed();
    const prefix = sensed ? 'SENSOR TRAP' : 'TRAP';
    hud.showToast(downed.length ? `${prefix} · ${downed.length} DOWN` : `${prefix} · NOTHING IN RANGE`, downed.length ? 'good' : 'neutral');
  }

  /** Where each enemy was last frame, for telling a walk across a trap's beam from standing in it. */
  const enemyPrev = new Map<Enemy, { x: number; z: number; facing: number }>();

  /** The traps' motion sensors: any armed trap whose beam something walking has just crossed goes off by itself. */
  function tickTrapSensors(dt: number): void {
    if (cleared || caught || dt <= 0) return;
    for (const [idx, { content }] of storeys.entries()) {
      for (const trap of [...traps]) {
        if (trap.floorIdx !== idx || trap.armingLeft > 0) continue;
        if (trap.fuseLeft !== null) {
          // The beam is already broken: the blast follows a moment later, so whatever was close behind walks into it too.
          if (trap.fuseLeft <= 0) blowTrap(trap, true);
          continue;
        }
        const tripped = content.enemies.some((e) => {
          const prev = enemyPrev.get(e);
          if (!prev || e.disabled || e.radius <= 0) return false;
          // Moving across it, or turning on it (a guard looking around shifts its feet).
          const turned = Math.abs(Math.atan2(Math.sin(e.facing - prev.facing), Math.cos(e.facing - prev.facing))) / dt;
          return brokeBeam(trap.beam, prev, { x: e.worldX, z: e.worldZ }, e.radius, turned);
        });
        if (tripped) {
          trap.trip();
          sound.play('beep', { x: trap.x, y: 0.4, z: trap.z }, 0.8);
        }
      }
    }
    for (const { content } of storeys) for (const e of content.enemies) enemyPrev.set(e, { x: e.worldX, z: e.worldZ, facing: e.facing });
  }

  /**
   * Draws the trap on camera into the feed's window, in night vision, after
   * the main frame. The trap's own floor (and its enemies) show for this
   * render even if the player is on the other one.
   */
  function renderTrapFeed(): void {
    const trap = traps[trapView];
    const rect = trap ? hud.trapFeedRect() : null;
    if (!trap || !rect || rect.width < 2) return;
    const r = root.renderer;
    const shown = storeys.map((f) => f.rig.group.visible);
    for (const f of storeys) f.rig.group.visible = true;
    const trapContent = storeys[Math.min(trap.floorIdx, storeys.length - 1)]!.content;
    for (const { content } of storeys) for (const e of content.enemies) e.setVisible(content === trapContent);
    trap.camera.aspect = rect.width / rect.height;
    trap.camera.updateProjectionMatrix();
    const h = r.domElement.clientHeight;
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = exposure * NIGHT_VISION;
    trapLamp.position.copy(trap.camera.position);
    trapLamp.target.position.copy(trap.camera.position).add(trap.camera.getWorldDirection(new THREE.Vector3()));
    trapLamp.target.updateMatrixWorld();
    trapLamp.intensity = TRAP_LAMP;
    r.setScissorTest(true);
    r.setScissor(rect.left, h - rect.bottom, rect.width, rect.height);
    r.setViewport(rect.left, h - rect.bottom, rect.width, rect.height);
    r.render(root.scene, trap.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, h);
    r.toneMappingExposure = exposure;
    trapLamp.intensity = 0;
    storeys.forEach((f, i) => (f.rig.group.visible = shown[i]!));
    const here = currentFloor().content;
    for (const { content } of storeys) for (const e of content.enemies) e.setVisible(content === here);
  }

  function setTorchOn(on: boolean): void {
    if (on) torchOns++;
    player.setTorch(on);
    beam.setOn(on);
    dust.setOn(on);
    hud.setTorch(on);
  }

  function handleTorch(): void {
    if (cleared || caught || paused()) return;
    const on = !player.torch;
    setTorchOn(on);
    sound.play('key', undefined, 0.9);
    // A torch blinds night vision: the goggles come off.
    if (on && goggles.on) {
      goggles = { ...goggles, on: false };
      sound.play('gogglesOff', undefined, 0.6);
    }
  }

  /** Night vision on or off. Putting it on switches the torch off — the point is to see without a beam giving you away. */
  function handleGoggles(): void {
    if (cleared || caught || paused()) return;
    const next = toggleGoggles(goggles);
    if (next.on === goggles.on) {
      sound.play('denied');
      hud.showToast('NIGHT VISION RECHARGING', 'neutral');
      return;
    }
    goggles = next;
    if (goggles.on && player.torch) setTorchOn(false);
    sound.play(goggles.on ? 'gogglesOn' : 'gogglesOff', undefined, 0.8);
    if (goggles.on) hud.showToast(`NIGHT VISION · GUARDS AND DOGS SHOW THROUGH THE WALLS WITHIN ${INFRARED_RANGE_M} M`, 'neutral', 3200);
  }

  function handleCamo(): void {
    if (cleared || caught || paused()) return;
    const next = toggleCamo(camo);
    if (next.active === camo.active) {
      hud.showToast('CAMO RECHARGING', 'neutral');
      return;
    }
    camo = next;
    sound.play(camo.active ? 'camoOn' : 'camoOff');
  }

  /** What a carried body at (lx, lz) on `active` could be put away in, if anything's close: a staff locker, a pair of crates or a vent. Furniture and records lockers don't count: a body won't fit behind a desk or between the shelves. */
  /** What the place being played hides bodies in (hideouts.ts). */
  const hideSkin = (): (typeof HIDEOUTS)[keyof typeof HIDEOUTS] => HIDEOUTS[planPlace ?? 'campus'];

  function stashSpotNear(active: ActiveFloor, lx: number, lz: number): StashSpot | null {
    const { content } = active;
    for (const l of content.staffLockers) {
      if (Math.hypot(l.rig.front.x - lx, l.rig.front.z - lz) <= STASH_REACH) return { container: 'locker', what: hideSkin().locker.name, locker: l.rig, at: l.rig.front };
    }
    for (let i = 0; i < content.hidingSpots.length; i++) {
      const c = content.hidingSpots[i]!;
      if (Math.hypot(c.x * CELL - lx, c.y * CELL - lz) <= STASH_REACH + 0.5) return { container: 'crates', what: hideSkin().crates.name, crates: content.crates[i]!, at: { x: c.x * CELL, z: c.y * CELL } };
    }
    for (const v of content.vents) {
      for (const e of v.ends) {
        if (Math.hypot(e.stand.x - lx, e.stand.z - lz) <= STASH_REACH) return { container: 'vent', what: hideSkin().vent.name, vent: e, at: e.stand };
      }
    }
    return null;
  }

  /** Starts putting the carried body away: the agent steps to the right spot and works the container. A body too big for it (a heavy) is refused. */
  function startStash(spot: StashSpot, active: ActiveFloor): void {
    const body = carried;
    if (!body || stashing) return;
    if (!firstThatFits([spot.container], body.bodyScale)) {
      sound.play('denied', worldAt(active.rig, spot.at.x, spot.at.z));
      hud.showToast(`TOO BIG FOR ${spot.what.toUpperCase()} · A HEAVY WON'T FIT · SET IT DOWN IN THE DARK INSTEAD`, 'bad', 3800);
      return;
    }
    // Step to where the container is worked from, facing it.
    const o = active.rig.group.position;
    let stand = { x: player.worldX - o.x, z: player.worldZ - o.z };
    let facing: number;
    if (spot.container === 'locker' && spot.locker) {
      stand = { x: spot.locker.front.x, z: spot.locker.front.z };
      facing = spot.locker.front.facing + Math.PI;
    } else if (spot.container === 'vent' && spot.vent) {
      stand = { x: spot.vent.stand.x, z: spot.vent.stand.z };
      facing = spot.vent.stand.facing;
    } else {
      // The crates open where the agent already is, whichever way it came at them: no being moved round to a side of them (in a corridor running the length of the pair that side is the wall).
      // Only if it is close enough to be in the way of the near crate sliding out is it eased back, along the line from the crates, to where that clears.
      const dx = stand.x - spot.at.x;
      const dz = stand.z - spot.at.z;
      if (Math.abs(dx) < CRATE_HALF_LENGTH + PLAYER_R && Math.abs(dz) < CRATE_CLEAR) {
        const side = dz >= 0 ? 1 : -1;
        for (const s of [side, -side]) {
          const tryStand = { x: stand.x, z: spot.at.z + s * CRATE_CLEAR };
          if (!collides(tryStand.x + o.x, tryStand.z + o.z, active.rig.wallBoxes.filter((b) => !b.cover))) {
            stand = tryStand;
            break;
          }
        }
      }
      // And it keeps facing the way it was: turning it to face the pair could put the camera on the far side of a corridor wall, with the whole job hidden behind it.
      facing = player.facingAngle;
    }
    player.place(stand.x + o.x, stand.z + o.z, facing);
    stashing = { spot, floor: active, body, t: 0, loaded: false, sealed: false, stand, facing };
    const skin = hideSkin();
    const where = spot.container === 'locker' ? skin.locker.working : spot.container === 'crates' ? skin.crates.working : skin.vent.working;
    hud.showToast(where, 'neutral', 1800);
    sound.play(spot.container === 'crates' ? 'drag' : 'key', worldAt(active.rig, spot.at.x, spot.at.z), 0.8);
  }

  /** One frame of putting a body away: the container opens, the body goes in, the container closes, and it's done. */
  function tickStash(dt: number): void {
    if (!stashing) return;
    const st = stashing;
    st.t += dt;
    const { container, locker, crates, vent } = st.spot;
    const tl = TIMELINE[container];
    const open = openness(container, st.t);
    const at = (x: number, z: number) => worldAt(st.floor.rig, x, z);
    const o = st.floor.rig.group.position;
    if (locker) locker.setOpen(open);
    if (crates) crates.setOpen(open);
    if (vent) vent.setOpen(open);
    if (!st.opened && st.t >= tl.open) {
      st.opened = true;
      sound.play(container === 'locker' ? 'lockerOpen' : container === 'vent' ? 'clatter' : 'drag', at(st.spot.at.x, st.spot.at.z), 0.8);
    }
    const body = st.body;
    // The body goes in: out of the agent's arms and into the opening.
    if (!st.loaded && st.t >= tl.load) {
      st.loaded = true;
      carried = null;
      sound.play('stash', at(st.spot.at.x, st.spot.at.z), 0.7);
      if (container === 'locker') {
        body.stash();
      } else if (container === 'crates') {
        // Lying along the bay between the crates (the pair runs along X).
        body.layDown(st.spot.at.x + o.x, st.spot.at.z + o.z, STASH_BODY_ALONG_X);
      }
    }
    if (st.loaded && !st.sealed) {
      if (container === 'vent' && vent) {
        // Pushed in feet first, along the way the grille faces, into the wall.
        const dir = { x: Math.sin(vent.stand.facing), z: Math.cos(vent.stand.facing) };
        const k = ramp(st.t, tl.load, tl.seal);
        const d = 0.5 + VENT_PUSH * k;
        body.layDown(vent.stand.x + o.x + dir.x * d, vent.stand.z + o.z + dir.z * d, vent.stand.facing + STASH_BODY_ALONG_FACING);
      }
    }
    // Sealed up again: the body is gone from sight for good.
    if (st.loaded && !st.sealed && st.t >= tl.seal + 0.2) {
      st.sealed = true;
      body.stash();
      sound.play(container === 'locker' ? 'doorOpen' : 'clatter', at(st.spot.at.x, st.spot.at.z), 0.8);
    }
    if (st.t >= tl.done) {
      stashing = null;
      finishStash(body, st.spot.what);
    }
  }

  /** The body's away where nobody will find it: it's gone for good, so there's no detection to read. */
  function finishStash(body: Bot, what: string): void {
    const b = bodies.get(body);
    if (b) {
      b.found = true; // nobody will come across it now
      b.notice = 0;
    }
    bodiesHidden++;
    bodiesStashed++;
    hud.showToast(`BODY STASHED · IN ${what.toUpperCase()}, WHERE NOBODY WILL FIND IT`, 'good', 3400);
  }

  function dropBody(): void {
    const body = carried;
    carried = null;
    sound.play('stash', undefined, 0.5);
    if (!body) return;
    const floor = floorOfBody(body);
    if (body.carriable) {
      const f = player.facingAngle;
      const ahead = { x: player.worldX + Math.sin(f) * BODY_SET_DOWN, z: player.worldZ + Math.cos(f) * BODY_SET_DOWN };
      const clear = !collides(ahead.x, ahead.z, floor.rig.wallBoxes);
      body.layDown(clear ? ahead.x : player.worldX, clear ? ahead.z : player.worldZ, f);
    }
    const vis = visibilityOf(body, floor);
    if (vis <= BODY_HIDDEN_PCT) bodiesHidden++;
    hud.showToast(`BODY DOWN · DETECTION ${vis}%`, vis <= BODY_HIDDEN_PCT ? 'good' : vis <= 70 ? 'neutral' : 'bad');
  }

  // ---- bodies ----

  function floorOfBody(body: Bot): ActiveFloor {
    return storeys.find((f) => f.content.enemies.includes(body)) ?? storeys[0]!;
  }

  /** How visible a body is where it lies (bodies.ts): the light on it, and whether it's inside a room. */
  function visibilityOf(body: Bot, floor: ActiveFloor): number {
    const { content } = floor;
    let rooms = roomCellSets.get(content);
    if (!rooms) {
      rooms = new Set(content.rooms.flatMap((r) => r.room.cells.map((c) => `${c.x},${c.y}`)));
      roomCellSets.set(content, rooms);
    }
    const o = floor.rig.group.position;
    const c = body.bodyCenter;
    const fx = (c.x - o.x) / CELL;
    const fy = (c.z - o.z) / CELL;
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    const dark = content.dark[cy]?.[cx] === true || content.powerCut[cy]?.[cx] === true;
    const lamps = content.lamps.map((l) => ({ x: l.cell.x, y: l.cell.y, lit: !l.broken && !l.off && !l.cut }));
    return bodyVisibility(lightAt(fx, fy, lamps, dark), rooms.has(`${cx},${cy}`));
  }

  /**
   * Every frame: how visible each body lies, and whether a guard looking its way notices it — from its full
   * sight range for a body at 100%, only close up for a well-hidden one. Low furniture hides a body too.
   */
  function tickBodies(dt: number): void {
    if (exitMode) return; // (the guards already know the agent is in the building: a body found is nothing new)
    for (const floor of storeys) {
      for (const e of floor.content.enemies) {
        if (!(e instanceof Bot) || !e.downed) continue;
        let b = bodies.get(e);
        if (!b) bodies.set(e, (b = { vis: 100, found: false, notice: 0 }));
        b.vis = visibilityOf(e, floor);
        if (e === carried) b.notice = 0;
        if (b.found || e === carried) continue;
        const c = e.bodyCenter;
        const range = noticeRange(b.vis, DETECT_RADIUS);
        const finder = floor.content.enemies.find((g) => {
          if (!(g instanceof Bot) || g.disabled) return false;
          const d = Math.hypot(g.worldX - c.x, g.worldZ - c.z);
          if (d > range || (d > BODY_MIN_NOTICE && !inViewCone(g.worldX, g.worldZ, g.facing, c.x, c.z))) return false;
          return hasLineOfSight(g.worldX, g.worldZ, c.x, c.z, floor.rig.wallBoxes, range);
        });
        // Noticing builds while a guard can see the body, faster the more visible it lies, and fades when none can.
        b.notice = finder instanceof Bot ? Math.min(1, b.notice + dt * noticeRate(b.vis)) : Math.max(0, b.notice - dt * NOTICE_DECAY_PER_S);
        if (finder instanceof Bot && b.notice >= 1) bodyFound(e, finder, floor, b.vis);
      }
    }
  }

  /**
   * First-use hints that need a look at the floor (hud.ts's showHint): a laser just ahead (cloak through it),
   * a watchdog or drone close by (only an EMP stops one). Each shows once per device, so this goes quiet.
   */
  function tickHints(content: FloorContent, localX: number, localZ: number): void {
    if (content.laserCells.some((c) => Math.hypot(c.x * CELL - localX, c.y * CELL - localZ) < CELL * 1.6)) hud.showHint('camo');
    const beast = content.enemies.some(
      (e) => (e.kind === 'watchdog' || e.kind === 'drone') && !e.disabled && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) < EMP_HINT_RANGE
    );
    if (beast) hud.showHint('emp');
    const mine = content.enemies.find((e) => e.kind === 'crawler' && !e.disabled && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) < MINE_HINT_RANGE);
    if (mine) toastOnce('crawler', 'CRAWLER MINE: IT WAKES WHEN YOU GET CLOSE (LESS IF YOU CROUCH), RUNS AT YOU AND BLOWS. A STUN SHOT OR AN EMP STOPS IT FOR GOOD, OR OUTRUN IT AND IT GIVES UP', 7200);
    if (content.shutters.some((s) => s.openedAt === null && Math.hypot(s.rig.center.x - localX, s.rig.center.z - localZ) < CELL * 1.6)) {
      const how = onTouch() ? 'OPEN YOUR KIT, TAP TRAP TO AIM, THEN DASH' : keyed('{trap} TO AIM, THEN {interact}').toUpperCase();
      toastOnce('shutter', `TIMED SHUTTER · HACK THE PANEL AND IT OPENS, BUT IT’S DOWN BEFORE YOU COULD WALK THERE · DASH AND SLIDE UNDER: ${how}`, 6000);
    }
  }

  /** A guard found a body: it goes to look, those nearby come too, and suspicion jumps. */
  function bodyFound(body: Bot, finder: Bot, floor: ActiveFloor, vis: number): void {
    bodies.get(body)!.found = true;
    stats.bodiesFound++;
    const c = body.bodyCenter;
    const { navCells, cols: fc, rows: fr } = floor.content;
    finder.investigate(c.x, c.z, 6, navCells, fc, fr, fc * fr);
    // A body that was well hidden is only the finder's business; one in plain sight calls everyone near.
    if (callsOthers(vis)) {
      for (const e of floor.content.enemies) {
        if (e !== finder && e instanceof Bot && !e.disabled) e.investigate(c.x, c.z, 5, navCells, fc, fr, BODY_CALLS_CELLS);
      }
    }
    sound.play('alert', { x: finder.worldX, y: finder.floorY + 1.6, z: finder.worldZ });
    if (healthMode) {
      hud.showToast('A GUARD FOUND A BODY · THE GUARDS ARE COMING', 'bad');
      return;
    }
    const cost = foundSuspicion(vis);
    suspicion = applySuspicion(suspicion, cost);
    hud.setSuspicion(suspicion);
    hud.showToast(`A GUARD FOUND A BODY · SUSPICION +${cost}%`, 'bad');
    if (isCaught(suspicion)) triggerCaught('A body was found', 'A guard found one of its own and raised the alarm.');
  }

  const meterAt = new THREE.Vector3();
  /** The visibility meters over the bodies near the player on this floor. */
  function showBodyMeters(): void {
    const canvasEl = root.renderer.domElement;
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    const content = currentFloor().content;
    const meters: hud.BodyMeter[] = [];
    for (const [body, b] of bodies) {
      if (!body.downed || !content.enemies.includes(body)) continue;
      const c = body.bodyCenter;
      if (body !== carried && Math.hypot(c.x - player.worldX, c.z - player.worldZ) > BODY_METER_RANGE) continue;
      meterAt.set(c.x, body.floorY + 0.75, c.z).project(root.camera);
      if (meterAt.z > 1 || Math.abs(meterAt.x) > 1.1 || Math.abs(meterAt.y) > 1.1) continue;
      meters.push({ x: ((meterAt.x + 1) / 2) * w, y: ((1 - meterAt.y) / 2) * h, pct: b.vis, found: b.found });
    }
    hud.setBodyMeters(meters);
  }

  /**
   * Brings a server's grid online if its terminal has been hacked: opens
   * every door with the same key, maps that section's floor (fog lifts to
   * the explored tier), raises a beacon over each storage room in it, and
   * lights the status LED on the lockers there that hold a document.
   */
  /** Opens a locked door for good: its leaf swings clear, its collider goes, and bots and the guide can path through it. */
  /** The doors of the rooms with nothing in them: open for the agent or any enemy that comes to one, shut again once they're clear of it. */
  const PARTNER_DOOR_REACH = 0.9; // metres further off the partner opens a room door from than the agent does
  function tickRoomDoors(content: FloorContent, rig: FloorRig, dt: number): void {
    if (content.roomDoors.length === 0) return;
    const o = rig.group.position;
    const here = Math.abs(player.worldY - o.y) < 2;
    for (const d of content.roomDoors) {
      const cx = d.rig.center.x + o.x;
      const cz = d.rig.center.z + o.z;
      const byPlayer = here ? Math.hypot(player.worldX - cx, player.worldZ - cz) : Infinity;
      let nearest = byPlayer;
      for (const e of content.enemies) if (!e.disabled) nearest = Math.min(nearest, Math.hypot(e.worldX - cx, e.worldZ - cz));
      // The partner walking behind the agent counts too: a door that shut between them would catch them in the doorway.
      // It opens a door from a little further off than the agent does (it walks the doorway's middle and turns there; a door still shut when it gets there is something to catch on), and holds one open the same.
      if (partner && Math.abs(partner.worldY - o.y) < 2) nearest = Math.min(nearest, Math.max(0, Math.hypot(partner.worldX - cx, partner.worldZ - cz) - PARTNER_DOOR_REACH));
      let next = stepRoomDoor(d.state, nearest, dt);
      if (lockdownUntil > 0) {
        // Sealed: a shut door stays shut, and an open one shuts once nothing is within three metres of it (so nobody is caught in a doorway).
        next = !d.state.open ? d.state : nearest > LOCKDOWN_CLEAR_M ? stepRoomDoor(d.state, Infinity, dt) : d.state;
      }
      if (next.open !== d.state.open) {
        const at = worldAt(rig, d.rig.center.x, d.rig.center.z, 1.5);
        if (next.open) {
          d.rig.open();
          sound.play('doorOpen', at, 0.5);
          const i = rig.wallBoxes.indexOf(d.box);
          if (i !== -1) rig.wallBoxes.splice(i, 1);
          if (byPlayer <= OPEN_R) toastOnce('room-door', 'ROOM DOORS SLIDE SHUT BEHIND YOU: A GUARD CAN’T SEE IN THROUGH A SHUT ONE, BUT ONE THAT COMES TO THE DOOR WILL OPEN IT. HIDE IN A ROOM, OR WORK IN ONE OUT OF SIGHT', 6200);
        } else {
          d.rig.close();
          sound.play('doorOpen', at, 0.3);
          if (!rig.wallBoxes.includes(d.box)) rig.wallBoxes.push(d.box);
        }
      }
      d.state = next;
      d.rig.update(dt);
    }
  }

  function openDoor(rig: DoorRig, floor: ActiveFloor): void {
    if (rig.isOpen()) return;
    rig.open();
    sound.play('doorOpen', worldAt(floor.rig, rig.center.x, rig.center.z, 1.5));
    const box = floor.content.doorBoxes.get(rig);
    const i = box ? floor.rig.wallBoxes.indexOf(box) : -1;
    if (i !== -1) floor.rig.wallBoxes.splice(i, 1);
    setPassage(floor.content.navCells, rig.door, true, floor.content.cols, floor.content.rows);
    navVersion++;
  }

  function powerServer(server: ServerConsole, floor: ActiveFloor): void {
    const label = keyLabel(server.keyId);
    const terminal = floor.content.terminals.find((t) => t.keyId === server.keyId);
    if (!terminal?.hacked) {
      sound.play('denied', worldAt(floor.rig, server.x, server.z));
      hud.showToast(`SERVER ${label} OFFLINE · HACK TERMINAL ${label} FIRST`, 'bad');
      return;
    }
    sound.play('powerUp', worldAt(floor.rig, server.x, server.z));
    server.online = true;
    stats.gridsPowered++;
    server.room.setState('active');
    for (const rig of floor.content.doors) {
      if (rig.door.id !== server.keyId || rig.isOpen()) continue;
      openDoor(rig, floor);
    }
    const vision = storeys.find((f) => f.rig === floor.rig)?.explored ?? null;
    const { section, cols: fc, rows: fr } = floor.content;
    for (let y = 0; y < fr; y++) {
      for (let x = 0; x < fc; x++) {
        if (section[y]![x] !== server.keyId || !vision || vision.explored[y]![x]) continue;
        vision.explored[y]![x] = true;
        revealFloorCell(floor.rig, x, y, EXPLORED_COLOR);
      }
    }
    const color = KEY_COLORS[server.keyId]!;
    for (const room of floor.content.storage) {
      if (room.section !== server.keyId) continue;
      markedRooms.add(room.built);
      beacons.push(new Beacon(floor.content.parent, room.built.room.x * CELL, room.built.room.y * CELL, color));
    }
    hud.showToast(`GRID ${label} ONLINE · SECTION ${label} MAPPED · RECORDS MARKED`, 'good');
  }

  /**
   * The alarm trips: red lights and a klaxon, and (for the first waves) two
   * hunters are sent after the player — out of the exit lift on the ground
   * floor, up from the stair landing on floor 2 — heading for where the
   * player is now.
   */
  function raiseAlarm(): void {
    stats.alarms++;
    klaxon = sound.loop('klaxon');
    music.stinger('spotted');
    if (!sendsHunters(hunterWaves)) {
      hud.showToast('ALARM RAISED', 'bad');
      return;
    }
    hunterWaves++;
    hud.showToast('ALARM RAISED · HUNTERS INBOUND', 'bad');
    const floor = currentFloor();
    const o = floor.rig.group.position;
    let from: { x: number; z: number };
    if (floor.rig === floor0 && !tower) {
      from = { x: exitLift.spawn.x, z: exitLift.spawn.z };
      // The exit lift opens to let them out, and shuts again unless the job's documents are in.
      setLiftOpen(exitLift, true);
      window.setTimeout(() => {
        if (!exitReady() && !cleared) setLiftOpen(exitLift, false);
      }, 4000);
    } else if (tower) {
      // A tower storey's corner may be a void: they come in at the nearest cell the agent's section of the storey has.
      const dist = bfs(floor.content.navCells, floor.content.cols, floor.content.rows, Math.round((player.worldX - o.x) / CELL), Math.round((player.worldZ - o.z) / CELL));
      let best: { x: number; y: number; d: number } | null = null;
      for (let y = 0; y < dist.length; y++) for (let x = 0; x < dist[y]!.length; x++) {
        if (dist[y]![x]! < 0) continue;
        const d = x * x + y * y;
        if (!best || d < best.d) best = { x, y, d };
      }
      from = best ? { x: o.x + best.x * CELL, z: o.z + best.y * CELL } : { x: o.x, z: o.z };
    } else {
      from = { x: o.x, z: o.z };
    }
    const target = { x: player.worldX, z: player.worldZ };
    for (let i = 0; i < HUNTERS_PER_WAVE; i++) {
      window.setTimeout(() => {
        if (caught || cleared) return;
        const hunter = new Bot(root.scene, from.x + (i - 0.5) * 0.6, from.z, o.x, o.y, o.z, 'hunter');
        floor.content.enemies.push(hunter);
        hunter.investigate(target.x, target.z, 6, floor.content.navCells, floor.content.cols, floor.content.rows, 999);
      }, 600 + i * 900);
    }
  }

  /**
   * Evasion's search: every few seconds each guard on the floor where the agent was last seen (the hunters the alarm sent too, not a sentry, which holds its post) is sent to look,
   * first at the very spot, then at somewhere within SWEEP_CELLS of it. Dogs go on by scent.
   */
  function searchSweep(first: boolean): void {
    const ls = lastSeen;
    if (!ls) return;
    const pair = storeys[Math.min(ls.floor, storeys.length - 1)]!;
    const o = pair.rig.group.position;
    const { navCells, cols: nc, rows: nr } = pair.content;
    const cx = Math.round((ls.x - o.x) / CELL);
    const cy = Math.round((ls.z - o.z) / CELL);
    const dist = bfs(navCells, nc, nr, cx, cy);
    const spots: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) if (dist[y]![x]! >= 0 && dist[y]![x]! <= SWEEP_CELLS) spots.push({ x, y });
    for (const e of pair.content.enemies) {
      if (!(e instanceof Bot) || e.disabled || e.isSentry) continue;
      const s = first || spots.length === 0 ? { x: ls.x, z: ls.z } : (() => { const c = spots[Math.floor(Math.random() * spots.length)]!; return { x: o.x + c.x * CELL, z: o.z + c.y * CELL }; })();
      e.investigate(s.x, s.z, SWEEP_EVERY_S + 2, navCells, nc, nr, 99);
    }
  }

  /** The search ran out with the agent still unseen: the alarm is called off (suspicion falls under the mark) and the hunters it sent go home. */
  function standDown(): void {
    suspicion = Math.min(suspicion, ALARM_OFF - 5);
    hud.setSuspicion(suspicion);
    for (const content of floorContents()) {
      for (const e of content.enemies) {
        if (e instanceof Bot && e.kind === 'hunter' && !e.disabled) {
          e.disabled = true;
          e.mesh.visible = false;
        }
      }
    }
    hud.showToast('THEY’VE STOOD DOWN · THE SEARCH IS CALLED OFF · STAY OUT OF SIGHT', 'good', 4200);
  }

  function clearAlarm(): void {
    klaxon?.stop();
    klaxon = null;
    hud.showToast('ALARM CLEARED', 'good');
  }

  function enterLocker(rig: StaffLockerRig, floor: ActiveFloor): void {
    leaveCover();
    hiddenIn = { rig, floor };
    rig.flap();
    const o = floor.rig.group.position;
    sound.play('lockerOpen', { x: rig.front.x + o.x, y: o.y + 1, z: rig.front.z + o.z }, 0.7);
    // Stand inside it, out of everyone's way.
    player.place((rig.box.minX + rig.box.maxX) / 2 + o.x, (rig.box.minZ + rig.box.maxZ) / 2 + o.z, rig.front.facing);
    player.mesh.visible = false;
    hud.setLockerView(true);
    if (!lockerHintShown) {
      lockerHintShown = true;
      hud.showToast('HIDING · NOTHING CAN SEE OR REACH YOU · MOVE TO STEP OUT', 'neutral');
    }
  }

  function exitLocker(): void {
    if (!hiddenIn) return;
    const { rig, floor } = hiddenIn;
    hiddenIn = null;
    rig.flap();
    const o = floor.rig.group.position;
    player.place(rig.front.x + o.x, rig.front.z + o.z, rig.front.facing);
    player.mesh.visible = true;
    hud.setLockerView(false);
    sound.play('lockerOpen', { x: rig.front.x + o.x, y: o.y + 1, z: rig.front.z + o.z }, 0.5);
  }

  /** Into a vent: the screen goes dark while you crawl, and you come out of the grille on the other side. */
  function enterVent(to: VentRig, floor: ActiveFloor): void {
    leaveCover();
    ventTransit = { left: VENT_S, moved: false, to, floor };
    hud.setFade(true);
    sound.play('vent');
  }

  /**
   * Flips a light switch or breaker. Switching a light off (silent, unlike
   * shooting it) draws the guards nearby to come and switch it back on;
   * cutting a breaker blacks out its whole circuit, and a guard is sent to
   * reset it after BREAKER_DISPATCH_S. A guard putting either back is
   * `byPlayer` false.
   */
  function setFitting(f: PowerFitting, floor: ActiveFloor, on: boolean, byPlayer: boolean): void {
    f.on = on;
    f.rig.setOn(on);
    f.resetting = 0;
    for (const l of f.lamps) {
      if (f.kind === 'switch') l.off = !on;
      else l.cut = !on;
      applyLamp(l);
    }
    const { content, rig } = floor;
    if (f.kind === 'breaker' && content.circuit) {
      for (let y = 0; y < content.rows; y++) for (let x = 0; x < content.cols; x++) if (content.circuit[y]![x] === f.circuit) content.powerCut[y]![x] = !on;
    }
    const where = worldAt(rig, f.rig.front.x, f.rig.front.z, 1.3);
    sound.play(f.kind === 'breaker' ? (on ? 'powerUp' : 'doorOpen') : 'key', where, f.kind === 'breaker' ? 0.9 : 0.6);
    const near = floor.content === currentFloor().content && Math.hypot(where.x - player.worldX, where.z - player.worldZ) < 30;
    if (on) {
      f.reset = 'none';
      if (!byPlayer && (near || f.kind === 'breaker')) {
        hud.showToast(f.kind === 'breaker' ? `A GUARD RESET BREAKER ${f.label} · THE POWER'S BACK` : 'A GUARD SWITCHED THE LIGHT BACK ON', 'bad');
      }
      return;
    }
    if (f.kind === 'breaker') {
      f.reset = 'waiting';
      f.dispatchAt = stats.seconds + BREAKER_DISPATCH_S;
      hud.showToast(`BREAKER ${f.label} CUT · ITS SECTION IS DARK · A GUARD WILL BE SENT TO RESET IT`, 'good', 3600);
      return;
    }
    // Someone nearby notices the light go: they come over to switch it back on.
    let noticed = 0;
    for (const e of content.enemies) {
      if (e instanceof Bot && e.investigate(where.x, where.z, LURE_ALLOWANCE_S, content.navCells, content.cols, content.rows, LIGHT_LURE_CELLS)) noticed++;
    }
    f.reset = noticed ? 'coming' : 'none';
    f.comingSince = stats.seconds;
    hud.showToast(noticed ? 'LIGHT OFF · A GUARD NOTICED AND IS COMING TO SWITCH IT BACK ON' : 'LIGHT OFF', noticed ? 'neutral' : 'good');
  }

  /** Every frame, on the player's floor: sends a guard to a cut breaker once it's time, and lets a guard standing at a switched-off fitting put it back. */
  function tickPower(floor: ActiveFloor, dt: number): void {
    const { content, rig } = floor;
    for (const f of content.fittings) {
      if (f.on) continue;
      const where = worldAt(rig, f.rig.front.x, f.rig.front.z, 0);
      if (f.reset === 'waiting' && stats.seconds >= f.dispatchAt) {
        // The nearest guard that can go (not one in a chase) is sent; if nobody can, it's tried again shortly.
        const guards = content.enemies
          .filter((e): e is Bot => e instanceof Bot && !e.disabled && !e.alert)
          .sort((a, b) => Math.hypot(a.worldX - where.x, a.worldZ - where.z) - Math.hypot(b.worldX - where.x, b.worldZ - where.z));
        const sent = guards.find((g) => g.investigate(where.x, where.z, DISPATCH_ALLOWANCE_S, content.navCells, content.cols, content.rows, 999));
        if (sent) {
          f.reset = 'coming';
          f.comingSince = stats.seconds;
          hud.showToast(`A GUARD IS ON THE WAY TO RESET BREAKER ${f.label}`, 'neutral');
        } else {
          f.dispatchAt = stats.seconds + 5;
        }
      }
      if (f.reset !== 'coming') continue;
      // Nobody made it (drawn into a chase, or knocked out on the way): a breaker sends someone else; a switch just stays off.
      if (stats.seconds - f.comingSince > GIVE_UP_S) {
        f.reset = f.kind === 'breaker' ? 'waiting' : 'none';
        f.dispatchAt = stats.seconds;
        continue;
      }
      // A lured guard walks right up to the spot in front of it.
      const guard = content.enemies.find(
        (e): e is Bot => e instanceof Bot && !e.disabled && !e.alert && Math.hypot(e.worldX - where.x, e.worldZ - where.z) < AT_FITTING
      );
      f.resetting = guard ? f.resetting + dt : 0;
      if (guard && f.resetting >= RESET_TAKES_S) {
        setFitting(f, floor, true, false);
        guard.stopInvestigating(content.navCells, content.cols, content.rows);
      }
    }
  }

  function shootLight(l: FloorContent['lights'][number], at: THREE.Vector3): void {
    const lamp = storeys.flatMap((f) => f.content.lamps).find((m) => m.fixture === l);
    if (lamp) {
      lamp.broken = true;
      applyLamp(lamp);
    } else {
      l.disabled = true;
      l.light.intensity = 0;
      l.light.userData.broken = true;
      (l.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.03;
    }
    bursts.sparks(at);
    sound.play('glass', { x: at.x, y: at.y, z: at.z });
    hud.showToast('LIGHT OUT · BOTS SEE LESS FAR HERE', 'good');
  }

  function knockProp(p: FloorContent['props'][number], floor: ActiveFloor): void {
    p.disabled = true;
    tipping.push({ group: p.group, t: 0 });
    const y = floor.rig.group.position.y;
    sound.play('clatter', { x: p.worldX, y: y + 0.4, z: p.worldZ });
    let drawn = 0;
    for (const e of floor.content.enemies) {
      if (e.investigate?.(p.worldX, p.worldZ, 5, floor.content.navCells, floor.content.cols, floor.content.rows, LURE_CELLS)) drawn++;
    }
    hud.showToast(drawn ? `CLATTER · ${drawn} COMING TO LOOK` : 'CLATTER · NOBODY CLOSE ENOUGH TO HEAR', drawn ? 'good' : 'neutral');
  }

  function enterCover(spot: CoverSpot): void {
    inCover = spot;
    player.place(spot.px, spot.pz, coverFacing(spot));
    lastCoverX = spot.px;
    lastCoverZ = spot.pz;
    sound.play('step', undefined, 0.5);
    if (spot.corner) {
      toastOnce('corner', 'AT THE CORNER · HIDDEN FROM DOWN THE CORRIDOR · FIRE LEANS OUT TO AIM, ANY OTHER KEY DUCKS BACK', 5200);
    } else if (!coverHintShown) {
      coverHintShown = true;
      hud.showToast(spot.box.cover === 'low' ? 'IN COVER · CROUCHED BELOW IT · SLIDE WITH Q/E · FIRE LEANS OUT TO AIM · MOVE OFF TO LEAVE' : 'IN COVER · SLIDE WITH Q/E · FIRE LEANS OUT TO AIM · MOVE OFF TO LEAVE', 'neutral');
    }
  }

  function leaveCover(): void {
    inCover = null;
    setAiming(false);
  }

  /**
   * Leans out of cover to aim, or ducks back. Aiming puts the camera behind the shoulder with a crosshair in the middle; the stick (or A/D, or the mouse) steers it, Fire shoots
   * along it. While it's up the agent is out in the open: the furniture no longer hides a crouch from the guards.
   */
  function setAiming(on: boolean): void {
    const perched = perchLike();
    if (on && ((aloft && !perched) || hiddenIn || ventTransit || cleared || caught || stashing || carried || arrivalPhase !== 'done')) return;
    if (fpsOn() && !on && !(caught || cleared || aloft || hiddenIn || ventTransit || stashing || carried)) return; // (the FPS view stays up)
    if (aiming === on) return;
    aiming = on;
    // On the platform the agent lies flat to aim, and gets up again after.
    if (on && perched) {
      perchPosture = postureState;
      postureState = { posture: 'prone', dir: 'down', at: stats.seconds };
    } else if (!on && perchPosture) {
      postureState = perchPosture;
      perchPosture = null;
    }
    if (on) aimsBegun++;
    aimBase = player.facingAngle; // (away from cover and platform: the crosshair swings from the way the agent faces now)
    aimYaw = 0;
    aimMouse = 0;
    aimMouseY = 0;
    // From a platform the aim starts tilted down toward the floor; everywhere else it is level.
    aimPitch = on && perched ? PERCH_AIM_START_PITCH : 0;
    player.aimPitch = aimPitch;
    player.aimGoal = on ? 1 : 0;
    hud.setCrosshair(on, null);
    if (on) {
      sound.play('step', undefined, 0.4);
      // A mouse is steered, not clicked at: take it over the view if the page lets us.
      if (!document.body.classList.contains('touch-ui')) {
        try {
          const lock = (canvas.requestPointerLock as () => unknown)?.call(canvas);
          if (lock instanceof Promise) lock.catch(() => undefined);
        } catch {
          // no pointer lock here: the mouse still steers, up to the window's edge
        }
      }
      if (perched) toastOnce('perchtilt', 'W AND S (OR THE STICK, OR THE MOUSE) TILT THE AIM · YOU CAN ONLY HIT WHAT YOU CAN SEE FROM UP HERE', 5200);
      if (!inCover && !perched) toastOnce('freeaim', 'AIMING · A AND D (OR THE MOUSE) SWING THE CROSSHAIR, W AND S TILT IT, FIRE SHOOTS · AIM AGAIN TO LOWER THE GUN', 5200);
      else if (inCover && inCover.box.cover !== 'low' && !aimHintShown) {
        aimHintShown = true;
        hud.showToast('TALL COVER BLOCKS THE SHOT · SLIDE PAST ITS END TO LEAN OUT', 'neutral', 4200);
      }
    } else if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  /** Duck behind cover with the posture key or touch button; release backward input before exiting. */
  function duck(): void {
    setAiming(false);
    duckLatch = true;
  }

  function toggleAim(): void {
    setAiming(!aiming); // (anywhere: not only from cover)
  }

  /** What to do about a watchdog: it hunts by ear, so the answers are quiet, or a lure, or a trap, or a charge. */
  function dogHint(): string {
    const emp = empCharges > 0 ? `EMP IT (${empCharges} LEFT)` : 'A STUN SLOWS IT';
    return `WATCHDOG NEARBY · IT HEARS, NOT SEES: A MARKER, A PING AND A RED EDGE SHOW WHERE IT IS · STAND STILL OR SNEAK OFF, LURE IT WITH A FLARE, ROLL A TRAP INTO ITS PATH, OR ${emp}`;
  }

  /** Says `text` the first time `key` comes up this job. */
  function toastOnce(key: string, text: string, ms = 5200): void {
    if (onceToasts.has(key)) return;
    onceToasts.add(key);
    hud.showToast(text, 'neutral', ms);
  }

  /** Up tower `tower`'s ladder: out of cover, and whatever was being worked on left. */
  function startClimb(tower: number, floor: ActiveFloor): void {
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    aloft = { kind: 'climb', floor, tower, t: 0, up: true };
    sound.play('vent', undefined, 0.5);
  }

  /** From the platform up onto the pipe overhead, along whichever way it runs nearest where the agent faces. */
  function grabPipe(): void {
    if (aloft?.kind !== 'perch') return;
    const grip = gripAtTower(aloft.floor.content.pipes!, aloft.tower, { x: Math.sin(aloft.angle), z: Math.cos(aloft.angle) }, CELL);
    if (!grip) return;
    aloft = { kind: 'hang', floor: aloft.floor, tower: aloft.tower, grip, angle: aloft.angle, lift: 0, back: false, travel: 0, turned: true };
    sound.play('drag', undefined, 0.5);
    toastOnce('hang', 'HANGING · FORWARD AND BACK TO SHIMMY · TURN WHERE PIPES CROSS · FIRE DROPS ONTO A GUARD BELOW FOR A TAKEDOWN BONUS', 6500);
  }

  // ---- the grapple (grapple.ts) ----

  /** The line and hook: a thin cord from the pipe to the agent's hands while hauling up, and the hook stays on the pipe after. */
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 10, Math.PI * 1.5), new THREE.MeshBasicMaterial({ color: 0x2a2a2a }));
  rope.visible = false;
  hook.visible = false;
  rope.frustumCulled = false;
  root.scene.add(rope, hook);
  const ROPE_UP = new THREE.Vector3(0, 1, 0);

  /** Draws the line from `top` (the hook) down to `bottom` (the hands), or hides it. */
  function drawRope(top: THREE.Vector3 | null, bottom: THREE.Vector3 | null): void {
    hook.visible = top !== null;
    rope.visible = top !== null && bottom !== null;
    if (!top) return;
    hook.position.copy(top);
    hook.rotation.set(Math.PI / 2, 0, 0);
    if (!bottom) return;
    const dir = new THREE.Vector3().subVectors(top, bottom);
    const len = dir.length();
    if (len < 0.01) return;
    rope.position.copy(bottom).addScaledVector(dir, 0.5);
    rope.scale.set(1, len, 1);
    rope.quaternion.setFromUnitVectors(ROPE_UP, dir.normalize());
  }

  /** Fires the grapple: at the pipe overhead nearest where the agent faces, if there's one in reach and the arms are up to it. */
  /** The shaft the agent is standing at the foot of (the lane's cell at the end of a duct), if any. */
  function shaftHere(): Shaft | null {
    return BUNKER_SHAFTS.find((s) => s.level === activeFloorIdx && Math.hypot(player.worldX - s.x * CELL, player.worldZ - s.y * CELL) < 1.3) ?? null;
  }
  const SHAFT_S = 3.4;
  const BUNKER_FADE_RADIUS = 14;
  /** Up a shaft on the grapple's line: hand over hand to the duct on the next storey, which the agent comes out of crouched. */
  function tickShaft(a: Extract<Aloft, { kind: 'shaft' }>, dt: number): void {
    a.t = Math.min(SHAFT_S, a.t + dt);
    const k = a.t / SHAFT_S;
    const e = k * k * (3 - 2 * k);
    const base = a.shaft.level * floorHeight;
    const top = base + floorHeight;
    const x = a.shaft.x * CELL;
    const z = a.shaft.y * CELL;
    const hands = base + 1.7 + (top + 0.75 - (base + 1.7)) * e;
    strength = Math.max(0, strength - (0.28 * dt) / SHAFT_S);
    player.hold(x, hands - player.hangDrop, z, a.angle, 'hang', dt, k * 8);
    drawRope(new THREE.Vector3(x, top + 1.35, z), new THREE.Vector3(x, hands, z));
    if (a.t < SHAFT_S) return;
    drawRope(null, null);
    player.place(x, z, a.angle, top);
    postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
    hud.setPosture('crouch', nextPosture(postureState, stats.seconds));
    touch.setPosture('crouch');
    aloft = null;
    sound.play('drag', undefined, 0.5);
    hud.showToast(`${(BUNKER_LEVEL_NAMES[a.shaft.level + 1] ?? 'THE NEXT FLOOR').toUpperCase()} · CRAWL ON`, 'good', 3200);
  }

  function handleGrapple(): void {
    if (proneBlocks()) return;
    if (cleared || caught || paused()) return;
    // Already on a line: the same key lowers the agent to hover just above the floor, and hauls back up.
    if (aloft?.kind === 'hang' && aloft.hooked && aloft.lift >= 1 && !aloft.back) {
      if (aloft.lowering) {
        aloft.lowering = false;
        activeHack = null;
        activeTask = null;
        hud.setHack(null);
        sound.play('drag', undefined, 0.5);
        return;
      }
      const o = aloft.floor.rig.group.position;
      const spot = pointOnLine(aloft.floor.content.pipes!, aloft.grip.line, aloft.grip.along, CELL);
      if (!canLand(aloft.floor, spot.x + o.x, spot.z + o.z, true)) {
        sound.play('denied');
        hud.showToast('NOWHERE TO LOWER YOURSELF · A WALL OR A LOCKED SECTION BELOW', 'neutral');
        return;
      }
      aloft.lowering = true;
      if (!training) reportTry({ kind: 'grapple', use: 'hover' });
      sound.play('drag', undefined, 0.5);
      toastOnce('hover', 'HOVERING · GUARDS AND DOGS BELOW CAN’T SEE OR HEAR YOU · WORK THE CONSOLE UNDER YOU · FIRE DROPS ON AN UNAWARE GUARD · U HAULS YOU UP', 7000);
      return;
    }
    if (aloft?.kind === 'highwall' && aloft.phase === 'hang') {
      startCross(aloft);
      return;
    }
    if (aloft || hiddenIn || ventTransit || handsFull() || inCover) return;
    if (bunker) {
      const shaft = shaftHere();
      if (!shaft) {
        hud.showToast('NOTHING TO HOOK · THE GRAPPLE CLIMBS A DUCT’S SHAFT: CRAWL TO THE END OF A DUCT THAT HAS ONE', 'neutral');
        return;
      }
      if (strength < MIN_TO_HOOK) {
        sound.play('denied');
        hud.showToast('TOO WINDED TO PULL YOURSELF UP · CATCH YOUR BREATH', 'bad');
        return;
      }
      leaveCover();
      activeHack = null;
      activeTask = null;
      hud.setHack(null);
      aloft = { kind: 'shaft', floor: currentFloor(), shaft, t: 0, angle: player.facingAngle };
      sound.play('drag', undefined, 0.7);
      toastOnce('shaft-up', 'UP THE SHAFT · NOBODY CAN SEE OR HEAR YOU IN IT · CRAWL OUT OF THE DUCT AT THE TOP', 6000);
      return;
    }
    if (tower) {
      hud.showToast('NO GRAPPLE POINTS IN THE TOWER · CLIMB THE WALLS OR TAKE THE STAIRS', 'neutral');
      return;
    }
    const floor = currentFloor();
    const plan = floor.content.pipes;
    if (!plan || !floor.content.pipeRig) {
      hud.showToast('NO PIPES OVERHEAD TO HOOK ON THIS FLOOR', 'neutral');
      return;
    }
    if (strength < MIN_TO_HOOK) {
      sound.play('denied');
      hud.showToast('TOO WINDED TO PULL YOURSELF UP · CATCH YOUR BREATH', 'bad');
      return;
    }
    const o = floor.rig.group.position;
    const lx = player.worldX - o.x;
    const lz = player.worldZ - o.z;
    const hit = hookPoint(plan, lx, lz, { x: Math.sin(player.facingAngle), z: Math.cos(player.facingAngle) }, CELL, HOOK_RANGE);
    if (!hit) {
      sound.play('denied');
      hud.showToast('NOTHING TO HOOK · FACE A PIPE OVERHEAD', 'neutral');
      return;
    }
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    if (!training) reportTry({ kind: 'grapple', use: 'hook' });
    aloft = { kind: 'haul', floor, grip: hit.grip, from: { x: player.worldX, y: player.worldY, z: player.worldZ }, angle: player.facingAngle, t: 0 };
    sound.play('drag', undefined, 0.7);
    toastOnce('grapple', 'ON THE LINE · GUARDS AND DOGS CAN’T SEE OR HEAR YOU UP HERE, BUT YOUR ARMS TIRE: WATCH THE SWEAT. FIRE DROPS ON AN UNAWARE GUARD BELOW', 7000);
  }

  /** The grip gives out: down onto the nearest floor that's clear, hard, on nobody. */
  function exhaustedFall(a: Extract<Aloft, { kind: 'hang' }>): void {
    const { floor } = a;
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    let to = { x: from.x, z: from.z };
    search: for (let r = 0; r <= CELL * 3; r += CELL / 4) {
      for (let k = 0; k < (r === 0 ? 1 : 12); k++) {
        const ang = (k / 12) * Math.PI * 2;
        const spot = { x: from.x + Math.sin(ang) * r, z: from.z + Math.cos(ang) * r };
        if (!collides(spot.x, spot.z, floor.rig.wallBoxes) && canLand(floor, spot.x, spot.z, true)) {
          to = spot;
          break search;
        }
      }
    }
    if (!training) reportTry({ kind: 'grapple', use: 'fall' });
    aloft = { kind: 'fall', floor, from, to, angle: a.angle, t: 0, target: null, hard: true };
    hud.showToast('YOUR GRIP GAVE OUT', 'bad', 2600);
  }

  /** From a tower's platform, back down its ladder. */
  function climbDown(): void {
    if (aloft?.kind !== 'perch') return;
    aloft = { kind: 'climb', floor: aloft.floor, tower: aloft.tower, t: 0, up: false, from: aloft.angle };
    sound.play('vent', undefined, 0.5);
  }

  /** On a tower's platform, whether the agent faces the ladder (the way back down) rather than out over the corridor. */
  function facingLadder(perch: Extract<Aloft, { kind: 'perch' }>): boolean {
    const c = perch.floor.content.pipeRig!.towers[perch.tower]!;
    return Math.abs(angleTo(perch.angle, Math.atan2(c.rungs.x - c.top.x, c.rungs.z - c.top.z))) < LADDER_FACING;
  }

  /** Over a tower: back down onto its platform. */
  function backToPlatform(): void {
    if (aloft?.kind !== 'hang') return;
    const plan = aloft.floor.content.pipes!;
    const i = towerUnder(plan, aloft.grip, CELL);
    if (i < 0) return;
    const line = plan.lines[aloft.grip.line]!;
    const t = plan.towers[i]!;
    aloft.tower = i;
    aloft.grip = { ...aloft.grip, along: ((line.axis === 'x' ? t.x : t.y) - line.from) * CELL };
    aloft.back = true;
  }

  /** Each floor's cells reachable from its start, over its corridors (doors counted as open): where a drop can land and still get out. */
  const reachable = new Map<FloorContent, number[][]>();

  /** Whether there's floor to land on under (x, z) (world): not a wall, and not a section still locked. Says why not. */
  function canLand(floor: ActiveFloor, x: number, z: number, quiet = false): boolean {
    const say = (text: string): void => {
      if (!quiet) hud.showToast(text, 'neutral');
    };
    const o = floor.rig.group.position;
    const cx = Math.round((x - o.x) / CELL);
    const cy = Math.round((z - o.z) / CELL);
    const section = floor.content.section[cy]?.[cx];
    if (section === undefined || collides(x, z, floor.rig.wallBoxes)) {
      say('A WALL BELOW · SHIMMY CLEAR OF IT TO DROP');
      return false;
    }
    // Walled-off cells (the solid blocks between rooms, a hand-drawn floor's sealed corners) have no way out: land only where there's a way back to the start.
    let reach = reachable.get(floor.content);
    if (!reach) {
      // (From the first open cell: a tower's floors are drawn in a shape, and the corner (0, 0) is often not floor at all, which left no landing anywhere on a floor like the lab's.)
      let from = { x: 0, y: 0 };
      if (tower || bunker) {
        const open = (x: number, y: number): boolean => {
          const c = floor.content.cells[y]?.[x];
          return !!c && (c.N || c.S || c.E || c.W);
        };
        search: for (let y = 0; y < floor.content.rows; y++) for (let x = 0; x < floor.content.cols; x++) if (open(x, y)) { from = { x, y }; break search; }
      }
      reach = bfs(floor.content.cells, floor.content.cols, floor.content.rows, from.x, from.y);
      reachable.set(floor.content, reach);
    }
    // (The wall course is sealed by its walls on purpose: climbing is the way past them.)
    if (!wall && (reach[cy]?.[cx] ?? -1) < 0) {
      say('NOTHING BELOW BUT A SEALED-OFF ROOM · SHIMMY ON');
      return false;
    }
    // A locked section isn't closed to the grapple: it goes over the doors, and the door opens from the inside.
    return true;
  }

  /** Whether the agent is lowered right down on the line (hovering over what they work). */
  const hovering = (): boolean => aloft?.kind === 'hang' && (aloft.low ?? 0) >= 1;

  /** A free spot to land near `from` (world): the console's standing spot first (it is always clear), then rings out from where they hang, clear of the furniture they hover over. */
  function landingNear(floor: ActiveFloor, from: { x: number; z: number }, stand?: Spot): { x: number; z: number } | null {
    const o = floor.rig.group.position;
    const tries: Array<{ x: number; z: number }> = [];
    if (stand) tries.push({ x: stand.x + o.x, z: stand.z + o.z });
    for (const r of [0.6, 1.0, 1.4, 1.9]) for (let i = 0; i < 10; i++) tries.push({ x: from.x + Math.cos((i * Math.PI) / 5) * r, z: from.z + Math.sin((i * Math.PI) / 5) * r });
    return tries.find((t) => canLand(floor, t.x, t.z, true)) ?? null;
  }

  /** Letting go of the pipe: onto the unaware guard below if there is one, otherwise straight down. */
  function letGo(): void {
    if (aloft?.kind !== 'hang' || aloft.lift < 1 || aloft.back) return;
    const { floor } = aloft;
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    const target = aerialTarget && !aerialTarget.disabled ? aerialTarget : null;
    let to = { x: from.x, z: from.z };
    let angle = aloft.angle;
    if (target) {
      // Onto its back: landing just short of its centre, facing it.
      const d = Math.hypot(target.worldX - from.x, target.worldZ - from.z);
      const k = d > AERIAL_LAND ? (d - AERIAL_LAND) / d : 0;
      const spot = { x: from.x + (target.worldX - from.x) * k, z: from.z + (target.worldZ - from.z) * k };
      if (!collides(spot.x, spot.z, floor.rig.wallBoxes)) to = spot;
      if (d > 0.05) angle = Math.atan2(target.worldX - from.x, target.worldZ - from.z);
    }
    if (!canLand(floor, to.x, to.z, true)) {
      // Hanging over a console or a desk there is no floor right below: land beside it (a pulse coming down the pipe is no time to be told "a wall below").
      const near = landingNear(floor, from, aloft.aimAt);
      if (!near) {
        canLand(floor, to.x, to.z);
        return;
      }
      to = near;
    }
    aloft = { kind: 'fall', floor, from, to, angle, t: 0, target };
  }

  /** Down on the floor: the guard under you taken out, or a thud the guards nearby come to see about. */
  function land(fall: Extract<Aloft, { kind: 'fall' }>): void {
    const { floor, to, target: e } = fall;
    const floorY = floor.rig.group.position.y;
    player.place(to.x, to.z, fall.angle, floorY);
    if (!fall.settled) player.land(fall.soft ? 0.95 : undefined, fall.soft);
    if (fall.crouch) {
      postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
      hud.setPosture('crouch', nextPosture(postureState, stats.seconds));
      touch.setPosture('crouch');
    }
    aloft = null;
    drawRope(null, null);
    // From the tall wall's second shelf the drop is the end of the guard, and not a quiet one: the guards near come to see what fell.
    const fatal = fall.from.y - floorY >= FATAL_FALL_M;
    if (e && !e.disabled && e.hit('takedown') === 'disabled') {
      aerialTakedowns++;
      if (!training) reportTry({ kind: 'grapple', use: 'drop' });
      stats.takedowns++;
      stats.botsStunned++;
      score += AERIAL_BONUS;
      hud.setScore(score);
      fireCooldown = TAKEDOWN_COOLDOWN_S;
      sound.play('takedown', { x: e.worldX, y: e.floorY + 1, z: e.worldZ });
      player.shake(fatal ? 0.9 : 0.6);
      if (fatal) {
        sound.play('stash', { x: to.x, y: floorY + 0.2, z: to.z });
        const { navCells, cols, rows } = floor.content;
        for (const b of floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(to.x, to.z, 4, navCells, cols, rows, DROP_HEARD_CELLS * 2);
        hud.showToast(`FATAL DROP · HE DID NOT GET UP · THE THUD CARRIES · +${AERIAL_BONUS}`, 'good', 4200);
        return;
      }
      hud.showToast(`DEATH FROM ABOVE · TAKEDOWN +${AERIAL_BONUS}`, 'good', 3200);
      return;
    }
    sound.play('stash', { x: to.x, y: floorY + 0.2, z: to.z });
    player.shake(fall.hard ? 0.9 : 0.3);
    const { navCells, cols, rows } = floor.content;
    if (fall.hard) {
      // Out of strength, the thud carries: everything nearby, dogs included, comes to see, and it's not quiet on the suspicion.
      sound.play('hurt');
      hud.pulseDanger();
      for (const b of floor.content.enemies) if (!b.disabled) b.investigate?.(to.x, to.z, 4, navCells, cols, rows, DROP_HEARD_CELLS * 3);
      suspicion = applySuspicion(suspicion, HARD_LAND_SUSPICION);
      hud.setSuspicion(suspicion);
      hud.showToast(`YOU HIT THE FLOOR HARD · SUSPICION +${HARD_LAND_SUSPICION}%`, 'bad');
      if (isCaught(suspicion)) triggerCaught("You've been spotted", 'You dropped out of the ceiling in front of the guards.');
      return;
    }
    for (const b of floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(to.x, to.z, 3, navCells, cols, rows, DROP_HEARD_CELLS);
  }

  // ---- climbing a maze wall (wallclimb.ts): a dash that ends against one goes up it, over the top, and lies flat along it ----

  /** Lying on a tower's platform, or flat along a wall's top: the places the agent aims and shoots from lying down, over the walls. */
  const perchLike = (): boolean => aloft?.kind === 'perch' || (aloft?.kind === 'wall' && aloft.phase === 'lie');

  /** Whether the agent lies along a wall top: undetectable to guards and dogs (not to drones, which fly over the walls). */
  const onWallTop = (): boolean => aloft?.kind === 'wall' && aloft.phase === 'lie';

  /** The metres the dash has carried the agent since it began, for "some distance" of run-up. */
  let dashRun = 0;
  let dashLast = { x: 0, z: 0 };

  /** Up the face of `contact`: out of cover, whatever was being worked on left, and the thump of the landing against the wall heard by the guards close by. */
  function startWallClimb(floor: ActiveFloor, contact: WallContact): void {
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    const along = contact.run === 'x' ? player.worldX : player.worldZ;
    const dir = lieDirection(contact, along, 0);
    const rise = riseNeeded(WALL_H + WALL_CAP);
    dashState = { ...dashState, active: false, spent: true };
    dashRun = 0;
    aloft = { kind: 'wall', top: WALL_H + WALL_CAP, floor, phase: 'climb', contact, along, dir, rise, t: 0, lie: { x: 0, y: 0, z: 0 }, hips: { x: 0, z: 0 }, back: 0, yaw: 0, lieLeft: WALL_LIE_S, downFrom: 0, roll: null };
    sound.play('stash', { x: player.worldX, y: floor.rig.group.position.y + 0.5, z: player.worldZ }, 0.8);
    const { navCells, cols, rows } = floor.content;
    for (const b of floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(player.worldX, player.worldZ, 2, navCells, cols, rows, WALL_THUMP_CELLS);
    toastOnce('wall', 'UP THE WALL · YOU LIE FLAT ALONG THE TOP: GUARDS AND DOGS CAN’T SEE OR HEAR YOU, BUT A DRONE CAN · FIRE AIMS · BACK CLIMBS DOWN THE SIDE YOU CAME UP · INTERACT JUMPS OFF OR DROPS ON A GUARD BELOW', 8000);
  }

  /** Dashing at a cargo container: up its face (the wall run), and the agent stands on the roof (not lying along it, as on a wall). Walking off any edge is the way down. */
  function startRoofClimb(floor: ActiveFloor, contact: WallContact): void {
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    const top = contact.roof!;
    const along = contact.run === 'x' ? player.worldX : player.worldZ;
    dashState = { ...dashState, active: false, spent: true };
    dashRun = 0;
    aloft = { kind: 'wall', roof: true, top, floor, phase: 'climb', contact, along, dir: lieDirection(contact, along, 0), rise: riseNeeded(top), t: 0, lie: { x: 0, y: 0, z: 0 }, hips: { x: 0, z: 0 }, back: 0, yaw: 0, lieLeft: WALL_LIE_S, downFrom: 0, roll: null };
    sound.play('stash', { x: player.worldX, y: floor.rig.group.position.y + 0.5, z: player.worldZ }, 0.8);
    const { navCells, cols, rows } = floor.content;
    for (const b of floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(player.worldX, player.worldZ, 2, navCells, cols, rows, WALL_THUMP_CELLS);
    toastOnce('roof', 'UP A CONTAINER · WALK ALONG THE ROOF, OVER THE NEXT ONES: A GUARD BELOW CAN SEE YOU UP THERE, AND SHOOT · STEP OFF AN EDGE TO DROP', 7000);
  }

  /** Dashing at a wall: the one in front of the agent, if it's a maze wall they ran up to, with a way down on at least one side of it. */
  function tryWallClimb(floor: ActiveFloor, dashing: boolean): void {
    if (dashing) {
      dashRun += Math.hypot(player.worldX - dashLast.x, player.worldZ - dashLast.z);
    } else dashRun = 0;
    dashLast = { x: player.worldX, z: player.worldZ };
    if (!dashing || dashRun < MIN_RUN_UP || aloft || inCover || hiddenIn || ventTransit || stashing || handsFull() || arrivalPhase !== 'done' || cleared || caught) return;
    const contact = wallContact(floor.rig.climbBoxes, player.worldX, player.worldZ, player.facingAngle);
    if (!contact) return;
    if (contact.roof !== undefined) {
      startRoofClimb(floor, contact);
      return;
    }
    // A tall wall wants a longer run than an ordinary one; a dash that is too short for it says so (once).
    if (contact.high && dashRun < HIGH_RUN_UP) {
      toastOnce('runup', 'TOO CLOSE TO RUN UP THE WALL · BACK OFF A FEW METRES AND DASH AT IT', 4000);
      return;
    }
    if (contact.high) {
      startHighClimb(floor, contact);
      return;
    }
    const along = contact.run === 'x' ? player.worldX : player.worldZ;
    const down = rollSides(contact, along, WALL_ROLL_REACH).some((s) => canLand(floor, s.x, s.z, true));
    if (!down) return;
    startWallClimb(floor, contact);
  }

  /** Over the edge: the side the agent picks (the way they're pushing, or the guard they're dropping on; else the side they came up), then the roll. */
  function startWallRoll(drop: boolean): void {
    const a = aloft;
    if (a?.kind !== 'wall' || a.phase !== 'lie') return;
    const sides = rollSides(a.contact, a.along, WALL_ROLL_REACH);
    const top = topPoint(a.contact, a.along);
    const target = drop && aerialTarget && !aerialTarget.disabled ? aerialTarget : null;
    // (In the wall course the roll goes over to the far side unless the agent pushes the other way: the lesson is getting past the wall. On a job it's back down the side they came up.)
    const far = [sides[1]!, sides[0]!];
    let order = wall ? far : sides;
    if (target) {
      const toward = (target.worldX - top.x) * a.contact.nx + (target.worldZ - top.z) * a.contact.nz;
      order = toward >= 0 ? sides : far;
    } else {
      // Pushing left or right (across the wall) picks the side: toward the agent's right, or their left.
      const push = clampAxis(keyboard.getInput().strafe + touch.getInput().strafe);
      if (Math.abs(push) > 0.3) {
        const f = runAngle(a.contact, a.dir) + Math.round(a.yaw / Math.PI) * Math.PI;
        const toward = (sides[0]!.nx * -Math.cos(f) + sides[0]!.nz * Math.sin(f)) * push; // (the agent's right is (-cos, sin) of its facing, in this game's turn)
        order = toward < 0 ? far : sides;
      }
    }
    const side = order.find((sd) => canLand(a.floor, sd.x, sd.z, true));
    if (!side) {
      hud.showToast('NOWHERE TO COME DOWN · A WALL OR A LOCKED SECTION BELOW BOTH SIDES', 'neutral');
      return;
    }
    if (aiming) setAiming(false);
    a.phase = 'roll';
    a.t = 0;
    a.roll = { side, target };
    wallRolls++;
    sound.play('drag', undefined, 0.5);
  }

  /** From lying on a wall's top: climb back down the side that was climbed, if there is floor to stand on at the bottom of it. */
  function startWallDown(): void {
    const a = aloft;
    if (a?.kind !== 'wall' || a.phase !== 'lie') return;
    const at = faceStand(a.contact, a.along, CLIMB.startOff);
    if (!canLand(a.floor, at.x, at.z, true)) {
      toastOnce('wall-down-blocked', 'NOWHERE TO CLIMB DOWN · SOMETHING STANDS AT THE FOOT OF THE WALL ON THE SIDE YOU CAME UP · JUMP OFF THE OTHER WAY, OR WAIT', 3200);
      return;
    }
    if (aiming) setAiming(false);
    a.downFrom = runAngle(a.contact, a.dir) + a.yaw;
    a.phase = 'down';
    a.t = 0;
    player.snapProne(false);
    wallRolls++; // (down by the climb counts as getting down for the lesson)
    sound.play('drag', undefined, 0.4);
  }

  /** A frame on a wall: going up it and over, lying along the top, climbing back down, or jumping off it. */
  function tickWall(a: Extract<Aloft, { kind: 'wall' }>, dt: number, turnIn: number, throttleIn: number): void {
    const o = a.floor.rig.group.position;
    const floorY = o.y;
    const c = a.contact;
    const top = topPoint(c, a.along);
    const topY = floorY + a.top;
    if (a.phase === 'climb' || a.phase === 'down') {
      // Up the face, or back down it: the same timeline, played backwards (from lying flat on the top to standing on the floor again).
      const down = a.phase === 'down';
      // Up onto a container's roof: past the run up the face, the pull-up is Braced Hang To Crouch (the highwall's top), ending crouched on the roof where the climb leaves them: not the wall top's
      // crawl onto the belly, which stood up again a moment later.
      if (!down && a.roof && a.t >= CLIMB.popS) {
        if (a.mountHips === undefined) {
          a.mountHips = player.hipsPosition().y - floorY;
          a.mountRoot = player.worldY - floorY;
        }
        a.t += dt;
        const pk = Math.min(1, (a.t - CLIMB.popS) / MOUNT_S);
        const ease = pk * pk * (3 - 2 * pk);
        const settle = Math.min(1, Math.max(0, (pk - 0.72) / 0.28));
        const hipsPath = a.mountHips + (a.top + CROUCH_HIPS - a.mountHips) * ease;
        const sm = (lo: number, hi: number, v: number): number => {
          const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
          return x * x * (3 - 2 * x);
        };
        // out from the face at the start of the pull, then in over the roof to a step in from the edge (where the agent is put, below)
        const at = faceStand(c, a.along, CLIMB.popOff + (-1.1 - CLIMB.popOff) * sm(0.4, 1, pk));
        const edge = faceStand(c, a.along, 0);
        const run = c.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
        const hand = (k: number) => ({ x: edge.x + run.x * k, y: topY - 0.03, z: edge.z + run.z * k });
        const grip = mountGrip(pk);
        const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: 'HangMount', time: Math.min(pk, 0.999) * MOUNT_CLIP_S, weight: 1 - settle }];
        if (settle > 0) layers.push({ clip: 'CrouchIdle', time: 0.4, weight: settle });
        let y = floorY + (a.mountRoot ?? 0) + (hipsPath - a.mountHips);
        for (let pass = 0; pass < 2; pass++) {
          player.holdWall(layers, at.x, y, at.z, faceAngle(c), dt * (pass === 0 ? 0 : 1), null, { hands: { right: hand(0.16), left: hand(-0.16), w: grip } });
          if (pass === 0) y += floorY + hipsPath - player.hipsPosition().y;
        }
        if (pk >= 1) {
          // Stood up on the roof, crouched, a step in from the edge; the height field (roofStairs) holds them there from now on.
          player.place(at.x, at.z, faceAngle(c), topY);
          postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
          hud.setPosture('crouch', nextPosture(postureState, stats.seconds));
          touch.setPosture('crouch');
          roofY = topY;
          aloft = null;
          wallTops++;
        }
        return;
      }
      a.t += dt;
      const total = CLIMB.popS + CLIMB.ledgeS + CLIMB.mountS;
      const p = poseAt(down ? Math.max(0, total - a.t) : a.t, a.rise);
      const stand = faceStand(c, a.along, p.off);
      const face = faceAngle(c);
      let angle = face + angleTo(face, runAngle(c, a.dir)) * p.turn;
      if (down) angle += angleTo(angle, a.downFrom) * Math.max(0, 1 - a.t / 0.25); // (from the way it lay)
      const mounting = p.phase === 'mount' || p.phase === 'done';
      // The run up the face: the two hands a hand's width apart along the top, the feet flat on the face a step apart (the agent's right is (-cos, sin) of its facing).
      const run = c.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const hand = (k: number) => ({ x: top.x + run.x * k, y: topY, z: top.z + run.z * k });
      const rx = -Math.cos(angle);
      const rz = Math.sin(angle);
      const faceOff = c.thick / 2 + 0.09; // (the ankle stands this far off the face: the sole is flat on it)
      const foot = (st: { h: number; w: number }, k: number) => ({ x: top.x + c.nx * faceOff + rx * k, y: floorY + st.h, z: top.z + c.nz * faceOff + rz * k, w: st.w });
      const limbs = { hands: { right: hand(0.16), left: hand(-0.16), w: p.reachW }, feet: { right: foot(p.steps.right, 0.14), left: foot(p.steps.left, -0.14) } };
      player.holdWall(
        p.layers,
        stand.x,
        floorY + p.rise,
        stand.z,
        angle,
        dt,
        mounting ? { hands: { x: top.x, y: topY, z: top.z }, settle: p.settle, centre: { x: top.x, z: top.z }, normal: { x: c.nx, z: c.nz } } : null,
        limbs
      );
      if (down && a.t >= total) {
        const floorAt = faceStand(c, a.along, CLIMB.startOff);
        player.place(floorAt.x, floorAt.z, face, floorY);
        postureState = STANDING;
        aloft = null;
        return;
      }
      if (!down && p.phase === 'done') {
        a.phase = 'lie';
        wallTops++;
        a.lie = { x: player.worldX, y: topY, z: player.worldZ };
        // The body turns about its hips (so it stays centred on the wall's line however it turns to aim): note where they are and how far the root is ahead of them.
        const hips = player.hipsPosition();
        const f0 = runAngle(c, a.dir);
        a.hips = { x: hips.x, z: hips.z };
        a.back = (player.worldX - hips.x) * Math.sin(f0) + (player.worldZ - hips.z) * Math.cos(f0);
        a.yaw = 0;
        player.snapProne(true);
        postureState = { posture: 'prone', dir: 'down', at: stats.seconds };
        aimPitch = 0;
      }
      return;
    }
    if (a.phase === 'lie') {
      a.lieLeft -= dt;
      if (aiming) {
        const sens = (controlSettings.turn / DEFAULT_CONTROLS.turn) * controlSettings.aim;
        a.yaw -= aimInput(turnIn, onTouch(), controlSettings.aim) * AIM_TURN_RATE * dt + aimMouse * AIM_MOUSE_RAD * sens;
        // W and S, the stick's up and down, or the mouse's, tilt it: up tilts up.
        aimPitch = Math.max(PERCH_AIM_MIN_PITCH, Math.min(PERCH_AIM_MAX_PITCH, aimPitch + aimInput(throttleIn, onTouch(), controlSettings.aim) * PERCH_AIM_PITCH_RATE * dt - aimMouseY * AIM_MOUSE_RAD * sens));
        aimMouse = 0;
        aimMouseY = 0;
        player.aimWalls = [];
      } else a.yaw -= turnIn * PERCH_TURN_SPEED * dt;
      const lying = runAngle(c, a.dir) + a.yaw;
      player.hold(a.hips.x + Math.sin(lying) * a.back, a.lie.y, a.hips.z + Math.cos(lying) * a.back, lying, 'perch', dt);
      player.aimPitch = aiming ? aimPitch : 0;
      if (aiming) showCrosshair(a.floor);
      if (a.lieLeft < WALL_WARN_S && a.lieLeft + dt >= WALL_WARN_S) {
        sound.play('beep', undefined, 0.6);
        hud.showToast('YOUR ARMS ARE TIRING · JUMP OFF BEFORE YOU SLIP', 'bad', 2600);
      }
      if (a.lieLeft <= 0) startWallRoll(false);
      // Back, with the gun down: climb down the way up (the climb played backwards).
      if (!aiming && throttleIn < -0.5) startWallDown();
      return;
    }
    // Off the top: up from lying into a crouch on the cap (the lying pose fading into Jump_Start's crouch, turning to face the drop), then the push-off (Jump_Start's take-off) out over the edge,
    // and the fall takes it from there, to land in Jump_Land.
    a.t += dt;
    const k = Math.min(1, a.t / WALL_JUMP_S);
    const sm = (lo: number, hi: number, v: number): number => {
      const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      return x * x * (3 - 2 * x);
    };
    const side = a.roll!.side;
    const aligned = Math.round(a.yaw / Math.PI) * Math.PI;
    const lyingAngle = runAngle(c, a.dir) + a.yaw + (aligned - a.yaw) * sm(0, 0.3, k);
    const outAngle = Math.atan2(side.nx, side.nz);
    const target = a.roll!.target;
    // Turned to face where it goes: the drop's side, or the guard it comes down on.
    const faceTo = target ? Math.atan2(target.worldX - top.x, target.worldZ - top.z) : outAngle;
    const angle = lyingAngle + angleTo(lyingAngle, faceTo) * sm(0.05, 0.4, k);
    // Where the root is: on the wall's line while it gets up, then out over the edge in the push-off, a little up as it springs.
    const out = sm(0.4, 1, k) * (c.thick / 2 + 0.25);
    const spring = 0.35 * Math.sin(Math.PI * sm(0.4, 1, k));
    const rx = a.hips.x + Math.sin(lyingAngle) * a.back;
    const rz = a.hips.z + Math.cos(lyingAngle) * a.back;
    const stand = sm(0, 0.35, k);
    const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: 'JumpStart', time: 0.02 + 0.38 * sm(0.35, 1, k), weight: stand }];
    if (stand < 1) layers.unshift({ clip: 'Crawl_Enter', time: 2.1, weight: 1 - stand });
    player.holdWall(layers, rx + side.nx * out, a.lie.y + spring, rz + side.nz * out, angle, dt, null, null);
    if (k >= 1) {
      const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
      let to = { x: side.x, z: side.z };
      let fallAngle = angle;
      if (target) {
        const d = Math.hypot(target.worldX - from.x, target.worldZ - from.z);
        const kk = d > AERIAL_LAND ? (d - AERIAL_LAND) / d : 0;
        const spot = { x: from.x + (target.worldX - from.x) * kk, z: from.z + (target.worldZ - from.z) * kk };
        if (!collides(spot.x, spot.z, a.floor.rig.wallBoxes)) to = spot;
        if (d > 0.05) fallAngle = Math.atan2(target.worldX - from.x, target.worldZ - from.z);
      }
      player.snapProne(false);
      postureState = STANDING;
      aloft = { kind: 'fall', floor: a.floor, from, to, angle: fallAngle, t: 0, target, soft: true };
    }
  }

  // ---- a tall wall (highwall.ts): a dash up it ends hanging from the shelf along its face ----

  /** Up the face of a tall wall to its shelf: out of cover, whatever was being worked on left, and the thump of the run against the wall heard by the guards close by. */
  function startHighClimb(floor: ActiveFloor, contact: WallContact): void {
    const run = runOf(highRuns(floor.rig.climbBoxes), contact);
    if (!run) return;
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    const along = clampAlong(run, contact.run === 'x' ? player.worldX : player.worldZ);
    dashState = { ...dashState, active: false, spent: true };
    dashRun = 0;
    aloft = { kind: 'highwall', floor, contact, run, along, phase: 'pop', t: 0, rise: riseNeeded(LEDGE_Y), level: 1, fromY: 0, hold: 0, holdBack: 0, armed: false, fromHips: 0, fromX: 0, fromZ: 0, cycle: 0, side: 'L', speed: 0, hopFrom: 0, hopTo: 0, hopSide: 'L', over: false, mountFrom: 0, out: null };
    sound.play('stash', { x: player.worldX, y: floor.rig.group.position.y + 0.5, z: player.worldZ }, 0.8);
    const { navCells, cols, rows } = floor.content;
    for (const b of floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(player.worldX, player.worldZ, 2, navCells, cols, rows, WALL_THUMP_CELLS);
    toastOnce('highwall', keyed('Up a tall wall: you hang from its shelf · {turnLeft} and {turnRight} hop along it (hold them and the hops run on; heard) · {strafeLeft} and {strafeRight} shimmy (slow, silent) · forward alone runs up to the top shelf · back drops down a level (to the floor, from the first shelf) · Fire drops to the floor · Interact leaps off').toUpperCase(), 9000);
  }

  /** Where the hands go on a tall wall's shelf, at `along`: its top edge, the wrists a touch under it. */
  function shelfHands(a: Extract<Aloft, { kind: 'highwall' }>, along: number): { x: number; y: number; z: number } {
    const h = handsPoint(a.run, a.contact.nx, a.contact.nz, along);
    return { x: h.x, y: a.floor.rig.group.position.y + ledgeY(a.level) - 0.03, z: h.z };
  }

  /** The body pinned to the shelf by its hands (player.ts's holdWall): the clips' layers, the hands at `along`. */
  function holdOnShelf(a: Extract<Aloft, { kind: 'highwall' }>, layers: ReadonlyArray<{ clip: WallClip; time: number; weight: number }>, along: number, dt: number, handsY?: number): void {
    const c = a.contact;
    const at = floorPoint(a.run, c.nx, c.nz, along, 0.55);
    const hands = shelfHands(a, along);
    if (handsY !== undefined) hands.y = handsY;
    player.holdWall(layers, at.x, hands.y - 2.2, at.z, faceAngle(c), dt, { hands, settle: 0, centre: { x: at.x, z: at.z }, normal: { x: c.nx, z: c.nz } }, null);
  }

  /** Where a drop or a leap from the shelf lands: short of the guard it is on, else straight out from the wall (`out` metres), else the nearest free floor. Null with nowhere to land. */
  function wallLanding(a: Extract<Aloft, { kind: 'highwall' }>, target: Enemy | null, out: number, from: { x: number; z: number }): { x: number; z: number } | null {
    if (target) {
      const d = Math.hypot(target.worldX - from.x, target.worldZ - from.z);
      const k = d > AERIAL_LAND ? (d - AERIAL_LAND) / d : 0;
      const spot = { x: from.x + (target.worldX - from.x) * k, z: from.z + (target.worldZ - from.z) * k };
      if (!collides(spot.x, spot.z, a.floor.rig.wallBoxes) && canLand(a.floor, spot.x, spot.z, true)) return spot;
    }
    const c = a.contact;
    const straight = floorPoint(a.run, c.nx, c.nz, a.along, out);
    if (canLand(a.floor, straight.x, straight.z, true)) return straight;
    return landingNear(a.floor, from);
  }

  /** The guard in reach of a drop or a leap from here, if there is one. */
  function wallGuard(reach: number): Enemy | null {
    const e = aerialTarget;
    if (!e || e.disabled) return null;
    return Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) <= reach ? e : null;
  }

  /**
   * What is just below on the side the agent came up (the wall's near side): a cargo container (its roof is stood on) or a piece of furniture (it breaks under the landing, and the agent ends on the
   * floor where it was), within about 3.4 m of the wall and a little to either side; the drop that goes there, or null with nothing to land on.
   */
  function landingBelow(a: Extract<Aloft, { kind: 'highwall' }>): NonNullable<Extract<Aloft, { kind: 'highwall' }>['out']> | null {
    const c = a.contact;
    const floor = a.floor;
    const level = storeys.findIndex((s) => s.content === floor.content);
    const pieces = storeyPieces[level] ?? [];
    const floorY = floor.rig.group.position.y;
    const lx = a.run.run === 'x' ? 1 : 0;
    const lz = a.run.run === 'x' ? 0 : 1;
    let found: { box: WallBox; piece: Destructible | null; x: number; z: number } | null = null;
    for (let out = 0.9; out <= 3.4 && !found; out += 0.35) {
      for (const side of [0, 0.7, -0.7, 1.3, -1.3]) {
        const at = floorPoint(a.run, c.nx, c.nz, a.along, out);
        const x = at.x + lx * side;
        const z = at.z + lz * side;
        const hit = floor.rig.wallBoxes.find((b) => x > b.minX - 0.1 && x < b.maxX + 0.1 && z > b.minZ - 0.1 && z < b.maxZ + 0.1 && (b.roof !== undefined || pieces.some((p) => p.box === b && p.hp > 0)));
        if (hit) {
          found = { box: hit, piece: hit.roof === undefined ? (pieces.find((p) => p.box === hit) ?? null) : null, x, z };
          break;
        }
      }
    }
    if (!found) return null;
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    const b = found.box;
    if (b.roof !== undefined) {
      // a step in from the edge, on the roof
      const to = { x: Math.min(b.maxX - 0.5, Math.max(b.minX + 0.5, found.x)), z: Math.min(b.maxZ - 0.5, Math.max(b.minZ + 0.5, found.z)) };
      return { from, to, target: null, roofAt: floorY + b.roof };
    }
    return { from, to: { x: found.piece ? found.piece.cx : found.x, z: found.piece ? found.piece.cz : found.z }, target: null, ...(found.piece ? { smash: found.piece, level } : {}) };
  }

  /** Jumps off the wall onto what is below it (landingBelow's): false with nothing there. */
  function jumpOntoBelow(a: Extract<Aloft, { kind: 'highwall' }>): boolean {
    const out = landingBelow(a);
    if (!out) return false;
    a.out = out;
    a.phase = 'drop';
    a.t = 0;
    sound.play('drag', undefined, 0.4);
    toastOnce('topjump', out.roofAt !== undefined ? 'DOWN ONTO THE CONTAINER · WALK ITS ROOF, OR STEP OFF AN EDGE' : 'DOWN ONTO THE FURNITURE · IT BREAKS UNDER YOU', 3600);
    return true;
  }

  /** Crouched on the top, back held: down onto a container or furniture below, if there is one (else back climbs down by the shelves, as before). */
  function startTopJump(a: Extract<Aloft, { kind: 'highwall' }>): boolean {
    return jumpOntoBelow(a);
  }

  /** Fire on the shelf: let go and drop straight down, on the guard below if there is one. */
  function dropFromWall(): boolean {
    const a = aloft;
    // Crouched on the top, Fire climbs back down the side it came up.
    if (a?.kind === 'highwall' && a.phase === 'top') {
      startDismount(a, false);
      return true;
    }
    if (a?.kind !== 'highwall' || a.phase !== 'hang') return false;
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    const target = wallGuard(DROP_REACH);
    // No guard to land on: a container or a piece of furniture below, if there is one.
    if (!target && jumpOntoBelow(a)) return true;
    const to = wallLanding(a, target, 0.7, from);
    if (!to) {
      hud.showToast('NOTHING TO LAND ON BELOW · A WALL OR A LOCKED SECTION', 'neutral', 2200);
      return false;
    }
    a.out = { from, to, target };
    a.phase = 'drop';
    a.t = 0;
    sound.play('drag', undefined, 0.4);
    return true;
  }

  /** Interact on the shelf: push off the wall and leap backwards, a couple of metres out, onto a guard there if there is one. */
  function startWallJump(): void {
    const a = aloft;
    if (a?.kind !== 'highwall' || a.phase !== 'hang') return;
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    const target = wallGuard(JUMP_REACH);
    const to = wallLanding(a, target, JUMP_OUT, from);
    if (!to) {
      hud.showToast('NOWHERE TO LEAP TO · A WALL OR A LOCKED SECTION', 'neutral', 2200);
      return;
    }
    a.out = { from, to, target };
    a.phase = 'jump';
    a.t = 0;
    wallJumps++;
    sound.play('drag', undefined, 0.6);
  }

  /** A hop along the shelf toward `lateral`'s side, if there is room: the hang becomes the hop, and the guards a couple of cells away hear it. */
  function startHop(a: Extract<Aloft, { kind: 'highwall' }>, lateral: number, rightAlong: number, side: 'L' | 'R'): boolean {
    const dir = (Math.sign(lateral) * rightAlong) as 1 | -1;
    const to = hopTarget(a.run, a.along, dir);
    if (to === null) return startCorner(a, dir);
    a.phase = 'hop';
    a.t = 0;
    a.hopFrom = a.along;
    a.hopTo = to;
    a.hopSide = side;
    wallHops++;
    sound.play('stash', { x: player.worldX, y: a.floor.rig.group.position.y + 1.2, z: player.worldZ }, 0.5);
    const { navCells, cols, rows } = a.floor.content;
    for (const b of a.floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(player.worldX, player.worldZ, 2, navCells, cols, rows, HOP_HEARD_CELLS);
    return true;
  }

  /** A hang's contact with its wall, for the helpers that take one. */
  function contactOf(h: Hang, base: WallContact): WallContact {
    const p = handsPoint(h.run, h.nx, h.nz, h.along);
    return { ...base, hit: p, nx: h.nx, nz: h.nz, run: h.run.run, centre: h.run.centre, lo: h.run.lo, hi: h.run.hi, thick: h.run.thick, high: true };
  }

  /** Shimmying or hopping on to the end of the wall with another meeting it there: the hang goes round the corner (an inner one turns the other way, an outer one wraps round the end). */
  function startCorner(a: Extract<Aloft, { kind: 'highwall' }>, dir: 1 | -1): boolean {
    const next = cornerAt(highRuns(a.floor.rig.climbBoxes), a.run, a.contact.nx, a.contact.nz, dir);
    if (!next) return false;
    a.turn = { from: { run: a.run, nx: a.contact.nx, nz: a.contact.nz, along: a.along }, to: { run: next.run, nx: next.nx, nz: next.nz, along: next.along }, convex: next.convex, cross: false, dur: next.convex ? 1.0 : 0.8, dir: next.dir };
    a.phase = 'corner';
    a.t = 0;
    sound.play('drag', undefined, 0.35);
    toastOnce('highcorner', 'ROUND THE CORNER · KEEP SHIMMYING OR HOPPING AT THE END OF A WALL AND THE HANG GOES ON ROUND IT', 5000);
    return true;
  }

  /** U on the shelf: a jump to another tall wall's shelf across the gap (the nearest face that looks at you, within reach): push off, turn in the air, catch its edge. */
  function startCross(a: Extract<Aloft, { kind: 'highwall' }>): void {
    const runs = highRuns(a.floor.rig.climbBoxes);
    const target = crossTarget(runs, a.run, player.worldX, player.worldZ);
    if (!target) {
      hud.showToast('NO TALL WALL TO JUMP TO · FACE ONE ACROSS THE GAP, WITHIN ABOUT FOUR METRES', 'neutral', 2600);
      return;
    }
    if (strength < MIN_TO_HOOK) {
      sound.play('denied');
      hud.showToast('TOO WINDED TO JUMP ACROSS · CATCH YOUR BREATH', 'bad');
      return;
    }
    const here = handsPoint(a.run, a.contact.nx, a.contact.nz, a.along);
    const there = handsPoint(target.run, target.nx, target.nz, target.along);
    const dist = Math.hypot(there.x - here.x, there.z - here.z);
    strength = Math.max(0, strength - 0.2);
    a.turn = { from: { run: a.run, nx: a.contact.nx, nz: a.contact.nz, along: a.along }, to: target, convex: false, cross: true, dur: 0.9 + dist * 0.12, dir: 1 };
    a.phase = 'cross';
    a.t = 0;
    sound.play('drag', undefined, 0.7);
    for (const b of a.floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(player.worldX, player.worldZ, 2, a.floor.content.navCells, a.floor.content.cols, a.floor.content.rows, HOP_HEARD_CELLS);
  }

  /** Round a corner or across a gap: from one hang to the next, the body swung between them (outside a corner it bows out round the wall's end; across a gap it swings, the line paid out from the far shelf). */
  function tickTurn(a: Extract<Aloft, { kind: 'highwall' }>, dt: number): void {
    const t = a.turn!;
    const floorY = a.floor.rig.group.position.y;
    a.t += dt;
    const k = Math.min(1, a.t / t.dur);
    const e = k * k * (3 - 2 * k);
    const f = t.from;
    const to = t.to;
    const rootOf = (h: Hang) => floorPoint(h.run, h.nx, h.nz, h.along, 0.55);
    const r0 = rootOf(f);
    const r1 = rootOf(to);
    // The bend: outside a corner it goes out round the end of the wall (a control point out past the corner), else straight.
    let x = r0.x + (r1.x - r0.x) * e;
    let z = r0.z + (r1.z - r0.z) * e;
    if (t.convex) {
      // the control point is the corner of the two root lines: the x of the one and the z of the other
      const ctlX = f.run.run === 'x' ? r1.x : r0.x;
      const ctlZ = f.run.run === 'x' ? r0.z : r1.z;
      x = (1 - e) * (1 - e) * r0.x + 2 * (1 - e) * e * ctlX + e * e * r1.x;
      z = (1 - e) * (1 - e) * r0.z + 2 * (1 - e) * e * ctlZ + e * e * r1.z;
    }
    const cf = contactOf(f, a.contact);
    const ct = contactOf(to, a.contact);
    const angle = faceAngle(cf) + angleTo(faceAngle(cf), faceAngle(ct)) * e;
    const h0 = handsPoint(f.run, f.nx, f.nz, f.along);
    const h1 = handsPoint(to.run, to.nx, to.nz, to.along);
    const hx = h0.x + (h1.x - h0.x) * e;
    const hz = h0.z + (h1.z - h0.z) * e;
    let nx = f.nx + (to.nx - f.nx) * e;
    let nz = f.nz + (to.nz - f.nz) * e;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const handsY = floorY + ledgeY(a.level) - 0.03;
    if (t.cross) {
      // Across a gap: push off the wall, turn in the air to face the other one, and catch its shelf. The hands let go as the feet push, the body arcs over on the jump's pose, and the hands go to
      // the far edge as it arrives (no line: it is a jump).
      const smooth = (lo: number, hi: number, v: number): number => {
        const q = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
        return q * q * (3 - 2 * q);
      };
      const PUSH = 0.22;
      const LAND = 0.78;
      const rootY = handsY - 2.2;
      const faceA = faceAngle(cf);
      const faceB = faceAngle(ct);
      // the push-off point (out from the near wall) and the catch point (a little out from the far one)
      const out0 = { x: r0.x + f.nx * 0.4, z: r0.z + f.nz * 0.4 };
      const out1 = { x: r1.x + to.nx * 0.4, z: r1.z + to.nz * 0.4 };
      let px: number;
      let pz: number;
      let py: number;
      let ang = faceA;
      let cl: Array<{ clip: WallClip; time: number; weight: number }>;
      let limbs: { hands: { right: { x: number; y: number; z: number }; left: { x: number; y: number; z: number }; w: number } } | undefined;
      let pin: { hands: { x: number; y: number; z: number }; settle: number; centre: { x: number; z: number }; normal: { x: number; z: number } } | null = null;
      const handsAt = (h: { x: number; z: number }, w: number, run: Run = to.run): { hands: { right: { x: number; y: number; z: number }; left: { x: number; y: number; z: number }; w: number } } => {
        const along = run.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
        return { hands: { right: { x: h.x + along.x * 0.16, y: handsY, z: h.z + along.z * 0.16 }, left: { x: h.x - along.x * 0.16, y: handsY, z: h.z - along.z * 0.16 }, w } };
      };
      if (k < PUSH) {
        const q = smooth(0, 1, k / PUSH);
        px = r0.x + (out0.x - r0.x) * q;
        pz = r0.z + (out0.z - r0.z) * q;
        py = rootY + 0.12 * q;
        cl = [{ clip: 'HangJump', time: q * 0.45, weight: 1 }];
        limbs = handsAt(h0, 1 - q, f.run);
      } else if (k < LAND) {
        const q = (k - PUSH) / (LAND - PUSH);
        const m = smooth(0, 1, q);
        px = out0.x + (out1.x - out0.x) * m;
        pz = out0.z + (out1.z - out0.z) * m;
        py = rootY + 0.12 + 0.6 * 4 * q * (1 - q);
        ang = faceA + angleTo(faceA, faceB) * m;
        const w = smooth(0, 0.3, q);
        cl = [{ clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: w }];
        if (w < 1) cl.unshift({ clip: 'HangJump', time: 0.45, weight: 1 - w });
      } else {
        const q = smooth(0, 1, (k - LAND) / (1 - LAND));
        px = out1.x + (r1.x - out1.x) * q;
        pz = out1.z + (r1.z - out1.z) * q;
        py = rootY + 0.12 * (1 - q);
        ang = faceB;
        cl = [{ clip: a.side === 'L' ? 'HangShimmyL' : 'HangShimmyR', time: 0, weight: q }];
        if (q < 1) cl.unshift({ clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: 1 - q });
        limbs = handsAt(h1, q);
        if (q > 0.6) pin = { hands: { x: h1.x, y: handsY, z: h1.z }, settle: 0, centre: { x: px, z: pz }, normal: { x: to.nx, z: to.nz } };
      }
      player.holdWall(cl, px, py, pz, ang, dt, pin, limbs ?? null);
    } else {
      const clip: WallClip = t.dir > 0 ? 'HangShimmyR' : 'HangShimmyL';
      player.holdWall([{ clip, time: (a.t * 1.4) % SHIMMY_CLIP_S, weight: 1 }], x, handsY - 2.2, z, angle, dt, { hands: { x: hx, y: handsY, z: hz }, settle: 0, centre: { x, z }, normal: { x: nx, z: nz } }, null);
    }
    if (k < 1) return;
    a.run = to.run;
    a.contact = ct;
    a.along = to.along;
    a.phase = 'hang';
    a.turn = undefined;
    a.t = 0.2; // (the hang's own fade-in from the jump pose is over: both the corner and the swing end in the hang pose)
    a.cycle = 0;
    a.armed = false;
    a.hold = 0;
    a.holdBack = 0;
  }

  /** From the top: down into the hang, the side it came up (`over` false) or the far one (the contact turned about: its face is the other way). */
  function startDismount(a: Extract<Aloft, { kind: 'highwall' }>, over: boolean): void {
    if (over) a.contact = { ...a.contact, nx: -a.contact.nx, nz: -a.contact.nz };
    a.over = over;
    a.phase = 'dismount';
    a.t = 0;
    sound.play('drag', undefined, 0.5);
  }

  /** A frame on a tall wall: the run up its face, hanging from the shelf, hopping along it, dropping or leaping off it. */
  function tickHighWall(a: Extract<Aloft, { kind: 'highwall' }>, dt: number, turnIn: number, throttleIn: number, strafeIn: number): void {
    const floorY = a.floor.rig.group.position.y;
    const c = a.contact;
    const facing = faceAngle(c);
    // The agent's right, as it faces the wall ((-cos, sin) of the facing in this game's turn), and which way along the run that is.
    const rx = -Math.cos(facing);
    const rz = Math.sin(facing);
    const rightAlong = Math.sign(a.run.run === 'x' ? rx : rz) || 1;
    if (a.phase === 'pop') {
      a.t += dt;
      const p = poseAt(Math.min(a.t, CLIMB.popS), a.rise);
      const stand = floorPoint(a.run, c.nx, c.nz, a.along, p.off + SHELF_OUT);
      const edge = shelfHands(a, a.along);
      const run = a.run.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const hand = (k: number) => ({ x: edge.x + run.x * k, y: edge.y, z: edge.z + run.z * k });
      const base = floorPoint(a.run, c.nx, c.nz, a.along, 0.09);
      const foot = (st: { h: number; w: number }, k: number) => ({ x: base.x + rx * k, y: floorY + st.h, z: base.z + rz * k, w: st.w });
      const limbs = { hands: { right: hand(0.16), left: hand(-0.16), w: p.reachW }, feet: { right: foot(p.steps.right, 0.14), left: foot(p.steps.left, -0.14) } };
      player.holdWall(p.layers, stand.x, floorY + p.rise, stand.z, facing, dt, null, limbs);
      if (a.t >= CLIMB.popS) {
        a.phase = 'hang';
        a.t = 0;
        a.cycle = 0;
        a.level = 1;
        a.armed = false;
        wallHangs++;
      }
      return;
    }
    if (a.phase === 'hang') {
      a.t += dt;
      // The turn keys (A and D) hop along the shelf, quick and heard; the strafe keys (Q and E) shimmy, slow and silent. (On a tower's rail, with no wall to brace against, the sides are one slow shimmy.)
      const turnSide = clampAxis(turnIn);
      const strafeSide = clampAxis(strafeIn);
      const hopping = Math.abs(turnSide) > 0.3;
      const lateral = hopping ? turnSide : strafeSide;
      const moving = !hopping && Math.abs(strafeSide) > 0.15;
      const side: 'L' | 'R' = lateral > 0 ? 'R' : 'L';
      if (moving && side !== a.side) {
        a.side = side;
        a.cycle = 0;
      }
      // Forward alone, held, on the lower shelf: the wall run again, up to the second. Back alone, held, on the second: down to the first.
      const forwardOnly = throttleIn > 0.5 && Math.abs(lateral) <= 0.3;
      const backOnly = throttleIn < -0.5 && Math.abs(lateral) <= 0.3;
      if (Math.abs(throttleIn) < 0.3) a.armed = true;
      a.hold = forwardOnly && a.armed ? a.hold + dt : 0;
      a.holdBack = backOnly && a.armed ? a.holdBack + dt : 0;
      if (a.t > 0.1 && a.level === 1 && !a.run.single && a.hold >= LEVEL_HOLD_S) {
        a.phase = 'rise';
        a.t = 0;
        a.fromY = player.worldY - floorY;
        a.fromHips = player.hipsPosition().y - floorY;
        a.fromX = player.worldX;
        a.fromZ = player.worldZ;
        a.hold = 0;
        toastOnce('highrise', 'RUNNING UP TO THE TOP SHELF · BACK DROPS YOU BACK TO THE FIRST', 5000);
        return;
      }
      // Back alone on the first shelf: down to the floor, as Fire does (onto a guard under it, if there is one).
      if (a.t > 0.1 && a.level === 1 && a.holdBack >= LEVEL_HOLD_S) {
        a.holdBack = 0;
        if (dropFromWall()) return;
      }
      // Forward alone on the top shelf: up onto the wall's top (and on over, from there).
      if (a.t > 0.1 && a.level === 2 && !a.run.single && a.hold >= LEVEL_HOLD_S) {
        a.phase = 'mount';
        a.t = 0;
        a.hold = 0;
        a.mountFrom = player.hipsPosition().y - floorY;
        a.fromY = player.worldY - floorY;
        sound.play('drag', undefined, 0.5);
        toastOnce('highmount', keyed('UP ONTO THE TOP OF THE WALL · KEEP FORWARD HELD AND YOU GO STRAIGHT OVER TO THE FAR SIDE (LET GO TO STOP ON THE TOP, THEN FORWARD GOES ON OVER) · BACK OR FIRE COMES DOWN THE SIDE YOU CAME UP').toUpperCase(), 6000);
        return;
      }
      if (a.t > 0.1 && a.level === 2 && a.holdBack >= LEVEL_HOLD_S) {
        a.phase = 'lower';
        a.t = 0;
        a.fromY = player.worldY - floorY;
        a.holdBack = 0;
        sound.play('drag', undefined, 0.4);
        return;
      }
      // A hop, where there is room along the shelf.
      if (a.t > 0.2 && hopping) {
        if (startHop(a, lateral, rightAlong, side)) return;
      }
      if (moving) {
        const before = a.along;
        a.along = clampAlong(a.run, a.along + Math.sign(lateral) * rightAlong * BRACED_SHIMMY_SPEED * dt);
        const moved = Math.abs(a.along - before);
        hangMetres += moved;
        // At the end of the wall, still pushing on: round the corner, if another wall meets it there.
        if (moved < 1e-4 && a.t > 0.3 && startCorner(a, (Math.sign(lateral) * rightAlong) as 1 | -1)) return;
        a.cycle += (moved / SHIMMY_CLIP_M) * SHIMMY_CLIP_S;
      } else {
        // Still: the cycle runs on to the hanging pose it starts and ends in, rather than stopping half way along a reach.
        a.cycle %= SHIMMY_CLIP_S;
        const home = a.cycle > SHIMMY_CLIP_S / 2 ? SHIMMY_CLIP_S : 0;
        a.cycle += Math.sign(home - a.cycle) * Math.min(Math.abs(home - a.cycle), dt * 1.5);
      }
      const w = Math.min(1, a.t / 0.2);
      const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: a.side === 'L' ? 'HangShimmyL' : 'HangShimmyR', time: a.cycle % SHIMMY_CLIP_S, weight: w }];
      if (w < 1) layers.unshift({ clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: 1 - w });
      holdOnShelf(a, layers, a.along, dt);
      return;
    }
    if (a.phase === 'corner' || a.phase === 'cross') {
      tickTurn(a, dt);
      return;
    }
    if (a.phase === 'hop') {
      a.t += dt;
      const k = Math.min(1, a.t / HOP_S);
      // The speed: mostly even (the hops run on into one another), a little slower at either end.
      const e = 0.6 * k + 0.4 * (k * k * (3 - 2 * k));
      const along = a.hopFrom + (a.hopTo - a.hopFrom) * e;
      // The clip, eased in from the hanging pose and back into it, so a hop starts and ends with no jerk.
      const hopClip: WallClip = a.hopSide === 'L' ? 'HangHopL' : 'HangHopR';
      const hangClip: WallClip = a.hopSide === 'L' ? 'HangShimmyL' : 'HangShimmyR';
      const edge = HOP_BLEND_S / HOP_S;
      const into = Math.min(1, k / edge);
      const out = Math.min(1, (1 - k) / edge);
      const w = Math.min(into * into * (3 - 2 * into), out * out * (3 - 2 * out));
      const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: hopClip, time: k * HOP_CLIP_S[a.hopSide === 'L' ? 'left' : 'right'], weight: w }];
      if (w < 1) layers.unshift({ clip: hangClip, time: 0, weight: 1 - w });
      holdOnShelf(a, layers, along, dt);
      if (k >= 1) {
        a.along = a.hopTo;
        hangMetres += Math.abs(a.hopTo - a.hopFrom); // (a hop is along the shelf too)
        // Still holding a turn key: the next hop starts at once, from the pose this one ended in.
        const lateral = clampAxis(turnIn);
        if (Math.abs(lateral) > 0.3) {
          if (startHop(a, lateral, rightAlong, lateral > 0 ? 'R' : 'L')) return;
        }
        a.phase = 'hang';
        a.t = 0.2;
        a.cycle = 0;
        a.armed = false;
      }
      return;
    }
    if (a.phase === 'rise') {
      // The wall run again, from the hang up to the second shelf, in one smooth motion: the body eased up the three metres (a little over the shelf, then settling onto it), the leap pose
      // eased in from the hanging one and back into it, the feet scrambling on the wall at fixed heights under the hips, the hands stretching for the shelf's edge.
      a.t += dt;
      const k = Math.min(1, a.t / RISE_S);
      const smooth = (lo: number, hi: number, v: number): number => {
        const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
        return x * x * (3 - 2 * x);
      };
      // (A tower's climb wall goes on up not to a second shelf but to the rail ledge on the storey over it, `top` m up.)
      const topY = a.run.top ?? ledgeY(2);
      const lift = topY - ledgeY(1);
      const ease = smooth(0, 1, k);
      const lean = smooth(0, 0.3, k) * (1 - smooth(0.8, 1, k));
      const to = floorPoint(a.run, c.nx, c.nz, a.along, CLIMB.popOff + SHELF_OUT);
      const stand = { x: a.fromX + (to.x - a.fromX) * lean, z: a.fromZ + (to.z - a.fromZ) * lean };
      const reach = handsPoint(a.run, c.nx, c.nz, a.along);
      const edge = { x: reach.x, y: floorY + topY - 0.03, z: reach.z };
      const run = a.run.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const hand = (d: number) => ({ x: edge.x + run.x * d, y: edge.y, z: edge.z + run.z * d });
      const base = floorPoint(a.run, c.nx, c.nz, a.along, 0.09);
      const jump = smooth(0, RISE_BLEND_S / RISE_S, k) * (1 - smooth(0.78, 1, k));
      const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: jump }];
      if (jump < 1) layers.unshift({ clip: a.side === 'L' ? 'HangShimmyL' : 'HangShimmyR', time: 0, weight: 1 - jump });
      // The hips follow one smooth path up (a little over the shelf, then settling onto it), whatever the pose does to them: the pose is set once to see where its hips fall, and again with the root put where they'd land on the path.
      const hipsPath = floorY + a.fromHips + lift * ease + 0.22 * Math.sin(Math.PI * k) * k;
      let y = floorY + a.fromY + lift * ease;
      for (let pass = 0; pass < 2; pass++) {
        // (The feet ride at fixed heights under the hips: they slide up the wall with the body, and nothing overstretches or snaps back.)
        const foot = (h: number, w: number, d: number) => ({ x: base.x + rx * d, y: y + h, z: base.z + rz * d, w });
        const limbs = {
          hands: { right: hand(0.16), left: hand(-0.16), w: smooth(0.3, 0.75, k) },
          feet: {
            right: foot(0.5, smooth(0.08, 0.3, k) * (1 - smooth(0.62, 0.8, k)), 0.14),
            left: foot(0.95, smooth(0.3, 0.5, k) * (1 - smooth(0.74, 0.9, k)), -0.14),
          },
        };
        player.holdWall(layers, stand.x, y, stand.z, facing, dt * (pass === 0 ? 0 : 1), null, limbs);
        if (pass === 0) y += hipsPath - player.hipsPosition().y;
      }
      if (k >= 1 && a.run.toLevel !== undefined) {
        // Up to the ledge of the opening above: hanging from it as from a rail, to be pulled over onto the storey.
        const toLevel = a.run.toLevel;
        const upper = storeys[toLevel];
        const edgeZ = a.run.centre - c.nz * 0.08;
        const span = ledgeSpans(toLevel).find((sp) => sp.axis === a.run.run && Math.abs(sp.fixed - edgeZ) < 0.25 && a.along >= sp.from - 0.1 && a.along <= sp.to + 0.1);
        if (upper && span) {
          wallTops++;
          aloft = { kind: 'ledge', floor: upper, span, along: Math.min(span.to - 0.5, Math.max(span.from + 0.5, a.along)), phase: 'hang', t: 0.2, from: { x: player.worldX, y: player.worldY, z: player.worldZ }, angle: facing, travel: 0, dur: LEDGE_IN_S, haul: null, cycle: 0, side: 'L' };
          toastOnce('climbed-up', keyed('ON THE LEDGE OVER THE OPENING · {interact} PULLS YOU OVER THE RAIL ONTO THE FLOOR ABOVE · FIRE LETS GO').toUpperCase(), 6000);
          return;
        }
      }
      if (k >= 1) {
        a.level = 2;
        a.phase = 'hang';
        a.t = 0.2;
        a.cycle = 0;
        a.armed = false;
        wallTops++;
        toastOnce('highlevel2', 'ON THE TOP SHELF · FORWARD AGAIN CLIMBS ONTO THE WALL’S TOP, AND ON OVER · A DROP ONTO A GUARD FROM HERE KILLS HIM, AND THE THUD CARRIES · BACK DROPS YOU DOWN TO THE FIRST SHELF', 6000);
      }
      return;
    }
    if (a.phase === 'mount' || a.phase === 'dismount') {
      // Up onto the top, or down from it into the hang: Braced Hang To Crouch, forward or backward. The hips ride one smooth path (the root is nudged until they do), the hands hold the top
      // edge until the body is over it, and the root moves in over the cap to the wall's centre line.
      a.t += dt;
      const up = a.phase === 'mount';
      const k = Math.min(1, a.t / (up ? MOUNT_S : DISMOUNT_S));
      const pk = up ? k : 1 - k; // how far up the pull-up is
      const ease = pk * pk * (3 - 2 * pk);
      const topY = ledgeY(2);
      const topHips = topY + CROUCH_HIPS;
      const hipsPath = floorY + a.mountFrom + (floorY + topHips - (floorY + a.mountFrom)) * ease;
      const at = floorPoint(a.run, c.nx, c.nz, a.along, mountOut(pk, a.run.thick));
      const reach = handsPoint(a.run, c.nx, c.nz, a.along);
      const edge = { x: reach.x, y: floorY + topY - 0.03, z: reach.z };
      const run = a.run.run === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const grip = mountGrip(pk);
      const limbs = { hands: { right: { x: edge.x + run.x * 0.16, y: edge.y, z: edge.z + run.z * 0.16 }, left: { x: edge.x - run.x * 0.16, y: edge.y, z: edge.z - run.z * 0.16 }, w: grip } };
      // (The last of the pull-up settles into an ordinary crouch: the clip's own last frame has the arms up.)
      const settle = Math.min(1, Math.max(0, (pk - 0.72) / 0.28));
      const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: 'HangMount', time: Math.min(pk, 0.999) * MOUNT_CLIP_S, weight: 1 - settle }];
      if (settle > 0) layers.push({ clip: 'CrouchIdle', time: 0.4, weight: settle });
      let y = floorY + a.fromY + (hipsPath - floorY - a.mountFrom);
      for (let pass = 0; pass < 2; pass++) {
        player.holdWall(layers, at.x, y, at.z, faceAngle(c), dt * (pass === 0 ? 0 : 1), null, limbs);
        if (pass === 0) y += hipsPath - player.hipsPosition().y;
      }
      if (k >= 1) {
        if (up) {
          a.t = 0;
          a.armed = false;
          sound.play('stash', { x: player.worldX, y: floorY + topY, z: player.worldZ }, 0.5);
          // Forward still held: no pause on the top, straight on over (a tap stops there instead, and forward again goes on).
          if (throttleIn > 0.5) {
            a.phase = 'over';
            a.hold = 0;
          } else a.phase = 'top';
        } else {
          a.phase = 'hang';
          a.t = 0.2;
          a.cycle = 0;
          a.armed = false;
          a.level = 2;
          if (a.over) {
            a.over = false;
            wallCrosses++;
            toastOnce('highover', 'OVER THE TOP · HANGING FROM THE TOP SHELF ON THE FAR SIDE', 4200);
          }
        }
      }
      return;
    }
    if (a.phase === 'top') {
      // Crouched on the cap: forward goes on over, back (or Fire) comes down the way it came.
      a.t += dt;
      if (Math.abs(throttleIn) < 0.3) a.armed = true;
      a.hold = throttleIn > 0.5 && a.armed ? a.hold + dt : 0;
      a.holdBack = throttleIn < -0.5 && a.armed ? a.holdBack + dt : 0;
      const at = floorPoint(a.run, c.nx, c.nz, a.along, mountOut(1, a.run.thick));
      player.holdWall([{ clip: 'CrouchIdle', time: 0.4, weight: 1 }], at.x, floorY + ledgeY(2), at.z, faceAngle(c), dt, null, null);
      if (a.t > 0.2 && a.hold >= LEVEL_HOLD_S) {
        a.phase = 'over';
        a.t = 0;
        a.hold = 0;
        return;
      }
      if (a.t > 0.2 && a.holdBack >= LEVEL_HOLD_S && !startTopJump(a)) startDismount(a, false);
      return;
    }
    if (a.phase === 'over') {
      // The turn on the spot: the far face is behind them. Then the contact is the far side's, and the pull-up runs backwards from there.
      a.t += dt;
      const k = Math.min(1, a.t / OVER_TURN_S);
      const at = floorPoint(a.run, c.nx, c.nz, a.along, mountOut(1, a.run.thick));
      player.holdWall([{ clip: 'CrouchIdle', time: 0.4, weight: 1 }], at.x, floorY + ledgeY(2), at.z, faceAngle(c) + Math.PI * k * k * (3 - 2 * k), dt, null, null);
      if (k >= 1) startDismount(a, true);
      return;
    }
    if (a.phase === 'lower') {
      // Let go and fall the three metres, caught on the first shelf: the drop's clip, easing into the hanging pose as the hands take the shelf.
      a.t += dt;
      const k = Math.min(1, a.t / LOWER_S);
      const hangClip: WallClip = a.side === 'L' ? 'HangShimmyL' : 'HangShimmyR';
      const w = Math.min(1, Math.max(0, (k - 0.7) / 0.3));
      const layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip: 'HangDrop', time: k * 0.45, weight: 1 - w }];
      if (w > 0) layers.push({ clip: hangClip, time: 0, weight: w });
      const handsY = floorY + ledgeY(2) - 0.03 + (ledgeY(1) - ledgeY(2)) * k * k;
      a.level = 1;
      holdOnShelf(a, layers, a.along, dt, handsY);
      if (k >= 1) {
        a.phase = 'hang';
        a.t = 0.2;
        a.cycle = 0;
        a.armed = false;
        wallLowers++;
        player.shake(0.2);
        sound.play('stash', { x: player.worldX, y: floorY + 1.5, z: player.worldZ }, 0.5);
      } else a.level = 1;
      return;
    }
    // Dropping or leaping: off the shelf along the clip, down to the floor, and the landing (the guard under it taken out) is land()'s.
    const out = a.out!;
    a.t += dt;
    const dur = a.phase === 'drop' ? DROP_S : JUMP_S;
    const k = Math.min(1, a.t / dur);
    const leap = a.phase === 'jump';
    const move = leap ? k : k * k * (3 - 2 * k);
    const fall = leap ? k : k * k;
    player.holdWall(
      [{ clip: leap ? 'HangJump' : 'HangDrop', time: k * (leap ? JUMP_CLIP_S : DROP_S), weight: 1 }],
      out.from.x + (out.to.x - out.from.x) * move,
      out.from.y + ((out.roofAt ?? floorY) - out.from.y) * fall + (leap ? 0.55 * Math.sin(Math.PI * k) : 0),
      out.from.z + (out.to.z - out.from.z) * move,
      leap ? facing + Math.PI : facing,
      dt,
      null,
      null
    );
    if (k >= 1 && out.roofAt !== undefined) {
      // Down onto a container's roof: stood up on it, crouched, the height field holds them there.
      player.place(out.to.x, out.to.z, facing, out.roofAt);
      postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
      hud.setPosture('crouch', nextPosture(postureState, stats.seconds));
      touch.setPosture('crouch');
      roofY = out.roofAt;
      aloft = null;
      sound.play('stash', { x: out.to.x, y: out.roofAt + 0.2, z: out.to.z });
      player.shake(0.3);
      const { navCells, cols, rows } = a.floor.content;
      for (const b of a.floor.content.enemies) if (b instanceof Bot && !b.disabled) b.investigate(out.to.x, out.to.z, 3, navCells, cols, rows, DROP_HEARD_CELLS);
      return;
    }
    if (k >= 1) {
      // Onto a piece of furniture: it gives way under the landing, and the agent ends on the floor where it stood.
      let to = out.to;
      if (out.smash && out.level !== undefined) {
        smashPiece(out.level, out.smash);
        if (collides(to.x, to.z, a.floor.rig.wallBoxes)) to = landingNear(a.floor, { x: to.x, z: to.z }) ?? to;
      }
      land({ kind: 'fall', floor: a.floor, from: out.from, to, angle: leap ? facing + Math.PI : facing, t: 1, target: out.target, settled: true });
    }
  }

  /** A frame up off the floor: climbing, on the platform, hanging and shimmying, or falling. Instead of player.tick(). */
  function tickAloft(a: Aloft, dt: number, turnIn: number, throttleIn: number, strafeIn = 0): void {
    if (a.kind === 'highwall') {
      player.ledgeGrip = false;
      tickHighWall(a, dt, turnIn, throttleIn, strafeIn);
      return;
    }
    if (a.kind === 'ledge') {
      player.ledgeGrip = true;
      tickLedge(a, dt, turnIn, strafeIn);
      return;
    }
    player.ledgeGrip = false;
    if (a.kind === 'wall') {
      tickWall(a, dt, turnIn, throttleIn);
      return;
    }
    if (a.kind === 'shaft') {
      tickShaft(a, dt);
      return;
    }
    const o = a.floor.rig.group.position;
    const floorY = o.y;
    const rig = a.floor.content.pipeRig!;
    const plan = a.floor.content.pipes!;
    if (a.kind === 'climb') {
      const c = rig.towers[a.tower]!;
      const total = climbSeconds(c);
      a.t = Math.min(total, a.t + dt);
      const at = climbAt(c, a.up ? a.t : total - a.t);
      // Going down, the turn to the ladder starts from wherever the agent faced on the platform.
      const turn = !a.up && a.from !== undefined && a.t < CLIMB_STEP_S ? a.t / CLIMB_STEP_S : 1;
      const angle = turn < 1 ? a.from! + angleTo(a.from!, at.angle) * turn : at.angle;
      player.hold(at.x + o.x, floorY + at.y, at.z + o.z, angle, at.mode === 'rungs' ? 'climb' : at.mode, dt, at.travel);
      if (a.t < total) return;
      if (a.up) {
        aloft = { kind: 'perch', floor: a.floor, tower: a.tower, angle: at.angle };
        toastOnce('perch', `LOOKOUT · EVERYTHING NEARBY TAGGED FOR ${TAG_S} S · TURN TO LOOK ROUND · FIRE TO LIE DOWN AND AIM · INTERACT TO HANG FROM THE PIPE · FACE THE LADDER TO CLIMB DOWN`, 7000);
      } else {
        player.place(at.x + o.x, at.z + o.z, at.angle, floorY);
        aloft = null;
      }
      return;
    }
    if (a.kind === 'zip') {
      // Over the water on the trolley: along the cable, hanging by the handle, and off at the far end.
      a.t = Math.min(1, a.t + dt / DOCK_ZIPLINE.rideS);
      const k = a.t * a.t * (3 - 2 * a.t);
      const p = zipPoint(k);
      const heading = Math.atan2(DOCK_ZIPLINE.to.x - DOCK_ZIPLINE.from.x, DOCK_ZIPLINE.to.z - DOCK_ZIPLINE.from.z);
      const handY = floorY + p.y - 1.15;
      player.hold(p.x + o.x, handY - player.hangDrop, p.z + o.z, heading, 'hang', dt, 0, handY);
      if (a.t >= 1) {
        const land = yard!.zip.land;
        player.place(land.x + o.x, land.z + o.z, heading, floorY);
        aloft = null;
        drawRope(null, null);
        sound.play('doorOpen', undefined, 0.3);
        hud.showToast('ACROSS · THE ZIPLINE ONLY RUNS ONE WAY; THE BRIDGE IS THE WAY BACK', 'neutral', 4200);
      }
      return;
    }
    if (a.kind === 'haul') {
      a.t = Math.min(HAUL_S, a.t + dt);
      const k = a.t / HAUL_S;
      const e = k * k * (3 - 2 * k);
      const p = pointOnLine(plan, a.grip.line, a.grip.along, CELL);
      const hangY = floorY + PIPE_HEIGHT - player.hangDrop;
      const f = gripFacing(plan, a.grip);
      const angle = a.angle + angleTo(a.angle, Math.atan2(f.x, f.z)) * e;
      const x = a.from.x + (p.x + o.x - a.from.x) * e;
      const z = a.from.z + (p.z + o.z - a.from.z) * e;
      const y = a.from.y + (hangY - a.from.y) * e;
      strength = Math.max(0, strength - (HAUL_COST * dt) / HAUL_S);
      player.hold(x, y, z, angle, 'hang', dt, k * 2);
      drawRope(new THREE.Vector3(p.x + o.x, floorY + PIPE_HEIGHT, p.z + o.z), new THREE.Vector3(x, y + player.hangDrop, z));
      if (a.t >= HAUL_S) {
        let tower = -1;
        let near = Infinity;
        plan.towers.forEach((t, i) => {
          const d = Math.hypot(t.x * CELL - p.x, t.y * CELL - p.z);
          if (d < near) {
            near = d;
            tower = i;
          }
        });
        aloft = { kind: 'hang', floor: a.floor, tower, grip: a.grip, angle, lift: 1, back: false, travel: 0, turned: true, hooked: true };
        drawRope(new THREE.Vector3(p.x + o.x, floorY + PIPE_HEIGHT, p.z + o.z), null);
        sound.play('drag', undefined, 0.5);
      }
      return;
    }
    if (a.kind === 'perch') {
      strength = stepStrength(strength, 'perch', dt);
      const c = rig.towers[a.tower]!;
      // Aiming, the turn is the crosshair's: slower and finer (the stick, the keys or the mouse), and nothing on the way is a wall.
      if (aiming) {
        const sens = controlSettings.turn / DEFAULT_CONTROLS.turn * controlSettings.aim;
        a.angle -= aimInput(turnIn, onTouch(), controlSettings.aim) * AIM_TURN_RATE * dt + aimMouse * AIM_MOUSE_RAD * sens;
        // W and S, the stick's up and down, or the mouse's, tilt it: up tilts up.
        aimPitch = Math.max(PERCH_AIM_MIN_PITCH, Math.min(PERCH_AIM_MAX_PITCH, aimPitch + aimInput(throttleIn, onTouch(), controlSettings.aim) * PERCH_AIM_PITCH_RATE * dt - aimMouseY * AIM_MOUSE_RAD * sens));
        aimMouse = 0;
        aimMouseY = 0;
        player.aimWalls = [];
      } else a.angle -= turnIn * PERCH_TURN_SPEED * dt;
      // Lying down, the agent slides from under the pipe to the middle of the platform, where all of it is on the boards.
      const lie = player.lieAmount;
      player.hold(c.top.x + (c.lieAt.x - c.top.x) * lie + o.x, floorY + c.top.y, c.top.z + (c.lieAt.z - c.top.z) * lie + o.z, a.angle, 'perch', dt);
      player.aimPitch = aiming ? aimPitch : 0;
      if (aiming) showCrosshair(a.floor);
      if (throttleIn < -0.5 && !duckLatch && !aiming) climbDown(); // pulling back is a shortcut (after a duck, once the stick has been let go)
      return;
    }
    if (a.kind === 'hang') {
      if (a.lift < 1 || a.back) {
        a.lift = a.back ? Math.max(0, a.lift - dt / GRAB_S) : Math.min(1, a.lift + dt / GRAB_S);
      } else if (a.low && a.low > 0.02) {
        // Lowered on the line: it pays out or hauls in, and the agent hangs there, hands on the work.
      } else {
        const dist = throttleIn * SHIMMY_SPEED * dt;
        if (dist !== 0) {
          a.grip = shimmy(plan, a.grip, dist, CELL);
          a.travel += Math.abs(dist);
        }
        if (Math.abs(turnIn) > 0.5 && !a.turned) {
          a.turned = true;
          const next = turnOnto(plan, a.grip, turnIn > 0 ? 1 : -1, CELL);
          if (next) a.grip = next;
          else toastOnce('turn', 'TURN WHERE THE PIPES CROSS · AT A JUNCTION BOX', 3600);
        } else if (Math.abs(turnIn) < 0.3) a.turned = false;
      }
      const f = gripFacing(plan, a.grip);
      a.angle += angleTo(a.angle, Math.atan2(f.x, f.z)) * Math.min(1, dt * HANG_TURN_RATE);
      const p = pointOnLine(plan, a.grip.line, a.grip.along, CELL);
      // (A floor too short of straight corridor can have no tower at all: a grapple hang has no platform to rise from.)
      const perchY = rig.towers[a.tower]?.top.y ?? 0;
      const hangY = PIPE_HEIGHT - player.hangDrop;
      const raisedY = floorY + perchY + (hangY - perchY) * a.lift;
      if (a.hooked && a.lift >= 1) {
        const span = Math.max(0.01, raisedY - (floorY + HOVER_HEIGHT));
        const step = (LOWER_SPEED * dt) / span;
        a.low = Math.min(1, Math.max(0, (a.low ?? 0) + (a.lowering ? step : -step)));
      }
      const low = a.low ?? 0;
      const lowE = low * low * (3 - 2 * low);
      const y = raisedY + (floorY + HOVER_HEIGHT - raisedY) * lowE;
      const handsY = floorY + PIPE_HEIGHT + (y + player.hangDrop - (floorY + PIPE_HEIGHT)) * lowE;
      // Lowered over something to work (a terminal to hack, a workstation, the uplink, the log server), the agent swings in on the cable to hang right over it, flat, face down,
      // hands on it. Anywhere else the hover stays upright, as it was: only a console earns the flat pose.
      const consoles: Spot[] = [
        ...a.floor.content.workstations.filter((w) => !w.captured).map((w) => ({ x: w.x, z: w.z, ...(w.facing !== undefined ? { facing: w.facing } : {}) })),
        ...a.floor.content.terminals.filter((t) => !t.hacked).map((t) => ({ x: t.x, z: t.z, ...(t.facing !== undefined ? { facing: t.facing } : {}) })),
        ...(a.floor.content.uplink ? [{ x: a.floor.content.uplink.x, z: a.floor.content.uplink.z, ...(a.floor.content.uplink.facing !== undefined ? { facing: a.floor.content.uplink.facing } : {}) }] : []),
        ...(a.floor.content.logServer ? [{ x: a.floor.content.logServer.x, z: a.floor.content.logServer.z, ...(a.floor.content.logServer.facing !== undefined ? { facing: a.floor.content.logServer.facing } : {}) }] : []),
      ];
      const near = a.hooked && low > 0.02 ? nearestTarget(p, consoles) : null;
      if (near) a.aimAt = near;
      a.flat = Math.min(1, Math.max(0, (a.flat ?? 0) + (near ? 1 : -1) * dt * 3));
      const flatK = lowE * (a.flat ?? 0) * (a.flat ?? 0) * (3 - 2 * (a.flat ?? 0));
      const swing = a.aimAt && flatK > 0 ? hoverPose(p, a.aimAt, a.angle) : null;
      const at = swing ? { x: p.x + (swing.x - p.x) * flatK, z: p.z + (swing.z - p.z) * flatK } : p;
      const facing = swing ? a.angle + angleTo(a.angle, swing.angle) * flatK : a.angle;
      player.hold(at.x + o.x, y, at.z + o.z, facing, 'hang', dt, a.travel, handsY, flatK);
      if (a.back && a.lift <= 0) {
        aloft = { kind: 'perch', floor: a.floor, tower: a.tower, angle: a.angle };
        drawRope(null, null);
      } else if (a.hooked) {
        // A hang on a grapple line is the agent's own strength: it runs down, faster shimmying, and gives out.
        const effort: Effort = a.back ? 'perch' : low > 0.02 ? 'hover' : throttleIn !== 0 ? 'shimmy' : 'hold';
        const before = strength;
        strength = stepStrength(strength, effort, dt);
        if (before >= 0.3 && strength < 0.3) {
          sound.play('beep', undefined, 0.6);
          hud.showToast(low > 0.02 ? keyed('YOUR ARMS ARE SHAKING · HAUL YOURSELF UP ({grapple}) BEFORE YOU DROP').toUpperCase() : 'YOUR ARMS ARE SHAKING · A PLATFORM TO REST ON, OR DROP NOW', 'bad', 3200);
        }
        drawRope(new THREE.Vector3(p.x + o.x, floorY + PIPE_HEIGHT, p.z + o.z), low > 0.02 ? player.ropeAnchor(new THREE.Vector3(at.x + o.x, y + player.hangDrop, at.z + o.z)) : null);
        if (strength <= 0 && !a.back) exhaustedFall(a);
      }
      return;
    }
    const fallS = Math.sqrt((2 * Math.max(0.01, a.from.y - floorY)) / FALL_G);
    a.t = Math.min(fallS, a.t + dt);
    const k = a.t / fallS;
    player.hold(a.from.x + (a.to.x - a.from.x) * k, Math.max(floorY, a.from.y - 0.5 * FALL_G * a.t * a.t), a.from.z + (a.to.z - a.from.z) * k, a.angle, 'fall', dt);
    if (a.tilt) player.tilt(a.tilt * (1 - Math.min(1, k / 0.7)));
    if (a.t >= fallS) land(a);
  }

  /**
   * The pipes' electric pulses: moved along, heard, and, for anyone hanging
   * from a pipe one runs down, warned of and then fatal.
   */
  function tickPulses(active: ActiveFloor): void {
    for (const { content } of storeys) {
      if (content.pipeRig) movePulses(content.pipeRig, content.pipes!, CELL, stats.seconds);
    }
    const rig = active.content.pipeRig;
    if (!rig) return;
    // The ceiling course keeps its pipes quiet until the pulse lesson.
    const live = grapple || corners ? false : !ceiling || station >= CEILING_PULSES_FROM;
    for (const p of rig.pulses) p.mesh.visible = live;
    if (!live) return;
    const o = active.rig.group.position;
    for (const p of rig.pulses) {
      const at = { x: p.mesh.position.x + o.x, y: p.mesh.position.y + o.y, z: p.mesh.position.z + o.z };
      let hum = pulseHums.get(p);
      if (!hum) {
        hum = sound.loop('pulse', at, PULSE_VOLUME);
        pulseHums.set(p, hum);
      }
      hum.move(at.x, at.y, at.z);
    }
    if (aloft?.kind !== 'hang' || aloft.lift < 0.5) return;
    const { grip } = aloft;
    for (const p of rig.pulses) {
      if (p.line !== grip.line) continue;
      const gap = grip.along - p.along;
      if (Math.abs(gap) < PULSE_HIT) {
        electrocute();
        return;
      }
      if (Math.sign(gap) === p.dir && Math.abs(gap) < PULSE_WARN) pulseThreatAt = stats.seconds;
      if (Math.sign(gap) === p.dir && Math.abs(gap) < PULSE_WARN && stats.seconds - pulseWarnedAt > PULSE_WARN_S) {
        pulseWarnedAt = stats.seconds;
        pulseWarnings++;
        sound.play('beep', undefined, 0.7);
        hud.pulseDanger();
        hud.showToast(hovering() ? 'PULSE COMING DOWN YOUR PIPE · DROP NOW' : 'PULSE COMING DOWN YOUR PIPE · GET OFF IT: A PLATFORM, ANOTHER PIPE, OR DROP', 'bad', 2600);
      }
    }
  }

  /**
   * The moving lasers: turned and slid to where they are now, their hums
   * following; saying, the first time you come near one, how to get past;
   * and catching you if you don't. A sweeper's beam passes over anyone
   * sneaking, or sliding under it at the end of a dash; nothing ducks a
   * curtain. A cloak gets through both.
   */
  function tickMovingLasers(active: ActiveFloor, localX: number, localZ: number, sneaking: boolean, frozen: boolean, gatePosture: 'stand' | 'crouch' | 'prone'): void {
    for (const { content } of storeys) {
      for (const m of [...content.sweepers, ...content.sliders, ...content.lines]) m.rig.update(stats.seconds);
      for (const g of content.gates) g.rig.update(stats.seconds);
    }
    for (const h of laserHums) {
      const rig = storeys[h.idx]?.rig;
      if (!h.follow || !rig) continue;
      const o = rig.group.position;
      h.loop.move(h.follow.hum.x + o.x, o.y + h.follow.hum.y, h.follow.hum.z + o.z);
    }
    const near = (x: number, y: number): boolean => Math.hypot(x * CELL - localX, y * CELL - localZ) < CELL * LASER_HINT_CELLS;
    if (active.content.sweepers.some(({ laser }) => near(laser.x, laser.y))) toastOnce('sweeper', 'SWEEPING LASER · SNEAK TO DUCK UNDER THE BEAM', 4200);
    const nearSlider = active.content.sliders.some(({ laser: l }) => {
      for (let i = l.from; i <= l.to; i++) if (l.axis === 'x' ? near(i, l.at) : near(l.at, i)) return true;
      return false;
    });
    if (nearSlider) toastOnce('slider', 'LASER CURTAIN · YOU CAN’T DUCK IT: STEP INTO A SIDE PASSAGE AND LET IT PASS, OR CLOAK THROUGH', 5200);
    // Gates: close to one, say what it is (once a kind); in its plane, it measures you, cloaked or not.
    for (const { gate } of active.content.gates) {
      if (!training && Math.hypot(gate.x * CELL - localX, gate.y * CELL - localZ) < CELL * LASER_HINT_CELLS) toastOnce(`gate-${gate.kind}`, GATE_HINT[gate.kind], 6000);
    }
    // Line lasers: the same, hinted once a kind, and they measure you (a cloak is no use).
    for (const { laser } of active.content.lines) {
      if (!training && Math.hypot(laser.x * CELL - localX, laser.y * CELL - localZ) < CELL * LASER_HINT_CELLS) toastOnce(`line-${laser.orient}`, LINE_HINT[laser.orient], 6400);
    }
    if (!frozen && !aloft && !caught) {
      for (const { gate } of active.content.gates) {
        if (gateHits(gate, stats.seconds, localX, localZ, CELL, PLAYER_R, gatePosture)) tripLaser(gate, active);
      }
      for (const { laser } of active.content.lines) {
        if (lineHits(laser, stats.seconds, localX, localZ, CELL, PLAYER_R, gatePosture)) tripLaser(laser, active);
      }
    }
    if (frozen || aloft || camo.active || caught) return;
    for (const { laser } of active.content.sweepers) {
      if (!sneaking && !player.low && sweeperHits(laser, stats.seconds, localX, localZ, CELL, PLAYER_R)) tripLaser(laser, active);
    }
    for (const { laser } of active.content.sliders) {
      if (sliderHits(laser, stats.seconds, localX, localZ, CELL, PLAYER_R)) tripLaser(laser, active);
    }
  }

  /** Says, once a job each, when a dash (G, then Space) would get you out of the way. */
  function tickDashHints(active: ActiveFloor, localX: number, localZ: number): void {
    const how = onTouch() ? 'OPEN YOUR KIT, TAP TRAP TO AIM, THEN DASH' : keyed('{trap} TO AIM, THEN {interact}').toUpperCase();
    for (const { laser: l } of active.content.sliders) {
      if (l.speed <= SLIDE_SPEED) continue;
      const along = l.axis === 'x' ? localX : localZ;
      const across = l.axis === 'x' ? localZ : localX;
      if (Math.abs(across - l.at * CELL) > CELL / 2) continue;
      if (along < l.from * CELL - CELL || along > l.to * CELL + CELL) continue;
      const now = slidePosition(l, stats.seconds, CELL);
      const heading = slidePosition(l, stats.seconds + 0.05, CELL) - now;
      const gap = along - now;
      if (Math.sign(gap) === Math.sign(heading) && Math.abs(gap) < DASH_HINT_RANGE) {
        toastOnce('dash-curtain', `FAST CURTAIN COMING · DUCK INTO A SIDE PASSAGE, THEN DASH FOR THE END: ${how}`, 5200);
      }
    }
    const coverNear = active.rig.wallBoxes.some((b) => b.cover && Math.hypot((b.minX + b.maxX) / 2 - player.worldX, (b.minZ + b.maxZ) / 2 - player.worldZ) < DASH_HINT_COVER);
    if (!coverNear) return;
    for (const e of active.content.enemies) {
      if (!(e instanceof Bot) || e.disabled || e.alert || !e.moving) continue;
      const dx = player.worldX - e.worldX;
      const dz = player.worldZ - e.worldZ;
      const d = Math.hypot(dx, dz);
      if (d > DASH_HINT_RANGE || d < 0.1) continue;
      const toward = (dx / d) * Math.sin(e.facing) + (dz / d) * Math.cos(e.facing);
      if (toward < 0.8 || !hasLineOfSight(e.worldX, e.worldZ, player.worldX, player.worldZ, active.rig.wallBoxes, DASH_HINT_RANGE)) continue;
      toastOnce('dash-guard', `A GUARD’S HEADING YOUR WAY · DASH INTO COVER: ${how}`, 5200);
      return;
    }
  }

  const laserTrippedAt = new Map<Sweeper | Slider | Gate | LineLaser, number>();

  /** Caught by a moving laser: suspicion, and the guards nearby come to see what set it off. */
  function tripLaser(laser: Sweeper | Slider | Gate | LineLaser, active: ActiveFloor): void {
    if (training && !tower) {
      triggerCaught('Caught in a laser', 'A moving laser caught you.'); // in training: back to the station's start
      return;
    }
    if (stats.seconds - (laserTrippedAt.get(laser) ?? -Infinity) < LASER_TRIP_COOLDOWN_S) return;
    laserTrippedAt.set(laser, stats.seconds);
    const at = { x: player.worldX, y: player.worldY + 1.2, z: player.worldZ };
    sound.play('alert', at);
    bursts.sparks(new THREE.Vector3(at.x, at.y, at.z), 0xff2e3d);
    player.shake(0.3);
    hud.pulseDanger();
    const { navCells, cols, rows } = active.content;
    for (const e of active.content.enemies) if (e instanceof Bot && !e.disabled) e.investigate(player.worldX, player.worldZ, 4, navCells, cols, rows, LASER_CALLS_CELLS);
    suspicion = applySuspicion(suspicion, LASER_TRIP_SUSPICION);
    hud.setSuspicion(suspicion);
    hud.showToast(healthMode ? `CAUGHT IN A LASER · HEALTH −${LASER_TRIP_SUSPICION}` : `CAUGHT IN A LASER · SUSPICION +${LASER_TRIP_SUSPICION}%`, 'bad');
    if (isCaught(suspicion)) triggerCaught('Caught in a laser', 'A moving laser raised the alarm.');
  }

  /** A pulse reached the agent's hands. */
  function electrocute(): void {
    const at = new THREE.Vector3(player.worldX, player.worldY + player.hangDrop, player.worldZ);
    bursts.sparks(at, 0x9fe8ff);
    blasts.zap(() => new THREE.Vector3(at.x, at.y + 1.6, at.z), () => new THREE.Vector3(player.worldX, player.worldY + 1.2, player.worldZ), 1.1);
    sound.play('emp', { x: at.x, y: at.y, z: at.z });
    player.shake(1);
    hud.pulseDanger();
    triggerCaught('Electrocuted', 'A pulse ran down the pipe you were hanging from.');
  }

  /** On a tower's lookout, the chase camera (already placed) rises and pulls back a little: `k` 0 not at all, to 1. */
  function lookoutCamera(k: number): void {
    const w = k * k * (3 - 2 * k);
    const f = player.facingAngle;
    root.camera.position.add(new THREE.Vector3(-Math.sin(f) * LOOKOUT_BACK * w, LOOKOUT_RISE * w, -Math.cos(f) * LOOKOUT_BACK * w));
    root.camera.lookAt(player.worldX, player.worldY + 1, player.worldZ);
  }

  /** Tags every enemy on `floor` within the lookout's reach (world (x, z)), and shows the tags still running on it. */
  function tickTags(floor: ActiveFloor, perched: boolean): void {
    for (const e of floor.content.enemies) {
      if (perched && !e.disabled && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) <= LOOKOUT_RADIUS) tags.set(e, stats.seconds + TAG_S);
    }
    const shown: Array<{ x: number; y: number; z: number; alpha: number }> = [];
    for (const [e, until] of tags) {
      if (e.disabled || until <= stats.seconds) {
        tags.delete(e);
        continue;
      }
      if (!floor.content.enemies.includes(e)) continue;
      const y = e instanceof Drone ? e.airPosition.y + 0.9 : e.floorY + (e instanceof Bot ? 2.8 : 1.4);
      shown.push({ x: e.worldX, y, z: e.worldZ, alpha: Math.min(1, (until - stats.seconds) / TAG_FADE_S) });
    }
    tagMarkers.update(shown);
  }

  /** A quick sidestep dash, left (-1) or right (+1): shots that land in the first moment of it miss. */
  function handleDodge(dir: number): void {
    if (silent) return;
    if (proneBlocks()) return;
    if (cleared || caught || paused() || handsFull() || aloft || dodgeCooldown > 0) return;
    leaveCover();
    player.dodge(dir);
    dodgeCooldown = DODGE_COOLDOWN_S;
    dodgeUntil = stats.seconds + DODGE_SAFE_S;
    sound.play('dodge');
  }

  /** Space while something closes in: bullet time on (or, with nothing else to do, off again). */
  function toggleBulletNow(): void {
    if (!bulletOk || paused() || cleared || caught) return;
    const next = toggleBullet(bullet);
    if (next.on === bullet.on) {
      if (!bullet.on) {
        sound.play('denied');
        hud.showToast('BULLET TIME RECHARGING', 'neutral');
      }
      return;
    }
    bullet = next;
    bulletOfferHold = 0;
    sound.play(next.on ? 'bulletIn' : 'bulletOut', undefined, 0.9);
  }

  function handleInteract(): void {
    // Something closing in and the meter has enough: Space is bullet time before anything else; once it is on, Space with nothing to interact with ends it.
    if (bulletOk && !paused() && !cleared && !caught && (bullet.on ? !nearbyTarget : bulletOfferHold > 0)) {
      toggleBulletNow();
      return;
    }
    if (proneBlocks()) return;
    // Lining up a trap, Interact (Space) dashes to where its line ends instead.
    if (trapAiming) {
      dashToAim();
      return;
    }
    if (!nearbyTarget || paused() || cleared || caught || stashing) return;
    const target = nearbyTarget;
    if (target.kind === 'climb') {
      startClimb(target.tower, target.floor);
      return;
    }
    if (target.kind === 'towerLift') {
      rideTowerLift();
      return;
    }
    if (target.kind === 'towerKey') {
      takeTowerKey();
      return;
    }
    if (target.kind === 'towerConsoleDone') {
      hud.showToast('EVERY CAMERA IS SWITCHED OFF · NOTHING LEFT TO LOOP', 'good', 3000);
      return;
    }
    if (target.kind === 'towerConsole') {
      if (camerasAllDown()) return;
      loopCameraFeed();
      return;
    }
    if (target.kind === 'stairConsole') {
      stairOpenUntil = stats.seconds + STAIR_OPEN_S;
      sound.play('hackDone');
      sound.play('liftDoors', { x: 0, y: 8, z: 8 }, 0.7);
      hud.showToast(`STAIR LOWERED · ${STAIR_OPEN_S} SECONDS`, 'good', 3000);
      return;
    }
    if (target.kind === 'cameraPanel') {
      const c = towerCams[target.cam];
      if (c && !c.perm) switchCameraOff(c, false);
      return;
    }
    if (target.kind === 'ledgeHang') {
      startLedge(target.near);
      return;
    }
    if (target.kind === 'ledgePull') {
      pullOverGuard(target.guard);
      return;
    }
    if (target.kind === 'ledgeUp') {
      if (aloft?.kind === 'ledge' && aloft.phase === 'hang' && !guardPull) {
        aloft.phase = 'out';
        aloft.t = 0;
        aloft.dur = LEDGE_PULL_S;
        sound.play('drag', undefined, 0.6);
      }
      return;
    }
    if (target.kind === 'towerDoor') {
      if (!handedOn) handOnToHeist();
      return;
    }
    if (target.kind === 'zip') {
      aloft = { kind: 'zip', floor: target.floor, t: 0 };
      sound.play('drag', undefined, 0.7);
      hud.showToast('HOLD ON · OVER THE WATER · OUT IN THE OPEN, WHERE ANYONE LOOKING CAN SEE YOU', 'neutral', 3600);
      return;
    }
    if (target.kind === 'hang') {
      grabPipe();
      return;
    }
    if (target.kind === 'climbDown') {
      climbDown();
      return;
    }
    if (target.kind === 'perch') {
      backToPlatform();
      return;
    }
    if (target.kind === 'letGo') {
      letGo();
      return;
    }
    if (target.kind === 'revive') {
      startPartnerWork();
      return;
    }
    if (target.kind === 'wallJump') {
      startWallJump();
      return;
    }
    if (target.kind === 'wallRoll' || target.kind === 'wallDrop') {
      startWallRoll(target.kind === 'wallDrop');
      return;
    }
    if (target.kind === 'hideLocker') {
      enterLocker(target.locker, target.floor);
      return;
    }
    if (target.kind === 'switch' || target.kind === 'breaker') {
      setFitting(target.fitting, target.floor, !target.fitting.on, true);
      return;
    }
    if (target.kind === 'exitLocker') {
      exitLocker();
      return;
    }
    if (target.kind === 'vent') {
      enterVent(target.to, target.floor);
      return;
    }
    if (target.kind === 'cover') {
      enterCover(target.spot);
      return;
    }
    if (target.kind === 'leaveCover') {
      leaveCover();
      return;
    }
    if (target.kind === 'body') {
      carried = target.bot;
      carried.pickUp();
      sound.play('drag');
      hud.showToast('BODY IN YOUR ARMS · CARRY IT INTO THE DARK OR A ROOM · WATCH HOW VISIBLE IT IS', 'neutral', 4200);
      return;
    }
    if (target.kind === 'glass') {
      breakGlass();
      return;
    }
    if (target.kind === 'drop') {
      dropBody();
      return;
    }
    if (target.kind === 'stash') {
      startStash(target.spot, target.floor);
      return;
    }
    if (target.kind === 'release') {
      openDoor(target.door, target.floor);
      sound.play('hackDone', worldAt(target.floor.rig, target.door.center.x, target.door.center.z));
      hud.showToast('EMERGENCY RELEASE · THE DOOR OPENS FROM THE INSIDE', 'good', 3600);
      return;
    }
    if (target.kind === 'terminal') {
      activeHack = { terminal: target.terminal, floor: target.floor };
      activeTask = null;
      shutterHack = null;
      return;
    }
    if (target.kind === 'capture' && captureLocked()) {
      // The workstation is locked until the uplink is down: nothing to start.
      sound.play('denied', worldAt(target.floor.rig, target.station.x, target.station.z));
      hud.showToast(`${target.station.step ? 'LOCKED' : 'WORKSTATION LOCKED'} · THE ${contract === 'records' ? 'UPLINK' : 'ALARM LINK'} IS STILL ONLINE · TAKE IT DOWN FIRST`, 'bad', 3600);
      return;
    }
    if (target.kind === 'capture' && stepBlockedNow(target.station)) {
      // A contract step that needs another done first (the keycard, the vault, the manifest): say which.
      sound.play('denied', worldAt(target.floor.rig, target.station.x, target.station.z));
      hud.showToast(stepBlockedNow(target.station)!, 'bad', 4200);
      return;
    }
    if (target.kind === 'wipe' && wipeLocked()) {
      sound.play('denied', worldAt(target.floor.rig, target.station.x, target.station.z));
      hud.showToast('LOG CONSOLE LOCKED · PHOTOGRAPH EVERY FILE FIRST, THEN WIPE THE LOGS', 'bad', 3600);
      return;
    }
    if (target.kind === 'uplink' || target.kind === 'capture' || target.kind === 'wipe' || target.kind === 'cutLine' || target.kind === 'clue' || target.kind === 'crate' || target.kind === 'slide') {
      activeTask = target;
      activeHack = null;
      shutterHack = null;
      return;
    }
    if (target.kind === 'shutter') {
      shutterHack = { shutter: target.shutter, panel: target.panel, floor: target.floor, progress: 0 };
      activeHack = null;
      activeTask = null;
      return;
    }
    if (target.kind === 'server') {
      powerServer(target.server, target.floor);
      return;
    }
    const { rig, x, z } = target.locker;
    rig.open();
    stats.lockersOpened++;
    if (rig.content === 'rigged') stats.riggedLockers++;
    sound.play('lockerOpen', worldAt(target.floor.rig, x, z));
    // What's inside is heard as the door swings clear.
    window.setTimeout(() => sound.play(rig.content), 480);
    applyOutcome(target.floor, lockerOutcome(rig.content), target.locker);
  }

  /**
   * Laser sights (sights.ts): green from the agent's gun, while aiming, to where the shot will land (a body, or the wall); red from the gun of each guard near the agent (always on,
   * dimmer until the guard is after them), going white where it is on them.
   */
  function updateSights(dt: number): void {
    const floor = currentFloor();
    const floorY = floor.rig.group.position.y;
    if (aiming && !fpsOn() && !caught && !cleared && !hiddenIn) { // (first person has the crosshair: no green line from the gun)
      const from = player.muzzleWorldPosition;
      const hit = aimedHit(floor);
      const dir = crosshairRay()?.dir ?? new THREE.Vector3(Math.sin(player.facingAngle) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(player.facingAngle) * Math.cos(aimPitch));
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : traceEnd(from, dir, perchLike() ? PERCH_AIM_RANGE : FIRE_RANGE, floor.rig.wallBoxes, floorY);
      sights.player({ from, to }, dt);
    } else sights.player(null, dt);
    const lines: EnemySight[] = [];
    if (!caught && !cleared) {
      const chest = new THREE.Vector3(player.worldX, player.worldY + 1.2, player.worldZ);
      for (const e of floor.content.enemies) {
        if (!(e instanceof Bot) || e.incapacitated || !e.mesh.visible) continue;
        const from = e.muzzleWorldPosition;
        if (Math.hypot(from.x - chest.x, from.z - chest.z) > SIGHT_SHOWN_M) continue;
        const dir = new THREE.Vector3(Math.sin(e.facing), 0, Math.cos(e.facing));
        const end = traceEnd(from, dir, 16, floor.rig.wallBoxes, floorY);
        // On the agent: the line passes within a body's width of the chest before it meets a wall.
        const along = (chest.x - from.x) * dir.x + (chest.z - from.z) * dir.z;
        const off = Math.abs((chest.x - from.x) * dir.z - (chest.z - from.z) * dir.x);
        const lock = along > 0 && off < 0.45 && along <= from.distanceTo(end) + 0.5;
        lines.push({ from, to: lock ? new THREE.Vector3(chest.x, from.y, chest.z) : end, lock, alert: e.alert || e.creeping, warn: e.laserWarn });
        if (highwall && lock && e.laserWarn > 0.2) toastOnce('laser', 'A GUARD’S LASER IS ON YOU · STEP OFF THE LINE, OR LIE FLAT OR HIDE: LEFT THERE HE WILL COME CREEPING UP TO SEE', 6000);
      }
      lines.sort((a, b) => a.from.distanceToSquared(chest) - b.from.distanceToSquared(chest));
    }
    sights.enemies(lines);
  }

  const SIGHT_SHOWN_M = 16; // guards this near show their laser, whatever they are doing: the nearest few
  const SKY_REACH = 2.6; // a guard this close to the spot under the agent takes the fall
  const GLASS_HEARD_CELLS = 4; // breaking glass brings guards this many cells away

  /** Whether the agent stands over the skylight's cell. */
  function onSkylight(): boolean {
    return sky !== null && Math.abs(player.worldX - sky.wx) < CELL * 0.45 && Math.abs(player.worldZ - sky.wz) < CELL * 0.45;
  }

  /** Lying on the glass, Interact breaks it: the cracks spread, then it goes. */
  function breakGlass(): void {
    if (!sky || sky.rig.state !== 'intact') return;
    const s = sky;
    sound.play('glass', { x: s.wx, y: floor1!.group.position.y, z: s.wz }, 0.7);
    s.rig.crack(() => {
      const y = floor1!.group.position.y;
      blasts.glass(new THREE.Vector3(s.wx, y + 0.05, s.wz), CELL, floor0.group.position.y);
      sound.play('glass', { x: s.wx, y, z: s.wz });
      sound.play('boom', { x: s.wx, y, z: s.wz }, 0.35);
      player.shake(0.6);
      for (const { content } of storeys) {
        for (const e of content.enemies) if (!e.disabled && e instanceof Bot) e.investigate(s.wx, s.wz, 4, content.navCells, content.cols, content.rows, GLASS_HEARD_CELLS);
      }
      if (onSkylight() && !aloft && activeFloorIdx === 1) plungeThroughGlass();
    });
  }

  /** Down through the hole onto the ground floor: a guard under the agent is taken out from above, otherwise it is a loud landing. */
  function plungeThroughGlass(): void {
    if (!sky) return;
    const floor: ActiveFloor = { rig: floor0, content: floor0Content };
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    let target: Enemy | null = null;
    let best = SKY_REACH;
    for (const e of floor0Content.enemies) {
      if (e.disabled || !(e instanceof Bot)) continue;
      const d = Math.hypot(e.worldX - from.x, e.worldZ - from.z);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    let to = { x: from.x, z: from.z };
    let angle = player.facingAngle;
    if (target) {
      const d = Math.hypot(target.worldX - from.x, target.worldZ - from.z);
      const k = d > AERIAL_LAND ? (d - AERIAL_LAND) / d : 0;
      const spot = { x: from.x + (target.worldX - from.x) * k, z: from.z + (target.worldZ - from.z) * k };
      if (!collides(spot.x, spot.z, floor0.wallBoxes)) to = spot;
      if (d > 0.05) angle = Math.atan2(target.worldX - from.x, target.worldZ - from.z);
    }
    if (collides(to.x, to.z, floor0.wallBoxes)) to = { x: floor0.group.position.x + sky.x0 * CELL, z: floor0.group.position.z + sky.y0 * CELL };
    leaveCover();
    if (aiming) setAiming(false);
    activeTask = null;
    activeHack = null;
    hud.setHack(null);
    aloft = { kind: 'fall', floor, from, to, angle, t: 0, target };
  }

  // ---- the tower (towerplan.ts): its lift, and its heist door ----

  /** The lift cab the agent is in or at the doors of, on this storey. */
  function towerLiftHere(): { level: number; id: string; rig: ElevatorRig } | null {
    return towerLifts.find((l) => l.level === activeFloorIdx && (l.rig.contains(player.worldX, player.worldZ) || Math.hypot(player.worldX - l.rig.front.x, player.worldZ - l.rig.front.z) < 1.1)) ?? null;
  }

  /** Rides the lift to the next storey it serves (the top goes back to the bottom), and puts the agent down in its cab, facing out. */
  function rideTowerLift(): void {
    const here = towerLiftHere();
    if (!here) return;
    const lift = TOWER_LIFTS.find((l) => l.id === here.id)!;
    if (lift.locked && !hasKey) {
      sound.play('denied');
      hud.showToast('SERVICE LIFT · IT WANTS A KEYCARD', 'bad', 2600);
      return;
    }
    const serves = lift.serves;
    const next = serves[(serves.indexOf(here.level) + 1) % serves.length]!;
    const to = towerLifts.find((l) => l.level === next && l.id === here.id)!;
    const at = to.rig.spawn;
    sound.play('liftRide', undefined, 0.8);
    // A lift is loud: the guards near its doors, where it was called from and where it arrives, come to see.
    let heard = 0;
    for (const [lvl, spot, cells] of [[here.level, here.rig.front, LIFT_HEARD_CELLS - 2], [next, to.rig.front, LIFT_HEARD_CELLS]] as const) {
      const f = storeys[lvl]!;
      for (const e of f.content.enemies) {
        if (e instanceof Bot && !e.disabled && e.investigate(spot.x, spot.z, 4, f.content.navCells, f.content.cols, f.content.rows, cells)) heard++;
      }
    }
    sound.play('liftDoors', { x: to.rig.front.x, y: next * floorHeight + 1.2, z: to.rig.front.z }, 0.9);
    player.place(at.x, at.z, at.facing, next * floorHeight);
    hud.showToast(`LIFT · ${(towerFloorNames[next] ?? '').toUpperCase()}${heard > 0 ? ` · THE DOORS WERE LOUD: ${heard} GUARD${heard === 1 ? '' : 'S'} HEARD AND ${heard === 1 ? 'IS' : 'ARE'} COMING` : ' · THE DOORS WERE LOUD'}`, heard > 0 ? 'bad' : 'neutral', 2800);
  }

  /** Every storey's keycard is in hand: the heist door will open. */
  /** How many of this storey's high cameras that are still on have (x, z) in view: the keycard's desk, for takeTowerKey. */
  const cardWatchers = (level: number, x: number, z: number): number =>
    towerCams.filter((c) => !c.perm && c.rig.plan.high === true && c.rig.plan.level === level && cameraSees(c.rig.plan, 0, x, z, storeys[level]!.rig.wallBoxes, false, botCanSee)).length;
  const allCards = (): boolean => TOWER_CARDS.every((c) => cardsHeld.has(c.level));
  /** The service lift opens on both storeys it joins, and the back offices' keycard doors: the gallery's card does it (the exit level starts with it done). */
  function unlockTowerAccess(): void {
    hasKey = true;
    for (const l of towerLifts) {
      if (!TOWER_LIFTS.find((t) => t.id === l.id)!.locked) continue;
      l.rig.setState('ready');
      l.rig.setOpen(true);
      const walls = storeys[l.level]!.rig.wallBoxes;
      const i = walls.indexOf(l.rig.doorBox);
      if (i !== -1) walls.splice(i, 1);
      sound.play('liftDoors', { x: l.rig.front.x, y: l.level * floorHeight + 1.2, z: l.rig.front.z }, 0.6);
    }
    for (const d of officeDoors) d.rig.unlock();
  }

  /** The keycard on this storey's desk is taken. The gallery's also opens the service lift on both storeys it joins, and the keycard doors of the back offices. */
  function takeTowerKey(): void {
    const level = activeFloorIdx;
    const desk = towerCards.get(level);
    if (!desk || cardsHeld.has(level)) return;
    // A high camera (on a pylon: it is fixed, a half circle wide, aimed at the desk) with the card in view: the card stays where it is until that camera is switched off.
    if (cardWatchers(level, desk.position.x, desk.position.z) > 0) {
      sound.play('denied');
      hud.showToast('A CAMERA IS WATCHING THE KEYCARD · SWITCH IT OFF FIRST: CLIMB ITS PYLON AND HANG BESIDE THE PANEL (THE FAR FACE IS OUT OF ITS VIEW)', 'bad', 5200);
      return;
    }
    cardsHeld.add(level);
    // The card alone comes off the desk; the desk stays where it is.
    (desk.userData.card as THREE.Object3D | undefined)?.removeFromParent();
    towerCards.delete(level);
    hud.setDocuments(cardsHeld.size, TOWER_CARDS.length);
    sound.play('loot');
    const name = towerFloorNames[level] ?? `Floor ${level}`;
    if (level === TOWER_KEYCARD.level) unlockTowerAccess();
    towerCheckpoint(`Keycard · ${name}`);
    const left = TOWER_CARDS.length - cardsHeld.size;
    const extra = level === TOWER_KEYCARD.level ? ' · THIS ONE ALSO OPENS THE SERVICE LIFT AND THE BACK OFFICES’ KEYCARD DOORS' : '';
    hud.showToast(left > 0 ? `KEYCARD ${cardsHeld.size}/${TOWER_CARDS.length} · ${name.toUpperCase()}${extra} · ${left} MORE FOR THE HEIST DOOR` : `KEYCARD ${cardsHeld.size}/${TOWER_CARDS.length} · THE HEIST DOOR ON THE OFFICES FLOOR WILL OPEN FOR YOU${extra}`, 'good', 5600);
    if (allCards()) towerHeist?.door.setLocked(false);
  }

  // ---- the bunker's ducts (bunkerplan.ts): a corridor of cells narrowed to a lane, roofed low, grated at its mouths; and the shafts at their ends ----

  function buildBunkerDucts(rig: FloorRig, level: number, storeyHeight: number): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x4b5963, roughness: 0.5, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x2c363e, roughness: 0.6, metalness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8fa3ae, roughness: 0.35, metalness: 0.6, transparent: true, opacity: 0.34, depthWrite: false });
    const half = CELL / 2;
    const w = DUCT_LANE / 2;
    const side = (dx: number, dy: number): 'N' | 'S' | 'E' | 'W' => (dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');
    const add = (m: THREE.Mesh): void => void rig.group.add(m);
    const ducts = ductsOn(level);
    const base = BUNKER_SHAFTS.find((s) => s.level === level); // a shaft climbs from this storey: its cell has no roof
    const top = BUNKER_SHAFTS.find((s) => s.level === level - 1); // and one comes up into this one
    for (const d of ducts) {
      d.cells.forEach((c, i) => {
        const open = { N: false, S: false, E: false, W: false };
        const prev = i > 0 ? d.cells[i - 1]! : d.ends[0];
        const next = i < d.cells.length - 1 ? d.cells[i + 1]! : d.ends[1];
        for (const nb of [prev, next]) if (nb && Math.abs(nb.x - c.x) + Math.abs(nb.y - c.y) === 1) open[side(nb.x - c.x, nb.y - c.y)] = true;
        // a spur hangs off this cell: its side is open too
        for (const o of ducts) {
          if (o === d) continue;
          const first = o.cells[0]!;
          if (o.ends[0] && o.ends[0].x === c.x && o.ends[0].y === c.y) open[side(first.x - c.x, first.y - c.y)] = true;
          const last = o.cells[o.cells.length - 1]!;
          if (o.ends[1] && o.ends[1].x === c.x && o.ends[1].y === c.y) open[side(last.x - c.x, last.y - c.y)] = true;
        }
        const isBase = base !== undefined && base.x === c.x && base.y === c.y;
        const cx = c.x * CELL;
        const cz = c.y * CELL;
        // the solid sides: walls to the body and the eye, and a box of dull steel for the picture
        for (const b of ductCellSolids(c.x, c.y, open)) {
          rig.wallBoxes.push({ ...b, cover: 'tall' });
          const height = isBase ? storeyHeight : DUCT_H + 0.3; // (a shaft's walls go up to the floor above)
          const m = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, height, b.maxZ - b.minZ), steel);
          m.position.set((b.minX + b.maxX) / 2, height / 2, (b.minZ + b.maxZ) / 2);
          add(m);
        }
        // the lane: from the middle to each open side; a space a standing agent cannot enter (crouch or lie down), seen through (a grate, a roof of slats)
        const lanes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [{ minX: cx - w, maxX: cx + w, minZ: cz - w, maxZ: cz + w }];
        if (open.N) lanes.push({ minX: cx - w, maxX: cx + w, minZ: cz - half, maxZ: cz - w });
        if (open.S) lanes.push({ minX: cx - w, maxX: cx + w, minZ: cz + w, maxZ: cz + half });
        if (open.E) lanes.push({ minX: cx + w, maxX: cx + half, minZ: cz - w, maxZ: cz + w });
        if (open.W) lanes.push({ minX: cx - half, maxX: cx - w, minZ: cz - w, maxZ: cz + w });
        lanes.forEach((b, li) => {
          rig.wallBoxes.push({ ...b, under: true, duct: true, see: true });
          if (isBase && li === 0) return; // (open overhead: the shaft)
          const roof = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 0.06, b.maxZ - b.minZ), roofMat);
          roof.position.set((b.minX + b.maxX) / 2, DUCT_H + 0.03, (b.minZ + b.maxZ) / 2);
          roof.userData.ductRoof = true;
          add(roof);
          // ribs across the roof, as an AC duct's seams
          const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
          const n = Math.max(1, Math.round(((alongX ? b.maxX - b.minX : b.maxZ - b.minZ) / 0.8)));
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const rib = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.06 : b.maxX - b.minX + 0.04, 0.05, alongX ? b.maxZ - b.minZ + 0.04 : 0.06), trim);
            rib.position.set(alongX ? b.minX + (b.maxX - b.minX) * t : (b.minX + b.maxX) / 2, DUCT_H + 0.07, alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + (b.maxZ - b.minZ) * t);
            add(rib);
          }
        });
      });
      // the grates: slats across the lane at each mouth
      const mouths: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = [];
      if (d.ends[0] && !ducts.some((o) => o !== d && o.cells.some((q) => q.x === d.ends[0]!.x && q.y === d.ends[0]!.y))) mouths.push({ from: d.cells[0]!, to: d.ends[0] });
      if (d.ends[1] && !ducts.some((o) => o !== d && o.cells.some((q) => q.x === d.ends[1]!.x && q.y === d.ends[1]!.y))) mouths.push({ from: d.cells[d.cells.length - 1]!, to: d.ends[1] });
      for (const m of mouths) {
        const dx = m.to.x - m.from.x;
        const dz = m.to.y - m.from.y;
        const gx = (m.from.x + m.to.x) * CELL / 2 - dx * 0.05;
        const gz = (m.from.y + m.to.y) * CELL / 2 - dz * 0.05;
        for (let k = -3; k <= 3; k++) {
          const slat = new THREE.Mesh(new THREE.BoxGeometry(dx !== 0 ? 0.05 : 0.04, DUCT_H - 0.25, dx !== 0 ? 0.04 : 0.05), trim);
          slat.position.set(gx + (dz !== 0 ? k * (DUCT_LANE / 7) : 0), (DUCT_H - 0.25) / 2 + 0.1, gz + (dx !== 0 ? k * (DUCT_LANE / 7) : 0));
          add(slat);
        }
        const frame = new THREE.Mesh(new THREE.BoxGeometry(dx !== 0 ? 0.08 : DUCT_LANE + 0.14, 0.08, dx !== 0 ? DUCT_LANE + 0.14 : 0.08), trim);
        frame.position.set(gx, DUCT_H, gz);
        add(frame);
      }
    }
    // The shaft: a line of the grapple's own blue hung from the hook at its head to the floor, and a ring on the floor to stand in; at the top of the climb, a grate in the duct's floor.
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x4cc8ff, transparent: true, opacity: 0.55, depthWrite: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4cc8ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    if (base) {
      const x = base.x * CELL;
      const z = base.y * CELL;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, storeyHeight + 1.35, 6), lineMat);
      line.position.set(x, (storeyHeight + 1.35) / 2, z);
      add(line);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.04, z);
      add(ring);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 16), new THREE.MeshStandardMaterial({ color: 0xc8d4dc, roughness: 0.4, metalness: 0.8 }));
      hook.position.set(x, storeyHeight + 1.35, z);
      add(hook);
      markBloom(line);
    }
    if (top) {
      const x = top.x * CELL;
      const z = top.y * CELL;
      for (let k = -3; k <= 3; k++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(DUCT_LANE - 0.1, 0.03, 0.05), trim);
        slat.position.set(x, 0.03, z + k * 0.19);
        add(slat);
      }
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 16), new THREE.MeshStandardMaterial({ color: 0xc8d4dc, roughness: 0.4, metalness: 0.8 }));
      hook.position.set(x, DUCT_H - 0.1, z);
      add(hook);
    }
  }

  // ---- furniture that can be shot to bits (the exit level) ----

  /** Hits a shot of each gun does to a piece. */
  const GUN_PUNCH: Record<string, number> = { Pistol_1: 1, SMG_1: 2, AR_4: 3, Sniper_2: 4 };

  /** Where a ray from (x, z) along (dx, dz) first meets `box`, within `range`: null for a miss. */
  function rayHitBox(x: number, z: number, dx: number, dz: number, box: WallBox, range: number): number | null {
    let t0 = 0;
    let t1 = range;
    for (const [o, d, lo, hi] of [[x, dx, box.minX, box.maxX], [z, dz, box.minZ, box.maxZ]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null;
      } else {
        let ta = (lo - o) / d;
        let tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return null;
      }
    }
    return t0;
  }

  /** The small flat patches bridging containers that touch only at a corner of storey `l` (without them the roof is cut there, and the agent falls through the gap). */
  function refreshBridges(l: number): void {
    for (const b of roofBridges.get(l) ?? []) {
      const i = stairs.indexOf(b);
      if (i >= 0) stairs.splice(i, 1);
    }
    const set = roofCellSets.get(l);
    const h = l * floorHeight + KINDS.cargo.height;
    const w = 2.2;
    const made: Stair[] = (set ? cornerBridges(set, CELL) : []).map((c) => ({ x: (c.x - w / 2) / CELL + 0.5, y: (c.z - w / 2) / CELL + 0.5, spanX: true, run: w / CELL, width: w / CELL, fromFloorY: h, toFloorY: h }));
    stairs.push(...made);
    roofBridges.set(l, made);
  }

  /** A container or a piece of furniture with a top has been smashed: its top is gone (no climbing on it, no walking on it, the agent on it falls), and guards patrolling it drop to the floor. */
  function unroofPiece(level: number, box: WallBox): void {
    const key = roofKey(box);
    const i = roofSurfaces.findIndex((r) => r.level === level && r.key === key);
    if (i < 0) return;
    const surface = roofSurfaces.splice(i, 1)[0]!;
    const si = stairs.indexOf(surface.stair);
    if (si >= 0) stairs.splice(si, 1);
    const storey = storeys[level]!;
    const ci = storey.rig.climbBoxes.findIndex((b) => roofKey(b) === key);
    if (ci >= 0) storey.rig.climbBoxes.splice(ci, 1);
    const set = roofCellSets.get(level);
    if (!set || surface.cells.length === 0) return;
    for (const c of surface.cells) set.delete(c);
    roofNavs.set(storey.content, roofNav(set, storey.content.cols, storey.content.rows) as MazeCells);
    refreshBridges(level);
    for (const e of storey.content.enemies) {
      if (!(e instanceof Bot) || !e.onRoofLayer) continue; // (a guard downed up there is on the floor now too)
      if (!set.has(`${Math.round(e.worldX / CELL)},${Math.round(e.worldZ / CELL)}`)) e.dropFromRoof(storey.rig.group.position.y);
    }
  }

  /** A piece is gone: out of the picture, out of the way (its box leaves the storey's walls), a burst of dust and splinters. */
  function smashPiece(level: number, d: Destructible): void {
    d.kill();
    d.hp = 0;
    const walls = storeys[level]?.rig.wallBoxes;
    const i = walls ? walls.indexOf(d.box) : -1;
    if (walls && i !== -1) walls.splice(i, 1);
    unroofPiece(level, d.box);
    signLayers.get(level)?.hide(roofKey(d.box));
    const at = new THREE.Vector3(d.cx, (storeys[level]?.rig.group.position.y ?? 0) + 0.6, d.cz);
    bursts.smoke(at);
    bursts.sparks(at, 0xc9a36a);
    sound.play('stash', { x: at.x, y: at.y, z: at.z }, 0.9);
    exitSmashed++;
  }

  /** A shot that hit no one: the first thing along the line, if it is a piece of furniture, takes its gun's worth of damage. */
  function shotAtFurniture(floor: ActiveFloor, level: number, gun: BigGun | null): void {
    const pieces = storeyPieces[level];
    if (!pieces || pieces.length === 0) return;
    const dx = Math.sin(player.facingAngle);
    const dz = Math.cos(player.facingAngle);
    let hit: WallBox | null = null;
    let at = FIRE_RANGE;
    for (const b of floor.rig.wallBoxes) {
      const t = rayHitBox(player.worldX, player.worldZ, dx, dz, b, FIRE_RANGE);
      if (t !== null && t < at) {
        at = t;
        hit = b;
      }
    }
    const piece = hit ? pieces.find((p) => p.box === hit) : undefined;
    if (!piece || piece.hp <= 0) return;
    piece.hp -= GUN_PUNCH[gun ?? 'Pistol_1'] ?? 1;
    const where = new THREE.Vector3(player.worldX + dx * at, floor.rig.group.position.y + 0.9, player.worldZ + dz * at);
    bursts.sparks(where, 0xffd27a);
    if (piece.hp <= 0) smashPiece(level, piece);
  }

  // ---- the exit level (`exitMode`) ----

  const BUNKER_REGEN_AFTER_S = 5; // the bunker's bar: nothing has hurt for this long, and it starts to fill back
  const BUNKER_REGEN_PER_S = 3;
  let bunkerHurtAt = -Infinity;
  let bunkerHealthSeen = 0;
  const EXIT_HIT_SUSPICION = 10; // a hit is a fraction of a bar here: it is a shoot-up, not a stealth job...
  const EXIT_REGEN_PER_S = 4; // ...and the bar drains back while nothing is hitting the agent
  const EXIT_WAVE_FIRST_S = 7;
  const EXIT_WAVE_EVERY_S = 20;
  const EXIT_WAVE_BASE = 2;
  const EXIT_WAVE_MAX = 6;
  const EXIT_ALIVE_MAX = 10;
  const EXIT_DROP_M = 12; // how far up the roof is, over the storey the agent is on
  let exitWaveAt = EXIT_WAVE_FIRST_S;
  let exitWaves = 0;
  let exitSmashed = 0;

  /** Starts the exit level: everything open and off, the agent at the top before the heist door, facing into the offices. */
  function startExit(): void {
    hud.setHealthMode(true); // (the bar at the top is health here: suspicion has no meaning when they know)
    hud.setSuspicion(suspicion);
    unlockTowerAccess();
    for (const c of towerCams) {
      c.perm = true;
      c.offUntil = Infinity;
    }
    const heist = activePlan().heist;
    const at = { x: heist.x * CELL, z: (TOWER_ROWS - 1) * CELL - 2.2, y: OFFICES * floorHeight, angle: Math.PI };
    towerLanding = { x: at.x, z: at.z, y: at.y, angle: at.angle };
    towerLandingLabel = 'The top floor';
    player.place(at.x, at.z, at.angle, at.y);
    // The partner starts beside you, up here (not in the lobby's arrival lift, a long way down), a step behind and to one side.
    partner?.place(at.x - Math.sin(at.angle) * 1.1 - Math.cos(at.angle) * 0.2, at.z - Math.cos(at.angle) * 1.1 + Math.sin(at.angle) * 0.2, at.angle, at.y);
    // No lift ride into the lobby: the agent is already up here, and the arrival lift stays shut.
    arrivalPhase = 'done';
    liftCam = 0;
    arrival.setState('idle');
    // Nobody is waiting at the door: whoever stood within a few cells of the start has gone (the waves are what comes for the agent, and they come out of sight).
    for (const e of storeys[OFFICES]!.content.enemies) {
      if (Math.hypot(e.worldX - at.x, e.worldZ - at.z) > 15) continue;
      (e as { disabled: boolean }).disabled = true;
      e.setVisible(false);
    }
    exitWaveAt = stats.seconds + EXIT_WAVE_FIRST_S;
    if (WHITE_EXIT) window.setTimeout(dropKit, 1200);
    hud.showToast('GET OUT · THE LIFT IN THE LOBBY · THEY ARE COMING', 'bad', 5200);
    if (campaignOp) window.setTimeout(() => announce(paLine(campaignOp, 0)), 3000);
  }

  /** A first level played backwards (`stackExit`, `yardExit`): the agent starts at the lift (or the truck) it left by, with the way in as the way out and everyone after it. */
  function startReverseExit(): void {
    hud.setHealthMode(true);
    hud.setSuspicion(suspicion);
    const sp = exitLift.spawn;
    const top = stackExit ? BUNKER_EXIT_LEVEL * floorHeight : 0;
    player.place(sp.x, sp.z, sp.facing, top);
    arrivalPhase = 'done';
    liftCam = 0;
    arrival.setState(stackExit ? 'ready' : 'idle');
    if (stackExit) setLiftOpen(arrival, true);
    setLiftOpen(exitLift, true);
    exitLift.setState('idle');
    exitWaveAt = stats.seconds + EXIT_WAVE_FIRST_S;
    hud.showToast(stackExit ? 'GET OUT · THE LIFT YOU CAME IN BY, AT THE BOTTOM · THEY ARE COMING' : 'GET OUT · THE GATE YOU CAME IN BY · THEY ARE COMING', 'bad', 5200);
    if (campaignOp) window.setTimeout(() => announce(paLine(campaignOp, 0)), 3000);
  }

  /** The director's voice over the building's address system, as a toast (operations.ts's lines). */
  function announce(line: string): void {
    if (!campaignOp || caught || cleared) return;
    hud.showToast(`${campaignOp.director.name.toUpperCase()} · “${line}”`, 'bad', 4600);
  }
  /** The lobby's line comes once, when the agent first reaches the ground floor. */
  let lobbySpoken = false;

  /** A cell nobody can come down in or stand in: a wall of the tower, a space-less cell or a piece of furniture in the bunker; nothing in a yard. */
  const exitBlocked = (idx: number, x: number, y: number): boolean => (tower ? towerBlocked(idx, x, y) : bunker ? !bunkerPlan.spaceAt(x, y) || blockedOn(idx).has(`${x},${y}`) : false);

  /** A wave: hunters come in out of the agent's sight, a few cells off, and make for them. */
  function spawnExitWave(): void {
    const floor = currentFloor();
    const o = floor.rig.group.position;
    const alive = floor.content.enemies.filter((e) => e instanceof Bot && (e.kind === 'hunter' || e.isWhite) && !e.disabled).length;
    exitWaves++;
    const n = WHITE_EXIT ? WHITE_WAVES[exitWaves - 1]! : Math.min(EXIT_WAVE_MAX, EXIT_WAVE_BASE + Math.floor(exitWaves / 2), Math.max(0, EXIT_ALIVE_MAX - alive));
    if (n <= 0) return;
    const px = Math.round((player.worldX - o.x) / CELL);
    const py = Math.round((player.worldZ - o.z) / CELL);
    const dist = bfs(floor.content.navCells, floor.content.cols, floor.content.rows, px, py);
    const far: Array<{ x: number; y: number }> = [];
    const mid: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < dist.length; y++) {
      for (let x = 0; x < dist[y]!.length; x++) {
        const d = dist[y]![x]!;
        if (d < 4 || d > 11 || exitBlocked(activeFloorIdx, x, y)) continue;
        const seen = hasLineOfSight(player.worldX, player.worldZ, o.x + x * CELL, o.z + y * CELL, floor.rig.wallBoxes, 40);
        (seen ? mid : far).push({ x, y });
      }
    }
    // (They come down where the agent can see it: a rope from the roof is a show. Out of sight only when there is nowhere in sight, or too little of it to spread a wave over.)
    // Each on a spot of its own, on a different side of the agent, so the wave closes in from all round instead of landing in one place.
    const pool = mid.length >= n * 2 ? mid : [...mid, ...far];
    const spots = spreadSpots(pool, n, { x: px, y: py });
    if (spots.length === 0) return;
    // Once down, each makes for its own place on the ring round the agent (an even bearing apart), not for the agent's own spot: so the wave closes in along different lines.
    const reachable: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < dist.length; y++) for (let x = 0; x < dist[y]!.length; x++) if (dist[y]![x]! <= 16 && !exitBlocked(activeFloorIdx, x, y)) reachable.push({ x, y });
    const bearings = evenBearings(n, Math.random() * Math.PI * 2);
    hud.showToast(WHITE_EXIT ? `WHITE GUARDS · WAVE ${exitWaves} OF ${WHITE_WAVES.length} · ${n} INBOUND` : `WAVE ${exitWaves} · ${n} INBOUND`, 'bad', 3200);
    if (campaignOp) window.setTimeout(() => announce(paLine(campaignOp, exitWaves)), 1800);
    sound.play('alert');
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        if (caught || cleared) return;
        // They come down ropes from the roof: a line from the roof to each, the guard sliding down it, and a thud and a puff of dust where it lands before it goes for the agent.
        const spot = spots[i]!;
        // (a spot taken twice, with too few to go round, is shared a step apart)
        const shared = spots.slice(0, i).filter((q) => q === spot).length;
        const x = o.x + spot.x * CELL + shared * 0.9;
        const z = o.z + spot.y * CELL;
        const hunter = new Bot(root.scene, x, z, o.x, o.y, o.z, WHITE_EXIT ? 'white' : 'hunter');
        hunter.rappelFrom(EXIT_DROP_M);
        hunter.knowsAgent = true; // (the alarm is a fact: they have the agent in their sights whenever they have a clear line)
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xc9d4de, transparent: true, opacity: 0.8 }));
        root.scene.add(rope);
        exitRopes.push({ bot: hunter, rope, x, z, floorY: o.y });
        sound.play('drag', { x, y: o.y + 4, z }, 0.6);
        hunter.onLanded = () => {
          const at = new THREE.Vector3(x, o.y + 0.2, z);
          bursts.smoke(at);
          sound.play('stash', { x, y: o.y + 0.3, z }, 0.9);
          if (Math.hypot(x - player.worldX, z - player.worldZ) < 10) player.shake(0.25);
          const ring = ringCell(reachable, { x: px, y: py }, bearings[i]!);
          const goal = ring ? { x: o.x + ring.x * CELL, z: o.z + ring.y * CELL } : { x: player.worldX, z: player.worldZ };
          hunter.investigate(goal.x, goal.z, 8, floor.content.navCells, floor.content.cols, floor.content.rows, 999);
        };
        floor.content.enemies.push(hunter);
      }, 400 + i * 700);
    }
  }

  /** The ropes the wave's guards are sliding down: each drawn from the roof to its guard, and taken away once it has landed. */
  const exitRopes: Array<{ bot: Bot; rope: THREE.Mesh; x: number; z: number; floorY: number; /** How far up its line starts (the exit level's roof, or a backup guard's ceiling). */ drop?: number }> = [];
  function tickExitRopes(): void {
    for (let i = exitRopes.length - 1; i >= 0; i--) {
      const r = exitRopes[i]!;
      if (r.bot.airborne <= 0) {
        r.rope.removeFromParent();
        r.rope.geometry.dispose();
        exitRopes.splice(i, 1);
        continue;
      }
      const top = r.floorY + (r.drop ?? EXIT_DROP_M) + 3;
      const low = r.floorY + r.bot.airborne + 1.9;
      r.rope.scale.set(1, Math.max(0.01, top - low), 1);
      r.rope.position.set(r.x, (top + low) / 2, r.z);
    }
  }

  // ---- white guards: three waves, and a weapons kit before the first and after each ----

  let whiteLive = false;
  let whiteSpawnedAt = 0;
  /** The next wave comes once the last is down (a few seconds on, for the kit), or after WAVE_MAX_WAIT_S. */
  function tickWhiteWaves(): void {
    const alive = storeys.reduce((n, f) => n + f.content.enemies.filter((e) => e instanceof Bot && e.isWhite && !e.disabled).length, 0);
    if (whiteLive) {
      if (stats.seconds < whiteSpawnedAt + 4 || alive > 0) return;
      whiteLive = false;
      if (exitWaves < WHITE_WAVES.length) {
        exitWaveAt = stats.seconds + 8;
        dropKit();
        hud.showToast('WAVE DOWN · A WEAPONS KIT IS COMING DOWN', 'good', 3200);
      } else if (campaignOp?.n === CORE_OP) {
        // The last wave of the final level is down: a kit comes down, and Warden waits in the lobby with the lift shut behind him.
        exitWaveAt = Infinity;
        dropKit();
        spawnWarden();
        hud.showToast('THE WHITE GUARDS ARE DOWN · A KIT IS COMING DOWN · THE WARDEN IS IN THE LOBBY', 'good', 5200);
      } else {
        exitWaveAt = Infinity;
        hud.showToast('THE WHITE GUARDS ARE DOWN · THE LOBBY IS NEXT', 'good', 4200);
      }
      return;
    }
    if (exitWaves < WHITE_WAVES.length && stats.seconds >= exitWaveAt) {
      whiteLive = true;
      whiteSpawnedAt = stats.seconds;
      exitWaveAt = stats.seconds + WAVE_MAX_WAIT_S;
      spawnExitWave();
    }
  }

  // ---- Warden: the last of the final level's exit level (warden.ts) ----

  let warden: Bot | null = null;
  /** Warden is put in the lobby, near the lift, and the lift is shut until he is down. */
  function spawnWarden(): void {
    const floor = storeys[0]!;
    const o = floor.rig.group.position;
    const lx = Math.round(exitLift.front.x / CELL);
    const ly = Math.round(exitLift.front.z / CELL);
    const dist = bfs(floor.content.navCells, floor.content.cols, floor.content.rows, lx, ly);
    let best: { x: number; y: number } | null = null;
    for (let y = 0; y < dist.length; y++) {
      for (let x = 0; x < dist[y]!.length; x++) {
        const d = dist[y]![x]!;
        if (d < 2 || d > 5 || towerBlocked(0, x, y)) continue;
        if (!best || Math.abs(d - 3) < Math.abs(dist[best.y]![best.x]! - 3)) best = { x, y };
      }
    }
    const at = best ?? { x: lx, y: ly };
    const boss = new Bot(root.scene, o.x + at.x * CELL, o.z + at.y * CELL, o.x, o.y, o.z, 'warden');
    boss.knowsAgent = true;
    boss.onHack = () => {
      sound.play('powerUp', undefined, 0.8);
      hud.showToast('CONTROL · “HOLDING IT. NOW.” · IT IS HELD, THE SHIELD IS OPEN, SHOTS DO DOUBLE', 'good', 4600);
    };
    floor.content.enemies.push(boss);
    warden = boss;
    setLiftOpen(exitLift, false);
    exitLift.setState('locked');
    if (campaignOp) window.setTimeout(() => announce(paLine(campaignOp, -1)), 1200);
  }
  /** Each frame: the bar, and the lift opening once he is down. */
  function tickWarden(): void {
    if (!warden) return;
    if (warden.disabled) {
      hud.setBossBar(null);
      warden = null;
      setLiftOpen(exitLift, true);
      exitLift.setState('ready');
      sound.play('ding', { x: exitLift.front.x, y: 2.5, z: exitLift.front.z });
      hud.showToast('THE WARDEN IS DOWN · THE LIFT IS OPEN', 'good', 4200);
      return;
    }
    hud.setBossBar({
      name: 'The Warden',
      fraction: warden.wardenHealth,
      state: warden.held ? 'held' : warden.shieldUp ? 'up' : 'open',
      note: warden.held ? 'Held · shots do double' : warden.shieldUp ? 'Shield up · a flash grenade opens it' : 'Shield open · now',
    });
  }

  /** The weapons kits on the floor: a crate that came down a rope, taken by walking over it (flash grenades and an EMP, up to what can be carried). */
  const kits: Array<{ mesh: THREE.Group; floorY: number; x: number; z: number; t: number }> = [];
  function dropKit(): void {
    if (caught || cleared) return;
    const floor = currentFloor();
    const o = floor.rig.group.position;
    const px = Math.round((player.worldX - o.x) / CELL);
    const py = Math.round((player.worldZ - o.z) / CELL);
    const dist = bfs(floor.content.navCells, floor.content.cols, floor.content.rows, px, py);
    const near: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < dist.length; y++) {
      for (let x = 0; x < dist[y]!.length; x++) {
        const d = dist[y]![x]!;
        if (d < 2 || d > 5 || towerBlocked(activeFloorIdx, x, y)) continue;
        if (hasLineOfSight(player.worldX, player.worldZ, o.x + x * CELL, o.z + y * CELL, floor.rig.wallBoxes, 40)) near.push({ x, y });
      }
    }
    const spot = near[Math.floor(Math.random() * near.length)];
    if (!spot) return;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.4), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.5, metalness: 0.4 }));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.42), new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false }));
    strip.position.y = 0.06;
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    markBloom(strip);
    markBloom(cross);
    g.add(box, strip, cross);
    const x = o.x + spot.x * CELL;
    const z = o.z + spot.y * CELL;
    g.position.set(x, o.y + 0.4, z);
    root.scene.add(g);
    kits.push({ mesh: g, floorY: o.y, x, z, t: 0 });
    sound.play('stash', { x, y: o.y + 0.3, z }, 0.9);
    bursts.smoke(new THREE.Vector3(x, o.y + 0.2, z));
    toastOnce('kit-dropped', `A WEAPONS KIT CAME DOWN · WALK OVER IT · +${KIT.flash} FLASH, +${KIT.emp} EMP`, 4200);
  }
  function tickKits(dt: number): void {
    for (let i = kits.length - 1; i >= 0; i--) {
      const k = kits[i]!;
      k.t += dt;
      k.mesh.position.y = k.floorY + 0.4 + Math.sin(k.t * 3) * 0.04;
      k.mesh.rotation.y += dt * 0.9;
      if (caught || cleared || Math.abs(player.worldY - k.floorY) > 1.5 || Math.hypot(player.worldX - k.x, player.worldZ - k.z) > 1) continue;
      const r = restock(flashesLeft, empCharges);
      if (r.gotFlash + r.gotEmp === 0) {
        toastOnce('kit-full', 'FULL STOCK · THE KIT WAITS', 2200);
        continue;
      }
      flashesLeft = r.flashes;
      empCharges = r.emps;
      hud.setFlashes(flashesLeft);
      sound.play('powerUp', undefined, 0.7);
      hud.showToast(`WEAPONS KIT · +${r.gotFlash} FLASH, +${r.gotEmp} EMP · ${flashesLeft} FLASH, ${empCharges} EMP`, 'good', 3000);
      k.mesh.removeFromParent();
      kits.splice(i, 1);
    }
  }

  /** A frame of the exit level: the bar drains back, and the next wave comes when it is due. */
  function tickExit(dt: number): void {
    if (caught || cleared || arrivalPhase !== 'done') return;
    if (suspicion > 0 && suspicion < ALARM_ON + 100) {
      const before = suspicion;
      suspicion = Math.max(0, suspicion - EXIT_REGEN_PER_S * dt);
      if (Math.floor(before) !== Math.floor(suspicion)) hud.setSuspicion(suspicion);
    }
    if (WHITE_EXIT) tickWhiteWaves();
    else if (stats.seconds >= exitWaveAt) {
      exitWaveAt = stats.seconds + EXIT_WAVE_EVERY_S;
      spawnExitWave();
    }
    tickExitRopes();
    tickKits(dt);
    tickWarden();
    if (campaignOp && campaignOp.n !== CORE_OP && !lobbySpoken && activeFloorIdx === 0 && stats.seconds > 15) {
      lobbySpoken = true;
      announce(paLine(campaignOp, -1));
    }
  }

  /** In through the lift at the bottom: the report. */
  function showExitDone(): void {
    hud.setCoach(null);
    // The last level of a run: the finale (every level's time, the total), and the run is over: the next one starts from a fresh bunker.
    if (savedRun?.stage === 'exit' && (savedRun.place === towerSetId || stackExit || yardExit)) {
      noteStat(runStore, 'exit', { seconds: stats.seconds, hits: stats.timesSpotted + stats.timesHit });
      const a = addressOf(savedRun);
      const rows = finaleRows(loadStats(runStore), formatTime, savedRun.site, savedRun.op === 6);
      clearRun(runStore);
      clearStats(runStore);
      // A campaign run is one operation done: the progress is kept, Control reads out what the capture did to the director, and the way on is the next operation (or, after the last, the choice).
      if (campaignOp) noteCleared(runStore, campaignOp.n);
      const following = campaignOp ? nextOperation(opsCleared(runStore)) : null;
      /** A new run: the campaign's next operation, or a free run (a new seed, and with it the site it starts at: the bunker, or the dock yard). */
      const startNext = (): void => {
        const next = campaignOp && following ? operationRun(1 + Math.floor(Math.random() * 1e9), following) : newRun(1 + Math.floor(Math.random() * 1e9));
        keepRun(runStore, next);
        controller.abort();
        // After an operation's exit, the street at dawn (the final level's goes on to the choice instead), then the next operation's call-in.
        const street = campaignOp && following ? streetScene(campaignOp) : null;
        if (street && CUTSCENES) void playInterlude(street).then(() => beginRun(next));
        else beginRun(next);
      };
      hud.showReport({
        kicker: campaignOp ? `Operation ${campaignOp.n} of 6 · ${a.name}` : `${a.name} · Run complete`,
        title: campaignOp ? `${campaignOp.director.name} is exposed` : 'Out, with the file',
        note: campaignOp ? `${campaignOp.caseItem} is with Control. ${campaignOp.debrief}` : 'The bunker, the tower, the heist and the way back out. The address was right.',
        grade: null,
        stamp: { text: 'Out', label: campaignOp ? `Operation ${campaignOp.n}` : 'Run' },
        rows,
        points: null,
        continueLabel: campaignOp ? (following ? `Operation ${following}` : ending ? 'Free runs' : 'The choice') : 'Next run',
        onContinue: () => {
          // After the final level, the choice (once): the choice, then Control's last letter, then free runs.
          if (campaignOp?.n === CORE_OP && !ending) {
            const who = { greeting: `${salutation(agent, username)},` };
            const finish = (choice: Ending): void => {
              chooseEnding(choice);
              controller.abort();
              void playCinematic({ ending: choice, canvas, agent, look, style, documents: 6 }).then((skipped) => {
                reportTry({ kind: 'story', what: 'ending', ending: choice, skipped });
                hud.showDossier(endingLetter(choice, who), { label: 'Free runs', onClick: startNext });
              });
            };
            hud.showDossier(choiceLetter(who), { label: 'Make it public', onClick: () => finish('public') }, { label: 'Keep it private', onClick: () => finish('private') });
            return;
          }
          startNext();
        },
      });
      return;
    }
    hud.showReport({
      kicker: 'Exit level · Evacuated',
      title: 'Out alive',
      note: `${exitWaves} wave${exitWaves === 1 ? '' : 's'} came. ${stats.botsStunned} down, ${exitSmashed} pieces of furniture shot to bits on the way. Nothing here asks you to be quiet: only to get out.`,
      grade: null,
      stamp: { text: 'Out', label: 'Exit' },
      rows: reportRows(jobStats(true)).map(([label, value]) => [label, label === 'Time' ? value.split(' / ')[0]! : value]),
      points: null,
      continueLabel: 'Again',
      onContinue: () => {
        controller.abort();
        startJob(1, 'tower');
      },
    });
  }

  /** The Sump's lift: the next job starts from the tower. */
  function handOnToTower(): void {
    hud.setCoach(null);
    // With the dossier read, the run goes on to the tower of the place it names (kept, so the next level knows); without it (a bunker looked at on its own) the job number's place.
    if (bunkerRun?.found) {
      noteStat(runStore, 'bunker', { seconds: stats.seconds, hits: stats.timesSpotted + stats.timesHit });
      keepRun(runStore, advanceRun(bunkerRun));
    }
    controller.abort();
    // The yard is eight-metre cells and the tower four (the cell size is read as the page loads: scene.ts), so from the yard the way on is a reload; the saved run says where to.
    const go = (): void => (dock ? reloadAt(`?job=tower&n=${n}`) : startJob(n, 'tower'));
    // Between the two, the ride out with the address on it (interlude.ts): the lift, or the truck from the yard.
    if (CUTSCENES && bunkerRun?.found) void playInterlude(toTowerScene(bunkerRun, dock ? 'truck' : 'lift', addressOf(bunkerRun))).then(go);
    else go();
  }

  // `&scene=1` on localhost (with `?job=bunker` or `?job=dock`) goes straight to the ride out and the tower's briefing, to look at them without playing the level.
  // `&scene=door` plays the heist door's scene on its own (the place is `?place=`, the bank without one).
  if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('scene') === 'door') {
    window.setTimeout(() => void playInterlude(toHeistScene(new URLSearchParams(window.location.search).get('place') ?? 'bank')), 800);
  }
  // `&scene=call|upload|descent|street&opn=3` plays that campaign scene of operation 3 on its own (localhost).
  {
    const q = new URLSearchParams(window.location.search);
    const asked = q.get('scene');
    const op = operationFor(Math.floor(Number(q.get('opn') ?? 1)) || 1);
    const scene = asked === 'call' && op ? callInScene(op) : asked === 'upload' && op ? uploadScene(op) : asked === 'descent' && op ? descentScene(op) : asked === 'street' && op ? streetScene(op) : null;
    if (scene && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) window.setTimeout(() => void playInterlude(scene), 800);
  }
  if (bunkerRun && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('scene') === '1') {
    bunkerRun = { ...bunkerRun, found: true };
    window.setTimeout(handOnToTower, 800);
  }

  if (exitMode) startExit();
  if (stackExit || yardExit) startReverseExit();
  if (bunker) {
    hud.setHealthMode(true); // (the bar at the top is health here, as in the exit level: they know the agent is in the building)
    hud.setSuspicion(0);
  }

  let handedOn = false;
  /** The heist door: how the climb went is what the heist starts with: the alarm raised and the building waiting; a close call and it is edgy; unseen, and it is quiet. */
  function handOnToHeist(): void {
    if (!allCards()) return;
    handedOn = true;
    endFlashOffer();
    // The run goes on with it: the maze job is held in the same place (`options.mazePlace`, from the saved run's maze stage), and ends in the way out.
    const inRun = savedRun?.stage === 'tower' && savedRun.place === towerSetId;
    if (savedRun && inRun) {
      noteStat(runStore, 'tower', { seconds: stats.seconds, hits: stats.timesSpotted + stats.timesHit });
      keepRun(runStore, advanceRun(savedRun));
    }
    const carried = alarmOn || suspicion >= ALARM_ON ? 60 : suspicion >= CAUTION_ON_CARRY ? 35 : 0;
    // The ride down: the agent is put in the cab, facing out, the doors close, and the heist's lift opens on the other side (startJob, `approach`).
    if (towerHeist) {
      const at = towerHeist.lift.spawn;
      player.place(at.x, at.z, at.facing, OFFICES * floorHeight);
      towerHeist.lift.setOpen(false);
      towerHeist.lift.setState('idle');
      sound.play('liftDoors', { x: at.x, y: OFFICES * floorHeight + 1.2, z: at.z }, 0.9);
      window.setTimeout(() => sound.play('liftRide', undefined, 0.8), 500);
    } else sound.play('cleared');
    hud.showToast('THE LIFT DOWN · THE HEIST', 'good', 2400);
    window.setTimeout(() => hud.setFade(true), 1500);
    const go = (): void => {
      controller.abort();
      startJob(n, null, null, 'dock', { suspicion: carried });
    };
    // Between the two, the vault door opening and the maze being laid round the agent (interlude.ts); the heist then starts as it did.
    if (CUTSCENES && inRun) window.setTimeout(() => void playInterlude(toHeistScene(towerSetId)).then(go), 2000);
    else window.setTimeout(go, 2400);
  }

  /** Whether this enemy, on another storey, has a clear line through the atrium to the agent's eyes (towerplan.ts's sightAcross). */
  function towerSees(e: Enemy): boolean {
    // Only from below: a storey above the agent is asleep, as the upper floor of a maze is until the agent is on it, so nobody up there sees them, shows, or fires.
    if (Math.round(e.floorY / floorHeight) >= activeFloorIdx) return false;
    if (Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) > 40) return false;
    const eye = player.worldY + (postureState.posture === 'prone' || player.low ? 0.5 : 1.45);
    return sightAcross(floorHeight, { x: e.worldX, y: e.floorY + 1.6, z: e.worldZ }, { x: player.worldX, y: eye, z: player.worldZ });
  }

  // ---- the rail hang: over the balustrade, hanging from the slab's edge (towerplan.ts's ledges) ----

  /** Where the agent hangs along `span`, `along` its run: just outside the rail's line. */
  const ledgeSpot = (span: LedgeSpan, along: number): { x: number; z: number } => ({
    x: span.axis === 'x' ? along : span.fixed + span.nx * LEDGE_OUT,
    z: span.axis === 'x' ? span.fixed + span.nz * LEDGE_OUT : along,
  });
  /** The way they face hanging: at the slab, hands on its edge. */
  const ledgeFacing = (span: LedgeSpan): number => Math.atan2(-span.nx, -span.nz);

  /**
   * A throw at a rail with a drop beyond it, facing out: it goes over, down to the storey below (the flare and the flash grenade lure and daze the guards down there; smoke and shock go
   * the same way). Where it lands: the nearest spot out along the throw (up to six metres) with floor beneath and nothing in the way, with no floor of the storeys between.
   */
  function railThrow(): { floor: ActiveFloor; over: { groundY: number; reach: number } } | null {
    if (!tower || aloft || Math.abs(player.worldY - activeFloorIdx * floorHeight) > 0.1) return null;
    const near = ledgeNear(activeFloorIdx, player.worldX, player.worldZ, 1.8);
    if (!near) return null;
    const dx = Math.sin(player.facingAngle);
    const dz = Math.cos(player.facingAngle);
    if (dx * near.span.nx + dz * near.span.nz < 0.5) return null;
    for (let r = 6; r >= 1.5; r -= 0.5) {
      const x = player.worldX + dx * r;
      const z = player.worldZ + dz * r;
      const cx = Math.round(x / CELL);
      const cz = Math.round(z / CELL);
      for (let l = activeFloorIdx - 1; l >= 0; l--) {
        let clear = true;
        for (let k = activeFloorIdx; k > l; k--) if (hasTowerFloor(k, cx, cz)) clear = false;
        const f = storeys[l]!;
        if (clear && hasTowerFloor(l, cx, cz) && !collides(x, z, f.rig.wallBoxes)) return { floor: f, over: { groundY: f.rig.group.position.y + 0.15, reach: r } };
      }
    }
    return null;
  }

  /** The storey below the ledge that has floor to land on at the agent's spot (a drop of one storey, or two where the balcony has none under the gallery's rail). */
  function ledgeBelow(a: Extract<Aloft, { kind: 'ledge' }>): { floor: Storey; level: number; drop: number } | null {
    const level = storeys.findIndex((f) => f.rig === a.floor.rig);
    const spot = ledgeSpot(a.span, a.along);
    for (let l = level - 1; l >= 0; l--) if (hasTowerFloor(l, Math.round(spot.x / CELL), Math.round(spot.z / CELL))) return { floor: storeys[l]!, level: l, drop: level - l };
    return null;
  }

  /** Over the rail: out of cover and off whatever was in hand, then the vault. */
  function startLedge(near: { span: LedgeSpan; at: number }): void {
    leaveCover();
    if (trapAiming) cancelTrapAim();
    activeHack = null;
    activeTask = null;
    shutterHack = null;
    hud.setHack(null);
    const floor = storeys[Math.max(0, Math.min(storeys.length - 1, activeFloorIdx))]!;
    aloft = { kind: 'ledge', floor, span: near.span, along: near.at, phase: 'in', t: 0, from: { x: player.worldX, y: player.worldY, z: player.worldZ }, angle: player.facingAngle, travel: 0, dur: LEDGE_IN_S, haul: null, cycle: 0, side: 'L' };
    sound.play('stash', { x: player.worldX, y: player.worldY + 0.5, z: player.worldZ }, 0.5);
    toastOnce('ledge', keyed('HANGING FROM THE LEDGE · {turnLeft} AND {turnRight} SHIMMY ALONG · INTERACT CLIMBS BACK OVER, OR PULLS A GUARD OVER THE RAIL · FIRE LETS GO (ONTO A GUARD BELOW, IF THERE IS ONE) · YOUR GRIP WILL TIRE').toUpperCase(), 9000);
  }

  /** The guard on this storey close enough to the hanging agent to be pulled over: unaware, and not one a pull cannot move. */
  function ledgePullTarget(a: Extract<Aloft, { kind: 'ledge' }>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = PULL_REACH;
    for (const e of a.floor.content.enemies) {
      if (!(e instanceof Bot) || e.disabled || e.alert || e.kind === 'heavy') continue;
      const d = Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** Hanging off the rail: held by the hands along the slab's edge, shimmying sideways, the grip tiring. */
  function tickLedge(a: Extract<Aloft, { kind: 'ledge' }>, dt: number, turnIn: number, strafeIn: number): void {
    const floorY = a.floor.rig.group.position.y;
    const handsY = floorY + 0.02;
    const hangY = handsY - player.hangDrop;
    const facing = ledgeFacing(a.span);
    const spot = ledgeSpot(a.span, a.along);
    if (a.phase === 'in' || a.phase === 'out') {
      a.t = Math.min(1, a.t + dt / a.dur);
      const k0 = a.phase === 'in' ? a.t : 1 - a.t;
      const k = k0 * k0 * (3 - 2 * k0);
      const inward = a.span.deck ? LEDGE_OUT + 0.6 : 0.9; // (a rail's floor is a pace in; a bridge's deck is its own width in)
      const fromX = a.phase === 'in' ? a.from.x : spot.x - a.span.nx * inward;
      const fromZ = a.phase === 'in' ? a.from.z : spot.z - a.span.nz * inward;
      const fromY = a.phase === 'in' ? a.from.y : floorY;
      if (a.phase === 'out') {
        // Pulling over: up from the hang (the arms take the weight, the chest comes up over the edge, a knee after it), the library's climb-up held at how far through it is, then in over the
        // edge: the rise first, the step inward after (p runs 0 hanging to 1 standing on the floor).
        const p = 1 - k0;
        const rise = p * p * (3 - 2 * p);
        const inward01 = Math.max(0, Math.min(1, (p - 0.5) / 0.5));
        const slide = inward01 * inward01 * (3 - 2 * inward01);
        const px = spot.x + (fromX - spot.x) * slide;
        const pz = spot.z + (fromZ - spot.z) * slide;
        const py = hangY + (floorY - hangY) * rise;
        player.hold(px, py, pz, facing, 'mantle', dt, p);
      } else {
        const x = fromX + (spot.x - fromX) * k;
        const z = fromZ + (spot.z - fromZ) * k;
        const y = fromY + (hangY - fromY) * k;
        player.hold(x, y, z, a.angle + angleTo(a.angle, facing) * k, 'hang', dt, k * 2, y + player.hangDrop * k);
        if (a.haul) drawRope(a.haul, new THREE.Vector3(x, y + player.hangDrop * k + 1, z));
      }
      if (a.t < 1) return;
      if (a.phase === 'in') {
        a.phase = 'hang';
        a.t = 0;
        return;
      }
      if (a.span.deck) {
        // Up onto the bridge's deck, lying flat, facing along it toward the nearer end.
        postureState = { posture: 'prone', dir: 'down', at: stats.seconds };
        const mid = (a.span.from + a.span.to) / 2;
        player.place(spot.x - a.span.nx * inward, spot.z - a.span.nz * inward, a.span.axis === 'x' ? (a.along < mid ? -Math.PI / 2 : Math.PI / 2) : a.along < mid ? 0 : Math.PI, floorY);
        toastOnce('deck-up', 'ON THE BRIDGE · LYING FLAT · CRAWL ALONG IT: GUARDS AT BOTH ENDS FACE AWAY, AND THE FLOORS BELOW CAN SEE YOU', 5200);
        aloft = null;
        drawRope(null, null);
        return;
      }
      // Back over the rail, onto the floor, facing into the hall.
      player.place(spot.x - a.span.nx * 0.9, spot.z - a.span.nz * 0.9, facing + Math.PI, floorY);
      aloft = null;
      drawRope(null, null);
      return;
    }
    // Hanging: shimmy along the run (screen-left and right as the agent faces it), the grip tiring faster while moving.
    const rightX = -Math.cos(facing);
    const rightZ = Math.sin(facing);
    const sign = Math.sign(a.span.axis === 'x' ? rightX : rightZ) || 1;
    const lateral = clampAxis(turnIn + strafeIn);
    // Along the ledge hand over hand (Mixamo's Left and Right Shimmy, the legs dangling: there is no wall under a rail's slab to brace on), the cycle run by the metres covered so the hands do not skate.
    const move = lateral * sign * LEDGE_SHIMMY * dt;
    const moving = move !== 0;
    const side: 'L' | 'R' = lateral > 0 ? 'R' : 'L';
    if (moving) {
      const before = a.along;
      a.along = Math.min(a.span.to - 0.5, Math.max(a.span.from + 0.5, a.along + move));
      a.travel += Math.abs(move);
      if (side !== a.side) {
        a.side = side;
        a.cycle = 0;
      }
      a.cycle += (Math.abs(a.along - before) / FREE_SHIMMY_M) * FREE_SHIMMY_S;
    } else {
      // Still: the cycle runs on to the hanging pose it starts and ends in, rather than stopping half way along a reach.
      a.cycle %= FREE_SHIMMY_S;
      const home = a.cycle > FREE_SHIMMY_S / 2 ? FREE_SHIMMY_S : 0;
      a.cycle += Math.sign(home - a.cycle) * Math.min(Math.abs(home - a.cycle), dt * 1.2);
    }
    const clip: WallClip = a.side === 'L' ? 'FreeShimmyL' : 'FreeShimmyR';
    let layers: Array<{ clip: WallClip; time: number; weight: number }> = [{ clip, time: a.cycle % FREE_SHIMMY_S, weight: 1 }];
    strength = stepStrength(strength, moving ? 'shimmy' : 'hold', dt);
    const now = ledgeSpot(a.span, a.along);
    // Hauling a guard: the agent's weight dips on the grip as he takes the yank, then settles.
    const dip = guardPull ? Math.sin(Math.min(1, guardPull.t / 0.5) * Math.PI) * 0.12 : 0;
    // Pinned to the slab's edge by the hands, from the clip's pose (eased in from the leap that took hold of it).
    const w = Math.min(1, a.t / 0.2);
    a.t += a.t < 1 ? dt : 0; // (a.t is the time hanging, for the ease-in only: nothing else reads it while hanging)
    if (w < 1) layers = [{ clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: 1 - w }, ...layers.map((l) => ({ ...l, weight: l.weight * w }))];
    player.holdWall(layers, now.x, hangY - dip, now.z, facing, dt, { hands: { x: now.x, y: handsY - dip - 0.03, z: now.z }, settle: 0, centre: { x: now.x, z: now.z }, normal: { x: a.span.nx, z: a.span.nz } }, null);
    tickGuardPull(a, dt);
    if (a.haul) drawRope(a.haul, new THREE.Vector3(now.x, handsY + 0.1, now.z));
    if (strength <= 0) exhaustedLedge(a);
  }

  /** A free spot to land under the hanging agent, on the storey below, clear of furniture and walls. */
  function ledgeLanding(a: Extract<Aloft, { kind: 'ledge' }>, target: Enemy | null): { floor: Storey; to: { x: number; z: number }; angle: number; drop: number } | null {
    const below = ledgeBelow(a);
    if (!below) return null;
    const from = { x: player.worldX, z: player.worldZ };
    let to = { ...from };
    let angle = player.facingAngle;
    if (target) {
      const d = Math.hypot(target.worldX - from.x, target.worldZ - from.z);
      const k = d > AERIAL_LAND ? (d - AERIAL_LAND) / d : 0;
      const spot = { x: from.x + (target.worldX - from.x) * k, z: from.z + (target.worldZ - from.z) * k };
      if (!collides(spot.x, spot.z, below.floor.rig.wallBoxes)) to = spot;
      if (d > 0.05) angle = Math.atan2(target.worldX - from.x, target.worldZ - from.z);
    }
    if (!canLand(below.floor, to.x, to.z, true)) {
      const near = landingNear(below.floor, from);
      if (!near) return null;
      to = near;
    }
    return { floor: below.floor, to, angle, drop: below.drop };
  }

  /** Letting go: onto the unaware guard below if there is one, otherwise down to the floor. A fall of two storeys is a hard one. */
  function letGoLedge(): void {
    if (aloft?.kind !== 'ledge' || aloft.phase !== 'hang' || guardPull) return;
    const target = aerialTarget && !aerialTarget.disabled ? aerialTarget : null;
    const land_ = ledgeLanding(aloft, target);
    if (!land_) {
      hud.showToast('NOTHING TO LAND ON BELOW · CLIMB BACK OVER', 'neutral', 2200);
      return;
    }
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    aloft = { kind: 'fall', floor: land_.floor, from, to: land_.to, angle: land_.angle, t: 0, target, ...(land_.drop >= 2 ? { hard: true } : {}) };
    if (land_.drop >= 2) hud.showToast('A LONG DROP', 'bad', 2200);
  }

  /** Out of grip: down, hard. */
  function exhaustedLedge(a: Extract<Aloft, { kind: 'ledge' }>): void {
    if (guardPull) completeGuardPull(a);
    const land_ = ledgeLanding(a, null);
    if (!land_) {
      strength = 0.2; // (nowhere to land: the arms find something)
      return;
    }
    const from = { x: player.worldX, y: player.worldY, z: player.worldZ };
    aloft = { kind: 'fall', floor: land_.floor, from, to: land_.to, angle: land_.angle, t: 0, target: null, hard: true };
    hud.showToast('YOUR GRIP GAVE OUT', 'bad', 2600);
  }

  /** A guard at the rail, grabbed by the hanging agent: the pull plays out over GUARD_PULL_S (tickGuardPull), then he hangs below the rail. */
  function pullOverGuard(e: Enemy): void {
    if (aloft?.kind !== 'ledge' || aloft.phase !== 'hang' || guardPull || !(e instanceof Bot) || e.disabled) return;
    if (e.hit('takedown') !== 'disabled') return;
    e.pickUp();
    guardPull = { guard: e, t: 0, from: new THREE.Vector3(e.worldX, aloft.floor.rig.group.position.y + 0.95, e.worldZ), thudded: false };
    sound.play('takedown', { x: e.worldX, y: aloft.floor.rig.group.position.y + 1, z: e.worldZ }, 0.5);
    sound.play('drag', undefined, 0.6);
  }

  /** The yank: he is dragged to the edge (the agent's weight dips on the grip), tipped over the rail, and falls to the end of the rope. */
  function tickGuardPull(a: Extract<Aloft, { kind: 'ledge' }>, dt: number): void {
    if (!guardPull) return;
    const g = guardPull;
    g.t = Math.min(1, g.t + dt / GUARD_PULL_S);
    const upperY = a.floor.rig.group.position.y;
    const spot = ledgeSpot(a.span, a.along);
    const rx = spot.x - a.span.nx * 0.05;
    const rz = spot.z - a.span.nz * 0.05;
    const restY = upperY - 2.0 + 0.2;
    const ease = (v: number): number => v * v * (3 - 2 * v);
    let x: number;
    let y: number;
    let z: number;
    if (g.t < 0.5) {
      // Dragged along the floor to the rail, up and over its top.
      const k = ease(g.t / 0.5);
      x = g.from.x + (rx - g.from.x) * k;
      z = g.from.z + (rz - g.from.z) * k;
      y = g.from.y + (upperY + 1.35 - g.from.y) * k;
    } else {
      // Over the edge and down, quickening like a fall, to the end of the rope.
      const k = (g.t - 0.5) / 0.5;
      x = rx;
      z = rz;
      y = upperY + 1.35 + (restY - upperY - 1.35) * k * k;
    }
    g.guard.carryAt(new THREE.Vector3(x, y, z), ledgeFacing(a.span) + Math.PI / 2);
    if (g.t >= 0.5 && !g.thudded) {
      g.thudded = true;
      player.shake(0.12);
    }
    if (g.t >= 1) completeGuardPull(a);
  }

  /** The pull done: the guard on the rope below the rail, in the storey below's list: its guards can find him; this storey's cannot. */
  function completeGuardPull(a: Extract<Aloft, { kind: 'ledge' }>): void {
    const g = guardPull;
    guardPull = null;
    if (!g) return;
    const e = g.guard;
    const level = storeys.findIndex((f) => f.rig === a.floor.rig);
    const lower = storeys[Math.max(0, level - 1)]!;
    const upperY = a.floor.rig.group.position.y;
    const spot = ledgeSpot(a.span, a.along);
    const x = spot.x - a.span.nx * 0.05;
    const z = spot.z - a.span.nz * 0.05;
    const at = a.floor.content.enemies.indexOf(e);
    if (at >= 0) a.floor.content.enemies.splice(at, 1);
    lower.content.enemies.push(e);
    e.layDownAt(x, upperY - 2.0, z, ledgeFacing(a.span) + Math.PI / 2);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2 + 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.8 }));
    rope.position.set(x, upperY + 0.1, z);
    root.scene.add(rope);
    sound.play('takedown', { x, y: upperY, z }, 0.5);
    stats.takedowns++;
    stats.botsStunned++;
    score += PULL_BONUS;
    hud.setScore(score);
    player.shake(0.3);
    hud.showToast(`PULLED OVER AND HUNG · TAKEDOWN +${PULL_BONUS} · HE HANGS BELOW THE RAIL, SEEN ONLY FROM THE FLOORS UNDER`, 'good', 4200);
  }

  /** The console: the cameras are looped, blind for a while. */
  /**
   * What a shot at a camera's switch can hit on this storey: three points across the face of each switch that is still on (the middle and an end either side), so a switch that is a
   * little off the line of fire, or half hidden behind the end of a wall or a cabinet, is still hit.
   */
  const PANEL_HALF_ANGLE = 0.38; // a wider cone than at a guard: the switch is small, and far
  function panelTargets(): Array<{ worldX: number; worldZ: number; disabled: boolean; cam: (typeof towerCams)[number] }> {
    const out: Array<{ worldX: number; worldZ: number; disabled: boolean; cam: (typeof towerCams)[number] }> = [];
    for (const c of towerCams) {
      if (c.perm || c.rig.plan.high || c.rig.plan.level !== activeFloorIdx) continue;
      // Along the wall: the panel's face runs at right angles to the way from the camera to its wall.
      const ax = c.rig.panel.z === c.rig.plan.z ? 0 : 1;
      const az = c.rig.panel.z === c.rig.plan.z ? 1 : 0;
      for (const k of [0, -0.3, 0.3]) out.push({ worldX: c.rig.shot.x + ax * k, worldZ: c.rig.shot.z + az * k, disabled: false, cam: c });
    }
    return out;
  }

  /** A camera switched off for good: one of the tower's threats down (the console's loop, by contrast, only blinds them for a while). At its panel, or shot out from a distance. */
  function switchCameraOff(c: { rig: CameraRig; seen: number; offUntil: number; perm: boolean }, shot: boolean): void {
    c.perm = true;
    c.offUntil = Infinity;
    c.seen = 0;
    sound.play(shot ? 'alert' : 'hackDone', { x: c.rig.panel.x, y: 1.5, z: c.rig.panel.z });
    bursts.sparks(new THREE.Vector3(c.rig.panel.x, c.rig.plan.level * floorHeight + 1.4, c.rig.panel.z), shot ? 0xffb03a : 0x6fd6f0);
    hud.showToast(shot ? 'SWITCH SHOT OUT · CAMERA OFF FOR GOOD' : 'CAMERA SWITCHED OFF FOR GOOD', 'good', 3000);
  }

  /** A high camera's panel within reach of the agent hanging from the shelf beside it, if there is one: its index in towerCams, else -1. */
  const hangPanel = (): number =>
    towerCams.findIndex(
      (c) =>
        !c.perm &&
        c.rig.plan.high === true &&
        Math.hypot(player.worldX - c.rig.panel.x, player.worldZ - c.rig.panel.z) < 1.9 &&
        (player.worldX - c.rig.panel.x) * (c.rig.plan.x - c.rig.panel.x) + (player.worldZ - c.rig.panel.z) * (c.rig.plan.z - c.rig.panel.z) > 0
    );

  /** Every camera in the tower switched off at its own panel. */
  const camerasAllDown = (): boolean => towerCams.length > 0 && towerCams.every((c) => c.perm);
  let consoleGreen = false;
  /** The tick and the words floating over the security console: built once, shown whenever every camera is off for good (however that came about: the last shot, or all of them already down). */
  let consoleTick: THREE.Sprite | null = null;
  function buildConsoleTick(): THREE.Sprite | null {
    const floor = storeys[1];
    const console_ = furnitureFor(1, towerSetId).find((p) => p.kind === 'console');
    if (!floor || !console_) return null;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(8,24,16,0.82)';
    g.beginPath();
    g.roundRect(4, 4, 504, 120, 28);
    g.fill();
    g.strokeStyle = '#4ee08a';
    g.lineWidth = 4;
    g.stroke();
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(34, 66);
    g.lineTo(62, 92);
    g.lineTo(108, 36);
    g.stroke();
    g.fillStyle = '#d8ffe8';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('CAMERAS DISABLED', 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    sprite.scale.set(2.8, 0.7, 1);
    sprite.position.set(console_.cx, 2.1, console_.cz);
    sprite.renderOrder = 10;
    sprite.visible = false;
    floor.rig.group.add(sprite);
    return sprite;
  }
  /** The security console once every camera is off for good (nothing left to loop): its screens go green and the tick shows over it, each frame, whether the last camera has just gone or all were down already. */
  function tickConsoleDone(): void {
    const done = camerasAllDown();
    if (!consoleTick) consoleTick = buildConsoleTick();
    if (consoleTick) consoleTick.visible = done;
    if (consoleGreen || !done) return;
    const floor = storeys[1];
    if (!floor) return;
    let screens = 0;
    floor.rig.group.traverse((o) => {
      if (!o.userData.consoleScreen || !(o instanceof THREE.Mesh)) return;
      screens++;
      const m = o.material as THREE.MeshStandardMaterial;
      m.emissive.set(0x4ee08a);
      m.emissiveIntensity = 1.5;
    });
    consoleGreen = screens > 0;
  }

  function loopCameraFeed(): void {
    camerasOffUntil = stats.seconds + CAMERAS_OFF_S;
    sound.play('hackDone');
    towerCheckpoint('The security room');
    hud.showToast(`FEED LOOPED · THE CAMERAS ARE BLIND FOR ${CAMERAS_OFF_S} SECONDS`, 'good', 3600);
  }

  /** A camera has had the agent in view long enough. */
  function cameraSpot(c: { rig: CameraRig; seen: number; quietUntil: number; lockUntil: number; offUntil: number; perm: boolean }, active: ActiveFloor): void {
    c.seen = 0;
    c.quietUntil = stats.seconds + CAMERA_COOLDOWN_S;
    c.lockUntil = stats.seconds + 2;
    sound.play('alert');
    music.stinger('spotted');
    stats.timesSpotted++;
    if (bunker) hud.showToast('SPOTTED ON CAMERA · THE GUARDS ARE COMING', 'bad');
    else {
      suspicion = applySuspicion(suspicion, SPOT_SUSPICION);
      hud.setSuspicion(suspicion);
      hud.showToast(`SPOTTED ON CAMERA · SUSPICION +${SPOT_SUSPICION}%`, 'bad');
    }
    const { navCells, cols, rows } = active.content;
    for (const e of active.content.enemies) if (e instanceof Bot && !e.disabled) e.investigate(player.worldX, player.worldZ, 4, navCells, cols, rows, CAMERA_CALLS_CELLS);
    if (isCaught(suspicion)) triggerCaught("You've been spotted", 'A security camera raised the alarm.');
  }

  // ---- backup for a fallen guard (backup.ts) ----

  /** How long each downed guard has been in a camera's view, the ones already answered, when a floor last had a call, and the backups on the way or at work. */
  const bodyWatched = new Map<Bot, number>();
  const backedUp = new WeakSet<Bot>();
  const lastBackupAt = new Map<number, number>();
  const backups: Array<{ bot: Bot; body: Bot; level: number; phase: 'check' | 'search'; searchUntil: number; nextAim: number }> = [];

  /** Cameras that have a downed guard in view for a moment call for backup. */
  function tickBodyWatch(dt: number): void {
    if (caught || cleared || exitMode || (!tower && !bunker)) return;
    const now = stats.seconds;
    const seen = new Map<Bot, (typeof towerCams)[number]>();
    if (now >= camerasOffUntil) {
      for (const c of towerCams) {
        const plan = c.rig.plan;
        if (c.perm || now < c.offUntil) continue;
        if (bunker && Math.hypot(player.worldX - plan.x, player.worldZ - plan.z) > plan.range + 30) continue;
        const floor = storeys[plan.level]!;
        const yaw = cameraYaw(plan, now);
        for (const b of floor.content.enemies) {
          if (!(b instanceof Bot) || !b.downed || backedUp.has(b) || b === carried || seen.has(b)) continue;
          const at = b.bodyCenter;
          if (cameraSees({ ...plan, face: yaw, sweep: 0 }, now, at.x, at.z, floor.rig.wallBoxes, false, botCanSee)) seen.set(b, c); // (a camera up on its mount looks over low furniture)
        }
      }
    }
    for (const b of seen.keys()) bodyWatched.set(b, (bodyWatched.get(b) ?? 0) + dt);
    for (const [b, t] of bodyWatched) {
      if (seen.has(b)) {
        if (t >= CAMERA_BODY_S && callBackup(b, seen.get(b)!)) bodyWatched.delete(b);
      } else if (t - dt * 2 <= 0 || backedUp.has(b)) bodyWatched.delete(b);
      else bodyWatched.set(b, t - dt * 2);
    }
    tickBackups();
  }

  /** Sends a guard down a line from the ceiling, round a corner from the body; false when it may not or cannot (it is tried again). */
  function callBackup(body: Bot, cam: (typeof towerCams)[number]): boolean {
    const level = cam.rig.plan.level;
    const floor = storeys[level]!;
    const alive = backups.filter((k) => k.level === level && !k.bot.disabled).length;
    if (!mayCallBackup(stats.seconds - (lastBackupAt.get(level) ?? -Infinity), alive)) return false;
    const { navCells, cols, rows } = floor.content;
    const o = floor.rig.group.position;
    const at = body.bodyCenter;
    const from = cellOf(at.x - o.x, at.z - o.z);
    const dist = bfs(navCells, cols, rows, from.x, from.y);
    const onFloor = Math.abs(player.worldY - o.y) < 3;
    const cands: DropCandidate[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = dist[y]?.[x] ?? -1;
        if (d < DROP_MIN_CELLS || d > DROP_MAX_CELLS) continue;
        const wx = o.x + x * CELL;
        const wz = o.z + y * CELL;
        cands.push({
          x,
          y,
          fromBody: d,
          seesBody: hasLineOfSight(at.x, at.z, wx, wz, floor.rig.wallBoxes, 60),
          fromAgent: onFloor ? Math.hypot(wx - player.worldX, wz - player.worldZ) : 99,
          seenByAgent: onFloor && hasLineOfSight(player.worldX, player.worldZ, wx, wz, floor.rig.wallBoxes, 60),
        });
      }
    }
    const spot = pickDropCell(cands, Math.random());
    if (!spot) return false;
    backedUp.add(body);
    lastBackupAt.set(level, stats.seconds);
    const x = o.x + spot.x * CELL;
    const z = o.z + spot.y * CELL;
    const guard = new Bot(root.scene, x, z, o.x, o.y, o.z);
    guard.rappelFrom(BACKUP_DROP_M);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xc9d4de, transparent: true, opacity: 0.8 }));
    root.scene.add(rope);
    exitRopes.push({ bot: guard, rope, x, z, floorY: o.y, drop: BACKUP_DROP_M });
    sound.play('drag', { x, y: o.y + 4, z }, 0.6);
    const entry = { bot: guard, body, level, phase: 'check' as 'check' | 'search', searchUntil: Infinity, nextAim: Infinity };
    backups.push(entry);
    guard.onLanded = () => {
      bursts.smoke(new THREE.Vector3(x, o.y + 0.2, z));
      sound.play('stash', { x, y: o.y + 0.3, z }, 0.7);
      // It lands crouched, and creeps to the body; with no way to it, it goes straight to looking for the agent.
      if (!guard.creepTo(at.x, at.z, 8, navCells, cols, rows, 99)) startBackupSearch(entry);
    };
    floor.content.enemies.push(guard);
    cam.lockUntil = stats.seconds + 2;
    sound.play('alert', { x: cam.rig.plan.x, y: o.y + 4, z: cam.rig.plan.z }, 0.6);
    if (activeFloorIdx === level) hud.showToast('A CAMERA SAW A DOWNED GUARD · BACKUP IS COMING DOWN NEARBY, CROUCHED, TO CHECK ON HIM AND LOOK FOR YOU', 'bad', 4200);
    return true;
  }

  function startBackupSearch(k: { phase: 'check' | 'search'; searchUntil: number; nextAim: number }): void {
    k.phase = 'search';
    k.searchUntil = stats.seconds + SEARCH_FOR_S;
    k.nextAim = stats.seconds;
  }

  /** A backup guard's rounds: down, creep to the body (it cannot revive it), then look for the agent a few steps off from where they are, every few seconds, until it has them or gives up. */
  function tickBackups(): void {
    tickExitRopes();
    const now = stats.seconds;
    for (let i = backups.length - 1; i >= 0; i--) {
      const k = backups[i]!;
      if (k.bot.disabled || k.bot.airborne > 0) {
        if (k.bot.disabled) backups.splice(i, 1);
        continue;
      }
      if (k.phase === 'check') {
        const at = k.body.bodyCenter;
        if (Math.hypot(k.bot.worldX - at.x, k.bot.worldZ - at.z) <= 2.5 || !k.bot.creeping) startBackupSearch(k);
        continue;
      }
      if (now >= k.searchUntil) {
        backups.splice(i, 1);
        continue;
      }
      if (now < k.nextAim || k.bot.seesAgent || player.currentFloorIdx !== k.level) continue;
      k.nextAim = now + SEARCH_EVERY_S;
      const floor = storeys[k.level]!;
      const { navCells, cols, rows } = floor.content;
      const o = floor.rig.group.position;
      const agent = cellOf(player.worldX - o.x, player.worldZ - o.z);
      for (let tries = 0; tries < 8; tries++) {
        const c = searchCell(agent, Math.random(), Math.random());
        const cell = navCells[c.y]?.[c.x];
        if (!cell || (!cell.N && !cell.S && !cell.E && !cell.W)) continue;
        if (k.bot.creepTo(o.x + c.x * CELL, o.z + c.y * CELL, 10, navCells, cols, rows, 99)) {
          toastOnce('backup-search', 'THE BACKUP IS LOOKING FOR YOU · CREEPING, CROUCHED: STAY OUT OF ITS SIGHT', 4200);
          break;
        }
      }
    }
  }

  /** The cameras: sweeping, locking on the agent they have, blind while the feed is looped. */
  function tickCameras(dt: number): void {
    tickBodyWatch(dt);
    const now = stats.seconds;
    const off = now < camerasOffUntil;
    if (camerasOffUntil > 0 && !off) {
      camerasOffUntil = 0;
      hud.showToast('THE CAMERAS ARE BACK ON', 'bad', 2600);
    }
    for (const c of towerCams) {
      const plan = c.rig.plan;
      const floor = storeys[plan.level]!;
      // (The bunker has twenty: only those near the agent are worked, the far ones' cones being redrawn each frame for nothing.)
      if (bunker && Math.hypot(player.worldX - plan.x, player.worldZ - plan.z) > plan.range + 30) continue;
      const blind = off || now < c.offUntil;
      const locked = now < c.lockUntil;
      c.rig.setState(blind ? 'off' : locked ? 'lock' : 'sweep');
      c.rig.setPanel(!blind);
      const yaw = locked && !plan.high ? Math.atan2(player.worldX - plan.x, player.worldZ - plan.z) : cameraYaw(plan, now); // (a pylon's camera stays on its desk)
      c.rig.aim(yaw, floor.rig.wallBoxes, dt);
      if (blind || plan.level !== activeFloorIdx || caught || cleared || paused() || aloft) {
        c.seen = 0;
        continue;
      }
      const concealed = camoConceals(camo.active, player.moving);
      const crouched = isLow(postureState.posture) || inCover !== null || covered !== null;
      const sees = !concealed && !(bunker && underBox()?.duct) && now >= c.quietUntil && cameraSees({ ...plan, face: yaw, sweep: 0 }, now, player.worldX, player.worldZ, floor.rig.wallBoxes, crouched, botCanSee);
      c.seen = spotMeter(c.seen, sees, dt);
      if (sees && c.seen > 0.1) toastOnce('camera', bunker ? 'SECURITY CAMERA · STAY OUT OF ITS CONE, LIE STILL UNDER CAMO, OR SWITCH IT OFF AT ITS PANEL ON THE WALL BELOW IT (OR SHOOT THE PANEL)' : 'SECURITY CAMERA · IT SWEEPS · STAY OUT OF ITS CONE, LIE STILL UNDER CAMO, OR LOOP THE FEED AT THE CONSOLE IN THE SECURITY ROOM', 6200);
      if (c.seen >= CAMERA_SPOT_S) cameraSpot(c, floor);
    }
  }

  /** Whether the agent is lying under a sofa, a desk or a table of this storey (a WallBox with `under`): out of every guard's sight, and too low to stand up where they are. */
  function underFurniture(): boolean {
    return underBox() !== null;
  }
  /** The crawl space the agent is lying in: a piece of furniture (it has cover), or the bridge's deck (it has none). */
  function underBox(): WallBox | null {
    if (!tower && !bunker) return null;
    const f = tower || bunker ? storeys[Math.max(0, Math.min(storeys.length - 1, Math.round(player.worldY / floorHeight)))]!.rig : floor0;
    return f.wallBoxes.find((b) => b.under === true && player.worldX > b.minX && player.worldX < b.maxX && player.worldZ > b.minZ && player.worldZ < b.maxZ) ?? null;
  }

  let wasUnder = false;
  let bridgeFrom: 'W' | 'E' | null = null; // which end of the bridge the agent got onto it by
  /** Folded away or down: the flight eases open and shut, the gates at its ends come off and go back, and the time left is on the PDA. While the agent is on it, it holds. */
  let lastStairSecond = -1;
  /** Once the agent is up on the offices floor the stair stays down: the threats may be below, and the way back down must exist (the service lift needs a card the stair never asked for). */
  let coreLatched = false;
  function tickCoreStair(dt: number): void {
    const now = stats.seconds;
    if (!coreLatched && activeFloorIdx === OFFICES) {
      coreLatched = true;
      applyBonusExtra();
      lastStairSecond = -1;
      hud.showToast('THE STAIR STAYS DOWN · YOU CAN GO BACK DOWN FOR A KEYCARD YOU MISSED', 'neutral', 3600);
    }
    const cs = TOWER_STAIRS.find((t) => t.id === 'core' && t.timed);
    const onStair =
      !!cs &&
      player.worldX > cs.x * CELL - CELL / 2 &&
      player.worldX < (cs.x + cs.width) * CELL - CELL / 2 &&
      player.worldZ > cs.y * CELL - CELL / 2 &&
      player.worldZ < (cs.y + cs.run) * CELL - CELL / 2 &&
      player.worldY > Math.min(cs.fromLevel, cs.toLevel) * floorHeight + 0.05 &&
      player.worldY < Math.max(cs.fromLevel, cs.toLevel) * floorHeight - 0.05;
    // Never fold it under someone: on the flight, or standing within reach of either gate (which would close on them), it stays down until they are clear.
    const nearGate = coreBarriers.some((b) => Math.abs(player.worldY - b.level * floorHeight) < 0.6 && player.worldX > b.box.minX - 0.7 && player.worldX < b.box.maxX + 0.7 && player.worldZ > b.box.minZ - 0.7 && player.worldZ < b.box.maxZ + 0.7);
    const open = coreLatched || now < stairOpenUntil || ((onStair || nearGate) && coreK > 0.3);
    coreOpen = open && coreK > 0.2;
    coreK += ((open ? 1 : 0) - coreK) * Math.min(1, dt * 4);
    if (coreMesh) coreMesh.scale.y = 0.02 + 0.98 * coreK;
    for (const b of coreBarriers) {
      const walls = storeys[b.level]!.rig.wallBoxes;
      const i = walls.indexOf(b.box);
      if (coreOpen && i >= 0) walls.splice(i, 1);
      else if (!coreOpen && i < 0) walls.push(b.box);
    }
    const left = Math.ceil(stairOpenUntil - now);
    if (coreLatched) return;
    if (now < stairOpenUntil) {
      hud.setPdaExtra({ label: 'Stair', value: `0:${String(left).padStart(2, '0')}`, state: left <= 5 ? 'urgent' : 'alert' });
      if (left !== lastStairSecond && (left === 10 || left === 5)) hud.showToast(`STAIR · ${left} SECONDS`, 'bad', 1200);
      lastStairSecond = left;
    } else if (lastStairSecond !== -1) {
      lastStairSecond = -1;
      applyBonusExtra();
      hud.showToast('THE STAIR FOLDS AWAY', 'neutral', 2200);
    }
  }

  /**
   * A dog put down leaves an EMP cell behind (the guards' dogs can only be stopped with EMP, so a dog downed pays for itself and the odds stay even): a glowing cell where it fell,
   * picked up by walking over it, +1 EMP charge.
   */
  const fuelCells: Array<{ mesh: THREE.Group; floorY: number; x: number; z: number; t: number }> = [];
  const fuelDropped = new Set<Enemy>();
  function dropFuelCell(e: Enemy): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 12), new THREE.MeshStandardMaterial({ color: 0x0c2a33, emissive: 0x39d8ff, emissiveIntensity: 1.4, roughness: 0.4 }));
    body.rotation.z = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 6, 20), new THREE.MeshBasicMaterial({ color: 0x9fefff, toneMapped: false }));
    cap.rotation.x = Math.PI / 2;
    cap.position.y = 0.02;
    markBloom(body);
    markBloom(cap);
    g.add(body, cap);
    g.position.set(e.worldX, e.floorY + 0.35, e.worldZ);
    root.scene.add(g);
    fuelCells.push({ mesh: g, floorY: e.floorY, x: e.worldX, z: e.worldZ, t: 0 });
    toastOnce('fuel-cell', 'THE DOG LEFT AN EMP CELL · WALK OVER IT TO TAKE IT', 4200);
  }
  function tickFuelCells(dt: number): void {
    for (const f of storeys) {
      for (const e of f.content.enemies) {
        if (e instanceof Watchdog && e.disabled && !fuelDropped.has(e)) {
          fuelDropped.add(e);
          dropFuelCell(e);
        }
      }
    }
    for (let i = fuelCells.length - 1; i >= 0; i--) {
      const c = fuelCells[i]!;
      c.t += dt;
      c.mesh.position.y = c.floorY + 0.35 + Math.sin(c.t * 3) * 0.05;
      c.mesh.rotation.y += dt * 1.6;
      if (caught || cleared || Math.abs(player.worldY - c.floorY) > 1.5 || Math.hypot(player.worldX - c.x, player.worldZ - c.z) > 0.95) continue;
      empCharges++;
      sound.play('powerUp', undefined, 0.6);
      hud.showToast(`EMP CELL · +1 EMP · ${empCharges} LEFT`, 'good', 2600);
      c.mesh.removeFromParent();
      fuelCells.splice(i, 1);
    }
  }

  /** The tower's upkeep: the lifts' readouts, and a word the first time the agent crawls under something. */
  /** The back offices' keycard doors: open to a guard walking up to one, and to the agent with the card; shut (and red) to an agent without. */
  function tickOfficeDoors(dt: number): void {
    for (const d of officeDoors) {
      const f = storeys[d.level]!;
      const here = activeFloorIdx === d.level && Math.abs(player.worldY - d.level * floorHeight) < 1.5;
      const pd = here ? Math.hypot(player.worldX - d.rig.position.x, player.worldZ - d.rig.position.z) : 99;
      const guardNear = f.content.enemies.some((e) => e instanceof Bot && !e.disabled && Math.hypot(e.worldX - d.rig.position.x, e.worldZ - d.rig.position.z) < 2.4);
      // (The partner has the card too: it goes through the doors you do.)
      const pp = partner && Math.abs(partner.worldY - d.level * floorHeight) < 1.5 ? Math.hypot(partner.worldX - d.rig.position.x, partner.worldZ - d.rig.position.z) : 99;
      const want = guardNear || (hasKey && (pd < 2.6 || pp < 2.6)) || (d.open && (pd < 1.6 || pp < 1.6)); // (an open door stays open while someone stands in it)
      if (pd < 2.4 && !hasKey && !d.open) toastOnce('office-door', 'KEYCARD DOOR · THE BACK OFFICES WANT A KEYCARD · THE GALLERY\'S ONE · THE GUARDS WALK THROUGH', 4800);
      d.k = Math.max(0, Math.min(1, d.k + (want ? 1 : -1) * dt * 2.6));
      d.rig.slide(d.k);
      const shut = d.k < 0.55;
      const i = f.rig.wallBoxes.indexOf(d.rig.box);
      if (shut && i === -1) f.rig.wallBoxes.push(d.rig.box);
      if (!shut && i !== -1) f.rig.wallBoxes.splice(i, 1);
      if (want && !d.open) sound.play('liftDoors', { x: d.rig.position.x, y: d.level * floorHeight + 1.2, z: d.rig.position.z }, 0.4);
      d.open = want;
    }
  }

  /**
   * The tower's objective: every threat down before the heist door opens. A threat is a guard or a dog still up, or a camera still on; the count is on the top bar (THREATS 12/30), a downed one
   * stays down through a catch, and the door is red until the last is down.
   */
  const threatCount = (): { total: number; down: number; guards: number; dogs: number; cams: number } => {
    let total = 0;
    let down = 0;
    let guards = 0;
    let dogs = 0;
    for (const f of storeys) {
      for (const e of f.content.enemies) {
        total++;
        if (e.disabled) down++;
        else if (e instanceof Watchdog || e instanceof Alpha) dogs++;
        else guards++;
      }
    }
    let cams = 0;
    for (const c of towerCams) {
      total++;
      if (c.perm) down++;
      else cams++;
    }
    return { total, down, guards, dogs, cams };
  };
  let threatsClear = false;
  /** When the agent last got a warning on setting off up a stair from each storey. */
  const climbWarnedAt = new Map<number, number>();
  const BRIDGE_BONUS_SCORE = 1000;
  /** The bonus on the bridge's deck: taken by whoever lies out on it (crawling or hooked up from below), no need to reach for it. */
  function tickBridgeBonus(): void {
    if (!bridgeBonus || caught || cleared || aloft || activeFloorIdx !== TOWER_BRIDGE_BONUS.level) return;
    if (Math.hypot(player.worldX - TOWER_BRIDGE_BONUS.x, player.worldZ - TOWER_BRIDGE_BONUS.z) > 0.8 || !underBox()) return;
    bridgeBonus.removeFromParent();
    bridgeBonus = null;
    score += BRIDGE_BONUS_SCORE;
    hud.setScore(score);
    sound.play('loot');
    hud.showToast(`BONUS · A CHIP LEFT ON THE BRIDGE · +${BRIDGE_BONUS_SCORE}`, 'good', 3600);
  }

  /** Setting off up a stair from a storey whose keycard is not in hand: says so, once, so nobody climbs away from a card by accident (the heist door wants one from every floor). */
  function tickClimbWarning(): void {
    if (caught || cleared || aloft || activeFloorIdx >= storeys.length - 1) return;
    const L = activeFloorIdx;
    const y0 = storeys[L]!.rig.group.position.y;
    // On the flight, a little way up it (the floor under the agent is still this storey's until the last step).
    if (player.worldY < y0 + 0.5 || player.worldY > y0 + floorHeight - 0.2) return;
    if (cardsHeld.has(L) || !TOWER_CARDS.some((c) => c.level === L)) return;
    const last = climbWarnedAt.get(L) ?? -Infinity;
    if (stats.seconds - last < 30) return;
    climbWarnedAt.set(L, stats.seconds);
    hud.showToast(`YOU HAVE NOT TAKEN THE KEYCARD ON THE FLOOR YOU ARE LEAVING (${(towerFloorNames[L] ?? '').toUpperCase()}) · THE HEIST DOOR WANTS ONE FROM EVERY FLOOR`, 'bad', 5200);
  }
  let lastThreats = '';
  let lastLockToast = -99;
  const THREAT_BONUS = 1500; // for taking down every guard, dog and camera in the tower: optional, and well paid
  let bonusExtra: { label: string; value: string; state: 'done' | 'todo' | 'alert' | 'urgent' } | null = null;
  /** The PDA's spare line: the bonus's count, unless the timed stair has the line. */
  function applyBonusExtra(): void {
    if (stats.seconds < stairOpenUntil && !coreLatched) return;
    hud.setPdaExtra(bonusExtra);
  }
  function tickThreats(): void {
    const t = threatCount();
    const key = `${cardsHeld.size}|${t.down}/${t.total}`;
    if (key !== lastThreats) {
      lastThreats = key;
      // The top bar counts the keycards (the heist door wants one from every storey); the threats are a bonus, in the PDA.
      hud.setDocuments(cardsHeld.size, TOWER_CARDS.length);
      bonusExtra = { label: 'Bonus', value: t.down >= t.total ? 'Done' : `${t.total - t.down} left`, state: t.down >= t.total ? 'done' : 'todo' };
      applyBonusExtra();
    }
    if (!threatsClear && t.total > 0 && t.down >= t.total) {
      threatsClear = true;
      score += THREAT_BONUS;
      hud.setScore(score);
      sound.play('cleared');
      hud.showToast(`BONUS · EVERY GUARD, DOG AND CAMERA IN THE TOWER IS DOWN · +${THREAT_BONUS}`, 'good', 5200);
    }
  }

  /** The heist door: slides open as the agent comes up to it (once the tower is clear) and stays open, showing the passage and the lift to the heist beyond. */
  function tickHeistDoor(dt: number): void {
    const h = towerHeist;
    if (!h) return;
    h.lift.update(dt);
    const close = activeFloorIdx === OFFICES && Math.hypot(player.worldX - h.door.position.x, player.worldZ - h.door.position.z) < 4.2;
    if (close && !allCards() && !exitMode && stats.seconds - lastLockToast > 6) {
      lastLockToast = stats.seconds;
      const missing = TOWER_CARDS.filter((c) => !cardsHeld.has(c.level)).map((c) => (towerFloorNames[c.level] ?? `floor ${c.level}`).toUpperCase());
      sound.play('denied');
      hud.showToast(`THE HEIST DOOR IS LOCKED · IT WANTS A KEYCARD FROM EVERY FLOOR · STILL TO FIND: ${missing.join(' · ')}`, 'bad', 4800);
    }
    const near = close && allCards();
    if (near || h.k > 0) h.k = Math.min(1, h.k + dt * 1.4);
    h.door.slide(h.k);
    const walls = storeys[OFFICES]!.rig.wallBoxes;
    const i = walls.indexOf(h.door.box);
    if (h.k < 0.55 && i === -1) walls.push(h.door.box);
    if (h.k >= 0.55 && i !== -1) walls.splice(i, 1);
    if (near && h.k < 0.05) sound.play('liftDoors', { x: h.door.position.x, y: OFFICES * floorHeight + 1.2, z: h.door.position.z }, 0.6);
  }

  const sentryWas = new Map<Bot, boolean>();
  const lookWas = new Map<Bot, string | null>();
  /** Guards calling to one another: a sentry who has seen the agent raises a sound wave that sends the walkers near him to look, and the guards of the offices go about in pairs, so one who goes to look at a noise takes the other. */
  // ---- guards as a team (squad.ts) ----

  /** The guards already seen to be down: each is a witness's alarm once. */
  const downSeen = new WeakSet<Enemy>();
  const calledAt = new WeakMap<Bot, number>();
  const WITNESS_SUSPICION = 12;
  /** Whether the guards are a team on this job: all the real ones, and the tower's and the bunker's courses; not the lessons, which teach one thing at a time, nor the exit level's waves. */
  const squadOn = (): boolean => !exitMode && (!training || tower || bunker);

  // ---- guards' flash grenades (guardflash.ts) ----

  /** Grenades each guard has left (drawn the first time it is looked at), when it last threw, and how long it has had the agent in sight. */
  const flashStock = new WeakMap<Bot, number>();
  const flashThrownAt = new WeakMap<Bot, number>();
  const sightFor = new WeakMap<Bot, number>();
  let guardFlashAt = -Infinity;

  /** A guard that has had the agent in sight a while, from a way off, throws a flash at them: it goes off where they stand in about a second (breaking the line to it is the answer). */
  function tickGuardFlashes(active: ActiveFloor, dt: number): void {
    if (!squadOn() || caught || cleared || (!bunker && !tower && n < 3)) return;
    for (const b of active.content.enemies) {
      if (!(b instanceof Bot) || b.disabled) continue;
      if (!flashStock.has(b)) flashStock.set(b, carries(Math.random()) && !b.rusher ? 1 : 0);
      const dist = Math.hypot(player.worldX - b.worldX, player.worldZ - b.worldZ);
      const onLevel = Math.abs(b.floorY - player.worldY) < 1.2 && !b.onRoofLayer;
      const seesNow = b.seesAgent && !b.dazed && onLevel;
      sightFor.set(b, seesNow ? (sightFor.get(b) ?? 0) + dt : 0);
      if ((flashStock.get(b) ?? 0) <= 0) continue;
      const clear = seesNow && hasLineOfSight(b.worldX, b.worldZ, player.worldX, player.worldZ, active.rig.wallBoxes, dist + 1);
      if (!throwsFlash({ seenFor: sightFor.get(b) ?? 0, dist, clear, stock: flashStock.get(b) ?? 0, sinceOwn: stats.seconds - (flashThrownAt.get(b) ?? -Infinity), sinceAny: stats.seconds - guardFlashAt, rusher: b.rusher, down: b.dazed })) continue;
      flashStock.set(b, 0);
      flashThrownAt.set(b, stats.seconds);
      guardFlashAt = stats.seconds;
      const facing = Math.atan2(player.worldX - b.worldX, player.worldZ - b.worldZ);
      sound.play('flareThrow', { x: b.worldX, y: b.floorY + 1.4, z: b.worldZ });
      activeFlashes.push(spawnFlashbang(root.scene, b.worldX, b.floorY, b.worldZ, facing, active.rig.wallBoxes, (x, y, z) => guardFlashBang(active, x, y, z), { groundY: b.floorY + 0.12, reach: dist }));
      hud.showToast('A GUARD THREW A FLASH · GET OUT OF ITS LINE BEFORE IT GOES OFF', 'bad', 2600);
    }
  }

  /** A guard's flash goes off: the agent with a clear line to it is blinded, the screen white and fading back over a few seconds, and stumbles for a moment. */
  function guardFlashBang(floor: ActiveFloor, x: number, y: number, z: number): void {
    sound.play('flashBang', { x, y, z }, 1);
    bursts.sparks(new THREE.Vector3(x, y, z), 0xffffff);
    const dist = Math.hypot(player.worldX - x, player.worldZ - z);
    const clear = hasLineOfSight(x, z, player.worldX, player.worldZ, floor.rig.wallBoxes, GUARD_FLASH_RADIUS);
    const strength = flashStrength({ dist, dy: Math.abs(player.worldY - y), clear, shutAway: hiddenIn !== null });
    if (strength === null) {
      hud.flashOut(0.15);
      hud.showToast('THE FLASH WENT OFF WITHOUT A LINE TO YOU', 'good', 2200);
      return;
    }
    hud.flashOut(strength, true);
    blindedFor = STUMBLE_S;
    hud.showToast('FLASHED · YOU STUMBLE, AND THE SCREEN CLEARS IN A FEW SECONDS', 'bad', 3000);
  }

  /** A guard that has the agent shouts: the guards within earshot come, the first to cover, the second round the side, and so on. */
  function callSquad(caller: Bot, active: ActiveFloor): void {
    if (!squadOn() || stats.seconds - (calledAt.get(caller) ?? -Infinity) < CALL_EVERY_S) return;
    calledAt.set(caller, stats.seconds);
    const others = active.content.enemies.filter((o): o is Bot => o instanceof Bot && o !== caller && !o.disabled);
    const range = caller.isSentry ? CALL_RANGE_M * 0.7 : CALL_RANGE_M;
    let came = 0;
    for (const i of reachedBy({ x: caller.worldX, z: caller.worldZ }, others.map((o) => ({ x: o.worldX, z: o.worldZ })), range)) if (others[i]!.alertTo(player.worldX, player.worldZ, came % 2 === 1 ? 'flank' : 'cover')) came++;
    if (came > 0) toastOnce('squad', 'A GUARD CALLED FOR BACKUP · THEY COME TO COVER, AND ROUND THE SIDE', 4200);
  }

  /** A guard that goes down in the sight of another (stunned from a distance, say) is not left lying there unremarked: whoever saw it, goes to cover and comes, calls the rest, and suspicion rises. */
  function tickSquad(active: ActiveFloor): void {
    if (!squadOn() || caught || cleared) return;
    const bots = active.content.enemies.filter((e): e is Bot => e instanceof Bot);
    for (const b of bots) {
      if (!b.disabled || downSeen.has(b)) continue;
      downSeen.add(b);
      if (b.stashed) continue;
      const spot = { x: b.worldX, z: b.worldZ };
      const seers = bots.filter((w) => w !== b && !w.disabled && !w.dazed && sawItHappen({ x: w.worldX, z: w.worldZ, facing: w.facing }, spot, hasLineOfSight(w.worldX, w.worldZ, spot.x, spot.z, active.rig.wallBoxes, WITNESS_RANGE_M)));
      if (seers.length === 0) continue;
      let came = 0;
      seers.forEach((w, i) => {
        if (w.alertTo(spot.x, spot.z, i % 2 === 1 ? 'flank' : 'cover')) came++;
      });
      for (const w of seers) for (const o of bots) if (o !== w && !o.disabled && !seers.includes(o) && Math.hypot(o.worldX - w.worldX, o.worldZ - w.worldZ) <= CALL_RANGE_M * 0.6 && o.alertTo(spot.x, spot.z)) came++;
      if (came === 0) continue;
      sound.play('alert');
      if (healthMode) {
        hud.showToast(`A GUARD SAW A PARTNER GO DOWN · ${came} COMING`, 'bad', 3200);
        continue;
      }
      suspicion = applySuspicion(suspicion, WITNESS_SUSPICION);
      hud.setSuspicion(suspicion);
      hud.showToast(`A GUARD SAW A PARTNER GO DOWN · SUSPICION +${WITNESS_SUSPICION}% · ${came} COMING`, 'bad', 3200);
      if (isCaught(suspicion)) triggerCaught('A guard saw it', 'A guard saw a partner go down and raised the alarm.');
    }
  }

  function tickGuardCalls(): void {
    const f = storeys[activeFloorIdx];
    if (!f || Math.abs(player.worldY - activeFloorIdx * floorHeight) > 1.5) return;
    const bots = f.content.enemies.filter((e): e is Bot => e instanceof Bot && !e.disabled);
    const { navCells, cols: c, rows: r } = f.content;
    for (const b of bots) {
      if (b.isSentry) {
        const was = sentryWas.get(b) ?? false;
        if (b.alert && !was) {
          let heard = 0;
          for (const o of bots) if (o !== b && !o.isSentry && !o.alert && Math.hypot(o.worldX - b.worldX, o.worldZ - b.worldZ) < SENTRY_WAVE_M && o.investigate(player.worldX, player.worldZ, 5, navCells, c, r, 99)) heard++;
          if (heard > 0) hud.showToast(`A SENTRY SOUNDED THE ALARM · ${heard} GUARD${heard === 1 ? '' : 'S'} COMING TO LOOK`, 'bad', 2800);
        }
        sentryWas.set(b, b.alert);
        continue;
      }
      const look = b.lookingAt;
      const key = look ? `${look.x.toFixed(0)},${look.z.toFixed(0)}` : null;
      if (look && lookWas.get(b) !== key) {
        for (const p of bots) {
          if (p === b || p.isSentry || p.alert || p.lookingAt || Math.hypot(p.worldX - b.worldX, p.worldZ - b.worldZ) > PAIR_M) continue;
          if (p.investigate(look.x, look.z, 4, navCells, c, r, 99)) lookWas.set(p, `${look.x.toFixed(0)},${look.z.toFixed(0)}`);
        }
      }
      lookWas.set(b, key);
    }
  }

  // ---- the Records Annex's sliding shelves ----
  // A bank slides one cell across its length, into the aisle beside it, or back. Its collision box moves with it (the guards walk round it as round any box, and cameras lose or gain a sight line);
  // the guards' map shuts the cells it moves into at once and opens the ones it leaves when it stops. Nothing slides onto anyone: a slide with an agent, a guard or a dog in its way does not start.
  const shelfBlocked = new Map<number, Set<string>>();
  const blockedOn = (level: number): Set<string> => {
    let s = shelfBlocked.get(level);
    if (!s) shelfBlocked.set(level, (s = new Set(bunkerPlan.furnishedCells(level))));
    return s;
  };
  const cellKey = (c: SlideCell): string => `${c.x},${c.y}`;
  const slideCells = (b: ShelfBank, slid: boolean): SlideCell[] => (slid ? b.cells.map((c) => ({ x: c.x + b.dx, y: c.y + b.dy })) : b.cells);

  function startSlide(b: ShelfBank): void {
    if (b.anim) return;
    const to: 0 | 1 = b.at === 0 ? 1 : 0;
    const f = storeys[b.level]!;
    const o = f.rig.group.position;
    const goal = shiftedBox(b.home, b.dx, b.dy, to);
    const world = { x: player.worldX - o.x, z: player.worldZ - o.z };
    const someone = [{ x: world.x, z: world.z }, ...f.content.enemies.filter((e) => !e.disabled).map((e) => ({ x: e.worldX - o.x, z: e.worldZ - o.z }))];
    // (The cells the bank is going into, and a margin round them for a body.)
    if (b.level !== activeFloorIdx || someone.some((p) => nearBox(goal, p.x, p.z, 0.7) && !nearBox(b.box, p.x, p.z, 0.05))) {
      sound.play('denied', worldAt(f.rig, b.station.x, b.station.z));
      hud.showToast('SOMETHING IS IN THE WAY · IT WILL NOT SLIDE', 'bad', 2600);
      return;
    }
    const into = slideCells(b, to === 1);
    closeCells(f.content.navCells, into);
    for (const c of into) blockedOn(b.level).add(cellKey(c));
    navVersion++;
    b.anim = { from: b.at, to, t: 0 };
    sound.play('drag', worldAt(f.rig, b.station.x, b.station.z), 0.9);
    toastOnce('shelf-slid', 'THE SHELVES SLIDE · A BANK ACROSS A LANE SHUTS A GUARD OUT, AND A BANK SLID BACK OPENS IT: GUARDS FIND ANOTHER WAY ROUND', 5200);
  }

  function tickShelves(dt: number): void {
    for (const b of shelfBanks) {
      const a = b.anim;
      if (!a) continue;
      a.t = Math.min(1, a.t + dt / SLIDE_S);
      const frac = a.from + (a.to - a.from) * slideEase(a.t);
      Object.assign(b.box, shiftedBox(b.home, b.dx, b.dy, frac));
      b.group.position.set(b.box.minX + (b.home.maxX - b.home.minX) / 2, 0, b.box.minZ + (b.home.maxZ - b.home.minZ) / 2);
      if (a.t < 1) continue;
      const f = storeys[b.level]!;
      b.anim = null;
      b.at = a.to as 0 | 1;
      const left = slideCells(b, a.to === 0);
      for (const c of left) blockedOn(b.level).delete(cellKey(c));
      openCells(f.content.navCells, left, (x, y) => !!bunkerPlan.spaceAt(x, y), (x, y) => blockedOn(b.level).has(`${x},${y}`));
      navVersion++;
      // the wheel is where the bank's end is now
      const cx = (b.box.minX + b.box.maxX) / 2;
      const cz = (b.box.minZ + b.box.maxZ) / 2;
      const alongX = b.home.maxX - b.home.minX > b.home.maxZ - b.home.minZ;
      b.station.x = cx + (alongX ? (b.home.maxX - b.home.minX) / 2 + 1.2 : 0);
      b.station.z = cz + (alongX ? 0 : -((b.home.maxZ - b.home.minZ) / 2 + 1.2));
    }
  }

  // ---- the Records Annex's motion lights ----
  // Its aisle lights are off until someone walks near: the agent, or a guard on its round. They stay on a few seconds after the last of them has gone, so a lit pool on the floor says where
  // somebody is, and a lamp that is off counts as dark (guards see less far there, and a body lying under it is hidden). Shot-out lamps stay dark for good.
  const MOTION_R = 7.5;
  const MOTION_HOLD_S = 3.5;
  const MOTION_FADE_S = 0.5;
  const motionLevel = new Map<Lamp, number>();
  const motionUntil = new Map<Lamp, number>();
  function tickMotionLights(dt: number): void {
    if (!annexSite) return;
    const t = stats.seconds;
    for (let i = 0; i < storeys.length; i++) {
      const f = storeys[i]!;
      const here = i === activeFloorIdx;
      const who: Array<{ x: number; z: number }> = [];
      if (here) {
        who.push({ x: player.worldX, z: player.worldZ });
        for (const e of f.content.enemies) if (!e.disabled && e.kind !== 'watchdog') who.push({ x: e.worldX, z: e.worldZ });
      }
      for (const l of f.content.lamps) {
        const fx = l.fixture;
        if (!fx || l.broken) continue;
        if (who.some((p) => Math.hypot(p.x - fx.worldX, p.z - fx.worldZ) < MOTION_R)) motionUntil.set(l, t + MOTION_HOLD_S);
        const on = (motionUntil.get(l) ?? -1) > t;
        const was = motionLevel.get(l) ?? 1; // (built lit)
        const level = Math.max(0, Math.min(1, was + (on ? 1 : -1) * (dt / MOTION_FADE_S)));
        if (level === was) continue;
        motionLevel.set(l, level);
        l.light.intensity = l.base * level;
        l.light.userData.broken = level < 0.05;
        if (l.bulb) l.bulb.emissiveIntensity = 0.03 + (l.bulbBase - 0.03) * level;
        l.off = level < 0.3;
        fx.disabled = l.off;
      }
    }
  }

  function tickTower(dt: number): void {
    tickMotionLights(dt);
    tickShelves(dt);
    if (stackExit || yardExit) tickExit(dt);
    if (!tower) return;
    for (const l of towerLifts) l.rig.update(dt);
    tickOfficeDoors(dt);
    tickHeistDoor(dt);
    if (exitMode) tickExit(dt);
    else {
      tickThreats();
      tickClimbWarning();
      tickBridgeBonus();
    }
    tickGuardCalls();
    tickCameras(dt);
    tickConsoleDone();
    tickCoreStair(dt);
    const box = underBox();
    const under = box !== null;
    // Off the far end of the bridge: across.
    if (box && !box.cover) bridgeFrom = bridgeFrom ?? (player.worldX < (box.minX + box.maxX) / 2 ? 'W' : 'E');
    else if (!box && bridgeFrom && !aloft) {
      const br = TOWER_BRIDGES[0]!;
      const opposite = bridgeFrom === 'W' ? player.worldX > br.toX * CELL - CELL / 2 : player.worldX < br.fromX * CELL + CELL / 2;
      const side: 'W' | 'E' = bridgeFrom;
      bridgeFrom = null;
      if (opposite && !caught) towerCheckpoint(side === 'W' ? 'Across the bridge, east' : 'Across the bridge, west');
    }
    if (box && !wasUnder) {
      if (box.cover) toastOnce('crawl-under', 'UNDER THE FURNITURE · NO ONE CAN SEE YOU HERE · YOU CAN FIRE LYING DOWN: STUN A GUARD FROM HERE, OR CRAWL OUT WHEN THEY HAVE GONE BY', 4200);
      else toastOnce('bridge-crawl', keyed('ON THE BRIDGE · THE FLOORS BELOW CAN SEE YOU · WHEN ANYONE LOOKS THIS WAY, LIE STILL AND USE {camo}: IT HIDES YOU ONLY WHILE YOU DO NOT MOVE · THE GUARDS AT THE ENDS FACE AWAY: COME OUT BEHIND ONE').toUpperCase(), 5200);
    }
    wasUnder = under;
    // Standing beside a sofa or a desk with room under it (cyan on the floor): what it is for.
    if (!under && !aloft && !caught && !cleared && postureState.posture !== 'prone') {
      const f = storeys[Math.max(0, Math.min(storeys.length - 1, Math.round(player.worldY / floorHeight)))]!;
      for (const b of f.rig.wallBoxes) {
        if (b.under !== true || !b.cover || player.worldX < b.minX - 0.9 || player.worldX > b.maxX + 0.9 || player.worldZ < b.minZ - 0.9 || player.worldZ > b.maxZ + 0.9) continue;
        toastOnce('crawl-near', keyed('CYAN RING ON THE FLOOR: YOU CAN CRAWL UNDER THIS · LIE DOWN ({sneak} TWICE) · NO ONE CAN SEE YOU UNDER IT, AND YOU CAN STILL FIRE').toUpperCase(), 6000);
        break;
      }
    }
    // Standing at the end of the bridge: why you cannot walk it.
    if (!under && !aloft && postureState.posture !== 'prone') {
      const f = storeys[Math.max(0, Math.min(storeys.length - 1, Math.round(player.worldY / floorHeight)))]!;
      for (const b of f.rig.wallBoxes) {
        if (b.under !== true || b.cover || player.worldX < b.minX - 1 || player.worldX > b.maxX + 1 || player.worldZ < b.minZ - 1 || player.worldZ > b.maxZ + 1) continue;
        toastOnce('bridge-low', keyed('THE BRIDGE IS TOO LOW TO WALK · LIE DOWN ({sneak} TWICE) AND CRAWL ACROSS · IT IS IN PLAIN SIGHT OF GUARDS AT BOTH ENDS AND ON THE FLOORS BELOW: WATCH THEM, AND TIME IT').toUpperCase(), 5600);
        break;
      }
    }
  }

  /** The skylight's upkeep: the cracks spreading; and once it is open, walking into the hole is a fall. */
  function tickSkylight(dt: number): void {
    if (!sky) return;
    sky.rig.update(dt);
    if (sky.rig.state === 'broken' && floor1 && activeFloorIdx === 1 && !aloft && !caught && !cleared && !hiddenIn && !ventTransit && onSkylight()) plungeThroughGlass();
  }

  /** Live wire from where a pulse went off to the body it dropped: the arc stays on it while it twitches down. */
  function zapEnemy(from: THREE.Vector3, e: Enemy, color = 0x7fd8ff): void {
    const src = from.clone();
    blasts.zap(() => src, () => new THREE.Vector3(e.worldX, e.floorY + (e instanceof Bot ? 1.1 : 0.5), e.worldZ), 0.7, color);
  }

  /**
   * An alpha unit went off (ran you down, or was hit): everything in its ring is hit at once. Guards, dogs, mines and drones go down, every camera in it is shorted out for good, any other alpha
   * in it is set off a moment later, and the agent, if they are in it (with a clear line, or right beside it), is done: back to the last checkpoint. It raises no suspicion and calls no one.
   */
  function alphaBlast(alpha: Alpha, ctx: EnemyContext): void {
    const fi = storeys.findIndex((f) => f.content.enemies.includes(alpha));
    const floor = storeys[fi] ?? currentFloor();
    const here = fi < 0 || fi === activeFloorIdx;
    const at = new THREE.Vector3(alpha.worldX, alpha.floorY + 0.5, alpha.worldZ);
    sound.play('boom', { x: at.x, y: at.y, z: at.z });
    blasts.boom(at, 1);
    bursts.sparks(at, 0xffb050);
    bursts.smoke(at);
    let downed = 0;
    let chained = 0;
    for (const e of floor.content.enemies) {
      if (e === alpha || e.disabled || Math.hypot(e.worldX - alpha.worldX, e.worldZ - alpha.worldZ) > ALPHA_BLAST_R) continue;
      if (e instanceof Alpha) {
        e.chain();
        chained++;
      } else if (e.hit('emp') === 'disabled') {
        downed++;
        enemyDown(e, new THREE.Vector3(e.worldX, e.floorY + 0.6, e.worldZ));
        chasing.delete(e);
      }
    }
    // (And the furniture in the ring: a blast leaves no cover.)
    for (const p of storeyPieces[fi < 0 ? activeFloorIdx : fi] ?? []) if (p.hp > 0 && Math.hypot(p.cx - alpha.worldX, p.cz - alpha.worldZ) <= ALPHA_BLAST_R) smashPiece(fi < 0 ? activeFloorIdx : fi, p);
    let cams = 0;
    for (const c of towerCams) {
      if (c.perm || c.rig.plan.level !== (fi < 0 ? activeFloorIdx : fi) || Math.hypot(c.rig.plan.x - alpha.worldX, c.rig.plan.z - alpha.worldZ) > ALPHA_BLAST_R) continue;
      c.perm = true;
      c.offUntil = Infinity;
      c.seen = 0;
      cams++;
      bursts.sparks(new THREE.Vector3(c.rig.panel.x, c.rig.plan.level * floorHeight + 1.4, c.rig.panel.z), 0xffb03a);
    }
    if (!here || caught || cleared) return;
    const d = Math.hypot(player.worldX - alpha.worldX, player.worldZ - alpha.worldZ);
    const inRing = d <= ALPHA_BLAST_R && Math.abs(player.worldY - alpha.floorY) < 3 && !ctx.enclosed;
    if (inRing && (d < 1.8 || hasLineOfSight(alpha.worldX, alpha.worldZ, player.worldX, player.worldZ, floor.rig.wallBoxes, ALPHA_BLAST_R))) {
      player.shake(1);
      hud.pulseDanger();
      triggerCaught('Blown up by an alpha', 'An alpha unit ran you down and went off beside you.', { x: alpha.worldX, z: alpha.worldZ });
      return;
    }
    player.shake(Math.max(0.2, 0.8 - d / 20));
    const parts = [downed ? `${downed} DOWN` : '', cams ? `${cams} CAMERA${cams > 1 ? 'S' : ''} SHORTED OUT` : '', chained ? `${chained} MORE SET OFF` : ''].filter(Boolean);
    hud.showToast(`ALPHA BLAST${parts.length ? ' · ' + parts.join(' · ') : ''} · NO ONE HEARD A THING`, 'good', 4200);
  }

  /** Knock-on effects when an enemy goes down: sparks, smoke, the thud. */
  function enemyDown(e: Enemy, at: THREE.Vector3): void {
    stats.botsStunned++;
    if (e instanceof Bot && !training) window.setTimeout(() => !signal.aborted && hud.showHint('drag'), 1300); // once it's finished falling
    const downAt = { x: e.worldX, y: e.floorY + 0.4, z: e.worldZ };
    window.setTimeout(() => sound.play('botDown', downAt), e instanceof Bot ? 450 : 200);
    bursts.sparks(at);
    bursts.smoke(new THREE.Vector3(e.worldX, e.floorY + (e instanceof Bot ? 1.2 : 0.5), e.worldZ));
  }

  /** A silent takedown from behind: lunge in and drop it, with no noise for anyone to hear. */
  function performTakedown(e: Enemy): void {
    if (e.hit('takedown') !== 'disabled') return;
    leaveCover();
    player.lunge(e.worldX, e.worldZ);
    fireCooldown = TAKEDOWN_COOLDOWN_S;
    stats.takedowns++;
    stats.botsStunned++;
    takedownTarget = null;
    // Straight from behind, a sword's cut; with the guard turned across the agent (from its side), a kick.
    const across = Math.abs(Math.atan2(Math.sin(e.facing - player.facingAngle), Math.cos(e.facing - player.facingAngle)));
    player.strike(across < 0.8 ? 'sword' : 'kick');
    sound.play('takedown', { x: e.worldX, y: e.floorY + 1, z: e.worldZ });
    hud.showToast('TAKEDOWN', 'good');
    partnerBackup(e);
  }

  /**
   * Fire: the gun picks its tool for whatever is in the sights (weapons.ts) —
   * a stun shot, or an EMP pulse for a stun-immune target (or whenever
   * `forceEmp`: hold Fire, or X). The EMP bursts where it lands and knocks
   * out everything within EMP_BLAST_RADIUS.
   */
  /** A press while the gun is still charging: a dull click, the bar shakes, and now and then the reason is spelled out. */
  function dryFire(): void {
    dryFires++;
    sound.play('dry');
    hud.flashDenied();
    if (dryFires === 1 || dryFires % 8 === 0) hud.showToast('RECHARGING · ONE SHOT, THEN WAIT FOR THE CHIME', 'neutral', 2800);
  }

  /** How high above its own floor to aim at an enemy: a guard's chest, a drone up in the air, a dog low down. */
  const enemyAimHeight = (e: Enemy): number => (e instanceof Bot ? 1.15 : e instanceof Drone ? 4.4 : e instanceof Alpha ? 0.8 : 0.6);

  /** Where a shot from the platform that hits nothing ends: out along the tilt, or on the floor if the tilt takes it there first. */
  /** The line the crosshair is on, once the aim camera is all the way in: from the camera, down the middle of the view, so a shot goes exactly where the crosshair is (not from eye level, a little below it). */
  function crosshairRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } | null {
    if (!aiming || perchLike() || player.aimAmount < 0.97) return null;
    return { origin: root.camera.position.clone(), dir: root.camera.getWorldDirection(new THREE.Vector3()) };
  }

  function perchBeamEnd(from: THREE.Vector3, floorY: number): THREE.Vector3 {
    const dir = crosshairRay()?.dir ?? new THREE.Vector3(Math.sin(player.facingAngle) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(player.facingAngle) * Math.cos(aimPitch));
    let len = PERCH_AIM_RANGE;
    if (dir.y < -0.01) len = Math.min(len, Math.max(0.5, (from.y - floorY) / -dir.y));
    return from.clone().addScaledVector(dir, len);
  }

  /**
   * A guard up on a container's roof, from the floor: the line from the agent's eye to its chest is a real 3D line, and the container's box (and the walls, six metres up) stop it only where
   * the line is lower than their tops. So it is a shot from a few metres off at a guard near the roof's edge, not at one deep in on the roof, and never through a wall.
   */
  function tryFireUp(enemies: readonly Enemy[], walls: WallBox[], cone?: number): Enemy | null {
    if (roofY !== null) return null;
    const up = enemies.filter((e) => !e.disabled && e.floorY > player.worldY + 1).sort((a, b) => Math.hypot(a.worldX - player.worldX, a.worldZ - player.worldZ) - Math.hypot(b.worldX - player.worldX, b.worldZ - player.worldZ));
    for (const e of up) {
      if (!tryFire(player.worldX, player.worldZ, player.facingAngle, [e], [], cone)) continue;
      if (lineClearOver(player.worldX, player.worldY + 1.2, player.worldZ, e.worldX, e.floorY + 1.2, e.worldZ, walls)) return e;
    }
    return null;
  }

  function aimedHit(floor: ActiveFloor): AimedHit<Enemy> | null {
    const volumes: HitVolume<Enemy>[] = [];
    for (const enemy of floor.content.enemies) {
      if (enemy.disabled) continue;
      if (enemy instanceof Bot) {
        const scale = enemy.bodyScale;
        const head = enemy.headWorldPosition;
        volumes.push({ target: enemy, zone: 'head', x: head.x, y: head.y, z: head.z, rx: 0.18 * scale, ry: 0.22 * scale, rz: 0.18 * scale });
        volumes.push({ target: enemy, zone: 'body', x: enemy.worldX, y: enemy.floorY + 0.95 * scale, z: enemy.worldZ, rx: 0.36 * scale, ry: 0.6 * scale, rz: 0.28 * scale });
      } else {
        volumes.push({ target: enemy, zone: 'body', x: enemy.worldX, y: enemy.floorY + enemyAimHeight(enemy), z: enemy.worldZ, rx: 0.45, ry: 0.4, rz: 0.45 });
      }
    }
    const cross = crosshairRay();
    return rayHitVolumes(
      cross ? { x: cross.origin.x, y: cross.origin.y, z: cross.origin.z } : { x: player.worldX, y: player.worldY + (perchLike() ? PERCH_EYE_UP : 1.2), z: player.worldZ },
      cross ? { x: cross.dir.x, y: cross.dir.y, z: cross.dir.z } : { x: Math.sin(player.facingAngle) * Math.cos(aimPitch), y: Math.sin(aimPitch), z: Math.cos(player.facingAngle) * Math.cos(aimPitch) },
      volumes, floor.rig.wallBoxes, perchLike() ? PERCH_AIM_RANGE : FIRE_RANGE + (cross ? Math.hypot(cross.origin.x - player.worldX, cross.origin.z - player.worldZ) : 0), // the range is the agent's, but the line starts at the camera behind them
      floor.rig.group.position.y
    );
  }

  /** What the crosshair is on, for its colour and its word: a head (gold), a body (red; on a heavy it says armour), or nothing. */
  function showCrosshair(floor: ActiveFloor): void {
    const hit = aimedHit(floor);
    hud.setCrosshair(true, hit?.zone ?? null, crosshairNote(hit?.zone ?? null, hit?.target.kind === 'heavy'));
  }

  /** Aiming from cover with a bot in the sights, the aim eases up to its head (aimassist.ts) unless the player has just tilted it by hand. */
  function easeAimToHead(floor: ActiveFloor, dt: number): void {
    const hit = aimedHit(floor);
    if (!hit || !(hit.target instanceof Bot)) return;
    const head = hit.target.headWorldPosition;
    const cross = crosshairRay();
    let want: number;
    if (cross) {
      // The middle of the view is the line of fire, and it isn't level (the camera looks down from above the shoulder): tilt by however far, at the head's distance, that line is under the head.
      const dist = Math.max(0.5, Math.hypot(head.x - cross.origin.x, head.z - cross.origin.z));
      const horiz = Math.max(1e-3, Math.hypot(cross.dir.x, cross.dir.z));
      const lineY = cross.origin.y + (cross.dir.y / horiz) * dist;
      want = aimPitch + (head.y - lineY) / dist;
    } else {
      want = headPitch(player.worldY + 1.2, head.y, Math.hypot(head.x - player.worldX, head.z - player.worldZ));
    }
    aimPitch = assistPitch(aimPitch, Math.max(-0.8, Math.min(0.8, want)), stats.seconds - aimManualAt, dt);
  }

  function aimedTarget(floor: ActiveFloor): Enemy | null {
    return aimedHit(floor)?.target ?? null;
  }

  function handleFire(forceEmp = false): void {
    if (proneBlocks(true)) return;
    if (cleared || caught || paused() || stashing) return;
    // In cover, Fire leans out to aim first (aiming isn't a shot, so it works mid-recharge); the next press takes the shot. A guard in reach for a takedown comes first.
    if ((inCover || perchLike()) && !aiming && !forceEmp && !(takedownTarget && !takedownTarget.disabled)) {
      setAiming(true);
      return;
    }
    if (fireCooldown > 0) {
      if (charging) dryFire();
      return;
    }
    // Up in the ceiling, Fire lets go of the pipe (onto a guard, if one's below).
    if (aloft && !(perchLike() && aiming)) {
      if (aloft.kind === 'hang') letGo();
      else if (aloft.kind === 'ledge') letGoLedge();
      else if (aloft.kind === 'highwall') dropFromWall();
      return;
    }
    if (carried) {
      hud.showToast('HANDS FULL · DROP THE BODY FIRST', 'neutral');
      return;
    }
    const floor = currentFloor();
    if (!forceEmp && !aiming && takedownTarget && !takedownTarget.disabled) {
      performTakedown(takedownTarget);
      return;
    }
    if (hiddenIn || ventTransit) return;
    const shotCone = aiming ? AIM_HALF_ANGLE : undefined; // aiming, the crosshair is the aim
    // From the platform the shot comes down over every wall, and reaches further.
    // Only what the agent can actually see: the line to a guard is a real 3D line, over the walls near the platform and stopped by the ones near him.
    const fromPerch = perchLike();
    // (From under a sofa or a desk the piece itself does not stop the shot.)
    const lyingUnder = underBox();
    // (From a container's roof the shot goes over the containers.)
    const shotWalls = roofY !== null ? floor.rig.wallBoxes.filter((b) => b.roof === undefined) : lyingUnder?.cover ? floor.rig.wallBoxes.filter((b) => b !== lyingUnder) : floor.rig.wallBoxes;
    const aimHit = aiming ? aimedHit(floor) : null;
    let target = aiming
      ? aimHit?.target ?? null
      : tryFire(player.worldX, player.worldZ, player.facingAngle, floor.content.enemies, shotWalls, shotCone) ?? tryFireUp(floor.content.enemies, floor.rig.wallBoxes, shotCone);
    // On a stair, climbing, the storey above is already in view (its guards are shown from the middle of the flight): they can be shot from there, not only once the last step is off it.
    if (tower && !target && !aiming && !fromPerch && activeFloorIdx + 1 < storeys.length && player.worldY - floor.rig.group.position.y > floorHeight * 0.25 && stairsAt(player.worldY).length > 0) {
      const above = storeys[activeFloorIdx + 1]!;
      target = tryFire(player.worldX, player.worldZ, player.facingAngle, above.content.enemies, above.rig.wallBoxes, shotCone);
    }
    const tool = pickTool(target, empCharges, forceEmp);
    // With no enemy in the sights, a stun shot can put out a light or knock over clutter.
    // (In the tower, a camera's switch on the wall is a target too, from as far as the gun reaches: the shot shorts it out for good.)
    const panelAim = (tower || bunker) && !target && !fromPerch && tool === 'stun' ? tryFire(player.worldX, player.worldZ, player.facingAngle, panelTargets(), shotWalls, PANEL_HALF_ANGLE) : null;
    const lightAim = !target && !panelAim && !fromPerch && tool === 'stun' ? tryFire(player.worldX, player.worldZ, player.facingAngle, floor.content.lights, shotWalls, shotCone) : null;
    const propAim = !target && !panelAim && !lightAim && !fromPerch && tool === 'stun' ? tryFire(player.worldX, player.worldZ, player.facingAngle, floor.content.props, shotWalls, shotCone) : null;
    if (tool === 'none') {
      sound.play('denied');
      hud.showToast(target ? "NO EMP CHARGES · A STUN WON'T STOP IT" : 'NO EMP CHARGES', 'bad');
      return;
    }
    fireCooldown = dualOn ? FIRE_COOLDOWN_S / 2 : FIRE_COOLDOWN_S; // (two guns, fired in turn: a shot twice as often)
    const useOff = dualOn && offTurn;
    if (dualOn) offTurn = !offTurn;
    const gunUsed = useOff ? offhandGun : player.gunName;
    charging = true;
    sound.play('recharge', undefined, 0.8);
    lastShotAt = stats.seconds;
    // A shot gives you away: bots within a couple of cells come to see where it came from.
    for (const e of floor.content.enemies) {
      if (e instanceof Bot && e !== target) e.investigate(player.worldX, player.worldZ, 3, floor.content.navCells, floor.content.cols, floor.content.rows, SHOT_HEARD_CELLS);
    }

    // Where the shot goes: the target's chest, or straight ahead (an EMP
    // with nothing in the sights bursts at the first wall).
    const from = useOff ? player.offhandMuzzle : player.muzzleWorldPosition;
    const fx = Math.sin(player.facingAngle);
    const fz = Math.cos(player.facingAngle);
    const reach = target ? 0 : tool === 'emp' ? Math.max(1, rayToBoxes(player.worldX, player.worldZ, fx, fz, FIRE_RANGE, shotWalls) - 0.3) : FIRE_RANGE;
    const to = target
      ? aimHit ? new THREE.Vector3(aimHit.point.x, aimHit.point.y, aimHit.point.z) : new THREE.Vector3(target.worldX, target.floorY + enemyAimHeight(target), target.worldZ)
      : aiming
        ? perchBeamEnd(from, floor.rig.group.position.y)
        : new THREE.Vector3(player.worldX + fx * reach, from.y, player.worldZ + fz * reach);

    if (tool === 'stun') {
      stats.shotsFired++;
      const floorY = floor.rig.group.position.y;
      const aimAt = panelAim
        ? new THREE.Vector3(panelAim.worldX, floorY + 1.3, panelAim.worldZ)
        : lightAim
        ? new THREE.Vector3(lightAim.worldX, floorY + WALL_H - 0.3, lightAim.worldZ)
        : propAim
          ? new THREE.Vector3(propAim.worldX, floorY + 0.4, propAim.worldZ)
          : to;
      activeTracers.push(spawnShot(root.scene, gunUsed, from, aimAt));
      player.kick(clock.elapsedTime, useOff);
      sound.play(shotSound(gunUsed));
      partnerBackup(target ?? null);
      if (exitMode && !target) shotAtFurniture(floor, activeFloorIdx, gunUsed);
      const result = target instanceof Bot ? target.hit('stun', aimHit?.zone) : target?.hit('stun');
      if (target && result === 'disabled') {
        if (aiming) aimedDowns++;
        enemyDown(target, to);
        hud.showToast(aimHit?.zone === 'head' ? 'HEADSHOT · BOT DISABLED' : 'BOT DISABLED', 'good');
      } else if (target && result === 'slowed') {
        bursts.sparks(to, 0x66ccff);
        hud.showToast('WATCHDOG SLOWED · GET OUT OF EARSHOT, IT WILL BE BACK ON YOUR TRAIL SOON', 'neutral', 3800);
      } else if (target && result === 'damaged') {
        // A heavy's armour took it: one plate gone, and it's staggered — open to a takedown for a moment.
        bursts.sparks(to, 0xffa040);
        sound.play('armour', { x: to.x, y: to.y, z: to.z });
        hud.showToast(target instanceof Bot && target.isWhite ? 'PLATE CRACKED · A FLASH OPENS IT UP' : 'ARMOUR CRACKED · IT’S STAGGERED', 'neutral');
      } else if (panelAim) {
        switchCameraOff(panelAim.cam, true);
      } else if (lightAim) {
        shootLight(lightAim, aimAt);
      } else if (propAim) {
        knockProp(propAim, floor);
      }
      return;
    }

    empCharges--;
    stats.empsUsed++;
    activeTracers.push(spawnEmpPulse(root.scene, from, to, EMP_BLAST_RADIUS, floor.rig.group.position.y));
    sound.play('emp', { x: to.x, y: to.y, z: to.z });
    const hits = empVictims(floor.content.enemies, to.x, to.z).map((e) => ({ e, r: e.hit('emp') }));
    const downed = hits.filter((h) => h.r === 'disabled').map((h) => h.e);
    const cracked = hits.filter((h) => h.r === 'damaged').length;
    for (const e of downed) {
      enemyDown(e, new THREE.Vector3(e.worldX, e.floorY + 0.6, e.worldZ));
      zapEnemy(to, e);
    }
    hud.showToast(downed.length ? `EMP · ${downed.length} DISABLED${cracked ? ` · ${cracked} CRACKED` : ''} · ${empCharges} LEFT` : cracked ? `EMP · ${cracked} PLATES CRACKED · ${empCharges} LEFT` : `EMP · NOTHING IN RANGE · ${empCharges} LEFT`, downed.length || cracked ? 'good' : 'neutral');
  }

  /** The job is over (caught, cleared, or a station failed): the offer of a flash grenade and the slow motion go with it. */
  function endFlashOffer(): void {
    hud.showGrenadePrompts(false, false, '', '');
    bullet = { ...bullet, on: false };
    bulletOfferHold = 0;
    hud.showBullet(null, '', 1);
    slow = NO_SLOW;
    slowScale = 1;
    panicHold = 0;
    hud.showFlashPrompt(false);
    hud.setSlowmo(false);
  }

  /** Throws a flash grenade ahead of the agent: it goes off a moment after it lands (detonateFlash). */
  function handleFlash(): void {
    if (cleared || caught || paused() || stashing || flashCooldown > 0) return;
    if (training && !weapons && !tower) {
      hud.showToast('NO FLASH GRENADES IN THIS TRAINING', 'neutral');
      return;
    }
    if (flashesLeft <= 0) {
      sound.play('denied');
      hud.showToast('NO FLASH GRENADES LEFT', 'bad');
      return;
    }
    flashesLeft--;
    flashesUsed++;
    flashCooldown = FLASH_COOLDOWN_S;
    hud.setFlashes(flashesLeft);
    slow = endSlow(slow);
    slowScale = 1;
    hud.setSlowmo(false);
    const rail = railThrow();
    const floor = rail?.floor ?? currentFloor();
    sound.play('flareThrow');
    activeFlashes.push(spawnFlashbang(root.scene, player.worldX, player.worldY, player.worldZ, player.facingAngle, floor.rig.wallBoxes, (x, y, z) => detonateFlash(floor, x, y, z), rail?.over));
  }

  /** The bang: every guard and dog with a clear line to it is blinded and deafened (flash.ts); everyone else in earshot comes to look. */
  function detonateFlash(floor: ActiveFloor, x: number, y: number, z: number): void {
    sound.play('flashBang', { x, y, z }, 1);
    bursts.sparks(new THREE.Vector3(x, y, z), 0xffffff);
    const { navCells, cols: fc, rows: fr } = floor.content;
    const dazedNow = new Set<Enemy>();
    for (const e of floor.content.enemies) {
      const secs = dazeFor(e.kind);
      if (e.disabled || secs === null || !e.daze) continue;
      if (Math.hypot(e.worldX - x, e.worldZ - z) > FLASH_RADIUS || !hasLineOfSight(x, z, e.worldX, e.worldZ, floor.rig.wallBoxes, FLASH_RADIUS)) continue;
      if (!e.daze(secs, x, z)) continue;
      dazedNow.add(e);
      chasing.delete(e);
      dazeStars.push(spawnDazeStars(root.scene, () => ({ x: e.worldX, y: e.floorY + (e.kind === 'watchdog' ? 1.05 : 2.05), z: e.worldZ }), secs));
    }
    flashDazed += dazedNow.size;
    // It was loud: the rest within earshot come to see, and get there while the dazed ones are still stumbling about.
    for (const e of floor.content.enemies) {
      if (!e.disabled && !dazedNow.has(e)) e.investigate?.(x, z, 6, navCells, fc, fr, FLASH_NOISE_CELLS);
    }
    // The white-out: nearly all of it close to the bang on the same floor, little from across the building.
    const near = Math.abs(player.worldY - y) < 3 ? Math.max(0.2, 0.9 - Math.hypot(player.worldX - x, player.worldZ - z) * 0.1) : 0.15;
    hud.flashOut(near);
    if (dazedNow.size > 0) {
      suspicion = Math.min(suspicion, SUSPICION_AFTER);
      hud.setSuspicion(suspicion);
    }
    hud.showToast(
      dazedNow.size > 0 ? `FLASH · ${dazedNow.size} DAZED · ABOUT 10 SECONDS TO GET AWAY AND HIDE, THEN THEY COME TO LOOK` : 'FLASH · NOTHING HAD A CLEAR LINE TO IT, BUT EVERYONE NEARBY HEARD',
      dazedNow.size > 0 ? 'good' : 'neutral',
      4200
    );
  }

  /** Throws a grenade ahead of the agent (the flash's arc): `onLand` is where and when it goes off. */
  function throwGrenade(color: number, fuseS: number, onLand: (floor: ActiveFloor, x: number, y: number, z: number) => void): void {
    const rail = railThrow();
    const floor = rail?.floor ?? currentFloor();
    sound.play('flareThrow');
    thrownGrenades.push(spawnThrown(root.scene, player.worldX, player.worldY, player.worldZ, player.facingAngle, floor.rig.wallBoxes, color, fuseS, (x, y, z) => onLand(floor, x, y, z), rail?.over));
  }

  /** A smoke grenade: a cloud where it lands that guards cannot see through, for about ten seconds (smoke.ts). */
  function handleSmoke(): void {
    if (cleared || caught || paused() || stashing || grenadeCooldown > 0 || (training && !tower)) return;
    if (smokesLeft <= 0) {
      sound.play('denied');
      hud.showToast('NO SMOKE GRENADES LEFT', 'bad');
      return;
    }
    smokesLeft--;
    grenadeCooldown = GRENADE_COOLDOWN_S;
    hud.setGrenades(smokesLeft, shocksLeft);
    throwGrenade(0x8a949c, 0.1, (floor, x, y, z) => {
      sound.play('smokePop', { x, y, z }, 1);
      smokeClouds.pop(x, y, z);
      smokes.push({ x, z, age: 0, content: floor.content });
      // A quiet hiss: only the nearest guards come to see what it was.
      for (const e of floor.content.enemies) if (!e.disabled && e instanceof Bot) e.investigate(x, z, 4, floor.content.navCells, floor.content.cols, floor.content.rows, SMOKE_NOISE_CELLS);
      hud.showToast('SMOKE · GUARDS CAN’T SEE THROUGH IT, AND SEE ONLY A FEW STEPS FROM INSIDE IT · IT CLEARS IN ABOUT 10 SECONDS · DOGS AND DRONES AREN’T FOOLED', 'good', 4800);
    });
  }

  /** A shock grenade: the dogs with a clear line to it are blinded and deafened (smoke.ts); guards only hear it. */
  function handleShock(): void {
    if (cleared || caught || paused() || stashing || grenadeCooldown > 0 || (training && !tower)) return;
    if (shocksLeft <= 0) {
      sound.play('denied');
      hud.showToast('NO SHOCK GRENADES LEFT', 'bad');
      return;
    }
    shocksLeft--;
    grenadeCooldown = GRENADE_COOLDOWN_S;
    hud.setGrenades(smokesLeft, shocksLeft);
    throwGrenade(0x3aa6c8, 0.3, (floor, x, y, z) => {
      sound.play('shockPop', { x, y, z }, 1);
      blasts.shock(new THREE.Vector3(x, floor.rig.group.position.y + 0.05, z));
      const { navCells, cols: fc, rows: fr } = floor.content;
      const hit = new Set<Enemy>();
      for (const e of floor.content.enemies) {
        if (e.disabled || e.kind !== 'watchdog' || !e.daze) continue;
        if (Math.hypot(e.worldX - x, e.worldZ - z) > SHOCK_RADIUS || !hasLineOfSight(x, z, e.worldX, e.worldZ, floor.rig.wallBoxes, SHOCK_RADIUS)) continue;
        if (!e.daze(SHOCK_DAZE_S, x, z)) continue;
        hit.add(e);
        chasing.delete(e);
        blasts.zap(() => new THREE.Vector3(x, floor.rig.group.position.y + 0.15, z), () => new THREE.Vector3(e.worldX, e.floorY + 0.5, e.worldZ), 0.8, 0x7fd8ff);
        blasts.word(e.worldX, e.floorY + 1.4, e.worldZ, 'YELP!');
        dazeStars.push(spawnDazeStars(root.scene, () => ({ x: e.worldX, y: e.floorY + 1.05, z: e.worldZ }), SHOCK_DAZE_S));
      }
      flashDazed += hit.size;
      // It is a loud crack: guards in earshot come to see (the dogs it hit, stumbling about, do not).
      for (const e of floor.content.enemies) if (!e.disabled && !hit.has(e) && e.kind !== 'watchdog') e.investigate?.(x, z, 5, navCells, fc, fr, SHOCK_NOISE_CELLS);
      hud.showToast(hit.size > 0 ? `SHOCK · ${hit.size} DOG${hit.size === 1 ? '' : 'S'} BLINDED AND DEAF FOR ABOUT ${SHOCK_DAZE_S} SECONDS · GET PAST` : 'SHOCK · NO DOG HAD A CLEAR LINE TO IT, BUT THE GUARDS NEARBY HEARD', hit.size > 0 ? 'good' : 'neutral', 4200);
    });
  }

  function handleFlare(): void {
    if (cleared || caught || paused() || flareCooldown > 0) return;
    flareCooldown = FLARE_COOLDOWN_S;
    const rail = railThrow();
    const floor = rail?.floor ?? currentFloor();
    sound.play('flareThrow');
    activeFlares.push(
      spawnFlare(root.scene, player.worldX, player.worldY, player.worldZ, player.facingAngle, floor.rig.wallBoxes, (x, z, burn) => {
        flareHums.push(sound.loop('flare', { x, y: floor.rig.group.position.y + 0.3, z }, 0.9, burn));
        // Where it lands, nearby bots walk over to look — a sentry leaves its door.
        let sentryDrawn = false;
        for (const e of floor.content.enemies) {
          if (e.investigate?.(x, z, burn, floor.content.navCells, floor.content.cols, floor.content.rows, DISTRACT_CELLS) && e instanceof Bot && e.isSentry) sentryDrawn = true;
        }
        if (sentryDrawn) {
          lures++;
          hud.showToast('SENTRY DISTRACTED', 'neutral');
        }
      }, rail?.over)
    );
    lightBudget.adopt();
  }

  const keyboard = initKeyboardControls(
    {
      onPosture: cyclePosture,
      onInteract: handleInteract,
      onFire: () => handleFire(),
      onAim: toggleAim,
      onOtherKey: (action) => {
        if (action === 'sneak') return; // (the posture key's own handler gets the agent back up: ducking here first would leave it a step on to crouching)
        // W and S tilt the aim; other actions duck.
        if (aiming && action !== 'forward' && action !== 'back') duck();
      },
      onForceEmp: () => handleFire(true),
      onFlare: handleFlare,
      onFlash: handleFlash,
      onSmoke: handleSmoke,
      onShock: handleShock,
      onGun: () => (gunMenuOpen ? closeGunMenu() : openGunMenu()),
      onGrapple: handleGrapple,
      onToggleMute: () => hud.setMuted(sound.toggleMute()),
      onToggleView: toggleFpsView,
      onToggleMusic: () => {
        const on = sound.toggleMusic();
        hud.setMusic(on);
        hud.showToast(on ? 'MUSIC ON' : 'MUSIC OFF', 'neutral');
      },
      onToggleMap: toggleBlueprint,
      onCamo: handleCamo,
      onTorch: handleTorch,
      onGoggles: handleGoggles,
      onTrap: handleTrap,
      onTrapHere: () => (trapAiming ? setTrapHere() : canSetTrap() && placeTrap(null)),
      onDetonate: handleDetonate,
      onNextTrap: handleNextTrap,
      onDodge: handleDodge,
      onCloseMap: () => {
        cancelTrapAim();
        closeControls();
        closeBlueprint();
        closeLetter();
      },
      onToggleControls: toggleControls,
      onLetter: () => (letterOpen ? closeLetter() : openLetter()),
      onRecon: replayTour,
      onGuide: toggleGuide,
    },
    signal,
    () => controlSettings.smooth,
    () => keyMap,
    () => controlSettings.dash
  );
  hud.wireMute(sound.isMuted, () => sound.toggleMute(), signal);
  hud.wireTorch(handleTorch, signal);
  hud.wireGoggles(handleGoggles, signal);
  hud.wireControls(toggleControls, closeControls, signal);
  hud.wirePdaMessage(openLetter, signal);
  hud.wireGuide(toggleGuide, signal);
  hud.wireTour(nextTour, skipTour, replayTour, signal);
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat || !tour) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') nextTour();
      else if (e.code === 'Escape') skipTour();
    },
    { signal }
  );
  hud.wireAbandon(levelName ? 'Leave the level' : training ? 'Leave training' : 'Abandon job', abandonJob, signal);
  hud.setGoggles(false, goggles.energy, true);
  hud.wireTraps(handleTrap, handleNextTrap, handleDetonate, signal);
  hud.wireTrapAim({ roll: rollTrap, here: setTrapHere, dash: dashToAim, cancel: cancelTrapAim }, signal);
  hud.setTrapsLeft(trapsLeft);
  hud.setTrapFeed(null);
  setTorchOn(false); // every job starts in the dark: the torch is the player's call
  hud.wireMap(toggleBlueprint, signal);
  hud.wireMusic(sound.isMusicOn, () => sound.toggleMusic(), signal);
  // How low the agent is (posture.ts): Shift steps stand, crouch, prone; the sneak button on a phone does the same.
  // Every job and level starts crouched (the lessons that teach standing, crouching and lying do not: they start from standing).
  const startsCrouched = !training || tower || bunker || dock;
  let postureState: PostureState = startsCrouched ? { posture: 'crouch', dir: 'down', at: -Infinity } : STANDING;
  if (startsCrouched) hud.setPosture('crouch', nextPosture(postureState, 0));
  let dashState: DashState = FULL_DASH; // the dash's energy (dash.ts)
  let proneToastAt = -Infinity;
  /** Whether the agent is flat on the floor and can't act: says so (not more than every few seconds) and the caller stops. */
  function proneBlocks(forFire = false): boolean {
    // (Lying flat, the agent can fire: crawling, or under a sofa or a desk where nobody sees the muzzle but whoever it is pointed at.)
    if (forFire) return false;
    if (postureState.posture !== 'prone' || aiming || onWallTop()) return false; // (lying down on a platform to aim is the one time it can shoot, and lying along a wall top is how you are up there)
    if (stats.seconds - proneToastAt > 3) {
      proneToastAt = stats.seconds;
      hud.showToast(keyed('STAND UP FIRST · {sneak} GETS YOU UP').toUpperCase(), 'neutral', 2400);
    }
    return true;
  }
  function cyclePosture(): void {
    if (aiming && !fpsOn()) { // (first person keeps the view up: the key changes posture instead)
      duck();
      return;
    }
    // In cover the agent is always crouched; in a locker, a vent or on the ladder there's no choice to make.
    // (And in the arrival lift, where nothing is the player's to steer until the agent is out.)
    if (cleared || caught || inCover || hiddenIn || ventTransit || arrivalPhase !== 'done' || (aloft && !perchLike())) return;
    if (postureState.posture === 'prone' && underFurniture()) {
      hud.showToast('TOO LOW TO STAND UP HERE · CRAWL OUT FIRST', 'neutral', 2200);
      return;
    }
    const next = silent ? pressSilent(postureState, stats.seconds) : press(postureState, stats.seconds);
    if (bunker && next.posture === 'stand' && underBox()?.duct) {
      hud.showToast('TOO LOW TO STAND UP HERE · CRAWL OUT FIRST', 'neutral', 2200);
      return;
    }
    if (next.posture === 'prone' && carried) {
      hud.showToast('YOU CAN’T CRAWL WITH A BODY', 'neutral', 2200);
      return;
    }
    postureState = next;
    hud.setPosture(next.posture, silent ? pressSilent(next, stats.seconds).posture : nextPosture(next, stats.seconds));
    touch.setPosture(next.posture);
  }
  const touch = initTouchControls(handleInteract, handleFire, handleCamo, handleDodge, cyclePosture, () => controlSettings.dash, signal,
    () => (aiming ? duck() : toggleAim()) // (the Aim / Duck button)
  );
  if (startsCrouched) touch.setPosture('crouch');
  hud.noteTouchJob();
  hud.wireKit({ trap: handleTrap, flare: handleFlare, torch: handleTorch, goggles: handleGoggles, map: toggleBlueprint, grapple: handleGrapple, gun: openGunMenu }, signal);
  hud.setGunKey(keyName(keyMap.gun));
  hud.wireGunMenu(GUN_MENU, { open: openGunMenu, pick: pickGun, close: closeGunMenu }, signal);
  hud.wireFlash(handleFlash, signal);
  hud.setFlashes(flashesLeft);
  hud.setGrenades(smokesLeft, shocksLeft);
  hud.wireGrenades(handleSmoke, handleShock, signal);
  hud.wireBullet(toggleBulletNow, signal);
  hud.setFlashLesson(weapons);
  hud.showFlashPrompt(false);

  // Desktop fire: a plain left mouse click on the canvas. Gated to
  // pointerType 'mouse' so it doesn't double up with the touch Fire button
  // (a canvas tap on mobile still only grabs focus, same as before).
  canvas.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 0) handleFire(false);
      if (fpsOn() && !document.pointerLockElement) (canvas.requestPointerLock as () => unknown)?.call(canvas); // (the pointer looks around: it needs a click to be taken)
      if (e.pointerType === 'mouse' && e.button === 2 && !fpsOn()) toggleAim();
    },
    { signal }
  );
  // Aiming, the mouse steers the crosshair (and the right button leans out and back, above).
  window.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (aiming && e.pointerType === 'mouse') {
        aimMouse += e.movementX;
        aimMouseY += e.movementY;
      }
    },
    { signal }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  window.addEventListener('resize', () => handleResize(root), { signal });
  // Browsers can suspend audio (backgrounded tab, phone lock); any input resumes it.
  window.addEventListener('pointerdown', () => sound.start(), { signal });
  window.addEventListener('keydown', () => sound.start(), { signal });

  let rafId = 0;
  const clock = new THREE.Clock();
  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // Clamped: a backgrounded tab, device sleep, or any frame hitch can hand
    // back a huge elapsed time on the next frame — unclamped, that single
    // frame could let a bot's patrol jump a large distance, or let its
    // line-of-sight pinpoint timer (built up in small per-frame increments)
    // cross its threshold in one step instead of over real sustained sight.
    // Zero while the blueprint is open: the whole job holds still under it.
    const frameDt = Math.min(clock.getDelta(), 0.1);
    // Bullet time: the meter and the effect move in real seconds; the world runs at its slowed pace, the agent (and their gadgets and gun) at theirs.
    const bulletWas = bullet.on;
    if (!paused() && !caught && !cleared) bullet = tickBullet(bullet, frameDt);
    else if ((caught || cleared) && bullet.on) bullet = { ...bullet, on: false };
    if (bulletWas && !bullet.on) sound.play('bulletOut', undefined, 0.8);
    const pace = bulletPace(bullet.k);
    const dt = paused() ? 0 : frameDt * slowScale * pace.world;
    const pdt = paused() ? 0 : frameDt * pace.player;
    if (paused() && document.pointerLockElement) document.exitPointerLock(); // (a sheet or menu is open: the pointer is the player's again; a click on the game takes it back)

    if (flareCooldown > 0) flareCooldown = Math.max(0, flareCooldown - dt);
    if (flashCooldown > 0) flashCooldown = Math.max(0, flashCooldown - dt);
    if (grenadeCooldown > 0) grenadeCooldown = Math.max(0, grenadeCooldown - dt);
    if (fireCooldown > 0) {
      fireCooldown = Math.max(0, fireCooldown - pdt);
      if (fireCooldown === 0 && charging) {
        charging = false;
        sound.play('ready', undefined, 0.75);
        hud.flashReady();
      }
    }
    touch.setAiming(aiming);
    // Up on a platform, aiming is seen from the agent's own eyes: the body is still lying there, but only the arms and the gun are in front of the camera.
    player.setEyeView(aiming && perchLike());
    touch.setFireEnabled(fireCooldown <= 0 || ((inCover !== null || perchLike()) && !aiming));
    const fireMax = dualOn ? FIRE_COOLDOWN_S / 2 : FIRE_COOLDOWN_S;
    hud.setFireCharge(1 - fireCooldown / fireMax);
    player.setWeaponState(1 - fireCooldown / fireMax, empCharges, clock.elapsedTime);

    for (let i = activeAssemblies.length - 1; i >= 0; i--) {
      if (!activeAssemblies[i]!.update(dt)) activeAssemblies.splice(i, 1);
    }
    for (let i = activeTracers.length - 1; i >= 0; i--) {
      if (!activeTracers[i]!.update(dt)) activeTracers.splice(i, 1);
    }
    for (let i = activeFlares.length - 1; i >= 0; i--) {
      if (!activeFlares[i]!.update(pdt)) activeFlares.splice(i, 1);
    }
    for (let i = thrownGrenades.length - 1; i >= 0; i--) if (!thrownGrenades[i]!.update(pdt)) thrownGrenades.splice(i, 1);
    for (let i = smokes.length - 1; i >= 0; i--) {
      smokes[i]!.age += dt;
      if (smokes[i]!.age >= SMOKE_S) smokes.splice(i, 1);
    }
    smokeClouds.update(dt);
    for (let i = activeFlashes.length - 1; i >= 0; i--) {
      if (!activeFlashes[i]!.update(pdt)) activeFlashes.splice(i, 1);
    }
    for (let i = dazeStars.length - 1; i >= 0; i--) {
      if (!dazeStars[i]!.update(dt)) dazeStars.splice(i, 1);
    }
    ambient.update(clock.elapsedTime);
    bursts.update(dt);
    blasts.update(dt);
    updateSights(dt);
    tickFuelCells(dt);
    tickSkylight(dt);
    tickTower(dt);
    if (bunker) tickCameras(dt);
    for (const { content } of storeys) {
      for (const rig of content.doors) rig.update(dt);
      for (const l of content.lockers) l.rig.update(dt, clock.elapsedTime);
      for (const l of content.staffLockers) l.rig.update(dt);
    }
    for (const { rig, content } of storeys) tickRoomDoors(content, rig, dt);
    for (const g of gates.values()) g.update(dt);
    for (const t of traps) {
      const arming = t.armingLeft > 0;
      t.update(dt, clock.elapsedTime);
      if (arming && t.armingLeft === 0) refreshTrapFeed();
    }
    tickTrapSensors(dt);
    for (const b of beacons) b.update(clock.elapsedTime);
    for (const c of clueSystems) c.rig.update(clock.elapsedTime);
    bunkerHintTick();
    if (dossierMark) {
      const hp = huntPlan();
      const ready = !!hp && hp.stops.every((l) => clueSystems.some((c) => c.level === l && c.done));
      dossierMark.setState(dossier.found ? 'opened' : ready ? 'marked' : 'hidden');
      dossierMark.update(clock.elapsedTime);
    }
    updateScreens(clock.elapsedTime);
    goalBeacon?.update(clock.elapsedTime);
    for (let i = tipping.length - 1; i >= 0; i--) {
      const tip = tipping[i]!;
      tip.t = Math.min(1, tip.t + dt / 0.35);
      tip.group.rotation.z = -1.35 * tip.t * tip.t;
      if (tip.t >= 1) tipping.splice(i, 1);
    }
    arrival.update(dt);
    exitLift.update(dt);

    if (!cleared && !caught) {
      stats.seconds += dt;
      tickFuses(dt);
      camo = tickCamo(camo, dt, !player.moving);
      // In cover the agent shimmers like the cloak: the crouch animation alone doesn't read as hiding
      // behind something. Only the look — it doesn't drain the battery or hide you any more than cover does.
      player.setCamo(camo.active || ((inCover !== null || covered !== null) && !aiming), clock.elapsedTime);
      hud.setCamoCharge(camo.energy, camo.active, camo.energy >= CAMO_MIN_START);
      const wornBefore = goggles.on;
      goggles = tickGoggles(goggles, dt);
      if (wornBefore && !goggles.on) {
        sound.play('gogglesOff', undefined, 0.8);
        hud.showToast('NIGHT VISION FLAT · RECHARGING', 'bad');
      }
      hud.setGoggles(goggles.on, goggles.energy, goggles.energy >= GOGGLES_MIN_START);
      touch.setCamo(camo.energy, camo.active, camo.energy >= CAMO_MIN_START);
      const kb = keyboard.getInput();
      const tc = touch.getInput();
      // In cover you're always crouched (and low furniture hides you).
      // Up on the ladder or the pipes there's no lying down (a platform is fine): back to standing.
      if (aloft && !perchLike() && postureState.posture !== 'stand') postureState = STANDING;
      // A silent night: no walking or running, so standing up is not on offer; the one key swaps crouch and flat (up the ladder or on the pipes, it's the ladder's rules).
      if (silent && !aloft && postureState.posture === 'stand') postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
      const sneaking = isLow(postureState.posture) || inCover !== null;
      // Leaning out to aim, the furniture no longer hides a crouch from the guards' eyes.
      const detectSneak = isLow(postureState.posture) || ((inCover !== null || covered !== null) && !aiming);
      const proneNow = postureState.posture === 'prone' && !inCover && !handsFull();
      if (dodgeCooldown > 0) dodgeCooldown = Math.max(0, dodgeCooldown - dt);
      const throttleIn = clampAxis(kb.throttle + tc.throttle);
      // While aiming, vertical input tilts. Once ducked and released, pulling back exits.
      if (throttleIn >= -0.5) duckLatch = false;
      else if (inCover &&
        coverBackAction(aiming, duckLatch, throttleIn) === 'leave'
      ) leaveCover();
      if (aiming && ((aloft && !perchLike()) || hiddenIn || ventTransit)) setAiming(false);
      // Moving at all steps out of a staff locker.
      if (hiddenIn && (Math.abs(throttleIn) > 0.5 || Math.abs(clampAxis(kb.strafe + tc.strafe)) > 0.5)) exitLocker();
      // Crawling through a vent: halfway through (screen dark) you're moved to the far grille.
      if (ventTransit) {
        ventTransit.left -= dt;
        if (!ventTransit.moved && ventTransit.left <= VENT_S / 2) {
          ventTransit.moved = true;
          const o = ventTransit.floor.rig.group.position;
          const st = ventTransit.to.stand;
          player.place(st.x + o.x, st.z + o.z, st.facing + Math.PI); // out of the grille, facing away from it
          hud.setFade(false);
        }
        if (ventTransit.left <= 0) ventTransit = null;
      }
      tickStash(dt);
      const frozen = hiddenIn !== null || ventTransit !== null || stashing !== null;
      // The floor the player is *currently* on (before this frame's
      // movement resolves) — its own bots/laser traps are what the player
      // collides with this frame; the other floor's geometry just happens
      // to share the same X/Z region (the whole point of true 3D stacking),
      // so using the wrong floor's here would be a real, wrong collision,
      // not a no-op.
      // The tower's flights have their side rails on both storeys they join, so which storey's walls hold the agent can follow the height (the heist's stair keeps the one it started on).
      const beforeFloor = tower ? storeys[Math.max(0, Math.min(storeys.length - 1, Math.round(player.worldY / floorHeight)))]! : currentFloor();
      // Downed bots lie flat and don't block — the player steps over them.
      const botBlockers: Blocker[] = beforeFloor.content.enemies.filter((b) => !b.disabled && b.radius > 0).map((b) => ({ x: b.worldX, z: b.worldZ, r: b.radius }));
      tickShutters(dt);
      if (!aloft) strength = stepStrength(strength, 'ground', dt);
      const strainNow = strainView(strength, aloft?.kind === 'hang' || aloft?.kind === 'haul' || aloft?.kind === 'ledge');
      if (strainChanged(strainShown, strainNow)) {
        strainShown = strainNow;
        hud.setStrain(strainNow);
      }
      // In the arrival lift the player doesn't steer: once its doors are open the agent walks straight out.
      if (arrivalPhase === 'open') arrivalWalkLeft -= dt;
      const walkingOut = arrivalPhase === 'open' && arrivalWalkLeft > 0;
      const inLift = arrivalPhase === 'waiting' || walkingOut;
      // The dash (dash.ts): tap forward twice and hold, or double-touch the stick and hold. Not flat, in cover, carrying a body, up
      // in the ceiling, hidden, or in the lift; a crouched agent stands up to do it.
      const fpsLook = fpsOn() && aiming && !inCover && !perchLike(); // first-person: aiming and walking at once
      if (fpsWas && !fpsOn() && aiming) setAiming(false); // (switched off from the sheet: the gun comes down)
      fpsWas = fpsOn();
      if (fpsOn() && !aiming && !inCover && !caught && !cleared && arrivalPhase === 'done') setAiming(true);
      const aimFree = aiming && !inCover && !perchLike() && !fpsOn(); // aiming away from cover: the agent holds still and the crosshair swings
      const wantsDash = controlSettings.dash && !silent && (kb.dash === true || tc.dash === true) && throttleIn > 0 && !proneNow && !inCover && !aimFree && !handsFull() && !aloft && !hiddenIn && !ventTransit && !inLift;
      const dashStep = tickDash(dashState, wantsDash, pdt);
      dashState = dashStep.state;
      const dashingNow = dashState.active;
      if (dashStep.started) {
        dashesBegun++;
        if (postureState.posture !== 'stand') postureState = STANDING;
        sound.play('dodge', undefined, 0.5);
      }
      hud.setDash(dashState.energy, dashingNow);
      // Blinded by a guard's flash: a moment of stumbling at a fraction of the pace.
      const stumble = blindedFor > 0 ? STUMBLE_PACE : 1;
      blindedFor = stumbleLeft(blindedFor, pdt);
      const turnIn = clampAxis(kb.turn + tc.turn) * controlSettings.turn; // the keys' and the stick's turn, at this player's sensitivity
      if (aloft) tickAloft(aloft, pdt, turnIn, throttleIn, clampAxis(kb.strafe + tc.strafe));
      else player.tick(
        {
          turn: inCover || aimFree || frozen || inLift ? 0 : turnIn * stumble,
          throttle: walkingOut ? ARRIVAL_WALK_THROTTLE : inCover || aimFree || frozen || inLift ? 0 : throttleIn * stumble,
          strafe: frozen || inLift || proneNow || aimFree || inCover?.corner ? 0 : clampAxis(kb.strafe + tc.strafe) * stumble,
          sneak: sneaking && !inLift && !dashingNow,
          freeStrafe: fpsOn(),
          prone: proneNow && !inLift,
          dash: dashingNow,
          camo: camo.active,
          carrying: handsFull(),
          cover: inCover !== null,
        },
        pdt,
        roofY !== null ? beforeFloor.rig.wallBoxes.filter((b) => b.roof === undefined) : beforeFloor.rig.wallBoxes,
        botBlockers,
        beforeFloor.content.laserBoxes,
        stairsAt(player.worldY)
      );
      if (tower && (exitMode ? player.currentFloorIdx < towerBest : player.currentFloorIdx > towerBest) && !caught) {
        towerBest = player.currentFloorIdx;
        towerCheckpoint(towerFloorNames[player.currentFloorIdx] ?? 'A new floor');
      }
      if (player.currentFloorIdx !== activeFloorIdx) markGoal(tower ? towerFloorNames[player.currentFloorIdx] ?? 'Another floor' : bunker ? BUNKER_LEVEL_NAMES[player.currentFloorIdx] ?? 'Another storey' : player.currentFloorIdx === 0 ? 'Back on the ground floor' : 'On the next floor');
      activeFloorIdx = player.currentFloorIdx;
      // Stepped off the edge of a container's roof: the height field ends there and the floor takes over, so the drop is played here, from the roof's height.
      if (roofY !== null && !aloft && Math.abs(player.worldY - roofY) > 0.3) {
        aloft = { kind: 'fall', floor: beforeFloor, from: { x: player.worldX, y: roofY, z: player.worldZ }, to: { x: player.worldX, z: player.worldZ }, angle: player.facingAngle, t: 0, target: null, soft: true, crouch: true };
        roofY = null;
      }
      // (Up on a top, a dash at the next container's face is no wall to climb: the height field carries on across, or the leap does.)
      if (!aloft && roofY === null) tryWallClimb(beforeFloor, dashingNow);
      else if (!aloft) dashRun = 0;
      else {
        // (Up on a wall the run-up is not counted, and the first step back on the floor starts from where it stands: a dash begun beside the wall is no run-up.)
        dashRun = 0;
        dashLast = { x: player.worldX, z: player.worldZ };
      }
      player.setProne(proneNow || onWallTop(), postureState.posture === 'crouch'); // (lying along a wall top is set by the climb itself, after proneNow was worked out this frame: don't let that undo it and replay the crawl)
      player.stepLie(pdt);
      hud.setPosture(postureState.posture, silent ? pressSilent(postureState, stats.seconds).posture : nextPosture(postureState, stats.seconds));
      updatePartner(dt, { sneak: sneaking && !inLift && !dashingNow, prone: proneNow && !inLift, dash: dashingNow });
      // A dash that ends beside a crate or a desk ends in cover behind it.
      if (dashing && !player.dashing) {
        dashing = false;
        // (A hop ends on the face it was bound for; any other dash, beside whatever it is next to.)
        const spot = hopTo && Math.hypot(player.worldX - hopTo.px, player.worldZ - hopTo.pz) < 1.2 ? hopTo : coverSpotNear(beforeFloor.rig.wallBoxes, player.worldX, player.worldZ);
        hopTo = null;
        if (tower) {
          // Out of the sprint, crouched where it ended: behind the furniture, but not held in cover.
          if (postureState.posture !== 'crouch') postureState = { posture: 'crouch', dir: 'down', at: stats.seconds };
          if (spot) player.place(player.worldX, player.worldZ, coverFacing(spot));
        } else if (spot && roofY === null && !AUTO_COVER) enterCover(spot);
      }
      // Cover as an indicator: near the face of something to take cover behind (not up on a container's roof, in the air or flat on the floor), the agent is covered.
      if (AUTO_COVER) {
        const here = !aloft && !frozen && !inLift && roofY === null && arrivalPhase === 'done' && !cleared && !caught && postureState.posture !== 'prone';
        const speed = dt > 0 ? Math.hypot(player.worldX - coverFrom.x, player.worldZ - coverFrom.z) / dt : 0;
        coverFrom = { x: player.worldX, z: player.worldZ };
        coverIdle = speed < 0.25 ? coverIdle + dt : 0;
        // Furniture, a crate or a container by the agent; or, once they have stood still a moment, the end of a wall at a corner (walking past an opening is not taking cover).
        covered = here
          ? coverSpotNear(beforeFloor.rig.wallBoxes, player.worldX, player.worldZ, covered ? COVER_KEEP : COVER_TAKE) ??
            (coverIdle > 0.4 || covered?.corner ? cornerSpotNear(beforeFloor.rig.wallBoxes, player.worldX, player.worldZ, undefined, beforeFloor.content.enemies.filter((e) => !e.disabled).map((e) => ({ x: e.worldX, z: e.worldZ }))) : null)
          : null;
        if (covered && !coveredToldOnce) {
          coveredToldOnce = true;
          toastOnce('covered', keyed('IN COVER · YOU GO SEE-THROUGH BESIDE FURNITURE, CRATES AND CONTAINERS, AND NOTHING HOLDS YOU · {aim} AIMS FROM ANYWHERE').toUpperCase(), 5200);
        }
      }
      if (inCover) {
        // Held on the furniture's face (leaning a little past either end to peek), facing over it —
        // but never slid or leaned into a wall at the end of it.
        // At a corner there is one place to hug and one to lean out to: aiming moves between them.
        if (inCover.corner && inCover.lean) {
          const goal = aiming ? inCover.lean : { x: inCover.px, z: inCover.pz };
          const dx = goal.x - player.worldX;
          const dz = goal.z - player.worldZ;
          const d = Math.hypot(dx, dz);
          if (d > 1e-4) {
            const step = Math.min(d, CORNER_LEAN_SPEED * dt);
            player.place(player.worldX + (dx / d) * step, player.worldZ + (dz / d) * step, coverFacing(inCover));
          }
        }
        const held = clampToCover(inCover, player.worldX, player.worldZ);
        const clear = !collides(held.x, held.z, beforeFloor.rig.wallBoxes.filter((b) => b !== inCover!.box));
        // (At a corner the shot may need to swing round further: a guard in a doorway is off to the side of the way the wall faces.)
        const yawLimit = inCover.corner ? CORNER_AIM_YAW : AIM_MAX_YAW;
        if (aiming) aimYaw = Math.max(-yawLimit, Math.min(yawLimit, aimYaw - aimInput(turnIn, onTouch(), controlSettings.aim) * AIM_TURN_RATE * pdt - aimMouse * AIM_MOUSE_RAD * (controlSettings.turn / DEFAULT_CONTROLS.turn) * controlSettings.aim));
        if (aiming) {
          if (Math.abs(throttleIn) > 0.2 || aimMouseY !== 0) aimManualAt = stats.seconds;
          aimPitch = coverPitch(
            aimPitch,
            aimInput(throttleIn, onTouch(), controlSettings.aim),
            aimMouseY,
            controlSettings.turn / DEFAULT_CONTROLS.turn * controlSettings.aim,
            dt
          );
        }
        aimMouse = 0;
        aimMouseY = 0;
        if (aiming) easeAimToHead(beforeFloor, dt);
        player.aimPitch = aiming ? aimPitch : 0;
        player.place(clear ? held.x : lastCoverX, clear ? held.z : lastCoverZ, coverFacing(inCover) + (aiming ? aimYaw : 0));
        lastCoverX = player.worldX;
        lastCoverZ = player.worldZ;
        // The crosshair reddens with something in the sights.
        if (aiming) player.aimWalls = beforeFloor.rig.wallBoxes.filter((b) => !b.cover);
        if (aiming) showCrosshair(beforeFloor);
      } else if (fpsLook) {
        // First person: the keys have already walked and turned the agent; the pointer adds to the turn and tilts the view, and the crosshair is wherever the agent now faces.
        const sens = (controlSettings.turn / DEFAULT_CONTROLS.turn) * controlSettings.aim;
        if (aimMouse !== 0) player.place(player.worldX, player.worldZ, player.facingAngle - aimMouse * AIM_MOUSE_RAD * sens);
        if (aimMouseY !== 0) aimManualAt = stats.seconds;
        aimPitch = coverPitch(aimPitch, 0, aimMouseY, sens, dt);
        aimMouse = 0;
        aimMouseY = 0;
        easeAimToHead(beforeFloor, dt);
        player.aimPitch = aimPitch;
        player.aimWalls = beforeFloor.rig.wallBoxes.filter((b) => !b.cover);
        showCrosshair(beforeFloor);
      } else if (aimFree) {
        // Aiming away from cover: the agent stands where they are and the crosshair swings round them (A and D, the mouse) and up and down (W and S).
        aimYaw = Math.max(-Math.PI, Math.min(Math.PI, aimYaw - aimInput(turnIn, onTouch(), controlSettings.aim) * AIM_TURN_RATE * pdt - aimMouse * AIM_MOUSE_RAD * (controlSettings.turn / DEFAULT_CONTROLS.turn) * controlSettings.aim));
        if (Math.abs(throttleIn) > 0.2 || aimMouseY !== 0) aimManualAt = stats.seconds;
        aimPitch = coverPitch(aimPitch, aimInput(throttleIn, onTouch(), controlSettings.aim), aimMouseY, controlSettings.turn / DEFAULT_CONTROLS.turn * controlSettings.aim, dt);
        aimMouse = 0;
        aimMouseY = 0;
        easeAimToHead(beforeFloor, dt);
        player.aimPitch = aimPitch;
        player.place(player.worldX, player.worldZ, aimBase + aimYaw);
        player.aimWalls = beforeFloor.rig.wallBoxes.filter((b) => !b.cover);
        showCrosshair(beforeFloor);
      }
      // Hanging, the camera swings round a little so the pipe doesn't hide you; on the floor, a pipe right overhead fades.
      const swing = aloft?.kind === 'hang' ? HANG_CAM_SWING : 0;
      player.camSwing += (swing - player.camSwing) * Math.min(1, dt * 3);
      const pipesHere = beforeFloor.content.pipeRig;
      if (pipesHere) fadeLines(pipesHere, beforeFloor.content.pipes!, CELL, player.worldX - beforeFloor.rig.group.position.x, player.worldZ - beforeFloor.rig.group.position.z, !aloft || aloft.kind === 'climb' || aloft.kind === 'haul', dt);
      player.updateCamera(root.camera);
      if (liftCam > 0) {
        if (arrivalPhase === 'done') liftCam = Math.max(0, liftCam - dt / LIFT_CAM_EASE_S);
        const w = liftCam * liftCam * (3 - 2 * liftCam);
        chaseCamPos.copy(root.camera.position);
        root.camera.position.lerpVectors(chaseCamPos, liftCamPos, w);
        root.camera.lookAt(player.worldX, player.worldY + 1, player.worldZ);
      }
      // On a tower's platform, the whole floor from above.
      lookout = aloft?.kind === 'perch' && !aiming ? Math.min(1, lookout + dt / LOOKOUT_EASE_S) : Math.max(0, lookout - dt / LOOKOUT_EASE_S);
      if (lookout > 0) lookoutCamera(lookout);
      // The recon's fly-over (or, after it, the glide back to the chase view) takes the shot.
      if (tour) tickTour(frameDt);
      else if (tourBack) tickTourBack(frameDt);
      // Looking from the camera, is every part of the agent in view? If a wall hides any of them it ghosts out (wallfade.ts); on a flyover, a platform's overview or the other floor, they all come back.
      {
        const seen = !tour && !tourBack && lookout === 0 && liftCam === 0 ? bodySamples(root.camera.position, { x: player.worldX, y: player.worldY, z: player.worldZ }) : null;
        const here = currentFloor().rig;
        // (The bunker's walls are twice as tall: those on the camera's side of the agent, within a few cells of them, go nearly clear.)
        const behind = bunker && seen ? { x: player.worldX, z: player.worldZ, radius: BUNKER_FADE_RADIUS, to: 0.9 } : undefined;
        for (const f of storeys) f.rig.fadeWalls(root.camera.position, f.rig === here ? seen : null, frameDt, f.rig === here ? behind : undefined);
        if (bunker) for (const [l, layer] of signLayers) if (storeys[l]?.rig === here) layer.followWalls((x, z) => here.wallFadeAt(x, z));
        for (const [rig, fader] of towerFaders) {
          const o = rig.group.position;
          fader.update({ x: root.camera.position.x - o.x, y: root.camera.position.y - o.y, z: root.camera.position.z - o.z }, rig === here && seen ? seen.map((p) => ({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z })) : null, frameDt);
        }
        // A tower's platform in the way of the view of an agent walking under it ghosts out too (pipeRig.ts); up on one, or anywhere else, they all come back.
        for (const { content, rig } of storeys) {
          if (!content.pipeRig) continue;
          const o = rig.group.position;
          const c = root.camera.position;
          fadeDecks(content.pipeRig, { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z }, seen && rig === here && !aloft ? seen.map((p) => ({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z })) : null, frameDt);
        }
      }

      // A carried body rides in the agent's arms (or, before its limp pose has loaded, trails behind, feet
      // first). It can't go up or down stairs: it's left where the climb began.
      if (carried) {
        if (Math.abs(player.worldY - carried.floorY) > 0.6) {
          dropBody();
          hud.showToast('TOO HEAVY FOR THE STAIRS · BODY LEFT BEHIND', 'neutral');
        } else if (carried.carriable) {
          carried.carryAt(player.carryAnchor(), player.facingAngle);
        } else {
          const f = player.facingAngle;
          carried.dragTo(player.worldX - Math.sin(f) * 0.45, player.worldZ - Math.cos(f) * 0.45, f + Math.PI);
        }
      }
      // A specimen rides in the arms too, in its case.
      if (specimen) {
        const anchor = player.carryAnchor();
        specimen.mesh.position.set(anchor.x, anchor.y + 0.05, anchor.z);
        specimen.mesh.rotation.y = player.facingAngle;
      }
      objectiveTick();
      twistTick();
      sideTick();

      sound.setListener(player.worldX, player.worldY, player.worldZ, player.facingAngle);
      // One footstep per foot landing in the walk animation; sneaking is quieter.
      if (player.takeFootfalls() > 0) {
        sound.play(metalFloor(currentFloor().rig) ? 'stepRaised' : 'step', undefined, sneaking ? 0.3 : 0.75);
      }

      // Dollhouse-style cutaway: a floor's own floor tiles double as the
      // floor below's implied ceiling (see scene.ts's FLOOR_HEIGHT comment)
      // — great for avoiding separate ceiling geometry, but the chase
      // camera sits CAM_HEIGHT above the player (player.ts), which is
      // *taller* than FLOOR_HEIGHT, so that ceiling plane sits physically
      // between the camera and a player standing on the floor below it,
      // blocking the view entirely. First attempt hid only the floor
      // tiles, keeping walls visible as a "preview the floor above" bonus
      // — reasonable in theory, but live testing showed the camera's
      // steep downward sightline can just as easily clip a floor's WALLS
      // (a corridor's side wall sitting right along that line at the
      // player's own X/Z), not only its floor slab. The floor tiles were
      // never the whole problem, so the whole floor Group hides instead —
      // fully removes any chance of the floor above occluding the player,
      // at the cost of losing that "see the structure above" preview.
      // (On the recon, whichever floor it's looking at.)
      // (Climbing a stair, the floor above is shown from the middle of the flight, not only once the last step is off it.)
      const viewIdx = tour ? tour.floor : activeFloorIdx;
      // (Up a bunker's wall the agent is nearly as high as the floor above, which must not be drawn then: the camera is above that floor's slab, and it would fill the picture. Only a stair shows it.)
      const shownIdx = tour ? viewIdx : bunker && aloft ? viewIdx : Math.max(viewIdx, Math.min(storeys.length - 1, Math.round(player.worldY / floorHeight)));
      storeys.forEach((f, i) => {
        // (The bunker's storeys are tall and many: only the one the agent is on, the one just under it and, half way up a stair, the one above are drawn.)
        if (bunker) f.rig.group.visible = i <= shownIdx && i >= shownIdx - 1;
        else if (i > 0) f.rig.group.visible = shownIdx >= i;
      });
      // Enemies live in the shared scene, not their floor's group, so hide the other floor's with it.
      for (const { content } of storeys) {
        // (Half way up a stair, the floor above is shown, and so are its guards: they are there as it comes into view, not only once the last step is off the flight.)
        const here = content === storeys[Math.min(viewIdx, storeys.length - 1)]!.content || (tower && !tour && content === storeys[Math.min(shownIdx, storeys.length - 1)]!.content);
        // Through the skylight, the guards on the ground floor below it are seen.
        const below = !here && sky !== null && viewIdx >= 1 && content === floor0Content;
        for (const e of content.enemies) e.setVisible(here || (below && Math.hypot(e.worldX - sky!.wx, e.worldZ - sky!.wz) < CELL * 1.5) || (tower && !tour && towerSees(e)));
      }

      // The floor the player ended up on *after* this frame's movement —
      // everything below (vision, bots, artifacts, fragments) reacts to
      // wherever they actually are now, same as it always has for floor 0.
      const active = currentFloor();
      if (activeFloorIdx !== soundFloorIdx) {
        soundFloorIdx = activeFloorIdx;
        for (const hum of rotorHums.values()) hum.stop();
        rotorHums.clear();
        for (const hum of pulseHums.values()) hum.stop();
        pulseHums.clear();
        ambience.stop();
        ambience = ambienceFor(active.rig);
        for (const h of laserHums) h.loop.setVolume(h.idx === activeFloorIdx ? LASER_HUM : 0.0001);
      }
      soundRefreshTimer -= dt;
      if (soundRefreshTimer <= 0) {
        soundRefreshTimer = 0.25;
        for (const h of laserHums) h.loop.refresh();
        for (const f of flareHums) f.refresh();
      }
      // Up high, you see over the walls; from the top of a tower, the whole floor.
      const high = aloft !== null && player.worldY - active.rig.group.position.y > HIGH_UP;
      const visionState = storeys[activeFloorIdx]?.explored ?? null;
      if (visionState && !tour) {
        if (aloft?.kind === 'perch') revealAround(active.rig, visionState, player.worldX, player.worldZ, LOOKOUT_RADIUS, LOOKOUT_SIGHT);
        else updateVision(active.rig, visionState, player.worldX, player.worldZ, player.facingAngle, high ? [] : active.rig.wallBoxes, sight());
        tickFloorTransitions(active.rig, visionState, dt);
      }

      if (tourFade && !tour) {
        const others = storeys.filter((_, i) => i !== activeFloorIdx);
        if (others.some((o) => o.explored.live.size)) {
          for (const o of others) {
            dimLive(o.explored);
            tickFloorTransitions(o.rig, o.explored, frameDt);
          }
        } else tourFade = false;
      }

      beam.update(player.torchOrigin, player.light.target.position, active.rig.wallBoxes);
      // Only the ones that watch get a vision cone (watchdogs listen instead).
      cones.update(active.content.enemies.filter((e): e is Bot => e instanceof Bot), active.rig.wallBoxes, player.worldX, player.worldZ, detectSneak);
      dust.update(clock.elapsedTime, new THREE.Vector3(player.worldX, player.worldY, player.worldZ), player.torchOrigin, player.light.target.position);

      // hiding.ts and rooms.ts store their content at
      // floor-LOCAL cell-index positions (x * CELL, no origin offset) —
      // the same zero-origin assumption already documented for their mesh-
      // building/collision-box functions. player.worldX/worldZ is real
      // world space, so on floor 1 (nonzero origin) it must be converted
      // to that floor's local space before comparing, or proximity simply
      // never matches — confirmed live (a floor-1 pickup at the player's
      // feet never registered until this offset was applied). vision.ts's updateVision already established this
      // exact pattern (origin derived from floor.group.position).
      const localX = player.worldX - active.rig.group.position.x;
      const localZ = player.worldZ - active.rig.group.position.z;
      // Behind a crate, or cloaked, crouched and holding still.
      // Cloaked and still, nothing sees you, until something walks right into you: that breaks the cloak.
      // Up in the ceiling's dark nobody looks for you, unless you're under one of its lamps.
      const underLamp = active.content.pipeRig?.lampCells.has(`${Math.round(localX / CELL)},${Math.round(localZ / CELL)}`) ?? false;
      // Dropping onto an unaware guard, it doesn't get the chance to look up.
      // On a grapple line, above the guards' and dogs' reach and their notice, hovering low or not, lamps or no lamps:
      // the stealth is the point of the line. (Up on a tower's pipes, a lamp still lights you up.)
      const onLine = (aloft?.kind === 'hang' && aloft.hooked === true) || aloft?.kind === 'haul';
      // Lying along a wall top: out of sight and silent to the guards and dogs, lamps or no (a drone, flying over the walls, still has you); going up or over it, you're seen like anyone.
      // (Up at a tall wall's top shelf, or pulling up onto it, crouched on it, or going over: from the floor you are above their line of sight and behind the wall's edge.)
      const onWall = onWallTop() || (aloft?.kind === 'highwall' && (aloft.level === 2 || aloft.phase === 'top' || aloft.phase === 'mount' || aloft.phase === 'over' || aloft.phase === 'dismount'));
      const onLedge = aloft?.kind === 'ledge'; // hanging below the rail: the floor's guards look over you
      const unseen = onLine || onWall || onLedge || (aloft?.kind !== 'wall' && aloft?.kind !== 'highwall' && high && !underLamp) || (aloft?.kind === 'fall' && aloft.target !== null);
      if (camoConceals(camo.active, player.moving) && !high) {
        const bodies = active.content.enemies.filter((e) => !e.disabled && e.radius > 0).map((e) => ({ x: e.worldX, z: e.worldZ, r: e.radius }));
        if (bumpedInto(player.worldX, player.worldZ, PLAYER_R, bodies)) {
          camo = { ...camo, active: false };
          sound.play('camoOff');
          hud.showToast('BUMPED INTO · CAMO BROKEN', 'bad');
        }
      }
      const hidden = isPlayerHidden(active.content.hidingSpots, localX, localZ) || camoConceals(camo.active, player.moving);
      // In hiding (a locker, behind crates, under a sofa), patrols are likelier to stop beside the spot nearest to the agent, with their back to it (patrol.ts).
      const hiderCell = !!hiddenIn || underFurniture() || isPlayerHidden(active.content.hidingSpots, localX, localZ) ? { x: Math.round(localX / CELL), y: Math.round(localZ / CELL) } : null;
      for (const e of active.content.enemies) if (e instanceof Bot) e.setHider(hiderCell);
      // How far the player's noise carries this frame, for enemies that hunt by ear.
      // A dodge is as loud as walking, whatever else you're doing.
      // (Nothing on the floor hears a grapple line: not the hauling, not the shimmy, not the hovering.)
      const noise = onLine || onWall || onLedge ? 0 : noiseRadius(player.moving || player.dashing, sneaking && !player.dashing, stats.seconds - lastShotAt, proneNow && !player.dashing, dashingNow, silent);
      const soundKey = `${activeFloorIdx}:${Math.round(localX / CELL)},${Math.round(localZ / CELL)}:${navVersion}`;
      const ctx: EnemyContext = {
        cells: active.content.navCells,
        cols: active.content.cols,
        rows: active.content.rows,
        wallBoxes: active.rig.wallBoxes,
        // On a container's roof the agent is above the containers: a guard sees them over those (but not through the walls), and cannot get under them.
        sightWalls: roofY !== null ? active.rig.wallBoxes.filter((b) => b.roof === undefined) : undefined,
        occluders: active.rig.wallBoxes,
        playerY: player.worldY,
        floorY: active.rig.group.position.y,
        crowd: active.content.enemies,
        playerX: player.worldX,
        playerZ: player.worldZ,
        sneaking: detectSneak,
        hidden: hidden || frozen || unseen,
        // Up on a platform or the pipes: seen from the floor, perhaps, but out of reach.
        unreachable: high || roofY !== null,
        prone: proneNow,
        running: dashingNow,
        // Hovering lowered on a grapple line, above the reach of anything on the floor (though still in plain sight).
        enclosed: frozen || (high && !onWall) || (aloft?.kind === 'hang' && (aloft.low ?? 0) > 0.5),
        overWalls: onWall,
        smokes: smokes.filter((s) => s.content === active.content),
        speedScale: alarmOn ? ALARM_SPEED : 1,
        guardReactionS: diff.guardReactionS,
        sentrySweep: diff.sentrySweep,
        // A guard's laser lying on the agent for a few seconds makes it creep up to see (laser.ts): on in the high wall course, to try it.
        laserNotice: highwall,
        // In the dark — a shot-out light, or your own torch off — bots see you less far.
        sightScale: Math.min(
          active.content.lights.some((l) => l.disabled && Math.hypot(l.worldX - player.worldX, l.worldZ - player.worldZ) < DARK_RADIUS) ? DARK_SIGHT : 1,
          player.torch ? 1 : TORCH_OFF_SIGHT,
          // In a blackout they see much less far — unless your torch is on.
          inBlackout() && !player.torch ? BLACKOUT_SIGHT : 1
        ),
        noise,
        silentNight: silent,
        soundDistance: (x, z) => {
          if (soundMap?.key !== soundKey) {
            soundMap = { key: soundKey, dist: bfs(active.content.navCells, active.content.cols, active.content.rows, Math.round(localX / CELL), Math.round(localZ / CELL)) };
          }
          const d = soundMap.dist[Math.round((z - active.rig.group.position.z) / CELL)]?.[Math.round((x - active.rig.group.position.x) / CELL)] ?? -1;
          return d < 0 ? Infinity : d * CELL;
        },
        onSpotted: (e) => {
          if (exitMode) return; // (in the exit level the alarm is a fact: being seen costs nothing, being shot does)
          if (e.kind === 'drone' && training) {
            // Training's drone lesson: its searchlight catching you is the lesson failed.
            triggerCaught('Spotted from above', 'The drone’s searchlight caught you in the open.');
            return;
          }
          if (e.kind === 'drone') {
            // A drone's searchlight has you: it hangs over you and calls the bots nearby in.
            for (const b of active.content.enemies) {
              if (b instanceof Bot) b.investigate(player.worldX, player.worldZ, 5, active.content.navCells, active.content.cols, active.content.rows, DRONE_CALLS_CELLS);
            }
          }
          sound.play('alert');
          music.stinger('spotted');
          if (e instanceof Bot) callSquad(e, active);
          stats.timesSpotted++;
          if (bunker) {
            toastOnce('seen-health', 'SPOTTED · THEY KNOW WHERE YOU ARE: GET TO COVER · THE BAR IS YOUR HEALTH, AND IT FILLS BACK WHILE NOTHING HITS YOU', 5200);
            return;
          }
          if (!training) hud.showHint('camo');
          suspicion = applySuspicion(suspicion, SPOT_SUSPICION);
          hud.setSuspicion(suspicion);
          hud.showToast(`SPOTTED · SUSPICION +${SPOT_SUSPICION}%`, 'bad');
          if (isCaught(suspicion)) triggerCaught("You've been spotted", 'A patrol bot raised the alarm.');
        },
        onShot: (e) => {
          // A landed shot — visible tracer from the bot's muzzle to the
          // player, tinted differently from the player's own (cyan) so
          // which direction a shot came from reads at a glance.
          if (!(e instanceof Bot || e instanceof Alpha)) return;
          const muzzle = e.muzzleWorldPosition;
          // A guard fires a plain bolt; an alpha, blue bursts of long tracers or a rattle of short darts (the burst rifle's and the SMG's own shots, tinted).
          const enemyGun: BigGun | null = e instanceof Alpha ? (e.fireMode === 'burst' ? 'AR_4' : 'SMG_1') : null;
          const enemyColor = e instanceof Alpha ? ALPHA_TRACER_COLOR : ENEMY_TRACER_COLOR;
          if (stats.seconds < dodgeUntil) {
            // Mid-dodge: the shot goes wide.
            const f = player.facingAngle;
            activeTracers.push(spawnShot(root.scene, enemyGun, muzzle, new THREE.Vector3(player.worldX + Math.cos(f) * 1.2, player.worldY + 1.2, player.worldZ - Math.sin(f) * 1.2), enemyColor));
            sound.play(shotSound(enemyGun), { x: muzzle.x, y: muzzle.y, z: muzzle.z });
            hud.showToast('DODGED', 'good');
            return;
          }
          activeTracers.push(spawnShot(root.scene, enemyGun, muzzle, new THREE.Vector3(player.worldX, player.worldY + 1.2, player.worldZ), enemyColor));
          sound.play(shotSound(enemyGun), { x: muzzle.x, y: muzzle.y, z: muzzle.z });
          sound.play('hurt');
          stats.timesHit++;
          if (!training) hud.showHint('dodge');
          lastHitAt = stats.seconds;
          bursts.sparks(new THREE.Vector3(player.worldX, player.worldY + 1.2, player.worldZ), 0xff6a4a);
          player.shake(0.45);
          hud.pulseDanger();
          const hitCost = healthMode ? (e instanceof Alpha ? EXIT_HIT_SUSPICION + 6 : EXIT_HIT_SUSPICION) : e.kind === 'heavy' ? HEAVY_HIT_SUSPICION : BOT_HIT_SUSPICION;
          suspicion = applySuspicion(suspicion, hitCost);
          hud.setSuspicion(suspicion);
          hud.showToast(healthMode ? `HIT · HEALTH −${hitCost}` : `HIT · SUSPICION +${hitCost}%`, 'bad');
          if (isCaught(suspicion)) triggerCaught('Hit by enemy fire', e instanceof Alpha ? 'An alpha unit opened fire.' : 'A patrol bot opened fire.', { x: e.worldX, z: e.worldZ });
          else player.flinch();
        },
        onCaught: (_e, title, reason) => {
          player.shake(0.8);
          triggerCaught(title, reason);
        },
        onExplode: (e) => {
          if (e instanceof Alpha) {
            alphaBlast(e, ctx);
            return;
          }
          const at = new THREE.Vector3(e.worldX, e.floorY + 0.3, e.worldZ);
          sound.play('boom', { x: at.x, y: at.y, z: at.z });
          bursts.sparks(at, 0xffb050);
          blasts.boom(at, 0.5);
          player.shake(1);
          hud.pulseDanger();
          stats.timesHit++;
          // The blast is loud enough to bring the building down on you: it always trips the alarm.
          suspicion = Math.max(applySuspicion(suspicion, MINE_SUSPICION), ALARM_ON);
          hud.setSuspicion(suspicion);
          hud.showToast(`MINE · SUSPICION +${MINE_SUSPICION}%`, 'bad');
          if (isCaught(suspicion)) triggerCaught('Caught in the blast', 'A crawler mine went off at your feet.', { x: e.worldX, z: e.worldZ });
          else player.flinch();
        },
      };
      tickPower(active, dt);
      yard?.update(stats.seconds, dt);
      tickPulses(active);
      tickMovingLasers(active, localX, localZ, sneaking, frozen, proneNow || player.low ? 'prone' : sneaking ? 'crouch' : 'stand');
      if (!frozen && !aloft && !trapAiming && dodgeCooldown <= 0) tickDashHints(active, localX, localZ);
      // Watchdog packs: a bark as they gather, and seeing them gathered marks the meeting point on the blueprint.
      // From inside a staff locker you watch through its slats, from its door.
      const eye = hiddenIn
        ? { x: hiddenIn.rig.front.x + hiddenIn.floor.rig.group.position.x, z: hiddenIn.rig.front.z + hiddenIn.floor.rig.group.position.z }
        : { x: player.worldX, z: player.worldZ };
      for (const pack of active.content.packs) {
        const floorY = active.rig.group.position.y;
        if (pack.tick(dt) === 'huddle') {
          sound.play('bark', { x: pack.meetX, y: floorY + 0.7, z: pack.meetZ }, 0.7);
          blasts.bark(pack.meetX, floorY, pack.meetZ);
        }
        if (
          pack.huddling &&
          !pack.spotted &&
          Math.hypot(pack.meetX - eye.x, pack.meetZ - eye.z) < PACK_SPOT_RANGE &&
          hasLineOfSight(eye.x, eye.z, pack.meetX, pack.meetZ, active.rig.wallBoxes, PACK_SPOT_RANGE)
        ) {
          pack.spotted = true;
          hud.showToast('PACK MEETING POINT SPOTTED · MARKED ON THE BLUEPRINT', 'good', 3600);
        }
      }
      // The visibility meter: how exposed the agent is to the guards near them, worked out from those guards' own sight.
      let exposed: number | null = null;
      for (const e of active.content.enemies) {
        if (!(e instanceof Bot)) continue;
        const x = e.exposureTo(player.worldX, player.worldZ, active.rig.wallBoxes, detectSneak, ctx.sightScale, proneNow, dashingNow, ctx.smokes);
        if (x?.near) exposed = Math.max(exposed ?? 0, x.value);
      }
      exposureNow = ctx.hidden ? 0 : (exposed ?? 0);
      hud.setVisibility(exposed, ctx.hidden);
      // A guard or a dog about to catch the agent: a flash grenade is offered, and the first moment of a chase gets a beat of slow motion to reach it (flash.ts).
      if (!training && !caught && !cleared && flashesLeft > 0) {
        const threats: Threat[] = active.content.enemies.map((e) => ({ kind: e.kind, alert: e.alert, disabled: e.disabled, dist: Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) }));
        const panic = panicking(threats, suspicion);
        if (panic) {
          const how = onTouch() ? 'TAP THE FLASH BUTTON' : keyed('PRESS {flash}').toUpperCase();
          toastOnce('flash-offer', `FLASH GRENADE · ${how} TO BLIND EVERYONE WITH A CLEAR LINE TO IT FOR ABOUT 10 SECONDS, THEN GET OUT OF SIGHT`, 6500);
        }
        panicHold = panic ? 1.5 : Math.max(0, panicHold - frameDt);
        hud.showFlashPrompt(panicHold > 0, keyed('{flash}'));
      } else if (panicHold > 0) {
        panicHold = 0;
        hud.showFlashPrompt(false);
      }
      // Bullet time is offered when something is closing in (Space; a button on a phone), and shows as a draining bar while it lasts.
      if (bulletOk && !caught && !cleared) {
        const near = approaching(active.content.enemies.map((e) => ({ kind: e.kind, alert: e.alert, disabled: e.disabled, dist: Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) })));
        bulletQuiet = near ? 0 : bulletQuiet + frameDt;
        // Automatic: a fresh approach (nothing was closing in for a few seconds) with a good part of the meter left starts it.
        if (bulletAuto && near && !bullet.on && bullet.energy >= BULLET_AUTO_MIN && bulletFresh) {
          bulletFresh = false;
          toggleBulletNow();
          toastOnce('bullet-auto', `BULLET TIME · IT STARTS BY ITSELF WHEN SOMETHING CLOSES IN · ${onTouch() ? 'TAP THE BUTTON' : keyed('PRESS {interact}').toUpperCase()} TO END IT · TURN IT OFF IN THE CONTROLS SHEET (H)`, 6500);
        }
        if (bulletQuiet >= BULLET_REARM_S) bulletFresh = true;
        bulletOfferHold = near && !bullet.on && bullet.energy >= BULLET_MIN_START ? 1.2 : Math.max(0, bulletOfferHold - frameDt);
        if (bulletOfferHold > 0 && !bullet.on) toastOnce('bullet-offer', `BULLET TIME · ${onTouch() ? 'TAP THE BUTTON' : keyed('PRESS {interact}').toUpperCase()} TO SLOW THE WORLD FOR A FEW SECONDS WHILE YOU STAY QUICK · IT REFILLS`, 5800);
        hud.showBullet(bullet.on ? 'on' : bulletOfferHold > 0 ? 'offer' : null, keyed('{interact}'), bullet.on ? bullet.energy : 1);
      } else hud.showBullet(null, '', 1);
      // How it looks and sounds: the colour drains and the edges fringe (postfx.ts), the corners close in, the camera pushes in a little, and the world goes muffled.
      setBulletTime(root.postfx, bullet.k);
      sound.setSlowmo(bullet.k);
      hud.setSlowmo(bullet.k > 0.3);
      if (bullet.k > 0 || bulletFovK > 0) {
        bulletFovK = bullet.k;
        root.camera.fov = BASE_FOV - 5 * bullet.k;
        root.camera.updateProjectionMatrix();
      }
      // And the other two: smoke for a guard that has the agent, a shock for a dog that does (a pill naming the key, or a round button on a phone).
      if (!training && !caught && !cleared && (smokesLeft > 0 || shocksLeft > 0)) {
        const offer = grenadeOffer(
          active.content.enemies.map((e) => ({ kind: e.kind, alert: e.alert, disabled: e.disabled, dazed: (e instanceof Bot && e.incapacitated) || (e instanceof Watchdog && e.dazed), dist: Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) })),
          smokesLeft,
          shocksLeft,
          insideSmoke(player.worldX, player.worldZ, smokes.filter((s) => s.content === active.content))
        );
        smokeOfferHold = offer.smoke ? 1.2 : Math.max(0, smokeOfferHold - frameDt);
        shockOfferHold = offer.shock ? 1.2 : Math.max(0, shockOfferHold - frameDt);
        if (offer.smoke) toastOnce('smoke-offer', `SMOKE GRENADE · ${onTouch() ? 'TAP THE SMOKE BUTTON' : keyed('PRESS {smoke}').toUpperCase()} TO HIDE FROM GUARDS BEHIND A CLOUD FOR ABOUT 10 SECONDS`, 5200);
        if (offer.shock) toastOnce('shock-offer', `SHOCK GRENADE · ${onTouch() ? 'TAP THE SHOCK BUTTON' : keyed('PRESS {shock}').toUpperCase()} TO BLIND AND DEAFEN THE DOGS NEAR IT FOR ABOUT ${SHOCK_DAZE_S} SECONDS`, 5200);
        hud.showGrenadePrompts(smokeOfferHold > 0, shockOfferHold > 0, keyed('{smoke}'), keyed('{shock}'));
      } else if (smokeOfferHold > 0 || shockOfferHold > 0) {
        smokeOfferHold = 0;
        shockOfferHold = 0;
        hud.showGrenadePrompts(false, false, '', '');
      }
      let dogListening = false;
      let roofWallsNow: WallBox[] | undefined;
      for (const e of active.content.enemies) {
        const dog = e.kind === 'watchdog' || e.kind === 'alpha'; // (an alpha hunts by ear too: its footsteps and bark are a dog's)
        const mine = e.kind === 'crawler';
        if (dog && !e.disabled) dogListening = true;
        // Footsteps (quicker when on your trail), and a warning the moment one locks on:
        // a chirp from a bot, two barks from a watchdog.
        if (e.moving && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) < 24) {
          const left = (stepTimers.get(e) ?? Math.random() * 0.4) - dt;
          if (left <= 0) sound.play(mine ? 'skitter' : dog ? 'dogStep' : 'botStep', { x: e.worldX, y: e.floorY + 0.2, z: e.worldZ }, 0.8);
          stepTimers.set(e, left <= 0 ? (mine ? 0.07 : dog ? (e.alert ? 0.14 : 0.22) : e.alert ? 0.32 : 0.45) : left);
        }
        if (e.alert && !chasing.has(e)) {
          chasing.add(e);
          sound.play(mine ? 'crawlerWake' : dog ? 'bark' : 'alert', { x: e.worldX, y: e.floorY + (dog ? 0.7 : mine ? 0.3 : 1.6), z: e.worldZ }, dog || mine ? 1 : 0.7);
          if (dog) blasts.bark(e.worldX, e.floorY, e.worldZ);
          if (mine) toastOnce('crawler-awake', 'CRAWLER MINE AWAKE · STUN IT, EMP IT, OR RUN: IT GIVES UP AFTER A FEW SECONDS', 4800);
        } else if (!e.alert) {
          chasing.delete(e);
        }
        // (The high wall course's guards walk their beats and watch, but never spot or shoot: they are there to be dropped on.)
        const base = highwall ? { ...ctx, harmless: true } : practice ? { ...ctx, practiceTarget: true } : ctx;
        // A guard on the container roofs walks the roofs' own grid and is stopped only by the walls; it sees the agent over the containers, and the agent on the floor is below it.
        if (e instanceof Bot && e.onRoofLayer) {
          roofWallsNow ??= active.rig.wallBoxes.filter((b) => b.roof === undefined && b.cover === undefined && b.under === undefined);
          e.update({ ...base, cells: roofNavs.get(active.content) ?? base.cells, wallBoxes: roofWallsNow, sightWalls: roofWallsNow, unreachable: roofY === null }, dt);
        } else e.update(base, dt);
        if (e instanceof Drone) {
          // Its rotor buzz follows it; a downed drone falls silent.
          let hum = rotorHums.get(e);
          if (!hum && !e.disabled) {
            hum = sound.loop('rotor', e.airPosition, ROTOR_VOLUME);
            rotorHums.set(e, hum);
          }
          if (hum && e.disabled) {
            hum.stop();
            rotorHums.delete(e);
          } else if (hum) {
            const a = e.airPosition;
            hum.move(a.x, a.y, a.z);
          }
        }
        if (caught) break;
      }
      // The tower's storeys below the agent keep to their rounds, and a guard with a clear look up through the atrium (from the hall to the balcony's rail) sees the agent as one on their own floor does:
      // from there it cannot reach them, so it holds off and calls the alarm; it never fires. The storeys above the agent are asleep (no one up there sees, shows or shoots) until the agent is on them. A dog on another storey hears nothing (the floor is in the way).
      // Half way up the first stair, though, the whole tower wakes: every storey's guards and dogs start their rounds (those above still cannot see, show or shoot until the agent is on them).
      if (tower && !towerAwake && player.worldY >= floorHeight * 0.5) towerAwake = true;
      if (tower && !caught && !cleared) {
        for (const [fi, f] of storeys.entries()) {
          if (f.content === active.content) continue;
          if (fi > activeFloorIdx && !towerAwake) continue; // (until the agent is half way up the first stair, the storeys above are asleep)
          for (const e of f.content.enemies) {
            const sees = !(e instanceof Watchdog) && !e.disabled && towerSees(e);
            e.update(
              { ...ctx, cells: f.content.navCells, cols: f.content.cols, rows: f.content.rows, wallBoxes: f.rig.wallBoxes, smokes: [], hidden: ctx.hidden || !sees || fi > activeFloorIdx, unreachable: true, noise: 0, soundDistance: () => Infinity, onShot: () => undefined },
              dt
            );
            if (caught) break;
          }
        }
      }
      tickSquad(active);
      tickGuardFlashes(active, dt);
      noiseRing.update(player.worldX, player.worldY, player.worldZ, noise, dogListening || silent, dt);
      // The watchdog warning (dogwarn.ts): a dog hunts by ear and can be anywhere round a wall, so one on your trail (or just close) pings (panned toward it, quickening as it comes),
      // gets a marker (on it if in view, an arrow on the screen's edge if not) and, close in, pulses the edges red.
      if (!caught && !cleared && !practice) {
        const seen = active.content.enemies
          .filter((e): e is Watchdog | Alpha => (e instanceof Watchdog || e instanceof Alpha) && !e.disabled)
          .map((e) => ({ x: e.worldX, z: e.worldZ, y: e.floorY, dist: Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ), tracking: e.alert }));
        const { picks, top } = strongest(seen);
        const proj = new THREE.Vector3();
        hud.setDogWarnings(
          picks.map(({ dog, level }) => {
            const at = seen.find((d) => d.x === dog.x && d.z === dog.z)!;
            proj.set(at.x, at.y + 0.6, at.z).project(root.camera);
            return markerFor(proj.x, proj.y, proj.z > 1, level, dog.tracking, dog.dist);
          }),
          top && top.dog.tracking ? Math.max(0, (top.level - 0.4) / 0.6) : 0
        );
        if (top) {
          dogPingLeft -= dt;
          if (dogPingLeft <= 0) {
            dogPingLeft = pingGap(top.level);
            // Played from just beside the agent toward the dog, so the stereo says which way.
            const d = Math.max(0.5, top.dog.dist);
            const ax = player.worldX + ((top.dog.x - player.worldX) / d) * 3;
            const az = player.worldZ + ((top.dog.z - player.worldZ) / d) * 3;
            sound.play(top.dog.tracking ? 'dogAlarm' : 'dogPing', { x: ax, y: player.worldY + 1, z: az }, 0.4 + 0.6 * top.level);
          }
        } else dogPingLeft = Math.min(dogPingLeft, 0.2);
      } else hud.setDogWarnings([], 0);
      // A downed partner: marked wherever they are (an arrow on the edge of the screen when out of view), with how far and how long is left, and pinged now and then from their side.
      if (partner && partnerState === 'down' && !caught && !cleared) {
        partnerProj.set(partner.worldX, partner.worldY + 0.8, partner.worldZ).project(root.camera);
        const pd = Math.hypot(partner.worldX - player.worldX, partner.worldZ - player.worldZ);
        const left = Math.max(0, Math.ceil(DOWN_FAIL_S - partnerDownFor));
        const other = partner.currentFloorIdx !== activeFloorIdx;
        hud.setPartnerMarker(markerFor(partnerProj.x, partnerProj.y, partnerProj.z > 1, 1, true, pd), `${partnerName.toUpperCase()} DOWN · ${other ? 'OTHER FLOOR' : `${Math.round(pd)} M`} · ${left}S`);
        partnerPingLeft -= dt;
        if (partnerPingLeft <= 0) {
          partnerPingLeft = 1.8;
          const d = Math.max(0.5, pd);
          sound.play('dogPing', { x: player.worldX + ((partner.worldX - player.worldX) / d) * 3, y: player.worldY + 1, z: player.worldZ + ((partner.worldZ - player.worldZ) / d) * 3 }, 0.5);
        }
      } else hud.setPartnerMarker(null, '');
      tickTags(active, aloft?.kind === 'perch');

      // A torch beam on the floor gives you away: a guard that sees it (in its view, no wall between) comes to look.
      if ((beamCheck -= dt) <= 0) {
        beamCheck = BEAM_CHECK_S;
        const fx = Math.sin(player.facingAngle);
        const fz = Math.cos(player.facingAngle);
        const reach = Math.max(0.5, Math.min(BEAM_REACH, rayToBoxes(player.worldX, player.worldZ, fx, fz, BEAM_REACH, active.rig.wallBoxes) - 0.3));
        const pool = { x: player.worldX + fx * reach, z: player.worldZ + fz * reach };
        for (const e of active.content.enemies) {
          // (The stealth course's sentry holds its post: its lessons are about what it can see from there, not about the beam.)
          if (!player.torch || frozen || caught || stealth || weapons || practice) break;
          if (!(e instanceof Bot) || e.disabled || e.alert || (beamNoticed.get(e) ?? 0) > stats.seconds) continue;
          if (Math.hypot(pool.x - e.worldX, pool.z - e.worldZ) > BEAM_NOTICE_RANGE) continue;
          if (Math.hypot(player.worldX - e.worldX, player.worldZ - e.worldZ) < BEAM_IGNORED_WITHIN) continue;
          if (!inViewCone(e.worldX, e.worldZ, e.facing, pool.x, pool.z) || !hasLineOfSight(e.worldX, e.worldZ, pool.x, pool.z, active.rig.wallBoxes, BEAM_NOTICE_RANGE)) continue;
          if (!e.investigate(pool.x, pool.z, 4, active.content.navCells, active.content.cols, active.content.rows, BEAM_NOTICE_CELLS)) continue;
          beamNoticed.set(e, stats.seconds + BEAM_NOTICE_COOLDOWN_S);
          if (stats.seconds - beamToastAt > 4) {
            beamToastAt = stats.seconds;
            hud.showToast(`${e.isSentry ? 'A SENTRY' : 'A GUARD'} SAW YOUR TORCH · T SWITCHES IT OFF`, 'bad');
          }
        }
      }

      // The gun's pick for whatever is in the sights right now — shown on the Fire button and the gauge.
      // A takedown on offer: the nearest unaware enemy within reach from behind.
      takedownTarget = null;
      aerialTarget = null;
      if (aloft) {
        // Hanging over an unaware guard: letting go takes it down.
        if ((aloft.kind === 'hang' && aloft.lift >= 1 && !aloft.back) || onWallTop() || (aloft.kind === 'ledge' && aloft.phase === 'hang') || (aloft.kind === 'highwall' && aloft.phase === 'hang')) {
          let best = aloft.kind === 'highwall' ? JUMP_REACH : onWallTop() ? WALL_REACH : AERIAL_REACH;
          // (Hanging off a rail, the guard to drop on is on the storey below.)
          for (const e of aloft.kind === 'ledge' ? ledgeBelow(aloft)?.floor.content.enemies ?? [] : active.content.enemies) {
            if (e.disabled || !e.takedownable || e.alert || e.kind === 'drone') continue;
            const d = Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ);
            if (d < best) {
              aerialTarget = e;
              best = d;
            }
          }
          if (aerialTarget && aloft.kind === 'highwall') toastOnce('aerialHigh', 'A GUARD BELOW · FIRE DROPS ON HIM WHEN HE IS RIGHT UNDER YOU · INTERACT LEAPS OFF THE WALL ONTO HIM', 3600);
          else if (aerialTarget) toastOnce(onWallTop() ? 'aerialWall' : 'aerial', onWallTop() ? 'A GUARD BELOW · INTERACT TO JUMP OFF AND DROP ON IT FOR A TAKEDOWN' : 'A GUARD BELOW · FIRE TO DROP ON IT', 3000);
        }
        takedownMarker.update(aerialTarget, clock.elapsedTime);
        aimMarker.update(null, 'stun', clock.elapsedTime);
        const label = perchLike() ? (aiming ? 'FIRE' : 'AIM') : aloft.kind === 'highwall' ? (aloft.phase === 'hang' ? (wallGuard(DROP_REACH) ? 'TAKEDOWN' : 'DROP') : 'FIRE') : aloft.kind !== 'hang' && aloft.kind !== 'ledge' ? 'FIRE' : aerialTarget ? 'TAKEDOWN' : 'DROP';
        touch.setFireLabel(label, label === 'TAKEDOWN' || (aerialTarget && label !== 'FIRE') ? 'takedown' : 'stun');
        hud.setWeapon(label, label === 'TAKEDOWN' || (aerialTarget && label !== 'FIRE') ? 'takedown' : 'stun', empCharges);
      } else {
        let takedownDist = Infinity;
        for (const e of active.content.enemies) {
          if (e.disabled || !e.takedownable || Math.abs(e.floorY - player.worldY) > 1.2) continue; // (a guard on a container's roof is not reachable from the floor, nor the other way)
          if (!canTakedown(e.worldX, e.worldZ, e.facing, e.alert, player.worldX, player.worldZ, player.facingAngle, active.rig.wallBoxes)) continue;
          const d = Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ);
          if (d < takedownDist) {
            takedownTarget = e;
            takedownDist = d;
          }
        }
        takedownMarker.update(carried ? null : takedownTarget, clock.elapsedTime);
        // What stands between the gun and a target is what the shot itself would be stopped by: from a container's roof, not the containers; from under a sofa or a desk, not that piece.
        const lyingUnderNow = underBox();
        const sightWalls = roofY !== null ? active.rig.wallBoxes.filter((b) => b.roof === undefined) : lyingUnderNow?.cover ? active.rig.wallBoxes.filter((b) => b !== lyingUnderNow) : active.rig.wallBoxes;
        const aim = aiming
          ? aimedTarget(active)
          : tryFire(player.worldX, player.worldZ, player.facingAngle, active.content.enemies, sightWalls) ?? tryFireUp(active.content.enemies, active.rig.wallBoxes);
        // The gun swings round and up or down to what the auto-aim has in the sights (aiming from cover has the crosshair for that).
        player.aimGunAt(!aiming && aim && !carried ? { x: aim.worldX, y: aim.floorY + 1.15, z: aim.worldZ } : null, frameDt);
        const choice = pickTool(aim, empCharges, false, takedownTarget !== null && !carried && !aiming);
        // The reticle sits on whoever the gun is on, and says whether a shot stuns or is an EMP (not when a takedown is the move, or the hands are full).
        // (With nobody in the sights, a camera's switch the gun would shoot out gets the reticle instead: the same test as the shot itself, below.)
        const switchAim = !aim && !carried && choice === 'stun' && (tower || bunker) && !takedownTarget ? tryFire(player.worldX, player.worldZ, player.facingAngle, panelTargets(), sightWalls, PANEL_HALF_ANGLE) : null;
        // ...or a light the gun would shoot out (the same test as the shot's: a stun, nothing else to hit).
        const lightNow = !aim && !switchAim && !carried && choice === 'stun' && !takedownTarget ? tryFire(player.worldX, player.worldZ, player.facingAngle, active.content.lights, sightWalls, aiming ? AIM_HALF_ANGLE : undefined) : null;
        if (lightNow) {
          const at = lightNow.mesh.getWorldPosition(new THREE.Vector3());
          aimMarker.update({ worldX: at.x, worldZ: at.z, floorY: at.y }, 'light', clock.elapsedTime, root.camera.position, 0);
        } else if (switchAim) aimMarker.update({ worldX: switchAim.cam.rig.shot.x, worldZ: switchAim.cam.rig.shot.z, floorY: active.rig.group.position.y }, 'switch', clock.elapsedTime, root.camera.position, 1.3);
        else aimMarker.update(carried || choice === 'takedown' ? null : aim, choice === 'emp' || choice === 'none' ? 'emp' : 'stun', clock.elapsedTime, root.camera.position);
        // With no enemy in the sights, the gun can still take out a light or knock over clutter.
        let label = fireLabel(choice, empCharges);
        if (choice === 'stun' && !aim) {
          if ((tower || bunker) && !takedownTarget && tryFire(player.worldX, player.worldZ, player.facingAngle, panelTargets(), sightWalls, PANEL_HALF_ANGLE)) {
            label = 'SWITCH';
            toastOnce('switch-sights', 'A CAMERA’S SWITCH IS IN YOUR SIGHTS · FIRE SHOOTS IT OUT, FOR GOOD', 4200);
          }
          else if (tryFire(player.worldX, player.worldZ, player.facingAngle, active.content.lights, sightWalls)) label = 'LIGHT';
          else if (tryFire(player.worldX, player.worldZ, player.facingAngle, active.content.props, sightWalls)) label = 'LURE';
        }
        // In cover, the first press is the lean out to aim.
        if (inCover && !aiming && !takedownTarget) label = 'AIM';
        touch.setFireLabel(label, choice);
        hud.setWeapon(label, choice, empCharges);
      }

      // The heartbeat quickens as the nearest active bot on this floor closes in.
      let nearestBot = Infinity;
      let hunted = false;
      for (const e of active.content.enemies) {
        if (e.disabled) continue;
        nearestBot = Math.min(nearestBot, Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ));
        if (e.alert) hunted = true;
        if (e.kind === 'watchdog' && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) < DOG_HINT_DIST) toastOnce('dog', dogHint(), 7000);
        if (e.kind === 'alpha' && Math.hypot(e.worldX - player.worldX, e.worldZ - player.worldZ) < ALPHA_HINT_DIST) toastOnce('alpha', `ALPHA UNIT: IT HEARS YOU AND SMELLS YOU CLOSE UP, HOWLS, SHOOTS AS SOON AS IT HAS YOU IN SIGHT (DODGE OR GET OUT OF SIGHT), RUNS AT YOU AND GOES OFF · THE RED RING IS ITS BLAST: SHOOT IT FROM OUTSIDE IT (IT TAKES DOWN EVERYONE AND SHORTS EVERY CAMERA IN THE RING, AND RAISES NO SUSPICION), OR EMP IT TO STOP IT FOR GOOD`, 8200);
      }
      const threat = threatLevel(nearestBot, hunted);
      const pace = heartPace(threat);
      heartBpm = easeBpm(heartBpm, pace.bpm, dt);
      const chased = hunted || stats.seconds - lastHitAt < CHASE_MUSIC_HOLD_S;
      // The alarm follows suspicion (alarm.ts): up at 70%, down again below 45%.
      const alarmNow = healthMode ? false : alarmState(alarmOn, suspicion);
      if (alarmNow !== alarmOn && !caught) {
        alarmOn = alarmNow;
        if (alarmOn) raiseAlarm();
        else clearAlarm();
      }
      // The bunker's health bar fills back once nothing has hurt for a few seconds (the exit level's is tickExit's).
      if (bunker && !caught && !cleared) {
        if (suspicion > bunkerHealthSeen) bunkerHurtAt = stats.seconds;
        if (suspicion > 0 && stats.seconds - bunkerHurtAt > BUNKER_REGEN_AFTER_S) {
          const before = suspicion;
          suspicion = Math.max(0, suspicion - BUNKER_REGEN_PER_S * dt);
          if (Math.floor(before) !== Math.floor(suspicion)) hud.setSuspicion(suspicion);
        }
        bunkerHealthSeen = suspicion;
      }
      alarmLights.update(clock.elapsedTime, alarmOn, dt);
      alert = stepAlert(alert, { alarm: alarmOn, suspicion, hunted }, dt);
      if (hunted) lastSeen = { x: player.worldX, z: player.worldZ, floor: activeFloorIdx };
      if (!training && !caught && !cleared) {
        // Evasion: nothing has the agent, so the guards go and search where they were last seen, and sweep round it, until the search runs out and they stand down.
        if (alert.phase === 'evasion') {
          sweepLeft -= dt;
          if (sweepLeft <= 0) {
            searchSweep(alert.evasionFor <= dt * 2);
            sweepLeft = SWEEP_EVERY_S;
          }
          if (standsDown(alert)) standDown();
        } else sweepLeft = 0;
        // Caution times out: with nothing after the agent and the alarm down, suspicion eases off.
        const eased = decayedSuspicion(suspicion, alert.phase, hunted, dt);
        if (eased !== suspicion) {
          suspicion = eased;
          hud.setSuspicion(suspicion);
        }
      }
      hud.setAlertPhase(training || caught || cleared ? null : alert.phase, alert.phase === 'evasion' ? `${PHASE_LABEL.evasion} ${Math.max(0, Math.ceil(EVASION_S - alert.evasionFor))}` : PHASE_LABEL[alert.phase]);
      music.update(heartBpm, pace.volume, musicMix(threat, chased, alarmOn));

      // Interact target: with a body in tow, drop it where it is. Otherwise the nearest downed bot, closed locker, un-hacked
      // terminal, or offline server console in range.
      let target: Target | null = null;
      let targetDist = Infinity;
      if (carried) {
        target = { kind: 'drop' };
        targetDist = -Infinity; // nothing else competes while your hands are full
      }
      // A carried body can be put away if there's a locker, crate, vent or furniture to put it in: that beats setting it down.
      if (carried) {
        const spot = stashSpotNear(active, localX, localZ);
        if (spot) {
          target = { kind: 'stash', spot, floor: active };
          toastOnce('stash', `STASH IT · ${hideSkin().locker.name.toUpperCase()}, ${hideSkin().crates.name.toUpperCase()} OR ${hideSkin().vent.name.toUpperCase()} TAKES A BODY. INTERACT AND THE AGENT OPENS IT, PUTS THE BODY IN AND CLOSES IT`, 5200);
        }
      }
      for (const bot of handsFull() ? [] : active.content.enemies) {
        if (!(bot instanceof Bot) || !bot.downed || Math.abs(bot.floorY - player.worldY) > 1.2) continue;
        const c = bot.bodyCenter;
        const d = Math.hypot(c.x - player.worldX, c.z - player.worldZ);
        if (d <= BODY_RADIUS && d < targetDist) {
          target = { kind: 'body', bot };
          targetDist = d;
        }
      }
      for (const l of active.content.lockers) {
        if (l.rig.isOpen()) continue;
        const d = Math.hypot(l.x - localX, l.z - localZ);
        if (d <= LOCKER_RADIUS && d < targetDist) {
          target = { kind: 'locker', locker: l, floor: active };
          targetDist = d;
        }
      }
      for (const t of active.content.terminals) {
        if (t.hacked || activeHack?.terminal === t) continue;
        const d = Math.hypot(t.x - localX, t.z - localZ);
        if (d <= HACK_RADIUS && d < targetDist) {
          target = { kind: 'terminal', terminal: t, floor: active };
          targetDist = d;
        }
      }
      for (const sv of active.content.servers) {
        if (sv.online) continue;
        const d = Math.hypot(sv.x - localX, sv.z - localZ);
        if (d <= CONSOLE_RADIUS && d < targetDist) {
          target = { kind: 'server', server: sv, floor: active };
          targetDist = d;
        }
      }
      // The heist loop's stations: the uplink (down, or back up once this floor's files are in and its logs
      // wiped, to leave no trace), each workstation's files, and the log console while logs are queued.
      const { uplink, logServer, workstations } = active.content;
      const tasks: Task[] = [];
      const allCaptured = allWorkstations.every((w) => w.captured || w.step?.step.decoy);
      if (uplink && !uplink.restored && (uplink.online || (allCaptured && !burned && !jobLogServer?.pending))) tasks.push({ kind: 'uplink', station: uplink, floor: active });
      for (const w of workstations) if (!w.captured && !yardRun) tasks.push({ kind: 'capture', station: w, floor: active });
      if (roofLine && !roofLine.cut && jobUplink?.online && active.content === floor1Content) tasks.push({ kind: 'cutLine', station: roofLine, floor: active });
      if (logServer && logServer.pending > 0) tasks.push({ kind: 'wipe', station: logServer, floor: active });
      for (const c of clueSystems) if (!c.done && storeys[c.floor]?.content === active.content) tasks.push({ kind: 'clue', station: c, floor: active });
      for (const c of crateStations) if (!c.done && storeys[c.level]?.content === active.content) tasks.push({ kind: 'crate', station: c, floor: active });
      for (const b of shelfBanks) if (!b.anim && storeys[b.level]?.content === active.content) tasks.push({ kind: 'slide', station: b.station, floor: active });
      for (const task of tasks) {
        if (activeTask?.station === task.station) continue;
        const d = Math.hypot(task.station.x - localX, task.station.z - localZ);
        if (d <= HACK_RADIUS && d < targetDist) {
          target = task;
          targetDist = d;
        }
      }
      // Walking up to a workstation while the uplink's still up: say so, once.
      if (target?.kind === 'capture' && jobUplink?.online && !burned && !uplinkWarned.has(target.station)) {
        uplinkWarned.add(target.station);
        hud.showToast(`${target.station.step ? 'LOCKED' : 'WORKSTATION LOCKED'} · TAKE THE ${contract === 'records' ? 'UPLINK' : 'ALARM LINK'} DOWN FIRST (THE NETWORK CLOSET, UPL ON THE BLUEPRINT)`, 'bad', 4600);
      }
      // Walking up to the log console with files still to take: say so, once.
      if (target?.kind === 'wipe' && wipeLocked() && !wipeWarned) {
        wipeWarned = true;
        hud.showToast('LOG CONSOLE LOCKED · PHOTOGRAPH EVERY FILE FIRST, THEN WIPE THE LOGS', 'bad', 4200);
      }
      // Light switches and breaker panels, from the spot in front of them.
      for (const f of active.content.fittings) {
        const d = Math.hypot(f.rig.front.x - localX, f.rig.front.z - localZ);
        if (d <= SWITCH_REACH && d < targetDist) {
          target = f.kind === 'switch' ? { kind: 'switch', fitting: f, floor: active } : { kind: 'breaker', fitting: f, floor: active };
          targetDist = d;
        }
      }
      // A shut shutter's panels, from the spot in front of them.
      for (const s of handsFull() ? [] : active.content.shutters) {
        if (s.openedAt !== null || shutterHack?.shutter === s) continue;
        s.rig.panels.forEach((p, i) => {
          const d = Math.hypot(p.front.x - localX, p.front.z - localZ);
          if (d <= SWITCH_REACH && d < targetDist) {
            target = { kind: 'shutter', shutter: s, panel: i, floor: active };
            targetDist = d;
          }
        });
      }
      // Shut in a locked section (the grapple goes over doors): its door opens from the inside, with Interact.
      const standing = cellOf(localX, localZ);
      for (const rig of active.content.doors) {
        if (rig.isOpen()) continue;
        const beyond = DIR_DELTA[rig.door.dir];
        const inside = standing.x === rig.door.x + beyond[0] && standing.y === rig.door.y + beyond[1];
        const d = Math.hypot(rig.center.x - localX, rig.center.z - localZ);
        if (inside && d <= 2.6 && d < targetDist) {
          target = { kind: 'release', door: rig, floor: active };
          targetDist = d;
          toastOnce('release', 'SHUT IN? A LOCKED DOOR OPENS FROM THE INSIDE: INTERACT AT IT', 5200);
        }
      }
      // Staff lockers and vents, by their door / grille.
      for (const l of active.content.staffLockers) {
        const d = Math.hypot(l.rig.front.x - localX, l.rig.front.z - localZ);
        if (d <= PROP_REACH && d < targetDist) {
          target = { kind: 'hideLocker', locker: l.rig, floor: active };
          targetDist = d;
        }
      }
      for (const v of active.content.vents) {
        for (const i of [0, 1] as const) {
          const d = Math.hypot(v.ends[i].stand.x - localX, v.ends[i].stand.z - localZ);
          if (d <= PROP_REACH && d < targetDist) {
            target = { kind: 'vent', to: v.ends[1 - i]!, floor: active };
            targetDist = d;
          }
        }
      }
      // The zipline's handle, under the west tower.
      if (yard && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit) {
        const d = Math.hypot(yard.zip.handle.x - localX, yard.zip.handle.z - localZ);
        if (d <= DOCK_ZIPLINE.reach && d < targetDist) {
          target = { kind: 'zip', floor: active };
          targetDist = d;
        }
      }
      // The tower's lift: in the cab, or at its doors, Interact rides it.
      if (tower && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && towerLiftHere()) {
        target = { kind: 'towerLift' };
        targetDist = 0;
      }
      // The lift down to the heist, at the end of the passage beyond the heist door: in the cab or at its doors, Interact rides it.
      if (tower && towerHeist && allCards() && !handedOn && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && activeFloorIdx === OFFICES) {
        const lf = towerHeist.lift;
        if (lf.contains(player.worldX, player.worldZ) || Math.hypot(player.worldX - lf.front.x, player.worldZ - lf.front.z) < 1.3) {
          target = { kind: 'towerDoor' };
          targetDist = 0;
          toastOnce('heist-door', keyed('THE LIFT DOWN TO THE HEIST · {interact} TO RIDE').toUpperCase(), 4200);
        }
      }
      // A rail with a drop beyond it: Interact vaults it and hangs from the ledge.
      if (tower && !target && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && postureState.posture !== 'prone' && Math.abs(player.worldY - activeFloorIdx * floorHeight) < 0.1) {
        const near = ledgeNear(activeFloorIdx, player.worldX, player.worldZ);
        if (near) {
          target = { kind: 'ledgeHang', near };
          targetDist = near.dist;
          toastOnce('ledge-offer', keyed('A RAIL OVER A DROP · {interact} TO VAULT IT AND HANG FROM THE LEDGE: GUARDS ON THIS FLOOR LOOK OVER YOU, THE FLOORS BELOW CAN SEE YOU, AND YOUR GRIP TIRES').toUpperCase(), 7000);
        }
      }
      // The core stair's console, in the gallery's west room.
      if (tower && TOWER_STAIRS.some((t) => t.timed) && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && activeFloorIdx === 2 && !coreOpen) {
        const c2 = furnitureFor(2, towerSetId).find((p) => p.kind === 'console');
        if (c2 && Math.hypot(player.worldX - c2.cx, player.worldZ - c2.cz) < 2.2) {
          target = { kind: 'stairConsole' };
          targetDist = 0;
          toastOnce('stair-console', keyed(`A CONSOLE · {interact} LOWERS THE STAIR AT THE END OF THE AISLE FOR ${STAIR_OPEN_S} SECONDS: BE ON IT BEFORE IT FOLDS AWAY`).toUpperCase(), 6000);
        }
      }
      // A camera's own panel, on the wall under it: Interact blinds that one camera.
      if ((tower || bunker) && !target && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit) {
        // (On the camera's own side of the wall: the panel is on its face, and cannot be worked from the other side.)
        const i = towerCams.findIndex(
          (c) =>
            !c.perm &&
            !c.rig.plan.high &&
            c.rig.plan.level === activeFloorIdx &&
            Math.hypot(player.worldX - c.rig.panel.x, player.worldZ - c.rig.panel.z) < 1.8 &&
            (player.worldX - c.rig.panel.x) * (c.rig.plan.x - c.rig.panel.x) + (player.worldZ - c.rig.panel.z) * (c.rig.plan.z - c.rig.panel.z) > 0
        );
        if (i >= 0) {
          target = { kind: 'cameraPanel', cam: i };
          targetDist = 0;
          toastOnce('camera-panel', keyed(bunker ? 'A CAMERA\'S PANEL · {interact} SWITCHES THIS CAMERA OFF FOR GOOD' : 'A CAMERA\'S PANEL · {interact} SWITCHES THIS CAMERA OFF FOR GOOD · ONE OF THE TOWER\'S THREATS').toUpperCase(), 6000);
        }
      }
      // The security room's console: Interact loops the cameras' feed.
      if (tower && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && activeFloorIdx === 1) {
        const console_ = furnitureFor(1, towerSetId).find((p) => p.kind === 'console');
        // Only from the front of it, where the operator sits: behind the console (the wall side) or through its end, Interact finds nothing.
        const fx = console_ ? Math.sin(console_.yaw) : 0;
        const fz = console_ ? Math.cos(console_.yaw) : 0;
        const ahead = console_ ? (player.worldX - console_.cx) * fx + (player.worldZ - console_.cz) * fz : 0;
        const across = console_ ? Math.abs((player.worldX - console_.cx) * fz - (player.worldZ - console_.cz) * fx) : 0;
        if (console_ && ahead > 0.4 && ahead < 2.4 && across < (console_.box.maxX - console_.box.minX + console_.box.maxZ - console_.box.minZ) / 2 + 0.6) {
          // With every camera switched off for good there is nothing left to loop: the console shows green and does nothing.
          if (camerasAllDown()) {
            toastOnce('console-done', 'EVERY CAMERA IS OFF · NOTHING LEFT TO LOOP', 3600);
            target = { kind: 'towerConsoleDone' };
            targetDist = 0;
          } else {
            target = { kind: 'towerConsole' };
            targetDist = 0;
          }
        }
      }
      // This storey's keycard on its little desk.
      const cardDesk = tower ? towerCards.get(activeFloorIdx) : undefined;
      if (cardDesk && !exitMode && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit) {
        if (Math.hypot(player.worldX - cardDesk.position.x, player.worldZ - cardDesk.position.z) < 1.9) {
          target = { kind: 'towerKey' };
          targetDist = 0;
        }
        if (Math.hypot(player.worldX - cardDesk.position.x, player.worldZ - cardDesk.position.z) < 7 && cardWatchers(activeFloorIdx, cardDesk.position.x, cardDesk.position.z) > 0) toastOnce('card-watched', 'THE KEYCARD IS UNDER A CAMERA THAT DOES NOT SWEEP: ITS CONE IS A HALF CIRCLE AND IT HAS THE DESK IN VIEW · CLIMB ITS PYLON, HANG BESIDE THE PANEL AND SWITCH IT OFF BEFORE YOU TAKE THE CARD', 7200);
      }
      // A downed partner beside you: bring them round.
      if (partner && partnerState === 'down' && !aloft && !handsFull() && !inCover && !hiddenIn && !ventTransit && partner.currentFloorIdx === activeFloorIdx) {
        if (Math.hypot(partner.worldX - player.worldX, partner.worldZ - player.worldZ) <= RESCUE_REACH) {
          target = { kind: 'revive' };
          targetDist = 0;
        }
      }
      // The foot of a tower's ladder.
      const towers = active.content.pipeRig?.towers ?? [];
      for (let i = 0; i < towers.length && !handsFull(); i++) {
        const d = Math.hypot(towers[i]!.foot.x - localX, towers[i]!.foot.z - localZ);
        if (d <= TOWER_REACH && d < targetDist) {
          target = { kind: 'climb', tower: i, floor: active };
          targetDist = d;
        }
      }
      if (aloft) {
        // Up there: on the platform, climb down facing the ladder or grab the pipe; hanging, back onto a platform over a tower, or let go.
        const hanging = aloft.kind === 'hang' && aloft.lift >= 1 && !aloft.back;
        // Hovering just above the floor, the agent can work whatever console is right under: files, logs, the uplink, a terminal.
        const hovering = aloft.kind === 'hang' && (aloft.low ?? 0) >= 1;
        const work = hovering && target && (target.kind === 'capture' || target.kind === 'uplink' || target.kind === 'wipe' || target.kind === 'cutLine' || target.kind === 'terminal') ? target : null;
        target =
          aloft.kind === 'highwall'
            ? aloft.phase === 'hang'
              ? aloft.level === 2 && hangPanel() >= 0
                ? { kind: 'cameraPanel' as const, cam: hangPanel() }
                : { kind: 'wallJump' as const }
              : null
            : aloft.kind === 'wall'
            ? aloft.phase === 'lie'
              ? aerialTarget
                ? { kind: 'wallDrop' }
                : { kind: 'wallRoll' }
              : null
            : aloft.kind === 'perch'
            ? facingLadder(aloft)
              ? { kind: 'climbDown' }
              : { kind: 'hang' }
            : aloft.kind === 'ledge'
              ? aloft.phase === 'hang'
                ? guardPull
                  ? null
                  : (() => {
                    const guard = ledgePullTarget(aloft);
                    return guard ? { kind: 'ledgePull' as const, guard } : { kind: 'ledgeUp' as const };
                  })()
                : null
            : hanging && aloft.kind === 'hang'
              ? hovering && stats.seconds - pulseThreatAt < 0.6
                ? { kind: 'letGo' } // a pulse is coming down this pipe: Interact is Drop, not the console's task
                : (work ?? (towerUnder(aloft.floor.content.pipes!, aloft.grip, CELL) >= 0 && !(aloft.low && aloft.low > 0.02) ? { kind: 'perch' } : { kind: 'letGo' }))
              : null;
      } else if (hiddenIn) target = { kind: 'exitLocker' };
      else if (ventTransit) target = null;
      // In cover, Interact steps back out; otherwise, with nothing else to hand, it takes cover on nearby furniture.
      else if (inCover) target = { kind: 'leaveCover' };
      else if (!target && !carried && sky && sky.rig.state === 'intact' && activeFloorIdx === 1 && !handsFull() && onSkylight()) {
        // Lying on the glass: Interact breaks it.
        target = { kind: 'glass' };
        toastOnce('glass', 'GLASS UNDER YOU · WAIT FOR A GUARD BELOW, THEN BREAK IT AND DROP ON THEM', 5200);
      } else if (!target && !carried && roofY === null && !AUTO_COVER) {
        // Furniture first; failing that, a wall that ends at an opening (a corner to lean out round). (Not up on a container's roof: there is nothing to take cover behind there.)
        const spot = coverSpotNear(active.rig.wallBoxes, player.worldX, player.worldZ) ?? cornerSpotNear(active.rig.wallBoxes, player.worldX, player.worldZ, undefined, active.content.enemies.filter((e) => !e.disabled).map((e) => ({ x: e.worldX, z: e.worldZ })));
        if (spot) target = { kind: 'cover', spot };
      }
      nearbyTarget = target;
      touch.setInteractEnabled(target !== null);
      if (target) touch.setInteractLabel((target.kind === 'capture' && captureLocked()) || (target.kind === 'wipe' && wipeLocked()) ? 'Locked' : INTERACT_LABELS[target.kind]);

      // An active hack fills while the player stays close, pauses (progress
      // kept) when they step away, and drops if they wander off entirely.
      let working = false; // at a console, hands on it: the gun goes away (player.ts's setBusy)
      if (activeHack) {
        const { terminal, floor } = activeHack;
        const label = keyLabel(terminal.keyId);
        const d = floor.content === active.content ? Math.hypot(terminal.x - localX, terminal.z - localZ) : Infinity;
        if (d <= HACK_RADIUS) {
          working = true;
          terminal.progress = Math.min(1, terminal.progress + dt / HACK_S);
          hackKeyTimer -= dt;
          if (hackKeyTimer <= 0) {
            hackKeyTimer = 0.06 + Math.random() * 0.1;
            sound.play('key', worldAt(floor.rig, terminal.x, terminal.z), 0.8);
          }
          if (terminal.progress >= 1) {
            terminal.hacked = true;
            markGoal(`Terminal ${label} hacked`);
            sound.play('hackDone', worldAt(floor.rig, terminal.x, terminal.z));
            terminal.room.setState('active');
            for (const sv of floor.content.servers) if (sv.keyId === terminal.keyId) sv.room.setState('ready');
            activeHack = null;
            hud.setHack(null);
            hud.showToast(`TERMINAL ${label} HACKED · POWER UP SERVER ${label}`, 'good');
          } else {
            hud.setHack(`Hacking terminal ${label}`, terminal.progress);
          }
        } else if (d <= HACK_ABANDON_RADIUS) {
          hud.setHack(`Paused · return to terminal ${label}`, terminal.progress, true);
        } else {
          activeHack = null;
          hud.setHack(null);
        }
      }

      // A station task fills the same way.
      if ((activeTask?.kind === 'capture' && captureLocked()) || (activeTask?.kind === 'wipe' && wipeLocked())) {
        activeTask = null;
        hud.setHack(null);
      }
      if (activeTask) {
        const task = activeTask;
        const { station, floor } = task;
        const what =
          task.kind === 'uplink'
            ? task.station.online
              ? `Taking the ${contract === 'records' ? 'uplink' : 'alarm link'} down`
              : `Restoring the ${contract === 'records' ? 'uplink' : 'alarm link'}`
            : task.kind === 'capture'
              ? (task.station.step?.step.working ?? 'Capturing files')
              : task.kind === 'cutLine'
                ? 'Cutting the uplink line'
                : task.kind === 'clue'
                  ? 'Hacking the facilities terminal'
                  : task.kind === 'slide'
                    ? 'Sliding the shelves'
                    : task.kind === 'crate'
                    ? 'Opening the container'
                    : 'Wiping the access logs';
        const d = floor.content === active.content ? Math.hypot(station.x - localX, station.z - localZ) : Infinity;
        if (d <= HACK_RADIUS) {
          working = true;
          station.progress = Math.min(1, station.progress + dt / (task.kind === 'capture' && task.station.step ? task.station.step.step.seconds : TASK_S[task.kind]));
          hackKeyTimer -= dt;
          if (hackKeyTimer <= 0) {
            hackKeyTimer = 0.06 + Math.random() * 0.1;
            sound.play('key', worldAt(floor.rig, station.x, station.z), 0.8);
          }
          if (station.progress >= 1) {
            station.progress = 0;
            activeTask = null;
            hud.setHack(null);
            finishTask(task);
          } else {
            hud.setHack(what, station.progress);
            if (task.kind === 'clue') {
              // the screen counts it up, a step at a time
              const pct = Math.floor(station.progress * 20) * 5;
              if (pct !== clueScreenPct) {
                clueScreenPct = pct;
                task.station.rig.setState('working');
                task.station.rig.setScreen(['DECRYPTING', `${pct}%`]);
              }
            }
          }
        } else if (d <= HACK_ABANDON_RADIUS) {
          hud.setHack(`Paused · ${what.toLowerCase()}`, station.progress, true);
        } else {
          activeTask = null;
          clueScreenPct = -1;
          hud.setHack(null);
        }
      }
      // A shutter's panel: a quick hack, dropped if you step away.
      if (shutterHack) {
        const hack = shutterHack;
        const { shutter, floor } = hack;
        const p = shutter.rig.panels[hack.panel]!;
        const d = floor.content === active.content ? Math.hypot(p.front.x - localX, p.front.z - localZ) : Infinity;
        if (d <= SWITCH_REACH + 0.3) {
          working = true;
          hack.progress = Math.min(1, hack.progress + dt / SHUTTER_HACK_S);
          hackKeyTimer -= dt;
          if (hackKeyTimer <= 0) {
            hackKeyTimer = 0.06 + Math.random() * 0.1;
            sound.play('key', worldAt(floor.rig, p.front.x, p.front.z), 0.8);
          }
          if (hack.progress >= 1) {
            shutterHack = null;
            hud.setHack(null);
            shutter.openedAt = stats.seconds;
            sound.play('liftDoors', worldAt(floor.rig, shutter.rig.center.x, shutter.rig.center.z, 2));
            const how = onTouch() ? 'OPEN YOUR KIT, TAP TRAP TO AIM, THEN DASH' : keyed('{trap} TO AIM, THEN {interact}').toUpperCase();
            toastOnce('shutter-open', `SHUTTER OPEN · ${SHUTTER_OPEN_S.toFixed(1)} S · TURN AND DASH FOR IT: ${how}`, 3200);
          } else {
            hud.setHack('Hacking the shutter', hack.progress);
          }
        } else {
          shutterHack = null;
          hud.setHack(null);
        }
      }
      player.setBusy(handsFull() ? 'carry' : working || stashing ? 'work' : null);
      tickLogs();
      tickGuide();
      tickBodies(dt);
      if (!training) tickHints(active.content, localX, localZ);
      // Lining up a trap: its path follows the player as they turn.
      if (trapAiming) {
        if (hiddenIn || ventTransit || carried || aloft) cancelTrapAim();
        else {
          const floor = currentFloor();
          const stop = rollTarget(floor);
          trapAim.show(player.worldX, player.worldZ, stop.x, stop.z, floor.rig.group.position.y, stop.slot !== null, sensorBeam(stop.x, stop.z, player.facingAngle, aimWalls(floor)));
          const hop = hopCandidate(floor);
          hopRing.visible = hop !== null;
          if (hop) {
            hopRing.position.set(hop.px, floor.rig.group.position.y + 0.06, hop.pz);
            hopRing.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.08);
            toastOnce('hop', onTouch() ? 'DASH BEHIND THE NEXT DESK: THE RING SHOWS WHERE' : keyed(tower ? '{interact} SPRINTS, SLIDES AND CROUCHES BEHIND THE RING' : '{interact} DASHES TO THE RING: COVER TO COVER').toUpperCase(), 4200);
          }
        }
      }

      // Walking up to a locked door says what it needs.
      for (const rig of active.content.doors) {
        if (rig.isOpen()) continue;
        const d = Math.hypot(rig.center.x - localX, rig.center.z - localZ);
        if (d < DOOR_HINT_RADIUS && !doorHintShown.has(rig)) {
          doorHintShown.add(rig);
          const label = keyLabel(rig.door.id);
          const hacked = active.content.terminals.find((t) => t.keyId === rig.door.id)?.hacked;
          sound.play('denied', worldAt(active.rig, rig.center.x, rig.center.z, 1.5), 0.6);
          hud.showToast(
            hacked ? `SECTION ${label} LOCKED · POWER UP SERVER ${label}` : `SECTION ${label} LOCKED · HACK TERMINAL ${label}, THEN POWER SERVER ${label}`,
            'neutral'
          );
        } else if (d > DOOR_HINT_RADIUS + 1.5) {
          doorHintShown.delete(rig);
        }
      }

      if (yardExit && !cleared && !caught && Math.hypot(player.worldX, player.worldZ) < 4.5) {
        cleared = true;
        sound.play('cleared');
        window.setTimeout(() => hud.setFade(true), 900);
        window.setTimeout(showExitDone, 1700);
      }
      if (training) tickTraining();
      if (bunker && !aloft && ductsOn(activeFloorIdx).some((d) => [d.cells[0]!, d.cells[d.cells.length - 1]!].some((c) => Math.hypot(player.worldX - c.x * CELL, player.worldZ - c.y * CELL) < CELL * 1.6))) {
        toastOnce('duct', 'A DUCT · CROUCH OR CRAWL TO GET IN · GUARDS CAN’T FOLLOW, BUT IT’S SLOW · AT THE END OF SOME, A SHAFT: THE GRAPPLE CLIMBS IT', 6500);
      }
      if (bunker && !aloft && shaftHere()) toastOnce('shaft', keyed('A SHAFT · {grapple} HOOKS THE LINE ABOVE AND CLIMBS TO THE NEXT FLOOR · THE DUCT ON TOP LEADS ON').toUpperCase(), 6500);

      // The lifts only exist on floor 0 (the bunker's way out, on its top floor) — gated on it, so a player on floor
      // 1 directly above one can't trigger it from the wrong height.
      if (activeFloorIdx === 0 || (bunker && activeFloorIdx === BUNKER_EXIT_LEVEL)) {
        // Arrival: the doors open a moment into the job, and shut again once the player is out.
        if (activeFloorIdx === 0 && arrivalPhase === 'waiting' && (arrivalTimer -= dt) <= 0) {
          arrivalPhase = 'open';
          setLiftOpen(arrival, true);
          sound.play('ding', { x: arrival.front.x, y: 2.5, z: arrival.front.z }, 0.7);
        } else if (activeFloorIdx === 0 && arrivalPhase === 'open' && arrival.isOutside(player.worldX, player.worldZ) && (!partner || arrival.isOutside(partner.worldX, partner.worldZ))) {
          // (With a partner, the doors stay open until the two of you are out: shut behind you, they would leave it inside.)
          arrivalPhase = 'done';
          setLiftOpen(arrival, false);
          arrival.setState('idle');
          if (!training) hud.showHint('kit');
        }

        // The way out of a first level played backwards: the lift it began at.
        if (stackExit && !cleared && !caught && activeFloorIdx === 0 && arrival.contains(player.worldX, player.worldZ)) {
          cleared = true;
          setLiftOpen(arrival, false);
          sound.play('cleared');
          window.setTimeout(() => hud.setFade(true), 900);
          window.setTimeout(showExitDone, 1700);
        }
        // Exit: walking up to it locked says what's missing; stepping into the open cab ends the job.
        const atLockedLift = !tower && !exitLift.isOpen() && Math.hypot(player.worldX - exitLift.front.x, player.worldZ - exitLift.front.z) < LIFT_HINT_RADIUS;
        if (atLockedLift && !exitLockedToastShown) {
          exitLockedToastShown = true;
          const remaining = totalFragments - documentsCollected;
          sound.play('denied');
          hud.showToast(
            bunker
              ? `${EXIT.locked} · NO ADDRESS YET · FIND THE DOSSIER`
              : objective
              ? remaining > 0
                ? `${EXIT.locked} · ${objective.brief.toUpperCase()}`
                : `${EXIT.locked} · THE SPECIMEN HAS TO GO OUT WITH YOU`
              : `${EXIT.locked} · ${remaining} MORE FILE${remaining === 1 ? '' : 'S'} TO CAPTURE`,
            'bad'
          );
        } else if (!atLockedLift) {
          exitLockedToastShown = false; // stepped away — show the reminder again next approach
        }
        // With a partner, the lift stands open but only takes the two of you together.
        if (partner && exitLift.isOpen() && exitLift.contains(player.worldX, player.worldZ) && !exitReady() && documentsCollected >= totalFragments && stats.seconds - partnerExitHintAt > 3.5) {
          partnerExitHintAt = stats.seconds;
          sound.play('denied');
          hud.showToast(partnerState === 'free' ? `WAIT FOR ${partnerName.toUpperCase()} · THE LIFT TAKES BOTH OF YOU` : `${partnerName.toUpperCase()} IS DOWN · BRING THEM ROUND, OR STAY HERE ${LEAVE_DOWNED_S} S TO LEAVE THEM`, 'bad', 2400);
        }
        // The lift can also be open to let hunters out — it only takes you away with every document.
        if (!stackExit && !yardExit && exitLift.isOpen() && exitReady() && exitLift.contains(player.worldX, player.worldZ)) {
          cleared = true;
          endFlashOffer();
          hud.setHack(null);
          // Out with logs still queued: the batch goes out behind you.
          if (jobLogServer && jobLogServer.pending > 0) burned = true;
          // The doors shut, the cab rides up, the screen goes black, then the report.
          setLiftOpen(exitLift, false);
          sound.play('cleared');
          window.setTimeout(() => sound.play(EXIT_SOUND[ways.exit]), 700);
          window.setTimeout(() => hud.setFade(true), 900);
          window.setTimeout(exitMode ? showExitDone : hunt ? handOnToTower : training ? showTrainingDone : showClearedReport, 1700);
        }
      }
    }

    // Blackouts and night vision: the ambient glow eases down in the dark and up through the goggles, whose green look eases in.
    const dark = inBlackout();
    if (dark && !blackoutSeen && !cleared && !caught) {
      blackoutSeen = true;
      hud.showToast(keyed('BLACKOUT · NO POWER HERE · GUARDS SEE LESS FAR, AND NIGHT VISION ({goggles}) SEES WITHOUT A TORCH').toUpperCase(), 'neutral', 4200);
    }
    const lightTarget = goggles.on ? Math.max(dark ? BLACKOUT_AMBIENT : 1, GOGGLES_FLOOR) * GOGGLES_GAIN : dark ? BLACKOUT_AMBIENT : 1;
    ambientScale += (lightTarget - ambientScale) * Math.min(1, frameDt * (goggles.on !== nightVision > 0.5 ? 12 : AMBIENT_FADE_RATE));
    root.ambientLight.intensity = AMBIENT_BASE * ambientScale;
    root.sunLight.intensity = SUN_BASE * ambientScale;
    nightVision += ((goggles.on ? 1 : 0) - nightVision) * Math.min(1, frameDt * 10);
    setNightVision(root.postfx, nightVision);
    // The goggles show guards and dogs within range through the walls, outlined in red (infrared.ts).
    root.postfx.heat.on = nightVision > 0.5;
    if (root.postfx.heat.on) {
      const heat: HeatSource[] = [];
      for (const e of currentFloor().content.enemies) {
        if (e.disabled || (e.kind !== 'watchdog' && e.kind !== 'alpha' && !(e instanceof Bot))) continue;
        heat.push({ root: e instanceof Bot ? e.mesh : (e as Watchdog | Alpha).model, x: e.worldX, z: e.worldZ });
      }
      infrared.update(player.worldX, currentFloor().rig.group.position.y, player.worldZ, heat);
      hud.setInfrared(infrared.count, INFRARED_RANGE_M);
    } else hud.setInfrared(null, INFRARED_RANGE_M);
    if (tour) lightBudget.update(tour.focus.x, tour.focus.y, tour.focus.z, frameDt);
    else lightBudget.update(player.worldX, player.worldY + 1, player.worldZ, frameDt);
    if (takeover?.active) takeover.update(frameDt);
    if (shadowsWanted()) {
      // What the scene has gained since (guards, props, the partner) gets its cast/receive flags.
      shadowTagAt -= frameDt;
      if (shadowTagAt <= 0) {
        shadowTagAt = 1;
        tagMeshes(root.scene);
      }
    }
    renderPostFX(root.postfx, dt);
    renderTrapFeed();
    if (cleared || caught) {
      hud.setBodyMeters([]);
      cancelTrapAim();
    } else if (!healthMode) showBodyMeters();
  }
  requestAnimationFrame(() => hud.setFade(false)); // arriving from the last job's lift ride
  signal.addEventListener('abort', () => {
    refreshCoach = () => {};
    cancelAnimationFrame(rafId);
    hud.setBodyMeters([]);
    hud.setTrapAim(false);
    trapAim.dispose();
    hopRing.removeFromParent();
    lightBudget.clearShadows();
    infrared.dispose();
    smokeClouds.dispose();
    disposePostFX(root.postfx);
    ambience.stop();
    klaxon?.stop();
    for (const hum of rotorHums.values()) hum.stop();
    for (const hum of pulseHums.values()) hum.stop();
    tagMarkers.dispose();
    objectiveMarkers.dispose();
    if (specimen) root.scene.remove(specimen.mesh);
    music.stop();
    hud.setLockerView(false);
    hud.setTrapFeed(null);
    hud.hideTour();
    closeBlueprint();
    closeControls();
    for (const h of laserHums) h.loop.stop();
    for (const f of flareHums) f.stop();
  });
  if (training) {
    showStation();
    if (course && !tower && !highwall && !bunker) reportTry({ kind: 'train', course, event: 'reach', station: 1 });
    // The stealth course starts with the torch on: a torch is a light on you, which is what its first lessons are about.
    if (stealth) setTorchOn(true);
    // Control's first words, on the first course only.
    if (course === 'basics') later(() => hud.showToast(TRAINING_LINE, 'neutral', 6000), 2500);
  }
  // Localhost only: `?clear=1` ends the job as cleared a couple of seconds in, to see the report and what follows it (the story's choice at job 15).
  if (!training && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('clear') === '1') {
    later(() => {
      cleared = true;
      endFlashOffer();
      showClearedReport();
    }, 2500);
  }
  // Localhost only: `?caught=1` has the agent caught a few seconds in, to see the reset after a catch and the choice after it.
  if (!training && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('caught') === '1') {
    later(() => {
      triggerCaught('Spotted', 'A guard saw you.');
    }, 6000);
  }
  if (objective) later(() => hud.showToast(`CONTRACT · ${objective.brief.toUpperCase()}`, 'good', 7000), ARRIVAL_OPEN_S * 1000 + 2400);
  // `?hover=demo` (localhost only): a moment after the job opens the agent is put on the pipe over the first workstation, hooked on, and lowered to hover over it, to look at the
  // flat hovering pose without having to get there.
  const hoverDemo = !training && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('hover') === 'demo';
  if (hoverDemo) {
    const start = (): void => {
      // The agent waits until the game is running and out of the arrival lift (the recon fly-over is skipped below).
      if (paused() || arrivalPhase !== 'done') {
        later(start, 400);
        return;
      }
      const plan = floor0Content.pipes;
      const w = floor0Content.workstations[0];
      if (!plan || !w) return;
      let best: { d: number; x: number; z: number } | null = null;
      for (const l of plan.lines) {
        const u = l.axis === 'x' ? w.x : w.z;
        const v = l.axis === 'x' ? w.z : w.x;
        const t = Math.min(l.to * CELL, Math.max(l.from * CELL, u));
        const d = Math.hypot(u - t, v - l.at * CELL);
        if (!best || d < best.d) best = { d, x: l.axis === 'x' ? t : l.at * CELL, z: l.axis === 'x' ? l.at * CELL : t };
      }
      if (!best) return;
      if (jobUplink) jobUplink.online = false;
      player.place(best.x, best.z, 0, 0);
      handleGrapple();
      later(() => handleGrapple(), 2600); // once the line has hauled the agent up: the same key lowers it
    };
    later(start, ARRIVAL_OPEN_S * 1000 + 2500);
  }
  // ?glass=demo (localhost): once the job is running, the agent is put on the skylight and a guard stands on the ground floor below it, to try breaking the glass.
  if (sky && floor1 && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('glass') === 'demo') {
    const s = sky;
    const start = (): void => {
      if (paused() || arrivalPhase !== 'done') {
        later(start, 400);
        return;
      }
      const guard = floor0Content.enemies.find((e): e is Bot => e instanceof Bot && e.kind !== 'heavy' && e.kind !== 'hunter');
      if (guard) guard.setPost(floor0.group.position.x + s.x0 * CELL + 0.8, floor0.group.position.z + s.y0 * CELL, Math.PI / 2);
      player.place(s.wx, s.wz, 0, floor1.group.position.y);
      hud.showToast('GLASS DEMO · A GUARD STANDS UNDER THE GLASS · INTERACT (SPACE) TO BREAK IT AND DROP ON HIM', 'neutral', 6000);
    };
    later(start, ARRIVAL_OPEN_S * 1000 + 2500);
  }
  if (sideGoal) later(() => hud.showToast(`SIDE GOAL · ${SIDE_GOALS[sideGoal].name.toUpperCase()} · ${SIDE_GOALS[sideGoal].brief}${sideGoal === 'swift' ? ` (${formatTime(parSeconds(cols * rows + upperCells))})` : ''} · +${SIDE_BONUS}`, 'neutral', 7000), ARRIVAL_OPEN_S * 1000 + 4600 + twists.length * 7600);
  // Arriving from the tower: how the climb went.
  if (approach) later(() => hud.showToast('DOWN FROM THE OFFICES · ' + (approach.suspicion >= 60 ? 'THE ALARM WENT UP ON THE WAY IN · THEY KNOW SOMEONE IS IN THE BUILDING' : approach.suspicion > 0 ? 'THEY NOTICED SOMETHING ON THE WAY IN · THE GUARDS ARE EDGY' : 'IN UNSEEN · THE BUILDING IS QUIET'), approach.suspicion >= 60 ? 'bad' : 'neutral', 5200), ARRIVAL_OPEN_S * 1000 + 1500);
  twists.forEach((id, i) => later(() => hud.showToast(`TWIST · ${TWISTS[id].name} · ${TWISTS[id].brief}`, 'neutral', 7000), ARRIVAL_OPEN_S * 1000 + 4600 + i * 7600));
  const news = !training && diff.newThisJob;
  if (news) later(() => hud.showToast(news, 'neutral', NEWS_TOAST_MS), ARRIVAL_OPEN_S * 1000);
  // The campaign's first job somewhere new says so (and a daily heist names where it is).
  const newPlace = !training && !dailyRun ? arrivesAt(level) : null;
  // The run's tower: the lift opens on the address the dossier gave.
  if (tower && !exitMode && savedRun?.stage === 'tower' && savedRun.place === towerSetId) {
    const a = addressOf(savedRun);
    later(() => hud.showToast(`${a.name.toUpperCase()} · ${a.street.toUpperCase()}`, 'neutral', 6500), ARRIVAL_OPEN_S * 1000 + 700);
  }
  if (newPlace && !heldIn) later(() => hud.showToast(newPlace.arrival, 'good', NEWS_TOAST_MS), ARRIVAL_OPEN_S * 1000 + 700);
  // Every later job somewhere else says where tonight's is, like a daily does.
  else if (!training && !dailyRun && level > CAMPUS_JOBS && !heldIn) later(() => hud.showToast(`TONIGHT’S TARGET · ${place.name.toUpperCase()}`, 'neutral', 3600), ARRIVAL_OPEN_S * 1000 + 700);
  else if (!training && place.id !== 'campus' && dailyRun) later(() => hud.showToast(`TONIGHT’S TARGET · ${place.name.toUpperCase()}`, 'neutral', 3600), ARRIVAL_OPEN_S * 1000 + 700);
  animate();
  if (showBriefing) openBriefing();
  else if (tourPending) startTour(true);
}

// Shown once, when the game opens — job restarts/advances (above) never
// show it again. It leads with Continue when there's a run to pick up, else
// with training until that's done. It opens straight away on what this
// browser remembers, then catches up once the account's saved progress
// arrives (a logged-in player's agent, training and furthest job follow
// them between devices; see /api/init and /api/profile).
const trained = ((): boolean => {
  try {
    return window.localStorage.getItem(TRAINED_KEY) === '1';
  } catch {
    return false;
  }
})();
/** The Training menu's courses, in the order to take them: what each teaches, and whether this browser has done it. */
function trainingCourses(): hud.TrainingCourse[] {
  const done = (key: string): boolean => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  return [
    { id: 'basics', title: 'The basics', blurb: 'One floor, one move at a time: sneaking, cover, taking a guard down, hiding a body, traps, the uplink, the file, the logs and the way out.', done: done(TRAINED_KEY) },
    { id: 'weapons', title: 'The gun, traps and flash grenades', blurb: 'One shot, then the chime. Heavies and their armour, traps set and slid into place, and the flash grenade that blinds a guard.', done: weaponsTrained() },
    { id: 'cover', title: 'Cover fire and enemies', blurb: 'Take cover behind a crate, lean out, aim and shoot: a guard, a patrol, a hunter, a heavy, a watchdog, a mine and a drone.', done: coverTrained() },
    { id: 'corners', title: 'Corners and high ground', blurb: 'Hold a wall’s end and shoot down the hall round it; climb a tower, lie flat on its platform and shoot what you can see.', done: cornersTrained() },
    { id: 'wall', title: 'Over the wall', blurb: 'Dash at a maze wall, run up it and lie flat along the top out of sight; shoot from there, jump off, or drop on a guard below.', done: wallTrained() },
    { id: 'highwall', title: 'The tall wall', blurb: 'A wall twice the height, with a shelf along its face: dash up it and hang from the shelf, shimmy and hop along it, then drop or leap onto a guard below.', done: highwallTrained() },
    { id: 'stealth', title: 'Staying hidden', blurb: 'The visibility meter, crouching, lying flat, the dash, and the laser gates that a cloak can’t beat.', done: stealthTrained() },
    { id: 'grapple', title: 'The grapple', blurb: 'Hook a pipe, shimmy over a wall, drop on a guard, and hover over a console while the room below can’t see you.', done: grappleTrained() },
    { id: 'ceiling', title: 'Up high', blurb: 'The ceiling’s towers, pipes and moving lasers, and the pulses that run down the pipes. Before job 8.', done: ceilingTrained() },
  ];
}

let pickedThisVisit = false; // a pick made on the brief beats the account's, which may arrive after it
let pickedLookThisVisit = false;
const updateBrief = hud.showMissionBrief({
  trained,
  welcomed: false, // (set below, once the key it is read by is defined)
  agent,
  continueJob: continueJob(localBestJob()),
  daily: null,
  onDaily: playDaily,
  look,
  looks: LOOK_CHOICES,
  onLook: (chosen) => {
    look = chosen;
    pickedLookThisVisit = true;
    try {
      window.localStorage.setItem(LOOK_KEY, chosen);
    } catch {
      // Storage blocked: the pick holds for this session only.
    }
    void saveProfile({ look: chosen });
    refreshPortraits();
  },
  style,
  suits: SUIT_CHOICES,
  hairstyles: HAIR_CHOICES,
  onStyle: (chosen) => {
    style = chosen;
    pickedLookThisVisit = true;
    try {
      window.localStorage.setItem(SUIT_KEY, chosen.suit);
      window.localStorage.setItem(HAIR_KEY, chosen.hair);
    } catch {
      // Storage blocked: the pick holds for this session only.
    }
    void saveProfile({ suit: chosen.suit, hair: chosen.hair });
    refreshPortraits();
  },
  onAgent: (chosen) => {
    agent = chosen;
    pickedThisVisit = true;
    try {
      window.localStorage.setItem(AGENT_KEY, chosen);
    } catch {
      // Storage blocked: the pick holds for this session only.
    }
    void saveProfile({ agent: chosen });
  },
  coopAi: aiCoopOn,
  onCoopAi: setAiCoop,
  onBegin: () => introThen(() => briefThenStart(1)),
  onTrain: () => introThen(() => startJob(1, 'basics')),
  trainingCourses,
  onTrainCourse: (id) => {
    if (id === 'basics') introThen(() => startJob(1, 'basics'));
    else if (id === 'ceiling') startJob(CEILING_BEFORE_JOB, 'ceiling');
    else if (id === 'weapons' || id === 'cover' || id === 'corners' || id === 'wall' || id === 'highwall' || id === 'stealth' || id === 'grapple') startJob(1, id);
  },
  onContinue: (job) => introThen(() => briefThenStart(job)),
});
ladderJob = continueJob(localBestJob()) ?? 1;

/** Today's heist, for the brief's daily card. */
function dailyBrief(d: DailyResponse): hud.DailyBrief {
  const op = tonight(d.day);
  return {
    number: d.number,
    operation: `${op.name}: ${op.site.name}`,
    level: d.level,
    status: d.status,
    loggedIn: d.streak !== null,
    result: d.result ? { cleared: d.result.cleared, grade: d.result.grade } : null,
    rank: d.board.you?.rank ?? null,
    players: d.board.players,
    streak: streakKnown ?? d.streak,
    caseLine: caseLine(d.case),
  };
}

/** Starts today's heist: scored if the server says this is the player's first start today, practice otherwise. */
/** A job's side goal as Control's letter puts it. */
const sideBrief = (id: SideGoalId | null): SideBrief | null => (id ? { name: SIDE_GOALS[id].name, ask: SIDE_GOALS[id].ask, bonus: SIDE_BONUS } : null);

/**
 * The twists and side goal job `level` is dealt before it starts, for the letter: the campaign's rotation, or a Daily's draw from its seed. The Daily's is drawn
 * the way startJob draws it (the seeded random, twists first), so the letter and the job always agree.
 */
function dealt(level: number, seed: number | null): { twists: TwistId[]; side: SideGoalId | null } {
  const contract = contractFor(level, locationFor(level).id);
  if (seed === null) {
    const twists = storyTwist(level, contract);
    return { twists, side: storySideGoal(level, twists) };
  }
  seedRandom(seed);
  try {
    const twists = dailyTwists(Math.random, contract);
    return { twists, side: dailySideGoal(Math.random, twists) };
  } finally {
    restoreRandom();
  }
}

/** The jobs whose letter still boxes a note about the laser gates (every Daily does): after that they are known. */
const GATE_NOTE_UNTIL_JOB = 6;

/** The boxes in Control's letter: one per twist, and the laser gates while they are new. */
function letterNotes(twists: readonly TwistId[], level: number, daily: boolean): LetterNote[] {
  return [...twists.map((id) => TWIST_NOTES[id]), ...(daily || level <= GATE_NOTE_UNTIL_JOB ? [GATE_NOTE] : []), ...(daily || (level >= 2 && level <= GATE_NOTE_UNTIL_JOB + 2) ? [LINE_NOTE] : [])];
}

/** Control's briefing for today's heist, as the scored attempt, a replay (practice), or for a guest (practice). */
function dailyBriefing(d: DailyResponse): ReturnType<typeof briefing> & { mode: 'scored' | 'replay' | 'guest' } {
  const mode = d.streak === null ? 'guest' : d.status === 'new' ? 'scored' : 'replay';
  return { ...briefing(tonight(d.day), difficultyFor(d.level).documents, agent, username, mode, dailyCarry(d), null, contractFor(d.level, locationFor(d.level).id), sideBrief(dealt(d.level, d.seed).side), letterNotes(dealt(d.level, d.seed).twists, d.level, true)), mode };
}

/** Control's letter for job `n` on the ladder: the same one every time that job is played. */
function ladderBriefing(n: number): ReturnType<typeof briefing> {
  return briefing(jobOperation(n), difficultyFor(n).documents, agent, username, 'job', ladderCarryNow(n), arcOpening(n, ending), contractFor(n, locationFor(n).id), sideBrief(dealt(n, null).side), letterNotes(dealt(n, null).twists, n, false));
}

/** The ways in job `job` offers, for the letter: the last one picked first when it's on offer. */
function offerEntries(job: number, daily: boolean, coop = true): void {
  // The AI partner can be opted into on any job's letter (not only the first brief), except the scored Daily, which is the same for everyone.
  hud.setDossierCoop(
    coop
      ? {
          on: aiCoopOn,
          note: `${agent === 'male' ? 'Agent B' : 'Agent A'} comes out of the lift with you, follows, covers and shoots. Kept for the next job too.`,
          onChange: setAiCoop,
        }
      : null
  );
  hud.setDossierEntries(
    entriesFor(job, daily).map((id) => ({ id, ...(id === 'dock' ? ENTRY_TITLE[WAYS[locationFor(job).id].entry] : ENTRIES[id]) })),
    lastEntry
  );
}

/** Set once the opening cutscene has been shown (or skipped) in this browser. */
const INTRO_KEY = 'mazeHeist.sawIntro';

/** Whether this player has no need of the opening: they've seen it, or they were playing before it existed. */
function introSeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1' || window.localStorage.getItem(TRAINED_KEY) === '1' || localBestJob() !== null;
  } catch {
    return true;
  }
}

// The welcome letter on the brief is for an agent who has not been through the opening yet.
updateBrief({ welcomed: introSeen() });

/** The opening cutscenes (intro.ts, then the apartment) before the first thing a new player does, once; then `next`. */
function introThen(next: () => void): void {
  if (introSeen()) {
    next();
    return;
  }
  void playIntro({ canvas: document.getElementById('bg') as HTMLCanvasElement, agent, look, style })
    .then(() => {
      try {
        window.localStorage.setItem(INTRO_KEY, '1');
      } catch {
        // Storage blocked: it plays again next visit.
      }
      // Then the apartment (storycinema.ts): the two of them sit on their beds with the papers beside them, and a radio tells them where they are. Only for a new player, straight after the intro.
      return playStory({ id: 'apartment', canvas: document.getElementById('bg') as HTMLCanvasElement, look, style });
    })
    .then(() => {
      updateBrief({ welcomed: true });
      next();
    });
}

/** After the building has been reset: the same job, and the way in to pick again. */
function offerWayIn(job: number): void {
  offerEntries(job, false);
  hud.showDossier(
    {
      kicker: 'The building has been reset',
      greeting: `${salutation(agent, username)}.`,
      paragraphs: [
        'Everything you moved, took or opened is gone, and the walls are somewhere else. Every retry is a fresh floor.',
        'Pick the way in again.',
      ],
      parameters: [],
      closing: '',
    },
    { label: 'Go in', onClick: () => startJob(job, null, null, takeEntry()) },
    { label: 'Main menu', onClick: () => hud.reopenMissionBrief() }
  );
}

/** The way in picked on the letter, remembered for next time. */
function takeEntry(): EntryId {
  const e = hud.chosenEntry();
  lastEntry = e === 'roof' || e === 'tunnel' ? e : 'dock';
  try {
    window.localStorage.setItem(ENTRY_KEY, lastEntry);
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  return lastEntry;
}

/** A job on the ladder: Control's letter first, every time, with the way in to pick; Accept goes in, Not now back to the brief. */
// On a touch screen nothing in the game is text to select or a link with a menu: a long press starts neither (Android's Translate / Copy / Select all bar, the
// long-press menu), whatever it lands on; fields still select. (The CSS says the same for the buttons; this covers what lands on the canvas or a label.)
{
  const touchScreen = window.matchMedia('(pointer: coarse)').matches;
  const inField = (t: EventTarget | null): boolean => t instanceof Element && t.closest('input, textarea') !== null;
  document.addEventListener('contextmenu', (e) => {
    if (touchScreen && !inField(e.target)) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (touchScreen && !inField(e.target)) e.preventDefault();
  });
}

// Landscape on a phone (orientation.ts): Reddit keeps a web view upright, so the game turns itself. A button on the card shown while a touch screen is held upright (and a
// switch in the controls sheet) hands the game over to public/landscape.html, which runs it in a frame turned a quarter; the player turns the phone to match. Chosen
// for the visit, and the game can ask the page to leave. It restarts the page, so a second tap is asked for when something is going on.
{
  const hint = document.getElementById('rotate-hint')!;
  const goButton = document.getElementById('rotate-hint-lock') as HTMLButtonElement;
  const goText = document.getElementById('rotate-hint-text')!;
  const row = document.getElementById('help-landscape-row')!;
  const switchEl = document.getElementById('help-landscape') as HTMLInputElement;
  const portraitQuery = window.matchMedia('(orientation: portrait)');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const inFrame = inLandscapeFrame(window.location.search, window.name, window.parent !== window);
  const dismissedKey = 'mazeHeist.rotateHintAway';
  const read = (key: string): boolean => {
    try {
      return window.sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const write = (key: string, on: boolean): void => {
    try {
      if (on) window.sessionStorage.setItem(key, '1');
      else window.sessionStorage.removeItem(key);
    } catch {
      // No storage: the choice is lost on the next load.
    }
  };
  if (shouldEnterLandscape({ chosen: read(LANDSCAPE_KEY), touch, inFrame })) window.location.replace('landscape.html');
  const refresh = (): void => void (hint.hidden = !rotateHintWanted({ touch, portrait: portraitQuery.matches, inFrame, dismissed: read(dismissedKey) }));
  /** In the frame: ask the page above to go back to the normal view. Outside: go into landscape (the page restarts, so with a job going it takes a second tap). */
  let armed = 0;
  const choose = (on: boolean): void => {
    if (!on) {
      if (inFrame) window.parent.postMessage({ maze: 'exit' }, '*');
      return;
    }
    const busy = !document.body.classList.contains('modal-open');
    if (busy && window.performance.now() - armed > 4000) {
      armed = window.performance.now();
      goText.textContent = 'This restarts the page and loses the job in progress. Tap again to go on';
      hud.showToast('TAP AGAIN TO SWITCH · THE JOB IN PROGRESS WILL BE LOST', 'neutral', 4000);
      switchEl.checked = false;
      return;
    }
    write(LANDSCAPE_KEY, true);
    window.location.href = 'landscape.html';
  };
  row.hidden = !touch;
  switchEl.checked = inFrame;
  goButton.addEventListener('click', () => choose(true));
  switchEl.addEventListener('change', () => choose(switchEl.checked));
  document.getElementById('rotate-hint-close')!.addEventListener('click', () => {
    write(dismissedKey, true);
    hint.hidden = true;
  });
  portraitQuery.addEventListener('change', refresh);
  refresh();
  // Tell the page above this copy is up, so it doesn't show its "not available here" note.
  if (inFrame) window.parent.postMessage({ maze: 'ready' }, '*');
}

// Testing on your own machine (served from localhost, never on Reddit): `?job=9` skips the brief and starts
// job 9 straight away, `?job=training` starts training, `?agent=female` picks the body, `?look=operative` wears the suit, and `?suit=olive`
// and `?hair=long` pick its colour and hair; `?ending=public` or `?ending=private` sets the story's ending (not saved), `?clear=1` clears the job a moment in, `?caught=1` has you caught a few seconds in, `?intro=1` plays the opening cutscene, and `?card=5.2` shows a memory card.
if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  const params = new URLSearchParams(window.location.search);
  // `?agent=female` or `?agent=male` picks the body (not saved), for trying a model without going through the brief.
  const wantedAgent = params.get('agent');
  if (wantedAgent === 'female' || wantedAgent === 'male') {
    agent = wantedAgent;
    updateBrief({ agent });
    refreshPortraits();
  }
  const wanted = params.get('look');
  if (isLook(wanted)) {
    look = wanted;
    updateBrief({ look });
  }
  const suit = params.get('suit');
  const hair = params.get('hair');
  if (isSuitColour(suit) || isHairstyle(hair)) {
    style = { suit: isSuitColour(suit) ? suit : style.suit, hair: isHairstyle(hair) ? hair : style.hair };
    updateBrief({ style });
  }
  if (isLook(wanted) || isSuitColour(suit) || isHairstyle(hair)) refreshPortraits();
  // `?intro=1` plays the opening cutscene straight away.
  if (params.get('intro')) void playIntro({ canvas: document.getElementById('bg') as HTMLCanvasElement, agent, look, style });
  // `?card=5.2` shows page 2 of job 5's memory card straight away (not kept).
  const [cardJob, cardN] = (params.get('card') ?? '').split('.').map(Number);
  const cardText = cardJob && cardN ? memoryText(cardJob, cardN) : null;
  if (cardText) window.setTimeout(() => hud.showMemory(cardText, cardN!, MEMORY_TOTAL), 600);
  const wantedEnding = params.get('ending');
  if (isEnding(wantedEnding)) ending = wantedEnding; // `?ending=public|private`: the epilogue's voice, without playing to the final level (not saved)
  // `?cinema=1&ending=public|private` plays that ending's cinematic straight away; `&at=12` holds it 12 seconds in (no sound).
  if (params.get('cinema') && isEnding(wantedEnding)) {
    const at = Number(params.get('at'));
    window.setTimeout(() => {
      hud.closeMissionBrief();
      void playCinematic({ ending: wantedEnding, canvas: document.getElementById('bg') as HTMLCanvasElement, agent, look, style, documents: 6, ...(params.get('at') && Number.isFinite(at) ? { freezeAt: at } : {}) });
    }, 0);
  }
  // `?story=apartment` (or `core`, a preview of the final level's lab hall) plays that story scene straight away (docs/cinematics.md); `&at=30` holds it 30 seconds in (no sound).
  const storyId = params.get('story');
  if ((storyId === 'apartment' || storyId === 'core') && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    const at = Number(params.get('at'));
    window.setTimeout(() => {
      hud.closeMissionBrief();
      void playStory({ id: storyId, canvas: document.getElementById('bg') as HTMLCanvasElement, look, style, ...(params.get('at') && Number.isFinite(at) ? { freezeAt: at } : {}) });
    }, 0);
  }
  // `?layout=demo`: a row of chips that force each contextual touch control into view (layoutdemo.ts), to look at where every button sits.
  if (params.get('layout') === 'demo') startLayoutDemo();
  // `?hover=demo` also goes without the recon fly-over (startJob puts the agent on the line over the first console: see hoverDemo there).
  if (params.get('hover') === 'demo') {
    try {
      window.localStorage.setItem(TOUR_SKIPS_KEY, '3');
    } catch {
      // No storage: the recon plays, and the demo waits for it.
    }
  }
  const loc = params.get('loc');
  if (loc && loc in LOCATIONS) forcedLocation = loc as LocationId;
  if (params.get('layout') === 'maze') layoutStyle = 'maze';
  const ease = params.get('ease');
  if (ease !== null && Number.isInteger(Number(ease)) && Number(ease) >= 0) easeOverride = Number(ease);
  // `?op=3` (or `?op=next`, the one after the last cleared) on localhost starts that campaign operation at its first level (operations.ts); the run is kept, so the levels after it follow it.
  const opAsked = params.get('op');
  if (opAsked !== null && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    const store = ((): Storage | null => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })();
    const n = opAsked === 'next' ? (nextOperation(opsCleared(store)) ?? 1) : Math.floor(Number(opAsked));
    const seed = Number(params.get('seed'));
    const first = operationRun(Number.isInteger(seed) && seed > 0 ? seed : 1 + Math.floor(Math.random() * 1e9), n);
    // `&stage=tower|maze|exit` jumps to that level of the operation (the dossier counts as read), to play it on its own.
    const jump = params.get('stage');
    const run: ArcRun = jump === 'tower' || jump === 'maze' || jump === 'exit' ? { ...first, stage: jump, found: true } : first;
    clearStats(store);
    keepRun(store, run);
    window.setTimeout(() => {
      hud.closeMissionBrief();
      if (run.stage === 'bunker') beginRun(run);
      else if (run.stage === 'maze') startJob(1, null, null, 'dock');
      else if (reverseExit(run)) {
        if (isYardSite(run.site)) reloadAt('?job=dock');
        else startJob(1, 'bunker');
      } else startJob(1, 'tower');
    }, 0);
  }
  const job = params.get('job');
  const start = (go: () => void): void => {
    hud.closeMissionBrief();
    go();
  };
  if (job === 'training') window.setTimeout(() => start(() => startJob(1, 'basics')), 0);
  else if (job === 'grapple') window.setTimeout(() => start(() => startJob(1, 'grapple')), 0);
  else if (job === 'stealth') window.setTimeout(() => start(() => startJob(1, 'stealth')), 0);
  else if (job === 'weapons') window.setTimeout(() => start(() => startJob(1, 'weapons')), 0);
  else if (job === 'cover') window.setTimeout(() => start(() => startJob(1, 'cover')), 0);
  else if (job === 'corners') window.setTimeout(() => start(() => startJob(1, 'corners')), 0);
  else if (job === 'wall') window.setTimeout(() => start(() => startJob(1, 'wall')), 0);
  else if (job === 'highwall') window.setTimeout(() => start(() => startJob(1, 'highwall')), 0);
  else if (job === 'dock') window.setTimeout(() => start(() => startJob(1, 'dock')), 0);
  else if (job === 'bunker') window.setTimeout(() => start(() => startJob(Math.max(1, Number(params.get('n')) || 1), 'bunker')), 0);
  else if (job === 'tower') window.setTimeout(() => start(() => startJob(Math.max(1, Number(params.get('n')) || 5), 'tower')), 0);
  else if (job === 'range' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) window.setTimeout(() => start(() => startJob(1, 'range')), 0);
  else if (job === 'ceiling') window.setTimeout(() => start(() => startJob(CEILING_BEFORE_JOB, 'ceiling')), 0);
  else if (job && Number(job) >= 1) {
    // On localhost only: ?seed=N fixes the building, ?entry=roof starts on the data-centre floor, ?bodies=N lays out guards to stash.
    const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    const n = Math.floor(Number(job));
    const seed = local && params.get('seed') ? Number(params.get('seed')) : NaN;
    const entryParam = local ? params.get('entry') : null;
    const way: EntryId = entryParam === 'roof' || entryParam === 'tunnel' ? entryParam : 'dock';
    if (local) practiceBodies = Math.max(0, Math.min(4, Math.floor(Number(params.get('bodies')) || 0)));
    const run: DailyRun | null = Number.isFinite(seed) ? { day: '2026-10-01', number: n, seed, scored: false, carry: NO_CARRY, week: [] } : null;
    window.setTimeout(() => start(() => startJob(n, null, run, way)), 0);
  }
}

/** Loads the page again at `query` (the yard's cells are eight metres and every other level's four, and that is decided as the page loads), keeping the saved run. */
/** Whether the scenes between levels play (`?cutscenes=0` on localhost leaves them out). */
function cutscenesOn(): boolean {
  return !(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && new URLSearchParams(window.location.search).get('cutscenes') === '0');
}

/** Starts a run at its first level (the bunker, or the dock yard by a page load): for a campaign operation, after the call-in that sends the agent there. */
function beginRun(run: ArcRun): void {
  const go = (): void => (isYardSite(run.site) ? reloadAt('?job=dock&objective=1') : startJob(1, 'bunker'));
  const op = operationOf(run);
  if (op && cutscenesOn()) void playInterlude(callInScene(op)).then(go);
  else go();
}

function reloadAt(query: string): void {
  window.location.assign(`${window.location.pathname}${query}`);
}

/** What to do once the mandatory stealth lesson is done: carry on to the mission it interrupted. */
let stealthResume: (() => void) | null = null;

/**
 * Every agent has to have done the stealth course before going into a mission (the campaign or the Daily). Until they have, Control's
 * letter about it stands in the way, with a single way on: the training. `then` carries on to the mission afterwards.
 * Returns whether it stepped in.
 */
function requireStealth(then: () => void): boolean {
  if (stealthTrained()) return false;
  stealthResume = then;
  hud.showDossier(
    {
      kicker: 'Encrypted message · Training · New',
      greeting: `Good evening, ${salutation(agent, username)}.`,
      paragraphs: [
        'The guards have changed how they watch, and so must you. Before you go in, there’s one more lesson, and it isn’t optional: how to stay out of sight.',
        'Light, distance and how low you are decide whether a guard sees you. You’ll learn to read the visibility meter, to crouch, to lie flat and crawl, and to dash when there’s no time. It takes a few minutes.',
      ],
      parameters: [],
      closing: 'Then the mission is yours.',
    },
    { label: 'Start training', onClick: () => startJob(1, 'stealth') }
  );
  return true;
}

function briefThenStart(n: number): void {
  if (requireStealth(() => briefThenStart(n))) return;
  // The grapple is on every job: the first time in a visit that a job is about to start without it learned, Control offers the course.
  if (!grappleTrained() && !offeredBefore('grapple')) {
    markOffered('grapple');
    hud.showDossier(
      {
        kicker: `Encrypted message · Training · Before job ${n}`,
        greeting: `Good evening, ${salutation(agent, username)}.`,
        paragraphs: [
          'Every building has pipes along its ceiling, and we’ve fitted you with a grapple. Hook one, haul yourself up, and you’re above the guards’ and the dogs’ notice: over a wall, over a sentry’s head, or lowered on the line to hover just over a workstation while you take the files.',
          'It runs on your own strength, though. Your arms tire, and if the grip gives out you fall, and that’s loud.',
        ],
        parameters: [
          { text: 'Hook a pipe and haul yourself up (U).' },
          { text: 'Shimmy over a wall, and drop on a guard who never looked up.' },
          { text: 'Hover over a console and photograph the file.' },
        ],
        closing: 'It takes a couple of minutes, and you can skip it if you’d rather learn on the job.',
      },
      { label: 'Train first', onClick: () => startJob(1, 'grapple') },
      { label: `Straight to job ${n}`, onClick: () => briefThenStart(n) }
    );
    return;
  }
  // Job 8 brings the ceiling: the first time there, Control offers the training for it first.
  if (n === CEILING_BEFORE_JOB && !ceilingTrained() && !offeredBefore('ceiling')) {
    markOffered('ceiling');
    hud.showDossier(
      {
        kicker: `Encrypted message · Training · Before job ${n}`,
        greeting: `Good evening, ${salutation(agent, username)}.`,
        paragraphs: [
          'The buildings from here on are tougher. The pipes up in the dark over the corridors carry electric pulses now, and there are towers to climb to them: a way over the walls, a lookout, and a way to drop on a guard who never thought to look up. The pulses don’t care who’s hanging there.',
          'Their lasers have moved on too: some sweep, some slide. We’ve rigged a floor for you to practise on first.',
        ],
        parameters: [
          { text: 'Duck a sweeping laser; let a laser curtain pass.' },
          { text: 'Climb a tower and tag the guards from the lookout.' },
          { text: 'Hang from the pipes, shimmy, and drop on a guard.' },
          { text: 'Get off a pipe before a pulse reaches you.' },
        ],
        closing: 'It takes a few minutes, and you can skip it if you’d rather learn on the job.',
      },
      { label: 'Train first', onClick: () => startJob(n, 'ceiling') },
      { label: `Straight to job ${n}`, onClick: () => briefThenStart(n) }
    );
    return;
  }
  const answer = trackLetter(n, false);
  hud.showDossier(
    ladderBriefing(n),
    {
      label: 'Accept mission',
      onClick: () => {
        answer('accept');
        startJob(n, null, null, takeEntry());
      },
    },
    {
      label: 'Not now',
      onClick: () => {
        answer('later');
        hud.reopenMissionBrief();
      },
    }
  );
  offerEntries(n, false);
}

/**
 * Control's offers of a training course before a job (the grapple before the first job, the ceiling before job 8) are made once, ever, in this browser: skipped, they are not made again every
 * visit (the course stays on the Training menu). Kept apart from having done the course.
 */
function offeredBefore(course: 'grapple' | 'ceiling'): boolean {
  try {
    return window.localStorage.getItem(`mazeHeist.offered.${course}`) === '1';
  } catch {
    return offeredThisVisit.has(course);
  }
}
const offeredThisVisit = new Set<string>();
function markOffered(course: 'grapple' | 'ceiling'): void {
  offeredThisVisit.add(course);
  try {
    window.localStorage.setItem(`mazeHeist.offered.${course}`, '1');
  } catch {
    // Storage blocked: once a visit.
  }
}

const PLAY_LABEL = { scored: 'Accept mission', replay: 'Replay for practice', guest: 'Play for practice' } as const;

/** Counts a job's letter being opened, and returns what to call when it's answered: how, and how long it stayed open (shared/tries.ts). */
function trackLetter(job: number, daily: boolean): (event: 'accept' | 'later') => void {
  const openedAt = performance.now();
  reportTry({ kind: 'letter', job, daily, event: 'shown' });
  return (event) => reportTry({ kind: 'letter', job, daily, event, read: readOf((performance.now() - openedAt) / 1000) });
}

/** Today's heist: Control's message first, every time (the scored attempt starts only on Accept). */
function playDaily(): void {
  const d = today;
  if (!d) return;
  if (requireStealth(playDaily)) return;
  const letter = dailyBriefing(d);
  const answer = trackLetter(d.level, true);
  hud.showDossier(
    letter,
    {
      label: PLAY_LABEL[letter.mode],
      onClick: () => {
        answer('accept');
        void beginDaily(d, takeEntry());
      },
    },
    {
      label: 'Not tonight',
      onClick: () => {
        answer('later');
        hud.reopenMissionBrief();
      },
    }
  );
  offerEntries(d.level, true, letter.mode !== 'scored');
}

async function beginDaily(d: DailyResponse, entry: EntryId): Promise<void> {
  const start = d.streak !== null ? await startDaily(d.day) : null;
  if (start) streakKnown = start.streak;
  const scored = start?.status === 'started';
  startJob(d.level, null, { day: d.day, number: d.number, seed: d.seed, scored, carry: dailyCarry(d), week: d.week }, entry);
  hud.showToast(scored ? `DAILY #${d.number} · YOUR SCORED ATTEMPT · GOOD LUCK` : `DAILY #${d.number} · PRACTICE RUN · NOT SCORED`, scored ? 'good' : 'neutral', 3200);
}

void fetchDaily().then((d) => {
  if (!d) return;
  today = d;
  updateBrief({ daily: dailyBrief(d) });
});
void fetchInit().then((init) => {
  if (!init) return;
  const profile = init.profile;
  hud.setBriefCommunity(init.community);
  if (profile?.lastRun && !ladderLast) ladderLast = profile.lastRun;
  const savedAgent = !pickedThisVisit ? profile?.agent : null;
  if (savedAgent) agent = savedAgent;
  const savedLook = !pickedLookThisVisit ? profile?.look : null;
  const savedStyle = !pickedLookThisVisit && profile ? { suit: profile.suit ?? style.suit, hair: profile.hair ?? style.hair } : null;
  if (savedLook) look = savedLook;
  if (savedStyle) style = savedStyle;
  if (savedLook || savedStyle) refreshPortraits();
  // Their controls follow them between devices: the account's win, and ones set on this browser before the account knew are sent up.
  if (profile?.controls) {
    applyControls(profile.controls);
    try {
      window.localStorage.setItem(CONTROLS_KEY, JSON.stringify(profile.controls));
    } catch {
      // Storage blocked: they hold for this visit.
    }
  } else if (profile && isCustom(controlSettings)) void saveProfile({ controls: controlSettings });
  // The stealth lesson follows them between devices: the account's word sets this browser, and this browser's is told to the account.
  if (profile?.stealthTrained) {
    try {
      window.localStorage.setItem(TRAINED_STEALTH_KEY, '1');
    } catch {
      // Storage blocked: it holds for this visit.
    }
  } else if (profile && stealthTrained()) void saveProfile({ stealthTrained: true });
  // The account's choice at the final level wins; one made on this browser before the account knew is told to it.
  if (profile?.ending) ending = profile.ending;
  else if (profile && ending) void saveProfile({ ending });
  streakKnown = init.streak;
  username = init.username;
  ladderJob = continueJob(init.best?.bestJob, localBestJob()) ?? ladderJob;
  updateBrief({
    ...(today ? { daily: dailyBrief(today) } : {}),
    ...(savedAgent ? { agent: savedAgent } : {}),
    ...(savedLook ? { look: savedLook } : {}),
    ...(savedStyle ? { style: savedStyle } : {}),
    ...(profile?.trained || trained ? { trained: true } : {}),
    continueJob: continueJob(init.best?.bestJob, localBestJob()),
  });
  // This browser finished training before the account knew: tell it.
  if (profile && trained && !profile.trained) void saveProfile({ trained: true });
});
refreshPortraits();
refreshFileLink();
