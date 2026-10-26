// A storage-room locker: an open-front steel cabinet with a hinged door
// (vent slots, handle, number plate, a status LED) and its contents on a
// shelf inside. Opening swings the door out about 110° and it stays open —
// there's no way to close it again. Documents and loot are taken once the
// door has swung; a rigged charge stays behind, blinking. The LED lights in
// a grid's key colour when powering that grid marks this as the locker
// holding the document.
//
// Local frame: the front faces +Z, the hinge is on the left (-X) edge.

import * as THREE from 'three';
import { markBloom } from './postfx';
import type { LockerContent } from './decisions';

export const LOCKER_W = 0.62;
export const LOCKER_D = 0.5;
const H = 1.9;
const T = 0.03;
const SWING = 1.9; // radians — about 110°
const SWING_S = 0.6;
const STEEL = 0x6f7a86;
const PAGE = 0xf0e6c8;

export type LockerRig = {
  group: THREE.Group;
  content: LockerContent;
  isOpen: () => boolean;
  /** Swings the door open; it never closes again. */
  open: () => void;
  /** Lights the status LED — the grid has identified this as the document locker. */
  setMarked: (color: number) => void;
  /** A rigged locker's fuse: whole seconds left, shown on a red readout over the locker; null hides it. */
  setCountdown: (seconds: number | null) => void;
  update: (dt: number, t: number) => void;
};

/** The fuse readout: red digits on a dark panel, drawn to a canvas each time the second changes. */
function drawFuse(ctx: CanvasRenderingContext2D, seconds: number): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(24, 4, 4, 0.9)';
  ctx.fillRect(4, 4, w - 8, h - 8);
  ctx.strokeStyle = '#ff4a4a';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#ff5a4a';
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`0:${String(Math.max(0, seconds)).padStart(2, '0')}`, w / 2, h / 2 + 2);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d2c0';
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#1c1f24';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n).padStart(2, '0'), 32, 17);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLocker(content: LockerContent, number: number): LockerRig {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.7 });

  // Cabinet: back, sides, top, bottom — open at the front.
  const zBack = -LOCKER_D / 2 + T / 2;
  group.add(box(LOCKER_W, H, T, steel, 0, H / 2, zBack));
  for (const side of [-1, 1]) group.add(box(T, H, LOCKER_D, steel, side * (LOCKER_W / 2 - T / 2), H / 2, 0));
  group.add(box(LOCKER_W, T, LOCKER_D, steel, 0, H - T / 2, 0));
  group.add(box(LOCKER_W, 0.08, LOCKER_D, dark, 0, 0.04, 0));
  // Dark interior lining so the contents read against it once open.
  group.add(box(LOCKER_W - 2 * T - 0.01, H - 0.12, 0.01, dark, 0, H / 2, zBack + T));
  const shelfY = 1.05;
  group.add(box(LOCKER_W - 2 * T, 0.025, LOCKER_D - T, steel, 0, shelfY, 0));

  // Contents on the shelf.
  const contents = new THREE.Group();
  contents.position.set(0, shelfY + 0.0125, -0.02);
  let blink: THREE.MeshStandardMaterial | null = null;
  if (content === 'document') {
    const mat = new THREE.MeshStandardMaterial({ color: PAGE, emissive: PAGE, emissiveIntensity: 1.1, roughness: 0.5 });
    const folder = box(0.3, 0.02, 0.24, mat, 0, 0.02, 0);
    folder.rotation.y = 0.15;
    markBloom(folder);
    contents.add(folder);
  } else if (content === 'loot') {
    const cash = new THREE.MeshStandardMaterial({ color: 0x4f8a4a, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a93a, roughness: 0.3, metalness: 0.9 });
    contents.add(box(0.22, 0.08, 0.14, cash, -0.1, 0.04, 0.02), box(0.22, 0.06, 0.14, cash, -0.08, 0.11, 0));
    contents.add(box(0.14, 0.06, 0.08, gold, 0.14, 0.03, 0.04));
  } else {
    contents.add(box(0.2, 0.12, 0.14, dark, 0, 0.06, 0));
    blink = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0 });
    const led = box(0.04, 0.03, 0.02, blink, 0.05, 0.13, 0.07);
    markBloom(led);
    contents.add(led);
  }
  group.add(contents);

  // Door on a hinge pivot at the left front edge.
  const hinge = new THREE.Group();
  hinge.position.set(-LOCKER_W / 2, 0, LOCKER_D / 2);
  const doorW = LOCKER_W - 0.01;
  const door = box(doorW, H - 0.1, 0.025, steel, doorW / 2, H / 2, 0);
  hinge.add(door);
  for (let i = 0; i < 4; i++) hinge.add(box(doorW * 0.55, 0.018, 0.012, dark, doorW / 2, H - 0.28 - i * 0.07, 0.016));
  for (let i = 0; i < 3; i++) hinge.add(box(doorW * 0.55, 0.018, 0.012, dark, doorW / 2, 0.3 + i * 0.07, 0.016));
  hinge.add(box(0.03, 0.2, 0.04, dark, doorW - 0.07, H / 2, 0.03));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ map: numberTexture(number), roughness: 0.6 }));
  plate.position.set(doorW / 2, H - 0.55, 0.014);
  hinge.add(plate);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x20242a, emissive: 0x000000, roughness: 0.4 });
  const led = box(0.05, 0.05, 0.02, ledMat, doorW - 0.1, H - 0.3, 0.02);
  markBloom(led);
  hinge.add(led);
  group.add(hinge);

  let opening = false;
  let swing = 0;
  let fuse: { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null = null;
  let fuseLeft = Infinity;
  return {
    group,
    content,
    isOpen: () => opening,
    open() {
      opening = true;
    },
    setMarked(color: number) {
      ledMat.color.setHex(color);
      ledMat.emissive.setHex(color);
      ledMat.emissiveIntensity = 2.2;
    },
    setCountdown(seconds: number | null) {
      if (seconds === null) {
        if (fuse) fuse.sprite.visible = false;
        fuseLeft = Infinity;
        return;
      }
      if (!fuse) {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 72;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sprite.scale.set(0.8, 0.36, 1);
        sprite.position.set(0, H + 0.4, LOCKER_D / 2);
        group.add(sprite);
        fuse = { sprite, ctx: canvas.getContext('2d')!, tex };
      }
      fuse.sprite.visible = true;
      drawFuse(fuse.ctx, seconds);
      fuse.tex.needsUpdate = true;
      fuseLeft = seconds;
    },
    update(dt: number, t: number) {
      if (opening && swing < 1) {
        swing = Math.min(1, swing + dt / SWING_S);
        const e = 1 - Math.pow(1 - swing, 3);
        hinge.rotation.y = -SWING * e;
        if (swing >= 1 && content !== 'rigged') contents.visible = false;
      }
      // The charge blinks faster as the fuse runs down.
      if (blink && opening) blink.emissiveIntensity = Math.sin(t * (fuseLeft <= 3 ? 34 : 12)) > 0 ? 3 : 0.2;
    },
  };
}
