// A cloud of glass shards for the maze security protocol's takeover (takeover.ts): the building breaks into them as the purge wave passes,
// they hang and swirl over the floor plan, and then each flies to a place in the new one and lays itself flat there, where the floor and
// the walls come back. Every shard is one thin triangle, drawn instanced; where it is at any moment is worked out in the vertex shader
// from the time alone, so a few thousand of them cost one draw call and no per-frame work here.

import * as THREE from 'three';

export type ShardPoint = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

export type ShardSpec = {
  /** Where the shard breaks off (on the old building), and where it is laid again (on the new). */
  home: ShardPoint;
  target: ShardPoint;
  /** When it breaks off, when it starts for its place, and how long the flight takes (seconds on the takeover's clock). */
  breakAt: number;
  startAt: number;
  flight: number;
  /** Its edge, in metres. */
  size: number;
};

export type Shards = {
  mesh: THREE.Mesh;
  /** Sets the clock; call once a frame. */
  update: (t: number) => void;
  dispose: () => void;
};

const VERT = /* glsl */ `
attribute vec3 bary;
attribute vec3 aHome;
attribute vec3 aTarget;
attribute vec3 aNormal;
attribute vec4 aRand;
attribute vec3 aTime; // break, start, flight
attribute float aSize;
uniform float uT;
uniform vec3 uOrigin;
uniform vec3 uCentre;
varying vec3 vBary;
varying float vAlive;
varying float vSeed;
varying float vLife;

mat3 axisAngle(vec3 a, float ang) {
  float c = cos(ang), s = sin(ang), t = 1.0 - c;
  return mat3(
    t * a.x * a.x + c,       t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c,       t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c
  );
}

// Where the shard hangs, u seconds after it breaks: thrown out from the wave, slowing, lifted into the air, drifting round the middle.
vec3 hangAt(float u) {
  vec3 away = vec3(aHome.x - uOrigin.x, 0.0, aHome.z - uOrigin.z);
  vec3 dir = normalize(away + (aRand.xyz - 0.5) * 6.0 + vec3(0.0001));
  float speed = 2.0 + aRand.w * 5.0;
  float travel = (1.0 - exp(-1.6 * u)) / 1.6;
  vec3 p = aHome + dir * speed * travel;
  p.y += (1.2 + aRand.x * 7.0) * (1.0 - exp(-0.9 * u));
  float ang = 0.12 * u * (0.5 + aRand.y);
  vec3 rel = p - uCentre;
  p = uCentre + vec3(rel.x * cos(ang) - rel.z * sin(ang), rel.y, rel.x * sin(ang) + rel.z * cos(ang));
  p.y += 0.35 * sin(u * 1.7 + aRand.z * 6.2831);
  return p;
}

void main() {
  float breakAt = aTime.x;
  float startAt = aTime.y;
  float flight = aTime.z;
  float u = max(uT - breakAt, 0.0);
  float k = clamp((uT - startAt) / flight, 0.0, 1.0);
  float e = k * k * (3.0 - 2.0 * k);
  float arrived = uT - (startAt + flight);
  // Present from the moment it breaks to a beat after it has landed.
  float alive = step(0.0, uT - breakAt) * (1.0 - smoothstep(0.0, 0.45, arrived));

  vec3 from = hangAt(min(u, max(startAt - breakAt, 0.0)));
  vec3 p = mix(from, aTarget, e);
  p.y += sin(3.14159 * k) * (1.5 + aRand.y * 3.0); // an arc on the way in

  // Tumbling while it hangs; once it is on its way it turns to lie flat on the surface it lands on.
  vec3 axis = normalize(aRand.xyz * 2.0 - 1.0 + vec3(0.0001));
  mat3 tumble = axisAngle(axis, aRand.w * 6.2831 + u * (1.2 + 3.0 * aRand.y));
  vec3 n = normalize(aNormal);
  vec3 tn = normalize(abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : cross(vec3(0.0, 1.0, 0.0), n));
  vec3 bit = cross(n, tn);
  float roll = aRand.z * 6.2831;
  vec3 t2 = tn * cos(roll) + bit * sin(roll);
  vec3 b2 = cross(n, t2);
  mat3 rest = mat3(t2, b2, n);

  float pop = 0.15 + 0.85 * smoothstep(0.0, 0.12, u);
  vec3 local = position * aSize * pop;
  vec3 world = p + mix(tumble * local, rest * local * 1.04, e) + n * 0.02 * e;

  vBary = bary;
  vAlive = alive;
  vSeed = aRand.z;
  vLife = clamp(u / 2.0, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uT;
varying vec3 vBary;
varying float vAlive;
varying float vSeed;
varying float vLife;

void main() {
  if (vAlive <= 0.001) discard;
  float edge = 1.0 - smoothstep(0.0, 0.14, min(min(vBary.x, vBary.y), vBary.z));
  float glint = pow(max(0.0, sin(uT * 3.2 + vSeed * 40.0)), 8.0);
  vec3 ice = mix(vec3(0.45, 0.85, 1.0), vec3(0.92, 1.0, 1.0), vSeed);
  vec3 col = ice * (0.22 + 0.55 * glint) + vec3(0.15, 0.85, 1.0) * edge * 1.1;
  // Brightest as it breaks, calmer while it hangs.
  col *= 1.0 + (1.0 - vLife) * 1.2;
  float a = (0.2 + 0.45 * edge + 0.35 * glint) * vAlive;
  gl_FragColor = vec4(col, a);
}
`;

