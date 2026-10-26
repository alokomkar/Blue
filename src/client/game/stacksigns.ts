// What the walls, floors and stacks say in each first level built on the stacks engine (signage.ts has the Sump's, annexsigns.ts the Records Annex's): the Museum Store, the Armoured Depot
// and the Lab Hall. Handed to bunkersigns.ts in place of the Sump's words.

import * as sump from './signage';
import { annexText } from './annexsigns';
import type { StackSite } from './arc';

const idOf = (prefix: string) => (level: number, n: number): string => `${prefix} ${level}-${String(n + 1).padStart(2, '0')}`;

export const storeText: typeof sump = {
  ...sump,
  LEVEL_CODES: ['R', 'C', 'G'] as unknown as typeof sump.LEVEL_CODES,
  LEVEL_TITLES: ['RECEIVING', 'CLIMATE', 'GALLERY'] as unknown as typeof sump.LEVEL_TITLES,
  HALL_FLOOR: ['KEEP CLEAR', 'WALK, DO NOT RUN', 'TROLLEYS ONLY', 'AIRLOCK AHEAD', 'MIND THE PLINTHS', 'NO FLASH'],
  PLATES: [
    ['CLIMATE CONTROLLED', '18°C · 50% RH'],
    ['ONE DOOR AT A TIME'],
    ['DO NOT TOUCH THE EXHIBITS'],
    ['STAFF ONLY', 'ACCESS LOGGED'],
    ['CRATES MUST NOT BE STACKED', 'OVER TWO HIGH'],
    ['THE GREAT HALL', 'LOAN REF · 12'],
    ['NO FOOD OR DRINK'],
    ['ALARM ARMED', 'AFTER 18:00'],
    ['FRAGILE · OIL ON CANVAS'],
    ['FIRE ASSEMBLY POINT', 'THE STREET'],
  ],
  ROOM_NAMES: { A: 'LOADING DOCK', Z1: 'CRATE STACKS', Z2: 'CLIMATE ROOM', Z3: 'PAINTING RACKS', Z4: 'STATUE GALLERY', Z5: 'CURATORS’ OFFICE' },
  LORE_FLOOR: ['PLEASE KEEP TO THE PATH', 'THE GIFT SHOP IS ON THE LEFT'],
  LORE_PLATE: [['LOANS THIS YEAR', '000'], ['YOU ARE HERE', 'FLOOR PLAN B'], ['ASK AT THE DESK']],
  CARGO: ['OIL ON CANVAS', 'MARBLE', 'BRONZE', 'LOAN · SEALED', 'PAINTED OVER', 'FRAME ONLY', 'PORTRAIT', 'PROVENANCE'],
  HANDLING: ['THIS WAY UP', 'FRAGILE', 'DO NOT STACK', 'KEEP DRY', 'OPEN WITH CARE'],
  SIZE_CODE: 'CRATE' as unknown as typeof sump.SIZE_CODE,
  containerId: idOf('CRATE'),
};

export const depotText: typeof sump = {
  ...sump,
  LEVEL_CODES: ['G', 'P1', 'V'] as unknown as typeof sump.LEVEL_CODES,
  LEVEL_TITLES: ['LOADING', 'PARKING', 'VAULT'] as unknown as typeof sump.LEVEL_TITLES,
  HALL_FLOOR: ['RAMP', 'GIVE WAY', 'VANS ONLY', 'NO STOPPING', 'WALK ON THE LEFT', 'MIND THE BARRIER'],
  PLATES: [
    ['SOUTHERN SUN BANKING', 'TRANSIT DEPOT'],
    ['ARMED RESPONSE'],
    ['DOORS MUST BE SEALED', 'BEFORE THE ENGINE STARTS'],
    ['STAFF ONLY', 'ACCESS LOGGED'],
    ['MAX HEIGHT 2.8 M'],
    ['CASH IN TRANSIT', 'DO NOT APPROACH'],
    ['NO SMOKING'],
    ['REPORT ALL SHORTAGES'],
    ['VAN 7 · LANE 2'],
    ['FIRE ASSEMBLY POINT', 'EXCHANGE ROW'],
  ],
  ROOM_NAMES: { A: 'GATEHOUSE', Z1: 'LOADING BAYS', Z2: 'PARKING DECK', Z3: 'CONTROL BOOTH', Z4: 'VAULT ANTECHAMBER', Z5: 'THE VAULT' },
  LORE_FLOOR: ['EVERY ACCOUNT HAS A NAME', 'COUNT TWICE'],
  LORE_PLATE: [['SHORTAGES THIS YEAR', '000'], ['YOU ARE HERE', 'FLOOR PLAN B'], ['ASK AT THE DESK']],
  CARGO: ['CASH IN TRANSIT', 'HOLDING', 'SEALED', 'MANIFEST 7', 'REGISTRY', 'COUNTED', 'SOUTHERN SUN'],
  HANDLING: ['LOCKED', 'DO NOT OPEN', 'TWO KEYS', 'CHECK THE SEAL'],
  SIZE_CODE: 'VAN' as unknown as typeof sump.SIZE_CODE,
  containerId: idOf('VAN'),
};

/** The words for a first level built on the stacks engine. */
export function textFor(site: StackSite): typeof sump {
  return site === 'annex' ? annexText : site === 'store' ? storeText : depotText;
}
