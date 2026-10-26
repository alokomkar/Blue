// The week's shared score, built by the whole community. Every cleared mission adds pages to the week's total (the
// Daily's weekly route, campaign.ts), and the total decides which tier the week reaches: bronze, silver or gold. How
// high last week finished carries into this week for everyone, so a community that works together starts the next week
// a little ahead. Pure, so it's unit-tested under Node.

import type { Carry } from './campaign';

export type CaseTier = { pages: number; name: string; verdict: string };

/** What the week's pages add up to, weakest first. */
export const CASE_TIERS: readonly CaseTier[] = [
  { pages: 40, name: 'Bronze', verdict: 'A fair start for the week.' },
  { pages: 100, name: 'Silver', verdict: 'A strong week.' },
  { pages: 200, name: 'Gold', verdict: 'An outstanding week.' },
];

export type CaseStrength = {
  /** How many of the tiers are reached (0–3). */
  tier: number;
  /** The highest tier's name, null before the first. */
  name: string | null;
  /** The next tier to reach, null once at the top. */
  next: CaseTier | null;
  /** Along the whole bar, 0–1 (the last tier is the end of it). */
  fraction: number;
};

export function caseStrength(pages: number): CaseStrength {
  const tier = CASE_TIERS.filter((t) => pages >= t.pages).length;
  const top = CASE_TIERS[CASE_TIERS.length - 1]!.pages;
  return { tier, name: tier ? CASE_TIERS[tier - 1]!.name : null, next: CASE_TIERS[tier] ?? null, fraction: Math.min(1, Math.max(0, pages / top)) };
}

/**
 * What last week's total carries into this week for everyone: silver, an extra EMP charge; gold, that
 * and the network rooms marked. Bronze or less, nothing.
 */
export function communityCarry(lastWeekPages: number): Partial<Carry> {
  const { tier } = caseStrength(lastWeekPages);
  if (tier >= 3) return { extraEmp: 1, markNetwork: true, notes: ['Last week finished on gold: every agent starts with an extra EMP charge, and the network rooms marked.'] };
  if (tier === 2) return { extraEmp: 1, notes: ['Last week finished on silver: every agent starts with an extra EMP charge.'] };
  return {};
}
