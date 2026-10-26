// Where the tower's snipers stand (docs/GAMEPLAY.md, section 3). Pure and seeded: the plan (towerplan.ts) hands in a small view of itself and a random stream, and gets back the posts in the
// order they are used, so a tower with two snipers has the first two, one with four has them all. A post is a floor cell on one of the upper storeys, facing along a long lane (across the
// atrium, over a rail, down a hall), at least SNIPER_MIN_LANE cells of look before a wall; with floor behind it, so there is a way round to its back for a takedown; away from the stairs and
// lifts the agent comes out of, from the keycards and from the other guards. Storeys are taken in turn, the gallery first (the bridge's long void is its lane), so the posts spread out
// before any storey has two.

export type Cell = { x: number; y: number };
export type SniperPost = { level: number; x: number; y: number; facing: number };
export type Way = 'N' | 'S' | 'E' | 'W';

/** What the planner asks of the plan: kept to a handful of questions so it is testable on its own. */
export type PlanView = {
  cols: number;
  rows: number;
  /** Someone can stand in the cell. */
  walk: (level: number, x: number, y: number) => boolean;
  /** Something has a claim on the cell: a stair's head, a lift's doors, a card, a post, the start of a round, a dog, a camera's panel, a console. */
  taken: (level: number, x: number, y: number) => boolean;
  /** A guard's round passes through the cell: a post there is in its way, so it is a last choice. */
  busy: (level: number, x: number, y: number) => boolean;
  /** Where the agent comes onto the storey (stair heads and feet, lift doors) and a card lies: a sniper keeps off these. */
  arrivals: (level: number) => Cell[];
  /** A look passes the edge of the cell on the `way` side (no wall drawn there). */
  clear: (level: number, x: number, y: number, way: Way) => boolean;
  /** The cell is a bridge's deck: nothing to stand on, but someone crawls across it. */
  deck: (level: number, x: number, y: number) => boolean;
  /** The cell stands on nothing (a void): a look passes over it, and it is a drop. */
  drop: (level: number, x: number, y: number) => boolean;
  /** The cell blocks a look (a lift's cab, a pylon). */
  solid: (level: number, x: number, y: number) => boolean;
  /** Walkers pass the edge of the cell on the `way` side. */
  open: (level: number, x: number, y: number, way: Way) => boolean;
  /** Walkers can come to the cell from the street door (floors, stairs, bridges, lifts). */
  reached: (level: number, x: number, y: number) => boolean;
};

/** The storeys that can hold one, in the order they are taken: the gallery (the bridge and its void), the first floor up (the balcony over the lobby), the offices, the gallery again. */
export const SNIPER_LEVELS: readonly number[] = [2, 1, 3, 2];
/** The fewest cells of look a post needs before a wall, and the most that count toward a score. */
export const SNIPER_MIN_LANE = 5;
/** ...and at least this many cells of it, from the third on, where someone can be (floor or a bridge's deck): a lane over nothing but a drop is not worth a sniper. */
export const SNIPER_MIN_GROUND = 3;
const LANE_CAP = 9;
/** Cells a post keeps from where the agent comes onto the storey. */
const ARRIVAL_KEEP = 3;
/** Cells two posts on one storey keep from each other. */
const SPACING = 5;

const STEP: Readonly<Record<Way, readonly [number, number]>> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPPOSITE: Readonly<Record<Way, Way>> = { N: 'S', S: 'N', E: 'W', W: 'E' };
/** Facing as everywhere in the game: 0 is south (+Z), a quarter turn east. */
export const FACING: Readonly<Record<Way, number>> = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

