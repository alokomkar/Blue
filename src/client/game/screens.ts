// The pictures on the laptops and workstations: a handful of small canvases redrawn a few times a second, each a different scene
// (a photograph, a pass with a face on it, a chart, scrolling logs, an inbox, a camera grid, a slide, a street map) that changes every
// few seconds. Every laptop in a building picks one of the canvases by where it stands, so no two neighbours show the same thing at
// once, and a hundred screens cost four canvas uploads, a few times a second. Drawn in code; nothing is loaded.

import * as THREE from 'three';

const W = 256;
const H = 160;
const VARIANTS = 4;
const SCENE_S = 5.5;
/** How many times a second a screen is redrawn. */
const FPS = 3;
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

type Draw = (g: CanvasRenderingContext2D, t: number, v: number) => void;

const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const SKIES: Array<[string, string, string]> = [
  ['#1b2b6b', '#e0709a', '#ffd08a'],
  ['#0e2a3c', '#2f8fa8', '#bfeee0'],
  ['#2a1740', '#b3478f', '#ffb35a'],
  ['#10223a', '#3d6fb5', '#f2f0d0'],
];

/** A photograph: a sky, a sun, ridges of mountains and the lake below, in one of four colourings. */
const landscape: Draw = (g, t, v) => {
  const [top, mid, sun] = SKIES[v % SKIES.length]!;
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, top);
  sky.addColorStop(1, mid);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = sun;
  g.beginPath();
  g.arc(60 + v * 38, 70 - Math.sin(t * 0.1) * 3, 16, 0, Math.PI * 2);
  g.fill();
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = ['#2c2f55', '#1c1f3d', '#10122a'][layer]!;
    g.beginPath();
    g.moveTo(0, H * 0.62);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, H * (0.5 + layer * 0.06) - rnd(x + layer * 40 + v * 9) * (34 - layer * 8));
    g.lineTo(W, H * 0.64);
    g.fill();
  }
  const lake = g.createLinearGradient(0, H * 0.62, 0, H);
  lake.addColorStop(0, mid);
  lake.addColorStop(1, '#0a0c1c');
  g.fillStyle = lake;
  g.fillRect(0, H * 0.62, W, H * 0.38);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 7; i++) g.fillRect(40 + rnd(i + v) * 160, H * 0.68 + i * 8, 30 + rnd(i * 3) * 40, 2);
};

