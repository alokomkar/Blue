// Rooms: dead-end pockets off corridors (security.ts decides where), each
// dressed as a small enclosed office space — a narrowed doorway (wall stubs
// + lintel) at its mouth and furniture against the back wall, rather than
// the old approach of dropping a desk in the middle of a corridor junction.
//
// Terminal rooms hold the laptop the player hacks; server rooms hold two
// racks and the power-grid console that, once its terminal is hacked, opens
// the matching security door (doors.ts). Storage rooms are records rooms:
// a workstation with the files the player photographs, lockers (lockers.ts)
// of loot or traps, and a sentry post outside the doorway. The uplink closet
// holds the network cabinet the player takes offline before capturing; the
// log room, the console where the access logs are wiped.
// Office/conference/cafeteria/rack rooms are decoration. Everything is built from primitives (this project has hit
// asset-licensing walls twice before — primitives stay the safe default).
//
// Each room is built in a local frame where +Z points out through the
// doorway and the back wall sits at z = -CELL/2, then rotated to the room's
// real opening direction. Collision boxes go through the same transform, so
// the mesh and its footprint can't drift apart.

import * as THREE from 'three';
import { CELL, WALL_H, WALL_T, type WallBox } from './scene';
import { markBloom } from './postfx';
import type { Dir, Room } from './security';
import { stockLockers } from './decisions';
import { screenTexture } from './screens';
import { texturedWall, type WallStyle } from './walltex';
import { buildLocker, LOCKER_D, LOCKER_W, type LockerRig } from './lockers';

const BACK = -(CELL / 2 - WALL_T / 2); // local z of the back wall's inner face
const SIDE = CELL / 2 - WALL_T / 2; // local |x| of the side walls' inner faces
/** How wide a room's doorway is, in metres. */
export const DOORWAY_W = 1.7;

const DESK_COLOR = 0x3a3f47;
const RACK_COLOR = 0x24272c;
const LED_GREEN = 0x4ee08a;
const LED_BLUE = 0x4ea0e0;
const LED_DIM = 0x3a4a5a;
const LED_RED = 0xe0564e;
const LED_AMBER = 0xffb347;
const TABLE_COLOR = 0x5a4632;
const CHAIR_COLOR = 0x2d3138;
const METAL_COLOR = 0x3b4048;
const CAFETERIA_LIGHT = 0xffcf9a;

// Three.js rotation.y maps local +Z to (sin a, cos a) in world XZ.
const YAW: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

/** A laptop screen or rack LED that game.ts/effects.ts can animate. */
export type Glow = { mat: THREE.MeshStandardMaterial; base: number };

export type RoomState = 'idle' | 'ready' | 'active';

export type BuiltRoom = {
  room: Room;
  group: THREE.Group;
  /** Floor-local (zero-origin) colliders: furniture plus the doorway's wall stubs. */
  boxes: WallBox[];
  /** Floor-local point the player stands near to hack/power/capture/wipe, and the way they face there, toward the console (0 faces +z); null for decorative rooms. */
  interact: { x: number; z: number; facing: number } | null;
  /**
   * idle → (server only) ready once its terminal is hacked → active (terminal hacked / server grid online).
   * Uplink: idle online, active offline. Log room: idle quiet, ready with logs queued, active wiped.
   * Records room: idle, ready while the uplink is online (capturing would burn you), active once captured.
   */
  setState: (state: RoomState) => void;
  glows: Glow[];
  /** Storage rooms: each locker with the floor-local point in front of it the player opens it from. */
  lockers: Array<{ rig: LockerRig; x: number; z: number }>;
  /** Storage rooms: where the sentry stands, just outside the doorway facing out (floor-local, facing 0 = +Z). */
  guardPost: { x: number; z: number; facing: number } | null;
};

function toFloor(room: Room, lx: number, lz: number): { x: number; z: number } {
  const a = YAW[room.openDir];
  return { x: room.x * CELL + lx * Math.cos(a) + lz * Math.sin(a), z: room.y * CELL - lx * Math.sin(a) + lz * Math.cos(a) };
}

/** The spot to stand at (room-local), and the facing toward the console at `(cx, cz)` (room-local), both on the floor. */
function standAt(room: Room, sx: number, sz: number, cx: number, cz: number): { x: number; z: number; facing: number } {
  const stand = toFloor(room, sx, sz);
  const console = toFloor(room, cx, cz);
  return { ...stand, facing: Math.atan2(console.x - stand.x, console.z - stand.z) };
}

function localBox(room: Room, lx: number, lz: number, hx: number, hz: number): WallBox {
  const c = toFloor(room, lx, lz);
  const swap = room.openDir === 'E' || room.openDir === 'W';
  const ax = swap ? hz : hx;
  const az = swap ? hx : hz;
  return { minX: c.x - ax, maxX: c.x + ax, minZ: c.z - az, maxZ: c.z + az };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A screen with a picture on it (screens.ts): the picture glows, and `emissive` tints it (white for itself, a key colour while being worked). */
function pictureScreen(x: number, y: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0xffffff, emissiveMap: screenTexture(x, y), emissiveIntensity: 1.3, roughness: 0.4 });
}

