// The Daily Heist's operation for a day: that night of the week's case
// (campaign.ts), told by story.ts; before the first case, a standalone night.
// Shared by the splash and the game.

import { dayInfo } from '../shared/daily';
import { caseFor } from '../shared/campaign';
import { operationFor, type Operation } from '../shared/story';

export function tonight(day: string): Operation {
  const chapter = caseFor(day);
  return operationFor({ ...dayInfo(day), ...(chapter ? { chapter } : {}) });
}
