import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PropFader } from './propfade.ts';
import { blocking, stepFade } from './wallfade.ts';

const fader = (): PropFader => new PropFader({ blocking, stepFade });

const wall = (): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }));
const BOX = { minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -0.2, maxZ: 0.2 };
// The camera on one side of the prop, the agent on the other: the line passes through it.
const CAMERA = { x: 0, y: 5, z: 4 };
const BEHIND = [{ x: 0, y: 1, z: -4 }];
const BESIDE = [{ x: 6, y: 1, z: 4 }];

test('a prop in the way of the view fades to a see-through copy of its material, and comes back solid', () => {
  const mesh = wall();
  const solid = mesh.material;
  const f = fader();
  f.add({ objects: [mesh], box: BOX });
  for (let i = 0; i < 30; i++) f.update(CAMERA, BEHIND, 0.1);
  const ghost = mesh.material as THREE.MeshStandardMaterial;
  assert.notEqual(ghost, solid, 'a copy, so the solid material is not touched');
  assert.equal(ghost.transparent, true);
  assert.ok(ghost.opacity < 0.4, `opacity ${ghost.opacity}`);
  assert.equal((solid as THREE.MeshStandardMaterial).transparent, false);
  for (let i = 0; i < 30; i++) f.update(CAMERA, BESIDE, 0.1);
  assert.equal(mesh.material, solid, 'solid again once the agent is in view');
});

test('with nothing to look at (another floor, a fly-over) everything comes back; a prop out of the way never changes', () => {
  const a = wall();
  const b = wall();
  const solidA = a.material;
  const f = fader();
  f.add({ objects: [a], box: BOX });
  f.add({ objects: [b], box: { ...BOX, minX: 20, maxX: 22 } });
  for (let i = 0; i < 30; i++) f.update(CAMERA, BEHIND, 0.1);
  assert.notEqual(a.material, solidA);
  assert.notEqual(b.material, undefined);
  assert.equal(b.material instanceof THREE.MeshStandardMaterial && b.material.transparent, false, 'the one off to the side stays solid');
  for (let i = 0; i < 30; i++) f.update(CAMERA, null, 0.1);
  assert.equal(a.material, solidA);
});
