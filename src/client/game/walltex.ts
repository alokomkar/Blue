// Textures for the walls, drawn in code, one for each location: office drywall with its seams and baseboard; a museum's plaster over a
// panelled dado with a picture rail; the refinery's corrugated steel with rivets and rust; the bank's cut stone; the warehouse's painted
// cinder block with a stencilled bay number; the lab's white enamel panels with a teal stripe. A wall is a stretched
// box, so the picture is laid on by where each point of it is in the world (along the wall and up it), not by the box's own UVs: the
// texture comes out the same size on a long wall and a short one, and a wall that sinks into the floor (the takeover) squashes it.
// The texture is 2 m wide and exactly a wall high (3 m): its baseboard and rail sit where they should, once, however the wall is cut.

import * as THREE from 'three';
import { WALL_H } from './scene';

export type WallStyle = 'campus' | 'museum' | 'refinery' | 'bank' | 'warehouse' | 'lab';

const W = 256;
const H = 384;
/** Metres one repeat covers along a wall. */
const TILE_M = 2;

/** Cheap, repeatable noise for the flecks and mottling. */
const hash = (a: number, b: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const grey = (v: number, a = 1): string => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

function speckle(g: CanvasRenderingContext2D, count: number, light: number, dark: number): void {
  for (let i = 0; i < count; i++) {
    const x = hash(i, 1) * W;
    const y = hash(i, 2) * H;
    g.fillStyle = hash(i, 3) < 0.5 ? grey(dark, 0.07 + hash(i, 4) * 0.08) : grey(light, 0.06 + hash(i, 5) * 0.06);
    g.fillRect(x, y, 1 + hash(i, 6) * 2, 1 + hash(i, 7) * 2);
  }
}

/** Dirt creeping up from the floor, and a little shadow under the ceiling. */
function grime(g: CanvasRenderingContext2D, strength: number): void {
  const up = g.createLinearGradient(0, H, 0, H * 0.55);
  up.addColorStop(0, grey(0, strength));
  up.addColorStop(1, grey(0, 0));
  g.fillStyle = up;
  g.fillRect(0, 0, W, H);
  const down = g.createLinearGradient(0, 0, 0, H * 0.12);
  down.addColorStop(0, grey(0, strength * 0.6));
  down.addColorStop(1, grey(0, 0));
  g.fillStyle = down;
  g.fillRect(0, 0, W, H);
}

const DRAW: Record<WallStyle, (g: CanvasRenderingContext2D) => void> = {
  // Office drywall: boards with a seam down the middle, taped and lightly scuffed; a dark baseboard.
  campus(g) {
    g.fillStyle = grey(0.93);
    g.fillRect(0, 0, W, H);
    speckle(g, 900, 1, 0.3);
    for (const x of [0, W / 2]) {
      g.fillStyle = grey(0.55, 0.45);
      g.fillRect(x - 1, 0, 2, H);
      g.fillStyle = grey(1, 0.25);
      g.fillRect(x + 1, 0, 2, H);
    }
    // Screw heads along the seams.
    g.fillStyle = grey(0.5, 0.35);
    for (const x of [W / 2 - 6, W / 2 + 6])
      for (let y = 24; y < H - 56; y += 48) g.fillRect(x, y, 2, 2);
    // A faint horizontal board joint, and the baseboard.
    g.fillStyle = grey(0.6, 0.3);
    g.fillRect(0, H * 0.55, W, 1);
    g.fillStyle = grey(0.38);
    g.fillRect(0, H - 34, W, 34);
    g.fillStyle = grey(0.62);
    g.fillRect(0, H - 36, W, 2);
    grime(g, 0.22);
  },
  // Museum: plaster above, a panelled dado below, a picture rail between.
  museum(g) {
    g.fillStyle = grey(0.9);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 11) * W;
      const y = hash(i, 12) * H * 0.62;
      const r = 20 + hash(i, 13) * 46;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, grey(hash(i, 14) < 0.5 ? 0.6 : 1, 0.07));
      grad.addColorStop(1, grey(0.8, 0));
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(g, 500, 1, 0.4);
    // The picture rail.
    g.fillStyle = grey(0.62);
    g.fillRect(0, H * 0.17, W, 7);
    g.fillStyle = grey(1, 0.5);
    g.fillRect(0, H * 0.17, W, 2);
    // The dado: raised panels with a bevel, over a skirting.
    const top = H * 0.6;
    g.fillStyle = grey(0.7);
    g.fillRect(0, top, W, H - top);
    for (const x of [8, W / 2 + 6]) {
      const pw = W / 2 - 14;
      g.fillStyle = grey(0.5, 0.7);
      g.fillRect(x, top + 16, pw, H - top - 62);
      g.fillStyle = grey(0.82);
      g.fillRect(x + 4, top + 20, pw - 8, H - top - 70);
      g.fillStyle = grey(1, 0.25);
      g.fillRect(x + 4, top + 20, pw - 8, 2);
    }
    g.fillStyle = grey(0.45);
    g.fillRect(0, top, W, 6);
    g.fillRect(0, H - 30, W, 30);
    grime(g, 0.2);
  },
  // Refinery: corrugated steel, riveted at the seams, running with rust.
  refinery(g) {
    g.fillStyle = grey(0.8);
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 16) {
      const rib = g.createLinearGradient(x, 0, x + 16, 0);
      rib.addColorStop(0, grey(1, 0.34));
      rib.addColorStop(0.5, grey(0.5, 0.0));
      rib.addColorStop(1, grey(0, 0.38));
      g.fillStyle = rib;
      g.fillRect(x, 0, 16, H);
    }
    // Panel joints, with rivets.
    for (const y of [0, H * 0.5]) {
      g.fillStyle = grey(0.3, 0.7);
      g.fillRect(0, y, W, 5);
      g.fillStyle = grey(0.9);
      for (let x = 8; x < W; x += 16) g.fillRect(x, y + 1, 3, 3);
    }
    // Rust streaks running down from the joints and the rivets.
    for (let i = 0; i < 34; i++) {
      const x = hash(i, 21) * W;
      const y = hash(i, 22) * H * 0.8;
      const len = 30 + hash(i, 23) * 110;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, `rgba(120,70,30,${0.28 + hash(i, 24) * 0.2})`);
      grad.addColorStop(1, 'rgba(120,70,30,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 2 + hash(i, 25) * 4, len);
    }
    speckle(g, 700, 1, 0.2);
    g.fillStyle = grey(0.35);
    g.fillRect(0, H - 22, W, 22);
    grime(g, 0.3);
  },
  // Warehouse: painted cinder block, courses of big blocks in thin mortar, a darker painted lower half with a stencilled bay number.
  warehouse(g) {
    g.fillStyle = grey(0.86);
    g.fillRect(0, 0, W, H);
    const bh = 32;
    for (let row = 0; row * bh < H; row++) {
      const off = row % 2 === 0 ? 0 : W / 4;
      for (let col = -1; col < 3; col++) {
        const x = col * (W / 2) + off;
        g.fillStyle = grey(0.8 + hash(row * 7 + col, 41) * 0.16);
        g.fillRect(x + 2, row * bh + 2, W / 2 - 4, bh - 4);
      }
    }
    // The lower half is painted a darker tone, with a ragged edge where the paint stops.
    g.fillStyle = 'rgba(40,56,66,0.55)';
    g.fillRect(0, H * 0.55, W, H * 0.45);
    for (let x = 0; x < W; x += 8) g.fillRect(x, H * 0.55 - hash(x, 42) * 7, 8, 7);
    // A stencilled bay number.
    g.fillStyle = 'rgba(235,215,120,0.75)';
    g.font = 'bold 54px sans-serif';
    g.textAlign = 'center';
    g.fillText('B' + (1 + Math.floor(hash(3, 43) * 8)), W / 2, H * 0.4);
    speckle(g, 800, 1, 0.2);
    g.fillStyle = grey(0.18);
    g.fillRect(0, H - 26, W, 26);
    grime(g, 0.32);
  },
  // Lab: white enamel panels, hairline seams, a teal stripe at hand height and a pale cove at the foot.
  lab(g) {
    g.fillStyle = grey(0.96);
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 96) {
      g.fillStyle = grey(0.62, 0.55);
      g.fillRect(0, y, W, 2);
    }
    for (const x of [0, W / 2]) {
      g.fillStyle = grey(0.62, 0.55);
      g.fillRect(x, 0, 2, H);
    }
    const sheen = g.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, grey(1, 0.18));
    sheen.addColorStop(0.5, grey(1, 0));
    sheen.addColorStop(1, grey(0, 0.1));
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(31,154,152,0.85)';
    g.fillRect(0, H * 0.62, W, 10);
    g.fillStyle = grey(0.5);
    g.fillRect(0, H - 22, W, 22);
    speckle(g, 260, 1, 0.4);
    grime(g, 0.12);
  },
  // Bank: courses of cut stone, each block its own tone, in thin mortar; a polished base.
  bank(g) {
    g.fillStyle = grey(0.82);
    g.fillRect(0, 0, W, H);
    const course = 48;
    for (let row = 0; row * course < H - 40; row++) {
      const offset = row % 2 === 0 ? 0 : W / 4;
      const bw = W / 2;
      for (let col = -1; col < 3; col++) {
        const x = col * bw + offset;
        g.fillStyle = grey(0.72 + hash(row * 5 + col, 31) * 0.26);
        g.fillRect(x + 2, row * course + 2, bw - 4, course - 4);
        const sh = g.createLinearGradient(0, row * course, 0, row * course + course);
        sh.addColorStop(0, grey(1, 0.18));
        sh.addColorStop(0.15, grey(1, 0));
        sh.addColorStop(0.9, grey(0, 0));
        sh.addColorStop(1, grey(0, 0.2));
        g.fillStyle = sh;
        g.fillRect(x + 2, row * course + 2, bw - 4, course - 4);
      }
    }
    speckle(g, 800, 1, 0.3);
    g.fillStyle = grey(0.5);
    g.fillRect(0, H - 40, W, 3);
    g.fillStyle = grey(0.4);
    g.fillRect(0, H - 37, W, 37);
    const gloss = g.createLinearGradient(0, H - 37, 0, H);
    gloss.addColorStop(0, grey(1, 0.18));
    gloss.addColorStop(1, grey(0, 0));
    g.fillStyle = gloss;
    g.fillRect(0, H - 37, W, 37);
    grime(g, 0.18);
  },
};

