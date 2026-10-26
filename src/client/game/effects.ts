// Atmosphere and feedback effects, all cheap enough for mobile:
//
// - TorchBeam: a soft additive cone along the player's torch, so the light
//   itself is visible in the air, clipped at walls.
// - VisionCones: a red wedge on the floor per bot showing where it's
//   looking (forward cone out to its detection radius, clipped against
//   walls by raycasts) plus a faint ring for its all-around awareness radius.
// - Dust: world-fixed motes that only show up inside the torch cone.
// - Ambient: rack LEDs chasing, screens flickering, the odd stuttering fixture.
// - Bursts: sparks where a shot lands, smoke where a bot goes down.
// - Beacon: a light column marking a storage room once its grid is online.
//
// Transparent effect meshes carry userData.fx so postfx.ts hides them during
// the bloom-only render instead of drawing them as opaque black occluders.

import * as THREE from 'three';
import { rayToBoxes, VIEW_HALF_ANGLE, DETECT_RADIUS, SNEAK_DETECT_RADIUS, AWARE_RADIUS, SNEAK_AWARE_RADIUS } from './detection';
import type { WallBox } from './scene';
import type { Glow } from './rooms';

const TORCH_COLOR = new THREE.Color(0xbfe3ea);
const BEAM_MAX_LEN = 4.6;
const BEAM_HALF_ANGLE = Math.PI / 5; // matches player.ts's SpotLight angle

function markFx(o: THREE.Object3D): void {
  o.userData.fx = true;
}

