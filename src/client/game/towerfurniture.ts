// The tower's furniture. Each maze level has its own tower (campus, museum, refinery, bank, warehouse, lab), and each tower its own furniture: a set of pieces (desk banks, display cases, pipe
// racks, teller counters, racking, lab benches...), laid out on the four storeys by a generator that keeps the rules the game needs: every piece stays in its cell, no piece stands in a lane (the
// strip between the middles of two open cells, which the guards walk), none on the places that must stay reachable, none overlapping another, and a way is left between every pair of open
// cells. Low pieces hide a crouched agent, tall ones anyone; glass ones stop a body and not a look; sofas, desks and conveyors have room to crawl under (WallBox.under).
// Pure, so it is unit-tested under Node; the generator is handed the tower's plan (setLayoutPlan) so that this file needs nothing from towerplan.ts. tower.ts builds the models.

export type FurnitureKind =
  | 'sofa' | 'desk' | 'conference' | 'table' | 'bench' | 'cabinet' | 'plant' | 'lamp' | 'chair' | 'console' | 'deskrow' | 'spine' | 'round' | 'seat'
  // the museum
  | 'case' | 'plinth' | 'colossus' | 'panel' | 'crate'
  // the refinery
  | 'pipes' | 'boiler' | 'manifold' | 'drums' | 'pump' | 'bottles'
  // the bank
  | 'counter' | 'deposit' | 'glass' | 'pillar' | 'cart' | 'atm'
  // the warehouse
  | 'rack' | 'pallets' | 'forklift' | 'conveyor' | 'container' | 'cage'
  // the lab
  | 'labbench' | 'hood' | 'tank' | 'fridge' | 'board' | 'airlock' | 'stool'
  // the bunker's cube-built set (a one-metre cube module)
  | 'cube' | 'cubetable' | 'cubestool' | 'cubebunk' | 'cubelocker' | 'cargo' | 'bank';

export type KindSpec = {
  /** Along the edge, metres. */
  len: number;
  /** Out from the edge, metres. */
  depth: number;
  height: number;
  /** Room to crawl under. */
  crawl: boolean;
  /** What it does to a guard's view of someone behind it: low furniture hides only a crouched or lying agent; tall hides anyone; glass (null with `see`) hides no one. */
  cover: 'low' | 'tall' | null;
  /** Glass or mesh: it stops a body but not a look (WallBox.see). */
  see?: boolean;
  /** Only to look at: no body-stopping box (a chair pushed in under a pod's desk). */
  decor?: boolean;
  /** Its top can be climbed onto and walked on (a cargo container's roof): the floor's climb boxes list it (game.ts's roof climb). */
  roof?: boolean;
};

