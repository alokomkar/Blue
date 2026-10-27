// Spoken orders for the AI partner (docs/DESIGN.md section 4). The page records a clip, /api/ai/transcribe turns it into words and the words into one
// PartnerOrder. Here: the order type and the JSON Schema the model is held to, a checker that turns any model JSON into a legal order, and the LOCAL FAST PATH,
// matchOrder, which recognises the obvious commands from the transcript alone so they cost only the transcription, not a second model call (docs/SPIKES.md:
// the straight pipeline is 4.2 to 4.5 s). Pure, so it is unit-tested under Node.

export const ORDER_IDS = ['hold', 'follow', 'cover_me', 'distract', 'take', 'wait_at_lift', 'regroup', 'none'] as const;
export type OrderId = (typeof ORDER_IDS)[number];

export const TARGET_IDS = ['nearest_guard', 'nearest_dog', 'next_guard', 'north', 'south', 'east', 'west'] as const;
export type TargetId = (typeof TARGET_IDS)[number];

/** The longest reply the partner gives (a subtitle line). */
export const SAY_MAX = 60;

export type PartnerOrder = {
  order: OrderId;
  target?: TargetId;
  /** The partner's one-line answer, at most SAY_MAX characters. */
  say: string;
};

/** The order grammar as a JSON Schema for the planner's structured output (docs/SPIKES.md: json_schema works on Spark). */
export const ORDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['order', 'say'],
  properties: {
    order: { type: 'string', enum: [...ORDER_IDS] },
    target: { type: 'string', enum: [...TARGET_IDS] },
    say: { type: 'string' },
  },
} as const;

/** What the partner says for each order when nobody wrote a line of their own (the fast path always uses these). */
export const DEFAULT_SAY: Readonly<Record<OrderId, string>> = {
  hold: 'Holding here',
  follow: 'On your six',
  cover_me: 'Covering you',
  distract: 'Making some noise',
  take: 'Taking the shot',
  wait_at_lift: 'Waiting at the lift',
  regroup: 'On my way',
  none: '',
};

const isOrderId = (v: unknown): v is OrderId => typeof v === 'string' && (ORDER_IDS as readonly string[]).includes(v);
const isTargetId = (v: unknown): v is TargetId => typeof v === 'string' && (TARGET_IDS as readonly string[]).includes(v);

/**
 * Model output (JSON text or an already-parsed value) as a legal order, or null when it is not one. An unknown target is dropped, a long or
 * missing line is cut or filled, so the game never has to doubt an order it is handed.
 */
