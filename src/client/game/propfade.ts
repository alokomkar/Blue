// Things that stand between the camera and the agent without being part of the floor's own walls (the tower's passage walls, office doors and lift cabs): they ghost out like a
// wall does (wallfade.ts) while they are in the way, on see-through copies of their materials, and come back after.

import * as THREE from 'three';
import type { Box3, Vec3 } from './wallfade';

/** The two functions of wallfade.ts it runs on, handed in (so this file can be tested under Node on its own). */
export type FadeMath = {
  blocking: (camera: Vec3, samples: readonly Vec3[], boxes: readonly Box3[]) => boolean[];
  stepFade: (fade: number, goal: number, dt: number) => number;
};

/** How far a prop goes at most: 1 would be gone, this leaves about a third solid (as the walls'). */
const FADE_TO = 0.68;

export type FadeProp = { objects: THREE.Object3D[]; box: Box3 };

type Entry = {
  prop: FadeProp;
  fade: number;
  /** The meshes of the objects and the material each has, until it is first faded (then they swap to ghosts and back). */
  meshes: Array<{ mesh: THREE.Mesh; solid: THREE.Material | THREE.Material[]; ghost: THREE.Material | THREE.Material[] | null }>;
};

const ghostOf = (m: THREE.Material): THREE.Material => {
  const g = m.clone();
  g.transparent = true;
  return g;
};

export class PropFader {
  private readonly entries: Entry[] = [];

  private readonly math: FadeMath;

  constructor(math: FadeMath) {
    this.math = math;
  }

  add(prop: FadeProp): void {
    const meshes: Entry['meshes'] = [];
    for (const o of prop.objects) o.traverse((c) => c instanceof THREE.Mesh && meshes.push({ mesh: c, solid: c.material, ghost: null }));
    this.entries.push({ prop, fade: 0, meshes });
  }

  get count(): number {
    return this.entries.length;
  }

  /** One frame: `camera` and `seen` (the parts of the agent that must be in view) in the floor's local frame; with `seen` null (another floor, a fly-over) everything comes back. */
  update(camera: Vec3, seen: readonly Vec3[] | null, dt: number): void {
    const inTheWay = seen ? this.math.blocking(camera, seen, this.entries.map((e) => e.prop.box)) : null;
    this.entries.forEach((e, i) => {
      const goal = inTheWay?.[i] ? 1 : 0;
      if (e.fade === goal && goal === 0) return;
      e.fade = this.math.stepFade(e.fade, goal, dt);
      for (const m of e.meshes) {
        if (e.fade > 0) {
          if (!m.ghost) m.ghost = Array.isArray(m.solid) ? m.solid.map(ghostOf) : ghostOf(m.solid);
          for (const g of Array.isArray(m.ghost) ? m.ghost : [m.ghost]) {
            g.opacity = 1 - FADE_TO * e.fade;
            g.depthWrite = e.fade < 0.35;
          }
          m.mesh.material = m.ghost;
        } else m.mesh.material = m.solid;
      }
    });
  }
}
