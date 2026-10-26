// How the jobs are going for the players, in numbers: every try's result, what ended the ones that failed, and how
// a player said it felt. The client reports each (fire and forget); the server only counts them in one hash. This
// is what says whether the game is too hard. Pure, so it's unit-tested under Node.

export const CAUSES = ['dog', 'laser', 'spotted', 'drone', 'shot', 'blast', 'shock', 'body', 'locker', 'other'] as const;
export type Cause = (typeof CAUSES)[number];
export const FEELS = ['easy', 'right', 'hard'] as const;
/** What players do with the grapple, counted to see whether it's used: a hook, a lowering to hover, a file taken from a hover, a drop onto a guard, a grip giving out, the course finished. */
export const USES = ['hook', 'hover', 'capture', 'drop', 'fall', 'course'] as const;
export type Use = (typeof USES)[number];
export type Feel = (typeof FEELS)[number];

/** What ended a failed try, from the title it was caught under (game.ts triggerCaught). */
export function causeOf(title: string): Cause {
  switch (title) {
    case 'Mauled by a watchdog':
      return 'dog';
    case 'Caught in a laser':
      return 'laser';
    case "You've been spotted":
      return 'spotted';
    case 'Spotted from above':
      return 'drone';
    case 'Hit by enemy fire':
      return 'shot';
    case 'Caught in the blast':
    case 'Blown up by an alpha':
      return 'blast';
    case 'Electrocuted':
      return 'shock';
    case 'A body was found':
      return 'body';
    case 'Caught':
      return 'locker';
    default:
      return 'other';
  }
}

/** The training courses, and what a training report says happened: a station reached, a station failed (and restarted), the course done. */
export const COURSES = ['basics', 'ceiling', 'grapple', 'stealth', 'weapons', 'cover', 'corners', 'wall', 'dock', 'range'] as const;
export type CourseId = (typeof COURSES)[number];
export const TRAIN_EVENTS = ['reach', 'fail', 'done'] as const;
export type TrainEvent = (typeof TRAIN_EVENTS)[number];

/** How a job's letter was dealt with: read for a moment, a while, or not at all (how long it stayed open before it was answered). */
export const READS = ['fast', 'mid', 'slow'] as const;
export type Read = (typeof READS)[number];
export const LETTER_EVENTS = ['shown', 'accept', 'later'] as const;
export type LetterEvent = (typeof LETTER_EVENTS)[number];
/** Optional story-card events, counted to see whether they are reached: a card shown, or a final choice made (and whether its film was watched or skipped). */
export const STORY_ENDINGS = ['public', 'private'] as const;

/** How long a letter was open, in seconds, as a read: under 3 is skimmed past, over 12 is read. */
export function readOf(seconds: number): Read {
  return seconds < 3 ? 'fast' : seconds <= 12 ? 'mid' : 'slow';
}

/** Which kind of screen a report came from: touch controls showing (a phone or tablet), or a keyboard and mouse. */
export const DEVICES = ['touch', 'desktop'] as const;
export type Device = (typeof DEVICES)[number];

/**
 * One report from a client: a try that ended (cleared, or caught and by what), how a job felt, or a use of the
 * grapple. `device` is which kind of screen it came from, when the client said.
 */
export type TryReport = { device?: Device } & (
  | { kind: 'try'; job: number; daily: boolean; cleared: boolean; cause?: Cause }
  | { kind: 'feel'; job: number; daily: boolean; feel: Feel }
  | { kind: 'grapple'; use: Use }
  | { kind: 'train'; course: CourseId; event: TrainEvent; station?: number }
  | { kind: 'letter'; job: number; daily: boolean; event: LetterEvent; read?: Read }
  | { kind: 'story'; what: 'memory'; job: number; n: number }
  | { kind: 'story'; what: 'ending'; ending: (typeof STORY_ENDINGS)[number]; skipped: boolean }
);

/** A report as the game builds it, before it's tagged with the screen it came from. */
export type Untagged<T> = T extends unknown ? Omit<T, 'device'> : never;

const MAX_JOB = 99;
const MAX_STATION = 60;