const textures = new Map<WallStyle, THREE.CanvasTexture>();

function textureFor(style: WallStyle): THREE.CanvasTexture {
  let tex = textures.get(style);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    DRAW[style](c.getContext('2d')!);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    textures.set(style, tex);
  }
  return tex;
}

/**
 * Lays `style`'s wall texture on a wall material (one for walls that are stretched boxes, built at the origin of their own floor's
 * group). Shared by every wall of a style: one program, one texture.
 */
export function texturedWall(material: THREE.MeshStandardMaterial, style: WallStyle): THREE.MeshStandardMaterial {
  const tex = textureFor(style);
  const before = material.onBeforeCompile;
  material.customProgramCacheKey = () => 'walltex';
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms['uWallTex'] = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWtPos;\nvarying vec3 vWtNormal;\nvarying float vWtY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWtPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWtNormal = normalize(mat3(modelMatrix) * normal);
        vWtY = clamp((transformed.y + ${(WALL_H / 2).toFixed(2)}) / ${WALL_H.toFixed(2)}, 0.0, 1.0);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWtPos;\nvarying vec3 vWtNormal;\nvarying float vWtY;\nuniform sampler2D uWallTex;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 an = abs(vWtNormal);
          vec2 wuv = an.y > 0.6 ? vWtPos.xz / ${TILE_M.toFixed(1)} : vec2((an.x > an.z ? vWtPos.z : vWtPos.x) / ${TILE_M.toFixed(1)}, 1.0 - vWtY);
          diffuseColor.rgb *= texture2D(uWallTex, wuv).rgb;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}
