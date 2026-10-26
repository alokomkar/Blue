import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRACT_IDS } from './contracts.ts';
import {
  BRIEF_MAX,
  LAYOUT_IDS,
  LEVEL_SPEC_SCHEMA,
  BUILD_PHASE,
  MAX_ALCOVES,
  carveAlcoves,
  phaseSeed,
  MAX_SEED,
  MAX_TWISTS,
  PLACE_IDS,
  SPEC_LIMITS,
  TITLE_MAX,
  TWIST_IDS,
  clampSpec,
  type GridCell,
  defaultSpec,
  effectiveSize,
  fitsContract,
  inspectSpec,
  mayShare,
  parseSpec,
  specToDifficulty,
  twistedRoster,
  type LevelSpec,
} from './levelspec.ts';
import { difficultyFor, MAX_COLS, MAX_ROWS } from '../client/game/difficulty.ts';
import { TWIST_IDS as GAME_TWIST_IDS, applyTwists, fitsContract as gameFits, mayShare as gameMay, SILENT_DOGS, SILENT_MAX_COLS, SILENT_MAX_ROWS } from '../client/game/twists.ts';
import { LOCATIONS } from '../client/game/locations.ts';
import { generateLayout } from '../client/game/layouts.ts';
import { generateBuilding } from '../client/game/building.ts';

/** The members of the string-literal union `export type <name> = 'a' | 'b'` in a client file: how the lists the client keeps only as types are read. */
function unionOf(file: string, name: string): string[] {
  const src = readFileSync(new URL(`../client/game/${file}`, import.meta.url), 'utf8');
  const m = new RegExp(`export type ${name} =([^;]+);`).exec(src);
  assert.ok(m, `${name} not found in ${file}`);
  return [...m[1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]!);
}

const sorted = (a: readonly string[]): string[] => [...a].sort();

test('the spec lists match the game\'s own: places, layouts, twists, contracts', () => {
  assert.deepEqual(sorted(PLACE_IDS), sorted(Object.keys(LOCATIONS)));
  assert.deepEqual(sorted(PLACE_IDS), sorted(unionOf('locations.ts', 'LocationId')));
  assert.deepEqual(sorted(LAYOUT_IDS.filter((l) => l !== 'maze')), sorted(unionOf('layouts.ts', 'LayoutStyle')));
  assert.equal(LAYOUT_IDS.includes('maze'), true);
  assert.deepEqual([...TWIST_IDS], [...GAME_TWIST_IDS]);
  assert.deepEqual(sorted(TWIST_IDS), sorted(unionOf('twists.ts', 'TwistId')));
  // Every place's own layouts are ones a spec can name, and every layout a spec can name builds.
  for (const loc of Object.values(LOCATIONS)) for (const l of loc.layouts) assert.ok((LAYOUT_IDS as readonly string[]).includes(l), `${loc.id} uses ${l}`);
  for (const layout of LAYOUT_IDS.filter((l) => l !== 'maze')) {
    const cells = generateLayout(layout as 'halls', 10, 8, null, generateBuilding);
    assert.equal(cells.length, 8, layout);
    assert.equal(cells[0]!.length, 10, layout);
  }
});

test('the caps are the game\'s: the size cap, and the most any of the first forty jobs asks of each count', () => {
  assert.equal(SPEC_LIMITS.cols[1], MAX_COLS);
  assert.equal(SPEC_LIMITS.rows[1], MAX_ROWS);
  const jobs = Array.from({ length: 40 }, (_, i) => difficultyFor(i + 1));
  const peak = (pick: (d: ReturnType<typeof difficultyFor>) => number): number => Math.max(...jobs.map(pick));
  const roster = SPEC_LIMITS.roster;
  const hazards = SPEC_LIMITS.hazards;
  const pairs: Array<[string, number, number]> = [
    ['guards', roster.guards[1], peak((d) => d.guards)],
    ['watchdogs', roster.watchdogs[1], peak((d) => d.watchdogs)],
    ['crawlers', roster.crawlers[1], peak((d) => d.crawlers)],
    ['alphas', roster.alphas[1], peak((d) => d.alphas)],
    ['drones', roster.drones[1], peak((d) => d.drones)],
    ['doors', hazards.doors[1], peak((d) => d.doors)],
    ['lasers', hazards.lasers[1], peak((d) => d.lasers)],
    ['lines', hazards.lines[1], peak((d) => d.lines)],
    ['gates', hazards.gates[1], peak((d) => d.gates)],
    ['sweepers', hazards.sweepers[1], peak((d) => d.sweepers)],
    ['sliders', hazards.sliders[1], peak((d) => d.sliders)],
    ['shutters', hazards.shutters[1], peak((d) => d.shutters)],
    ['blackouts', hazards.blackouts[1], peak((d) => d.blackouts)],
    ['documents', SPEC_LIMITS.documents[1], peak((d) => d.documents)],
  ];
  for (const [name, cap, game] of pairs) assert.equal(cap, game, `${name}: cap ${cap}, hardest job ${game}`);
  // The one count DESIGN.md lets run past the game's hardest job: two heavies where the game has one.
  assert.equal(roster.heavies[1], 2);
  assert.ok(peak((d) => d.heavies) <= roster.heavies[1]);
  // The smallest floor still fits the first job's own size.
  assert.ok(SPEC_LIMITS.cols[0] <= difficultyFor(1).cols && SPEC_LIMITS.rows[0] <= difficultyFor(1).rows);
});

