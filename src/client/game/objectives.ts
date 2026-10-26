// What a contract asks for, step by step. Records is the original loop (photograph the files); every other contract is a short run of steps at
// stations the level puts in its big room and along its walls: lift a specimen from its cryo pod and carry it out; plant three charges and
// run for the lift before the fuse; take a keycard off a guard, then swap the exhibit or open the vault; read the manifest, then tag the right
// container. Each step is a hold-to-work task like the uplink and the workstations, locked until the uplink is down, with its own words.
// Here: the plan for each contract, what a step needs before it can be done, and the fuse. Pure, so it's unit-tested under Node.

import type { ContractId } from '../../shared/contracts';

export type StepKind = 'cryo' | 'charge' | 'keycard' | 'swapCase' | 'vaultConsole' | 'ledger' | 'manifest' | 'tracker';

export type Step = {
  id: string;
  kind: StepKind;
  /** The bar's words while the agent works it. */
  working: string;
  /** Seconds of standing at it. */
  seconds: number;
  /** Steps that have to be done first. */
  requires: string[];
  /** Said when the player tries it too early (the first of `requires` that's not done decides which). */
  locked: Record<string, string>;
  /** Said when it's done. */
  done: string;
  /** Whether it counts toward the units the exit wants. A decoy never does. */
  unit: boolean;
  /** Where it goes: a spot on the big room's back wall, or a console against a wall in the corridors. */
  where: 'landmark' | 'wall';
  /** Which floor (0 the ground floor); one-floor jobs put everything on floor 0. */
  floor: 0 | 1;
  /** What the PDA and the guide call it. */
  name: string;
  /** A container that is not the shipment: working it sounds an alarm. */
  decoy?: boolean;
  /** Which container it is, for the shipment's A to D. */
  letter?: string;
};

export type ObjectivePlan = {
  contract: ContractId;
  steps: Step[];
  /** How many units the exit wants. */
  units: number;
  /** A patrol guard carries the keycard: take it down to take the card. */
  carrier: boolean;
  /** Seconds from the last charge to the blast (0: no fuse). */
  fuseS: number;
  /** The word for a unit on the HUD and the PDA. */
  unitName: string;
  /** What the PDA's first line says to do (shown until the uplink is down). */
  brief: string;
};

const none = (): Record<string, string> => ({});