export const KINDS: Readonly<Record<FurnitureKind, KindSpec>> = {
  sofa: { len: 1.9, depth: 0.9, height: 0.85, crawl: true, cover: 'low' },
  desk: { len: 1.6, depth: 0.8, height: 0.75, crawl: true, cover: 'low' },
  conference: { len: 2.2, depth: 1.0, height: 0.75, crawl: true, cover: 'low' },
  table: { len: 1.1, depth: 0.7, height: 0.5, crawl: false, cover: 'low' },
  bench: { len: 1.7, depth: 0.5, height: 0.45, crawl: false, cover: 'low' },
  cabinet: { len: 1.2, depth: 0.5, height: 1.6, crawl: false, cover: 'tall' },
  plant: { len: 0.6, depth: 0.6, height: 1.3, crawl: false, cover: 'low' },
  lamp: { len: 0.4, depth: 0.4, height: 1.7, crawl: false, cover: null },
  chair: { len: 0.5, depth: 0.5, height: 0.9, crawl: false, cover: null },
  /** A console: the security room's monitor desk, the control room's panel. */
  console: { len: 1.8, depth: 0.7, height: 1.0, crawl: false, cover: 'low' },
  deskrow: { len: 2.8, depth: 0.7, height: 0.75, crawl: true, cover: 'low' },
  spine: { len: 2.8, depth: 0.4, height: 1.5, crawl: false, cover: 'tall' },
  round: { len: 1.1, depth: 1.1, height: 0.75, crawl: false, cover: 'low' },
  seat: { len: 0.5, depth: 0.5, height: 0.9, crawl: false, cover: null, decor: true },
  // museum
  case: { len: 1.4, depth: 0.8, height: 1.05, crawl: false, cover: null, see: true },
  plinth: { len: 1.0, depth: 1.0, height: 1.7, crawl: false, cover: 'tall' },
  colossus: { len: 1.6, depth: 1.6, height: 2.5, crawl: false, cover: 'tall' },
  panel: { len: 2.0, depth: 0.2, height: 2.0, crawl: false, cover: 'tall' },
  crate: { len: 1.0, depth: 1.0, height: 0.9, crawl: false, cover: 'low' },
  // refinery
  pipes: { len: 2.8, depth: 0.8, height: 2.2, crawl: false, cover: 'tall' },
  boiler: { len: 1.7, depth: 1.7, height: 2.6, crawl: false, cover: 'tall' },
  manifold: { len: 1.5, depth: 1.1, height: 1.0, crawl: false, cover: 'low' },
  drums: { len: 1.3, depth: 1.3, height: 1.0, crawl: false, cover: 'low' },
  pump: { len: 1.5, depth: 0.9, height: 0.9, crawl: false, cover: 'low' },
  bottles: { len: 1.0, depth: 0.5, height: 1.5, crawl: false, cover: 'tall' },
  // bank
  counter: { len: 2.8, depth: 0.9, height: 1.0, crawl: false, cover: 'low' },
  deposit: { len: 2.4, depth: 0.5, height: 2.1, crawl: false, cover: 'tall' },
  glass: { len: 2.0, depth: 0.12, height: 2.2, crawl: false, cover: null, see: true },
  pillar: { len: 0.9, depth: 0.9, height: 3.0, crawl: false, cover: 'tall' },
  cart: { len: 1.0, depth: 0.6, height: 0.9, crawl: false, cover: 'low' },
  atm: { len: 0.9, depth: 0.7, height: 1.8, crawl: false, cover: 'tall' },
  // warehouse
  rack: { len: 2.8, depth: 0.9, height: 2.8, crawl: false, cover: 'tall' },
  pallets: { len: 1.2, depth: 1.0, height: 1.8, crawl: false, cover: 'tall' },
  forklift: { len: 1.1, depth: 2.0, height: 1.2, crawl: false, cover: 'low' },
  conveyor: { len: 2.8, depth: 0.8, height: 0.9, crawl: true, cover: 'low' },
  container: { len: 2.8, depth: 1.2, height: 2.6, crawl: false, cover: 'tall' },
  cage: { len: 1.5, depth: 1.5, height: 2.0, crawl: false, cover: null, see: true },
  // lab
  labbench: { len: 2.8, depth: 0.9, height: 0.95, crawl: false, cover: 'low' },
  hood: { len: 1.4, depth: 0.8, height: 2.0, crawl: false, cover: 'tall' },
  tank: { len: 1.2, depth: 1.2, height: 2.2, crawl: false, cover: null, see: true },
  fridge: { len: 0.8, depth: 0.7, height: 1.9, crawl: false, cover: 'tall' },
  board: { len: 1.8, depth: 0.12, height: 1.9, crawl: false, cover: 'tall' },
  airlock: { len: 1.7, depth: 1.7, height: 2.4, crawl: false, cover: null, see: true },
  stool: { len: 0.9, depth: 0.5, height: 0.6, crawl: false, cover: null, decor: true },
  // the bunker (docs/levels/bunker.md): everything is built of a one-metre cube
  cube: { len: 1.0, depth: 1.0, height: 1.0, crawl: false, cover: 'low' },
  cubetable: { len: 1.6, depth: 1.6, height: 0.78, crawl: false, cover: 'low' },
  cubestool: { len: 0.5, depth: 0.5, height: 0.5, crawl: false, cover: null, decor: true },
  cubebunk: { len: 2.0, depth: 1.0, height: 1.9, crawl: false, cover: 'tall' },
  cubelocker: { len: 1.0, depth: 0.6, height: 1.8, crawl: false, cover: 'tall' },
  // a cargo container, two cells long and one wide (a cell is four metres): the bunker's rooms are stacked with them, blocks of furniture and containers
  cargo: { len: 7.8, depth: 3.8, height: 2.6, crawl: false, cover: 'tall', roof: true },
  // a bank of sliding shelving (the Records Annex): the size of a cargo block, with no roof to climb, because it moves
  bank: { len: 7.8, depth: 3.8, height: 2.6, crawl: false, cover: 'tall' },
};

/** A piece: the cell it stands in, the edge of that cell it stands against, and how far along the edge from the middle (metres). */
export type Piece = { level: number; kind: FurnitureKind; x: number; y: number; edge: 'N' | 'S' | 'E' | 'W'; along: number };

const CELL_M = 4;
/** How far a piece stands off the edge it is against (the wall's face and a little air). */
export const EDGE_MARGIN = 0.2;

export type Placed = Piece & {
  /** A sliding bank: the cell step it moves by (bunkerplan.ts). */
  slide?: { dx: number; dy: number };
  /** Centre, world metres. */
  cx: number;
  cz: number;
  /** The way its front faces (0 is +z, as in the game). */
  yaw: number;
  /** The footprint: minX, maxX, minZ, maxZ. */
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  spec: KindSpec;
};

/** Works out where a piece stands and what it covers. */
export function place(p: Piece, cell = CELL_M): Placed {
  const spec = KINDS[p.kind];
  const inward = cell / 2 - EDGE_MARGIN - spec.depth / 2; // from the cell's middle toward the edge
  let cx = p.x * cell;
  let cz = p.y * cell;
  let yaw = 0;
  let hx = spec.len / 2;
  let hz = spec.depth / 2;
  switch (p.edge) {
    case 'N':
      cz -= inward;
      cx += p.along;
      yaw = 0;
      break;
    case 'S':
      cz += inward;
      cx += p.along;
      yaw = Math.PI;
      break;
    case 'W':
      cx -= inward;
      cz += p.along;
      yaw = Math.PI / 2;
      [hx, hz] = [spec.depth / 2, spec.len / 2];
      break;
    case 'E':
      cx += inward;
      cz += p.along;
      yaw = -Math.PI / 2;
      [hx, hz] = [spec.depth / 2, spec.len / 2];
      break;
  }
  return { ...p, cx, cz, yaw, box: { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz }, spec };
}

