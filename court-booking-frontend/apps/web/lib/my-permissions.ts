/** Stage 2 (B.b): pure helper behind useMyPermissions (no React, unit-tested in lib/my-permissions.test.ts). */
import type { MyPermissions } from "@court-booking/types";

/** Staff permission keys (backend app/models/staff.py StaffPermission) the owner screens act on. */
export type StaffPermission = "approve_payments" | "record_payments" | "check_in" | "mark_refunds" | "cancel_booking" | "view_ledger" | "edit_court_settings";

/** What each button needs. Completion (Haan / Nahi) = record_payments; manual no-show = check_in (the backend checks the same). */
export const ACTION_PERMISSION = {
  approve: "approve_payments",
  reject: "approve_payments",
  acknowledge: "approve_payments",
  refunds: "mark_refunds",
  completion: "record_payments",
  noShow: "check_in",
  /** Venue / court settings incl. the Stage 2 timers card (backend key edit_court_settings; no separate venue-settings key exists). */
  venueSettings: "edit_court_settings",
} as const satisfies Record<string, StaffPermission>;

/**
 * May this account do `key` at `venueId`?
 * - owner / admin: always (the server answers 403 for anything else; the existing fallback still shows it).
 * - staff: only when the venue's list has the key. While the list is loading the answer is "no" (hide first, then show), but
 *   when the call FAILED (an older backend without /owners/me/permissions) the answer is "yes" and the 403 fallback decides.
 */
export function permissionAllows(
  role: string | undefined,
  data: MyPermissions | undefined,
  status: "pending" | "error" | "success",
  venueId: string | undefined,
  key: StaffPermission,
): boolean {
  if (role !== "staff") return true;
  if (status === "error") return true;
  if (status === "pending" || !data) return false;
  if (data.role !== "staff") return true;
  const entry = venueId ? data.venue_permissions.find((v) => v.venue_id === venueId) : undefined;
  if (!entry) return false;
  return entry.permissions.includes(key);
}
