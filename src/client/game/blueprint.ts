// The blueprint — a drawn floor plan of one floor, filled in only where the
// player has explored (or a server grid has mapped). game.ts builds a
// BlueprintSheet per floor from live job state; this just draws it onto a
// 2D canvas in drafting style: walls in white line, locked doors as bars in
// their key colour with the door letter, rooms labelled with plan codes.

import type { MazeCells } from './maze';
import type { Door, RoomKind } from './security';
import { KEY_COLORS, keyLabel } from './security';

export type SheetRoom = {
  kind: RoomKind;
  x: number;
  y: number;
  cells: Array<{ x: number; y: number }>;
  keyId: number | null;
  /** A short status stamped under the label — HACKED, ONLINE — or null. */
  status: string | null;
  /** Storage rooms in a powered grid's section: document lockers still unopened there. */
  docsMarked: number;
};

export type BlueprintSheet = {
  cols: number;
  rows: number;
  cells: MazeCells;
  explored: boolean[][];
  doors: Array<{ door: Door; open: boolean }>;
  rooms: SheetRoom[];
  /** Storage rooms a powered grid has marked — shown even before they're walked into. */
  beacons: Array<{ x: number; y: number; keyId: number }>;
  crates: Array<{ x: number; y: number }>;
  lasers: Array<{ x: number; y: number }>;
  /** Staff lockers to hide in. */
  hideouts: Array<{ x: number; y: number }>;
  /** Vents: a crawl-through between two neighbouring cells. */
  vents: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
  /** Blacked-out cells (shown once explored). */
  dark: boolean[][];
  /** Breaker panels (job 10+), and whether each is on. */
  breakers: Array<{ x: number; y: number; label: string; on: boolean }>;
  /** Watchdog packs' meeting points the player has seen them gather at. */
  packs: Array<{ x: number; y: number }>;
  exit: { x: number; y: number; unlocked: boolean } | null;
  stair: { x: number; y: number; up: boolean } | null;
  /** The uplink room is the alarm link here (a contract that is not records), so the sheet labels it so. */
  alarmLink?: boolean;
  /** Marks the briefing puts on the sheet: where a task is (a keycard, the heist door) and what else to know (the way in, the stairs). Drawn whether or not the cell has been seen. */
  marks?: Array<{ x: number; y: number; label: string; task?: boolean }>;
  /** The player, in cell units (floor-local world position / CELL); null on a floor they aren't on. */
  player: { u: number; v: number; facing: number } | null;
};

const PAPER = '#0b2542';
const GRID_MINOR = 'rgba(140, 200, 255, 0.07)';
const GRID_MAJOR = 'rgba(140, 200, 255, 0.15)';
const FLOOR_FILL = 'rgba(120, 190, 255, 0.11)';
const WALL = '#dcecff';
const LABEL = '#a9cdf0';
const AMBER = '#e0bd6c';
const LASER = '#ff6464';
const BLACKOUT_FILL = 'rgba(2, 8, 18, 0.55)';
const BLACKOUT_HATCH = 'rgba(140, 200, 255, 0.16)';
const PACK = '#ff9a3c'; // a watchdog's visor
const PACK_RING_CELLS = 0.75; // a trap's blast radius (3 units) in cells
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const ROOM_CODES: Record<RoomKind, string> = {
  terminal: 'TERM',
  server: 'SRV',
  storage: 'REC',
  uplink: 'UPL',
  logs: 'LOG',
  office: 'OPS',
  conference: 'CONF',
  cafeteria: 'CAFE',
  rack: 'RACK',
  gallery: 'GAL',
  exhibit: 'EXH',
  boiler: 'BOIL',
  control: 'CTRL',
  teller: 'TELL',
  deposit: 'BOX',
  shelving: 'RACK',
  dock: 'DOCK',
  bench: 'LAB',
  specimen: 'TANK',
};

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** The reader's pan and zoom, on top of the default framing. */
export type BlueprintView = { zoom: number; panX: number; panY: number };

const MAX_FIT_CELL = 56; // px — a tiny explored area still opens at a readable scale, not a few giant cells

/** Cell-space bounds worth framing: everything explored or marked, plus the player. The whole floor if nothing is. */
function contentBounds(sheet: BlueprintSheet): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number): void => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  };
  for (let y = 0; y < sheet.rows; y++) for (let x = 0; x < sheet.cols; x++) if (sheet.explored[y]?.[x]) add(x, y);
  for (const b of sheet.beacons) add(b.x, b.y);
  for (const p of sheet.packs) add(p.x, p.y);
  if (sheet.player) add(Math.floor(sheet.player.u + 0.5), Math.floor(sheet.player.v + 0.5));
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: sheet.cols, y1: sheet.rows };
  // A cell of margin, so the frame doesn't sit right on the outermost walls.
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
}

