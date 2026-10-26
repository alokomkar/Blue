// The Heist Director page: a request in words, the server's streamed rounds (the AI's level, the checker's problems, the
// AI's fix), and a button that plays the level that passed. The server is api/ai/director.ts; the pure parts are in directorlib.ts.
import { describeSpec, failureLines, parseSse, playUrl, reasonText, type DirectorEvent } from './directorlib';
import type { LevelSpec } from '../shared/levelspec';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const promptEl = $<HTMLTextAreaElement>('prompt');
const seedEl = $<HTMLInputElement>('seed');
const goBtn = $<HTMLButtonElement>('go');
const stopBtn = $<HTMLButtonElement>('stop');
const statusEl = $('status');
const roundsEl = $('rounds');
const resultEl = $('result');
const offlineEl = $('offline');
const readyEl = $('ready');

const EXAMPLES = [
  'A night job at a museum: two guards, one dog, steal a painting from the vault.',
  'Quiet refinery sabotage, no dogs, small floor.',
  'A big bank job with many guards and lasers everywhere.',
  'Extract a sample from a lab, two guards, no dogs.',
];

function store(get: boolean, key: string, value?: string): string | null {
  try {
    if (get) return window.localStorage.getItem(key);
    window.localStorage.setItem(key, value ?? '');
  } catch {
    // storage unavailable
  }
  return null;
}

// theme
const root = document.documentElement;
const savedTheme = store(true, 'director-theme');
if (savedTheme === 'light' || savedTheme === 'dark') root.setAttribute('data-theme', savedTheme);
$('theme').addEventListener('click', () => {
  const cur = root.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  store(false, 'director-theme', next);
});

// examples
const examplesEl = $('examples');
for (const text of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text.length > 44 ? `${text.slice(0, 42)}…` : text;
  b.title = text;
  b.addEventListener('click', () => {
    promptEl.value = text;
    promptEl.focus();
  });
  examplesEl.appendChild(b);
}
promptEl.value = store(true, 'director-prompt') ?? '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderResult(spec: LevelSpec, info: { rounds: number; usedFallback: boolean; reason?: string }): void {
  resultEl.replaceChildren();
  resultEl.hidden = false;
  resultEl.classList.toggle('fallback', info.usedFallback);
  const h = el('h2', undefined, spec.title);
  h.appendChild(el('span', `pill ${info.usedFallback ? '' : 'ok'}`, info.usedFallback ? 'ready-made level' : `passed the checker in ${info.rounds} ${info.rounds === 1 ? 'round' : 'rounds'}`));
  resultEl.appendChild(h);
  if (info.usedFallback) resultEl.appendChild(el('p', 'banner', `${reasonText(info.reason)} Here is the closest ready-made level.`));
  resultEl.appendChild(el('p', 'brief', spec.brief));
  const ul = el('ul');
  for (const line of describeSpec(spec)) ul.appendChild(el('li', undefined, line));
  resultEl.appendChild(ul);
  const actions = el('div', 'actions');
  const play = el('a', 'primary', 'Play this level');
  play.href = playUrl(spec);
  play.target = '_blank';
  play.rel = 'noopener';
  const coop = el('a', undefined, 'Play with the AI partner');
  coop.href = playUrl(spec, { coop: true });
  coop.target = '_blank';
  coop.rel = 'noopener';
  actions.append(play, coop);
  resultEl.appendChild(actions);
  const details = el('details');
  details.appendChild(el('summary', undefined, 'Show the level as data'));
  details.appendChild(el('pre', undefined, JSON.stringify(spec, null, 2)));
  resultEl.appendChild(details);
  resultEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

type RoundView = { li: HTMLLIElement; what: HTMLElement; pill: HTMLElement; extra: HTMLElement };
const views = new Map<number, RoundView>();