export function parseOrder(raw: unknown): PartnerOrder | null {
  if (typeof raw === 'string') {
    try {
      return parseOrder(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { order, target, say } = raw as Record<string, unknown>;
  if (!isOrderId(order)) return null;
  let line = typeof say === 'string' ? say.replace(/\s+/g, ' ').trim() : '';
  if (line.length > SAY_MAX) line = `${line.slice(0, SAY_MAX - 1).trimEnd()}…`;
  if (line === '' && order !== 'none') line = DEFAULT_SAY[order];
  const out: PartnerOrder = { order, say: line };
  if (isTargetId(target) && (order === 'take' || order === 'distract')) out.target = target;
  return out;
}

// ---- The fast path ----

/** Words that mean nothing to an order: said before, between or after it. ('right' is not here: it is a direction.) */
const FILLER = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hm', 'hmm', 'okay', 'ok', 'alright', 'hey', 'yo', 'please', 'now', 'quickly', 'quick', 'just', 'thanks', 'thank', 'you', 'buddy', 'mate', 'partner', 'friend', 'then']);
/** The partner's name as a speech-to-text model hears it ("Agent B" comes out as "agent b", "agent bee", "agent be"). */
const NAME = /^(?:agent\s+(?:a|b|ay|eh|bee|be)|partner)\b\s*/;
/** "can you", "could you", "go ahead and": a polite lead-in to the order proper. */
const LEAD = /^(?:(?:can|could|would|will|shall)\s+you|go\s+ahead\s+and|i\s+need\s+you\s+to|i\s+want\s+you\s+to|you\s+need\s+to|you\s+should)\s+/;
/** Words that join two things. A sentence with one is compound or conditional: the model decides which step comes first. */
const JOINERS = /\b(and|then|after|before|while|when|once|until|unless|if|but|because|so\s+that|or)\b/;

/** A transcript as plain lowercase words: no punctuation, no apostrophes, single spaces. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Rule = { order: OrderId; target?: TargetId; phrases: readonly RegExp[] };

// Each phrase is matched against the WHOLE cleaned-up sentence: "cover me" is an order, "cover me while I hack" is not (the model reads that one).
const RULES: readonly Rule[] = [
  {
    order: 'cover_me',
    phrases: [/^cover(?: me| us| my back)?$/, /^give me cover$/, /^watch my (?:back|six)$/, /^(?:got|have) my (?:back|six)$/, /^help(?: me| us)?$/, /^need (?:cover|help)$/],
  },
  {
    order: 'follow',
    phrases: [/^follow(?: me| us)?$/, /^with me$/, /^come with me$/, /^stay with me$/, /^stick (?:with|to) me$/, /^keep up$/, /^on my six$/, /^come on$/, /^move out$/, /^go go go$/, /^lets go$/, /^let us go$/, /^go with me$/],
  },
  {
    order: 'hold',
    phrases: [/^hold(?: up| on| here| there| position| your position| tight)?$/, /^stay(?: here| there| put| back)?$/, /^stay where you are$/, /^wait(?: here| there| up| for me)?$/, /^hang back$/, /^stand by$/, /^freeze$/, /^stop$/, /^do not move$/, /^dont move$/],
  },
  {
    order: 'regroup',
    phrases: [/^regroup(?: on me| here| with me| on my position)?$/, /^come (?:here|back|to me|over)$/, /^get (?:over )?here$/, /^over here$/, /^to me$/, /^on me$/, /^back to me$/, /^come back to me$/, /^join me$/],
  },
  {
    order: 'wait_at_lift',
    phrases: [
      /^(?:wait|hold|stay|meet me|go|get|head) (?:at|by|in|to|for me at|near) the (?:lift|elevator|exit)$/,
      /^hold the (?:lift|elevator)$/,
      /^(?:go to|head to|get to) the (?:lift|elevator|exit)$/,
      /^wait for me at the (?:lift|elevator|exit)$/,
    ],
  },
  {
    order: 'take',
    target: 'nearest_guard',
    phrases: [
      /^take (?:him|them|that one|the guard|the shot|the shooter|out the guard|him out|them out)$/,
      /^take out (?:the|that) guard$/,
      /^take down (?:the|that) guard$/,
      /^(?:shoot|stun|engage|fire)$/,
      /^(?:shoot|stun|engage|fire on|get|drop|neutralise|neutralize) (?:him|them|the guard|that guard|that one)$/,
      /^take out (?:him|them)$/,
    ],
  },
  { order: 'take', target: 'nearest_dog', phrases: [/^(?:take|shoot|stun|get|drop|take out|take down) (?:the|that) dog$/, /^(?:take|shoot|stun) (?:the )?(?:alpha|watchdog)$/] },
  { order: 'take', target: 'next_guard', phrases: [/^(?:take|shoot|stun|get) (?:the )?next (?:guard|one)$/, /^next guard$/] },
  {
    order: 'distract',
    target: 'nearest_guard',
    phrases: [/^distract(?: him| them| the guard| that guard)?$/, /^(?:create|make) (?:a |some )?(?:distraction|noise)$/, /^draw (?:him|them|the guard) (?:off|away)$/, /^lure (?:him|them|the guard) (?:off|away)$/],
  },
];

/** The sentence with the courtesies taken off: the partner's name, fillers, "can you". Null when it is compound. */
function core(transcript: string): string | null {
  let s = normalise(transcript);
  if (s === '' || s.length > 60) return null;
  if (JOINERS.test(s)) return null;
  // The leading words come off one layer at a time: "okay agent b can you hold".
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(NAME, '').replace(LEAD, '');
    const first = s.split(' ')[0] ?? '';
    if (FILLER.has(first)) s = s.slice(first.length).trim();
    if (s === before) break;
  }
  // The trailing ones too ("hold please", "cover me now").
  for (let i = 0; i < 4; i++) {
    const words = s.split(' ');
    const last = words[words.length - 1] ?? '';
    if (words.length > 1 && FILLER.has(last)) s = words.slice(0, -1).join(' ');
    else break;
  }
  return s.trim() || null;
}

/**
 * The order in a transcript, when it is one of the obvious ones and nothing else: said whole ("cover me", "hold", "follow me", "regroup", "wait at the lift", "take the guard",
 * "distract"), with any amount of "um", "okay" and the partner's name around it. Conservative on purpose: a longer sentence ("I will hold the door"), a negation ("do not cover me"),
 * a compound ("take the guard and then hold") or a command with an object the table does not know ("take the guard on the left") returns null, and the model reads it.
 */
export function matchOrder(transcript: string): PartnerOrder | null {
  const s = core(transcript);
  if (s === null) return null;
  for (const rule of RULES) {
    if (rule.phrases.some((p) => p.test(s))) {
      const out: PartnerOrder = { order: rule.order, say: DEFAULT_SAY[rule.order] };
      if (rule.target) out.target = rule.target;
      return out;
    }
  }
  return null;
}

// ---- The endpoints' answers, as the page reads them ----

/** What /api/ai/transcribe answers (api/ai/transcribe.ts). */
export type VoiceReply = {
  transcript: string;
  order: PartnerOrder;
  source: 'fast' | 'model' | 'none';
  ms: { asr: number; order: number };
  note?: string;
};

/** The endpoint's JSON as a VoiceReply, or null when it is not one (an error body, a stub's 501, anything else). The order is re-checked, so the game never acts on one it cannot read. */
export function readVoiceReply(raw: unknown): VoiceReply | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.transcript !== 'string' || 'error' in r) return null;
  const order = parseOrder(r.order) ?? { order: 'none' as const, say: '' };
  const source = r.source === 'fast' || r.source === 'model' ? r.source : 'none';
  const ms = typeof r.ms === 'object' && r.ms !== null ? (r.ms as Record<string, unknown>) : {};
  const out: VoiceReply = {
    transcript: r.transcript.replace(/\s+/g, ' ').trim().slice(0, 200),
    order,
    source,
    ms: { asr: typeof ms.asr === 'number' ? ms.asr : 0, order: typeof ms.order === 'number' ? ms.order : 0 },
  };
  if (typeof r.note === 'string') out.note = r.note.slice(0, 40);
  return out;
}

/** A failed call as a line for the HUD: what happened, in the player's terms. `status` 0 is "never got an answer". */
export function voiceErrorText(status: number, code?: string): string {
  if (code === 'timeout' || status === 504) return 'THE VOICE LINK TIMED OUT · CARRY ON';
  if (status === 0) return 'COULD NOT REACH THE VOICE LINK · CARRY ON';
  if (code === 'no_key' || status === 503) return 'VOICE ORDERS ARE NOT SET UP HERE · CARRY ON';
  if (status === 429 || code === 'rate_limited') return 'TOO MANY ORDERS · WAIT A MOMENT';
  if (status === 413 || code === 'audio_too_long' || code === 'audio_too_large') return 'THAT CLIP WAS TOO LONG · KEEP IT SHORT';
  if (status === 404 || status === 501) return 'VOICE ORDERS ARE NOT AVAILABLE HERE · CARRY ON';
  return 'THE VOICE LINK FAILED · CARRY ON';
}