test('the twist rules are twists.ts\'s: which fit a contract, which pairs clash, what a twist does to the roster', () => {
  for (const c of CONTRACT_IDS) for (const t of TWIST_IDS) assert.equal(fitsContract(t, c), gameFits(t, c), `${t} on ${c}`);
  for (const a of TWIST_IDS) for (const b of TWIST_IDS) assert.equal(mayShare(a, b), gameMay(a, b), `${a} and ${b}`);
  assert.equal(SILENT_MAX_COLS, 10);
  assert.equal(SILENT_MAX_ROWS, 7);
  const base = difficultyFor(6);
  for (const twists of [[], ...TWIST_IDS.map((t) => [t]), ['lightsout', 'lightkit'], ['reinforcements', 'shiftchange']] as Array<LevelSpec['twists']>) {
    const spec = { ...defaultSpec(), roster: { guards: base.guards, watchdogs: base.watchdogs, crawlers: base.crawlers, alphas: base.alphas, drones: base.drones, heavies: base.heavies }, hazards: { ...defaultSpec().hazards, blackouts: base.blackouts }, twists };
    const game = applyTwists(base, twists);
    const mine = twistedRoster(spec);
    assert.equal(mine.blackouts, game.blackouts, `blackouts under ${twists}`);
    assert.equal(mine.guards, game.guards, `guards under ${twists}`);
    assert.equal(mine.watchdogs, game.watchdogs, `dogs under ${twists}`);
  }
  // A silent night is dogs only, and a smaller floor for the slower pace (game.ts).
  const silent = twistedRoster({ ...defaultSpec(), twists: ['silent'], roster: { guards: 4, watchdogs: 0, crawlers: 2, alphas: 2, drones: 1, heavies: 1 } });
  assert.deepEqual([silent.guards, silent.watchdogs, silent.crawlers, silent.alphas, silent.drones, silent.heavies], [0, SILENT_DOGS, 0, 0, 0, 0]);
  assert.deepEqual(effectiveSize({ size: { cols: 14, rows: 10 }, twists: ['silent'] }), { cols: SILENT_MAX_COLS, rows: SILENT_MAX_ROWS });
  assert.deepEqual(effectiveSize({ size: { cols: 8, rows: 6 }, twists: ['silent'] }), { cols: 8, rows: 6 });
  assert.deepEqual(effectiveSize({ size: { cols: 14, rows: 10 }, twists: [] }), { cols: 14, rows: 10 });
});

// ---------------------------------------------------------------------------------------------------------------------

/** A value that satisfies `schema`, by a simple walk: the lowest or highest number, the first enum member, as long a list as allowed. */
function sample(schema: Record<string, unknown>, high: boolean): unknown {
  if (Array.isArray(schema.enum)) return high ? schema.enum[schema.enum.length - 1] : schema.enum[0];
  if (schema.type === 'integer') return high ? schema.maximum : schema.minimum;
  if (schema.type === 'string') return 'x'.repeat(high ? (schema.maxLength as number) : (schema.minLength as number));
  if (schema.type === 'array') {
    const items = schema.items as Record<string, unknown>;
    // (every enum member once, up to maxItems; the twists clash with one another, so one is enough to test the fit)
    return high ? [sample(items, false)] : [];
  }
  const props = schema.properties as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sample(v, high)]));
}

function depth(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0;
  return 1 + Math.max(0, ...Object.values(node).map(depth));
}