/** Builds the shard cloud from `specs` and puts it in `scene`. `centre` is the middle of the floor plan, `origin` where the wave starts. */
export function makeShards(scene: THREE.Scene, specs: ReadonlyArray<ShardSpec>, centre: THREE.Vector3, origin: THREE.Vector3): Shards {
  const n = specs.length;
  const geo = new THREE.InstancedBufferGeometry();
  // One thin triangle, about a unit across, with barycentric coordinates for the glowing edges.
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.4, 0, 0.55, -0.25, 0, -0.1, 0.62, 0], 3));
  geo.setAttribute('bary', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  const home = new Float32Array(n * 3);
  const target = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  const time = new Float32Array(n * 3);
  const size = new Float32Array(n);
  specs.forEach((s, i) => {
    home.set([s.home.x, s.home.y, s.home.z], i * 3);
    target.set([s.target.x, s.target.y, s.target.z], i * 3);
    normal.set([s.target.nx, s.target.ny, s.target.nz], i * 3);
    rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    time.set([s.breakAt, s.startAt, s.flight], i * 3);
    size[i] = s.size;
  });
  geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(home, 3));
  geo.setAttribute('aTarget', new THREE.InstancedBufferAttribute(target, 3));
  geo.setAttribute('aNormal', new THREE.InstancedBufferAttribute(normal, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
  geo.setAttribute('aTime', new THREE.InstancedBufferAttribute(time, 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.instanceCount = n;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uT: { value: 0 }, uOrigin: { value: origin.clone() }, uCentre: { value: centre.clone() } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData['fx'] = true;
  scene.add(mesh);
  return {
    mesh,
    update: (t) => {
      material.uniforms['uT']!.value = t;
    },
    dispose: () => {
      scene.remove(mesh);
      geo.dispose();
      material.dispose();
    },
  };
}

// ---- where shards come from and go to ----

/** A random point on the surface of the box (its faces weighted by area), with the face's outward normal. */
export function pointOnBox(min: THREE.Vector3, max: THREE.Vector3, rnd: () => number = Math.random): ShardPoint {
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  const ax = dy * dz;
  const ay = dx * dz;
  const az = dx * dy;
  let r = rnd() * (ax + ay + az) * 2;
  const sign = r >= ax + ay + az ? 1 : -1;
  if (r >= ax + ay + az) r -= ax + ay + az;
  if (r < ax) return { x: sign > 0 ? max.x : min.x, y: min.y + rnd() * dy, z: min.z + rnd() * dz, nx: sign, ny: 0, nz: 0 };
  if (r < ax + ay) return { x: min.x + rnd() * dx, y: sign > 0 ? max.y : min.y, z: min.z + rnd() * dz, nx: 0, ny: sign, nz: 0 };
  return { x: min.x + rnd() * dx, y: min.y + rnd() * dy, z: sign > 0 ? max.z : min.z, nx: 0, ny: 0, nz: sign };
}

/** A point on one of a wall's two long faces (or, now and then, its top), for a shard to be laid on. */
export function pointOnWall(cx: number, cz: number, sx: number, sz: number, height: number, rnd: () => number = Math.random): ShardPoint {
  const alongX = sx >= sz;
  const side = rnd() < 0.5 ? -1 : 1;
  if (rnd() < 0.08) return { x: cx + (rnd() - 0.5) * sx, y: height, z: cz + (rnd() - 0.5) * sz, nx: 0, ny: 1, nz: 0 };
  return alongX
    ? { x: cx + (rnd() - 0.5) * sx, y: rnd() * height, z: cz + side * (sz / 2 + 0.01), nx: 0, ny: 0, nz: side }
    : { x: cx + side * (sx / 2 + 0.01), y: rnd() * height, z: cz + (rnd() - 0.5) * sz, nx: side, ny: 0, nz: 0 };
}
