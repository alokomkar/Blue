// A clue system: the facilities terminal in a bunker room that knows where the dossier is (tasks/plan.md). A wall console, a cabinet with a keyboard shelf and a lit screen, built facing
// +Z at a spot on the floor like objstations.ts's props, with the same shape: its footprint, the spot the agent stands at to work it, and a state it shows (idle, ready, working, done).
// The screen says what it is doing in canvas text. Primitives only.

import * as THREE from 'three';
import type { WallBox } from './scene';
import { markBloom } from './postfx';
import type { StationPlacement, StationRig } from './objstations';

export type ClueState = 'idle' | 'ready' | 'working' | 'done';

export type ClueRig = Omit<StationRig, 'setState' | 'setScreen'> & {
  setState: (s: ClueState) => void;
  /** The lines on its screen. */
  setScreen: (lines: string[]) => void;
};

/** How far in front of the console (metres) the agent stands to work it. */
const FRONT_REACH = 1.15;

const STATE_COLOR: Record<ClueState, number> = { idle: 0xffb04a, ready: 0xffb04a, working: 0x4aa8ff, done: 0x4ee08a };

function screenTexture(lines: string[], fg: string): THREE.CanvasTexture {
  const w = 320;
  const h = 200;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04100c';
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.font = `bold ${i === 0 ? 30 : 24}px ui-monospace, Menlo, monospace`;
    g.fillText(line, w / 2, ((i + 1) * h) / (lines.length + 1));
  });
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildClueSystem(at: StationPlacement): ClueRig {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  group.rotation.y = at.facing;
  const mat = (color: number, rough = 0.5, metal = 0.5): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const steel = mat(0x3a4148);
  const dark = mat(0x12151a, 0.7, 0.3);
  // The cabinet, a keyboard shelf, and the screen on a hinge above it, tipped back a little.
  box(1.1, 1.0, 0.45, steel, 0, 0.5, 0);
  box(0.9, 0.05, 0.3, dark, 0, 1.03, 0.32);
  for (let i = 0; i < 3; i++) box(0.78, 0.012, 0.045, mat(0x6b7480, 0.4, 0.2), 0, 1.062, 0.24 + i * 0.07);
  box(1.0, 0.64, 0.1, dark, 0, 1.52, -0.05);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0xffffff, emissiveMap: screenTexture(['SITE', 'FACILITIES', 'LOGIN REQUIRED'], '#ffb04a'), emissiveIntensity: 1.3, roughness: 0.4 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.54), screenMat);
  screen.position.set(0, 1.52, 0.006);
  screen.rotation.x = -0.1;
  group.add(screen);
  markBloom(screen);
  // Vents, a status lamp, and a tag.
  for (let i = 0; i < 4; i++) box(0.5, 0.025, 0.02, dark, 0, 0.22 + i * 0.07, 0.232);
  const ledMat = new THREE.MeshStandardMaterial({ color: STATE_COLOR.idle, emissive: STATE_COLOR.idle, emissiveIntensity: 2 });
  const led = box(0.07, 0.07, 0.03, ledMat, 0.4, 1.0, 0.235);
  markBloom(led);
  const light = new THREE.PointLight(STATE_COLOR.idle, 1.4, 4);
  light.position.set(0, 1.6, 0.7);
  group.add(light);

  const sx = Math.abs(Math.cos(at.facing));
  const sz = Math.abs(Math.sin(at.facing));
  const hx = 0.55 * sx + 0.25 * sz;
  const hz = 0.55 * sz + 0.25 * sx;
  const boxes: WallBox[] = [{ minX: at.x - hx, maxX: at.x + hx, minZ: at.z - hz, maxZ: at.z + hz, cover: 'low' }];
  let state: ClueState = 'idle';
  let tint = '#ffb04a';
  return {
    group,
    boxes,
    at: { x: at.x, z: at.z },
    stand: { x: at.x + Math.sin(at.facing) * FRONT_REACH, z: at.z + Math.cos(at.facing) * FRONT_REACH },
    setState(s): void {
      state = s;
      tint = s === 'done' ? '#4ee08a' : s === 'working' ? '#6ab8ff' : '#ffb04a';
      ledMat.color.setHex(STATE_COLOR[s]);
      ledMat.emissive.setHex(STATE_COLOR[s]);
      light.color.setHex(STATE_COLOR[s]);
      if (s === 'idle' || s === 'ready') this.setScreen(['SITE', 'FACILITIES', 'LOGIN REQUIRED']);
      else if (s === 'done') this.setScreen(['ACCESS GRANTED', 'QUERY LOGGED']);
    },
    setScreen(lines): void {
      screenMat.emissiveMap?.dispose();
      screenMat.emissiveMap = screenTexture(lines, tint);
      screenMat.needsUpdate = true;
    },
    update(t): void {
      // idle blinks slowly, working quickly, done holds
      const on = state === 'done' ? 1 : Math.sin(t * (state === 'working' ? 14 : 3)) > 0 ? 1 : 0.25;
      ledMat.emissiveIntensity = 2 * on;
      light.intensity = state === 'done' ? 1.0 : state === 'working' ? 1.8 : 1.2;
    },
  };
}