test('the schema: strict objects, every field required, enums equal the lists, three levels of objects, no references', () => {
  const walk = (node: Record<string, unknown>, path: string): void => {
    assert.equal('$ref' in node || '$defs' in node || 'anyOf' in node || 'oneOf' in node || 'allOf' in node, false, `${path} uses a reference or a union`);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path} allows extra fields`);
      const props = node.properties as Record<string, Record<string, unknown>>;
      assert.deepEqual(sorted(node.required as string[]), sorted(Object.keys(props)), `${path} requires every field`);
      for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`);
    }
    if (node.type === 'array') walk(node.items as Record<string, unknown>, `${path}[]`);
  };
  walk(LEVEL_SPEC_SCHEMA, 'spec');
  const props = LEVEL_SPEC_SCHEMA.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(props.place!.enum, [...PLACE_IDS]);
  assert.deepEqual(props.layout!.enum, [...LAYOUT_IDS]);
  assert.deepEqual(props.contract!.enum, [...CONTRACT_IDS]);
  assert.deepEqual((props.twists!.items as { enum: string[] }).enum, [...TWIST_IDS]);
  assert.equal(props.twists!.maxItems, MAX_TWISTS);
  assert.deepEqual(props.floors!.enum, [1, 2]);
  assert.equal(props.seed!.maximum, MAX_SEED);
  assert.equal(props.title!.maxLength, TITLE_MAX);
  assert.equal(props.brief!.maxLength, BRIEF_MAX);
  // Structured output allows ten levels, and the spec is the object, its groups, and their fields.
  assert.ok(depth(LEVEL_SPEC_SCHEMA) <= 10, `depth ${depth(LEVEL_SPEC_SCHEMA)}`);
  // The groups' ranges are the clamp's.
  const group = (name: 'roster' | 'hazards'): Record<string, Record<string, number>> => (props[name]!.properties as Record<string, Record<string, number>>);
  for (const [k, [lo, hi]] of Object.entries(SPEC_LIMITS.roster)) assert.deepEqual([group('roster')[k]!.minimum, group('roster')[k]!.maximum], [lo, hi], k);
  for (const [k, [lo, hi]] of Object.entries(SPEC_LIMITS.hazards)) assert.deepEqual([group('hazards')[k]!.minimum, group('hazards')[k]!.maximum], [lo, hi], k);
  // The whole thing can be serialised as it is (a request body), and the leaves are only the keywords a schema-constrained decoder reads.
  assert.deepEqual(JSON.parse(JSON.stringify(LEVEL_SPEC_SCHEMA)), LEVEL_SPEC_SCHEMA);
});

test('whatever the schema accepts, the clamp leaves alone: the lowest and the highest sample of it change nothing', () => {
  for (const high of [false, true]) {
    const value = sample(LEVEL_SPEC_SCHEMA, high);
    const { spec, changes } = clampSpec(value);
    assert.deepEqual(changes, [], `${high ? 'highest' : 'lowest'} sample was changed`);
    assert.deepEqual(spec, value);
  }
});

test('the default spec is itself legal', () => {
  const { spec, changes } = clampSpec(defaultSpec());
  assert.deepEqual(changes, []);
  assert.deepEqual(spec, defaultSpec());
});

test('counts and sizes outside the game\'s are clamped, and each change is said', () => {
  const raw = {
    ...defaultSpec(),
    size: { cols: 40, rows: 2 },
    floors: 3,
    seed: -4,
    roster: { guards: 99, watchdogs: -1, crawlers: 2, alphas: 7, drones: 5, heavies: 3 },
    hazards: { doors: 9, lasers: 4, lines: 2, gates: 3, sweepers: 2, sliders: 2, shutters: 1, blackouts: 3 },
    loot: { documents: 0 },
  };
  const { spec, changes } = clampSpec(raw);
  assert.deepEqual(spec.size, { cols: MAX_COLS, rows: 5 });
  assert.equal(spec.floors, 2);
  assert.equal(spec.seed, 0);
  assert.deepEqual(spec.roster, { guards: 4, watchdogs: 0, crawlers: 2, alphas: 2, drones: 1, heavies: 2 });
  assert.deepEqual(spec.hazards, { doors: 2, lasers: 3, lines: 2, gates: 3, sweepers: 2, sliders: 2, shutters: 1, blackouts: 2 });
  assert.equal(spec.loot.documents, 1);
  for (const field of ['size.cols', 'size.rows', 'floors', 'seed', 'roster.guards', 'roster.watchdogs', 'roster.alphas', 'roster.drones', 'roster.heavies', 'hazards.doors', 'hazards.lasers', 'hazards.blackouts', 'loot.documents']) {
    assert.ok(changes.some((c) => c.startsWith(field + ' ')), `no change reported for ${field}: ${changes.join(' | ')}`);
  }
  assert.equal(changes.length, 13);
});

