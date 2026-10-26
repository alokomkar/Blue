// What opening a storage-room locker does. Reward math for the gamble is
// ported from blueprint/src/index.html's resolveLocker() (~:5053): a real
// locker is +15 score/-5 suspicion, a rigged one -10 score and lights a fuse
// on the locker — when it runs out the alarm adds +30 suspicion and guards
// spawn at the locker (game.ts). Document lockers carry the job's win
// condition and have no score/suspicion effect of their own.

export type LockerContent = 'document' | 'loot' | 'rigged';

export const RIGGED_CHANCE = 0.42;
export const RIG_FUSE_S = 5; // countdown on an opened rigged locker before the alarm
export const RIG_ALARM_SUSPICION = 30;
export const RIG_AMBUSH_BOTS = 2; // guards the alarm spawns at the locker
export const EMP_LOOT_CHANCE = 0.5; // share of loot lockers that also hold an EMP charge
const MAX_LOCKERS = 3;

export type Outcome = {
  scoreDelta: number;
  suspicionDelta: number;
  toast: { text: string; kind: 'good' | 'bad' | 'neutral' };
  /** A rigged locker — game.ts starts its fuse (RIG_FUSE_S), then raises the alarm. */
  ambush: boolean;
  /** The locker held one of the job's documents. */
  document: boolean;
  /** EMP charges found inside (loot lockers, sometimes). */
  emp: number;
};

export function lockerOutcome(content: LockerContent, rand: () => number = Math.random): Outcome {
  if (content === 'document') {
    return { scoreDelta: 0, suspicionDelta: 0, toast: { text: 'DOCUMENT RECOVERED', kind: 'good' }, ambush: false, document: true, emp: 0 };
  }
  if (content === 'rigged') {
    return { scoreDelta: -10, suspicionDelta: 0, toast: { text: `RIGGED · ALARM IN ${RIG_FUSE_S}s · GET CLEAR`, kind: 'bad' }, ambush: true, document: false, emp: 0 };
  }
  const emp = rand() < EMP_LOOT_CHANCE ? 1 : 0;
  const text = emp ? '+15 SCORE · +1 EMP CHARGE' : '+15 SCORE · SUSPICION -5%';
  return { scoreDelta: 15, suspicionDelta: -5, toast: { text, kind: 'good' }, ambush: false, document: false, emp };
}

/** Stocks one storage room: `docs` document lockers plus loot/rigged extras (2–3 lockers in all), in shuffled order. */
export function stockLockers(docs: number, rand: () => number = Math.random): LockerContent[] {
  const count = Math.min(MAX_LOCKERS, Math.max(docs, 2 + (rand() < 0.5 ? 1 : 0)));
  const out: LockerContent[] = [];
  for (let i = 0; i < count; i++) out.push(i < docs ? 'document' : rand() < RIGGED_CHANCE ? 'rigged' : 'loot');
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
