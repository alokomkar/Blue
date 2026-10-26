// Climbing a maze wall and lying flat on top of it. A dash (sprint) that ends against a wall is a wall run, as on a warped wall: the agent leaps, plants one foot and then the other flat on the
// face (the legs are placed by IK, so the feet don't slide), the body going up with each step, the arms stretched up for the top edge; the hands catch it and the library's ledge clip pulls the agent
// over; then they go onto their belly and lie along the wall, never standing on it. To leave, they roll off the edge and drop to a crouch. Pure geometry and timing, so it is unit-tested under Node; game.ts and player.ts play it.
//
// Measured on the clips (Universal Animation Library 1, on the agent rig): in the climb pose the hands reach 1.0 m above the pelvis and the pelvis stands 0.85 m above the root, so the hands are
// 1.85 m up from the root; a hand moves about 0.65 m per cycle of Climb_Up_Loop (1.27 s); the hands are 0.26 m in front of the pelvis.

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number; high?: boolean; top?: number; toLevel?: number; single?: boolean; /** A cargo container: its roof is this high, and one can be climbed onto and walked on, not lain along. */ roof?: number };

/** How near a wall's face the agent has to be, and how far off square to it they can face, for a dash into it to climb. */
export const CONTACT_REACH = 0.85;
export const CONTACT_OFF_ANGLE = 0.6;
/** A wall too short to lie along (the agent is 1.8 m long, lying) can't be climbed; nor can a thick block. */
export const MIN_WALL_LEN = 1.6;
export const MAX_WALL_THICK = 0.6;
/** How far the dash has to run, in metres, before the wall: "some distance". */
export const MIN_RUN_UP = 1.8;

export type WallContact = {
  /** Where the line from the agent meets the wall's face. */
  hit: { x: number; z: number };
  /** The face's outward normal (toward the agent). */
  nx: number;
  nz: number;
  /** The axis the wall runs along: a face with a z-normal belongs to a wall that runs along x. */
  run: 'x' | 'z';
  /** The wall's centre line (the coordinate across it) and its extent along the run axis. */
  centre: number;
  lo: number;
  hi: number;
  thick: number;
  /** A tall wall: a dash up it ends hanging from its shelf (highwall.ts). */
  high: boolean;
  /** A container: the height of its roof, which the climb ends standing on. */
  roof?: number;
};

/** The wall the agent at (x, z), facing `facing` (0 = +z, toward +x), is up against: the nearest of `boxes` met within `reach`, if it's square enough on, long enough and thin enough. */
export function wallContact(boxes: readonly Box[], x: number, z: number, facing: number, reach = CONTACT_REACH, off = CONTACT_OFF_ANGLE): WallContact | null {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  let best: { t: number; box: Box; axis: 'x' | 'z' } | null = null;
  for (const box of boxes) {
    let t0 = 0;
    let t1 = reach;
    let axis: 'x' | 'z' | null = null;
    let ok = true;
    for (const [o, d, lo, hi, a] of [[x, dx, box.minX, box.maxX, 'x'], [z, dz, box.minZ, box.maxZ, 'z']] as const) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) ok = false;
        continue;
      }
      let near = (lo - o) / d;
      let far = (hi - o) / d;
      if (near > far) [near, far] = [far, near];
      if (near > t0) {
        t0 = near;
        axis = a;
      }
      t1 = Math.min(t1, far);
      if (t0 > t1) ok = false;
    }
    if (!ok || axis === null) continue; // starting inside the box, or no face met in reach
    if (!best || t0 < best.t) best = { t: t0, box, axis };
  }
  if (!best) return null;
  const { box, axis } = best;
  // The face met is the one across `axis`; the normal points back at the agent.
  const nx = axis === 'x' ? -Math.sign(dx) : 0;
  const nz = axis === 'z' ? -Math.sign(dz) : 0;
  const run: 'x' | 'z' = axis === 'x' ? 'z' : 'x';
  const thick = axis === 'x' ? box.maxX - box.minX : box.maxZ - box.minZ;
  const lo = run === 'x' ? box.minX : box.minZ;
  const hi = run === 'x' ? box.maxX : box.maxZ;
  if (box.roof === undefined && (thick > MAX_WALL_THICK || hi - lo < MIN_WALL_LEN)) return null;
  // Square enough on: the facing against the way straight at the face.
  if (dx * -nx + dz * -nz < Math.cos(off)) return null;
  if (box.roof !== undefined) {
    // A container is a block, not a wall: the climb goes up its face to the near edge of the roof (a thin line just inside it), and the agent stands up there.
    const face = axis === 'x' ? (nx < 0 ? box.minX : box.maxX) : nz < 0 ? box.minZ : box.maxZ;
    const inside = face - (axis === 'x' ? nx : nz) * 0.1;
    return { hit: { x: x + dx * best.t, z: z + dz * best.t }, nx, nz, run, centre: inside, lo, hi, thick: 0.2, high: false, roof: box.roof };
  }
  const centre = axis === 'x' ? (box.minX + box.maxX) / 2 : (box.minZ + box.maxZ) / 2;
  return { hit: { x: x + dx * best.t, z: z + dz * best.t }, nx, nz, run, centre, lo, hi, thick, high: box.high === true };
}

