import { ApiError } from "./client";

/** Section 31 Part 2: does this error mean the venue-setup wizard's saved draft points at
 * something that no longer exists (or was never this user's)?
 *
 * The wizard remembers the venue and court ids it created (`createdVenueId` /
 * `createdCourtIds`) so a retry doesn't duplicate them. Those ids go stale when the venue is
 * deleted server-side, when a tab sits open across days, or when a browser's localStorage still
 * holds a previous account's draft. Every later call in the submit loop then fails with:
 *   - 404 VENUE_NOT_FOUND  (POST /venues/{id}/courts, venue row is gone)
 *   - 404 NOT_FOUND        (POST /courts/{id}/schedule|pricing, court row is gone -- courts
 *                           cascade-delete with their venue)
 *   - 403 NOT_VENUE_OWNER  (the draft's venue belongs to another account)
 *
 * Only call this for a failure of a call that USED an id read from the saved draft. A 404 on an
 * id the same run just created is a different problem and must not wipe the draft. A genuine
 * network failure (`REQUEST_TIMEOUT`, no status) never matches. */
export function isStaleVenueDraftError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === "VENUE_NOT_FOUND" || e.code === "NOT_VENUE_OWNER") return true;
  return e.status === 404 && e.code === "NOT_FOUND";
}
