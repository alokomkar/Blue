// Walls between the camera and the agent: the chase camera sits above and behind, so a wall the agent hugs (or the corner they just turned) can stand right across the view. Those walls
// fade to a ghost while they're in the way. Pure geometry: whether the line from the camera to the agent passes through a wall, and how the fade eases.

export type Box3 = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export type Vec3 = { x: number; y: number; z: number };

/** Whether the segment `a`→`b` passes through the box (the slab method). */
export function segmentHitsBox(a: Vec3, b: Vec3, box: Box3): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: Array<[number, number, number, number]> = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let near = (lo - o) / d;
    let far = (hi - o) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

/** A wall `x`, `z` with its length, drawn as the box that stands in the view: widened a little so a wall the line only grazes goes too, and as tall as the wall. */
export function wallBox(x: number, z: number, len: number, horizontal: boolean, thick: number, height: number, margin: number): Box3 {
  const hx = (horizontal ? len : thick) / 2 + margin;
  const hz = (horizontal ? thick : len) / 2 + margin;
  return { minX: x - hx, maxX: x + hx, minY: 0, maxY: height, minZ: z - hz, maxZ: z + hz };
}

/** Where on the agent the view has to reach for them to count as seen: feet, hips, chest and head, and a hand's width either side of the chest (across the line of sight), standing at (x, y, z). */
export function bodySamples(camera: Vec3, base: Vec3): Vec3[] {
  const dx = base.x - camera.x;
  const dz = base.z - camera.z;
  const len = Math.hypot(dx, dz) || 1;
  const sx = (-dz / len) * 0.28;
  const sz = (dx / len) * 0.28;
  return [
    { x: base.x, y: base.y + 0.15, z: base.z },
    { x: base.x, y: base.y + 0.6, z: base.z },
    { x: base.x, y: base.y + 1.1, z: base.z },
    { x: base.x, y: base.y + 1.65, z: base.z },
    { x: base.x + sx, y: base.y + 1.1, z: base.z + sz },
    { x: base.x - sx, y: base.y + 1.1, z: base.z - sz },
  ];
}

/** Whether each wall box stands between the camera and any one of the sample points: the agent is only fully in view when none does. */
export function blocking(camera: Vec3, samples: readonly Vec3[], boxes: readonly Box3[]): boolean[] {
  return boxes.map((box) => samples.some((p) => segmentHitsBox(camera, p, box)));
}

/** How fast a wall fades out and back, per second (the fraction of the way it goes each second, roughly). */
export const FADE_RATE = 9;

/** `fade` (0 solid, 1 gone) eased toward `goal` over `dt`. */
export function stepFade(fade: number, goal: number, dt: number): number {
  const next = fade + (goal - fade) * Math.min(1, dt * FADE_RATE);
  return Math.abs(next - goal) < 0.01 ? goal : next;
}

/**
 * How much a wall on the camera's side of the agent fades (0 solid, 1 fully faded) from where it stands: by its nearest point's distance from them (all the way within `near`, none at `radius`, a smooth
 * ramp between) and how far it is toward the camera from a line across them (`side`, metres: a wall only just on the camera's side, or off to the side of them, fades little). So the walls open up as the
 * agent walks toward them, and close again as they walk away, not all at once.
 */
export function behindFade(distance: number, side: number, near: number, radius: number): number {
  const ramp = Math.min(1, Math.max(0, (radius - distance) / Math.max(0.01, radius - near)));
  const sideK = Math.min(1, Math.max(0, (side - 0.5) / 2.5));
  const k = ramp * sideK;
  return k * k * (3 - 2 * k);
}