test('fractions are rounded, and the largest seed is a seed', () => {
  const { spec, changes } = clampSpec({ ...defaultSpec(), seed: MAX_SEED, size: { cols: 9.6, rows: 7.2 } });
  assert.deepEqual(spec.size, { cols: 10, rows: 7 });
  assert.equal(spec.seed, MAX_SEED);
  assert.equal(changes.length, 2);
  assert.match(changes[0]!, /not a whole number/);
  assert.equal(clampSpec({ ...defaultSpec(), seed: MAX_SEED + 5 }).spec.seed, MAX_SEED);
});

test('wrong types fall back to the default for that field, and the rest of the spec is kept', () => {
  const d = defaultSpec();
  const { spec, changes } = clampSpec({
    version: '1',
    title: 42,
    brief: ['no'],
    place: 'moon',
    layout: null,
    size: 'big',
    floors: '2',
    seed: 'abc',
    contract: 7,
    twists: 'silent',
    roster: { guards: '3', watchdogs: NaN, crawlers: null, alphas: true, drones: {}, heavies: [] },
    hazards: 5,
    loot: { documents: '2' },
    place2: 1,
  });
  assert.deepEqual(spec, d);
  assert.ok(changes.length >= 14);
  assert.ok(changes.some((c) => /place2/.test(c)), 'the unknown field is reported');
  // One bad field leaves its neighbours.
  const mixed = clampSpec({ ...defaultSpec(), roster: { ...d.roster, guards: 'many', watchdogs: 2 } });
  assert.equal(mixed.spec.roster.guards, d.roster.guards);
  assert.equal(mixed.spec.roster.watchdogs, 2);
});

test('missing fields are filled, not thrown over: an empty object is the default spec', () => {
  const { spec, changes } = clampSpec({});
  assert.deepEqual(spec, defaultSpec());
  assert.ok(changes.length > 10 && changes.every((c) => /missing/.test(c)));
});

test('twists that don\'t fit the contract, clash with the other, repeat or aren\'t twists are dropped, and told apart', () => {
  const d = defaultSpec();
  const run = (twists: unknown, contract = 'records') => inspectSpec({ ...d, contract, twists });
  const silentSabotage = run(['silent'], 'sabotage');
  assert.deepEqual(silentSabotage.spec.twists, []);
  assert.deepEqual(silentSabotage.problems.map((p) => p.code), ['twist_misfit']);
  const clash = run(['timer', 'lockdown']);
  assert.deepEqual(clash.spec.twists, ['timer']);
  assert.deepEqual(clash.problems.map((p) => p.code), ['twist_misfit']);
  assert.deepEqual(run(['lockdown', 'lightsout']).spec.twists, ['lockdown', 'lightsout']);
  assert.deepEqual(run(['lockdown', 'lockdown']).spec.twists, ['lockdown']);
  assert.deepEqual(run(['lockdown', 'lightsout', 'lightkit']).spec.twists, ['lockdown', 'lightsout']);
  const junk = run(['lockdown', 'banana', 3, null]);
  assert.deepEqual(junk.spec.twists, ['lockdown']);
  assert.equal(junk.problems.length, 3);
  assert.deepEqual(run(undefined).spec.twists, []);
  assert.equal(run({}).problems[0]!.code, 'bad_field');
  // Every pair the game deals is kept, and every pair it forbids is not.
  for (const a of TWIST_IDS) {
    for (const b of TWIST_IDS) {
      if (a === b || !gameFits(a, 'records') || !gameFits(b, 'records')) continue;
      assert.equal(run([a, b]).spec.twists.length === 2, gameMay(a, b), `${a} with ${b}`);
    }
  }
});

test('the text is trimmed, tidied and cut to length', () => {
  const long = 'a'.repeat(300);
  const { spec, changes } = clampSpec({ ...defaultSpec(), title: `  The   night\tshift\n${long}`, brief: long });
  assert.equal(spec.title.length, TITLE_MAX);
  assert.ok(spec.title.startsWith('The night shift aaaa'));
  assert.equal(spec.brief.length, BRIEF_MAX);
  assert.equal(changes.length, 2);
  assert.equal(clampSpec({ ...defaultSpec(), title: '   ' }).spec.title, defaultSpec().title);
  assert.equal(clampSpec({ ...defaultSpec(), title: 'Quiet one' }).changes.length, 0);
});