/** A free-standing piece: centre and yaw given, not an edge. */
export function placeFree(level: number, kind: FurnitureKind, cx: number, cz: number, yaw: number): Placed {
  const spec = KINDS[kind];
  const turned = Math.abs(Math.sin(yaw)) > 0.5;
  const hx = (turned ? spec.depth : spec.len) / 2;
  const hz = (turned ? spec.len : spec.depth) / 2;
  return { level, kind, x: Math.round(cx / CELL_M), y: Math.round(cz / CELL_M), edge: 'N', along: 0, cx, cz, yaw, box: { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz }, spec };
}

// ---- pods ----
// A pod stands free in the square between four cells (centred on the corner where four cells meet, so the lanes along the cell middles stay clear of it): one recipe of pieces, 3 m or so across.

/** One piece of a recipe: its kind, where from the square's middle (dx across, dz down) and the way it faces. */
export type RecipePiece = readonly [FurnitureKind, number, number, number];
export type Recipe = readonly RecipePiece[];
const PI = Math.PI;
const seats = (rowZ: number, n: number[]): RecipePiece[] => n.flatMap((dx): RecipePiece[] => [['seat', dx, -rowZ, 0], ['seat', dx, rowZ, PI]]);

export const RECIPES: Readonly<Record<string, Recipe>> = {
  // office
  bank: [['deskrow', 0, -0.355, PI], ['deskrow', 0, 0.355, 0], ...seats(0.805, [-0.9, 0.9])],
  stack: [['spine', 0, 0, 0], ['deskrow', 0, -0.555, PI], ['deskrow', 0, 0.555, 0], ...seats(1.005, [-0.9, 0.9])],
  round: [['round', 0, 0, 0], ['seat', -0.85, 0, PI / 2], ['seat', 0.85, 0, -PI / 2], ['seat', 0, 0.85, PI]],
  conf: [['conference', 0, 0, 0], ['seat', -0.7, -0.75, 0], ['seat', 0.7, -0.75, 0], ['seat', -0.7, 0.75, PI], ['seat', 0.7, 0.75, PI]],
  sofa: [['sofa', 0, 0, 0]],
  rackrow: [['rack', 0, 0, 0]],
  // museum
  cases: [['case', -0.72, 0, 0], ['case', 0.72, 0, 0]],
  plinth: [['plinth', 0, 0, 0]],
  colossus: [['colossus', 0, 0, 0]],
  galbench: [['bench', 0, 0, 0]],
  crates: [['crate', 0, 0, 0]],
  // refinery
  pipes: [['pipes', 0, 0, 0]],
  pipes2: [['pipes', 0, -0.5, 0], ['pipes', 0, 0.5, 0]],
  boiler: [['boiler', 0, 0, 0]],
  ctrl: [['console', 0, 0, 0], ['seat', -0.5, 0.65, PI], ['seat', 0.5, 0.65, PI]],
  mani: [['manifold', 0, 0, 0]],
  drums: [['drums', 0, 0, 0]],
  pump: [['pump', 0, 0, 0]],
  // bank
  counter: [['counter', 0, 0, 0], ['stool', -0.8, 0.8, 0], ['stool', 0.8, 0.8, 0]],
  depwall: [['deposit', 0, -0.55, 0], ['deposit', 0, 0.55, PI]],
  pillar: [['pillar', 0, 0, 0]],
  cart: [['cart', 0, 0, 0]],
  glass: [['glass', 0, 0, 0]],
  deskb: [['desk', 0, 0, 0], ['seat', 0, 0.75, PI]],
  // warehouse
  racks: [['rack', 0, -0.5, 0], ['rack', 0, 0.5, PI]],
  pallets: [['pallets', 0, 0, 0]],
  forklift: [['forklift', 0, 0, 0]],
  conveyor: [['conveyor', 0, 0, 0]],
  container: [['container', 0, 0, 0]],
  cage: [['cage', 0, 0, 0]],
  // lab
  benches: [['labbench', 0, -0.95, PI], ['labbench', 0, 0.95, 0]],
  bench1: [['labbench', 0, 0, 0], ['stool', -0.8, 0.7, 0], ['stool', 0.8, 0.7, 0]],
  hood: [['hood', 0, 0, 0]],
  tank: [['tank', 0, 0, 0]],
  airlock: [['airlock', 0, 0, 0]],
  station: [['desk', 0, 0, 0], ['seat', 0, 0.75, PI]],
};

/** The pieces of one pod: its recipe laid out round the square's middle, the whole turned a quarter for `turn`. */
export type Pod = { level: number; kind: string; i: number; j: number; turn?: boolean };
export function podPieces(pod: Pod, cell = CELL_M): Placed[] {
  const cx = (pod.i + 0.5) * cell;
  const cz = (pod.j + 0.5) * cell;
  const quarter = pod.turn ? PI / 2 : 0;
  return RECIPES[pod.kind]!.map(([kind, dx, dz, yaw]) => {
    // Turning the pod a quarter turns every offset with it.
    const rx = pod.turn ? -dz : dx;
    const rz = pod.turn ? dx : dz;
    return placeFree(pod.level, kind, cx + rx, cz + rz, yaw - quarter);
  });
}

