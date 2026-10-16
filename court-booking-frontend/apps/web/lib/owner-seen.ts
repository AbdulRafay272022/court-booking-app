/** "Naya" tracking for the owner dashboard: when did this person last LOOK at the Approvals / Refunds page for this venue?
 * Kept only in this browser (localStorage), keyed by user id AND venue id so a shared computer never leaks one person's
 * (or venue's) history to another. No database. Pure helpers + thin storage wrappers, so the rules are unit-tested. */

export type SeenPage = "approvals" | "refunds";

/** How long a page must stay visible before it counts as "seen" (a refresh must not clear the highlight at once). */
export const SEEN_AFTER_MS = 3000;

export function seenKey(userId: string | undefined, venueId: string | undefined, page: SeenPage): string | null {
  if (!userId || !venueId) return null;
  return `khelo.seen.${userId}.${venueId}.${page}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function store(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Epoch ms of the last visit, or null for a first-ever visit (or unreadable storage). */
export function readSeen(key: string, storage: StorageLike | null = store()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeSeen(key: string, ms: number, storage: StorageLike | null = store()): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(Math.round(ms)));
  } catch {
    // private mode / quota: "naya" simply stays on, never an error
  }
}

/** A row is "naya" when it was created after the last visit. On a first-ever visit nothing is flagged (everything would be). */
export function isNaya(createdAt: string | null | undefined, since: number | null): boolean {
  if (since === null || !createdAt) return false;
  const ms = new Date(createdAt).getTime();
  return Number.isFinite(ms) && ms > since;
}

/** Count badge text: the real number up to the cap, then "99+" (the bell uses a cap of 9). Zero or less gives "". */
export function capCount(n: number, cap = 99): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > cap ? `${cap}+` : String(Math.floor(n));
}

// One snapshot of "last visit" per page visit: taken on first render and kept until the page unmounts, so the highlight
// survives the moment the timestamp is advanced (it is only advanced for the NEXT visit).
const snapshots = new Map<string, number | null>();

export function snapshotSeen(key: string): number | null {
  if (!snapshots.has(key)) snapshots.set(key, readSeen(key));
  return snapshots.get(key) ?? null;
}

export function releaseSnapshot(key: string): void {
  snapshots.delete(key);
}