export class TorchBeam {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly dir = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);

  /** `color` and `intensity` default to the player's torch; guards' shoulder lamps pass their own. */
  constructor(scene: THREE.Scene, color: THREE.ColorRepresentation = TORCH_COLOR, intensity = 0.11) {
    const geo = new THREE.CylinderGeometry(0.05, 1, 1, 32, 1, true);
    geo.translate(0, -0.5, 0); // apex at the origin, opening toward -Y
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity } },
      vertexShader: `
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        void main() {
          vAlong = -position.y;
          vNormalV = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        void main() {
          float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
          float a = uIntensity * pow(1.0 - vAlong, 1.5) * smoothstep(0.0, 0.12, vAlong) * pow(facing, 1.4);
          // Alpha stays 1: AdditiveBlending multiplies by source alpha, which
          // would square the already-scaled brightness into near-invisibility.
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    markFx(this.mesh);
    scene.add(this.mesh);
  }

  setOn(on: boolean): void {
    this.mesh.visible = on;
  }

  /** Aims the beam from the torch toward its target, cut short by the first wall in the way. */
  update(from: THREE.Vector3, to: THREE.Vector3, wallBoxes: WallBox[]): void {
    this.dir.subVectors(to, from).normalize();
    const horiz = Math.hypot(this.dir.x, this.dir.z) || 1;
    const wall = rayToBoxes(from.x, from.z, this.dir.x / horiz, this.dir.z / horiz, BEAM_MAX_LEN, wallBoxes);
    const len = Math.min(BEAM_MAX_LEN, wall / horiz + 0.15);
    const radius = len * Math.tan(BEAM_HALF_ANGLE) * 0.85;
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(this.down, this.dir);
    this.mesh.scale.set(radius, len, radius);
  }
}

/** What a vision cone needs from a bot. */
export type ConeSource = { worldX: number; worldZ: number; facing: number; disabled: boolean; floorY: number; alert: boolean; viewHalfAngle?: number | undefined };

const CONE_RAYS = 22;
const CONE_SHOW_DIST = 18;

const coneMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xff3b3b) }, uAlpha: { value: 0.2 } },
    vertexShader: `
      attribute float aFade;
      varying float vFade;
      void main() { vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vFade;
      void main() { gl_FragColor = vec4(uColor, uAlpha * pow(1.0 - vFade, 0.8)); }`,
    transparent: true,
    depthWrite: false,
  });

type Cone = { wedge: THREE.Mesh; ring: THREE.Mesh; mat: THREE.ShaderMaterial; ringMat: THREE.ShaderMaterial };

export class VisionCones {
  private readonly cones = new Map<ConeSource, Cone>();
  private readonly near: WallBox[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  private coneFor(src: ConeSource): Cone {
    let cone = this.cones.get(src);
    if (cone) return cone;
    const wedgeGeo = new THREE.BufferGeometry();
    wedgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONE_RAYS + 2) * 3), 3));
    const fade = new Float32Array(CONE_RAYS + 2);
    for (let i = 1; i < fade.length; i++) fade[i] = 1;
    wedgeGeo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    const idx: number[] = [];
    for (let i = 1; i <= CONE_RAYS; i++) idx.push(0, i, i + 1);
    wedgeGeo.setIndex(idx);
    const mat = coneMaterial();
    const wedge = new THREE.Mesh(wedgeGeo, mat);
    wedge.frustumCulled = false;
    wedge.renderOrder = 3;

    // Awareness ring: a flat disc, fading outward, drawn as a fan too.
    const RING = 28;
    const ringGeo = new THREE.BufferGeometry();
    const rp = new Float32Array((RING + 2) * 3);
    const rf = new Float32Array(RING + 2);
    for (let i = 0; i <= RING; i++) {
      const a = (i / RING) * Math.PI * 2;
      rp[(i + 1) * 3] = Math.sin(a);
      rp[(i + 1) * 3 + 2] = Math.cos(a);
      rf[i + 1] = 1;
    }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    ringGeo.setAttribute('aFade', new THREE.BufferAttribute(rf, 1));
    const ridx: number[] = [];
    for (let i = 1; i <= RING; i++) ridx.push(0, i, i + 1);
    ringGeo.setIndex(ridx);
    const ringMat = coneMaterial();
    ringMat.uniforms.uAlpha!.value = 0.1;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 3;

    markFx(wedge);
    markFx(ring);
    this.scene.add(wedge, ring);
    cone = { wedge, ring, mat, ringMat };
    this.cones.set(src, cone);
    return cone;
  }

  /** Redraws cones for `bots` (the active floor's) and hides every other cone. */
  update(bots: ConeSource[], wallBoxes: WallBox[], playerX: number, playerZ: number, sneaking: boolean): void {
    const active = new Set(bots);
    for (const [src, cone] of this.cones) {
      if (!active.has(src)) cone.wedge.visible = cone.ring.visible = false;
    }
    const radius = sneaking ? SNEAK_DETECT_RADIUS : DETECT_RADIUS;
    const aware = sneaking ? SNEAK_AWARE_RADIUS : AWARE_RADIUS;
    for (const src of bots) {
      const cone = this.coneFor(src);
      const show = !src.disabled && Math.hypot(src.worldX - playerX, src.worldZ - playerZ) < CONE_SHOW_DIST;
      cone.wedge.visible = cone.ring.visible = show;
      if (!show) continue;

      this.near.length = 0;
      for (const b of wallBoxes) {
        if (b.maxX > src.worldX - radius && b.minX < src.worldX + radius && b.maxZ > src.worldZ - radius && b.minZ < src.worldZ + radius) this.near.push(b);
      }
      const y = src.floorY + 0.03;
      const pos = cone.wedge.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, src.worldX, y, src.worldZ);
      for (let i = 0; i <= CONE_RAYS; i++) {
        const half = src.viewHalfAngle ?? VIEW_HALF_ANGLE;
        const a = src.facing - half + (i / CONE_RAYS) * half * 2;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const d = rayToBoxes(src.worldX, src.worldZ, dx, dz, radius, this.near);
        pos.setXYZ(i + 1, src.worldX + dx * d, y, src.worldZ + dz * d);
      }
      pos.needsUpdate = true;
      cone.mat.uniforms.uAlpha!.value = src.alert ? 0.22 : 0.11;

      cone.ring.position.set(src.worldX, y - 0.005, src.worldZ);
      cone.ring.scale.set(aware, 1, aware);
      cone.ringMat.uniforms.uAlpha!.value = src.alert ? 0.12 : 0.06;
    }
  }
}

const DUST_COUNT = 420;
const DUST_BOX = 12; // world units the dust field tiles across, centred on the player
const DUST_HEIGHT = 2.6;

export class Dust {
  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(DUST_COUNT * 3);
    const seed = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      pos[i * 3] = Math.random() * DUST_BOX;
      pos[i * 3 + 1] = 0.15 + Math.random() * DUST_HEIGHT;
      pos[i * 3 + 2] = Math.random() * DUST_BOX;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uTorchPos: { value: new THREE.Vector3() },
        uTorchDir: { value: new THREE.Vector3(0, 0, 1) },
        uCos: { value: Math.cos(Math.PI / 5) },
        uColor: { value: TORCH_COLOR },
      },
      vertexShader: `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uTorchPos;
        uniform vec3 uTorchDir;
        uniform float uCos;
        attribute float aSeed;
        varying float vLit;
        const float BOX = ${DUST_BOX.toFixed(1)};
        void main() {
          // World-fixed, tiling around the player: motes stay put in the world as the player walks.
          vec3 drift = vec3(sin(uTime * 0.13 + aSeed * 40.0), sin(uTime * 0.21 + aSeed * 17.0) * 0.4, cos(uTime * 0.11 + aSeed * 23.0)) * 0.35;
          vec3 p = position + drift;
          p.xz = mod(p.xz - uCenter.xz + BOX * 0.5, BOX) - BOX * 0.5 + uCenter.xz;
          p.y += uCenter.y;
          vec3 toP = p - uTorchPos;
          float dist = length(toP);
          float inCone = smoothstep(uCos, uCos + 0.08, dot(toP / max(dist, 0.001), uTorchDir));
          vLit = inCone * smoothstep(7.0, 1.0, dist) * (0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 60.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.6 + aSeed * 2.2) * (60.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vLit;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = vLit * smoothstep(0.5, 0.0, r) * 0.55;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * a, 1.0); // see TorchBeam: additive blending already scales by alpha
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    markFx(this.points);
    scene.add(this.points);
  }

  /** Motes only show in the torch's light. */
  setOn(on: boolean): void {
    this.points.visible = on;
  }

  update(time: number, center: THREE.Vector3, torchPos: THREE.Vector3, torchTarget: THREE.Vector3): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    (u.uCenter!.value as THREE.Vector3).copy(center);
    (u.uTorchPos!.value as THREE.Vector3).copy(torchPos);
    (u.uTorchDir!.value as THREE.Vector3).subVectors(torchTarget, torchPos).normalize();
  }
}