function roundView(n: number): RoundView {
  let v = views.get(n);
  if (!v) {
    const li = el('li', 'round');
    const head = el('h3', undefined, `Round ${n}`);
    const pill = el('span', 'pill work', 'the AI is designing…');
    head.appendChild(pill);
    const what = el('p', 'what');
    const extra = el('div');
    li.append(head, what, extra);
    roundsEl.appendChild(li);
    v = { li, what, pill, extra };
    views.set(n, v);
  }
  return v;
}

function onEvent(e: DirectorEvent): void {
  if (e.type === 'round') {
    roundView(e.n);
    statusEl.textContent = e.n === 1 ? 'The AI is designing a level…' : `Round ${e.n}: the AI is fixing what the checker found…`;
  } else if (e.type === 'spec') {
    const v = roundView(e.n);
    v.what.textContent = `${e.spec.title}: ${describeSpec(e.spec)[0]}`;
    v.pill.className = 'pill work';
    v.pill.textContent = 'the checker is testing it…';
    if (e.changes.length) v.extra.appendChild(el('p', 'changes', `Adjusted to the game's limits: ${e.changes.join('; ')}`));
    statusEl.textContent = 'The checker is trying to break it…';
  } else if (e.type === 'verify') {
    const v = roundView(e.n);
    v.pill.className = `pill ${e.ok ? 'ok' : 'bad'}`;
    v.pill.textContent = e.ok ? 'passed the checker' : 'the checker found problems';
    if (!e.ok) {
      const ul = el('ul');
      for (const line of failureLines(e.failures)) ul.appendChild(el('li', undefined, line));
      v.extra.appendChild(ul);
    }
  } else if (e.type === 'done') {
    statusEl.textContent = e.usedFallback ? 'The Director could not make its own level this time.' : 'The level passed. Play it.';
    renderResult(e.spec, e);
  } else {
    statusEl.textContent = 'Something went wrong on the server.';
    void showReady();
  }
}

let ready: Record<string, LevelSpec> | null = null;
async function showReady(): Promise<void> {
  offlineEl.hidden = false;
  if (readyEl.childElementCount) return;
  try {
    ready ??= (await (await fetch('fallback/director/levels.json')).json()) as Record<string, LevelSpec>;
  } catch {
    readyEl.textContent = 'The ready-made levels could not be loaded either.';
    return;
  }
  for (const spec of Object.values(ready)) {
    const a = el('a');
    a.href = playUrl(spec);
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(el('b', undefined, spec.title), el('span', undefined, spec.brief));
    readyEl.appendChild(a);
  }
}

let controller: AbortController | null = null;

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  void build();
});
stopBtn.addEventListener('click', () => controller?.abort());

async function build(): Promise<void> {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    statusEl.textContent = 'Describe the job first.';
    promptEl.focus();
    return;
  }
  store(false, 'director-prompt', prompt);
  const body: { prompt: string; seed?: number } = { prompt };
  if (seedEl.value !== '') {
    const seed = Number(seedEl.value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      statusEl.textContent = 'The seed must be a whole number from 0 to 4294967295.';
      return;
    }
    body.seed = seed;
  }
  roundsEl.replaceChildren();
  views.clear();
  resultEl.hidden = true;
  offlineEl.hidden = true;
  goBtn.disabled = true;
  stopBtn.hidden = false;
  statusEl.textContent = 'Connecting…';
  controller = new AbortController();
  try {
    const res = await fetch('/api/ai/director', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok || !res.body) {
      statusEl.textContent = res.status === 429 ? 'Too many requests: wait a moment and try again.' : res.status === 413 || res.status === 400 ? 'That request could not be used. Try fewer words.' : 'The Director is not available right now.';
      if (res.status !== 429 && res.status !== 400 && res.status !== 413) await showReady();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) onEvent(e);
    }
    if (resultEl.hidden) {
      statusEl.textContent = 'The Director stopped before finishing.';
      await showReady();
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') statusEl.textContent = 'Stopped.';
    else {
      statusEl.textContent = 'Could not reach the Director.';
      await showReady();
    }
  } finally {
    goBtn.disabled = false;
    stopBtn.hidden = true;
    controller = null;
  }
}
