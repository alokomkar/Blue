// A chain-link fence: the boundary of an open-air level (the dock yard) where a building has walls. Posts and rails with a diamond-mesh panel between them, all
// primitives and one canvas texture shared by every panel. You can see through it (the floor's wall box for it is marked `see`, detection.ts), but not walk through it.

import * as THREE from 'three';

const HEIGHT = 2.7;
const POST_GAP = 2.0;

export type Fence = {
  /** Puts the fence along the segment from (x1, z1) to (x2, z2) in `parent`'s frame. */
  add: (parent: THREE.Object3D, x1: number, z1: number, x2: number, z2: number) => void;
};

function meshTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(205,215,225,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(0, 64);
  g.lineTo(64, 0);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildFence(): Fence {
  const tex = meshTexture();
  const panelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x59636c, roughness: 0.5, metalness: 0.6 });
  const postGeo = new THREE.BoxGeometry(0.12, HEIGHT + 0.25, 0.12);
  return {
    add(parent, x1, z1, x2, z2) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      const yaw = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2; // the panel's length runs along local X
      const group = new THREE.Group();
      group.position.set(mx, 0, mz);
      group.rotation.y = yaw;
      group.userData.structure = true;
      // The mesh, its two rails, and a post every couple of metres (the ends included: the next segment shares them).
      const panelGeo = new THREE.PlaneGeometry(len, HEIGHT);
      const panel = new THREE.Mesh(panelGeo, panelMat.clone());
      (panel.material as THREE.MeshBasicMaterial).map = tex.clone();
      (panel.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
      (panel.material as THREE.MeshBasicMaterial).map!.repeat.set(len / 0.5, HEIGHT / 0.5);
      panel.position.y = HEIGHT / 2;
      group.add(panel);
      for (const y of [0.08, HEIGHT - 0.02]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), steel);
        rail.position.y = y;
        group.add(rail);
      }
      const n = Math.max(1, Math.round(len / POST_GAP));
      for (let i = 0; i <= n; i++) {
        const post = new THREE.Mesh(postGeo, steel);
        post.position.set(-len / 2 + (len * i) / n, (HEIGHT + 0.25) / 2, 0);
        group.add(post);
      }
      parent.add(group);
    },
  };
}