/** A room's animatable glows, tagged with the room kind that decides how they move. */
export type GlowGroup = { kind: string; glows: Glow[] };

/**
 * Small ambient motion so the building feels powered and alive: rack LEDs
 * chase in waves (they switch to the key colour once a grid comes online —
 * rooms.ts owns the colour, this owns the motion), laptop and wall screens
 * flicker faintly, other glows breathe slowly, and a couple of ceiling
 * fixtures per floor stutter every so often.
 */
export class Ambient {
  private readonly items: Array<{ glow: Glow; phase: number; mode: 'chase' | 'flicker' | 'breathe' }> = [];
  private readonly stutters: Array<{ light: THREE.PointLight; mat: THREE.MeshStandardMaterial; base: number; next: number; until: number }> = [];

  constructor(groups: GlowGroup[], fixtures: Array<{ light: THREE.PointLight; mesh: THREE.Mesh }>) {
    for (const g of groups) {
      g.glows.forEach((glow, i) => {
        const racks = g.kind === 'server' || g.kind === 'rack' || g.kind === 'uplink' || g.kind === 'logs';
        const screens = g.kind === 'terminal' || g.kind === 'office';
        this.items.push({ glow, phase: racks ? i * 0.55 : Math.random() * 10, mode: racks ? 'chase' : screens ? 'flicker' : 'breathe' });
      });
    }
    const picks = [...fixtures].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const f of picks) {
      this.stutters.push({ light: f.light, mat: f.mesh.material as THREE.MeshStandardMaterial, base: f.light.intensity, next: 2 + Math.random() * 6, until: 0 });
    }
  }

  update(t: number): void {
    for (const it of this.items) {
      const b = it.glow.base;
      let k: number;
      if (it.mode === 'chase') k = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3.2 - it.phase));
      else if (it.mode === 'flicker') k = 0.9 + 0.1 * Math.sin(t * 31 + it.phase) * Math.sin(t * 7.3 + it.phase * 2);
      else k = 0.85 + 0.15 * Math.sin(t * 0.9 + it.phase);
      it.glow.mat.emissiveIntensity = b * k;
    }
    for (const s of this.stutters) {
      if (s.light.userData.broken) continue; // shot out — stays dark
      if (t > s.next) {
        s.until = t + 0.35 + Math.random() * 0.5;
        s.next = t + 5 + Math.random() * 9;
      }
      const on = t < s.until ? Math.random() < 0.45 : true;
      s.light.intensity = on ? s.base : s.base * 0.08;
      s.mat.emissiveIntensity = on ? 2.2 : 0.2;
    }
  }
}

type Burst = { points: THREE.Points; vel: Float32Array; life: number; age: number; gravity: number; grow: number };