/** The point on the wall's top line (its centre line) a climb at `along` (the coordinate along the run axis) comes up over, kept clear of the wall's ends so the whole body fits. */
export function topPoint(c: WallContact, along: number): { x: number; z: number; along: number } {
  const a = Math.min(c.hi - 0.9, Math.max(c.lo + 0.9, along));
  return c.run === 'x' ? { x: a, z: c.centre, along: a } : { x: c.centre, z: a, along: a };
}

/** Where the agent stands to climb: against the face, `standoff` from it, at the climb's along coordinate. */
export function faceStand(c: WallContact, along: number, standoff: number): { x: number; z: number } {
  const p = topPoint(c, along);
  const off = c.thick / 2 + standoff;
  return { x: p.x + c.nx * off, z: p.z + c.nz * off };
}

// ---- timing ----

export const CLIMB = {
  /** The run up the face: two foot plants and the body rising, the arms stretching for the top edge, in this many seconds. */
  popS: 0.5,
  /** Where the feet go on the face, metres up from the floor: the first (right) foot low, the second (left) a good way higher. */
  stepRightH: 0.9,
  stepLeftH: 1.4,
  /** The pull over the edge: ClimbLedge's first 0.2 s (after that the clip stands up, which a wall top won't allow). */
  ledgeS: 0.15,
  /** Then the cross-fade into the all-fours-to-flat half of Crawl_Enter, the body turning along the wall. */
  mountS: 1.05,
  /** The root (feet) to the hands in the climb pose, metres. */
  handsAboveRoot: 1.85,
  /** How far the pelvis stands from the wall's face while climbing, and how far back the agent is when the dash stops. */
  standoff: 0.25,
  startOff: 0.5,
  /** In the run, the hips hang this far off the face (feet on it, body leaning back from it), coming in to the standoff as the hands take the edge. */
  popOff: 0.42,
} as const;

/** The clips' lengths in seconds (Universal Animation Library 1). */
export const CLIP_S = { Climb_Up_Loop: 1.27, ClimbLedge: 0.63, Crawl_Enter: 2.13, NinjaJump_Idle_Loop: 1 } as const;

/** How far the root has to rise before the hands reach the wall top: the wall's top, less the hands' reach. */
export function riseNeeded(topAbove: number): number {
  return Math.max(0, topAbove - CLIMB.handsAboveRoot);
}

export function climbSeconds(): number {
  return CLIMB.popS + CLIMB.ledgeS + CLIMB.mountS;
}