// ---- the sets ----

export type TowerSetId = 'campus' | 'museum' | 'refinery' | 'bank' | 'warehouse' | 'lab';
export const TOWER_SET_IDS: readonly TowerSetId[] = ['campus', 'museum', 'refinery', 'bank', 'warehouse', 'lab'];

/** What one storey of a set is furnished with. */
export type LevelMix = {
  /** How many of the free squares get a pod (0 to 1). */
  fill: number;
  /** The pods, by recipe and weight. */
  pods: ReadonlyArray<readonly [string, number]>;
  /** Single pieces along the walls and rails, and small ones in the gaps. */
  wall: readonly FurnitureKind[];
  free: readonly FurnitureKind[];
  /** The share of the floor the furniture covers, as far as there is room (per cent). */
  area: number;
  /** How many plants, at most (the plants are decoration: along walls). */
  plants?: number;
};

export type TowerSet = {
  id: TowerSetId;
  /** The names of the four storeys. */
  floors: readonly [string, string, string, string];
  levels: readonly [LevelMix, LevelMix, LevelMix, LevelMix];
};

const set = (id: TowerSetId, floors: TowerSet['floors'], levels: TowerSet['levels']): TowerSet => ({ id, floors, levels });

export const TOWER_SETS: Readonly<Record<TowerSetId, TowerSet>> = {
  campus: set('campus', ['Reception atrium', 'Open-plan level', 'Server floor', 'Executive floor'], [
    { fill: 0.5, pods: [['sofa', 2], ['round', 3], ['conf', 2], ['stack', 1]], wall: ['cabinet', 'plant', 'bench', 'sofa'], free: ['plant', 'chair', 'table', 'bench'], area: 3.4, plants: 6 },
    { fill: 1, pods: [['bank', 6], ['stack', 2], ['round', 2]], wall: ['cabinet', 'plant', 'bench', 'cabinet'], free: ['plant', 'chair', 'chair', 'cabinet', 'table', 'bench'], area: 12, plants: 21 },
    { fill: 0.8, pods: [['rackrow', 7], ['stack', 1], ['bank', 1]], wall: ['cabinet', 'cabinet', 'bench'], free: ['chair', 'cabinet', 'table'], area: 9, plants: 4 },
    { fill: 1, pods: [['round', 4], ['bank', 3], ['stack', 2], ['conf', 2]], wall: ['cabinet', 'plant', 'sofa', 'cabinet'], free: ['plant', 'chair', 'chair', 'cabinet', 'table', 'bench'], area: 20, plants: 36 },
  ]),
  museum: set('museum', ['Great hall', 'Long gallery', 'Sculpture hall', "Curators' wing"], [
    { fill: 0.45, pods: [['plinth', 3], ['cases', 2], ['galbench', 2]], wall: ['panel', 'bench', 'plant', 'crate'], free: ['bench', 'plant'], area: 3.5, plants: 6 },
    { fill: 0.9, pods: [['cases', 5], ['galbench', 3], ['plinth', 1]], wall: ['panel', 'bench', 'panel', 'case'], free: ['bench', 'crate'], area: 8, plants: 6 },
    { fill: 0.65, pods: [['plinth', 5], ['colossus', 3], ['cases', 1]], wall: ['panel', 'bench'], free: ['bench'], area: 9, plants: 3 },
    { fill: 1, pods: [['crates', 4], ['cases', 2], ['sofa', 2], ['deskb', 1]], wall: ['panel', 'cabinet', 'bench', 'crate'], free: ['crate', 'chair', 'plant', 'bench'], area: 11, plants: 10 },
  ]),
  refinery: set('refinery', ['Pump hall', 'Pipe gallery', 'Boiler deck', 'Control room'], [
    { fill: 0.65, pods: [['pump', 4], ['drums', 3], ['mani', 2]], wall: ['cabinet', 'bottles', 'drums'], free: ['drums', 'bottles', 'crate'], area: 8, plants: 0 },
    { fill: 1, pods: [['pipes', 5], ['pipes2', 3], ['mani', 2], ['ctrl', 1]], wall: ['cabinet', 'bottles', 'pipes'], free: ['drums', 'bottles', 'crate'], area: 20, plants: 0 },
    { fill: 0.85, pods: [['boiler', 6], ['pipes', 2], ['pump', 1]], wall: ['cabinet', 'bottles'], free: ['drums', 'bottles'], area: 16, plants: 0 },
    { fill: 1, pods: [['ctrl', 5], ['deskb', 2], ['mani', 1]], wall: ['cabinet', 'plant', 'bottles'], free: ['chair', 'cabinet', 'table'], area: 12, plants: 4 },
  ]),
  bank: set('bank', ['Banking hall', 'Mezzanine offices', 'Deposit level', 'Vault level'], [
    { fill: 0.5, pods: [['counter', 5], ['galbench', 2], ['pillar', 2], ['round', 1]], wall: ['atm', 'plant', 'bench', 'atm'], free: ['bench', 'plant', 'chair'], area: 5, plants: 8 },
    { fill: 0.95, pods: [['deskb', 4], ['glass', 3], ['pillar', 2], ['conf', 1]], wall: ['atm', 'plant', 'deposit', 'cabinet'], free: ['plant', 'chair', 'chair', 'cabinet'], area: 11, plants: 10 },
    { fill: 0.8, pods: [['depwall', 6], ['pillar', 2], ['cart', 1]], wall: ['deposit', 'atm', 'cabinet'], free: ['cart', 'chair'], area: 15, plants: 0 },
    { fill: 1, pods: [['cart', 3], ['depwall', 3], ['deskb', 2], ['pillar', 1]], wall: ['deposit', 'atm', 'plant'], free: ['cart', 'chair', 'cabinet'], area: 14, plants: 4 },
  ]),
  warehouse: set('warehouse', ['Loading floor', 'Racking level', 'Mezzanine catwalk', 'Dispatch offices'], [
    { fill: 0.7, pods: [['pallets', 3], ['crates', 3], ['forklift', 2], ['drums', 1]], wall: ['crate', 'drums', 'pallets'], free: ['crate', 'drums', 'pallets'], area: 12, plants: 0 },
    { fill: 1, pods: [['rackrow', 3], ['racks', 5], ['pallets', 2]], wall: ['crate', 'drums'], free: ['crate', 'drums', 'pallets'], area: 22, plants: 0 },
    { fill: 0.85, pods: [['conveyor', 4], ['cage', 3], ['crates', 2]], wall: ['crate', 'drums', 'cage'], free: ['crate', 'drums'], area: 16, plants: 0 },
    { fill: 0.95, pods: [['deskb', 3], ['cage', 3], ['crates', 2], ['container', 1]], wall: ['crate', 'plant', 'cabinet'], free: ['crate', 'chair', 'cabinet'], area: 12, plants: 4 },
  ]),
  lab: set('lab', ['Atrium lab', 'Specimen floor', 'Cleanroom', "Director's labs"], [
    { fill: 0.55, pods: [['bench1', 5], ['tank', 2], ['hood', 1]], wall: ['fridge', 'board', 'plant', 'cart'], free: ['stool', 'cart'], area: 5, plants: 5 },
    { fill: 0.95, pods: [['tank', 5], ['bench1', 3], ['benches', 1]], wall: ['fridge', 'hood', 'board'], free: ['cart', 'stool'], area: 9, plants: 0 },
    { fill: 0.8, pods: [['benches', 3], ['hood', 3], ['airlock', 2]], wall: ['fridge', 'hood', 'board'], free: ['cart', 'stool'], area: 11, plants: 0 },
    { fill: 0.95, pods: [['station', 4], ['bench1', 2], ['tank', 1], ['hood', 1]], wall: ['fridge', 'plant', 'board', 'hood'], free: ['cart', 'stool', 'chair'], area: 10, plants: 5 },
  ]),
};