test('anything that is not an object gives the default spec, and nothing throws', () => {
  for (const raw of [null, undefined, 0, 7, 'text', true, [], [1, 2], () => 1]) {
    const { spec, changes } = clampSpec(raw);
    assert.deepEqual(spec, defaultSpec());
    assert.equal(changes.length, 1);
  }
});

test('whatever JSON comes in, a legal spec comes out, and reading that again changes nothing', () => {
  // A seeded fuzz: random trees of numbers, strings, lists and objects, with the spec's own key names mixed in.
  let s = 12345;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const keys = ['version', 'title', 'brief', 'place', 'layout', 'size', 'floors', 'seed', 'contract', 'twists', 'roster', 'hazards', 'loot', 'grid', 'cols', 'rows', 'guards', 'doors', 'documents', 'cells', 'start', 'exit', 'x', 'y', 'n', 's', 'e', 'w', 'extra'];
  const value = (d: number): unknown => {
    const r = rnd();
    if (d > 3 || r < 0.3) return pick([0, 1, 2, -1, 5, 9.5, 1e12, -1e12, 0.5, true, false, null, 'silent', 'campus', 'records', 'halls', '', 'x'.repeat(500), 4294967296]);
    if (r < 0.55) return Array.from({ length: Math.floor(rnd() * 5) }, () => value(d + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 8) }, () => [pick(keys), value(d + 1)]));
  };
  for (let i = 0; i < 600; i++) {
    const base = i % 3 === 0 ? {} : { ...defaultSpec() };
    const raw = i % 2 === 0 ? value(0) : { ...base, ...(value(0) as object) };
    const { spec } = clampSpec(raw);
    assert.deepEqual(inspectSpec(spec).problems, [], `iteration ${i}: ${JSON.stringify(raw)?.slice(0, 200)}`);
    assert.ok(spec.size.cols >= SPEC_LIMITS.cols[0] && spec.size.cols <= MAX_COLS && spec.size.rows >= SPEC_LIMITS.rows[0] && spec.size.rows <= MAX_ROWS);
    assert.ok(spec.twists.length <= MAX_TWISTS && spec.twists.every((t) => fitsContract(t, spec.contract)));
  }
});

// ---------------------------------------------------------------------------------------------------------------------

test('parseSpec reads bare JSON, fenced JSON and JSON with talk round it, and says what it clamped', () => {
  const spec = { ...defaultSpec(), title: 'Museum night' };
  const bare = parseSpec(JSON.stringify(spec));
  assert.ok(bare.ok);
  assert.deepEqual(bare.ok && bare.spec, spec);
  assert.deepEqual(bare.ok && bare.changes, []);
  const fenced = parseSpec('```json\n' + JSON.stringify(spec, null, 2) + '\n```');
  assert.ok(fenced.ok && fenced.spec.title === 'Museum night');
  const talk = parseSpec('Here is the level:\n' + JSON.stringify(spec) + '\nLet me know if it needs changes.');
  assert.ok(talk.ok && talk.spec.title === 'Museum night');
  const clamped = parseSpec(JSON.stringify({ ...spec, roster: { ...spec.roster, guards: 12 } }));
  assert.ok(clamped.ok && clamped.spec.roster.guards === 4 && clamped.changes.length === 1);
});

test('parseSpec reports what is not a spec without throwing', () => {
  for (const text of ['', '   ', 'no json here', '{"title": ', '[1, 2]', '"text"', '42', 'null', '{ not json }', '```json\n{oops\n```']) {
    const r = parseSpec(text);
    assert.equal(r.ok, false, text);
    assert.ok(!r.ok && r.error.length > 0);
  }
  assert.equal(parseSpec(undefined as unknown as string).ok, false);
});

// ---------------------------------------------------------------------------------------------------------------------

