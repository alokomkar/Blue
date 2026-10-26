// Things that go bang, crackle and bark, seen as well as heard (the mockup's first section): a blast (flash, fireball, smoke, sparks, debris, a shock ring and a scorch on the floor),
// live wire arcing between two points, and the rings and the word a watchdog gives itself away with. All sprites and a few meshes, and at most one pooled light each (pulselights.ts):
// nothing here changes how many lights the scene has.

import * as THREE from 'three';
import { giveLight, takeLight } from './pulselights';

const MAX_SCORCHES = 6;
const SCORCH_LIFE_S = 40;
const ARC_POINTS = 22;
const ARC_LINES = 6;
const ARC_REFRESH_S = 0.045;

type Particle = {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  max: number;
  delay: number;
  grav: number;
  drag: number;
  spin: THREE.Vector3 | null;
  floor: number | null;
  upd: ((p: Particle, k: number) => void) | null;
  disposeMaterial: boolean;
};

type Arc = { lines: THREE.Line[]; glow: THREE.Sprite; light: THREE.PointLight; from: () => THREE.Vector3; to: () => THREE.Vector3; left: number; acc: number };
type Flash = { light: THREE.PointLight; peak: number; age: number; life: number };

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

function radialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wordTexture(word: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.font = '800 64px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(word, 128, 50);
  ctx.fillStyle = color;
  ctx.fillText(word, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Blasts {
  private readonly parts: Particle[] = [];
  private readonly arcs: Arc[] = [];
  private readonly flashes: Flash[] = [];
  private readonly scorches: Array<{ mesh: THREE.Mesh; age: number }> = [];
  private readonly glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  private readonly smokeTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.55, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  private readonly wordTex = wordTexture('WOOF!', '#ffd0c0');
  private readonly words = new Map<string, THREE.CanvasTexture>();
  private readonly debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly debrisMats = [0x7a2a22, 0x2a2a2e].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 }));
  private readonly ringGeo = new THREE.RingGeometry(0.92, 1, 64);
  private readonly scorchGeo = new THREE.CircleGeometry(1, 32);
  private readonly shardMat = new THREE.MeshBasicMaterial({ color: 0xaef0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });

  constructor(private readonly scene: THREE.Scene) {}

  private sprite(tex: THREE.Texture, size: number, color: number, opacity = 1, additive = true): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    );
    s.scale.setScalar(size);
    s.userData.fx = true;
    return s;
  }

  private add(obj: THREE.Object3D, at: THREE.Vector3, o: Partial<Omit<Particle, 'obj'>> = {}): void {
    obj.position.copy(at);
    const delay = o.delay ?? 0;
    obj.visible = delay <= 0;
    this.scene.add(obj);
    const life = o.life ?? 1;
    this.parts.push({ obj, vel: o.vel ?? new THREE.Vector3(), life, max: life, delay, grav: o.grav ?? 0, drag: o.drag ?? 0, spin: o.spin ?? null, floor: o.floor ?? null, upd: o.upd ?? null, disposeMaterial: o.disposeMaterial ?? true });
  }

  /** A blast at `at`. `scale` 1 is a barrel or a charge; a mine is smaller. */
  boom(at: THREE.Vector3, scale = 1): void {
    const c = at.clone();
    const floor = at.y - Math.min(at.y, 0.8);
    const flash = takeLight(this.scene, 0xffa04a, 18 * scale + 6);
    flash.position.set(c.x, c.y + 0.8, c.z);
    this.flashes.push({ light: flash, peak: 2600 * scale, age: 0, life: 0.55 });
    this.add(this.sprite(this.glowTex, 9 * scale, 0xffe6b0), c, {
      life: 0.24,
      upd: (p, k) => {
        const s = p.obj as THREE.Sprite;
        s.material.opacity = (1 - k) ** 2;
        s.scale.setScalar((9 + 5 * k) * scale);
      },
    });
    const fire = Math.round(18 * Math.min(1, scale + 0.3));
    for (let i = 0; i < fire; i++) {
      const s = this.sprite(this.glowTex, rnd(1.4, 2.4) * scale, 0xffb040);
      const s0 = s.scale.x;
      this.add(s, c.clone().add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.2, 0.5), rnd(-0.5, 0.5)).multiplyScalar(scale)), {
        vel: new THREE.Vector3(rnd(-3, 3), rnd(1.5, 5.5), rnd(-3, 3)).multiplyScalar(scale),
        life: rnd(0.55, 1.05),
        drag: 1.8,
        upd: (p, k) => {
          const sp = p.obj as THREE.Sprite;
          sp.scale.setScalar(s0 * (1 + 2.4 * k));
          sp.material.opacity = (1 - k) ** 1.4;
          sp.material.color.setHex(0xfff0a0).lerp(new THREE.Color(0xff3e10), k);
        },
      });
    }
    const smoke = Math.round(12 * Math.min(1, scale + 0.2));
    for (let i = 0; i < smoke; i++) {
      const s = this.sprite(this.smokeTex, 2, 0x2c2c30, 0, false);
      const s0 = rnd(2, 3.2) * scale;
      this.add(s, c.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(0, 0.8), rnd(-1, 1)).multiplyScalar(scale)), {
        vel: new THREE.Vector3(rnd(-0.8, 0.8), rnd(1.2, 2.6), rnd(-0.8, 0.8)),
        life: rnd(1.8, 2.8),
        delay: rnd(0.1, 0.5),
        drag: 0.5,
        upd: (p, k) => {
          const sp = p.obj as THREE.Sprite;
          sp.scale.setScalar(s0 * (1 + 2 * k));
          sp.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.5;
        },
      });
    }
    for (let i = 0; i < 50 * scale; i++) {
      const s = this.sprite(this.glowTex, rnd(0.12, 0.22), 0xffd27a);
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(5, 15) * scale;
      this.add(s, c.clone(), {
        vel: new THREE.Vector3(Math.cos(a) * sp, rnd(2, 10), Math.sin(a) * sp),
        life: rnd(0.7, 1.5),
        grav: -22,
        upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = 1 - k),
      });
    }
    for (let i = 0; i < 10 * scale; i++) {
      const d = new THREE.Mesh(this.debrisGeo, this.debrisMats[i % 3 ? 0 : 1]!);
      d.scale.set(rnd(0.12, 0.32), rnd(0.06, 0.2), rnd(0.12, 0.32));
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(3, 8);
      this.add(d, c.clone(), {
        vel: new THREE.Vector3(Math.cos(a) * sp, rnd(4, 9), Math.sin(a) * sp),
        life: 3.4,
        grav: -20,
        spin: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)),
        floor,
        disposeMaterial: false,
        upd: (p, k) => {
          if (k > 0.8) p.obj.scale.setScalar(Math.max(0.01, 1 - (k - 0.8) * 5) * 0.2);
        },
      });
    }
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.userData.fx = true;
    this.add(ring, new THREE.Vector3(c.x, floor + 0.08, c.z), {
      life: 0.75,
      upd: (p, k) => {
        p.obj.scale.setScalar((1 + 11 * k) * scale);
        ((p.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      },
    });
    this.scorch(c.x, floor + 0.02, c.z, 2.2 * scale);
  }

  /** A shock grenade going off at `at`: a cyan flash, a ring spreading over the floor, sparks, and arcs crawling out over the ground for a moment. */
  shock(at: THREE.Vector3): void {
    const c = at.clone();
    const flash = takeLight(this.scene, 0x7fd8ff, 14);
    flash.position.set(c.x, c.y + 0.8, c.z);
    this.flashes.push({ light: flash, peak: 1400, age: 0, life: 0.5 });
    this.add(this.sprite(this.glowTex, 8, 0x9fe6ff), c.clone().add(new THREE.Vector3(0, 0.6, 0)), {
      life: 0.3,
      upd: (p, k) => {
        const s = p.obj as THREE.Sprite;
        s.material.opacity = (1 - k) ** 2;
        s.scale.setScalar(8 + 4 * k);
      },
    });
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.userData.fx = true;
    this.add(ring, new THREE.Vector3(c.x, c.y + 0.08, c.z), {
      life: 0.8,
      upd: (p, k) => {
        p.obj.scale.setScalar(1 + 5 * k);
        ((p.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      },
    });
    for (let i = 0; i < 36; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(3, 9);
      this.add(this.sprite(this.glowTex, rnd(0.1, 0.2), 0x7fd8ff), c.clone().add(new THREE.Vector3(0, 0.4, 0)), {
        vel: new THREE.Vector3(Math.cos(a) * sp, rnd(1, 5), Math.sin(a) * sp),
        life: rnd(0.4, 0.9),
        grav: -14,
        upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = 1 - k),
      });
    }
    // Arcs along the floor, a few at a time, for a second or so.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd(-0.4, 0.4);
      const len = rnd(1.8, 3);
      const end = new THREE.Vector3(c.x + Math.cos(a) * len, c.y + 0.15, c.z + Math.sin(a) * len);
      this.zap(() => new THREE.Vector3(c.x, c.y + 0.15, c.z), () => end, 1.1, 0x7fd8ff);
    }
  }

  /** The partner phasing out of, or in at, a spot: a cyan column of light, a ring on the floor and a few sparks lifting, so a regroup reads as done on purpose and not as a glitch. */
  phase(at: THREE.Vector3): void {
    const col = this.sprite(this.glowTex, 1, 0x7fd8ff);
    col.scale.set(1.3, 3.4, 1);
    this.add(col, at.clone().add(new THREE.Vector3(0, 1.2, 0)), {
      life: 0.5,
      upd: (p, k) => {
        const s = p.obj as THREE.Sprite;
        s.material.opacity = (1 - k) ** 1.5;
        s.scale.set(1.3 * (1 - 0.6 * k), 3.4 * (1 + 0.3 * k), 1);
      },
    });
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.userData.fx = true;
    this.add(ring, new THREE.Vector3(at.x, at.y + 0.06, at.z), {
      life: 0.6,
      upd: (p, k) => {
        p.obj.scale.setScalar(0.4 + 1.8 * k);
        ((p.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      },
    });
    for (let i = 0; i < 14; i++) {
      this.add(this.sprite(this.glowTex, rnd(0.08, 0.16), 0x9fe6ff), at.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), rnd(0, 1.6), rnd(-0.4, 0.4))), {
        vel: new THREE.Vector3(rnd(-0.5, 0.5), rnd(1, 2.5), rnd(-0.5, 0.5)),
        life: rnd(0.4, 0.8),
        upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = 1 - k),
      });
    }
  }

  /** A word over a spot, floating up and fading (a dog's YELP, a guard's cough). */
  word(x: number, y: number, z: number, text: string, color = '#bfeeff'): void {
    let tex = this.words.get(text + color);
    if (!tex) {
      tex = wordTexture(text, color);
      this.words.set(text + color, tex);
    }
    const w = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    w.scale.set(1.6, 0.6, 1);
    w.renderOrder = 10;
    w.userData.fx = true;
    this.add(w, new THREE.Vector3(x, y, z), { life: 1.3, vel: new THREE.Vector3(0, 0.7, 0), upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = THREE.MathUtils.clamp(1 - k, 0, 1)) });
  }

  /** A pane of glass, `size` metres across, breaking where it hangs at `at`: shards falling to `floorY`, glints, and a shower of light dust. */
  glass(at: THREE.Vector3, size: number, floorY: number): void {
    const n = 8;
    const step = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x0 = -size / 2 + i * step;
        const z0 = -size / 2 + j * step;
        const jx = rnd(-0.06, 0.06) * step * 4;
        const jz = rnd(-0.06, 0.06) * step * 4;
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0 + jx, 0, z0 + jz), new THREE.Vector3(x0 + step, 0, z0 + jz * 0.5), new THREE.Vector3(x0 + jx * 0.5, 0, z0 + step)]);
        const m = new THREE.Mesh(geo, this.shardMat);
        m.userData.fx = true;
        m.userData.ownGeo = true;
        this.add(m, at.clone(), {
          vel: new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.5, 1.2), rnd(-1.2, 1.2)),
          life: 6,
          grav: -14,
          spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)),
          floor: floorY - 0.05,
          disposeMaterial: false,
          upd: (p, k) => {
            if (k > 0.8) p.obj.scale.setScalar(Math.max(0.01, 1 - (k - 0.8) * 5));
          },
        });
      }
    }
    for (let i = 0; i < 40; i++) {
      const s = this.sprite(this.glowTex, rnd(0.08, 0.2), 0xd8f8ff);
      this.add(s, at.clone().add(new THREE.Vector3(rnd(-size / 3, size / 3), 0, rnd(-size / 3, size / 3))), {
        vel: new THREE.Vector3(rnd(-3, 3), rnd(0, 3), rnd(-3, 3)),
        life: rnd(0.5, 1),
        grav: -10,
        upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = 1 - k),
      });
    }
  }

  private scorch(x: number, y: number, z: number, radius: number): void {
    if (this.scorches.length >= MAX_SCORCHES) this.dropScorch(this.scorches.shift()!);
    const mesh = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(radius);
    mesh.userData.fx = true;
    this.scene.add(mesh);
    this.scorches.push({ mesh, age: 0 });
  }

  private dropScorch(s: { mesh: THREE.Mesh }): void {
    this.scene.remove(s.mesh);
    (s.mesh.material as THREE.Material).dispose();
  }

  /**
   * Live wire from `from` to `to` for `seconds`: jagged arcs re-drawn many times a second, a hot spot where they land and a flickering light. The two are read each frame, so
   * they can follow a body that is twitching.
   */
  zap(from: () => THREE.Vector3, to: () => THREE.Vector3, seconds = 1, color = 0x7fd8ff): void {
    const lines: THREE.Line[] = [];
    for (let i = 0; i < ARC_LINES; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xbdeeff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      line.frustumCulled = false;
      line.userData.fx = true;
      this.scene.add(line);
      lines.push(line);
    }
    const glow = this.sprite(this.glowTex, 1.8, color);
    this.scene.add(glow);
    const light = takeLight(this.scene, color, 14);
    this.arcs.push({ lines, glow, light, from, to, left: seconds, acc: 1 });
  }

  private redraw(a: Arc): void {
    const A = a.from();
    const B = a.to();
    for (const line of a.lines) {
      const arr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const end = B.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), rnd(-0.3, 0.3), rnd(-0.1, 0.1)));
      for (let i = 0; i < ARC_POINTS; i++) {
        const t = i / (ARC_POINTS - 1);
        const amp = Math.sin(Math.PI * t) * 0.55;
        arr.setXYZ(i, THREE.MathUtils.lerp(A.x, end.x, t) + rnd(-amp, amp) * 0.6, THREE.MathUtils.lerp(A.y, end.y, t) + rnd(-amp, amp), THREE.MathUtils.lerp(A.z, end.z, t) + rnd(-amp, amp) * 0.6);
      }
      arr.needsUpdate = true;
    }
    a.glow.position.copy(B);
    a.glow.scale.setScalar(rnd(1.4, 2.4));
    a.light.position.set(B.x, B.y + 0.4, B.z);
  }

  /** A watchdog's bark made visible: three rings spreading over the floor and the word, lifting off its head. */
  bark(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xff7a5a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      r.rotation.x = -Math.PI / 2;
      r.userData.fx = true;
      this.add(r, new THREE.Vector3(x, y + 0.06, z), {
        life: 1.4 + i * 0.3,
        delay: i * 0.3,
        upd: (p, k) => {
          p.obj.scale.setScalar(1 + 10.5 * k);
          ((p.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k) ** 1.4;
        },
      });
    }
    const w = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.wordTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    w.scale.set(1.6, 0.6, 1);
    w.renderOrder = 10;
    w.userData.fx = true;
    this.add(w, new THREE.Vector3(x, y + 2.1, z), {
      life: 1.4,
      vel: new THREE.Vector3(0, 0.8, 0),
      disposeMaterial: true,
      upd: (p, k) => ((p.obj as THREE.Sprite).material.opacity = THREE.MathUtils.clamp(1 - k, 0, 1)),
    });
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0) p.obj.visible = true;
        continue;
      }
      p.life -= dt;
      const k = THREE.MathUtils.clamp(1 - p.life / p.max, 0, 1);
      p.vel.y += p.grav * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.obj.position.addScaledVector(p.vel, dt);
      if (p.spin) {
        p.obj.rotation.x += p.spin.x * dt;
        p.obj.rotation.y += p.spin.y * dt;
        p.obj.rotation.z += p.spin.z * dt;
      }
      if (p.floor !== null && p.obj.position.y < p.floor + 0.1) {
        p.obj.position.y = p.floor + 0.1;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        if (p.vel.y < 0.6) {
          p.vel.y = 0;
          p.spin = null;
        }
      }
      p.upd?.(p, k);
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        if (p.obj.userData.ownGeo) (p.obj as THREE.Mesh).geometry.dispose();
        const m = (p.obj as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
        if (m && p.disposeMaterial) m.dispose();
        this.parts.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.age += dt;
      const k = Math.min(1, f.age / f.life);
      f.light.intensity = f.peak * (1 - k) ** 2;
      if (k >= 1) {
        giveLight(this.scene, f.light);
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      a.left -= dt;
      a.acc += dt;
      if (a.left > 0) {
        if (a.acc >= ARC_REFRESH_S) {
          a.acc = 0;
          this.redraw(a);
        }
        a.light.intensity = rnd(150, 700);
        continue;
      }
      for (const line of a.lines) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      this.scene.remove(a.glow);
      a.glow.material.dispose();
      giveLight(this.scene, a.light);
      this.arcs.splice(i, 1);
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]!;
      s.age += dt;
      if (s.age > SCORCH_LIFE_S - 8) (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0, (SCORCH_LIFE_S - s.age) / 8);
      if (s.age >= SCORCH_LIFE_S) {
        this.dropScorch(s);
        this.scorches.splice(i, 1);
      }
    }
  }
}
