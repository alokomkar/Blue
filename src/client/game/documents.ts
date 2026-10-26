// The files you capture, as pages to read: a memo, a ledger line, a log from the building you are in (three for each place, picked by job and capture so the same file does not
// turn up twice in a run). Pure, so it is unit-tested under Node.

import type { LocationId } from './locations';

export type FilePage = { kicker: string; title: string; body: string };

const DOCUMENTS: Record<LocationId, readonly FilePage[]> = {
  campus: [
    { kicker: 'Facilities', title: 'Night shift roster, week 14', body: 'Night security drops to four patrols and two dogs from 23:00. The third patrol is routed through the east corridor only.\n\nAnyone who asks why is to be told it is a budget matter.' },
    { kicker: 'Internal', title: 'Re: the other building', body: 'The second ledger is not in the harbour office. It never was.\n\nFacilities will move it to the fourth floor on the night of the 14th, the night the generators are tested. Nobody on that floor has clearance to ask why.' },
    { kicker: 'People', title: 'Visitor enrolment, notes', body: 'Visitors sign the sign-in sheet before they read the rules.\n\nThe word to use in writing is “welcome”.' },
  ],
  museum: [
    { kicker: 'Curator’s office', title: 'Loan agreement, sealed exhibit 4', body: 'The exhibit on loan is not in the catalogue. The insurers have been told it is a replica.\n\nThe replica is the one in the case.' },
    { kicker: 'Gallery security', title: 'Case alarms, quarterly test', body: 'Three cases have no sensor. They were chosen so that anyone who knows that is someone who should not.' },
    { kicker: 'Trustees', title: 'Minutes, closed session', body: 'Item six was not minuted.\n\nItem six was the donation, and who it came from, and what it is expected to buy.' },
  ],
  refinery: [
    { kicker: 'Refinery · Operations', title: 'Tank 6 inspection, deferred', body: 'Deferred a third time. The reading on the pump house is within tolerance as long as nobody reads it twice.' },
    { kicker: 'Shift supervisor', title: 'Valve log, annotated', body: 'Valve 14 sticks. We close it with a hammer.\n\nPut that in no report.' },
    { kicker: 'Environmental', title: 'Quarterly emissions return', body: 'The return is correct to the decimal, and wrong in every way that matters. Filed on time.' },
  ],
  bank: [
    { kicker: 'Vault management', title: 'Dual-key procedure', body: 'Two keys, two people. The second key is kept in the same drawer as the first.\n\nThe auditors have never looked in the drawer.' },
    { kicker: 'Compliance', title: 'Suspicious activity, not filed', body: 'Seven transfers under the threshold, one beneficiary, a harbour address.\n\nNot filed, on instruction.' },
    { kicker: 'Private clients', title: 'The second ledger', body: 'The second ledger is kept off the network on purpose. It is kept in the building, which is where you are standing.' },
  ],
  warehouse: [
    { kicker: 'Port Authority · Harbour logistics', title: 'Manifest amendment 7741–7760', body: 'Containers 7741 to 7760 are to be re-labelled AGRICULTURAL before Thursday’s inspection.\n\nThe paperwork is already signed. If the city asks, the manifest was always agricultural.' },
    { kicker: 'Logistics', title: 'Pallet 22, do not scan', body: 'Pallet 22 is not on the system. It is on the dock under a tarpaulin, and it is heavier than it should be.' },
    { kicker: 'Customs', title: 'Inspection waiver', body: 'Signed in advance for any container beginning 77. The signature is Director Vale’s.\n\nShe does not know the waiver exists.' },
  ],
  lab: [
    { kicker: 'Security · Patrol procedure', title: 'Patrol notes, revision 12', body: 'The patrols learn habits, not faces. An intruder who repeats a route meets the same guard again.\n\nVary the entrance. Vary the posture. Vary the hour.' },
    { kicker: 'Lab notebook', title: 'Trial response, day 40', body: 'The test group adapts to every layout in under nine runs. Raise the complexity, not the walls.' },
    { kicker: 'Ethics board', title: 'Waiver of review', body: 'Review waived for this quarter.\n\nThe paperwork will follow, eventually.' },
  ],
};

/** The page of file number `n` (from 1) captured on job `job` at `place`. */
export function documentFor(place: LocationId, job: number, n: number): FilePage {
  const list = DOCUMENTS[place];
  return list[(Math.max(0, job) + Math.max(1, n) - 1) % list.length]!;
}

/** Every page, for the test. */
export function allDocuments(): FilePage[] {
  return Object.values(DOCUMENTS).flat();
}