/** A request body as a report, or null if it isn't one. */
export function parseTryReport(body: unknown): TryReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const device = DEVICES.find((d) => d === b['device']);
  const tag = (r: Untagged<TryReport>): TryReport => (device ? { ...r, device } : r) as TryReport;
  if (b['kind'] === 'grapple') {
    const use = USES.find((u) => u === b['use']);
    return use ? tag({ kind: 'grapple', use }) : null;
  }
  if (b['kind'] === 'train') {
    const course = COURSES.find((c) => c === b['course']);
    const event = TRAIN_EVENTS.find((e) => e === b['event']);
    if (!course || !event) return null;
    if (event === 'done') return tag({ kind: 'train', course, event });
    const station = b['station'];
    if (typeof station !== 'number' || !Number.isInteger(station) || station < 1 || station > MAX_STATION) return null;
    return tag({ kind: 'train', course, event, station });
  }
  if (b['kind'] === 'story') {
    if (b['what'] === 'ending') {
      const ending = STORY_ENDINGS.find((e) => e === b['ending']);
      return ending && typeof b['skipped'] === 'boolean' ? tag({ kind: 'story', what: 'ending', ending, skipped: b['skipped'] }) : null;
    }
    const sj = b['job'];
    const sn = b['n'];
    if (b['what'] !== 'memory' || typeof sj !== 'number' || !Number.isInteger(sj) || sj < 1 || sj > MAX_JOB) return null;
    if (typeof sn !== 'number' || !Number.isInteger(sn) || sn < 1 || sn > 9) return null;
    return tag({ kind: 'story', what: 'memory', job: sj, n: sn });
  }
  const job = b['job'];
  if (typeof job !== 'number' || !Number.isInteger(job) || job < 1 || job > MAX_JOB) return null;
  const daily = b['daily'] === true;
  if (b['kind'] === 'feel') {
    const feel = FEELS.find((f) => f === b['feel']);
    return feel ? tag({ kind: 'feel', job, daily, feel }) : null;
  }
  if (b['kind'] === 'letter') {
    const event = LETTER_EVENTS.find((e) => e === b['event']);
    if (!event) return null;
    const read = READS.find((r) => r === b['read']);
    return tag({ kind: 'letter', job, daily, event, ...(read && event !== 'shown' ? { read } : {}) });
  }
  if (b['kind'] !== 'try' || typeof b['cleared'] !== 'boolean') return null;
  if (b['cleared']) return tag({ kind: 'try', job, daily, cleared: true });
  const cause = CAUSES.find((c) => c === b['cause']) ?? 'other';
  return tag({ kind: 'try', job, daily, cleared: false, cause });
}

/** The counters a report adds one to, in the one hash: the totals, and the same again under its screen when it said which. */
export function fieldsFor(r: TryReport): string[] {
  const fields = ((): string[] => {
    if (r.kind === 'grapple') return [`grapple:${r.use}`];
    if (r.kind === 'story') return [r.what === 'memory' ? `story:memory:j${r.job}:${r.n}` : `story:ending:${r.ending}`, ...(r.what === 'ending' ? [`story:ending:${r.skipped ? 'skipped' : 'watched'}`] : [])];
    if (r.kind === 'letter') {
      const at = `letter:${r.daily ? 'd' : 'j'}${r.job}`;
      return [`${at}:${r.event}`, ...(r.read ? [`${at}:read:${r.read}`] : [])];
    }
    if (r.kind === 'train') return [r.event === 'done' ? `train:${r.course}:done` : `train:${r.course}:s${r.station}:${r.event}`];
    const at = `${r.daily ? 'd' : 'j'}${r.job}`;
    if (r.kind === 'feel') return [`${at}:feel:${r.feel}`];
    return r.cleared ? [`${at}:cleared`] : [`${at}:caught`, `${at}:cause:${r.cause ?? 'other'}`, `cause:${r.cause ?? 'other'}`];
  })();
  return r.device ? [...fields, ...fields.map((f) => `${r.device}:${f}`)] : fields;
}

/**
 * Where players get to in training, for the moderator's stats: how many reached each station (so the drop between two
 * is who left there), which stations restarted people most, and how many finished. Only the basics course, the one
 * everybody is sent to first; empty until someone has played it.
 */
