// A short "parts fly together" spawn effect for the ambush bot a rigged
// locker triggers — simple primitive shapes (not the full skinned rig,
// which doesn't decompose into moving pieces without real retargeting work)
// converge from scattered, elevated offsets into a rough humanoid
// silhouette, spinning down as they settle. Once assembled, the parts are
// removed and a real, functioning Bot is created in their place. An
// original tween, not code from any Three.js example — the geometries
// showcase (threejs.org/examples/#webgl_geometries) was just a starting
// point for "which primitives read as body parts," nothing more specific
// was reused from it.

import * as THREE from 'three';

const PART_COLOR = 0xb32c2c;
const DURATION_S = 1.1;

type Part = { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 };

export type AssemblyEffect = {
  /** Advance the effect; returns false once finished (onComplete already fired). */
  update: (dt: number) => boolean;
  dispose: () => void;
};

export function spawnAssemblyEffect(scene: THREE.Scene, worldX: number, worldZ: number, onComplete: () => void, floorY = 0): AssemblyEffect {
  const mat = new THREE.MeshStandardMaterial({ color: PART_COLOR, emissive: PART_COLOR, emissiveIntensity: 0.55, roughness: 0.6 });
  const parts: Part[] = [];

  function addPart(geo: THREE.BufferGeometry, toLocal: THREE.Vector3): void {
    const mesh = new THREE.Mesh(geo, mat);
    const from = new THREE.Vector3(worldX + (Math.random() - 0.5) * 4.5, floorY + 0.5 + Math.random() * 2.4, worldZ + (Math.random() - 0.5) * 4.5);
    mesh.position.copy(from);
    scene.add(mesh);
    parts.push({ mesh, from, to: new THREE.Vector3(worldX + toLocal.x, floorY + toLocal.y, worldZ + toLocal.z) });
  }

  addPart(new THREE.SphereGeometry(0.16, 10, 8), new THREE.Vector3(0, 1.55, 0)); // head
  addPart(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), new THREE.Vector3(0, 1.0, 0)); // torso
  addPart(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), new THREE.Vector3(-0.3, 1.1, 0)); // left arm
  addPart(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), new THREE.Vector3(0.3, 1.1, 0)); // right arm
  addPart(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), new THREE.Vector3(-0.14, 0.4, 0)); // left leg
  addPart(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), new THREE.Vector3(0.14, 0.4, 0)); // right leg

  let t = 0;
  let completed = false;

  function removeAll(): void {
    for (const part of parts) scene.remove(part.mesh);
  }

  return {
    update(dt: number): boolean {
      if (completed) return false;
      t += dt;
      const p = Math.min(1, t / DURATION_S);
      const eased = 1 - (1 - p) ** 3; // ease-out cubic
      for (const part of parts) {
        part.mesh.position.lerpVectors(part.from, part.to, eased);
        part.mesh.rotation.y = (1 - eased) * Math.PI * 2;
      }
      if (p >= 1) {
        completed = true;
        removeAll();
        onComplete();
        return false;
      }
      return true;
    },
    dispose: removeAll,
  };
}
