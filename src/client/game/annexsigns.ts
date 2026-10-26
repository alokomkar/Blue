// What the Records Annex's walls, floors and shelving banks say (signage.ts has the Sump's): a records office's voice.
// Handed to bunkersigns.ts in place of the Sump's words.

import * as sump from './signage';

export const annexText: typeof sump = {
  ...sump,
  LEVEL_CODES: ['L0', 'L1', 'L2'] as unknown as typeof sump.LEVEL_CODES,
  LEVEL_TITLES: ['READING', 'THE STACKS', 'REGISTRY'] as unknown as typeof sump.LEVEL_TITLES,
  HALL_FLOOR: ['SILENCE', 'KEEP CLEAR', 'TROLLEYS ONLY', 'MIND THE SHELVES', 'NO RUNNING', 'AISLE LIGHTS ON MOTION'],
  PLATES: [
    ['SILENCE', 'READING ROOM'],
    ['NO FOOD OR DRINK'],
    ['SLIDING SHELVES', 'CHECK THE AISLE'],
    ['STAFF ONLY', 'ACCESS LOGGED'],
    ['FILES MUST NOT LEAVE', 'THIS FLOOR'],
    ['RECORDS OFFICE', 'CAMPUS BUILDING 4'],
    ['CLEAN HANDS', 'CLEAN RECORDS'],
    ['DO NOT PROP DOORS', 'LIGHTS ARE ON MOTION'],
    ['ASK THE REGISTRAR'],
    ['FIRE ASSEMBLY POINT', 'CAMPUS GREEN'],
  ],
  ROOM_NAMES: { A: 'LOBBY', Z1: 'READING ROOMS', Z2: 'THE STACKS', Z3: 'SORTING ROOM', Z4: 'REGISTRY VAULT', Z5: 'ANTECHAMBER' },
  LORE_FLOOR: ['A PLACE FOR EVERY NAME', 'THE SUGGESTION BOX IS ON THE LEFT'],
  LORE_PLATE: [['VISITORS THIS YEAR', '000'], ['YOU ARE HERE', 'FLOOR PLAN B'], ['ASK AT THE DESK']],
  CARGO: ['PERSONNEL', 'ADMISSIONS', 'APPLICATIONS', 'INTAKE · YEAR 1', 'REFEREES', 'SEALED', 'RECORDS', 'FORMS'],
  HANDLING: ['FILE IN ORDER', 'SLIDE WITH CARE', 'KEEP CLOSED', 'DO NOT REMOVE', 'RETURN TO THE REGISTRAR'],
  SIZE_CODE: 'BAY' as unknown as typeof sump.SIZE_CODE,
  containerId: (level: number, n: number): string => `STACK ${level}-${String(n + 1).padStart(2, '0')}`,
};
