// Suspicion state — trimmed from blueprint/src/index.html's repeated
// suspicion-cap pattern (`if (state.suspicion >= 100) { onCaught(); ... }`,
// e.g. :4824, :5044, :5096) and onCaught() (:5669: job ends, show result).
// Dropped: secondwind buy-back and Fence Marks (both deferred systems) —
// v1's "caught" is just the job ending and offering a retry.

export function applySuspicion(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

export function isCaught(suspicion: number): boolean {
  return suspicion >= 100;
}
