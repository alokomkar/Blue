import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESSES, BUNKER_PLACE, DOSSIER_LEVELS, STAGES, TARGETS, addressOf, advance, clueLevels, decodeRun, dossierPlan, encodeRun, newRun, nextStage, pickNextPlace } from './arc.ts';

test('the stages run bunker, tower, maze, exit, done, and stop there', () => {
  assert.deepEqual(STAGES, ['bunker', 'tower', 'maze', 'exit', 'done']);
  assert.equal(nextStage('bunker'), 'tower');
  assert.equal(nextStage('tower'), 'maze');
  assert.equal(nextStage('maze'), 'exit');
  assert.equal(nextStage('exit'), 'done');
  assert.equal(nextStage('done'), 'done');
  assert.equal(advance(newRun(4)).stage, 'tower');
});

test('the next place is never the bunker\'s own, is steady for a seed, and spreads over the other five', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 400; seed++) {
    const p = pickNextPlace(seed);
    assert.notEqual(p, BUNKER_PLACE);
    assert.ok(TARGETS.includes(p));
    assert.equal(p, pickNextPlace(seed));
    seen.add(p);
  }
  assert.equal(seen.size, 5, 'all five places come up');
  assert.equal(TARGETS.length, 5);
});

test('every place has a name and a street address', () => {
  assert.deepEqual(Object.keys(ADDRESSES).sort(), ['bank', 'campus', 'lab', 'museum', 'refinery', 'warehouse']);
  for (const a of Object.values(ADDRESSES)) {
    assert.ok(a.name.length > 3 && a.street.length > 6);
  }
  assert.equal(addressOf(newRun(2)).name, ADDRESSES[newRun(2).place].name);
});

test('the dossier is on a storey from 1 to 3 that has containers, in one that exists, the same every time', () => {
  const per = [6, 9, 7, 8];
  const levels = new Set<number>();
  for (let seed = 0; seed < 300; seed++) {
    const plan = dossierPlan(seed, per)!;
    assert.ok(plan.level >= DOSSIER_LEVELS.min && plan.level <= DOSSIER_LEVELS.max, `level ${plan.level}`);
    assert.ok(plan.container >= 0 && plan.container < per[plan.level]!, `container ${plan.container} of ${per[plan.level]}`);
    assert.deepEqual(plan, dossierPlan(seed, per));
    levels.add(plan.level);
  }
  assert.equal(levels.size, 3, 'all three storeys come up');
  // a storey with none is never chosen; with none anywhere there is no plan
  for (let seed = 0; seed < 100; seed++) assert.notEqual(dossierPlan(seed, [5, 0, 4, 0])!.level, 1);
  assert.equal(dossierPlan(1, [5, 0, 0, 0]), null);
  assert.equal(dossierPlan(1, []), null);
});

test('the clue systems are on every storey from the bottom up to the dossier\'s', () => {
  assert.deepEqual(clueLevels(1), [0, 1]);
  assert.deepEqual(clueLevels(3), [0, 1, 2, 3]);
});

test('a run is saved and read back, and anything else reads as nothing', () => {
  for (const run of [newRun(7), { ...advance(advance(newRun(123456))), found: true }, { seed: -4, site: 'yard' as const, stage: 'done' as const, place: 'bank' as const, found: false }]) {
    assert.deepEqual(decodeRun(encodeRun(run)), run);
  }
  for (const bad of [null, undefined, '', 'nonsense', 'run1|x|bunker|bank|0', 'run1|3|moon|bank|0', 'run1|3|bunker|mars|0', 'run1|3|bunker|bank|2', 'run2|3|bunker|bank|0', 'run2|3|bunker|bank|0|moon', 'run1|3|bunker|bank', 'run1|3.5|bunker|bank|0']) {
    assert.equal(decodeRun(bad), null, String(bad));
  }
});