/** Draws `sheet` to fill `canvas` (sized to its CSS box at device resolution), framed on what's known, then panned/zoomed by `view`. */
export function drawBlueprint(canvas: HTMLCanvasElement, sheet: BlueprintSheet, view: BlueprintView = { zoom: 1, panX: 0, panY: 0 }): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { cols, rows, cells, explored } = sheet;
  const pad = 26;
  const b = contentBounds(sheet);
  const fit = Math.max(4, Math.min(MAX_FIT_CELL, (cssW - pad * 2) / (b.x1 - b.x0), (cssH - pad * 2) / (b.y1 - b.y0)));
  // Default framing centres the known area; the view then zooms about the sheet's centre and pans.
  const baseOx = cssW / 2 - ((b.x0 + b.x1) / 2) * fit;
  const baseOy = cssH / 2 - ((b.y0 + b.y1) / 2) * fit;
  const s = fit * view.zoom;
  const ox = cssW / 2 + view.panX + (baseOx - cssW / 2) * view.zoom;
  const oy = cssH / 2 + view.panY + (baseOy - cssH / 2) * view.zoom;
  const known = (x: number, y: number): boolean => explored[y]?.[x] === true;
  const cx = (x: number): number => ox + (x + 0.5) * s;
  const cy = (y: number): number => oy + (y + 0.5) * s;

  // Paper and drafting grid: minor lines at half a cell, major on cell edges.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.lineWidth = 1;
  const step = s / 2;
  const startX = (((ox % s) + s) % s) - s; // a major line, at or just left of the sheet edge
  const startY = (((oy % s) + s) % s) - s;
  for (let i = 0; i * step <= Math.max(cssW, cssH) + s * 2; i++) {
    const major = i % 2 === 0;
    ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
    const px = (startX + i * step) | 0;
    const py = (startY + i * step) | 0;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, 0);
    ctx.lineTo(px + 0.5, cssH);
    ctx.moveTo(0, py + 0.5);
    ctx.lineTo(cssW, py + 0.5);
    ctx.stroke();
  }

  // Explored floor.
  ctx.fillStyle = FLOOR_FILL;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (known(x, y)) ctx.fillRect(ox + x * s, oy + y * s, s, s);

  // Blackouts: explored dark cells shaded and cross-hatched, the drafting mark for "no power".
  ctx.save();
  ctx.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (known(x, y) && sheet.dark[y]?.[x]) ctx.rect(ox + x * s, oy + y * s, s, s);
  ctx.fillStyle = BLACKOUT_FILL;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = BLACKOUT_HATCH;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const hatch = Math.max(4, s / 5);
  for (let d = -rows * s; d < cols * s; d += hatch) {
    ctx.moveTo(ox + d, oy);
    ctx.lineTo(ox + d + rows * s, oy + rows * s);
  }
  ctx.stroke();
  ctx.restore();

  const labelSize = Math.max(7, Math.min(14, s * 0.26));
  const label = (text: string, x: number, y: number, color: string, size = labelSize, weight = 600): void => {
    ctx.font = `${weight} ${size}px ${MONO}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };

  // Laser traps: a dashed red line across the corridor.
  ctx.setLineDash([Math.max(2, s * 0.08), Math.max(2, s * 0.06)]);
  ctx.strokeStyle = LASER;
  ctx.lineWidth = Math.max(1, s * 0.05);
  for (const l of sheet.lasers) {
    if (!known(l.x, l.y)) continue;
    const across = cells[l.y]![l.x]!.N; // an N–S corridor: the beam runs E–W
    ctx.beginPath();
    if (across) {
      ctx.moveTo(ox + l.x * s + s * 0.1, cy(l.y));
      ctx.lineTo(ox + (l.x + 1) * s - s * 0.1, cy(l.y));
    } else {
      ctx.moveTo(cx(l.x), oy + l.y * s + s * 0.1);
      ctx.lineTo(cx(l.x), oy + (l.y + 1) * s - s * 0.1);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Crates: small squares you can hide behind.
  ctx.strokeStyle = LABEL;
  ctx.lineWidth = 1;
  for (const c of sheet.crates) {
    if (!known(c.x, c.y)) continue;
    const r = s * 0.14;
    ctx.strokeRect(cx(c.x) - r, cy(c.y) - r, r * 2, r * 2);
    ctx.beginPath();
    ctx.moveTo(cx(c.x) - r, cy(c.y) - r);
    ctx.lineTo(cx(c.x) + r, cy(c.y) + r);
    ctx.stroke();
  }

  // Staff lockers: a small upright cabinet with vent slats.
  ctx.strokeStyle = LABEL;
  ctx.lineWidth = 1;
  for (const h of sheet.hideouts) {
    if (!known(h.x, h.y)) continue;
    const w = s * 0.2;
    const hgt = s * 0.3;
    ctx.strokeRect(cx(h.x) - w / 2, cy(h.y) - hgt / 2, w, hgt);
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx(h.x) - w * 0.3, cy(h.y) - hgt / 2 + (hgt * i) / 4);
      ctx.lineTo(cx(h.x) + w * 0.3, cy(h.y) - hgt / 2 + (hgt * i) / 4);
      ctx.stroke();
    }
  }

  // Vents: a grille mark in each cell and a dashed crawl line through the wall.
  for (const v of sheet.vents) {
    const ka = known(v.a.x, v.a.y);
    const kb = known(v.b.x, v.b.y);
    if (!ka && !kb) continue;
    ctx.strokeStyle = LABEL;
    ctx.setLineDash([Math.max(2, s * 0.06), Math.max(2, s * 0.05)]);
    ctx.beginPath();
    ctx.moveTo(cx(v.a.x), cy(v.a.y));
    ctx.lineTo(cx(v.b.x), cy(v.b.y));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [c, k] of [
      [v.a, ka],
      [v.b, kb],
    ] as const) {
      if (!k) continue;
      const r = s * 0.12;
      ctx.fillStyle = PAPER;
      ctx.fillRect(cx(c.x) - r, cy(c.y) - r, r * 2, r * 2);
      ctx.strokeRect(cx(c.x) - r, cy(c.y) - r, r * 2, r * 2);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx(c.x) - r, cy(c.y) + (i * r) / 2);
        ctx.lineTo(cx(c.x) + r, cy(c.y) + (i * r) / 2);
        ctx.stroke();
      }
    }
  }

  // Walls: every closed side of an explored cell.
  ctx.strokeStyle = WALL;
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.lineCap = 'square';
  ctx.beginPath();
  const seg = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!known(x, y)) continue;
      const c = cells[y]![x]!;
      const l = ox + x * s;
      const t = oy + y * s;
      if (!c.N) seg(l, t, l + s, t);
      if (!c.S) seg(l, t + s, l + s, t + s);
      if (!c.W) seg(l, t, l, t + s);
      if (!c.E) seg(l + s, t, l + s, t + s);
    }
  }
  ctx.stroke();

  // Rooms: plan code at the room's inner cell, status stamped beneath.
  for (const room of sheet.rooms) {
    if (!room.cells.some((c) => known(c.x, c.y))) continue;
    const key = room.keyId === null ? '' : ` ${keyLabel(room.keyId)}`;
    const color = room.keyId === null ? LABEL : hex(KEY_COLORS[room.keyId]!);
    label(`${room.kind === 'uplink' && sheet.alarmLink ? 'ALM' : ROOM_CODES[room.kind]}${key}`, cx(room.x), cy(room.y) - (room.status || room.docsMarked ? labelSize * 0.55 : 0), color);
    if (room.status) label(room.status, cx(room.x), cy(room.y) + labelSize * 0.6, color, labelSize * 0.8, 500);
    else if (room.docsMarked) label(`FILE ×${room.docsMarked}`, cx(room.x), cy(room.y) + labelSize * 0.6, AMBER, labelSize * 0.85, 700);
  }

  // Beacons: a ring in the grid's key colour over each storage room it marked.
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  for (const b of sheet.beacons) {
    ctx.strokeStyle = hex(KEY_COLORS[b.keyId]!);
    ctx.beginPath();
    ctx.arc(cx(b.x), cy(b.y), s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Breaker panels: a small box with its number, amber when on, red when cut.
  for (const b of sheet.breakers) {
    if (!known(b.x, b.y)) continue;
    const color = b.on ? AMBER : LASER;
    const w = s * 0.34;
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.fillRect(cx(b.x) - w / 2, cy(b.y) - w / 2, w, w);
    ctx.strokeRect(cx(b.x) - w / 2, cy(b.y) - w / 2, w, w);
    label(b.label, cx(b.x), cy(b.y) + 0.5, color, labelSize * 0.8, 700);
  }

  // Pack meeting points: a dashed ring the size of a trap's blast, so it shows where to set one.
  ctx.strokeStyle = PACK;
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.setLineDash([Math.max(3, s * 0.1), Math.max(2, s * 0.07)]);
  for (const p of sheet.packs) {
    ctx.beginPath();
    ctx.arc(cx(p.x), cy(p.y), s * PACK_RING_CELLS, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of sheet.packs) label('PACK', cx(p.x), cy(p.y), PACK, labelSize * 0.85, 700);

  // Doors: a solid bar in the key colour while locked, just the jambs once open.
  for (const { door, open } of sheet.doors) {
    const [dx, dy] = door.dir === 'N' ? [0, -1] : door.dir === 'S' ? [0, 1] : door.dir === 'E' ? [1, 0] : [-1, 0];
    if (!known(door.x, door.y) && !known(door.x + dx, door.y + dy)) continue;
    const color = hex(KEY_COLORS[door.id]!);
    const mx = cx(door.x) + (dx * s) / 2;
    const my = cy(door.y) + (dy * s) / 2;
    const half = s * 0.42;
    const [ax, ay] = dx === 0 ? [half, 0] : [0, half];
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    if (open) {
      ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(mx - ax, my - ay);
      ctx.lineTo(mx - ax * 0.7, my - ay * 0.7);
      ctx.moveTo(mx + ax, my + ay);
      ctx.lineTo(mx + ax * 0.7, my + ay * 0.7);
      ctx.stroke();
    } else {
      ctx.lineWidth = Math.max(3, s * 0.16);
      ctx.beginPath();
      ctx.moveTo(mx - ax, my - ay);
      ctx.lineTo(mx + ax, my + ay);
      ctx.stroke();
    }
    // The door letter, tagged on the near (open-region) side in a circle.
    const tx = mx - dx * s * 0.3;
    const ty = my - dy * s * 0.3;
    const r = Math.max(6, labelSize * 0.75);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
    label(keyLabel(door.id), tx, ty + 0.5, color, r * 1.1, 700);
  }

  if (sheet.exit && known(sheet.exit.x, sheet.exit.y)) {
    label(sheet.exit.unlocked ? 'EXIT' : 'EXIT ⊘', cx(sheet.exit.x), cy(sheet.exit.y), sheet.exit.unlocked ? AMBER : LABEL, labelSize, 700);
  }
  if (sheet.stair && known(sheet.stair.x, sheet.stair.y)) {
    label(sheet.stair.up ? 'UP ▲' : 'DN ▼', cx(sheet.stair.x), cy(sheet.stair.y), WALL, labelSize, 700);
  }

  // The briefing's marks: a diamond on the cell and its name above, amber for a task.
  for (const m of sheet.marks ?? []) {
    const mx = cx(m.x);
    const my = cy(m.y);
    const r = Math.max(4, s * 0.17);
    ctx.fillStyle = m.task ? AMBER : WALL;
    ctx.beginPath();
    ctx.moveTo(mx, my - r);
    ctx.lineTo(mx + r, my);
    ctx.lineTo(mx, my + r);
    ctx.lineTo(mx - r, my);
    ctx.closePath();
    ctx.fill();
    label(m.label, mx, my - r - labelSize * 0.9, m.task ? AMBER : LABEL, labelSize, 700);
  }

  // The player: an amber arrowhead pointing the way they face.
  if (sheet.player) {
    const px = ox + (sheet.player.u + 0.5) * s;
    const py = oy + (sheet.player.v + 0.5) * s;
    const fx = Math.sin(sheet.player.facing);
    const fy = Math.cos(sheet.player.facing);
    const len = Math.max(7, s * 0.34);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(px + fx * len, py + fy * len);
    ctx.lineTo(px - fx * len * 0.6 + fy * len * 0.55, py - fy * len * 0.6 - fx * len * 0.55);
    ctx.lineTo(px - fx * len * 0.3, py - fy * len * 0.3);
    ctx.lineTo(px - fx * len * 0.6 - fy * len * 0.55, py - fy * len * 0.6 + fx * len * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  // North arrow, top-left — the sheet's own orientation mark.
  const nx = 18;
  const ny = 20;
  ctx.strokeStyle = LABEL;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(nx, ny + 10);
  ctx.lineTo(nx, ny - 6);
  ctx.moveTo(nx - 4, ny - 1);
  ctx.lineTo(nx, ny - 6);
  ctx.lineTo(nx + 4, ny - 1);
  ctx.stroke();
  label('N', nx, ny + 17, LABEL, 9, 700);
}
