// The props the contracts' steps are worked at (objectives.ts): a cryo pod with a specimen in it, a charge point on a tank, the case an exhibit is swapped
// in, a vault console and the ledger behind it, a dispatch console with the manifest, and the four labelled containers. Each is built facing +Z at a
// spot on the floor, returned with its footprint, the spot the agent stands at to work it, and a state it can be put in (idle, ready for work, done,
// or wrong), so the level shows what has been done. Primitives and canvas text only.

import * as THREE from 'three';
import type { WallBox } from './scene';
import { markBloom } from './postfx';
import type { StepKind } from './objectives';

export type StationState = 'idle' | 'ready' | 'done' | 'wrong';

export type StationRig = {
  group: THREE.Group;
  /** Floor-local colliders. */
  boxes: WallBox[];
  /** Floor-local spot in front of it where the agent works it (and the point the task measures from). */
  stand: { x: number; z: number };
  /** Floor-local centre of the prop. */
  at: { x: number; z: number };
  setState: (s: StationState) => void;
  /** Once a frame, on the level's clock (blinks and pulses). */
  update: (t: number) => void;
  /** The text on a manifest console, for what the manifest says once read. */
  setScreen?: (text: string) => void;
};

/** A prop's place on the floor: its centre, and the heading its front faces (the way the agent stands; direction = (sin f, cos f)). */
export type StationPlacement = { x: number; z: number; facing: number };

const FRONT_REACH = 1.25;

const mat = (color: number, o: { rough?: number; metal?: number; glow?: number; alpha?: number } = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.2, emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0, transparent: o.alpha !== undefined, opacity: o.alpha ?? 1, depthWrite: o.alpha === undefined });

