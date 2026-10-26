// Levels the Director can hand back when the model is down, slow or cannot make a level that passes the verifier. One
// per place, each checked by a test (V1 to V3 must pass), so the fallback is always playable. `pickFallback` chooses by
// the words of the request.
import { defaultSpec, type LevelSpec, type PlaceId } from '../../src/shared/levelspec.ts';

const base = defaultSpec();

function make(place: PlaceId, over: Partial<LevelSpec>): LevelSpec {
  return {
    ...base,
    place,
    size: { cols: 12, rows: 8 },
    floors: 2,
    seed: 1,
    roster: { ...base.roster, guards: 3, watchdogs: 1 },
    ...over,
  };
}

export const FALLBACKS: Record<PlaceId, LevelSpec> = {
  campus: make('campus', { title: 'Night at the campus', brief: 'Records are kept in the admin wing: take them and leave before the morning staff.', layout: 'halls', contract: 'records' }),
  museum: make('museum', { title: 'After hours at the museum', brief: 'One piece is worth more than the rest of the collection: it is in the vault.', layout: 'aisles', contract: 'vault' }),
  refinery: make('refinery', { title: 'The refinery shutdown', brief: 'Take the plant offline from the control room without raising the alarm.', layout: 'fishbone', contract: 'sabotage' }),
  bank: make('bank', { title: 'The branch vault', brief: 'The vault holds what the branch is hiding: get in and out clean.', layout: 'plus', contract: 'vault' }),
  warehouse: make('warehouse', { title: 'Dock six', brief: 'A shipment is leaving at dawn: find it before it does.', layout: 'uturn', contract: 'shipment' }),
  lab: make('lab', { title: 'The sample room', brief: 'Extract the sample from the cold store and leave nothing behind.', layout: 'halls', contract: 'extract' }),
};

/** Words that point at a place (the first match in this order wins). */
const WORDS: ReadonlyArray<[PlaceId, RegExp]> = [
  ['museum', /museum|gallery|painting|exhibit|art\b/i],
  ['bank', /bank|vault|safe\b|cash|teller/i],
  ['refinery', /refiner|plant|oil|pipeline|tank|factory/i],
  ['warehouse', /warehouse|dock|shipment|cargo|port\b|container/i],
  ['lab', /lab\b|laborator|sample|research|clinic/i],
  ['campus', /campus|school|university|college|office|records/i],
];

export function pickFallback(prompt: string, seed?: number): LevelSpec {
  const place = WORDS.find(([, re]) => re.test(prompt))?.[0] ?? 'campus';
  const spec = FALLBACKS[place];
  return seed === undefined ? spec : { ...spec, seed };
}
