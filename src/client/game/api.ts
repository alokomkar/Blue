// Thin fetch wrappers for the Devvit server routes (src/server/routes/api.ts).
// Both resolve to null instead of throwing on any failure — logged-out
// viewers (401 on save), network errors, and local play against a static
// file server with no /api at all — since saving progress is a nice-to-have
// that must never interrupt the game itself.

import type {
  DailyResponse,
  DailyResultResponse,
  DailyStartResponse,
  InitResponse,
  Leaderboard,
  LeaderboardResponse,
  PlayedResponse,
  ProfileResponse,
  ProfileUpdate,
  SaveRequest,
  SaveResponse,
} from '../../shared/api';
import type { DailyResult } from '../../shared/daily';
import type { Device, TryReport, Untagged } from '../../shared/tries';

export async function fetchInit(): Promise<InitResponse | null> {
  try {
    const res = await fetch('/api/init');
    if (!res.ok) return null;
    return (await res.json()) as InitResponse;
  } catch {
    return null;
  }
}

export async function saveRun(run: SaveRequest): Promise<SaveResponse | null> {
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    if (!res.ok) return null;
    return (await res.json()) as SaveResponse;
  } catch {
    return null;
  }
}

/** Counts a try's result, or how a job felt, in the difficulty tally. Fire and forget: never blocks or fails the game. */
export function reportTry(report: Untagged<TryReport>): void {
  void post('/api/tries', { ...report, device: deviceNow() });
}

/** Touch when the touch controls are showing (a phone or tablet), desktop otherwise. */
export function deviceNow(): Device {
  const touch = document.getElementById('touch-controls');
  return touch && !touch.classList.contains('hidden-controls') ? 'touch' : 'desktop';
}

/** The heist-points board and the community's progress, together. */
export async function fetchBoards(): Promise<LeaderboardResponse | null> {
  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) return null;
    return (await res.json()) as LeaderboardResponse;
  } catch {
    return null;
  }
}

export async function fetchLeaderboard(): Promise<Leaderboard | null> {
  return (await fetchBoards())?.leaderboard ?? null;
}

/** Saves the agent pick / training done to the player's account (logged in only; null otherwise). */
export async function saveProfile(update: ProfileUpdate): Promise<ProfileResponse | null> {
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProfileResponse;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Counts a play today toward the streak (logged in only; null otherwise). */
export function markPlayed(): Promise<PlayedResponse | null> {
  return post<PlayedResponse>('/api/played', {});
}

/** Today's Daily Heist: its seed and job, the viewer's status, the board and their streak. */
export async function fetchDaily(): Promise<DailyResponse | null> {
  try {
    const res = await fetch('/api/daily');
    if (!res.ok) return null;
    return (await res.json()) as DailyResponse;
  } catch {
    return null;
  }
}

/** Starts today's heist: 'started' means this run is scored, 'already' that it's practice. Null when logged out or offline. */
export function startDaily(day: string): Promise<DailyStartResponse | null> {
  return post<DailyStartResponse>('/api/daily/start', { day });
}

export function submitDaily(result: DailyResult): Promise<DailyResultResponse | null> {
  return post<DailyResultResponse>('/api/daily/result', result);
}
