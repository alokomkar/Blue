// Remote traps: a squat charge the player rolls along the floor ahead of
// them (trapRoll.ts works out where it stops), with a small camera pod on
// top looking the way it rolled. game.ts shows
// what the camera sees in a picture-in-picture feed and blows the charge
// when told to, knocking out everything close by. Once armed it also blows by
// itself: a blue laser tripwire runs across it (trapSensor.ts), and anything
// that walks across the beam sets it off. This file owns the device itself:
// the mesh, its status light, its camera, its beam and its arming.

import * as THREE from 'three';
import { markBloom } from './postfx';
import { rayToBoxes } from './detection';
import { SENSOR_FUSE_S, SENSOR_REACH, beamAcross, type Beam } from './trapSensor';
import type { WallBox } from './scene';

export const TRAP_ARM_S = 1; // after it's set, before it can be blown
export const TRAP_RADIUS = 3; // everything this close when it goes off is knocked out
export const MAX_ARMED_TRAPS = 2; // set at once
const CAM_HEIGHT = 0.55;
const CAM_LOOK = 6; // how far ahead the camera looks, rising a little
const ARMING = 0xffb347;
const ARMED = 0x4db8ff; // the blue of the agent's own gear: armed, and its beam up
export const BEAM_COLOUR = 0x4db8ff;
const BEAM_Y = 0.32; // shin height
const BEAM_FADE_S = 0.4;
const ROLL_SPEED = 12; // world units a second, slowing to a stop
const ROLL_SPINS = 2.5; // turns it makes on the way

/** The tripwire a trap at (x, z) facing `facing` would run, as far as the walls leave it (and the reach). */
export function sensorBeam(x: number, z: number, facing: number, walls: WallBox[]): Beam {
  const px = Math.cos(facing);
  const pz = -Math.sin(facing);
  const right = rayToBoxes(x, z, px, pz, SENSOR_REACH + 0.2, walls) - 0.15;
  const left = rayToBoxes(x, z, -px, -pz, SENSOR_REACH + 0.2, walls) - 0.15;
  return beamAcross(x, z, facing, left, right);
}

export type TrapRig = {
  group: THREE.Group;
  /** The motion sensor's tripwire, across the trap (world coordinates). Live once the trap is armed. */
  beam: Beam;
  /** The camera in its pod, looking the way the player faced when setting it. */
  camera: THREE.PerspectiveCamera;
  floorIdx: number;
  x: number;
  z: number;
  /** Seconds until it can be blown; 0 once armed. */
  armingLeft: number;
  /** Set once something has broken its beam: the seconds left before it goes off by itself (null until then). */
  fuseLeft: number | null;
  /** The beam was just broken: the sensor starts its fuse. */
  trip: () => void;
  update: (dt: number, time: number) => void;
  remove: () => void;
};