test('a grid is kept when it is sound, and the size follows it', () => {
  const cols = 6;
  const rows = 5;
  const cells = Array.from({ length: cols * rows }, (_, i) => {
    const x = i % cols;
    return { n: false, s: false, e: x < cols - 1, w: x > 0 };
  });
  const grid = { cols, rows, cells, start: { x: 0, y: 0 }, exit: { x: 5, y: 0 } };
  const { spec, changes } = clampSpec({ ...defaultSpec(), size: { cols, rows }, grid });
  assert.deepEqual(spec.grid, grid);
  assert.deepEqual(changes, []);
  const mismatch = clampSpec({ ...defaultSpec(), size: { cols: 10, rows: 8 }, grid });
  assert.deepEqual(mismatch.spec.size, { cols, rows });
  assert.equal(mismatch.changes.length, 1);
});

test('a grid that cannot be used is dropped, and one that can be repaired is repaired', () => {
  const d = defaultSpec();
  const row = { n: false, s: false, e: true, w: true };
  const drop = (grid: unknown): string[] => {
    const r = clampSpec({ ...d, grid });
    assert.equal(r.spec.grid, undefined);
    assert.deepEqual(r.spec.size, d.size);
    return r.changes;
  };
  assert.equal(drop('walls').length, 1);
  assert.equal(drop({ cols: 3, rows: 3, cells: [] }).length, 1);
  assert.equal(drop({ cols: 6, rows: 5, cells: [row] }).length, 1);
  assert.equal(drop({ cols: 6.5, rows: 5, cells: [] }).length, 1);
  // Walls the two cells disagree on close, nothing opens off the edge, and a start or exit outside the grid is replaced (the exit by the farthest cell).
  const cells = Array.from({ length: 30 }, () => ({ n: false, s: false, e: false, w: false }));
  for (let x = 0; x < 6; x++) cells[x] = { n: true, s: false, e: x < 5, w: x > 0 };
  cells[1]!.e = true;
  cells[2]!.w = false; // 1 says open, 2 says wall
  const fixed = clampSpec({ ...d, size: { cols: 6, rows: 5 }, grid: { cols: 6, rows: 5, cells, start: { x: 9, y: 9 }, exit: 'there' } });
  const g = fixed.spec.grid!;
  assert.equal(g.cells[1]!.e, false);
  assert.equal(g.cells[0]!.n, false);
  assert.deepEqual(g.start, { x: 0, y: 0 });
  assert.notDeepEqual(g.exit, g.start);
  assert.ok(fixed.changes.length >= 3);
  // The result is legal: reading it again changes nothing.
  assert.deepEqual(inspectSpec(fixed.spec).problems, []);
});

test('a start or exit in a solid block moves onto the floor, and a grid with no floor is dropped', () => {
  const d = defaultSpec();
  const solid = () => ({ n: false, s: false, e: false, w: false });
  const cells = Array.from({ length: 30 }, solid);
  for (let x = 1; x < 4; x++) cells[6 + x] = { n: false, s: false, e: x < 3, w: true };
  cells[6 + 1] = { n: false, s: false, e: true, w: false };
  cells[6 + 2] = { n: false, s: false, e: true, w: true };
  cells[6 + 3] = { n: false, s: false, e: false, w: true };
  const grid = { cols: 6, rows: 5, cells, start: { x: 0, y: 0 }, exit: { x: 5, y: 4 } };
  const fixed = clampSpec({ ...d, size: { cols: 6, rows: 5 }, grid });
  assert.deepEqual(fixed.spec.grid!.start, { x: 1, y: 1 });
  assert.deepEqual(fixed.spec.grid!.exit, { x: 3, y: 1 });
  assert.equal(fixed.changes.length, 2);
  assert.deepEqual(inspectSpec(fixed.spec).problems, []);
  // A start walled in alone: the exit is another open cell, for the verifier to call unreachable, never the start itself.
  const lone = Array.from({ length: 30 }, solid);
  lone[0] = { n: false, s: false, e: true, w: false };
  lone[1] = { n: false, s: false, e: false, w: true };
  lone[20] = { n: false, s: false, e: true, w: false };
  lone[21] = { n: false, s: false, e: false, w: true };
  const walled = clampSpec({ ...d, grid: { cols: 6, rows: 5, cells: lone, start: { x: 0, y: 0 }, exit: { x: 0, y: 0 } } });
  assert.notDeepEqual(walled.spec.grid!.exit, walled.spec.grid!.start);
  // Fewer than two cells with an opening is no floor.
  const none = clampSpec({ ...d, grid: { cols: 6, rows: 5, cells: Array.from({ length: 30 }, solid), start: { x: 0, y: 0 }, exit: { x: 1, y: 0 } } });
  assert.equal(none.spec.grid, undefined);
  assert.equal(none.changes.length, 1);
});

