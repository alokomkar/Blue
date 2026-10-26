// Security doors: a frame spanning the corridor at a locked passage
// (security.ts), with two steel panels that telescope into the frame when
// the matching server's grid comes online. While locked the door is a real
// WallBox — it stops the player, blocks bot line of sight, and stops the
// torch's fog reveal from leaking into the sealed section. Bots are kept out
// separately, via the nav grid (security.ts's setPassage), since they path
// on cells rather than colliding with walls.

import * as THREE from 'three';
import { CELL, WALL_H, WALL_T, type WallBox } from './scene';
import { markBloom } from './postfx';
import { DIR_DELTA, type Door } from './security';

const OPEN_S = 1.1;
const PANEL_H = 2.55;
const PANEL_T = 0.12;
const BOX_HALF_T = 0.18;
const LOCKED_LIGHT = 0xff3b3b;
const OPEN_LIGHT = 0x4ee08a;

export type DoorRig = {
  door: Door;
  group: THREE.Group;
  /** Floor-local (zero-origin) collider while locked. */
  box: WallBox;
  /** Floor-local centre of the doorway, for proximity checks. */
  center: { x: number; z: number };
  isOpen: () => boolean;
  /** Starts the opening animation; the caller removes `box` from collision and reopens the nav passage. */
  open: () => void;
  /** Slides it shut again (training's gates close behind you); the caller restores `box` and closes the nav passage. */
  close: () => void;
  update: (dt: number) => void;
};

/** How a door differs from a security door: a narrower one in a room's doorway (no frame of its own), quicker, with its own colours for the light. */
export type DoorStyle = { span?: number; frame?: boolean; openS?: number; closedLight?: number; openLight?: number };

export function buildDoor(door: Door, keyColor: number, style: DoorStyle = {}): DoorRig {
  const frame = style.frame !== false;
  const openS = style.openS ?? OPEN_S;
  const closedLight = style.closedLight ?? LOCKED_LIGHT;
  const openLight = style.openLight ?? OPEN_LIGHT;
  const [dx, dz] = DIR_DELTA[door.dir];
  const center = { x: door.x * CELL + (dx * CELL) / 2, z: door.y * CELL + (dz * CELL) / 2 };
  const alongX = dz !== 0; // a N/S passage has its door spanning X
  const span = style.span ?? CELL - WALL_T;

  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  if (!alongX) group.rotation.y = Math.PI / 2; // build spanning local X, rotate for E/W passages

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.5, metalness: 0.4 });
  if (frame) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, WALL_H, 0.4), frameMat);
      post.position.set(side * (span / 2 - 0.05), WALL_H / 2, 0);
      group.add(post);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(span, 0.38, 0.4), frameMat);
    header.position.y = WALL_H - 0.19;
    group.add(header);
  }

  const lightMat = new THREE.MeshStandardMaterial({ color: closedLight, emissive: closedLight, emissiveIntensity: 2.4 });
  for (const face of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.03), lightMat);
    light.position.set(0, frame ? WALL_H - 0.19 : WALL_H - 0.3, face * (frame ? 0.21 : 0.2));
    markBloom(light);
    group.add(light);
  }

  const panelMat = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.45, metalness: 0.55 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: keyColor, emissive: keyColor, emissiveIntensity: 1.3 });
  const panelW = span / 2 - 0.1;
  const panels: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const panel = new THREE.Group();
    panel.position.x = (side * panelW) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(panelW, PANEL_H, PANEL_T), panelMat);
    slab.position.y = PANEL_H / 2;
    panel.add(slab);
    for (const face of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(panelW * 0.8, 0.12, 0.02), stripeMat);
      stripe.position.set(0, 1.3, face * (PANEL_T / 2 + 0.01));
      markBloom(stripe);
      panel.add(stripe);
    }
    group.add(panel);
    panels.push(panel);
  }

  const hx = alongX ? span / 2 : BOX_HALF_T;
  const hz = alongX ? BOX_HALF_T : span / 2;
  const box: WallBox = { minX: center.x - hx, maxX: center.x + hx, minZ: center.z - hz, maxZ: center.z + hz };

  let opening = false;
  let t = 0;
  return {
    door,
    group,
    box,
    center,
    isOpen: () => opening,
    open() {
      if (opening) return;
      opening = true;
      lightMat.color.setHex(openLight);
      lightMat.emissive.setHex(openLight);
    },
    close() {
      if (!opening) return;
      opening = false;
      lightMat.color.setHex(closedLight);
      lightMat.emissive.setHex(closedLight);
    },
    update(dt: number) {
      if (t === (opening ? 1 : 0)) return;
      t = opening ? Math.min(1, t + dt / openS) : Math.max(0, t - dt / openS);
      const e = t * t * (3 - 2 * t);
      panels.forEach((p, i) => {
        const side = i === 0 ? -1 : 1;
        // Slide outward while collapsing into the frame posts.
        p.scale.x = Math.max(0.04, 1 - e);
        p.position.x = side * (panelW / 2 + (e * panelW) / 2);
      });
    },
  };
}
