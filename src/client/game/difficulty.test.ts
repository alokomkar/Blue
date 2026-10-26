import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  difficultyFor,
  MAX_COLS,
  MAX_ROWS,
  type Difficulty,
} from './difficulty.ts';

const jobs = Array.from({ length: 40 }, (_, i) => difficultyFor(i + 1));

test('job 1 is the basics: guards, lasers, one door, nothing else', () => {
  const d = difficultyFor(1);
  assert.equal(d.cols, 10);
  assert.equal(d.rows, 8);
  assert.equal(d.floors, 1);
  assert.equal(d.guards, 2);
  assert.equal(d.doors, 1);
  assert.equal(d.documents, 2);
  assert.equal(d.empAtStart, 1);
  assert.deepEqual(
    [d.watchdogs, d.crawlers, d.drones, d.heavies],
    [0, 0, 0, 0]
  );
  assert.equal(d.chainedDoors, false);
});

test('each new enemy arrives in its own chapter, announced as the job starts', () => {
  const first = (pick: (d: Difficulty) => number): number =>
    jobs.findIndex((d) => pick(d) > 0) + 1;
  assert.equal(
    first((d) => d.watchdogs),
    3
  );
  assert.equal(
    first((d) => d.crawlers),
    5
  );
  assert.equal(
    first((d) => d.drones),
    7
  );
  assert.equal(
    first((d) => d.heavies),
    9
  );
  for (const job of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    assert.ok(
      difficultyFor(job).newThisJob,
      `job ${job} should say what's new`
    );
  assert.equal(difficultyFor(14).newThisJob, null);
  assert.deepEqual([difficultyFor(11).shutters, difficultyFor(12).shutters], [0, 1]);
  // Moving lasers: sweepers (duck under them) with job 6, curtains (step aside) with job 11.
  assert.deepEqual([difficultyFor(5).sweepers, difficultyFor(6).sweepers, difficultyFor(10).sliders, difficultyFor(11).sliders], [0, 1, 0, 1]);
  // Fast curtains from job 13, one a floor, never more than the curtains there are.
  assert.deepEqual([difficultyFor(12).fastSliders, difficultyFor(13).fastSliders], [0, 1]);
  for (const d of jobs) assert.ok(d.fastSliders <= d.sliders);
  assert.deepEqual([difficultyFor(9).breakers, difficultyFor(10).breakers], [0, 2]);
  assert.deepEqual([difficultyFor(3).blackouts, difficultyFor(4).blackouts], [0, 1]);
  assert.equal(difficultyFor(5).chainedDoors, true);
  // The dogs come with two EMPs in hand, the only thing that stops one head-on; the supply thins only late.
  assert.deepEqual([difficultyFor(2).empAtStart, difficultyFor(3).empAtStart, difficultyFor(8).empAtStart, difficultyFor(9).empAtStart], [1, 2, 2, 1]);
  // Watchdogs come alone at first and as a pack from job 8.
  assert.deepEqual([difficultyFor(7).watchdogs, difficultyFor(8).watchdogs], [1, 2]);
});

test('the first two jobs are small, the maze stops growing at 14×10 by job 4, and every job after the first has two floors', () => {
  assert.deepEqual([MAX_COLS, MAX_ROWS], [14, 10]);
  assert.deepEqual([difficultyFor(2).cols, difficultyFor(2).rows], [10, 8]);
  assert.deepEqual([difficultyFor(4).cols, difficultyFor(4).rows], [14, 10]);
  for (const d of jobs) {
    assert.ok(d.cols <= MAX_COLS && d.rows <= MAX_ROWS);
  }
  assert.ok(jobs.slice(1).every((d) => d.floors === 2));
});

test('nothing thins out as jobs go on (bar the supplies meant to get scarce)', () => {
  const growing: Array<keyof Difficulty> = [
    'cols',
    'rows',
    'guards',
    'watchdogs',
    'crawlers',
    'alphas',
    'drones',
    'heavies',
    'doors',
    'lasers',
    'lines',
    'lineSize',
    'sweepers',
    'sliders',
    'fastSliders',
    'shutters',
    'documents',
    'decorRooms',
    'staffLockers',
    'vents',
    'blackouts',
    'blackoutCells',
    'breakers',
    'sentrySweep',
  ];
  for (let i = 1; i < jobs.length; i++) {
    for (const key of growing)
      assert.ok(
        (jobs[i]![key] as number) >= (jobs[i - 1]![key] as number),
        `${key} drops at job ${i + 1}`
      );
    assert.ok(
      jobs[i]!.guardReactionS <= jobs[i - 1]!.guardReactionS,
      `guards get slower at job ${i + 1}`
    );
  }
});

test('counts stay within what a floor can hold', () => {
  for (const d of jobs) {
    assert.ok(
      d.guards <= 4 &&
        d.watchdogs <= 2 &&
        d.crawlers <= 2 &&
        d.drones <= 1 &&
        d.heavies <= 1
    );
    assert.ok(
      d.doors <= 2 && d.lasers <= 3 && d.documents <= 4 && d.decorRooms <= 5
    );
    assert.ok(d.guardReactionS >= 1.4 && d.sentrySweep <= 0.9);
    assert.ok(d.trapsAtStart >= 1);
    assert.ok(d.blackouts <= 2 && d.blackoutCells <= 26);
  }
});

test('with the maze capped, later jobs get more crowded, not bigger', () => {
  for (const d of jobs) assert.ok((d.cols * d.rows) / d.guards <= 62, `${d.cols}x${d.rows} with ${d.guards} guards`);
  assert.equal(difficultyFor(1).guards, 2, 'job 1 stays gentle');
  const roster = (d: Difficulty): number => d.guards + d.watchdogs + d.drones + d.crawlers + d.heavies;
  assert.ok(roster(difficultyFor(12)) > roster(difficultyFor(3)));
  assert.ok(roster(difficultyFor(40)) <= 10, 'a late floor stays about a dozen enemies, sentries included');
  assert.ok(difficultyFor(12).blackoutCells <= 12, 'a blackout sized to the maze');
});

test('the log window is five minutes on the first job, tightening by fifteen seconds a job to three minutes and no further', () => {
  assert.equal(difficultyFor(1).logWindowS, 300);
  assert.equal(difficultyFor(2).logWindowS, 285);
  assert.equal(difficultyFor(9).logWindowS, 180);
  assert.equal(difficultyFor(30).logWindowS, 180);
  for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i]!.logWindowS <= jobs[i - 1]!.logWindowS && jobs[i]!.logWindowS >= 180);
});
