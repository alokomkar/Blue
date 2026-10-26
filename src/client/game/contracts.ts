// Which contract a job is. Every place has its own kind of job (locations.ts), so as the places take turns the jobs do too: the campus keeps taking
// records; the museum is a swap (a keycard off a guard, an exhibit exchanged for a forgery); the refinery is sabotage (three charges and a fuse); the
// bank is a vault (keycard, vault, ledger); the warehouse is a shipment (read the manifest, tag the right container); the lab is an extraction (a
// specimen carried out, warming as it goes). Steps and stations are objectives.ts's. A contract the game can't play yet is a records job, so the
// ladder always works. Pure, so it's unit-tested under Node.

import type { ContractId } from '../../shared/contracts';
import type { LocationId } from './locations';

/** The contracts the game can play so far. */
export const PLAYABLE: ReadonlySet<ContractId> = new Set<ContractId>(['records', 'sabotage', 'vault', 'swap', 'shipment', 'extract']);

/** The contract job `level`, in `place`, is meant to be, playable or not. */
export function wantedContract(_level: number, place: LocationId): ContractId {
  switch (place) {
    case 'museum':
      return 'swap';
    case 'refinery':
      return 'sabotage';
    case 'bank':
      return 'vault';
    case 'warehouse':
      return 'shipment';
    case 'lab':
      return 'extract';
    default:
      return 'records';
  }
}

/** The contract job `level`, in `place`, plays. */
export function contractFor(level: number, place: LocationId): ContractId {
  const wanted = wantedContract(level, place);
  return PLAYABLE.has(wanted) ? wanted : 'records';
}
