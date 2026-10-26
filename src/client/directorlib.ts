// The pure parts of the Director page (director.ts): reading the server-sent events, turning a level spec into plain
// sentences, and building the URL that plays it. Kept free of imports that run (only erased type imports) so it is
// unit-tested under Node.
import type { LevelSpec } from '../shared/levelspec';

export type Failure = { code: string; message: string; where?: { x: number; y: number; floor: number } };

export type DirectorEvent =
  | { type: 'round'; n: number; of: number }
  | { type: 'spec'; n: number; spec: LevelSpec; changes: string[] }
  | { type: 'verify'; n: number; ok: boolean; failures: Failure[] }
  | { type: 'done'; ok: true; spec: LevelSpec; rounds: number; usedFallback: boolean; reason?: string }
  | { type: 'error'; fallback?: boolean };

/**
 * The events in `buffer` (text received so far) and what is left over: a block ends at a blank line, so a block cut off by the
 * end of a chunk stays in `rest` until the next one completes it. Blocks that are not valid JSON are skipped.
 */
export function parseSse(buffer: string): { events: DirectorEvent[]; rest: string } {
  const events: DirectorEvent[] = [];
  let rest = buffer.replace(/\r\n/g, '\n');
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end < 0) break;
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const data = block.split('\n').find((l) => l.startsWith('data:'));
    if (!data) continue;
    try {
      const value = JSON.parse(data.slice(5)) as DirectorEvent;
      if (value && typeof value.type === 'string') events.push(value);
    } catch {
      // not an event we can read
    }
  }
  return { events, rest };
}

const PLACE_NAME: Record<string, string> = { campus: 'a campus', museum: 'a museum', refinery: 'a refinery', bank: 'a bank', warehouse: 'a warehouse', lab: 'a lab' };
const CONTRACT_WORDS: Record<string, string> = {
  records: 'photograph the records',
  sabotage: 'sabotage the plant',
  vault: 'open the vault',
  hit: 'take out a target',
  blackout: 'work through a blackout',
  extract: 'extract a sample',
  swap: 'swap the item',
  shipment: 'find the shipment',
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A level in a few plain sentences, for the card the page shows. */
export function describeSpec(spec: LevelSpec): string[] {
  const out: string[] = [];
  out.push(`${PLACE_NAME[spec.place] ?? spec.place}, ${spec.floors === 2 ? 'two floors' : 'one floor'}, ${spec.size.cols} by ${spec.size.rows} cells, ${spec.layout === 'maze' ? 'a maze' : `${spec.layout} layout`}`);
  out.push(`Job: ${CONTRACT_WORDS[spec.contract] ?? spec.contract}`);
  const r = spec.roster;
  const foes = [r.guards ? plural(r.guards, 'guard') : '', r.watchdogs ? plural(r.watchdogs, 'dog') : '', r.alphas ? plural(r.alphas, 'alpha dog') : '', r.drones ? plural(r.drones, 'drone') : '', r.crawlers ? plural(r.crawlers, 'crawler') : '', r.heavies ? plural(r.heavies, 'heavy') : ''].filter(Boolean);
  out.push(`Against: ${foes.length ? foes.join(', ') : 'no one'} on each floor`);
  const h = spec.hazards;
  const traps = [h.lasers ? plural(h.lasers, 'laser') : '', h.lines ? plural(h.lines, 'laser line') : '', h.gates ? plural(h.gates, 'laser gate') : '', h.sweepers ? plural(h.sweepers, 'sweeping laser') : '', h.sliders ? plural(h.sliders, 'laser curtain') : '', h.shutters ? plural(h.shutters, 'shutter') : '', h.doors ? plural(h.doors, 'locked door') : '', h.blackouts ? plural(h.blackouts, 'blackout') : ''].filter(Boolean);
  if (traps.length) out.push(`Hazards: ${traps.join(', ')}`);
  if (spec.twists.length) out.push(`Twist: ${spec.twists.join(', ')}`);
  return out;
}

/** The checker's problems as a plain list (its own messages), or one line when there are none. */
export function failureLines(failures: readonly Failure[]): string[] {
  return failures.map((f) => f.message || f.code);
}

/** Base64url (no padding) of `value` as UTF-8 JSON: the form `?spec=` reads (the same as game/specload.ts's encodeSpecParam). */
export function encodeSpec(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The address that plays `spec`, with the AI partner if asked. `base` is where game.html lives (the page's own folder). */
export function playUrl(spec: LevelSpec, opts: { coop?: boolean; base?: string } = {}): string {
  return `${opts.base ?? ''}game.html?spec=${encodeSpec(spec)}${opts.coop ? '&coop=ai' : ''}`;
}

/** Why the Director gave a ready-made level instead of its own, in a sentence. */
export function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'request_rejected':
      return "The model's filter would not take that request.";
    case 'rate_limited':
      return 'The model is busy right now.';
    case 'timeout':
      return 'The model took too long.';
    case 'no_key':
      return 'The server has no model key set.';
    case undefined:
      return 'It could not make a level that passed the checker.';
    default:
      return 'It could not make a level that passed the checker.';
  }
}