function emissive(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

const paintings: THREE.CanvasTexture[] = [];
/** One of a handful of abstract paintings for the museum's walls (drawn once, shared). */
function paintingTexture(i: number): THREE.CanvasTexture {
  const n = i % 5;
  if (!paintings[n]) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 80;
    const g = c.getContext('2d')!;
    const palettes = [
      ['#1d3a52', '#c98a3a', '#e6d7b0', '#7a2f36'],
      ['#2f4a34', '#d9c27a', '#7a2f36', '#e6d7b0'],
      ['#4a2a4a', '#e0a15a', '#2f5b6a', '#d9d0bf'],
      ['#7a2f36', '#e6d7b0', '#1d3a52', '#c98a3a'],
      ['#2f5b6a', '#e0a15a', '#4a3a2e', '#e6d7b0'],
    ][n]!;
    g.fillStyle = palettes[0]!;
    g.fillRect(0, 0, 64, 80);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = palettes[1 + (k % 3)]!;
      g.globalAlpha = 0.7;
      if (k % 2) g.fillRect(Math.random() * 40, Math.random() * 56, 10 + Math.random() * 30, 8 + Math.random() * 30);
      else {
        g.beginPath();
        g.arc(10 + Math.random() * 44, 10 + Math.random() * 60, 6 + Math.random() * 16, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    paintings[n] = t;
  }
  return paintings[n]!;
}

let schematic: THREE.CanvasTexture | null = null;
/** The control room's wall diagram: pipes and vessels in amber lines on black (drawn once, shared). */
function schematicTexture(): THREE.CanvasTexture {
  if (!schematic) {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#080604';
    g.fillRect(0, 0, 192, 64);
    g.strokeStyle = '#ffb04a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8, 32);
    g.lineTo(184, 32);
    g.moveTo(48, 32);
    g.lineTo(48, 12);
    g.moveTo(112, 32);
    g.lineTo(112, 52);
    g.moveTo(150, 32);
    g.lineTo(150, 14);
    g.stroke();
    g.strokeRect(34, 4, 28, 14);
    g.strokeRect(98, 46, 28, 14);
    g.beginPath();
    g.arc(150, 10, 6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffb04a';
    for (const x of [24, 80, 130, 172]) g.fillRect(x, 29, 6, 6);
    schematic = new THREE.CanvasTexture(c);
    schematic.colorSpace = THREE.SRGBColorSpace;
  }
  return schematic;
}

export function buildRoom(room: Room, keyColor: number | null, wallColor: number, wallStyle: WallStyle | null = null): BuiltRoom {
  const group = new THREE.Group();
  group.position.set(room.x * CELL, 0, room.y * CELL);
  group.rotation.y = YAW[room.openDir];
  const boxes: WallBox[] = [];
  const glows: Glow[] = [];
  const add = (...m: THREE.Object3D[]): void => {
    group.add(...m);
  };
  /** A collision footprint; furniture passes its cover height (see WallBox), structure leaves it off. */
  const solid = (lx: number, lz: number, hx: number, hz: number, cover?: 'low' | 'tall'): void => {
    boxes.push(cover ? { ...localBox(room, lx, lz, hx, hz), cover } : localBox(room, lx, lz, hx, hz));
  };

  // Doorway at the room's mouth: two wall stubs narrowing the opening, and a
  // lintel above it (key-colour strip on terminal/server rooms, so the
  // matching room reads from down the corridor).
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.92 });
  if (wallStyle) texturedWall(wallMat, wallStyle); // the room's walls match the corridor's
  const mouthZ = (room.cells.length - 1) * CELL + CELL / 2;
  const stubLen = CELL / 2 - DOORWAY_W / 2;
  for (const side of [-1, 1]) {
    const cx = side * (DOORWAY_W / 2 + stubLen / 2);
    add(box(stubLen + WALL_T / 2, WALL_H, WALL_T, wallMat, cx, WALL_H / 2, mouthZ));
    solid(cx, mouthZ, stubLen / 2 + WALL_T / 4, WALL_T / 2);
  }
  add(box(DOORWAY_W, 0.45, WALL_T, wallMat, 0, WALL_H - 0.225, mouthZ));
  if (keyColor !== null) {
    const strip = box(DOORWAY_W * 0.8, 0.08, 0.04, emissive(keyColor, 1.6), 0, WALL_H - 0.3, mouthZ + WALL_T / 2 + 0.03);
    markBloom(strip);
    add(strip);
  }

  let interact: { x: number; z: number; facing: number } | null = null;
  let setState: (state: RoomState) => void = () => {};
  const lockers: BuiltRoom['lockers'] = [];
  let guardPost: BuiltRoom['guardPost'] = null;

  if (room.kind === 'terminal' || room.kind === 'office') {
    const deskZ = BACK + 0.36;
    add(box(1.3, 0.72, 0.62, new THREE.MeshStandardMaterial({ color: DESK_COLOR, roughness: 0.75 }), 0, 0.36, deskZ));
    solid(0, deskZ, 0.65, 0.31, 'low');
    add(box(0.34, 0.02, 0.24, new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4 }), 0, 0.73, deskZ + 0.05));
    const screenMat = pictureScreen(room.x, room.y);
    const screen = box(0.46, 0.3, 0.015, screenMat, 0, 0.87, deskZ - 0.06);
    screen.rotation.x = -0.35; // top tilted away from the doorway, face toward it
    markBloom(screen);
    add(screen);
    glows.push({ mat: screenMat, base: 1.3 });
    add(box(0.46, 0.5, 0.46, new THREE.MeshStandardMaterial({ color: CHAIR_COLOR, roughness: 0.8 }), 0, 0.25, deskZ + 0.75));
    if (room.kind === 'terminal' && keyColor !== null) {
      const tag = box(1.1, 0.06, 0.02, emissive(keyColor, 1.2), 0, 0.6, deskZ + 0.32);
      markBloom(tag);
      add(tag);
      interact = standAt(room, 0, deskZ + 0.9, 0, deskZ);
      setState = (state) => {
        // The picture shows as itself; being hacked it turns the room's key colour.
        screenMat.emissive.setHex(state === 'active' ? keyColor : 0xffffff);
      };
    } else {
      // A potted plant in the corner — offices get a little life.
      add(box(0.34, 0.4, 0.34, new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.9 }), SIDE - 0.3, 0.2, BACK + 0.3));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ color: 0x3f7a4a, roughness: 0.8 }));
      leaves.position.set(SIDE - 0.3, 0.7, BACK + 0.3);
      add(leaves);
      solid(SIDE - 0.3, BACK + 0.3, 0.17, 0.17, 'low');
    }
  } else if (room.kind === 'storage') {
    // A row of lockers against the back wall, facing the doorway: the
    // loot-or-rigged gamble. The files are on the workstation.
    const contents = room.stock ?? stockLockers(0);
    const lz = BACK + LOCKER_D / 2 + 0.02;
    const spacing = LOCKER_W + 0.14;
    contents.forEach((content, i) => {
      const lx = (i - (contents.length - 1) / 2) * spacing;
      const rig = buildLocker(content, 11 + i + ((room.x * 7 + room.y * 3) % 60));
      rig.group.position.set(lx, 0, lz);
      add(rig.group);
      lockers.push({ rig, ...toFloor(room, lx, lz + LOCKER_D / 2 + 0.55) });
    });
    solid(0, lz, (contents.length * spacing) / 2, LOCKER_D / 2, 'tall');
    // Metal shelving with boxes along a side wall.
    const shelfMat = new THREE.MeshStandardMaterial({ color: METAL_COLOR, roughness: 0.55, metalness: 0.4 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
    const sx = -SIDE + 0.24;
    const sz = BACK + 1.9;
    for (const y of [0.05, 0.7, 1.35]) add(box(0.44, 0.04, 1.2, shelfMat, sx, y, sz));
    for (const [dx, dz] of [
      [-0.2, -0.55],
      [0.2, -0.55],
      [-0.2, 0.55],
      [0.2, 0.55],
    ] as const) {
      add(box(0.03, 1.4, 0.03, shelfMat, sx + dx, 0.7, sz + dz));
    }
    add(box(0.34, 0.26, 0.34, boxMat, sx, 0.2, sz - 0.3), box(0.3, 0.22, 0.36, boxMat, sx, 0.85, sz + 0.25));
    solid(sx, sz, 0.22, 0.6, 'tall');
    // The workstation against the other side wall, its screen facing into the room: where the files are.
    const wx = SIDE - 0.33;
    const wz = BACK + 2.0;
    add(box(0.62, 0.72, 1.2, new THREE.MeshStandardMaterial({ color: DESK_COLOR, roughness: 0.75 }), wx, 0.36, wz));
    solid(wx, wz, 0.31, 0.6, 'low');
    add(box(0.2, 0.02, 0.4, new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4 }), wx - 0.12, 0.73, wz));
    const screenMat = pictureScreen(room.x + 3, room.y);
    const screen = box(0.015, 0.4, 0.62, screenMat, wx + 0.12, 0.95, wz);
    screen.rotation.z = -0.3;
    markBloom(screen);
    add(screen);
    const screenGlow: Glow = { mat: screenMat, base: 1.3 };
    glows.push(screenGlow);
    interact = standAt(room, wx - 1.05, wz, wx, wz);
    setState = (state) => {
      // Idle it shows its picture; a file ready to take turns it red, and once taken it goes dim.
      screenMat.emissive.setHex(state === 'active' ? LED_DIM : state === 'ready' ? LED_RED : 0xffffff);
      screenGlow.base = state === 'active' ? 0.5 : 1.3;
    };
    guardPost = { ...toFloor(room, 0, mouthZ + 0.8), facing: YAW[room.openDir] };
  } else if (room.kind === 'uplink') {
    // The network cabinet: patch panels of blinking LEDs and a status lamp; the cutover switch at waist height.
    const cabZ = BACK + 0.42;
    add(box(1.1, 2.0, 0.8, new THREE.MeshStandardMaterial({ color: RACK_COLOR, roughness: 0.6 }), 0, 1.0, cabZ));
    solid(0, cabZ, 0.55, 0.4, 'tall');
    const leds: THREE.MeshStandardMaterial[] = [];
    for (let row = 0; row < 5; row++) {
      for (const lx of [-0.26, 0.26]) {
        const mat = emissive(LED_GREEN, 1.6);
        const led = box(0.4, 0.04, 0.02, mat, lx, 1.05 + row * 0.18, cabZ + 0.41);
        markBloom(led);
        add(led);
        glows.push({ mat, base: 1.6 });
        leds.push(mat);
      }
    }
    add(box(0.5, 0.3, 0.06, new THREE.MeshStandardMaterial({ color: METAL_COLOR, roughness: 0.5 }), 0, 0.75, cabZ + 0.43));
    const lampMat = emissive(LED_GREEN, 2.2);
    const lamp = box(0.2, 0.1, 0.2, lampMat, 0, 2.06, cabZ);
    markBloom(lamp);
    add(lamp);
    const glow = new THREE.PointLight(LED_GREEN, 4, 3.5);
    glow.position.set(0, 1.6, BACK + 1.2);
    add(glow);
    interact = standAt(room, 0, cabZ + 1.1, 0, cabZ);
    setState = (state) => {
      const off = state === 'active';
      const c = off ? LED_RED : LED_GREEN;
      for (const g of glows) {
        g.mat.color.setHex(c);
        g.mat.emissive.setHex(c);
        g.base = off ? 0.4 : 1.6;
      }
      lampMat.color.setHex(c);
      lampMat.emissive.setHex(c);
      glow.color.setHex(c);
      glow.intensity = off ? 2 : 4;
    };
  } else if (room.kind === 'logs') {
    // The log server: a rack of drives, and the console the logs are wiped from.
    const rackZ = BACK + 0.42;
    const rx = -SIDE + 0.5;
    add(box(0.8, 2.2, 0.8, new THREE.MeshStandardMaterial({ color: RACK_COLOR, roughness: 0.6 }), rx, 1.1, rackZ));
    solid(rx, rackZ, 0.4, 0.4, 'tall');
    for (let row = 0; row < 6; row++) {
      const mat = emissive(LED_BLUE, 1.2);
      const led = box(0.5, 0.05, 0.02, mat, rx, 0.35 + row * 0.32, rackZ + 0.41);
      markBloom(led);
      add(led);
      glows.push({ mat, base: 1.2 });
    }
    const deskZ = BACK + 0.36;
    const dx = 0.45;
    add(box(1.3, 0.72, 0.62, new THREE.MeshStandardMaterial({ color: DESK_COLOR, roughness: 0.75 }), dx, 0.36, deskZ));
    solid(dx, deskZ, 0.65, 0.31, 'low');
    const screenMat = emissive(LED_BLUE, 1.2);
    const screen = box(0.6, 0.36, 0.02, screenMat, dx, 0.98, deskZ - 0.05);
    screen.rotation.x = -0.2;
    markBloom(screen);
    add(screen);
    const glow = new THREE.PointLight(LED_BLUE, 4, 3.5);
    glow.position.set(0, 1.6, BACK + 1.2);
    add(glow);
    interact = standAt(room, dx, deskZ + 0.9, dx, deskZ);
    setState = (state) => {
      const c = state === 'ready' ? LED_AMBER : state === 'active' ? LED_GREEN : LED_BLUE;
      for (const g of glows) {
        g.mat.color.setHex(c);
        g.mat.emissive.setHex(c);
        g.base = state === 'ready' ? 2.2 : 1.2;
      }
      screenMat.color.setHex(c);
      screenMat.emissive.setHex(c);
      screenMat.emissiveIntensity = state === 'ready' ? 2.2 : 1.2;
      glow.color.setHex(c);
      glow.intensity = state === 'ready' ? 7 : 4;
    };
    // A guard keeps the log room, just outside the doorway.
    guardPost = { ...toFloor(room, 0, mouthZ + 0.8), facing: YAW[room.openDir] };
  } else if (room.kind === 'rack') {
    // A plain server room — racks humming along, nothing to operate.
    const rackZ = BACK + 0.42;
    for (const rx of [-1.2, 0, 1.2]) {
      add(box(0.8, 2.2, 0.8, new THREE.MeshStandardMaterial({ color: RACK_COLOR, roughness: 0.6 }), rx, 1.1, rackZ));
      solid(rx, rackZ, 0.4, 0.4, 'tall');
      for (let row = 0; row < 6; row++) {
        const color = row % 2 === 0 ? LED_GREEN : LED_BLUE;
        const mat = emissive(color, 1.6);
        const led = box(0.5, 0.05, 0.02, mat, rx, 0.35 + row * 0.32, rackZ + 0.41);
        markBloom(led);
        add(led);
        glows.push({ mat, base: 1.6 });
      }
    }
    const hum = new THREE.PointLight(LED_BLUE, 5, 3.5);
    hum.position.set(0, 1.6, BACK + 1.2);
    add(hum);
  } else if (room.kind === 'server') {
    const rackZ = BACK + 0.42;
    for (const side of [-1, 1]) {
      const rx = side * 0.78;
      add(box(0.8, 2.2, 0.8, new THREE.MeshStandardMaterial({ color: RACK_COLOR, roughness: 0.6 }), rx, 1.1, rackZ));
      solid(rx, rackZ, 0.4, 0.4, 'tall');
      for (let row = 0; row < 6; row++) {
        const mat = emissive(LED_DIM, 0.6);
        const led = box(0.5, 0.05, 0.02, mat, rx, 0.35 + row * 0.32, rackZ + 0.41);
        markBloom(led);
        add(led);
        glows.push({ mat, base: 0.6 });
      }
    }
    // Power-grid console between the racks: a pedestal with a panel facing the doorway.
    const consoleZ = BACK + 0.3;
    add(box(0.56, 1.0, 0.42, new THREE.MeshStandardMaterial({ color: METAL_COLOR, roughness: 0.5 }), 0, 0.5, consoleZ));
    solid(0, consoleZ, 0.28, 0.21, 'low');
    const panelMat = emissive(keyColor ?? LED_BLUE, 0.5);
    const panel = box(0.42, 0.26, 0.02, panelMat, 0, 0.86, consoleZ + 0.22);
    panel.rotation.x = -0.3;
    markBloom(panel);
    add(panel);
    const glow = new THREE.PointLight(LED_BLUE, 5, 3.5);
    glow.position.set(0, 1.6, BACK + 1.2);
    add(glow);
    interact = standAt(room, 0, consoleZ + 0.85, 0, consoleZ);
    // Where a heavy enforcer stands guard, just outside the doorway (game.ts decides whether one does).
    guardPost = { ...toFloor(room, 0, mouthZ + 0.8), facing: YAW[room.openDir] };
    setState = (state) => {
      const on = state === 'active';
      const c = on ? (keyColor ?? LED_GREEN) : state === 'ready' ? LED_BLUE : LED_DIM;
      for (const g of glows) {
        g.mat.color.setHex(c);
        g.mat.emissive.setHex(c);
        g.base = on ? 2.2 : state === 'ready' ? 1.2 : 0.6;
        g.mat.emissiveIntensity = g.base;
      }
      panelMat.emissiveIntensity = state === 'idle' ? 0.5 : 2.2;
      glow.color.setHex(c);
      glow.intensity = on ? 9 : 5;
    };
  } else if (room.kind === 'gallery') {
    // Paintings in gilt frames along the back wall, each with its own spot; a bench to sit and look, and a statue on a plinth.
    const gilt = new THREE.MeshStandardMaterial({ color: 0xb8965a, roughness: 0.35, metalness: 0.7 });
    for (const [i, px] of [-1.2, 0, 1.2].entries()) {
      add(box(0.98, 1.28, 0.05, gilt, px, 1.65, BACK + 0.03));
      const canvas = box(0.82, 1.12, 0.02, new THREE.MeshStandardMaterial({ map: paintingTexture(i + Math.floor(room.x + room.y)), roughness: 0.6, emissive: 0xffffff, emissiveMap: paintingTexture(i + Math.floor(room.x + room.y)), emissiveIntensity: 0.28 }), px, 1.65, BACK + 0.065);
      add(canvas);
      const spot = emissive(0xffe6b8, 1.6);
      const bar = box(0.5, 0.04, 0.05, spot, px, 2.5, BACK + 0.12);
      markBloom(bar);
      add(bar);
      add(box(0.24, 0.07, 0.02, gilt, px, 0.98, BACK + 0.05)); // the label
    }
    const bz = BACK + 1.55;
    add(box(1.5, 0.12, 0.5, new THREE.MeshStandardMaterial({ color: 0x5a1f24, roughness: 0.85 }), 0, 0.44, bz));
    for (const lx of [-0.62, 0.62]) add(box(0.06, 0.4, 0.4, gilt, lx, 0.2, bz));
    solid(0, bz, 0.75, 0.25, 'low');
    const marble = new THREE.MeshStandardMaterial({ color: 0xd5cfc4, roughness: 0.4 });
    const px = SIDE - 0.55;
    const pz = BACK + 0.85;
    add(box(0.6, 0.9, 0.6, marble, px, 0.45, pz));
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.72, 10), marble);
    torso.position.set(px, 1.26, pz);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), marble);
    head.position.set(px, 1.78, pz);
    add(torso, head);
    solid(px, pz, 0.3, 0.3, 'tall');
    const warm = new THREE.PointLight(0xffd9a0, 9, 4.2);
    warm.position.set(0, 2.4, BACK + 1.1);
    add(warm);
  } else if (room.kind === 'exhibit') {
    // Two lit glass cases with something precious in each, and a velvet rope across the front.
    const wood = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xaad4e0, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, depthWrite: false });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b35a, roughness: 0.3, metalness: 0.8, emissive: 0xffd27a, emissiveIntensity: 0.35 });
    for (const cx of [-0.8, 0.8]) {
      const cz = BACK + 0.6;
      add(box(1.0, 0.85, 0.62, wood, cx, 0.425, cz));
      add(box(0.94, 0.62, 0.56, glass, cx, 1.16, cz));
      const lamp = emissive(0xffe6b8, 1.4);
      const strip = box(0.8, 0.03, 0.4, lamp, cx, 1.46, cz);
      markBloom(strip);
      add(strip);
      const relic = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8), gold);
      relic.position.set(cx, 1.13, cz);
      add(relic);
      solid(cx, cz, 0.5, 0.31, 'low');
    }
    const ropeZ = BACK + 1.7;
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.3, metalness: 0.8 });
    for (const rx of [-1.0, 1.0]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.95, 8), brassMat);
      post.position.set(rx, 0.475, ropeZ);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), brassMat);
      knob.position.set(rx, 0.98, ropeZ);
      add(post, knob);
    }
    add(box(2.0, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0x8a1f2a, roughness: 0.9 }), 0, 0.82, ropeZ));
    const cool = new THREE.PointLight(0xe8f0ff, 8, 4);
    cool.position.set(0, 2.3, BACK + 1.0);
    add(cool);
  } else if (room.kind === 'boiler') {
    // Two upright tanks with banded rings, pipework across the back wall, a pressure gauge and a valve wheel.
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.6 });
    const rust = new THREE.MeshStandardMaterial({ color: 0xc26a1a, roughness: 0.6, metalness: 0.4 });
    for (const tx of [-0.9, 0.9]) {
      const tz = BACK + 0.85;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 2.5, 16), steel);
      tank.position.set(tx, 1.25, tz);
      add(tank);
      for (const ry of [0.5, 1.25, 2.0]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.07, 16), rust);
        ring.position.set(tx, ry, tz);
        add(ring);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      dome.position.set(tx, 2.5, tz);
      add(dome);
      solid(tx, tz, 0.6, 0.6, 'tall');
    }
    const pipe = (len: number, y: number, mat: THREE.Material): void => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 8), mat);
      p.rotation.z = Math.PI / 2;
      p.position.set(0, y, BACK + 0.18);
      add(p);
    };
    pipe(3.6, 2.35, steel);
    pipe(3.6, 1.7, rust);
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8), steel);
    riser.position.set(0, 1.25, BACK + 0.18);
    add(riser);
    const gaugeMat = emissive(LED_AMBER, 1.6);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14), gaugeMat);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0, 1.5, BACK + 0.3);
    markBloom(gauge);
    add(gauge);
    glows.push({ mat: gaugeMat, base: 1.6 });
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), emissive(LED_RED, 0.5));
    wheel.position.set(0, 0.95, BACK + 0.3);
    add(wheel);
    const glow = new THREE.PointLight(LED_AMBER, 6, 3.8);
    glow.position.set(0, 1.9, BACK + 1.3);
    add(glow);
  } else if (room.kind === 'control') {
    // A long console under a wall of dark schematic, three screens, and a chair pushed back from it.
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.5, metalness: 0.5 });
    const cz = BACK + 0.4;
    add(box(2.7, 0.9, 0.7, steel, 0, 0.45, cz));
    solid(0, cz, 1.35, 0.35, 'low');
    for (const [i, sx] of [-0.85, 0, 0.85].entries()) {
      const c = [LED_GREEN, LED_AMBER, LED_BLUE][i]!;
      const mat = emissive(c, 1.3);
      const screen = box(0.62, 0.4, 0.03, mat, sx, 1.22, cz - 0.02);
      screen.rotation.x = -0.25;
      markBloom(screen);
      add(screen);
      glows.push({ mat, base: 1.3 });
    }
    const mimic = new THREE.MeshStandardMaterial({ map: schematicTexture(), emissive: 0xffffff, emissiveMap: schematicTexture(), emissiveIntensity: 0.9, roughness: 0.5 });
    const wall = box(3.0, 1.0, 0.05, mimic, 0, 2.15, BACK + 0.03);
    markBloom(wall);
    add(wall);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.08, 12), new THREE.MeshStandardMaterial({ color: CHAIR_COLOR, roughness: 0.8 }));
    seat.position.set(0.3, 0.5, BACK + 1.25);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.46, 6), steel);
    stem.position.set(0.3, 0.24, BACK + 1.25);
    add(seat, stem);
    const glow = new THREE.PointLight(LED_AMBER, 5, 3.6);
    glow.position.set(0, 1.9, BACK + 1.2);
    add(glow);
  } else if (room.kind === 'teller') {
    // A teller's counter across the room with a glass screen and a brass top, a green banker's lamp, and a chair behind it.
    const wood = new THREE.MeshStandardMaterial({ color: 0x33251b, roughness: 0.6 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.3, metalness: 0.8 });
    const cz = BACK + 1.25;
    add(box(2.5, 1.05, 0.55, wood, 0, 0.525, cz));
    add(box(2.56, 0.05, 0.62, brassMat, 0, 1.075, cz));
    solid(0, cz, 1.25, 0.3, 'low');
    add(box(2.4, 0.7, 0.03, new THREE.MeshStandardMaterial({ color: 0xaad4e0, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.3, depthWrite: false }), 0, 1.45, cz - 0.05));
    for (const lx of [-0.8, 0.8]) {
      const shade = emissive(0x4ee08a, 1.4);
      const lamp = box(0.24, 0.12, 0.16, shade, lx, 1.28, cz + 0.05);
      markBloom(lamp);
      add(lamp);
      glows.push({ mat: shade, base: 1.4 });
    }
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x5a1f24, roughness: 0.8 }));
    seat.position.set(0, 0.5, BACK + 0.6);
    add(seat);
    add(box(2.4, 1.4, 0.05, wood, 0, 1.5, BACK + 0.03)); // panelling behind
    const lampLight = new THREE.PointLight(0xffe0a8, 8, 4);
    lampLight.position.set(0, 2.3, BACK + 1.4);
    add(lampLight);
  } else if (room.kind === 'deposit') {
    // The back wall is safe-deposit boxes: rows of small brass doors in a steel frame, and a table to take one to.
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.6 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.3, metalness: 0.8 });
    add(box(3.4, 2.5, 0.12, steel, 0, 1.4, BACK + 0.07));
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 9; col++) {
        const dx = -1.5 + col * 0.375;
        const dy = 0.5 + row * 0.3;
        add(box(0.33, 0.24, 0.03, brassMat, dx, dy, BACK + 0.15));
        add(box(0.03, 0.03, 0.02, steel, dx, dy, BACK + 0.175));
      }
    }
    solid(0, BACK + 0.09, SIDE - 0.1, 0.09, 'tall');
    const tz = BACK + 1.2;
    add(box(1.3, 0.06, 0.6, steel, 0, 0.85, tz));
    for (const lx of [-0.55, 0.55]) add(box(0.06, 0.84, 0.5, steel, lx, 0.42, tz));
    solid(0, tz, 0.65, 0.3, 'low');
    const shade = emissive(0x4ee08a, 1.4);
    const lamp = box(0.22, 0.12, 0.16, shade, 0.35, 1.0, tz);
    markBloom(lamp);
    add(lamp);
    glows.push({ mat: shade, base: 1.4 });
    const cool = new THREE.PointLight(0xdfefff, 8, 4);
    cool.position.set(0, 2.3, BACK + 1.2);
    add(cool);
  } else if (room.kind === 'shelving') {
    // Steel racking up the back wall, boxes and drums on every shelf, and a pallet with a shrink-wrapped load in front.
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a5f8a, roughness: 0.5, metalness: 0.5 });
    const cardboard = new THREE.MeshStandardMaterial({ color: 0xa88455, roughness: 0.85 });
    const drum = new THREE.MeshStandardMaterial({ color: 0x2a5f8a, roughness: 0.5, metalness: 0.4 });
    for (const rx of [-1.3, 1.3]) {
      const rz = BACK + 0.45;
      for (const ux of [-0.55, 0.55]) add(box(0.06, 2.4, 0.06, steel, rx + ux, 1.2, rz));
      for (const sy of [0.25, 0.95, 1.65, 2.35]) add(box(1.2, 0.05, 0.7, steel, rx, sy, rz));
      for (const [i, sy] of [0.25, 0.95, 1.65].entries()) {
        if ((i + (rx > 0 ? 1 : 0)) % 3 === 2) {
          const d = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), drum);
          d.position.set(rx - 0.25, sy + 0.3, rz);
          add(d);
        } else add(box(0.5 + (i % 2) * 0.18, 0.5, 0.52, cardboard, rx - 0.2, sy + 0.3, rz));
        add(box(0.4, 0.4, 0.5, cardboard, rx + 0.3, sy + 0.27, rz));
      }
      solid(rx, rz, 0.65, 0.38, 'tall');
    }
    const pz = BACK + 1.7;
    add(box(1.1, 0.12, 1.0, new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.9 }), 0, 0.08, pz));
    add(box(0.96, 0.9, 0.86, new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.3, transparent: true, opacity: 0.75 }), 0, 0.6, pz));
    add(box(0.9, 0.84, 0.8, cardboard, 0, 0.6, pz));
    solid(0, pz, 0.55, 0.5, 'low');
    const lampMat = emissive(0xfff0c0, 1.3);
    const strip = box(2.6, 0.04, 0.1, lampMat, 0, 2.7, BACK + 1.0);
    markBloom(strip);
    add(strip);
    glows.push({ mat: lampMat, base: 1.3 });
    const warm = new THREE.PointLight(0xffe9a8, 6, 4);
    warm.position.set(0, 2.5, BACK + 1.2);
    add(warm);
  } else if (room.kind === 'dock') {
    // A loading bay: a roller door in the back wall, a yellow bumper line on the floor, a pallet jack, and a stack of crates.
    const door = new THREE.MeshStandardMaterial({ color: 0x4b5258, roughness: 0.55, metalness: 0.5 });
    const hazard = new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.7 });
    add(box(2.4, 2.4, 0.06, door, 0, 1.3, BACK + 0.05));
    for (let ry = 0.2; ry < 2.4; ry += 0.2) add(box(2.4, 0.02, 0.02, new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.6 }), 0, ry + 0.1, BACK + 0.09));
    add(box(2.6, 0.14, 0.1, hazard, 0, 2.55, BACK + 0.07));
    const bayLampMat = emissive(LED_AMBER, 1.8);
    const bayLamp = box(0.3, 0.14, 0.1, bayLampMat, 0, 2.78, BACK + 0.1);
    markBloom(bayLamp);
    add(bayLamp);
    glows.push({ mat: bayLampMat, base: 1.8 });
    add(box(2.4, 0.02, 0.18, hazard, 0, 0.01, BACK + 1.0));
    // pallet jack
    const jack = new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.6, metalness: 0.3 });
    add(box(0.2, 0.12, 1.05, jack, -0.55, 0.14, BACK + 1.7));
    add(box(0.2, 0.12, 1.05, jack, -0.15, 0.14, BACK + 1.7));
    add(box(0.5, 0.9, 0.06, jack, -0.35, 0.5, BACK + 1.2));
    solid(-0.35, BACK + 1.7, 0.45, 0.55, 'low');
    // crates
    const crate = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85 });
    add(box(0.8, 0.8, 0.8, crate, 0.95, 0.4, BACK + 1.1));
    add(box(0.7, 0.7, 0.7, crate, 0.95, 1.15, BACK + 1.1));
    add(box(0.8, 0.8, 0.8, crate, 0.55, 0.4, BACK + 1.9));
    solid(0.8, BACK + 1.4, 0.55, 0.65, 'tall');
    const glow = new THREE.PointLight(LED_AMBER, 6, 4);
    glow.position.set(0, 2.2, BACK + 1.1);
    add(glow);
  } else if (room.kind === 'bench') {
    // A lab bench along the back with a microscope, racked flasks and a screen, a stool, and a fume hood with its sash raised.
    const white = new THREE.MeshStandardMaterial({ color: 0xe4ecef, roughness: 0.35 });
    const top = new THREE.MeshStandardMaterial({ color: 0x2a3338, roughness: 0.3, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfeaf0, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false });
    const bz = BACK + 0.5;
    add(box(2.9, 0.86, 0.8, white, 0, 0.43, bz));
    add(box(3.0, 0.05, 0.86, top, 0, 0.885, bz));
    solid(0, bz, 1.5, 0.43, 'low');
    // microscope
    const scope = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.4, metalness: 0.6 });
    add(box(0.22, 0.04, 0.26, scope, -0.9, 0.93, bz));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.36, 8), scope);
    arm.position.set(-0.9, 1.12, bz - 0.06);
    arm.rotation.x = -0.35;
    add(arm);
    // flask rack
    for (const [i, fx] of [-0.3, -0.12, 0.06, 0.24].entries()) {
      const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 10), new THREE.MeshStandardMaterial({ color: [0x4ee0b8, 0xff8a4a, 0x6ab0ff, 0xd870ff][i]!, transparent: true, opacity: 0.55, roughness: 0.1, emissive: [0x4ee0b8, 0xff8a4a, 0x6ab0ff, 0xd870ff][i]!, emissiveIntensity: 0.35 }));
      flask.position.set(fx, 1.02, bz + 0.1);
      add(flask);
    }
    // monitor
    const screenMat = emissive(0x7ee0ff, 1.1);
    const screen = box(0.7, 0.42, 0.03, screenMat, 0.95, 1.3, bz - 0.2);
    markBloom(screen);
    add(screen);
    glows.push({ mat: screenMat, base: 1.1 });
    // fume hood on the wall above the bench, sash raised
    add(box(1.1, 0.04, 0.5, white, -0.3, 2.35, BACK + 0.28));
    add(box(1.1, 0.8, 0.02, glass, -0.3, 1.95, BACK + 0.5));
    // stool
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x1f9a98, roughness: 0.6 }));
    seat.position.set(0.5, 0.6, BACK + 1.45);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.58, 6), scope);
    stem.position.set(0.5, 0.3, BACK + 1.45);
    add(seat, stem);
    const cool = new THREE.PointLight(0xd6f5ff, 9, 4.2);
    cool.position.set(0, 2.4, BACK + 1.1);
    add(cool);
  } else if (room.kind === 'specimen') {
    // Two tall glass tanks full of glowing fluid with something suspended in each, a cryo pod between them, and a status panel.
    const frame = new THREE.MeshStandardMaterial({ color: 0x2a3338, roughness: 0.4, metalness: 0.6 });
    for (const [i, tx] of [-0.95, 0.95].entries()) {
      const tz = BACK + 0.7;
      const hue = i === 0 ? 0x4ee0b8 : 0x6ab0ff;
      add(box(0.9, 0.18, 0.9, frame, tx, 0.09, tz));
      add(box(0.9, 0.12, 0.9, frame, tx, 2.35, tz));
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 2.1, 16), new THREE.MeshStandardMaterial({ color: hue, transparent: true, opacity: 0.42, roughness: 0.1, emissive: hue, emissiveIntensity: 0.55, depthWrite: false }));
      fluid.position.set(tx, 1.2, tz);
      add(fluid);
      markBloom(fluid);
      const specimen = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 }));
      specimen.position.set(tx, 1.25, tz);
      specimen.scale.set(1, 1.6, 0.8);
      add(specimen);
      solid(tx, tz, 0.45, 0.45, 'tall');
    }
    const pod = new THREE.MeshStandardMaterial({ color: 0xe4ecef, roughness: 0.3 });
    add(box(0.8, 0.5, 0.5, pod, 0, 0.3, BACK + 1.45));
    add(box(0.74, 0.08, 0.44, new THREE.MeshStandardMaterial({ color: 0xbfeaf0, transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false }), 0, 0.59, BACK + 1.45));
    solid(0, BACK + 1.45, 0.42, 0.28, 'low');
    const panelMat = emissive(LED_GREEN, 1.4);
    const panel = box(0.5, 0.3, 0.03, panelMat, 0, 1.6, BACK + 0.05);
    markBloom(panel);
    add(panel);
    glows.push({ mat: panelMat, base: 1.4 });
    const glow = new THREE.PointLight(0x4ee0d0, 7, 4.2);
    glow.position.set(0, 1.9, BACK + 1.2);
    add(glow);
  } else if (room.kind === 'conference') {
    const tz = BACK + 1.0;
    add(box(1.6, 0.06, 0.9, new THREE.MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.5 }), 0, 0.74, tz));
    solid(0, tz, 0.8, 0.45, 'low');
    const legMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });
    for (const [lx, lz] of [
      [-0.7, -0.36],
      [0.7, -0.36],
      [-0.7, 0.36],
      [0.7, 0.36],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), legMat);
      leg.position.set(lx, 0.37, tz + lz);
      add(leg);
    }
    const chairMat = new THREE.MeshStandardMaterial({ color: CHAIR_COLOR, roughness: 0.8 });
    for (const cx of [-0.5, 0, 0.5]) add(box(0.32, 0.5, 0.32, chairMat, cx, 0.25, tz + 0.7));
    // A dark wall screen on the back wall.
    const tvMat = emissive(0x20344a, 0.8);
    const tv = box(1.4, 0.8, 0.04, tvMat, 0, 1.6, BACK + 0.03);
    markBloom(tv);
    add(tv);
    glows.push({ mat: tvMat, base: 0.8 });
  } else {
    const tz = BACK + 1.1;
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 16), new THREE.MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.55 }));
    table.position.set(0, 0.72, tz);
    add(table);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.68, 8), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 }));
    leg.position.set(0, 0.36, tz);
    add(leg);
    solid(0, tz, 0.45, 0.45, 'low');
    const stoolMat = new THREE.MeshStandardMaterial({ color: CHAIR_COLOR, roughness: 0.8 });
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 8), stoolMat);
      stool.position.set(Math.sin(a) * 0.72, 0.21, tz + Math.cos(a) * 0.72);
      add(stool);
    }
    // Vending machine against the back wall.
    add(box(0.8, 1.9, 0.6, new THREE.MeshStandardMaterial({ color: 0x5a2230, roughness: 0.5 }), SIDE - 0.5, 0.95, BACK + 0.32));
    solid(SIDE - 0.5, BACK + 0.32, 0.4, 0.3, 'tall');
    const vendMat = emissive(0xffe2b0, 1.1);
    const vend = box(0.5, 1.1, 0.02, vendMat, SIDE - 0.5, 1.1, BACK + 0.63);
    markBloom(vend);
    add(vend);
    glows.push({ mat: vendMat, base: 1.1 });
    const pendant = new THREE.PointLight(CAFETERIA_LIGHT, 12, 5);
    pendant.position.set(0, 2.2, tz);
    add(pendant);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), emissive(CAFETERIA_LIGHT, 2));
    bulb.position.set(0, 2.2, tz);
    markBloom(bulb);
    add(bulb);
  }

  // A two-cell room gets a filing cabinet against a side wall of its outer cell.
  if (room.cells.length === 2) {
    const cz = CELL - 0.6;
    add(box(0.46, 1.3, 0.7, new THREE.MeshStandardMaterial({ color: METAL_COLOR, roughness: 0.55 }), SIDE - 0.25, 0.65, cz));
    solid(SIDE - 0.25, cz, 0.23, 0.35, 'low');
  }

  return { room, group, boxes, interact, setState, glows, lockers, guardPost };
}