/** A trap rolled from (fromX, fromZ) to rest at (x, z); it arms once it stops. */
export function buildTrap(scene: THREE.Scene, fromX: number, fromZ: number, x: number, floorY: number, z: number, facing: number, floorIdx: number, walls: WallBox[] = []): TrapRig {
  const group = new THREE.Group();
  group.position.set(fromX, floorY, fromZ);
  group.rotation.y = facing;
  const rollS = Math.max(0.12, (2 * Math.hypot(x - fromX, z - fromZ)) / ROLL_SPEED); // eased out: twice as long as at full speed
  let rolled = 0;

  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.6, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 18), metal);
  body.position.y = 0.035;
  group.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.04, 16), dark);
  cap.position.y = 0.09;
  group.add(cap);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ARMING, emissiveIntensity: 1.8 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.012, 6, 28), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  markBloom(ring);
  group.add(ring);

  // The camera pod on a short stalk, lens toward +Z (the way it faces).
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), metal);
  stalk.position.y = 0.28;
  group.add(stalk);
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), dark);
  pod.position.y = CAM_HEIGHT - 0.03;
  group.add(pod);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6fe0ff, emissiveIntensity: 1.6 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), lensMat);
  lens.position.set(0, CAM_HEIGHT - 0.03, 0.051);
  markBloom(lens);
  group.add(lens);
  scene.add(group);

  // The motion sensor's beam: a thin bright core in a faint glow, between two small end lamps, set on the floor's own height in the world (the trap itself rolls).
  const beam = sensorBeam(x, z, facing, walls);
  const beamLen = Math.hypot(beam.ax - beam.bx, beam.az - beam.bz);
  const sensor = new THREE.Group();
  sensor.position.set((beam.ax + beam.bx) / 2, floorY + BEAM_Y, (beam.az + beam.bz) / 2);
  sensor.rotation.y = Math.atan2(-(beam.az - beam.bz), beam.ax - beam.bx);
  const beamMat = (opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: BEAM_COLOUR, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const coreMat = beamMat(0);
  const glowMat = beamMat(0);
  const capMat = beamMat(0);
  const stripMat = beamMat(0);
  const core = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.03, 0.03), coreMat);
  markBloom(core);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.14, 0.14), glowMat);
  // A soft band on the floor under it, so the line reads from the camera high above.
  const stripGeo = new THREE.PlaneGeometry(beamLen, 0.5);
  stripGeo.rotateX(-Math.PI / 2);
  const strip = new THREE.Mesh(stripGeo, stripMat);
  strip.position.y = -BEAM_Y + 0.03;
  const capGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const capA = new THREE.Mesh(capGeo, capMat);
  capA.position.x = beamLen / 2;
  const capB = new THREE.Mesh(capGeo, capMat);
  capB.position.x = -beamLen / 2;
  sensor.add(strip, glow, core, capA, capB);
  sensor.visible = false;
  scene.add(sensor);
  let beamK = 0;

  const camera = new THREE.PerspectiveCamera(72, 1.6, 0.05, 40);
  camera.position.set(x + Math.sin(facing) * 0.06, floorY + CAM_HEIGHT, z + Math.cos(facing) * 0.06);
  camera.lookAt(x + Math.sin(facing) * CAM_LOOK, floorY + CAM_HEIGHT + 0.5, z + Math.cos(facing) * CAM_LOOK);

  const rig: TrapRig = {
    group,
    beam,
    camera,
    floorIdx,
    x,
    z,
    armingLeft: TRAP_ARM_S + rollS,
    fuseLeft: null,
    trip() {
      if (rig.fuseLeft === null) rig.fuseLeft = SENSOR_FUSE_S;
    },
    update(dt, time) {
      if (rolled < rollS) {
        rolled = Math.min(rollS, rolled + dt);
        const f = rolled / rollS;
        const e = 1 - (1 - f) * (1 - f); // slowing to a stop
        group.position.set(fromX + (x - fromX) * e, floorY, fromZ + (z - fromZ) * e);
        group.rotation.y = facing + (1 - e) * ROLL_SPINS * Math.PI * 2;
      }
      rig.armingLeft = Math.max(0, rig.armingLeft - dt);
      const armed = rig.armingLeft === 0;
      ringMat.emissive.setHex(armed ? ARMED : ARMING);
      // Blinks slowly while arming, and a quick double-pulse once armed.
      const fusing = rig.fuseLeft !== null;
      if (fusing) rig.fuseLeft = Math.max(0, rig.fuseLeft! - dt);
      const blink = fusing ? 0.5 + 0.5 * Math.sin(time * 50) : armed ? Math.max(0, Math.sin(time * 9)) ** 6 : 0.5 + 0.5 * Math.sin(time * 5);
      ringMat.emissiveIntensity = 0.6 + 2 * blink;
      // The beam fades up once the trap is armed, with a faint shimmer.
      beamK = armed ? Math.min(1, beamK + dt / BEAM_FADE_S) : 0;
      sensor.visible = beamK > 0;
      // Tripped, the beam flares white and flickers fast until the blast.
      coreMat.color.setHex(fusing ? 0xffffff : BEAM_COLOUR);
      coreMat.opacity = beamK * (fusing ? 0.6 + 0.4 * Math.sin(time * 50) : 0.7 + 0.15 * Math.sin(time * 13));
      glowMat.opacity = beamK * (fusing ? 0.55 : 0.28);
      stripMat.opacity = beamK * (fusing ? 0.4 : 0.2);
      stripMat.color.setHex(fusing ? 0xffffff : BEAM_COLOUR);
      capMat.opacity = beamK * 0.9;
    },
    remove() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      sensor.removeFromParent();
      sensor.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    },
  };
  return rig;
}
