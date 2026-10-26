import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cornerBridges } from './roofbridge.ts';

test('containers that touch only at a corner get a bridge at it', () => {
  const diag = new Set(['2,2', '3,2', '4,3', '5,3']); // (3,2) and (4,3) meet at a corner
  const b = cornerBridges(diag, 4);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { x: 3.5 * 4, z: 2.5 * 4 });
  // side by side: no bridge
  assert.equal(cornerBridges(new Set(['2,2', '3,2', '4,2', '2,3', '3,3']), 4).length, 0);
  // the other diagonal
  assert.deepEqual(cornerBridges(new Set(['3,3', '4,2']), 4), [{ x: 3.5 * 4, z: 2.5 * 4 }]);
});
