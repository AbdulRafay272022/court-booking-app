/** Stage 2 (B.b): pure helper behind useMyPermissions (no React, unit-tested in lib/my-permissions.test.ts). */
import type { MyPermissions, StaffPermissionKey } from "@court-booking/types";

/** Staff permission keys (backend app/models/staff.py StaffPermission; one TS list in packages/types staff.ts). */
export type StaffPermission = StaffPermissionKey;

/** What each button needs. Completion (Haan / Nahi) = record_payments; manual no-show = check_in, and the backend ALSO accepts
 * record_payments for it, so the screens show "Nahi aaye" when either key is granted. */
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

/**
 * audit 2026-10-28 item 11: which staff key opens each owner dashboard page on WEB, mirroring the app (apps/mobile/lib/
 * owner-access.ts) and what the backend enforces. Any one key in the list is enough. `"owner"` = never for staff. A route not
 * listed (account, notifications) is open to everyone on the owner side.
 */
export const ROUTE_NEEDS: { prefix: string; needs: StaffPermission[] | "owner" }[] = [
  { prefix: "/dashboard/owner/today", needs: ["view_ledger"] },
  { prefix: "/dashboard/owner/approvals", needs: ["view_ledger", "approve_payments"] },
  { prefix: "/dashboard/owner/walkin", needs: ["walkin"] },
  { prefix: "/dashboard/bookings", needs: ["view_ledger"] },
  { prefix: "/dashboard/owner/ledger", needs: ["view_ledger"] },
  { prefix: "/dashboard/owner/bank-check", needs: ["view_ledger"] },
  { prefix: "/dashboard/owner/refunds", needs: ["mark_refunds"] },
  { prefix: "/dashboard/owner/checkin", needs: ["check_in"] },
  { prefix: "/dashboard/owner/growth", needs: ["view_growth"] },
  { prefix: "/dashboard/owner/reviews", needs: ["respond_reviews"] },
  { prefix: "/dashboard/owner/settings", needs: ["edit_court_settings", "manage_photos", "view_ledger"] },
  { prefix: "/dashboard/owner/staff", needs: "owner" },
  { prefix: "/dashboard/owner/staff-activity", needs: "owner" },
  { prefix: "/dashboard/owner/premium", needs: "owner" },
];

/** May a staff member open `pathname`? Owners / admins always may (`isStaff` false). */
export function routeAllowed(pathname: string, isStaff: boolean, can: (key: StaffPermission) => boolean): boolean {
  if (!isStaff) return true;
  const rule = ROUTE_NEEDS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return true;
  if (rule.needs === "owner") return false;
  return rule.needs.some((k) => can(k));
}