// ---- the generator ----

type Open = { N: boolean; S: boolean; E: boolean; W: boolean };
/** The tower's plan as the generator needs it (towerplan.ts's TOWER_LAYOUT). */
export type LayoutPlan = {
  cols: number;
  rows: number;
  levels: number;
  /** What this layout was generated from: furniture follows it (the same seed, the same furniture). */
  seed?: number;
  walkable: (level: number, x: number, y: number) => boolean;
  playCells: (level: number) => Open[][];
  /** Cells where nothing may stand (stair heads, lift doors, the keycard, doors, a sentry's cell). */
  blocked: (level: number, x: number, y: number) => boolean;
  /** The pieces every tower has the same, where the game needs them (the reception desk, the security room's console and the gallery's stair console). */
  fixed: readonly Piece[];
  /** Strips that stay clear though they are not lanes between cells: stair landings, the bridge deck's approach, the front of a lift. */
  keepClear?: (level: number) => ReadonlyArray<{ x0: number; x1: number; z0: number; z1: number }>;
  /** The slabs of the interior walls: nothing stands in them. */
  wallRects?: (level: number) => ReadonlyArray<{ x0: number; x1: number; z0: number; z1: number }>;
};

let PLAN: LayoutPlan | null = null;
const CACHE = new Map<string, Placed[][]>();
/** Gives the generator the tower's plan (once, before the first `furnitureFor`). */
export function setLayoutPlan(plan: LayoutPlan): void {
  PLAN = plan;
  CACHE.clear();
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 0.4; // the agent's radius
const overlaps = (a: Placed, others: readonly Placed[], gap = 0.1): boolean =>
  others.some((b) => !b.spec.decor && a.box.minX < b.box.maxX + gap && a.box.maxX > b.box.minX - gap && a.box.minZ < b.box.maxZ + gap && a.box.maxZ > b.box.minZ - gap);

const CENTRE = 0.6;

/** Whether a piece sits in a lane: every lane between two open neighbours is kept clear of the generated furniture and of the middle of each cell (the fixed pieces, the desk and the consoles, stand where the plan puts them, with the lane beside them shut in the plan). */
export function inLane(plan: LayoutPlan, level: number, p: Placed): boolean {
  const play = plan.playCells(level);
  const H = 0.5;
  if ((plan.keepClear?.(level) ?? []).some((r) => p.box.minX < r.x1 && p.box.maxX > r.x0 && p.box.minZ < r.z1 && p.box.maxZ > r.z0)) return true;
  if ((plan.wallRects?.(level) ?? []).some((r) => p.box.minX < r.x1 - 1e-6 && p.box.maxX > r.x0 + 1e-6 && p.box.minZ < r.z1 - 1e-6 && p.box.maxZ > r.z0 + 1e-6)) return true;
  for (let y = 0; y < plan.rows; y++) {
    for (let x = 0; x < plan.cols; x++) {
      // The middle of a cell is where every walker turns: it stays clear too.
      const o = play[y]![x]!;
      if ((o.N || o.S || o.E || o.W) && p.box.minX < x * 4 + CENTRE && p.box.maxX > x * 4 - CENTRE && p.box.minZ < y * 4 + CENTRE && p.box.maxZ > y * 4 - CENTRE) return true;
      for (const dir of ['E', 'S'] as const) {
        if (!play[y]![x]![dir]) continue;
        const [x0, x1, z0, z1] = dir === 'E' ? [x * 4, x * 4 + 4, y * 4 - H, y * 4 + H] : [x * 4 - H, x * 4 + H, y * 4, y * 4 + 4];
        if (p.box.minX < x1 && p.box.maxX > x0 && p.box.minZ < z1 && p.box.maxZ > z0) return true;
      }
    }
  }
  return false;
}

/** Whether a way is left between every pair of open neighbours (a gap along each edge the agent can get through). */
export function waysOpen(plan: LayoutPlan, level: number, solid: readonly Placed[]): boolean {
  const play = plan.playCells(level);
  const real = solid.filter((p) => !p.spec.decor);
  for (let y = 0; y < plan.rows; y++) {
    for (let x = 0; x < plan.cols; x++) {
      for (const dir of ['E', 'S'] as const) {
        if (!play[y]![x]![dir]) continue;
        const alongX = dir === 'S';
        const edge = alongX ? y * 4 + 2 : x * 4 + 2;
        const lo = (alongX ? x * 4 : y * 4) - 2 + EDGE_MARGIN + R;
        const hi = (alongX ? x * 4 : y * 4) + 2 - EDGE_MARGIN - R;
        const ranges = real
          .filter((p) => (alongX ? p.box.minZ < edge + R && p.box.maxZ > edge - R : p.box.minX < edge + R && p.box.maxX > edge - R))
          .map((p) => (alongX ? [p.box.minX - R, p.box.maxX + R] : [p.box.minZ - R, p.box.maxZ + R]) as [number, number]);
        const cands = [lo, hi, ...ranges.flatMap(([a, b]) => [a - 1e-6, b + 1e-6])].filter((v) => v >= lo && v <= hi);
        if (!cands.some((v) => !ranges.some(([a, b]) => v > a && v < b))) return false;
      }
    }
  }
  return true;
}

/** Whether a piece stands against a wall or a rail: a shut edge of a cell it is in, within a metre or so. */
function nearWall(plan: LayoutPlan, level: number, p: Placed): boolean {
  const play = plan.playCells(level);
  const reach = 1.1;
  const cx = Math.round((p.box.minX + p.box.maxX) / 8);
  const cy = Math.round((p.box.minZ + p.box.maxZ) / 8);
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      const c = play[y]?.[x];
      if (!c || !plan.walkable(level, x, y)) continue;
      const hit = (dir: 'N' | 'S' | 'E' | 'W'): boolean => {
        if (c[dir]) return false;
        if (dir === 'N') return p.box.minZ - (y * 4 - 2) < reach && p.box.maxZ > y * 4 - 2 - 0.01 && p.box.maxX > x * 4 - 2 && p.box.minX < x * 4 + 2;
        if (dir === 'S') return y * 4 + 2 - p.box.maxZ < reach && p.box.minZ < y * 4 + 2 + 0.01 && p.box.maxX > x * 4 - 2 && p.box.minX < x * 4 + 2;
        if (dir === 'W') return p.box.minX - (x * 4 - 2) < reach && p.box.maxX > x * 4 - 2 - 0.01 && p.box.maxZ > y * 4 - 2 && p.box.minZ < y * 4 + 2;
        return x * 4 + 2 - p.box.maxX < reach && p.box.minX < x * 4 + 2 + 0.01 && p.box.maxZ > y * 4 - 2 && p.box.minZ < y * 4 + 2;
      };
      if ((['N', 'S', 'E', 'W'] as const).some(hit)) return true;
    }
  }
  return false;
}

