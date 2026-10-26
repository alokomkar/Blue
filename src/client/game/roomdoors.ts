// The doors in the mouths of the rooms: a sliding door that opens for anything coming to it, the agent or an enemy, and slides shut
// again once nothing is near. Shut, it blocks sight, so a room behind one is somewhere to hide from a guard walking past, or to work in
// out of sight (a terminal, a server, the files); but a guard that comes to the door opens it, and sees in. Pure, and tested under Node.

/** Anything this close to the doorway opens it. */
export const OPEN_R = 1.3;
/** It closes only once everything is at least this far from it, for CLOSE_AFTER_S: a small room's agent, standing back, is clear of it. */
export const CLEAR_R = 1.7;
export const CLOSE_AFTER_S = 0.9;

export type RoomDoorState = { open: boolean; /** How long nothing has been near it, while it's open. */ clearFor: number };

export const SHUT: RoomDoorState = { open: false, clearFor: 0 };

/** The door a frame later, given how far the nearest of the agent and the enemies is from the doorway (metres). */
export function stepRoomDoor(s: RoomDoorState, nearest: number, dt: number): RoomDoorState {
  if (nearest <= OPEN_R) return { open: true, clearFor: 0 };
  if (!s.open) return s;
  if (nearest > CLEAR_R) {
    const clearFor = s.clearFor + dt;
    return clearFor >= CLOSE_AFTER_S ? SHUT : { open: true, clearFor };
  }
  return { open: true, clearFor: 0 };
}
