// Draws bunkersigns.ts's writing: every label of a storey is painted once onto one canvas (an atlas), and all the quads that show them are one mesh, so a storey's writing costs a draw call and a
// texture. Wall labels follow their wall's fade (a wall ghosting out takes its writing with it), and a container's go when it is destroyed.

import * as THREE from 'three';
import type { Sign, SignStyle } from './bunkersigns';
import type { Tag } from './signage';

/** Pixels to the metre of each kind of label (the texture's sharpness). */
const PPM: Record<SignStyle, number> = { big: 120, plate: 150, stencil: 125, faint: 130 };
const FONT = '"Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif';
const ATLAS_W = 2048;

const css = (r: number, g: number, b: number, a: number): string => `rgba(${r},${g},${b},${a})`;

/** Weathering: small bites out of what was painted, so it reads as stencil and paint, not a print. */
function weather(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  let t = seed * 9301 + 49297;
  const r = (): number => {
    t = (t * 9301 + 49297) % 233280;
    return t / 233280;
  };
  for (let i = 0; i < Math.max(12, (w * h) / 900); i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.35})`;
    ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 2);
  }
  ctx.restore();
}

/** Text fitted in a box: the biggest font up to `maxPx` at which the line fits `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, maxPx: number, weight = 'bold'): number {
  let px = maxPx;
  ctx.font = `${weight} ${px}px ${FONT}`;
  const m = ctx.measureText(text).width;
  if (m > width) px = Math.max(8, Math.floor((px * width) / m));
  ctx.font = `${weight} ${px}px ${FONT}`;
  return px;
}

function paint(ctx: CanvasRenderingContext2D, sign: Sign, x: number, y: number, pw: number, ph: number, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = sign.lines;
  if (sign.style === 'plate') {
    const warn = sign.lines[0]!.startsWith('AUTHORISED') || sign.lines[0]!.startsWith('MIND');
    ctx.fillStyle = css(30, 34, 38, 0.93);
    ctx.fillRect(0, 0, pw, ph);
    ctx.strokeStyle = warn ? css(206, 170, 52, 0.95) : css(214, 218, 214, 0.8);
    ctx.lineWidth = Math.max(2, ph * 0.045);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, pw - ctx.lineWidth * 2, ph - ctx.lineWidth * 2);
    ctx.fillStyle = warn ? css(228, 190, 70, 0.95) : css(232, 234, 228, 0.92);
    const rows = lines.length;
    lines.forEach((line, i) => {
      const top = i === 0;
      const px = fit(ctx, line, pw * 0.88, top ? ph * (rows > 1 ? 0.34 : 0.42) : ph * 0.2, top ? 'bold' : '600');
      void px;
      ctx.fillStyle = top ? (warn ? css(228, 190, 70, 0.95) : css(236, 238, 232, 0.94)) : css(184, 192, 190, 0.85);
      ctx.fillText(line, pw / 2, rows > 1 ? ph * (top ? 0.36 : 0.72) : ph / 2);
    });
  } else if (sign.style === 'big') {
    // 'SECTOR' small above, the letter huge below, in safety yellow with the stencil's gaps.
    ctx.fillStyle = css(214, 180, 62, 0.82);
    fit(ctx, lines[0] ?? '', pw * 0.8, ph * 0.12);
    ctx.fillText(lines[0] ?? '', pw / 2, ph * 0.1);
    const big = lines[1] ?? '';
    ctx.font = `bold ${Math.floor(ph * 0.78)}px ${FONT}`;
    ctx.fillText(big, pw / 2, ph * 0.56);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, ph * 0.5, pw, Math.max(2, ph * 0.012)); // (a stencil's bridge across the letter)
    ctx.fillRect(pw * 0.5 - 1, ph * 0.15, Math.max(2, pw * 0.012), ph * 0.8);
  } else if (sign.style === 'faint') {
    ctx.fillStyle = css(196, 208, 212, 0.32);
    lines.forEach((line, i) => {
      fit(ctx, line, pw * 0.92, ph * (lines.length > 1 ? 0.4 : 0.7), '600');
      ctx.fillText(line, pw / 2, lines.length > 1 ? ph * (i === 0 ? 0.3 : 0.74) : ph / 2);
    });
  } else {
    // Stencil: white paint, the first line big, the next smaller.
    ctx.fillStyle = css(232, 232, 220, 0.8);
    lines.forEach((line, i) => {
      fit(ctx, line, pw * 0.94, i === 0 ? ph * (lines.length > 1 ? 0.56 : 0.82) : ph * 0.34);
      ctx.fillText(line, pw / 2, lines.length > 1 ? ph * (i === 0 ? 0.32 : 0.8) : ph / 2);
    });
    // the gaps the stencil's bridges leave
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    for (let k = 1; k < 8; k++) ctx.fillRect((pw * k) / 8, 0, 1.5, ph);
  }
  ctx.restore();
  weather(ctx, x, y, pw, ph, seed);
}