test('the grid is read from a reply but is not part of the schema a model is held to', () => {
  const props = LEVEL_SPEC_SCHEMA.properties as Record<string, unknown>;
  assert.equal('grid' in props, false);
  assert.equal((LEVEL_SPEC_SCHEMA.required as string[]).includes('grid'), false);
  // (A photo gives the walls, through scan.ts; a model that sends them anyway is read, not refused.)
  const row = (x: number) => ({ n: false, s: false, e: x < 5, w: x > 0 });
  const cells = Array.from({ length: 30 }, (_, i) => (i < 6 ? row(i) : { n: false, s: false, e: false, w: false }));
  const parsed = parseSpec(JSON.stringify({ ...defaultSpec(), grid: { cols: 6, rows: 5, cells, start: { x: 0, y: 0 }, exit: { x: 5, y: 0 } } }));
  assert.ok(parsed.ok && parsed.spec.grid);
});

// ---------------------------------------------------------------------------------------------------------------------

test('a spec laid over a job\'s settings sets size, floors, roster, hazards and loot, and leaves the rest of the job alone', () => {
  const base = difficultyFor(14);
  const spec: LevelSpec = {
    ...defaultSpec(),
    size: { cols: 8, rows: 6 },
    floors: 1,
    roster: { guards: 1, watchdogs: 2, crawlers: 0, alphas: 1, drones: 0, heavies: 1 },
    hazards: { doors: 1, lasers: 0, lines: 1, gates: 0, sweepers: 2, sliders: 1, shutters: 0, blackouts: 1 },
    loot: { documents: 3 },
  };
  const d = specToDifficulty(spec, base);
  assert.deepEqual([d.cols, d.rows, d.floors], [8, 6, 1]);
  assert.deepEqual([d.guards, d.watchdogs, d.crawlers, d.alphas, d.drones, d.heavies], [1, 2, 0, 1, 0, 1]);
  assert.deepEqual([d.doors, d.lasers, d.lines, d.gates, d.sweepers, d.sliders, d.shutters, d.blackouts, d.documents], [1, 0, 1, 0, 2, 1, 0, 1, 3]);
  // The things a spec has no word for stay the job's.
  for (const k of ['lineSize', 'blackoutCells', 'breakers', 'logWindowS', 'empAtStart', 'trapsAtStart', 'guardReactionS', 'sentrySweep', 'decorRooms', 'crates', 'staffLockers', 'vents', 'pipes', 'newThisJob'] as const) {
    assert.equal(d[k], base[k], k);
  }
  // Doors chain only when there are two of them; the curtains running fast never outnumber the curtains.
  assert.equal(base.chainedDoors, true);
  assert.equal(d.chainedDoors, false);
  assert.equal(specToDifficulty({ ...spec, hazards: { ...spec.hazards, doors: 2 } }, base).chainedDoors, true);
  assert.equal(base.fastSliders, 1);
  assert.equal(specToDifficulty({ ...spec, hazards: { ...spec.hazards, sliders: 0 } }, base).fastSliders, 0);
  // The base itself is not touched.
  assert.deepEqual(base, difficultyFor(14));
});

test('a spec at the hardest job\'s own numbers reproduces that job', () => {
  const job = difficultyFor(20);
  const spec: LevelSpec = {
    ...defaultSpec(),
    size: { cols: job.cols, rows: job.rows },
    floors: job.floors,
    roster: { guards: job.guards, watchdogs: job.watchdogs, crawlers: job.crawlers, alphas: job.alphas, drones: job.drones, heavies: job.heavies },
    hazards: { doors: job.doors, lasers: job.lasers, lines: job.lines, gates: job.gates, sweepers: job.sweepers, sliders: job.sliders, shutters: job.shutters, blackouts: job.blackouts },
    loot: { documents: job.documents },
  };
  assert.deepEqual(clampSpec(spec).changes, []);
  assert.deepEqual(specToDifficulty(spec, job), job);
});

test('each build phase draws from its own seed, the same for the same spec seed', () => {
  const phases = Object.values(BUILD_PHASE);
  for (const seed of [0, 1, 99, 0xffffffff]) {
    const seeds = phases.map((p) => phaseSeed(seed, p));
    assert.equal(new Set(seeds).size, phases.length, `seed ${seed}`);
    assert.ok(seeds.every((s) => Number.isInteger(s) && s > 0 && s <= 0xffffffff));
    assert.deepEqual(seeds, phases.map((p) => phaseSeed(seed, p)));
  }
  assert.notEqual(phaseSeed(1, BUILD_PHASE.stair), phaseSeed(2, BUILD_PHASE.stair));
});

