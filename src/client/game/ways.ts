// How a job starts and ends, place by place. Every building used to start in a freight lift and end in another; now the way in at the front of a
// building is whatever that kind of place has (a lift on the campus, grand doors at the museum, a mesh gate at the refinery, a service door at the
// bank, a roll-up dock door at the warehouse, an airlock at the lab), and the way out is too (the lift, an airlock, a truck backed into a bay, a vault
// door, the museum's doors, a maintenance hatch up a ladder). Data and words only, no scene (elevator.ts and portals.ts build them). Node-testable.

import type { LocationId } from './locations';

/** The ways in at the front: a lift standing in the start cell, or a doorway in the building's outer wall that the agent steps in through. */
export type EntryKind = 'lift' | 'doors' | 'gate' | 'service' | 'rollup' | 'airlock';

/** The ways out, in the farthest dead end. */
export type ExitKind = 'lift' | 'airlock' | 'truck' | 'vault' | 'doors' | 'hatch';

export type Way = {
  entry: EntryKind;
  exit: ExitKind;
};

export const WAYS: Record<LocationId, Way> = {
  campus: { entry: 'lift', exit: 'lift' },
  museum: { entry: 'doors', exit: 'doors' },
  refinery: { entry: 'gate', exit: 'hatch' },
  bank: { entry: 'service', exit: 'vault' },
  warehouse: { entry: 'rollup', exit: 'truck' },
  lab: { entry: 'airlock', exit: 'airlock' },
};

/** What the entrance is called on the readout over it and in the brief. */
export const ENTRY_TITLE: Record<EntryKind, { title: string; blurb: string; sign: string }> = {
  lift: { title: 'Loading dock', blurb: 'The freight lift, on the ground floor with the uplink. The usual way in, and the guards know it.', sign: '▼' },
  doors: { title: 'Service doors', blurb: 'The staff doors at the back of the galleries, on the ground floor with the alarm link. The usual way in, and the guards know it.', sign: 'STAFF' },
  gate: { title: 'The yard gate', blurb: 'A mesh gate in the yard fence, on the ground floor with the alarm link. The usual way in, and the guards know it.', sign: 'GATE 1' },
  service: { title: 'Service door', blurb: 'The alley door at the back of the bank, on the ground floor with the alarm link. The usual way in, and the guards know it.', sign: 'STAFF ONLY' },
  rollup: { title: 'Loading bay', blurb: 'A roll-up door at a loading bay, on the ground floor with the alarm link. The usual way in, and the guards know it.', sign: 'BAY 2' },
  airlock: { title: 'The airlock', blurb: 'The staff airlock into the lab, on the ground floor with the alarm link. The usual way in, and the guards know it.', sign: 'AIRLOCK' },
};

/** What the exit is called in the toasts: "EXIT LIFT LOCKED", "THE AIRLOCK IS OPEN". */
export const EXIT_NAME: Record<ExitKind, { name: string; open: string; locked: string }> = {
  lift: { name: 'EXIT LIFT', open: 'THE EXIT LIFT IS OPEN', locked: 'EXIT LIFT LOCKED' },
  airlock: { name: 'AIRLOCK', open: 'THE AIRLOCK IS CLEAR · GO', locked: 'AIRLOCK SEALED' },
  truck: { name: 'TRUCK', open: 'THE TRUCK IS OPEN · CLIMB IN', locked: 'TRUCK SHUT' },
  vault: { name: 'VAULT DOOR', open: 'THE VAULT DOOR IS OPEN', locked: 'VAULT DOOR SEALED' },
  doors: { name: 'EXIT DOORS', open: 'THE EXIT DOORS ARE OPEN', locked: 'EXIT DOORS LOCKED' },
  hatch: { name: 'HATCH', open: 'THE HATCH IS OPEN · UP THE LADDER', locked: 'HATCH BARRED' },
};

/** The sound the exit makes as it takes you away: a lift rides, anything else is a door and a few footsteps. */
export const EXIT_SOUND: Record<ExitKind, 'liftRide' | 'doorOpen' | 'drag'> = {
  lift: 'liftRide',
  airlock: 'liftRide',
  truck: 'doorOpen',
  vault: 'liftRide',
  doors: 'doorOpen',
  hatch: 'drag',
};
