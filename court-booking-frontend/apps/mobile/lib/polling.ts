import type { Query } from "@tanstack/react-query";

/** Section 12: the 15s polling on live screens must back off on repeated failures rather
 * than hammering a struggling connection every interval regardless of outcome, and resume
 * the normal interval as soon as a request succeeds. TanStack Query tracks
 * `fetchFailureCount` per query and resets it to 0 on the next successful fetch, so reading
 * it here is enough — no separate state to manage. */
export function pollInterval(query: Query<any, any, any, any>, baseMs: number, maxMs = 120_000): number {
  const failures = query.state.fetchFailureCount;
  return failures === 0 ? baseMs : Math.min(baseMs * 2 ** failures, maxMs);
}
