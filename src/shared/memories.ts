// Collectible pages found in the files you capture. The original story's pages were removed, so none are defined: every lookup
// comes back empty and no card is ever shown. The functions are kept so callers (game.ts) keep working; add entries to
// MEMORIES to bring cards back. Pure, so it's unit-tested under Node.

/** Up to two pages for each job, in the order the captures turn them up. Empty. */
export const MEMORIES: Readonly<Record<number, readonly string[]>> = {};

/** How many pages there are in all. */
export const MEMORY_TOTAL = Object.values(MEMORIES).reduce((n, list) => n + list.length, 0);

/** A page's id, as it is kept: the job and its place in that job ("5.2"). */
export const memoryId = (job: number, n: number): string => `${job}.${n}`;

/** The text of page `n` (from 1) of job `job`, or null if there isn't one. */
export function memoryText(job: number, n: number): string | null {
  if (!Number.isInteger(job) || job < 1) return null;
  return MEMORIES[job]?.[n - 1] ?? null;
}

/** The pages kept (a JSON list of ids in storage), without any that aren't pages. */
export function parseSeen(raw: string | null): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return out;
    for (const id of list) {
      const [j, n] = typeof id === 'string' ? id.split('.').map(Number) : [];
      if (j !== undefined && n !== undefined && memoryText(j, n) !== null) out.add(memoryId(j, n));
    }
  } catch {
    // Not a list: nothing kept.
  }
  return out;
}

/** What a capture turns up: the page after `captures` captures this job, unless it has none or has been read already. */
export function nextMemory(job: number, captures: number, seen: ReadonlySet<string>): { id: string; n: number; text: string } | null {
  const text = memoryText(job, captures);
  const id = memoryId(job, captures);
  return text !== null && !seen.has(id) ? { id, n: captures, text } : null;
}

/** The pages kept, in job order. */
export function pagesOf(seen: ReadonlySet<string>): Array<{ job: number; n: number; text: string }> {
  const pages: Array<{ job: number; n: number; text: string }> = [];
  for (const job of Object.keys(MEMORIES).map(Number).sort((a, b) => a - b)) {
    for (let n = 1; n <= (MEMORIES[job]?.length ?? 0); n++) if (seen.has(memoryId(job, n))) pages.push({ job, n, text: memoryText(job, n)! });
  }
  return pages;
}