export type Step = { h: number; w: number };
export type Layer = { clip: keyof typeof CLIP_S; time: number; weight: number };
export type WallPose = {
  phase: 'pop' | 'mount' | 'done';
  layers: Layer[];
  /** How far the root has risen off the floor (m), and how far it stands from the wall's face (m). */
  rise: number;
  off: number;
  /** 0 facing the wall, 1 turned along it. */
  turn: number;
  /** How far the hands have gone from where the clip has them to the top edge (0 not at all, 1 on it), by IK. */
  reachW: number;
  /** Each foot's height on the face (m up from the floor) and how far it is planted there (0 where the clip has it, 1 on the wall), by IK. */
  steps: { right: Step; left: Step };
  /** In the mount: how far the pin has moved from the hands (0) to the hips on the wall's centre line (1). */
  settle: number;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const NO_STEPS = { right: { h: CLIMB.stepRightH, w: 0 }, left: { h: CLIMB.stepLeftH, w: 0 } } as const;

/** The climb `t` seconds in, for a wall needing `rise` metres of climbing: the clips to show (times and weights, summing to 1), and where the body is. */
export function poseAt(t: number, rise: number): WallPose {
  const jump: Layer = { clip: 'NinjaJump_Idle_Loop', time: 0.2, weight: 1 };
  const planted = (k: number): { right: Step; left: Step } => ({
    // The right foot goes on the face first and comes off as the left takes the weight; the left stays on to the top.
    right: { h: CLIMB.stepRightH, w: smooth(0.1, 0.3, k) * (1 - smooth(0.62, 0.76, k)) },
    left: { h: CLIMB.stepLeftH, w: smooth(0.46, 0.62, k) },
  });
  if (t < CLIMB.popS) {
    const k = t / CLIMB.popS;
    return { phase: 'pop', layers: [jump], rise: rise * smooth(0.08, 1, k), off: CLIMB.startOff + (CLIMB.popOff - CLIMB.startOff) * clamp01(k * 4), turn: 0, reachW: smooth(0.25, 0.75, k), steps: planted(k), settle: 0 };
  }
  const tm = t - CLIMB.popS;
  const total = CLIMB.ledgeS + CLIMB.mountS;
  if (tm >= total) {
    return { phase: 'done', layers: [{ clip: 'Crawl_Enter', time: CLIP_S.Crawl_Enter * 0.999, weight: 1 }], rise, off: CLIMB.standoff, turn: 1, reachW: 0, steps: NO_STEPS, settle: 1 };
  }
  if (tm < CLIMB.ledgeS) {
    // The hands have the edge: the leap's last pose gives way to the ledge clip's first (the hands are in the same place in both), the feet coming off the face.
    const w = clamp01(tm / 0.1);
    const layers: Layer[] = [{ clip: 'ClimbLedge', time: tm, weight: w }];
    if (w < 1) layers.unshift({ ...jump, weight: 1 - w });
    return { phase: 'mount', layers, rise, off: CLIMB.popOff + (CLIMB.standoff - CLIMB.popOff) * smooth(0, CLIMB.ledgeS, tm), turn: 0, reachW: 1 - w, steps: { right: { h: CLIMB.stepRightH, w: 0 }, left: { h: CLIMB.stepLeftH, w: 1 - w } }, settle: 0 };
  }
  const m = tm - CLIMB.ledgeS;
  // (The mount's beats were timed for 1.5 s; `f` squeezes them into whatever mountS is now.)
  const f = CLIMB.mountS / 1.5;
  const k = clamp01(m / (0.35 * f));
  const crawl = Math.min(CLIP_S.Crawl_Enter * 0.999, 0.7 + m * ((CLIP_S.Crawl_Enter * 0.999 - 0.7) / CLIMB.mountS));
  const layers: Layer[] = [{ clip: 'Crawl_Enter', time: crawl, weight: k }];
  if (k < 1) layers.unshift({ clip: 'ClimbLedge', time: CLIMB.ledgeS, weight: 1 - k });
  return { phase: 'mount', layers, rise, off: CLIMB.standoff, turn: clamp01((m - 0.15 * f) / (0.8 * f)), reachW: 0, steps: NO_STEPS, settle: clamp01((m - 0.55 * f) / (0.7 * f)) };
}

/** Which way along the wall the agent ends up facing: toward the side the player pushed (`side` -1 or 1, 0 for none), else toward the open end (the longer way from `along`). */
export function lieDirection(c: WallContact, along: number, side: number): 1 | -1 {
  if (side !== 0) return side > 0 ? 1 : -1;
  return c.hi - along >= along - c.lo ? 1 : -1;
}

/** The angle (0 = +z) of facing along the wall's run axis in `dir`. */
export function runAngle(c: WallContact, dir: 1 | -1): number {
  return c.run === 'x' ? Math.atan2(dir, 0) : Math.atan2(0, dir);
}

/** The angle of facing straight at the wall's face. */
export function faceAngle(c: WallContact): number {
  return Math.atan2(-c.nx, -c.nz);
}

/** The two floor points either side of a wall that a roll off its top can land on: `reach` out from the centre line, along the wall's normal. First the side that was climbed. */
export function rollSides(c: WallContact, along: number, reach: number): Array<{ x: number; z: number; nx: number; nz: number }> {
  const p = topPoint(c, along);
  const d = c.thick / 2 + reach;
  return [
    { x: p.x + c.nx * d, z: p.z + c.nz * d, nx: c.nx, nz: c.nz },
    { x: p.x - c.nx * d, z: p.z - c.nz * d, nx: -c.nx, nz: -c.nz },
  ];
}
