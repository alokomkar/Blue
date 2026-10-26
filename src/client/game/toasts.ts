// The toast queue: the line-by-line news at the bottom of the screen, kept from piling up. A job opens with half a dozen notices (the guide, tonight's target,
// what carried in, what's new, the contract, a side goal, a twist), and on a phone they used to stack until they covered the screen. Now only a few show at a
// time (fewer on a small screen), the rest wait their turn and are shown a little shorter when there's a backlog, the same notice is never up twice, a warning
// (a red toast) jumps the queue by pushing the oldest ordinary one off, and a tap clears the lot. Pure, so it's unit-tested under Node.

export type ToastKind = 'good' | 'bad' | 'neutral';

export type ToastItem = { id: number; text: string; kind: ToastKind; ms: number };

export type ToastState = {
  shown: ToastItem[];
  queue: ToastItem[];
  nextId: number;
};

export const EMPTY_TOASTS: ToastState = { shown: [], queue: [], nextId: 1 };

/** How many are up at once: one on a phone held sideways (the view is the whole screen's height), two upright on a phone, three elsewhere. */
export const visibleCap = (compact: boolean, sideways = false): number => (sideways ? 1 : compact ? 2 : 3);

/** How many can wait their turn; past that the oldest waiting one is dropped. */
export const MAX_QUEUE = 5;

/** A notice that was waiting is shown no longer than this when more are behind it, so a backlog drains. */
export const BACKLOG_MS = 3400;

export type ToastChange = {
  state: ToastState;
  /** Toasts that are now on screen and need a timer. */
  show: ToastItem[];
  /** Toasts that came off the screen at once (pushed off, or dismissed). */
  hide: ToastItem[];
};

const same = (state: ToastState, text: string): boolean => state.shown.some((t) => t.text === text) || state.queue.some((t) => t.text === text);

/** A new notice: shown now if there is room, pushed in ahead if it is a warning, or put in line. The same words twice change nothing. */
export function pushToast(state: ToastState, text: string, kind: ToastKind, ms: number, cap: number): ToastChange {
  if (same(state, text)) return { state, show: [], hide: [] };
  const item: ToastItem = { id: state.nextId, text, kind, ms };
  const next: ToastState = { ...state, nextId: state.nextId + 1 };
  if (state.shown.length < cap) return { state: { ...next, shown: [...state.shown, item] }, show: [item], hide: [] };
  if (kind === 'bad') {
    // Make room: the oldest that isn't a warning goes (else the oldest of all).
    const out = state.shown.find((t) => t.kind !== 'bad') ?? state.shown[0]!;
    return { state: { ...next, shown: [...state.shown.filter((t) => t !== out), item] }, show: [item], hide: [out] };
  }
  const queue = [...state.queue, item].slice(-MAX_QUEUE);
  return { state: { ...next, queue }, show: [], hide: [] };
}

/** A toast ran its time (or was cleared): the next in line takes the place, shorter if there are more behind it. */
export function expireToast(state: ToastState, id: number, cap: number): ToastChange {
  const shown = state.shown.filter((t) => t.id !== id);
  const show: ToastItem[] = [];
  let queue = state.queue;
  while (shown.length + show.length < cap && queue.length > 0) {
    const [head, ...rest] = queue;
    const promoted = rest.length > 0 ? { ...head!, ms: Math.min(head!.ms, BACKLOG_MS) } : head!;
    show.push(promoted);
    queue = rest;
  }
  return { state: { ...state, shown: [...shown, ...show], queue }, show, hide: [] };
}

/** A tap: everything on screen goes, and everything waiting with it. */
export function clearToasts(state: ToastState): ToastChange {
  return { state: { ...state, shown: [], queue: [] }, show: [], hide: state.shown };
}

// ---- the inbox: on a phone the notices are kept, not shown ----
//
// A phone's screen is too small for text to float over the view, so a notice there goes into an inbox behind a bell in the top bar, and the bell counts what is new. Only a
// warning (a red notice) still flashes up, briefly, as well. Newest first, a notice that repeats the newest is not added again, and only so many are kept.

export type InboxItem = { id: number; text: string; kind: ToastKind; /** When it came (any steady clock, in milliseconds). */ at: number; read: boolean };

export type Inbox = { items: InboxItem[]; nextId: number };

export const EMPTY_INBOX: Inbox = { items: [], nextId: 1 };

/** How many notices the inbox keeps. */
export const INBOX_MAX = 40;

/** A notice arrives. A repeat of the newest one changes nothing. */
export function addToInbox(inbox: Inbox, text: string, kind: ToastKind, at: number): Inbox {
  if (inbox.items[0]?.text === text) return inbox;
  const item: InboxItem = { id: inbox.nextId, text, kind, at, read: false };
  return { items: [item, ...inbox.items].slice(0, INBOX_MAX), nextId: inbox.nextId + 1 };
}

/** How many have not been read. */
export const unreadCount = (inbox: Inbox): number => inbox.items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

/** The inbox was opened: everything in it has been seen. */
export function markAllRead(inbox: Inbox): Inbox {
  return unreadCount(inbox) === 0 ? inbox : { ...inbox, items: inbox.items.map((i) => (i.read ? i : { ...i, read: true })) };
}

/** How long ago, in a word or two: "now", "12 s", "3 min". */
export function ageLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min`;
}