test('the dossier page names the place and its street address, whichever place the run is for', async () => {
  const { dossierPage } = await import('./arc.ts');
  for (const place of TARGETS) {
    const page = dossierPage({ seed: 1, site: 'bunker', stage: 'bunker', place, found: true });
    assert.ok(page.body.includes(ADDRESSES[place].name) && page.body.includes(ADDRESSES[place].street), place);
    assert.ok(page.title.length > 0 && page.kicker.length > 0 && page.note.length > 0);
  }
});

test('the URL decides first; with no flags the run decides; with neither the job number does', async () => {
  const { runOptions, advance: adv } = await import('./arc.ts');
  const q = (s: string) => new URLSearchParams(s);
  const run = newRun(5); // bunker stage
  const atTower = adv(run);
  const atMaze = adv(atTower);
  const atExit = adv(atMaze);
  // no run, no flags: as before
  assert.deepEqual(runOptions(q(''), null), { towerPlace: null, exit: false, bunkerPlace: 'lab', mazePlace: null, core: false });
  // the three dev URLs behave as before whatever the run says
  assert.deepEqual(runOptions(q('place=bank'), atExit), { towerPlace: 'bank', exit: true, bunkerPlace: 'bank', mazePlace: null, core: false });
  assert.equal(runOptions(q('exit=1'), null).exit, true);
  assert.equal(runOptions(q('exit=0'), atExit).exit, false);
  assert.equal(runOptions(q('place=lab'), atTower).bunkerPlace, 'lab');
  assert.equal(runOptions(q('place=nowhere'), null).towerPlace, null);
  // the run decides by stage
  assert.equal(runOptions(q(''), run).towerPlace, null);
  assert.equal(runOptions(q(''), atTower).towerPlace, atTower.place);
  assert.equal(runOptions(q(''), atTower).exit, false);
  assert.equal(runOptions(q(''), atMaze).mazePlace, atMaze.place);
  assert.equal(runOptions(q(''), atMaze).towerPlace, null);
  assert.deepEqual([runOptions(q(''), atExit).exit, runOptions(q(''), atExit).towerPlace], [true, atExit.place]);
  // the bunker is always the lab's unless asked
  assert.equal(runOptions(q(''), atExit).bunkerPlace, 'lab');
});

test('a place asked of the bunker dresses the bunker and is not the tower the run goes on to', async () => {
  const { runOptions, advance: adv } = await import('./arc.ts');
  const atTower = adv(newRun(5));
  const o = runOptions(new URLSearchParams('job=bunker&place=bank'), atTower);
  assert.equal(o.bunkerPlace, 'bank');
  assert.equal(o.towerPlace, atTower.place);
  assert.equal(runOptions(new URLSearchParams('job=bunker&place=bank'), newRun(5)).towerPlace, null);
});

test('the finale lists the levels that were played, in order, with a total', async () => {
  const { finaleRows, loadStats, noteStat, clearStats } = await import('./arc.ts');
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  noteStat(store, 'maze', { seconds: 100, hits: 2 });
  noteStat(store, 'bunker', { seconds: 60, hits: 0 });
  noteStat(store, 'maze', { seconds: 90, hits: 1 }); // a later try replaces the earlier
  const rows = finaleRows(loadStats(store), (s) => `${s}s`);
  assert.deepEqual(rows, [['The Sump', '60s · untouched'], ['The heist', '90s · 1 hit'], ['Total', '150s']]);
  clearStats(store);
  assert.deepEqual(loadStats(store), {});
  data.set('mazeHeist.runStats', '{{{');
  assert.deepEqual(loadStats(store), {});
});