function textTexture(lines: string[], opts: { bg: string; fg: string; size: number; w?: number; h?: number }): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg;
  g.font = `bold ${opts.size}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, w / 2, ((i + 1) * h) / (lines.length + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CONTAINER_COLORS: Record<string, number> = { A: 0xa83a2a, B: 0x2a5f8a, C: 0xc08a2a, D: 0x3f7a4a };

export function buildStation(kind: StepKind, at: StationPlacement, o: { letter?: string } = {}): StationRig {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  group.rotation.y = at.facing;
  const part = (m: THREE.Object3D, x: number, y: number, z: number): void => {
    m.position.set(x, y, z);
    group.add(m);
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    part(mesh, x, y, z);
    return mesh;
  };
  const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 18): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
    part(mesh, x, y, z);
    return mesh;
  };
  /** The prop's footprint (half sizes along its own x and z) turned into a floor AABB. */
  const footprint = (hx: number, hz: number, cover: 'low' | 'tall'): WallBox => {
    const c = Math.abs(Math.cos(at.facing));
    const s = Math.abs(Math.sin(at.facing));
    const ax = hx * c + hz * s;
    const az = hx * s + hz * c;
    return { minX: at.x - ax, maxX: at.x + ax, minZ: at.z - az, maxZ: at.z + az, cover };
  };
  const stand = { x: at.x + Math.sin(at.facing) * FRONT_REACH, z: at.z + Math.cos(at.facing) * FRONT_REACH };
  const steel = mat(0x3a4148, { rough: 0.45, metal: 0.6 });
  const light = new THREE.PointLight(0xffffff, 0, 4.5);
  light.position.set(0, 1.8, 0.6);
  group.add(light);
  const glow = (color: number, intensity: number): void => {
    light.color.setHex(color);
    light.intensity = intensity;
  };
  let updateFn: (t: number) => void = () => {};
  let stateFn: (s: StationState) => void = () => {};
  let screenFn: ((text: string) => void) | undefined;
  let boxes: WallBox[] = [];

  switch (kind) {
    case 'cryo': {
      const fluidMat = mat(0x4ee0d0, { glow: 0.9, alpha: 0.5 });
      box(1.1, 0.2, 1.1, steel, 0, 0.1, 0);
      box(1.1, 0.14, 1.1, steel, 0, 2.18, 0);
      const fluid = cyl(0.42, 1.95, fluidMat, 0, 1.15, 0);
      markBloom(fluid);
      cyl(0.48, 1.95, mat(0xbfeaf0, { rough: 0.05, alpha: 0.28 }), 0, 1.15, 0);
      // The specimen in it: something pale and long, suspended.
      const specimen = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 8), mat(0xe8e0d0, { rough: 0.7 }));
      part(specimen, 0, 1.2, 0);
      const strip = box(0.5, 0.06, 0.04, mat(0x4ee0d0, { glow: 1.6 }), 0, 0.5, 0.58);
      markBloom(strip);
      box(0.1, 1.9, 0.1, steel, -0.5, 1.15, 0.5);
      box(0.1, 1.9, 0.1, steel, 0.5, 1.15, 0.5);
      boxes = [footprint(0.6, 0.6, 'tall')];
      glow(0x4ee0d0, 5);
      stateFn = (s) => {
        const empty = s === 'done';
        specimen.visible = !empty;
        fluidMat.emissiveIntensity = empty ? 0.12 : s === 'ready' ? 1.3 : 0.9;
        strip.material = mat(empty ? 0xe0564e : 0x4ee0d0, { glow: 1.6 });
        glow(empty ? 0xe0564e : 0x4ee0d0, empty ? 2 : 5);
      };
      updateFn = (t) => {
        specimen.position.y = 1.2 + Math.sin(t * 1.4) * 0.05;
      };
      break;
    }
    case 'charge': {
      // A steel junction plate on a pedestal, hazard-striped, where the pipe meets the tank; the charge goes on its face.
      box(1.3, 0.3, 0.7, steel, 0, 0.15, 0);
      box(1.1, 1.5, 0.3, steel, 0, 1.0, -0.05);
      for (let i = 0; i < 6; i++) box(0.18, 0.12, 0.02, mat(i % 2 ? 0x15181b : 0xd8b02a), -0.45 + i * 0.18, 1.6, 0.115);
      const flange = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 20), mat(0x6a7078, { rough: 0.4, metal: 0.7 }));
      part(flange, 0, 1.0, 0.13);
      const brick = box(0.6, 0.2, 0.3, mat(0x1a1d21, { rough: 0.8 }), 0, 1.0, 0.3);
      brick.visible = false;
      const ledMat = mat(0xff3b3b, { glow: 2.4 });
      const led = box(0.1, 0.06, 0.06, ledMat, 0.2, 1.12, 0.46);
      led.visible = false;
      markBloom(led);
      const lamp = box(0.14, 0.14, 0.04, mat(0xffb04a, { glow: 1.2 }), 0, 1.8, 0.12);
      markBloom(lamp);
      boxes = [footprint(0.7, 0.4, 'tall')];
      let planted = false;
      stateFn = (s) => {
        planted = s === 'done';
        brick.visible = planted;
        led.visible = planted;
        lamp.material = mat(planted ? 0xff3b3b : 0xffb04a, { glow: 1.2 });
        glow(planted ? 0xff3b3b : 0xffb04a, planted ? 3 : 2);
      };
      updateFn = (t) => {
        if (planted) ledMat.emissiveIntensity = Math.sin(t * 7) > 0 ? 2.6 : 0.1;
      };
      break;
    }
    case 'swapCase': {
      box(1.2, 0.85, 0.9, mat(0x2b2420, { rough: 0.6 }), 0, 0.425, 0);
      box(1.1, 0.75, 0.8, mat(0xaad4e0, { rough: 0.05, alpha: 0.22 }), 0, 1.22, 0);
      const relicMat = mat(0xd9b35a, { rough: 0.3, metal: 0.8, glow: 0.4 });
      const relic = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), relicMat);
      part(relic, 0, 1.2, 0);
      const lamp = box(0.9, 0.04, 0.5, mat(0xffe6b8, { glow: 1.5 }), 0, 1.66, 0);
      markBloom(lamp);
      boxes = [footprint(0.65, 0.5, 'low')];
      glow(0xffe6b8, 4);
      stateFn = (s) => {
        // Swapped: the forgery is a shade off, and the case lamp calms to green.
        relicMat.color.setHex(s === 'done' ? 0xc9c2b4 : 0xd9b35a);
        relicMat.emissiveIntensity = s === 'done' ? 0.05 : 0.4;
        lamp.material = mat(s === 'done' ? 0x6ef59a : 0xffe6b8, { glow: 1.5 });
      };
      break;
    }
    case 'vaultConsole': {
      box(0.7, 1.0, 0.55, steel, 0, 0.5, 0);
      const screenMat = mat(0xffb04a, { glow: 1.4 });
      const screen = box(0.55, 0.32, 0.03, screenMat, 0, 1.18, 0.0);
      screen.rotation.x = -0.4;
      markBloom(screen);
      box(0.3, 0.06, 0.04, mat(0x15181b), 0, 0.95, 0.29); // the card slot
      boxes = [footprint(0.4, 0.3, 'low')];
      glow(0xffb04a, 3);
      stateFn = (s) => {
        const c = s === 'done' ? 0x4ee08a : s === 'wrong' ? 0xe0564e : s === 'ready' ? 0xffb04a : 0x8a97a6;
        screen.material = mat(c, { glow: 1.4 });
        glow(c, 3);
      };
      break;
    }
    case 'ledger': {
      box(0.6, 1.0, 0.5, mat(0x3a4148, { rough: 0.5, metal: 0.5 }), 0, 0.5, 0);
      const stand = box(0.7, 0.05, 0.5, mat(0x5a4632, { rough: 0.6 }), 0, 1.06, 0);
      stand.rotation.x = -0.35;
      const book = box(0.5, 0.06, 0.34, mat(0xf2ecd8, { rough: 0.8, glow: 0.35 }), 0, 1.13, 0);
      book.rotation.x = -0.35;
      markBloom(book);
      boxes = [footprint(0.4, 0.3, 'low')];
      glow(0xf2ecd8, 2);
      stateFn = (s) => {
        book.visible = s !== 'done';
      };
      break;
    }
    case 'manifest': {
      box(1.0, 1.0, 0.5, steel, 0, 0.5, 0);
      const idle = textTexture(['DISPATCH', 'MANIFEST', 'LOCKED'], { bg: '#06100c', fg: '#4ee08a', size: 26 });
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0xffffff, emissiveMap: idle, emissiveIntensity: 1.2, roughness: 0.4 });
      const screen = box(0.8, 0.5, 0.03, screenMat, 0, 1.25, 0);
      screen.rotation.x = -0.3;
      markBloom(screen);
      boxes = [footprint(0.55, 0.3, 'low')];
      glow(0x4ee08a, 3);
      stateFn = (s) => {
        screenMat.emissiveIntensity = s === 'ready' ? 1.6 : 1.1;
      };
      screenFn = (text) => {
        screenMat.emissiveMap = textTexture(['MANIFEST', text], { bg: '#06100c', fg: '#ffd27a', size: 30 });
        screenMat.needsUpdate = true;
      };
      break;
    }
    case 'tracker': {
      const letter = o.letter ?? 'A';
      const body = mat(CONTAINER_COLORS[letter] ?? 0x6a6f74, { rough: 0.6, metal: 0.3 });
      box(1.9, 2.3, 1.1, body, 0, 1.15, 0);
      for (let r = -0.85; r <= 0.85; r += 0.17) box(0.04, 2.1, 1.14, mat(0x000000, { alpha: 0.2 }), r, 1.15, 0);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({ map: textTexture([letter], { bg: 'rgba(0,0,0,0)', fg: '#f4efe0', size: 120, w: 128, h: 128 }), transparent: true })
      );
      part(label, 0, 1.4, 0.56);
      const ledMat = mat(0xffb04a, { glow: 2 });
      const led = box(0.16, 0.16, 0.05, ledMat, 0.7, 2.0, 0.56);
      markBloom(led);
      boxes = [footprint(0.95, 0.55, 'tall')];
      glow(0xffb04a, 2);
      stateFn = (s) => {
        ledMat.color.setHex(s === 'done' ? 0x4ee08a : s === 'wrong' ? 0xff3b3b : 0xffb04a);
        ledMat.emissive.setHex(s === 'done' ? 0x4ee08a : s === 'wrong' ? 0xff3b3b : 0xffb04a);
      };
      break;
    }
    case 'keycard': {
      // A guard-desk card reader, for the floor with no guard to take a card from.
      box(0.9, 0.8, 0.5, steel, 0, 0.4, 0);
      const screen = box(0.3, 0.2, 0.03, mat(0xffb04a, { glow: 1.4 }), 0, 1.0, 0.1);
      markBloom(screen);
      boxes = [footprint(0.5, 0.3, 'low')];
      glow(0xffb04a, 2);
      break;
    }
  }

  return {
    group,
    boxes,
    stand,
    at: { x: at.x, z: at.z },
    setState: (s) => stateFn(s),
    update: (t) => updateFn(t),
    ...(screenFn ? { setScreen: screenFn } : {}),
  };
}

/**
 * Diamonds over what a contract points at (the guard carrying the keycard, the station to go to next): drawn over everything so they show through
 * walls, like the lookout's tags, in the contract's cyan.
 */
export class ObjectiveMarkers {
  private readonly sprites: THREE.Sprite[] = [];
  private readonly material: THREE.SpriteMaterial;

  constructor(private readonly scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.moveTo(32, 6);
    g.lineTo(54, 32);
    g.lineTo(32, 58);
    g.lineTo(10, 32);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(8, 10, 14, 0.85)';
    g.stroke();
    g.fillStyle = '#6ff5e6';
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  }

  /** Shows a marker at each of `at` (world), bobbing on the clock `t`; hides the rest. */
  update(at: Array<{ x: number; y: number; z: number }>, t: number): void {
    while (this.sprites.length < at.length) {
      const sprite = new THREE.Sprite(this.material.clone());
      sprite.scale.set(0.9, 0.9, 1);
      sprite.renderOrder = 10;
      this.scene.add(sprite);
      this.sprites.push(sprite);
    }
    this.sprites.forEach((sprite, i) => {
      const a = at[i];
      sprite.visible = a !== undefined;
      if (a) sprite.position.set(a.x, a.y + Math.sin(t * 4 + i) * 0.08, a.z);
    });
  }

  dispose(): void {
    for (const sprite of this.sprites) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.material.map?.dispose();
    this.material.dispose();
  }
}
