import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newRun, ADDRESSES, TARGETS } from './arc.ts';
import { DOOR_COLS, DOOR_ROWS, doorMaze, toHeistScene, toTowerScene, towerTasks, typedText, visibleLines } from './interlude.ts';

test('the scene out of the first level names the dossier\'s building and street, in order, and ends after its last caption', () => {
  for (const place of TARGETS) {
    const scene = toTowerScene({ ...newRun(5), place, found: true }, 'lift', ADDRESSES[place]);
    const text = scene.lines.map((l) => l.text).join(' | ');
    assert.ok(text.includes(ADDRESSES[place].name) && text.includes(ADDRESSES[place].street), place);
    assert.ok(scene.lines.every((l, i) => i === 0 || l.at > scene.lines[i - 1]!.at), 'captions come in order');
    assert.ok(scene.duration > scene.lines[scene.lines.length - 1]!.at + 1.5, 'the last caption has time to be read');
  }
});

test('the truck scene is not the lift scene', () => {
  const run = { ...newRun(5), found: true };
  assert.match(toTowerScene(run, 'lift', ADDRESSES[run.place]).lines[0]!.text, /LIFT/);
  assert.match(toTowerScene(run, 'truck', ADDRESSES[run.place]).lines[0]!.text, /TRUCK/);
});

test('the tower\'s tasks name its floors and the cards on them, the heist door and the optional extras', () => {
  const tasks = towerTasks(['The hall', 'The balcony', 'The gallery', 'The offices'], [0, 1, 2, 3]);
  assert.equal(tasks.length, 3);
  assert.match(tasks[0]!, /the four floors: The hall, The balcony, The gallery, The offices/);
  assert.match(tasks[1]!, /top floor, The offices.*heist door/);
  assert.match(tasks[2]!, /optional/);
});

test('captions type out over time and stay on screen two at a time', () => {
  assert.equal(typedText('ABCDEFGH', 0), '');
  assert.equal(typedText('ABCDEFGH', 0.1, 20), 'AB');
  assert.equal(typedText('ABCDEFGH', 99), 'ABCDEFGH');
  const scene = toTowerScene({ ...newRun(5), found: true }, 'lift', ADDRESSES.bank);
  assert.equal(visibleLines(scene, 0).length, 0);
  assert.equal(visibleLines(scene, 3).length, 2);
  assert.equal(visibleLines(scene, 99).length, 2);
  assert.equal(visibleLines(scene, 99)[1]!.line, scene.lines[scene.lines.length - 1]);
});

test('the heist door scene has captions in order and time to read them', () => {
  for (const place of [...TARGETS, 'lab', 'nowhere']) {
    const scene = toHeistScene(place);
    assert.equal(scene.ride, 'door');
    assert.ok(scene.lines.length >= 1);
    assert.ok(scene.duration > scene.lines[scene.lines.length - 1]!.at + 1.5);
  }
});

test('the maze at the door is the same for a place, differs between places, and walls in the whole grid', () => {
  const a = doorMaze('bank');
  assert.deepEqual(a, doorMaze('bank'));
  assert.notDeepEqual(a, doorMaze('campus'));
  // the outer edge is all wall: 2 * (cols + rows) unit lengths
  const edge = a.filter((w) => w.x1 === 0 || w.y1 === 0 || w.x2 === DOOR_COLS || w.y2 === DOOR_ROWS);
  assert.ok(edge.length >= 2 * (DOOR_COLS + DOOR_ROWS));
  // a spanning tree joins every cell: cells * 2 + cols + rows total unit walls, minus the (cells - 1) joins
  assert.equal(a.length, 2 * DOOR_COLS * DOOR_ROWS + DOOR_COLS + DOOR_ROWS - (DOOR_COLS * DOOR_ROWS - 1));
  assert.ok(a.every((w) => w.d >= 0 && w.d <= 1));
});

test('every operation has a call-in, an upload and a descent; the street follows all but the last', async () => {
  const { callInScene, uploadScene, descentScene, streetScene } = await import('./interlude.ts');
  for (let n = 1; n <= 6; n++) {
    for (const s of [callInScene({ n }), uploadScene({ n }), descentScene({ n })]) {
      assert.ok(s.lines.length >= 1 && s.duration > s.lines[s.lines.length - 1]!.at, `${n}: ${s.ride}`);
    }
    const street = streetScene({ n });
    if (n === 6) assert.equal(street, null);
    else assert.ok(street && street.ride === 'street');
  }
});