export type SignLayer = {
  group: THREE.Mesh;
  /** Eases each wall label with its wall's fade: `fadeAt(x, z)` is the wall's, 0 solid to 1 ghosted (floor-local metres). */
  followWalls: (fadeAt: (x: number, z: number) => number) => void;
  /** The labels of a destroyed container are gone. */
  hide: (key: string) => void;
  dispose: () => void;
};

/** Paints the labels and builds the one mesh that shows them, as a child of `parent` (the storey's group). */
export function buildSigns(parent: THREE.Object3D, signs: readonly Sign[]): SignLayer {
  type Cell = { x: number; y: number; w: number; h: number };
  const cells = new Map<string, Cell>();
  const sizeOf = (s: Sign, k: number): { pw: number; ph: number } => ({ pw: Math.max(24, Math.round(s.w * PPM[s.style] * k)), ph: Math.max(16, Math.round(s.h * PPM[s.style] * k)) });
  const keyOf = (s: Sign, pw: number, ph: number): string => `${s.style}|${s.lines.join('/')}|${pw}x${ph}`;
  // Pack in rows; shrink everything if it will not fit in the atlas.
  let scale = 1;
  const pack = (k: number): number => {
    cells.clear();
    let x = 0;
    let y = 0;
    let row = 0;
    for (const s of signs) {
      const { pw, ph } = sizeOf(s, k);
      const key = keyOf(s, pw, ph);
      if (cells.has(key)) continue;
      if (x + pw > ATLAS_W) {
        x = 0;
        y += row + 2;
        row = 0;
      }
      cells.set(key, { x, y, w: pw, h: ph });
      x += pw + 2;
      row = Math.max(row, ph);
    }
    return y + row + 2;
  };
  let height = pack(scale);
  while (height > 2048 && scale > 0.4) {
    scale *= 0.85;
    height = pack(scale);
  }
  const H = Math.min(2048, Math.max(64, 2 ** Math.ceil(Math.log2(height))));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  let seed = 1;
  const painted = new Set<string>();
  for (const s of signs) {
    const { pw, ph } = sizeOf(s, scale);
    const key = keyOf(s, pw, ph);
    if (painted.has(key)) continue;
    painted.add(key);
    const c = cells.get(key)!;
    paint(ctx, s, c.x, c.y, c.w, c.h, seed++);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const pos = new Float32Array(signs.length * 12);
  const uv = new Float32Array(signs.length * 8);
  const col = new Float32Array(signs.length * 16).fill(1);
  const nrm = new Float32Array(signs.length * 12);
  const idx: number[] = [];
  signs.forEach((s, i) => {
    const { pw, ph } = sizeOf(s, scale);
    const c = cells.get(keyOf(s, pw, ph))!;
    // The quad's right and up vectors and its normal.
    const R = s.flat ? [Math.cos(s.angle), 0, Math.sin(s.angle)] : [Math.cos(s.angle), 0, -Math.sin(s.angle)];
    const U = s.flat ? [Math.sin(s.angle), 0, -Math.cos(s.angle)] : [0, 1, 0];
    const N = s.flat ? [0, 1, 0] : [Math.sin(s.angle), 0, Math.cos(s.angle)];
    const corners = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ] as const;
    corners.forEach(([a, b], k) => {
      const o = i * 12 + k * 3;
      pos[o] = s.x + (R[0]! * a * s.w) / 2 + (U[0]! * b * s.h) / 2;
      pos[o + 1] = s.y + (R[1]! * a * s.w) / 2 + (U[1]! * b * s.h) / 2;
      pos[o + 2] = s.z + (R[2]! * a * s.w) / 2 + (U[2]! * b * s.h) / 2;
      nrm[o] = N[0]!;
      nrm[o + 1] = N[1]!;
      nrm[o + 2] = N[2]!;
      uv[i * 8 + k * 2] = (c.x + (a > 0 ? c.w : 0)) / ATLAS_W;
      uv[i * 8 + k * 2 + 1] = 1 - (c.y + (b > 0 ? 0 : c.h)) / H;
    });
    // wind the two triangles so they face along N
    const e1 = [pos[i * 12 + 3]! - pos[i * 12]!, pos[i * 12 + 4]! - pos[i * 12 + 1]!, pos[i * 12 + 5]! - pos[i * 12 + 2]!];
    const e2 = [pos[i * 12 + 6]! - pos[i * 12]!, pos[i * 12 + 7]! - pos[i * 12 + 1]!, pos[i * 12 + 8]! - pos[i * 12 + 2]!];
    const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const facing = cross[0]! * N[0]! + cross[1]! * N[1]! + cross[2]! * N[2]! >= 0;
    const b = i * 4;
    if (facing) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.signs = true;
  mesh.renderOrder = 2;
  parent.add(mesh);

  const alpha = geo.getAttribute('color') as THREE.BufferAttribute;
  const setAlpha = (i: number, a: number): boolean => {
    if (Math.abs(alpha.getW(i * 4) - a) < 0.01) return false;
    for (let k = 0; k < 4; k++) alpha.setW(i * 4 + k, a);
    return true;
  };
  const wallIdx = signs.map((s, i) => (!s.flat && s.key === undefined ? i : -1)).filter((i) => i >= 0);
  const hidden = new Set<string>();
  return {
    group: mesh,
    followWalls(fadeAt): void {
      let changed = false;
      for (const i of wallIdx) {
        const s = signs[i]!;
        // the wall behind the label: a step in from its face
        const f = fadeAt(s.x - Math.sin(s.angle) * 0.4, s.z - Math.cos(s.angle) * 0.4);
        if (setAlpha(i, 1 - 0.92 * f)) changed = true;
      }
      if (changed) alpha.needsUpdate = true;
    },
    hide(key): void {
      if (hidden.has(key)) return;
      hidden.add(key);
      signs.forEach((s, i) => {
        if (s.key === key) setAlpha(i, 0);
      });
      alpha.needsUpdate = true;
    },
    dispose(): void {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

// ---- the model name and serial on a guard's or a dog's back ----

const tagTextures = new Map<string, THREE.CanvasTexture>();

/** A small texture of a tag (the model on the first line, the serial under it), cached by its text: one per serial. */
function tagTexture(tag: Tag, color: string): THREE.CanvasTexture {
  const key = `${tag.model}|${tag.serial}|${color}`;
  const cached = tagTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  fit(ctx, tag.model, 236, 34);
  ctx.fillText(tag.model, 128, 24);
  fit(ctx, `SN ${tag.serial}`, 236, 28, '600');
  ctx.fillText(`SN ${tag.serial}`, 128, 58);
  weather(ctx, 0, 0, 256, 80, tag.serial.length * 37 + Number(tag.serial));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tagTextures.set(key, tex);
  return tex;
}

/** A plate with a tag's text, `w` metres wide, facing +z (its front); stuck on a back, a flank or a spine by the caller. Dull stencil, nothing prominent. */
export function tagPlate(tag: Tag, w: number, color = 'rgba(176,184,188,0.62)'): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ map: tagTexture(tag, color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  mat.opacity = 0.9;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 80) / 256), mat);
  mesh.userData.tag = true;
  return mesh;
}
