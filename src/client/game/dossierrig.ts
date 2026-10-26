// The container the dossier is in, once it is known (tasks/plan.md): a pulsing strip round its roof and a small stencilled tag on its door end, so that an agent who has hacked their way
// to the answer can find it among the others, and turning green once it has been opened. Built in the container's own frame (its doors at the +x end, turned by `yaw` like the container
// model), at its centre. Primitives and canvas text only.

import * as THREE from 'three';
import { markBloom } from './postfx';

export type DossierMarkState = 'hidden' | 'marked' | 'opened';

export type DossierRig = {
  group: THREE.Group;
  setState: (s: DossierMarkState) => void;
  /** Once a frame, on the level's clock (the pulse). */
  update: (t: number) => void;
};

/** How the marked container looks: the strip's colour and what its tag says (a lab marks a unit in blue). */
export type MarkLook = { color: number; tag: [string, string] };
const AMBER: MarkLook = { color: 0xffb04a, tag: ['LOT', '12'] };

function tagTexture(lines: string[], color: number): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,24,28,0.92)';
  g.fillRect(0, 0, w, h);
  const rgb = `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}`;
  g.strokeStyle = `rgba(${rgb},0.95)`;
  g.lineWidth = 6;
  g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = `rgba(${Math.min(255, ((color >> 16) & 255) + 40)},${Math.min(255, ((color >> 8) & 255) + 30)},${Math.min(255, (color & 255) + 30)},0.95)`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.font = `bold ${i === 0 ? 40 : 26}px Arial, sans-serif`;
    g.fillText(line, w / 2, ((i + 1) * h) / (lines.length + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildDossierMarker(at: { cx: number; cz: number; yaw: number; len: number; depth: number; height: number }, look: MarkLook = AMBER): DossierRig {
  const group = new THREE.Group();
  group.position.set(at.cx, 0, at.cz);
  group.rotation.y = at.yaw;
  group.visible = false;
  const stripMat = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 2 });
  const y = at.height + 0.04;
  const bar = (w: number, d: number, x: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), stripMat);
    m.position.set(x, y, z);
    markBloom(m);
    group.add(m);
  };
  // the roof's outline, a hand's breadth in from the edge
  const hx = at.len / 2 - 0.22;
  const hz = at.depth / 2 - 0.22;
  bar(at.len - 0.44, 0.1, 0, hz);
  bar(at.len - 0.44, 0.1, 0, -hz);
  bar(0.1, at.depth - 0.44, hx, 0);
  bar(0.1, at.depth - 0.44, -hx, 0);
  // the tag, on the door end
  const tagMat = new THREE.MeshBasicMaterial({ map: tagTexture(look.tag, look.color), transparent: true, toneMapped: false });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), tagMat);
  tag.position.set(at.len / 2 + 0.09, at.height * 0.6, 0);
  tag.rotation.y = Math.PI / 2;
  group.add(tag);
  const light = new THREE.PointLight(look.color, 0, 5);
  light.position.set(0, at.height + 0.8, 0);
  group.add(light);
  let state: DossierMarkState = 'hidden';
  return {
    group,
    setState(s): void {
      state = s;
      group.visible = s !== 'hidden';
      const color = s === 'opened' ? 0x4ee08a : look.color;
      stripMat.color.setHex(color);
      stripMat.emissive.setHex(color);
      light.color.setHex(color);
    },
    update(t): void {
      if (state === 'hidden') return;
      const pulse = state === 'opened' ? 0.6 : 0.5 + 0.5 * Math.sin(t * 4);
      stripMat.emissiveIntensity = 0.7 + 2.2 * pulse;
      light.intensity = state === 'opened' ? 0.8 : 1.6 * pulse + 0.4;
    },
  };
}