/** A staff pass: a head and shoulders on a coloured panel, lines of text and a barcode. */
const pass: Draw = (g, t, v) => {
  g.fillStyle = '#10151f';
  g.fillRect(0, 0, W, H);
  const hue = ['#35e7ff', '#ff6bd6', '#ffb02e', '#6dff9a'][v % 4]!;
  g.fillStyle = hue;
  g.fillRect(14, 16, 84, 104);
  g.fillStyle = '#10151f';
  g.beginPath();
  g.arc(56, 56, 18, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(56, 112, 34, 28, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#dfe8f4';
  g.font = `bold 15px ${MONO}`;
  g.fillText(['M. OKONKWO', 'R. HALVORSEN', 'T. ABARA', 'J. LINDQVIST'][v % 4]!, 112, 38);
  g.fillStyle = '#7d8aa0';
  g.font = `11px ${MONO}`;
  g.fillText('STAFF · LEVEL 3', 112, 58);
  g.fillText(`ID ${4000 + v * 311 + ((t * 0) | 0)}`, 112, 76);
  g.fillStyle = hue;
  g.fillRect(112, 88, 70, 4);
  for (let x = 14; x < 242; x += 4) {
    g.fillStyle = '#dfe8f4';
    g.fillRect(x, 130, rnd(x + v * 17) < 0.5 ? 2 : 1, 22);
  }
};

/** A chart: a line that is always drawing itself, bars beneath it. */
const chart: Draw = (g, t, v) => {
  g.fillStyle = '#0d1322';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1f2b46';
  g.lineWidth = 1;
  for (let y = 24; y < H - 20; y += 22) {
    g.beginPath();
    g.moveTo(16, y);
    g.lineTo(W - 10, y);
    g.stroke();
  }
  const hue = ['#35e7ff', '#ff6bd6', '#ffb02e', '#6dff9a'][v % 4]!;
  g.strokeStyle = hue;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const y = 90 - Math.sin(i * 0.5 + t * 0.7 + v) * 22 - i * 1.2 - rnd(i + v * 5) * 10;
    if (i === 0) g.moveTo(16, y);
    else g.lineTo(16 + i * 9.6, y);
  }
  g.stroke();
  g.fillStyle = hue;
  for (let i = 0; i < 12; i++) {
    const h = 8 + rnd(i + v * 7 + Math.floor(t / 2)) * 26;
    g.fillRect(20 + i * 19, H - 12 - h, 11, h);
  }
};

/** A terminal: log lines scrolling up. */
const logs: Draw = (g, t, v) => {
  g.fillStyle = '#05100a';
  g.fillRect(0, 0, W, H);
  g.font = `10px ${MONO}`;
  const base = Math.floor(t * FPS);
  for (let i = 0; i < 13; i++) {
    const n = base + i + v * 97;
    const bad = rnd(n) < 0.12;
    g.fillStyle = bad ? '#ff6b5a' : '#4ee08a';
    g.fillText(`${(n * 7919).toString(16).slice(-6).padStart(6, '0')}  ${bad ? 'DENIED ' : 'OK     '}${['/vault', '/payroll', '/mail', '/hr', '/ops', '/backup'][n % 6]}`, 8, 14 + i * 11.5);
  }
  if (Math.floor(t * 2) % 2 === 0) g.fillRect(8, H - 14, 6, 9);
};

/** An inbox: rows of senders and subjects, some unread. */
const inbox: Draw = (g, t, v) => {
  g.fillStyle = '#eef1f6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b3550';
  g.fillRect(0, 0, W, 18);
  g.fillStyle = '#fff';
  g.font = `bold 11px ${MONO}`;
  g.fillText('INBOX', 8, 13);
  const subjects = ['Re: Q3 transfer', 'Access review', 'Badge lost', 'Night shift roster', 'FWD: vendor audit', 'Lunch?', 'URGENT: maze logs'];
  for (let i = 0; i < 7; i++) {
    const y = 24 + i * 19;
    const unread = rnd(i + v * 3 + Math.floor(t / 4)) < 0.4;
    g.fillStyle = unread ? '#2b6cff' : '#b6bfd0';
    g.beginPath();
    g.arc(10, y + 6, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = unread ? '#10151f' : '#6b7690';
    g.font = `${unread ? 'bold ' : ''}10px ${MONO}`;
    g.fillText(subjects[(i + v * 2) % subjects.length]!, 20, y + 9);
    g.fillStyle = '#c9d0de';
    g.fillRect(8, y + 14, W - 16, 1);
  }
};

/** A camera grid: four feeds with moving blips. */
const cameras: Draw = (g, t, v) => {
  g.fillStyle = '#04080e';
  g.fillRect(0, 0, W, H);
  for (let q = 0; q < 4; q++) {
    const x0 = (q % 2) * (W / 2) + 3;
    const y0 = Math.floor(q / 2) * (H / 2) + 3;
    g.fillStyle = '#0a1a26';
    g.fillRect(x0, y0, W / 2 - 6, H / 2 - 6);
    g.strokeStyle = '#1c4a5c';
    g.beginPath();
    g.moveTo(x0, y0 + (H / 2 - 6) * 0.6);
    g.lineTo(x0 + W / 2 - 6, y0 + (H / 2 - 6) * 0.5);
    g.stroke();
    g.fillStyle = '#ff4a5a';
    const bx = x0 + 10 + ((Math.sin(t * (0.6 + q * 0.2) + v + q) + 1) / 2) * (W / 2 - 30);
    g.fillRect(bx, y0 + 18 + q * 4, 5, 5);
    g.fillStyle = '#35e7ff';
    g.font = `8px ${MONO}`;
    g.fillText(`CAM ${q + 1 + v * 4}`, x0 + 5, y0 + 10);
  }
};

/** A slide: a title, one big number, and a line under it. */
const slide: Draw = (g, t, v) => {
  g.fillStyle = ['#17203a', '#2a1740', '#10302c', '#3a2410'][v % 4]!;
  g.fillRect(0, 0, W, H);
  const hue = ['#35e7ff', '#ff6bd6', '#6dff9a', '#ffb02e'][v % 4]!;
  g.fillStyle = hue;
  g.fillRect(0, 0, 8, H);
  g.fillStyle = '#e8eefc';
  g.font = `bold 13px ${MONO}`;
  g.fillText(['QUARTERLY SECURITY', 'OFFSHORE HOLDINGS', 'HEADCOUNT', 'INCIDENT REPORT'][v % 4]!, 22, 28);
  g.fillStyle = hue;
  g.font = `bold 58px ${MONO}`;
  g.fillText(`${(Math.floor(t / 3) * 7 + v * 13) % 90 + 10}%`, 22, 100);
  g.fillStyle = '#9fb0d0';
  g.font = `10px ${MONO}`;
  g.fillText('COMPARED WITH LAST QUARTER', 22, 130);
};

/** A street map: a grid of blocks with a route being traced across it. */
const street: Draw = (g, t, v) => {
  g.fillStyle = '#0c1522';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#16263a';
  for (let x = 0; x < 6; x++) for (let y = 0; y < 4; y++) g.fillRect(8 + x * 41 + (v % 2) * 3, 8 + y * 38, 33, 30);
  g.strokeStyle = '#ffb02e';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(24, 150);
  g.lineTo(24, 92);
  g.lineTo(106, 92);
  g.lineTo(106, 46);
  g.lineTo(188, 46);
  g.lineTo(188, 16);
  g.stroke();
  const k = (t * 0.25 + v * 0.3) % 1;
  const path: Array<[number, number]> = [[24, 150], [24, 92], [106, 92], [106, 46], [188, 46], [188, 16]];
  const total = path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);
  let d = k * total;
  let at = path[0]!;
  for (let i = 1; i < path.length && d > 0; i++) {
    const seg = Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
    const u = Math.min(1, d / seg);
    at = [path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * u, path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * u];
    d -= seg;
  }
  g.fillStyle = '#35e7ff';
  g.beginPath();
  g.arc(at[0], at[1], 5, 0, Math.PI * 2);
  g.fill();
};

const SCENES: readonly Draw[] = [landscape, pass, chart, logs, inbox, cameras, slide, street];

type Canvas = { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; last: number };
const canvases: Canvas[] = [];

function canvasFor(v: number): Canvas {
  let c = canvases[v];
  if (!c) {
    const el = document.createElement('canvas');
    el.width = W;
    el.height = H;
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    c = { tex, g: el.getContext('2d')!, last: -1 };
    canvases[v] = c;
    SCENES[0]!(c.g, 0, v); // never a blank first frame
    tex.needsUpdate = true;
  }
  return c;
}

/** The picture for the screen at (x, y): one of a few shared, animated textures, picked so neighbours differ. */
export function screenTexture(x: number, y: number): THREE.CanvasTexture {
  return canvasFor(Math.abs(x * 7 + y * 13) % VARIANTS).tex;
}

/** Redraws the screens that are in use (call once a frame with the clock in seconds): each variant a few times a second, on its own cycle of scenes. */
export function updateScreens(t: number): void {
  const frame = Math.floor(t * FPS);
  canvases.forEach((c, v) => {
    if (!c || frame === c.last) return;
    c.last = frame;
    const scene = Math.floor(t / SCENE_S + v * 2) % SCENES.length;
    SCENES[scene]!(c.g, t, v);
    c.tex.needsUpdate = true;
  });
}