/** The shipment's four containers, A to D; one is real. */
const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** The plan for `contract` on a job with `floors` floors. `pick` chooses which container is the shipment (0-3). */
export function planObjectives(contract: ContractId, floors: 1 | 2, pick = 0): ObjectivePlan {
  const upper = (floors === 2 ? 1 : 0) as 0 | 1;
  switch (contract) {
    case 'extract':
      return {
        contract,
        steps: [
          {
            id: 'cryo',
            kind: 'cryo',
            working: 'Unsealing the cryo pod',
            seconds: 5,
            requires: [],
            locked: none(),
            done: 'SPECIMEN SECURED · IT’S WARMING: WALK IT OUT. NO RUNNING, NO GRAPPLE, NO DRAGGING BODIES. WARMING UP, IT SPOILS IF YOU DAWDLE',
            unit: true,
            where: 'landmark',
            floor: 0,
            name: 'Cryo pod',
          },
        ],
        units: 1,
        carrier: false,
        fuseS: 0,
        unitName: 'SPECIMEN',
        brief: 'Take the specimen from the cryo pod in the atrium and carry it to the exit lift',
      };
    case 'sabotage':
      return {
        contract,
        steps: [
          { id: 'charge1', kind: 'charge', working: 'Planting the charge', seconds: 4, requires: [], locked: none(), done: 'CHARGE SET', unit: true, where: 'landmark', floor: 0, name: 'Tank charge' },
          { id: 'charge2', kind: 'charge', working: 'Planting the charge', seconds: 4, requires: [], locked: none(), done: 'CHARGE SET', unit: true, where: 'landmark', floor: 0, name: 'Tank charge' },
          { id: 'charge3', kind: 'charge', working: 'Planting the charge', seconds: 4, requires: [], locked: none(), done: 'CHARGE SET', unit: true, where: 'wall', floor: upper, name: 'Pump charge' },
        ],
        units: 3,
        carrier: false,
        fuseS: 90,
        unitName: 'CHARGES',
        brief: 'Plant three charges, then get to the exit lift before the fuse runs out',
      };
    case 'swap':
      return {
        contract,
        steps: [
          { id: 'keycard', kind: 'keycard', working: 'Lifting the keycard', seconds: 2, requires: [], locked: none(), done: 'KEYCARD TAKEN · THE CASE IN THE GREAT HALL WILL OPEN FOR IT', unit: true, where: 'wall', floor: 0, name: 'Keycard' },
          {
            id: 'swap',
            kind: 'swapCase',
            working: 'Swapping the exhibit',
            seconds: 6,
            requires: ['keycard'],
            locked: { keycard: 'THE CASE WANTS A KEYCARD · TAKE ONE OFF THE MARKED GUARD FIRST' },
            done: 'EXHIBIT SWAPPED · THEY WON’T NOTICE FOR DAYS · GET OUT',
            unit: true,
            where: 'landmark',
            floor: 0,
            name: 'Exhibit case',
          },
        ],
        units: 2,
        carrier: true,
        fuseS: 0,
        unitName: 'SWAP',
        brief: 'Take the keycard from the marked guard, swap the exhibit in the great hall, and leave',
      };
    case 'vault':
      return {
        contract,
        steps: [
          { id: 'keycard', kind: 'keycard', working: 'Lifting the keycard', seconds: 2, requires: [], locked: none(), done: 'KEYCARD TAKEN · THE VAULT CONSOLE WILL TAKE IT', unit: true, where: 'wall', floor: 0, name: 'Keycard' },
          {
            id: 'vault',
            kind: 'vaultConsole',
            working: 'Opening the vault',
            seconds: 6,
            requires: ['keycard'],
            locked: { keycard: 'THE VAULT WANTS A KEYCARD · TAKE ONE OFF THE MARKED GUARD FIRST' },
            done: 'VAULT OPEN · TAKE THE LEDGER',
            unit: true,
            where: 'landmark',
            floor: 0,
            name: 'Vault console',
          },
          {
            id: 'ledger',
            kind: 'ledger',
            working: 'Taking the ledger',
            seconds: 3,
            requires: ['vault'],
            locked: { vault: 'THE LEDGER IS IN THE VAULT · OPEN IT AT THE CONSOLE FIRST' },
            done: 'LEDGER TAKEN · THE MONEY TRAIL IS YOURS · GET OUT',
            unit: true,
            where: 'landmark',
            floor: 0,
            name: 'Vault ledger',
          },
        ],
        units: 3,
        carrier: true,
        fuseS: 0,
        unitName: 'VAULT',
        brief: 'Take the keycard from the marked guard, open the vault, take the ledger, and leave',
      };
    case 'shipment': {
      const real = Math.max(0, Math.min(3, Math.floor(pick)));
      const steps: Step[] = [
        {
          id: 'manifest',
          kind: 'manifest',
          working: 'Reading the manifest',
          seconds: 3,
          requires: [],
          locked: none(),
          done: `MANIFEST READ · THE SHIPMENT IS IN CONTAINER ${LETTERS[real]}`,
          unit: true,
          where: 'wall',
          floor: 0,
          name: 'Dispatch console',
        },
      ];
      LETTERS.forEach((letter, i) => {
        const isReal = i === real;
        steps.push({
          id: isReal ? 'tracker' : `decoy${letter}`,
          kind: 'tracker',
          working: isReal ? 'Planting the tracker' : 'Forcing the container',
          seconds: isReal ? 4 : 3,
          requires: isReal ? ['manifest'] : [],
          locked: isReal ? { manifest: 'WHICH CONTAINER? READ THE MANIFEST AT THE DISPATCH CONSOLE FIRST' } : none(),
          done: isReal ? 'TRACKER PLANTED · THE SHIPMENT’S ROUTE IS YOURS · GET OUT' : `CONTAINER ${letter} · EMPTY · THE LOCK TRIPPED AN ALARM`,
          unit: isReal,
          where: i < 3 ? 'landmark' : 'wall',
          floor: 0,
          name: `Container ${letter}`,
          decoy: !isReal,
          letter,
        });
      });
      return {
        contract,
        steps,
        units: 2,
        carrier: false,
        fuseS: 0,
        unitName: 'SHIPMENT',
        brief: 'Read the manifest at the dispatch console, then tag the container it names, and leave',
      };
    }
    default:
      return { contract, steps: [], units: 0, carrier: false, fuseS: 0, unitName: 'FILES', brief: 'Photograph the files and leave' };
  }
}

/** Why `step` can't be worked yet given what's `done`, or null when it can. */
export function stepBlocked(step: Step, done: ReadonlySet<string>): string | null {
  for (const need of step.requires) if (!done.has(need)) return step.locked[need] ?? 'NOT YET';
  return null;
}

/** The units done so far. */
export function unitsDone(plan: ObjectivePlan, done: ReadonlySet<string>): number {
  return plan.steps.filter((s) => s.unit && done.has(s.id)).length;
}

/** The next step to point at: the first not done whose requirements are met, else the first not done; null when every unit step is done. */
export function nextStep(plan: ObjectivePlan, done: ReadonlySet<string>): Step | null {
  const open = plan.steps.filter((s) => s.unit && !done.has(s.id));
  return open.find((s) => stepBlocked(s, done) === null) ?? open[0] ?? null;
}

/** The fuse: seconds left given when it was lit and the clock, never below 0; null when it isn't lit. */
export function fuseLeft(litAt: number | null, now: number, fuseS: number): number | null {
  if (litAt === null || fuseS <= 0) return null;
  return Math.max(0, fuseS - (now - litAt));
}

/**
 * How warm a specimen has got: 0 cold to 1 spoiled, given how long it has been out of its pod. Walking slowly keeps it a few minutes (a
 * generous window: the job is spoiled only by dawdling), and each second spent still, hiding or hanging about counts a little less.
 */
export const SPECIMEN_SAFE_S = 240;
export const specimenWarmth = (secondsOut: number): number => Math.min(1, Math.max(0, secondsOut / SPECIMEN_SAFE_S));
