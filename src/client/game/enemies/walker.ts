// Getting around the maze, for the enemy types that aren't humanoid Bots
// (bots.ts has its own long-standing copy of this): a world position on a
// floor, a route of cells along the nav grid (locked doors closed), and
// steering that turns smoothly toward where it's heading.

import * as THREE from 'three';
import { CELL } from '../scene';
import { bfs, pathFromDist, type MazeCells } from '../maze';
import { Avoider, clearSpot, type Obstacle } from '../avoid';

const ARRIVE_R = 0.15;
const BODY_R = 0.3;

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class Walker {
  readonly pos: THREE.Vector3;
  angle = 0;
  private path: Array<{ x: number; y: number }> = [];
  private pathIdx = 1;
  /** What stands in the way on its floor (walls, crates, furniture), set each tick by whoever owns it: left empty, it walks straight (the mines). */
  obstacles: ReadonlyArray<Obstacle> = [];
  private readonly avoider = new Avoider();

  constructor(
    x: number,
    z: number,
    private readonly originX: number,
    originY: number,
    private readonly originZ: number,
    private readonly turnRate = 7
  ) {
    this.pos = new THREE.Vector3(x, originY, z);
  }

  cellOf(x: number, z: number): { x: number; y: number } {
    return { x: Math.round((x - this.originX) / CELL), y: Math.round((z - this.originZ) / CELL) };
  }

  /** Set down at (x, z), whatever it was doing: no route, to be given a new one. */
  place(x: number, z: number): void {
    this.pos.x = x;
    this.pos.z = z;
    this.path = [];
    this.pathIdx = 1;
  }

  /** Routes to the cell holding (x, z). Returns the route length in cells, or -1 if it can't get there. */
  pathTo(x: number, z: number, cells: MazeCells, cols: number, rows: number): number {
    const cur = this.cellOf(this.pos.x, this.pos.z);
    const target = this.cellOf(x, z);
    const dist = bfs(cells, cols, rows, cur.x, cur.y);
    const d = dist[target.y]?.[target.x] ?? -1;
    this.path = d >= 0 ? (pathFromDist(cells, dist, target.x, target.y, cur.x, cur.y) ?? []) : [];
    this.pathIdx = 1;
    return d;
  }

  /** How many cells' walk it is to the cell holding (x, z), or -1 if it can't get there. */
  stepsTo(x: number, z: number, cells: MazeCells, cols: number, rows: number): number {
    const cur = this.cellOf(this.pos.x, this.pos.z);
    const target = this.cellOf(x, z);
    return bfs(cells, cols, rows, cur.x, cur.y)[target.y]?.[target.x] ?? -1;
  }

  /**
   * Routes to a random cell at least `minCells` away — inside `bounds` (cells
   * within `max` of a walking-distance field) when given and it can.
   */
  roam(cells: MazeCells, cols: number, rows: number, minCells = 4, bounds?: { dist: number[][]; max: number }): void {
    const cur = this.cellOf(this.pos.x, this.pos.z);
    const dist = bfs(cells, cols, rows, cur.x, cur.y);
    const options: Array<{ x: number; y: number }> = [];
    // In a small closed-off area, as far as it can get will do.
    const reach = Math.min(minCells, Math.max(...dist.flat()));
    const inBounds = (x: number, y: number): boolean => !bounds || ((bounds.dist[y]?.[x] ?? -1) >= 0 && bounds.dist[y]![x]! <= bounds.max);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (reach > 0 && (dist[y]![x] ?? -1) >= reach && inBounds(x, y)) options.push({ x, y });
    if (options.length === 0 && bounds) {
      this.roam(cells, cols, rows, minCells);
      return;
    }
    const target = options[Math.floor(Math.random() * options.length)];
    this.path = target ? (pathFromDist(cells, dist, target.x, target.y, cur.x, cur.y) ?? []) : [];
    this.pathIdx = 1;
  }

  get routeDone(): boolean {
    return this.pathIdx >= this.path.length;
  }

  /** One step along the route. Returns whether it moved. */
  follow(dt: number, speed: number): boolean {
    if (this.routeDone) return false;
    const wp = this.path[this.pathIdx]!;
    const { x: tx, z: tz } = clearSpot(wp.x * CELL + this.originX, wp.y * CELL + this.originZ, BODY_R, this.obstacles, this.pos);
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < ARRIVE_R) {
      this.pathIdx++;
      return false;
    }
    return this.moveToward(tx, tz, speed, dt);
  }

  /** Heads straight for (x, z). Returns whether it moved. */
  moveToward(x: number, z: number, speed: number, dt: number): boolean {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return false;
    const next = this.avoider.step(this.pos.x, this.pos.z, x, z, speed * dt, BODY_R, this.obstacles, dt);
    const mx = next.x - this.pos.x;
    const mz = next.z - this.pos.z;
    this.pos.x = next.x;
    this.pos.z = next.z;
    this.angle = lerpAngle(this.angle, Math.hypot(mx, mz) > 1e-4 ? Math.atan2(mx, mz) : Math.atan2(dx, dz), Math.min(1, dt * this.turnRate));
    return true;
  }

  faceToward(x: number, z: number, dt: number): void {
    this.angle = lerpAngle(this.angle, Math.atan2(x - this.pos.x, z - this.pos.z), Math.min(1, dt * this.turnRate));
  }
}
