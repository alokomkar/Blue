// How the community's progress reads: the line under the brief and on the
// report, and the moderator's stats. Pure, so it's unit-tested under Node.

import type { Community } from './api';

const agents = (n: number): string => (n === 1 ? '1 agent' : `${n} agents`);

/** "12 agents have played · 9 trained · 5 have cleared a job": the funnel, in a line. */
export function communityLine(c: Community): string {
  const parts = [`${agents(c.played)} ${c.played === 1 ? 'has' : 'have'} played`];
  if (c.trained > 0) parts.push(`${c.trained} trained`);
  parts.push(c.cleared === 0 ? 'none has cleared a job yet' : c.cleared === 1 ? '1 has cleared a job' : `${c.cleared} have cleared a job`);
  if (c.deep > 0) parts.push(`${c.deep} got to job 3`);
  return parts.join(' · ');
}

/** What the daily heists saw over some days: agents who started, and who cleared. */
export type DailyCount = { started: number; cleared: number };

/** The moderator's stats, short enough for a toast. */
export function statsToast(c: Community, today: DailyCount, week: DailyCount, training = ''): string {
  const rate = week.started > 0 ? ` (${Math.round((100 * week.cleared) / week.started)}%)` : '';
  return `Agents ${c.played} · trained ${c.trained} · cleared a job ${c.cleared} · job 3+ ${c.deep}. Daily today: ${today.started} started, ${today.cleared} cleared. Last 7 days: ${week.started} started, ${week.cleared} cleared${rate}.${training ? ` ${training}.` : ''}`;
}