export const footprint = (ps: readonly Placed[]): number => ps.filter((p) => !p.spec.decor).reduce((a, p) => a + (p.box.maxX - p.box.minX) * (p.box.maxZ - p.box.minZ), 0);

/** 0..n-1 in an order that spreads out: the first picks are far apart (van der Corput), so rows chosen from the front of it are evenly spaced down the floor. */
function spread(n: number): number[] {
  const key = (k: number): number => {
    let f = 0.5;
    let r = 0;
    for (let m = k + 1; m > 0; m >>= 1, f /= 2) if (m & 1) r += f;
    return r;
  };
  return Array.from({ length: n }, (_, k) => k).sort((a, b) => key(a) - key(b));
}

/**
 * One storey of a set, furnished three parts in order to one scattered: rows of one kind of pod across the free squares (the rows spread evenly down the floor, each row one recipe all turned the
 * same way), single pieces lined up along the walls and rails in runs (one kind to a run, at an even rhythm), and a small piece in a few of the corners; then a third as much again
 * scattered about (a pod turned the other way, pieces at random walls, small things in the gaps).
 */
function generateLevel(plan: LayoutPlan, setId: TowerSetId, level: number): Placed[] {
  const mix = TOWER_SETS[setId].levels[level]!;
  const rand = rng(1000 + level * 77 + TOWER_SET_IDS.indexOf(setId) * 7919 + (plan.seed ?? 0) * 104729);
  const placed: Placed[] = plan.fixed.filter((p) => p.level === level).map((p) => place(p));
  const play = plan.playCells(level);
  let floorCells = 0;
  const free = (x: number, y: number): boolean => plan.walkable(level, x, y) && !plan.blocked(level, x, y);
  for (let y = 0; y < plan.rows; y++) for (let x = 0; x < plan.cols; x++) if (plan.walkable(level, x, y)) floorCells++;
  const wantArea = (mix.area / 100) * floorCells * 16;
  const plants = (): number => placed.filter((q) => q.kind === 'plant').length;
  const plantOk = (q: Placed): boolean => q.kind !== 'plant' || (plants() < (mix.plants ?? 0) && nearWall(plan, level, q));
  const attempt = (p: Placed): boolean => {
    if (overlaps(p, placed, 0.12) || inLane(plan, level, p) || !plantOk(p)) return false;
    if (!waysOpen(plan, level, [...placed, p])) return false;
    placed.push(p);
    return true;
  };
  // ---- pods: whole rows of one recipe, spread down the floor ----
  // Each row is one recipe, picked by weight for the whole row, so a floor reads as bays of the same thing rather than a scatter.
  const total = mix.pods.reduce((a, [, w]) => a + w, 0);
  const pickPod = (): string => {
    let x = rand() * total;
    for (const [k, w] of mix.pods) if ((x -= w) < 0) return k;
    return mix.pods[0]![0];
  };
  const rowsAvail = Array.from({ length: Math.max(0, plan.rows - 1) }, (_, j) => j);
  const wantRows = Math.round(rowsAvail.length * mix.fill);
  const rowKinds = rowsAvail.map(() => pickPod());
  const furnishRow = (j: number): void => {
    const kind = rowKinds[j]!;
    for (let i = 0; i < plan.cols - 1; i++) {
      if (footprint(placed) >= wantArea * 1.15) break;
      if (![[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].every(([x, y]) => free(x!, y!))) continue;
      const ps = podPieces({ level, kind, i, j });
      if (ps.some((p) => overlaps(p, placed) || inLane(plan, level, p))) continue;
      if (!waysOpen(plan, level, [...placed, ...ps])) continue;
      placed.push(...ps);
    }
  };
  const order = spread(rowsAvail.length);
  for (const idx of order.slice(0, wantRows)) furnishRow(rowsAvail[idx]!);
  // ---- single pieces along the walls and rails, in runs ----
  const sides = [
    { dir: 'N', step: [1, 0] },
    { dir: 'S', step: [1, 0] },
    { dir: 'W', step: [0, 1] },
    { dir: 'E', step: [0, 1] },
  ] as const;
  const runs: Array<{ dir: 'N' | 'S' | 'E' | 'W'; cells: Array<[number, number]> }> = [];
  for (const { dir, step } of sides) {
    const along = (x: number, y: number): boolean => free(x, y) && !play[y]![x]![dir];
    for (let y = 0; y < plan.rows; y++) {
      for (let x = 0; x < plan.cols; x++) {
        if (!along(x, y) || along(x - step[0], y - step[1])) continue; // the start of a run
        const cells: Array<[number, number]> = [];
        for (let cx = x, cy = y; cx < plan.cols && cy < plan.rows && along(cx, cy); cx += step[0], cy += step[1]) cells.push([cx, cy]);
        runs.push({ dir, cells });
      }
    }
  }
  // The longest runs first: a long wall gets one kind, end to end.
  runs.sort((a, b) => b.cells.length - a.cells.length);
  let runNo = 0;
  for (const run of runs) {
    if (footprint(placed) >= wantArea) break;
    if (run.cells.length < 2) continue;
    const kind = mix.wall[runNo++ % mix.wall.length]!;
    const len = KINDS[kind].len;
    // Pieces at an even rhythm along the wall: three to a cell when they are small, two when middling, one when long; a plant or other small thing every other cell.
    const offsets = len <= 1.0 && kind === 'plant' ? [0] : len <= 1.3 ? [-1.25, 0, 1.25] : len <= 1.9 ? [-1, 1] : [0];
    const stride = kind === 'plant' ? 2 : 1;
    for (let k = rand() < 0.5 ? 0 : 1; k < run.cells.length; k += stride) {
      if (footprint(placed) >= wantArea) break;
      const [x, y] = run.cells[k]!;
      for (const along of offsets) {
        const piece = place({ level, kind, x, y, edge: run.dir, along });
        const b = piece.box;
        if (b.minX < x * 4 - 2 + EDGE_MARGIN - 1e-9 || b.maxX > x * 4 + 2 - EDGE_MARGIN + 1e-9 || b.minZ < y * 4 - 2 + EDGE_MARGIN - 1e-9 || b.maxZ > y * 4 + 2 - EDGE_MARGIN + 1e-9) continue;
        attempt(piece);
      }
    }
  }
  // ---- a small piece in some corners ----
  const corners: Array<[number, number, 'N' | 'S', 'E' | 'W']> = [];
  for (let y = 0; y < plan.rows; y++) {
    for (let x = 0; x < plan.cols; x++) {
      if (!free(x, y)) continue;
      for (const v of ['N', 'S'] as const) for (const h of ['E', 'W'] as const) if (!play[y]![x]![v] && !play[y]![x]![h]) corners.push([x, y, v, h]);
    }
  }
  const smalls = mix.free.filter((k) => KINDS[k].len <= 1.3 && !KINDS[k].decor);
  if (smalls.length > 0) {
    let n = 0;
    for (const [x, y, v, h] of corners) {
      if (footprint(placed) >= wantArea || rand() > 0.5) continue;
      const kind = smalls[n++ % smalls.length]!;
      const spec = KINDS[kind];
      const reach = 2 - EDGE_MARGIN - spec.len / 2;
      attempt(place({ level, kind, x, y, edge: v, along: h === 'E' ? reach : -reach }));
    }
  }
  // ---- still short of the floor's share: more rows of pods, the same way ----
  for (const idx of order.slice(wantRows)) {
    if (footprint(placed) >= wantArea * 0.8) break;
    furnishRow(rowsAvail[idx]!);
  }
  // ---- the rest, a quarter of it, scattered: a pod turned the other way, a piece against some wall, small things in the gaps ----
  const tidy = footprint(placed);
  const scatter = tidy / 3; // (so three quarters of the furniture is in order)
  const upTo = (share: number): number => tidy + scatter * share;
  const squares: Array<[number, number]> = [];
  for (let j = 0; j < plan.rows - 1; j++) for (let i = 0; i < plan.cols - 1; i++) squares.push([i, j]);
  squares.sort(() => rand() - 0.5);
  for (const [i, j] of squares) {
    if (footprint(placed) >= upTo(0.4)) break;
    if (![[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].every(([x, y]) => free(x!, y!))) continue;
    const ps = podPieces({ level, kind: pickPod(), i, j, turn: rand() < 0.5 });
    if (ps.some((p) => overlaps(p, placed) || inLane(plan, level, p))) continue;
    if (!waysOpen(plan, level, [...placed, ...ps])) continue;
    placed.push(...ps);
  }
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < plan.rows; y++) for (let x = 0; x < plan.cols; x++) if (free(x, y)) cells.push([x, y]);
  for (let round = 0; round < 4 && footprint(placed) < upTo(0.7); round++) {
    cells.sort(() => rand() - 0.5);
    for (const [x, y] of cells) {
      if (footprint(placed) >= upTo(0.7)) break;
      const edge = (['N', 'S', 'E', 'W'] as const)[Math.floor(rand() * 4)]!;
      const kind = mix.wall[Math.floor(rand() * mix.wall.length)]!;
      const along = [-1, 0, 1][Math.floor(rand() * 3)]! * (KINDS[kind].len < 2.5 ? 1 : 0);
      const piece = place({ level, kind, x, y, edge, along });
      const b = piece.box;
      if (b.minX < x * 4 - 2 + EDGE_MARGIN - 1e-9 || b.maxX > x * 4 + 2 - EDGE_MARGIN + 1e-9 || b.minZ < y * 4 - 2 + EDGE_MARGIN - 1e-9 || b.maxZ > y * 4 + 2 - EDGE_MARGIN + 1e-9) continue;
      attempt(piece);
    }
  }
  for (let k = 0; k < 3000 && footprint(placed) < upTo(1); k++) {
    const x = rand() * (plan.cols * 4);
    const z = rand() * (plan.rows * 4);
    if (!free(Math.round(x / 4), Math.round(z / 4))) continue;
    const kind = mix.free[Math.floor(rand() * mix.free.length)]!;
    const yaw = [0, PI / 2, PI, -PI / 2][Math.floor(rand() * 4)]!;
    const p = placeFree(level, kind, Math.round(x * 10) / 10, Math.round(z * 10) / 10, yaw);
    const corners4 = [[p.box.minX, p.box.minZ], [p.box.maxX, p.box.minZ], [p.box.minX, p.box.maxZ], [p.box.maxX, p.box.maxZ]] as const;
    if (!corners4.every(([qx, qz]) => free(Math.round(qx / 4), Math.round(qz / 4)))) continue;
    attempt(p);
  }
  return placed;
}

/** The furniture of storey `level` of tower `setId`, laid out once and kept. */
export function furnitureFor(level: number, setId: TowerSetId = 'campus'): Placed[] {
  if (!PLAN) throw new Error('furnitureFor: call setLayoutPlan first');
  const key = `${setId}:${PLAN.seed ?? 0}`;
  let all = CACHE.get(key);
  if (!all) {
    all = Array.from({ length: PLAN.levels }, (_, l) => generateLevel(PLAN!, setId, l));
    CACHE.set(key, all);
    if (CACHE.size > 12) CACHE.delete(CACHE.keys().next().value!);
  }
  return all[level] ?? [];
}