/** Short-lived particle bursts: sparks where a shot lands, smoke where a bot goes down. */
export class Bursts {
  private readonly bursts: Burst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  private spawn(at: THREE.Vector3, count: number, color: number, size: number, speed: number, up: number, life: number, gravity: number, grow: number, additive: boolean): THREE.Points {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = at.x;
      pos[i * 3 + 1] = at.y;
      pos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.4 + Math.random() * 0.6);
      vel[i * 3] = Math.cos(a) * r;
      vel[i * 3 + 1] = up * (0.5 + Math.random());
      vel[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, life, age: 0, gravity, grow });
    return points;
  }

  sparks(at: THREE.Vector3, color = 0xffd27a): void {
    this.spawn(at, 26, color, 0.09, 3.2, 2.2, 0.45, 9, 0, true);
  }

  smoke(at: THREE.Vector3): void {
    // Kept out of the bloom pass — grey smoke shouldn't glow.
    markFx(this.spawn(at, 18, 0x8a9098, 0.55, 0.35, 0.6, 1.6, -0.4, 0.9, false));
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const mat = b.points.material as THREE.PointsMaterial;
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        mat.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let p = 0; p < pos.count; p++) {
        b.vel[p * 3 + 1]! -= b.gravity * dt;
        pos.setXYZ(p, pos.getX(p) + b.vel[p * 3]! * dt, pos.getY(p) + b.vel[p * 3 + 1]! * dt, pos.getZ(p) + b.vel[p * 3 + 2]! * dt);
      }
      pos.needsUpdate = true;
      const f = b.age / b.life;
      mat.opacity = 1 - f;
      if (b.grow) mat.size *= 1 + b.grow * dt;
    }
  }
}

/** A pulsing column of light over a storage room once its grid has marked it — visible above the walls from across the floor. */
export class Beacon {
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;

  constructor(parent: THREE.Object3D, x: number, z: number, color: number) {
    const geo = new THREE.CylinderGeometry(0.32, 0.32, 9, 18, 1, true);
    geo.translate(0, 4.5, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uPulse: { value: 1 } },
      vertexShader: 'varying float vY; void main() { vY = position.y / 9.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uPulse;
        varying float vY;
        void main() {
          float a = 0.32 * uPulse * pow(1.0 - vY, 1.3) * smoothstep(0.0, 0.05, vY);
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x, 0, z);
    markFx(this.mesh);
    parent.add(this.mesh);
  }

  update(t: number): void {
    this.material.uniforms.uPulse!.value = 0.7 + 0.3 * Math.sin(t * 3);
  }

  remove(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * How far the player's noise carries (enemies/noise.ts), drawn as a faint
 * ring on the floor around them — shown only while a watchdog is listening
 * on this floor, so walking visibly "throws" sound and freezing shrinks it
 * to nothing.
 */
export class NoiseRing {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private radius = 0;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    markFx(this.mesh);
    scene.add(this.mesh);
  }

  update(x: number, floorY: number, z: number, noise: number, listening: boolean, dt: number): void {
    // Eases toward the new reach, so the ring swells and settles rather than popping.
    this.radius += (noise - this.radius) * Math.min(1, dt * 6);
    const show = listening && this.radius > 0.3;
    this.mat.opacity += ((show ? 0.28 : 0) - this.mat.opacity) * Math.min(1, dt * 5);
    this.mesh.visible = this.mat.opacity > 0.01;
    this.mesh.position.set(x, floorY + 0.04, z);
    this.mesh.scale.setScalar(Math.max(0.01, this.radius));
  }
}

/**
 * A small white chevron bobbing over the enemy you can take down right now,
 * so the moment reads against its vision-cone sweep. Hidden when there's none.
 */
export class TakedownMarker {
  private readonly sprite: THREE.Sprite;

  constructor(scene: THREE.Scene) {
    // A flat, camera-facing chevron with a dark outline, so it reads as an
    // icon rather than another light. Drawn over everything: it only ever
    // shows for an enemy within arm's reach, and a doorway lintel or wall top
    // would otherwise hide it.
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(10, 16);
    ctx.lineTo(32, 48);
    ctx.lineTo(54, 16);
    ctx.lineTo(32, 28);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false }));
    this.sprite.scale.set(0.85, 0.85, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  update(target: { worldX: number; worldZ: number; floorY: number } | null, t: number): void {
    this.sprite.visible = target !== null;
    if (!target) return;
    this.sprite.position.set(target.worldX, target.floorY + 2.45 + Math.sin(t * 6) * 0.08, target.worldZ);
  }
}

/**
 * A reticle on the enemy the gun has in its sights: a ring with four ticks and a dot, on its chest, facing the camera and turning slowly. Red for a shot that stuns, cyan for an
 * EMP (the dogs), amber for a camera's switch, pale yellow for a light. Drawn over everything: it only ever shows for a target the gun can already see. Hidden when there is none.
 */
export class AimMarker {
  private readonly sprite: THREE.Sprite;
  private readonly textures: Record<'stun' | 'emp' | 'switch' | 'light', THREE.CanvasTexture>;