test('a sketch of open rooms with no dead ends gets closets for its rooms, and one that has enough is left alone', () => {
  // Two open rooms (4 x 4 and 4 x 4) joined by a door gap, with solid blocks round them: no cell has a single opening.
  const cols = 10;
  const rows = 6;
  const cells = Array.from({ length: cols * rows }, () => ({ n: false, s: false, e: false, w: false }));
  const link = (ax: number, ay: number, bx: number, by: number): void => {
    const a = cells[ay * cols + ax]!;
    const b = cells[by * cols + bx]!;
    if (bx === ax + 1) { a.e = true; b.w = true; } else if (by === ay + 1) { a.s = true; b.n = true; }
  };
  for (const [x0, x1] of [[0, 3], [5, 8]] as const) for (let y = 1; y <= 4; y++) for (let x = x0; x <= x1; x++) { if (x < x1) link(x, y, x + 1, y); if (y < 4) link(x, y, x, y + 1); }
  cells[2 * cols + 4] = { n: false, s: false, e: true, w: true };
  cells[2 * cols + 3]!.e = true;
  cells[2 * cols + 5]!.w = true;
  const grid = { cols, rows, cells, start: { x: 0, y: 2 }, exit: { x: 8, y: 4 } };
  const spec = { ...defaultSpec(), floors: 1 as const, contract: 'records' as const, loot: { documents: 2 }, grid };
  const out = carveAlcoves(spec);
  assert.ok(out.carved.length >= 2 && out.carved.length <= MAX_ALCOVES, `carved ${out.carved.length}`);
  for (const c of out.carved) {
    const cell = out.grid!.cells[c.y * cols + c.x]!;
    assert.equal([cell.n, cell.s, cell.e, cell.w].filter(Boolean).length, 1, `closet ${c.x},${c.y} has one opening`);
  }
  // Both cells agree on every new opening, the start and exit are untouched, and the result is already enough: a second pass changes nothing.
  assert.deepEqual(out.grid!.start, grid.start);
  assert.deepEqual(out.grid!.exit, grid.exit);
  assert.deepEqual(inspectSpec({ ...spec, grid: out.grid }).problems.filter((p) => p.field.startsWith('grid')), []);
  assert.deepEqual(carveAlcoves({ ...spec, grid: out.grid! }).carved, []);
  // A second floor also needs a way up: a straight two-cell pocket, its far end a dead end to the east or south (maze.ts's placeStair).
  const up = carveAlcoves({ ...spec, floors: 2 });
  const spur = up.carved.slice(-2);
  assert.equal(up.carved.length, out.carved.length + 2);
  const [a0, b0] = spur.map((c) => up.grid!.cells[c.y * cols + c.x]!) as [GridCell, GridCell];
  assert.ok((a0.n && a0.s && !a0.e && !a0.w) || (a0.e && a0.w && !a0.n && !a0.s), 'the stair cell is straight');
  assert.equal([b0.n, b0.s, b0.e, b0.w].filter(Boolean).length, 1, 'with a dead end past it');
  assert.ok(spur[1]!.x > spur[0]!.x || spur[1]!.y > spur[0]!.y, 'to the east or south');
  assert.deepEqual(carveAlcoves({ ...spec, floors: 2, grid: up.grid! }).carved, []);
  // The input is not touched.
  assert.ok(cells.every((c, i) => c === grid.cells[i]) && !cells[0]!.n);
  // A contract with no records needs two (the uplink and the log server), and a sketch with no grid is nothing to do.
  assert.ok(carveAlcoves({ ...spec, contract: 'sabotage' }).carved.length <= out.carved.length);
  assert.deepEqual(carveAlcoves({ ...defaultSpec() }), { grid: null, carved: [] });
  // A grid with nowhere to carve (no solid cell) is returned as it is.
  const dense = { cols: 6, rows: 5, cells: Array.from({ length: 30 }, (_, i) => ({ n: i >= 6, s: i < 24, e: i % 6 < 5, w: i % 6 > 0 })), start: { x: 0, y: 0 }, exit: { x: 5, y: 4 } };
  assert.deepEqual(carveAlcoves({ ...defaultSpec(), grid: dense }).carved, []);
});
