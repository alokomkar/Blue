// The game's own floor generators, wired to the shapes src/shared/floorbuild.ts asks for. src/shared cannot import
// src/client (its tsconfig's rootDir), so the server does the wiring: the client modules below are pure (type-only
// imports, no three.js) and load under Node with their .ts extensions.
import type { FloorGenerators } from '../../src/shared/floorbuild.ts';
import { bfs, farthestCell, generateMaze, placeBotSpawn, placeHidingSpots, placeLaserTraps, placeStair, stairReserved } from '../../src/client/game/maze.ts';
import { generateLayout, landmarkOf, stairSpurOf } from '../../src/client/game/layouts.ts';
import { generateBuilding } from '../../src/client/game/building.ts';
import { LOCATIONS } from '../../src/client/game/locations.ts';
import { planSecurity } from '../../src/client/game/security.ts';
import { placeSweepers, placeSliders } from '../../src/client/game/movingLasers.ts';
import { placeLines } from '../../src/client/game/linelasers.ts';
import { placeGates } from '../../src/client/game/evade.ts';
import { placeShutters } from '../../src/client/game/shutters.ts';
import { planObjectives } from '../../src/client/game/objectives.ts';
import { restoreRandom, seedRandom } from '../../src/client/game/seeded.ts';

export const generators: FloorGenerators = {
  seedRandom,
  restoreRandom,
  plan: (place, layout, _floor, cols, rows) => {
    const cells = layout === 'maze' ? generateMaze(cols, rows) : generateLayout(layout, cols, rows, LOCATIONS[place].landmark, generateBuilding);
    return { cells, landmark: landmarkOf(cells), spur: stairSpurOf(cells) };
  },
  bfs,
  farthestCell,
  placeStair,
  stairReserved,
  planSecurity,
  placeBotSpawn,
  placeHidingSpots,
  placeLaserTraps,
  placeSweepers,
  placeSliders,
  placeLines,
  placeGates,
  placeShutters,
  planObjectives,
};