  constructor(scene: THREE.Scene) {
    const draw = (color: string): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 96;
      const ctx = c.getContext('2d')!;
      const stroke = (width: number, style: string): void => {
        ctx.lineWidth = width;
        ctx.strokeStyle = style;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(48, 48, 24, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(48 + Math.cos(a) * 17, 48 + Math.sin(a) * 17);
          ctx.lineTo(48 + Math.cos(a) * 38, 48 + Math.sin(a) * 38);
          ctx.stroke();
        }
      };
      stroke(9, 'rgba(8, 10, 14, 0.8)'); // the outline first, so the colour reads against light floors and dark ones
      stroke(4.5, color);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(48, 48, 4, 0, Math.PI * 2);
      ctx.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    this.textures = { stun: draw('#ff5a4a'), emp: draw('#5ee0ff'), switch: draw('#ffb04a'), light: draw('#fff1a0') };
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.stun, depthTest: false, depthWrite: false, transparent: true }));
    this.sprite.renderOrder = 11;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  /** `target`: where the gun is aimed (its chest is a metre or so up); `kind`: what a shot does to it. */
  update(target: { worldX: number; worldZ: number; floorY: number } | null, kind: 'stun' | 'emp' | 'switch' | 'light', t: number, camera?: THREE.Vector3, height = 1.15): void {
    this.sprite.visible = target !== null;
    if (!target) return;
    const mat = this.sprite.material;
    mat.map = this.textures[kind];
    mat.rotation = t * 0.9;
    // Big enough to read from the camera's height: it grows with the distance, so it is about as large on the screen near and far.
    const dist = camera ? Math.hypot(camera.x - target.worldX, camera.y - (target.floorY + height), camera.z - target.worldZ) : 12;
    const size = Math.max(1.5, dist * 0.13) * (1 + Math.sin(t * 7) * 0.04);
    this.sprite.scale.set(size, size, 1);
    this.sprite.position.set(target.worldX, target.floorY + height, target.worldZ);
  }
}

/**
 * Enemies tagged from a lookout (the top of a tower): a small amber diamond
 * over each, drawn over everything so it shows through walls, fading as the
 * tag runs out.
 */
export class TagMarkers {
  private readonly sprites: THREE.Sprite[] = [];
  private readonly material: THREE.SpriteMaterial;

  constructor(private readonly scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(52, 32);
    ctx.lineTo(32, 56);
    ctx.lineTo(12, 32);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
    ctx.stroke();
    ctx.fillStyle = '#ffb04a';
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  }

  /** Shows a marker at each of `at` (world), `alpha` its opacity; hides the rest. */
  update(at: Array<{ x: number; y: number; z: number; alpha: number }>): void {
    while (this.sprites.length < at.length) {
      const s = new THREE.Sprite(this.material.clone());
      s.scale.set(0.9, 0.9, 1);
      s.renderOrder = 10;
      this.scene.add(s);
      this.sprites.push(s);
    }
    this.sprites.forEach((s, i) => {
      const a = at[i];
      s.visible = a !== undefined;
      if (!a) return;
      s.position.set(a.x, a.y, a.z);
      s.material.opacity = a.alpha;
    });
  }

  dispose(): void {
    for (const s of this.sprites) {
      this.scene.remove(s);
      s.material.dispose();
    }
    this.material.map?.dispose();
    this.material.dispose();
  }
}

/**
 * The alarm's red strobe: while it's up, the building's ambient light turns
 * red and pulses; when it clears, it eases back to normal.
 */
export class AlarmLights {
  private readonly baseSky: THREE.Color;
  private readonly baseGround: THREE.Color;
  private readonly baseIntensity: number;
  private mix = 0;

  constructor(private readonly light: THREE.HemisphereLight) {
    this.baseSky = light.color.clone();
    this.baseGround = light.groundColor.clone();
    this.baseIntensity = light.intensity;
  }

  update(t: number, on: boolean, dt: number): void {
    this.mix += ((on ? 1 : 0) - this.mix) * Math.min(1, dt * 3);
    if (this.mix < 0.001 && !on) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.1);
    this.light.color.copy(this.baseSky).lerp(ALARM_RED, this.mix);
    this.light.groundColor.copy(this.baseGround).lerp(ALARM_RED_DIM, this.mix);
    this.light.intensity = this.baseIntensity + this.mix * (0.35 + 0.55 * pulse);
  }
}

const ALARM_RED = new THREE.Color(0xff2a1f);
const ALARM_RED_DIM = new THREE.Color(0x3a0806);