export function trainingLine(hash: Record<string, string>): string {
  const n = (k: string): number => parseInt(hash[k] ?? '0', 10) || 0;
  const stations = new Set<number>();
  for (const k of Object.keys(hash)) {
    const m = /^train:basics:s(\d+):(reach|fail)$/.exec(k);
    if (m) stations.add(Number(m[1]));
  }
  if (stations.size === 0) return '';
  const last = Math.max(...stations);
  const reached: string[] = [];
  for (let s = 1; s <= last; s++) reached.push(`${s}:${n(`train:basics:s${s}:reach`)}`);
  const fails = [...stations]
    .map((s) => ({ s, v: n(`train:basics:s${s}:fail`) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 4)
    .map((x) => `${x.s}:${x.v}`);
  const by = (d: Device): string => {
    const started = n(`${d}:train:basics:s1:reach`);
    return started > 0 ? `${d} ${n(`${d}:train:basics:done`)}/${started}` : '';
  };
  const screens = DEVICES.map(by).filter(Boolean);
  const parts = [`Training reached (station:agents) ${reached.join(' ')}`, `finished ${n('train:basics:done')}`];
  if (fails.length) parts.push(`most restarts (station:times) ${fails.join(' ')}`);
  if (screens.length) parts.push(`finished/started ${screens.join(' · ')}`);
  return parts.join(' · ');
}

/**
 * Whether the story is being read, for the moderator's stats: per ladder job, how many letters were opened, how many were
 * accepted, and how many of those were skimmed (open under 3 seconds); how many cards were seen; and how the final choices went.
 * Empty until there's something to say.
 */
export function storyLine(hash: Record<string, string>): string {
  const n = (k: string): number => parseInt(hash[k] ?? '0', 10) || 0;
  const jobs = new Set<number>();
  let cards = 0;
  for (const k of Object.keys(hash)) {
    const m = /^letter:j(\d+):shown$/.exec(k);
    if (m) jobs.add(Number(m[1]));
    if (/^story:memory:j\d+:\d+$/.test(k)) cards += n(k);
  }
  const letters = [...jobs]
    .sort((a, b) => a - b)
    .slice(0, 8)
    .map((j) => {
      const at = `letter:j${j}`;
      return `J${j} ${n(`${at}:shown`)} opened ${n(`${at}:accept`)} accepted ${n(`${at}:read:fast`)} skimmed`;
    });
  const parts: string[] = [];
  if (letters.length) parts.push(`Letters: ${letters.join(' · ')}`);
  if (cards > 0) parts.push(`Cards seen ${cards}`);
  const ends = n('story:ending:public') + n('story:ending:private');
  if (ends > 0) parts.push(`Choices: ${n('story:ending:public')} public · ${n('story:ending:private')} private (${n('story:ending:skipped')} skipped the film)`);
  return parts.join(' · ');
}

/** The moderator's read on difficulty, short enough for a toast: clears per try by job, what ends tries, how it felt. */
export function triesToast(hash: Record<string, string>): string {
  const n = (k: string): number => parseInt(hash[k] ?? '0', 10) || 0;
  const jobs = new Set<number>();
  for (const k of Object.keys(hash)) {
    const m = /^j(\d+):(cleared|caught)$/.exec(k);
    if (m) jobs.add(Number(m[1]));
  }
  const ladder = [...jobs]
    .sort((a, b) => a - b)
    .slice(0, 8)
    .map((j) => `J${j} ${n(`j${j}:cleared`)}/${n(`j${j}:cleared`) + n(`j${j}:caught`)}`);
  const causes = CAUSES.map((c) => ({ c, v: n(`cause:${c}`) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 4)
    .map((x) => `${x.c} ${x.v}`);
  let feel = { easy: 0, right: 0, hard: 0 };
  let daily = { cleared: 0, tries: 0 };
  for (const k of Object.keys(hash)) {
    const f = /^[jd]\d+:feel:(easy|right|hard)$/.exec(k);
    if (f) feel = { ...feel, [f[1]!]: feel[f[1] as Feel] + n(k) };
    const d = /^d\d+:(cleared|caught)$/.exec(k);
    if (d) daily = { cleared: daily.cleared + (d[1] === 'cleared' ? n(k) : 0), tries: daily.tries + n(k) };
  }
  const parts: string[] = [];
  parts.push(ladder.length ? `Cleared/tries: ${ladder.join(' · ')}` : 'No tries yet');
  if (causes.length) parts.push(`Ended by: ${causes.join(' · ')}`);
  if (feel.easy + feel.right + feel.hard > 0) parts.push(`Felt: ${feel.easy} easy · ${feel.right} right · ${feel.hard} hard`);
  if (daily.tries > 0) parts.push(`Daily: ${daily.cleared}/${daily.tries}`);
  const used = USES.map((u) => ({ u, v: n(`grapple:${u}`) })).filter((x) => x.v > 0);
  if (used.length) parts.push(`Grapple: ${used.map((x) => `${x.u} ${x.v}`).join(' · ')}`);
  // By screen: tries and clears (ladder and daily), who said hard, and who used the grapple.
  const screens = DEVICES.map((d) => {
    let tries = 0;
    let cleared = 0;
    let hard = 0;
    for (const k of Object.keys(hash)) {
      if (!k.startsWith(`${d}:`)) continue;
      if (/^[a-z]+:[jd]\d+:(cleared|caught)$/.test(k)) tries += n(k);
      if (/^[a-z]+:[jd]\d+:cleared$/.test(k)) cleared += n(k);
      if (/^[a-z]+:[jd]\d+:feel:hard$/.test(k)) hard += n(k);
    }
    const hooks = n(`${d}:grapple:hook`);
    return { d, tries, cleared, hard, hooks };
  }).filter((x) => x.tries + x.hooks > 0);
  if (screens.length) parts.push(screens.map((x) => `${x.d}: ${x.tries} tries, ${x.cleared} cleared, ${x.hard} hard, ${x.hooks} hooks`).join(' · '));
  return `${parts.join('. ')}.`;
}
