import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { preparePulseLights, takeLight, giveLight, PULSE_LIGHTS } from './pulselights.ts';

const lights = (s: THREE.Scene): number => s.children.filter((o) => o instanceof THREE.PointLight).length;

test('the lights are in the scene before anything is thrown, and lending them never changes how many there are', () => {
  const scene = new THREE.Scene();
  preparePulseLights(scene);
  assert.equal(lights(scene), PULSE_LIGHTS);
  const a = takeLight(scene, 0xff0000, 11);
  const b = takeLight(scene, 0x00ff00, 22);
  assert.notEqual(a, b);
  assert.equal(a.distance, 11);
  assert.equal(a.color.getHex(), 0xff0000);
  assert.equal(a.intensity, 0, 'lent out dark');
  assert.equal(lights(scene), PULSE_LIGHTS);
  a.intensity = 50;
  giveLight(scene, a);
  assert.equal(a.intensity, 0, 'given back dark');
  assert.equal(takeLight(scene, 0xffffff, 5), a, 'and lent again');
  assert.equal(lights(scene), PULSE_LIGHTS);
});

test('a pool that is used up still gives a light (one more, which is a hitch, but nothing breaks)', () => {
  const scene = new THREE.Scene();
  preparePulseLights(scene);
  const taken = Array.from({ length: PULSE_LIGHTS + 1 }, () => takeLight(scene, 0xffffff, 3));
  assert.equal(new Set(taken).size, PULSE_LIGHTS + 1);
  assert.equal(lights(scene), PULSE_LIGHTS + 1);
});

test('each scene has its own pool', () => {
  const a = new THREE.Scene();
  const b = new THREE.Scene();
  preparePulseLights(a);
  preparePulseLights(b);
  assert.equal(lights(a), PULSE_LIGHTS);
  assert.equal(lights(b), PULSE_LIGHTS);
});