/** A small seeded stream (mulberry32): the same seed and tower give the same posts. */
export function rngFor(seed: number, id: string): () => number {
  let a = (Math.imul(seed | 0, 2654435761) ^ [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many snipers a tower has on job `n`: two, then three from the third job, four from the sixth. */
export const sniperCount = (n: number): number => (n < 3 ? 2 : n < 6 ? 3 : 4);

/** `reach`: cells before a wall; `over`: how many are void; `edge`: the first is (a balcony); `ground`: cells from the third on that someone can be in (floor or a bridge's deck), which is what a sniper is for; `across`: floor on the far side of a void. */
export type Lane = { reach: number; over: number; edge: boolean; ground: number; across: boolean };

/** What a sniper at (x, y) facing `way` looks along: the cells before a wall, how many are void, and whether the first is (a rail with a drop beyond: a balcony). */
export function lane(view: PlanView, level: number, x: number, y: number, way: Way): Lane {
  const [dx, dy] = STEP[way];
  let cx = x;
  let cy = y;
  let reach = 0;
  let over = 0;
  let edge = false;
  let ground = 0;
  let across = false;
  let voidSeen = false;
  for (;;) {
    if (!view.clear(level, cx, cy, way)) break;
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= view.cols || ny >= view.rows || view.solid(level, nx, ny)) break;
    reach++;
    if (view.drop(level, nx, ny)) {
      over++;
      voidSeen = true;
      if (reach === 1) edge = true;
    }
    if (reach >= 3 && (view.walk(level, nx, ny) || view.deck(level, nx, ny))) {
      ground++;
      if (voidSeen) across = true;
    }
    cx = nx;
    cy = ny;
  }
  return { reach, over, edge, ground, across };
}

const score = (l: Lane): number => Math.min(l.ground, LANE_CAP) + Math.min(l.reach, LANE_CAP) * 0.3 + (l.across ? 3 : 0) + (l.edge ? 2 : 0);

type Candidate = SniperPost & { score: number };
/** What standing on a guard's round costs a post in score. */
const BUSY_COST = 4;

function candidates(view: PlanView, level: number): Candidate[] {
  const away = view.arrivals(level);
  const out: Candidate[] = [];
  for (let y = 0; y < view.rows; y++) {
    for (let x = 0; x < view.cols; x++) {
      if (!view.walk(level, x, y) || view.taken(level, x, y) || !view.reached(level, x, y)) continue;
      if (away.some((a) => Math.abs(a.x - x) + Math.abs(a.y - y) < ARRIVAL_KEEP)) continue;
      for (const way of ['N', 'S', 'E', 'W'] as const) {
        // Floor behind it with the way open, so someone can come up on its back.
        const back = OPPOSITE[way];
        const [bx, by] = STEP[back];
        if (!view.walk(level, x + bx, y + by) || !view.open(level, x, y, back) || view.taken(level, x + bx, y + by)) continue;
        const l = lane(view, level, x, y, way);
        if (l.reach < SNIPER_MIN_LANE || l.ground < SNIPER_MIN_GROUND) continue;
        out.push({ level, x, y, facing: FACING[way], score: score(l) - (view.busy(level, x, y) ? BUSY_COST : 0) });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
}

/**
 * Up to `count` posts, ranked, drawn from the stream `rand` (the same stream gives the same posts). Each storey in SNIPER_LEVELS takes one in turn, picked from its best few; a storey with
 * nothing suitable passes to the next, so a tower always has its snipers if any storey has room for them.
 */
export function planSniperPosts(view: PlanView, rand: () => number, count = 4): SniperPost[] {
  const pools = new Map<number, Candidate[]>();
  const pool = (level: number): Candidate[] => {
    if (!pools.has(level)) pools.set(level, candidates(view, level));
    return pools.get(level)!;
  };
  const posts: SniperPost[] = [];
  const order = [...SNIPER_LEVELS];
  for (const level of [1, 2, 3]) if (!order.includes(level)) order.push(level);
  for (let i = 0; posts.length < count && i < order.length + 3; i++) {
    const level = order[i % order.length]!;
    if (posts.length >= count) break;
    const free = pool(level).filter((c) => !posts.some((p) => p.level === level && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < SPACING));
    if (!free.length) continue;
    // One of the best few (a third of the way down, at most): not always the very best, so the same plan does not give the same corner every run of a seed's neighbour.
    const top = free.slice(0, Math.max(1, Math.min(4, Math.ceil(free.length / 3))));
    const pick = top[Math.floor(rand() * top.length)]!;
    posts.push({ level: pick.level, x: pick.x, y: pick.y, facing: pick.facing });
  }
  // A storey with nothing to give leaves a slot empty: fill it from whatever the other storeys still have, best first.
  const rest = [1, 2, 3].flatMap(pool).sort((x, y) => y.score - x.score);
  for (const c of rest) {
    if (posts.length >= count) break;
    if (posts.some((p) => p.level === c.level && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < SPACING)) continue;
    posts.push({ level: c.level, x: c.x, y: c.y, facing: c.facing });
  }
  return posts;
}
