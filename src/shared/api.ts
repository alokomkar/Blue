import type { DailyResult } from './daily';
import type { RunOutcome } from './campaign';
import type { ContractId } from './contracts';
import type { Ending } from './arc';
import type { ControlSettings } from './controls';
import type { HAIRSTYLES, LOOKS, SUIT_COLOURS } from './progress';

/** A player's personal bests — highest job number cleared, and highest score reached within a single job. */
export type BestRun = {
  bestJob: number;
  bestScore: number;
};

/** The agent a player picked on the mission brief. */
export type Agent = 'male' | 'female';

/** How the agent is dressed: in their own clothes, or the operative's black bodysuit (progress.ts's LOOKS). */
export type Look = (typeof LOOKS)[number];
/** The operative's bodysuit colour and hair (progress.ts's SUIT_COLOURS, HAIRSTYLES). */
export type SuitColour = (typeof SUIT_COLOURS)[number];
export type Hairstyle = (typeof HAIRSTYLES)[number];

/** What follows a player from device to device, beside their bests: their agent and look, and whether they've done training. */
/** The last job on the ladder they cleared, which carries into the next (campaign.ts's ladderCarry). */
export type LastRun = { outcome: RunOutcome; contract: ContractId };

export type Profile = {
  /** Null until they've picked one. */
  agent: Agent | null;
  /** Null until they've picked one (they wear their own clothes). */
  look: Look | null;
  /** The operative's suit colour and hair; null until picked. */
  suit: SuitColour | null;
  hair: Hairstyle | null;
  trained: boolean;
  /** Finished the stealth course (tutorial.ts), which every agent must before a mission. Once done, it stays. */
  stealthTrained: boolean;
  /** The choice they made at the end of the run (arc.ts); null until made. Once made, it stays. */
  ending: Ending | null;
  /** Their turn sensitivity, turn smoothing and key bindings (controls.ts); null until they've changed anything. */
  controls: ControlSettings | null;
  /** Null until they've cleared a job on the ladder. */
  lastRun: LastRun | null;
};

/** The week's community total, as it stands (case.ts). */
export type CaseStanding = {
  /** Which week (from campaign.ts); 0 before week #1. */
  number: number;
  /** Pages this community has added to it so far. */
  pages: number;
  /** Agents who've added to it. */
  agents: number;
  /** Pages the viewer's added (0 when logged out). */
  mine: number;
  /** How last week's total ended up, in pages, for what it carries in (case.ts's communityCarry). */
  lastWeekPages: number;
};

/** Everyone who's played in this community, and how far they've got (the board that shows progress, not only clears). */
export type Community = {
  /** Agents who've started a job. */
  played: number;
  /** Agents who've finished training. */
  trained: number;
  /** Agents who've cleared at least one job, and at least three. */
  cleared: number;
  deep: number;
  /** The furthest along, by the highest job cleared. */
  top: Array<{ rank: number; username: string; job: number }>;
  /** The viewer's place among them (null if logged out, or no job cleared yet). */
  you: { rank: number; job: number } | null;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  /** Null when the viewer isn't logged in — there's no identity to key progress by. */
  username: string | null;
  best: BestRun | null;
  profile: Profile | null;
  /** Days in a row played (anything counts). Null when logged out. */
  streak: StreakInfo | null;
  /** Who's played here and how far they've got. */
  community: Community;
};

/** A player's streak as it stands today. */
export type StreakInfo = {
  /** Days in a row, today included if they've played; 0 once a day has gone by without playing. */
  count: number;
  best: number;
  playedToday: boolean;
};

/** A change to the profile: any field left out stays as it was. (The last run is the server's own, from a save.) */
export type ProfileUpdate = Partial<Omit<Profile, 'lastRun'>>;

export type ProfileResponse = {
  type: 'profile';
  profile: Profile;
};

/** Stealth grade from the end-of-job report — S (never seen, on time) down to D. */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export type SaveRequest = {
  /** The job number just cleared, or null when the job ended without clearing (caught). */
  jobCleared: number | null;
  /** Score reached in the job that just ended. */
  score: number;
  /** A cleared job's heist points and grade, for the leaderboard. Only sent with `jobCleared`. */
  heist?: { points: number; grade: Grade };
  /** How a cleared job went, what it was, and the pages it adds to the case. Only sent with `jobCleared`. */
  run?: { outcome: RunOutcome; contract: ContractId; pages: number };
};

export type LeaderboardEntry = { rank: number; username: string; points: number; job: number; grade: Grade };

/** The top of this community's board, plus the viewer's own place on it (null if logged out or not on it yet). */
export type Leaderboard = {
  top: LeaderboardEntry[];
  you: { rank: number; points: number } | null;
};

export type SaveResponse = {
  type: 'save';
  best: BestRun;
  newBestJob: boolean;
  newBestScore: boolean;
  /** True when this job's heist points beat the viewer's best on the leaderboard. */
  newBestHeist: boolean;
  leaderboard: Leaderboard;
  community: Community;
  /** The case as it stands after this run (null when nothing was added to it). */
  case: CaseStanding | null;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  leaderboard: Leaderboard;
  community: Community;
};

// ---- Daily Heist (see daily.ts) ----

/** Not started today, started (the one scored attempt is used up), or finished and on the record. */
export type DailyStatus = 'new' | 'started' | 'done';

export type DailyBoardEntry = { rank: number; username: string; points: number; grade: Grade; seconds: number };

/** Today's board in this community: the top clears, the viewer's place, and how many have played. */
export type DailyBoard = {
  top: DailyBoardEntry[];
  you: { rank: number; points: number } | null;
  /** Everyone who's started today's heist, cleared or not. */
  players: number;
};

export type DailyResponse = {
  type: 'daily';
  day: string;
  number: number;
  level: number;
  seed: number;
  /** The day this post is the Daily Heist for, when it's one of the daily posts (null on any other post). */
  postDay: string | null;
  /** Always 'new' when logged out: there's no account to hold an attempt, so the run isn't scored. */
  status: DailyStatus;
  /** The viewer's scored run today, once it's in. */
  result: DailyResult | null;
  board: DailyBoard;
  streak: StreakInfo | null;
  /** Documents this community's agents have recovered in cleared dailies, all time. */
  caseEvidence: number;
  /** Dailies the viewer has cleared, all time (null when logged out). */
  missions: number | null;
  /** How the viewer's scored run went last night, which carries into tonight (campaign.ts); null when logged out. */
  lastNight: RunOutcome | null;
  /** The contract that run was, for what it carries (null when logged out, or from before contracts). */
  lastContract: ContractId | null;
  /** This week's case, as the community stands. */
  case: CaseStanding;
  /** How this week's earlier nights went, Monday first, for the case's close on Sunday (empty when logged out). */
  week: RunOutcome[];
};

export type DailyStartResponse = {
  type: 'dailyStart';
  /** 'started': this attempt is scored. 'already': today's scored attempt was used, so this one is practice. */
  status: 'started' | 'already';
  streak: StreakInfo;
};

export type DailyResultResponse = {
  type: 'dailyResult';
  board: DailyBoard;
  caseEvidence: number;
  missions: number;
  case: CaseStanding;
};

export type PlayedResponse = {
  type: 'played';
  streak: StreakInfo;
};