test('six places make six different dossier pages, and each clue system says its own thing', async () => {
  const { dossierPage, clueScreen } = await import('./arc.ts');
  const places = Object.keys(ADDRESSES) as (keyof typeof ADDRESSES)[];
  const pages = places.map((place) => dossierPage({ seed: 1, site: 'bunker', stage: 'bunker', place, found: true }));
  assert.equal(new Set(pages.map((p) => p.title)).size, 6);
  assert.equal(new Set(pages.map((p) => p.body)).size, 6);
  assert.equal(new Set(pages.map((p) => p.note)).size, 6);
  for (const dl of [1, 2, 3]) {
    const screens = [0, 1, 2, 3].filter((l) => l <= dl).map((l) => clueScreen(l, dl).join('|'));
    assert.equal(new Set(screens).size, screens.length);
    assert.ok(clueScreen(dl, dl).join(' ').includes('LOT 12'));
    for (let l = 0; l < dl; l++) assert.ok(!clueScreen(l, dl).join(' ').includes('LOT 12'));
  }
});

test('other containers are the same for a run every time, and a run has at least three wrong guesses that say something', async () => {
  const { crateOutcome } = await import('./arc.ts');
  const ids = Array.from({ length: 30 }, (_, i) => `${i % 4}:${i}`);
  for (const seed of [1, 2, 3, 4242]) {
    const first = ids.map((id) => crateOutcome(seed, id));
    assert.deepEqual(ids.map((id) => crateOutcome(seed, id)), first);
    assert.ok(first.filter((o) => o.text.length > 0).length >= 3);
    const alarms = first.filter((o) => o.kind === 'alarm').length;
    assert.ok(alarms >= 1 && alarms <= 15, `alarms ${alarms}`);
  }
});

test('a run knows its site, the same seed always starts at the same one, both sites turn up, and an older saved run is the bunker\'s', async () => {
  const { pickSite, decodeRun, encodeRun } = await import('./arc.ts');
  const sites = Array.from({ length: 60 }, (_, i) => pickSite(i + 1));
  assert.ok(sites.includes('bunker') && sites.includes('yard'));
  assert.equal(pickSite(5), pickSite(5));
  assert.equal(newRun(5).site, pickSite(5));
  const yard = { ...newRun(9), site: 'yard' as const };
  assert.deepEqual(decodeRun(encodeRun(yard)), yard);
  assert.deepEqual(decodeRun('run1|7|tower|bank|1'), { seed: 7, site: 'bunker', stage: 'tower', place: 'bank', found: true });
});

test('the finale names the first level by the site the run started at', async () => {
  const { finaleRows } = await import('./arc.ts');
  const stats = { bunker: { seconds: 30, hits: 0 } };
  assert.equal(finaleRows(stats, (s) => `${s}s`)[0]![0], 'The Sump');
  assert.equal(finaleRows(stats, (s) => `${s}s`, 'yard')[0]![0], 'The dock yard');
});

test('only the dossier\'s container and a few decoys on the way to it offer to open, the same ones every time', async () => {
  const { openableCrates } = await import('./arc.ts');
  const byLevel = [0, 1, 2, 3].map((l) => Array.from({ length: [7, 8, 15, 3][l]! }, (_, i) => `${l}:${i}`));
  const open = openableCrates(4242, byLevel, [1, 1, 2, 0], '2:5');
  assert.ok(open.has('2:5'));
  assert.equal(open.size, 1 + 1 + 1 + 2);
  for (const id of open) assert.ok(id === '2:5' || !id.startsWith('3:'), 'nothing above the dossier\'s floor');
  assert.equal([...open].filter((id) => id.startsWith('2:')).length, 3, 'the dossier and two decoys on its own floor');
  assert.deepEqual([...openableCrates(4242, byLevel, [1, 1, 2, 0], '2:5')].sort(), [...open].sort());
  const other = openableCrates(7, byLevel, [1, 1, 2, 0], '2:5');
  assert.ok([...other].some((id) => !open.has(id)), 'another seed picks other decoys');
  // a floor with fewer containers than decoys asked for gives what there is
  assert.equal(openableCrates(1, [['0:0', '0:1']], [5], '0:0').size, 2);
});
