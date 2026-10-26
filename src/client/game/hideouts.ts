// Where a body can be put away, place by place. The three kinds (a locker you step into, a pair of long crates that slide apart, a vent) work the
// same everywhere, so a body fits and takes as long as it always did (stash.ts); what changes is what they are and how many of each a floor has:
// a wardrobe in the museum, a cryo cabinet in the lab, a tool cage in the warehouse; crates as packing cases, sample cases, cargo skids; a service
// duct, a pipe-chase hatch, a drain grate. A place leans on one kind (the warehouse is all crates, the bank all cabinets) so how you hide a body
// changes with where you are. Data only, no scene: stealthprops.ts and hiding.ts draw from it. Node-testable.

import type { LocationId } from './locations';

export type HideSkin = {
  locker: {
    /** "a staff locker": what the toasts call it. */
    name: string;
    /** What the toast says while the agent opens it. */
    working: string;
    door: number;
    trim: number;
    /** A lit window in the door (the lab's cryo cabinet). */
    glass?: number;
    /** A painted band across the door (hazard yellow, a yellow stripe). */
    stripe?: number;
  };
  crates: {
    name: string;
    working: string;
    body: number;
    /** The other half of the pair, when the two differ (a container's red and blue). */
    body2?: number;
    stripe: number;
    /** Corrugated ribs along the sides (shipping containers, steel skids). */
    ribs?: boolean;
    /** Brass or steel corner caps. */
    corners?: number;
  };
  vent: {
    name: string;
    working: string;
    frame: number;
    /** A glow behind the slats. */
    glow?: number;
  };
  /** Added to the job's counts of crates, staff lockers and vents on each floor. */
  mix: { crates: number; lockers: number; vents: number };
};

export const HIDEOUTS: Record<LocationId, HideSkin> = {
  campus: {
    locker: { name: 'a staff locker', working: 'UNLOCKING THE LOCKER', door: 0x5f6975, trim: 0x3b424b },
    crates: { name: 'the crates', working: 'SLIDING THE CRATES APART', body: 0x4a4030, stripe: 0xe0bd6c },
    vent: { name: 'a vent', working: 'LIFTING THE GRILLE', frame: 0x3b424b },
    mix: { crates: 0, lockers: 0, vents: 0 },
  },
  museum: {
    locker: { name: 'a costume wardrobe', working: 'OPENING THE WARDROBE', door: 0x4a2f22, trim: 0xb08d4a },
    crates: { name: 'the packing cases', working: 'SLIDING THE PACKING CASES APART', body: 0xcdbf9f, stripe: 0x7a2f36, corners: 0x8a6a2a },
    vent: { name: 'a service duct', working: 'LIFTING THE DUCT COVER', frame: 0x8a6a2a },
    mix: { crates: 1, lockers: -1, vents: 0 },
  },
  refinery: {
    locker: { name: 'an equipment cabinet', working: 'OPENING THE CABINET', door: 0xb8892a, trim: 0x2a2f33, stripe: 0x1a1d21 },
    crates: { name: 'the cargo skids', working: 'SLIDING THE SKIDS APART', body: 0x4a4e52, stripe: 0xc2b13a, ribs: true },
    vent: { name: 'a pipe-chase hatch', working: 'LIFTING THE HATCH', frame: 0x6a5a3a, glow: 0xffb04a },
    mix: { crates: -1, lockers: 0, vents: 1 },
  },
  bank: {
    locker: { name: 'a deposit cabinet', working: 'OPENING THE CABINET', door: 0x2f4a3a, trim: 0xb08d4a },
    crates: { name: 'the cash crates', working: 'SLIDING THE CASH CRATES APART', body: 0x2a3b30, stripe: 0xb08d4a, corners: 0xb08d4a },
    vent: { name: 'an air duct', working: 'LIFTING THE DUCT GRILLE', frame: 0xb08d4a },
    mix: { crates: -1, lockers: 1, vents: 0 },
  },
  warehouse: {
    locker: { name: 'a tool cage', working: 'UNLATCHING THE TOOL CAGE', door: 0x3a5f8a, trim: 0x2a3036, stripe: 0xd8b02a },
    crates: { name: 'the shipping crates', working: 'SHOVING THE CRATES APART', body: 0xa83a2a, body2: 0x2a5f8a, stripe: 0xd8b02a, ribs: true },
    vent: { name: 'a drain grate', working: 'LIFTING THE GRATE', frame: 0xd8b02a },
    mix: { crates: 2, lockers: -1, vents: -1 },
  },
  lab: {
    locker: { name: 'a cryo cabinet', working: 'UNSEALING THE CRYO CABINET', door: 0xe4ecef, trim: 0x1f9a98, glass: 0x6ff5e6 },
    crates: { name: 'the sample cases', working: 'SLIDING THE CASES APART', body: 0xe4ecef, stripe: 0x1f9a98 },
    vent: { name: 'a ventilation duct', working: 'LIFTING THE DUCT COVER', frame: 0xe4ecef, glow: 0x6ff5e6 },
    mix: { crates: -1, lockers: 1, vents: 1 },
  },
};

/** A floor's counts of each kind once the place has leaned on one: never below none, and never fewer hiding places in all than the job's own counts less one. */
export function hideCounts(base: { crates: number; staffLockers: number; vents: number }, skin: HideSkin): { crates: number; staffLockers: number; vents: number } {
  const out = {
    crates: Math.max(0, base.crates + skin.mix.crates),
    staffLockers: Math.max(0, base.staffLockers + skin.mix.lockers),
    vents: Math.max(0, base.vents + skin.mix.vents),
  };
  const want = base.crates + base.staffLockers + base.vents - 1;
  // A place that leans too far still has to leave somewhere to hide: top up the kind it leans on.
  const lean = (Object.entries(skin.mix) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0]![0];
  while (out.crates + out.staffLockers + out.vents < want) {
    if (lean === 'crates') out.crates++;
    else if (lean === 'lockers') out.staffLockers++;
    else out.vents++;
  }
  return out;
}
