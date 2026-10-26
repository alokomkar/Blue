// What a job asks of the player. Every job used to be the same contract:
// photograph the files and get out. Now each has one of five, and each pays
// off differently in what follows it (fallout.ts). Here, the names and
// words for them; where they turn up, and how they play, is the client's
// (client/game/contracts.ts). Pure, so it's unit-tested under Node.

export const CONTRACT_IDS = ['records', 'sabotage', 'vault', 'hit', 'blackout', 'extract', 'swap', 'shipment'] as const;
export type ContractId = (typeof CONTRACT_IDS)[number];

export const isContractId = (x: unknown): x is ContractId => typeof x === 'string' && (CONTRACT_IDS as readonly string[]).includes(x);

export type ContractInfo = {
  id: ContractId;
  name: string;
  /** What the HUD counts. */
  unit: string;
  /** The report card's line for it. */
  report: string;
  /** What it adds to the week's total, per page. */
  evidence: string;
};

export const CONTRACTS: Record<ContractId, ContractInfo> = {
  records: {
    id: 'records',
    name: 'Records',
    unit: 'FILES',
    report: 'Files captured',
    evidence: 'documents',
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage',
    unit: 'CHARGES',
    report: 'Charges planted',
    evidence: 'proof of the damage',
  },
  vault: {
    id: 'vault',
    name: 'Vault',
    unit: 'VAULT',
    report: 'Vault steps done',
    evidence: 'the money trail',
  },
  hit: {
    id: 'hit',
    name: 'Hit',
    unit: 'TARGET',
    report: 'Target steps done',
    evidence: 'a witness’s keycard and statement',
  },
  blackout: {
    id: 'blackout',
    name: 'Blackout',
    unit: 'BREAKERS',
    report: 'Breakers cut',
    evidence: 'the wiring plans',
  },
  extract: {
    id: 'extract',
    name: 'Extraction',
    unit: 'SPECIMEN',
    report: 'Specimen delivered',
    evidence: 'a live sample and the lab’s own notes on it',
  },
  swap: {
    id: 'swap',
    name: 'The swap',
    unit: 'SWAP',
    report: 'Swap steps done',
    evidence: 'the forged provenance papers',
  },
  shipment: {
    id: 'shipment',
    name: 'The shipment',
    unit: 'SHIPMENT',
    report: 'Shipment steps done',
    evidence: 'the bill of lading and the route it names',
  },
};
