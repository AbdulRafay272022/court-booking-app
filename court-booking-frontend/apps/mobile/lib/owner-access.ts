import type { StaffPermissionKey } from "@court-booking/types";

/** Which staff permission each owner tab and "Aur" entry needs, mirroring what the backend enforces
 * (`require_owned_venue(..., permission=...)` / `resolve_owner_context(..., key)`):
 * - Overview, the approvals queue, the ledger and bookings history all read through `view_ledger`.
 * - Refunds need `mark_refunds`; a walk-in `walkin`; check-in `check_in`; replying to reviews `respond_reviews`.
 * - Venue settings open with `edit_court_settings` (courts, pricing, timers) or `manage_photos`; `view_ledger` staff may
 *   READ them (the timers card turns into a read-only summary, Stage 2), so that key opens the screen too.
 * - Growth needs `view_growth` (`owners.py` resolve_owner_context(..., "view_growth")).
 * Owners and admins may do everything; `can` comes from useMyPermissions (unknown counts as allowed, the server's 403 stays
 * the fallback). */
export type OwnerTabKey = "overview" | "approvals" | "refunds" | "ledger" | "more";

export const OWNER_TABS: { key: OwnerTabKey; route: "today" | "approvals" | "refunds" | "ledger" | "more"; label: string }[] = [
  { key: "overview", route: "today", label: "Overview" },
  { key: "approvals", route: "approvals", label: "Approvals" },
  { key: "refunds", route: "refunds", label: "Refunds" },
  { key: "ledger", route: "ledger", label: "Ledger" },
  { key: "more", route: "more", label: "Aur" },
];

const TAB_NEEDS: Record<OwnerTabKey, StaffPermissionKey[]> = {
  overview: ["view_ledger"],
  approvals: ["view_ledger"],
  refunds: ["mark_refunds"],
  ledger: ["view_ledger"],
  more: [],
};

export type MoreItemKey = "history" | "walkin" | "checkin" | "growth" | "reviews" | "venueSettings";

/** `"owner"` = only the venue owner (no staff key grants it). An empty list = anyone on the owner side. */
const MORE_NEEDS: Record<MoreItemKey, StaffPermissionKey[] | "owner"> = {
  history: ["view_ledger"],
  walkin: ["walkin"],
  checkin: ["check_in"],
  growth: ["view_growth"],
  reviews: ["respond_reviews"],
  venueSettings: ["edit_court_settings", "manage_photos", "view_ledger"],
};

type Can = (key: StaffPermissionKey) => boolean;

function anyOf(needs: StaffPermissionKey[], can: Can): boolean {
  return needs.length === 0 || needs.some((k) => can(k));
}

export function tabAllowed(tab: OwnerTabKey, can: Can): boolean {
  return anyOf(TAB_NEEDS[tab], can);
}

export function visibleOwnerTabs(can: Can): OwnerTabKey[] {
  return OWNER_TABS.filter((t) => tabAllowed(t.key, can)).map((t) => t.key);
}

/** Where a staff member lands after login: the first tab they may open ("Aur" is always allowed). */
export function firstAllowedTabRoute(can: Can): (typeof OWNER_TABS)[number]["route"] {
  return OWNER_TABS.find((t) => tabAllowed(t.key, can))?.route ?? "more";
}

export function moreItemAllowed(item: MoreItemKey, can: Can, isStaff: boolean): boolean {
  const needs = MORE_NEEDS[item];
  if (needs === "owner") return !isStaff;
  return !isStaff || anyOf(needs, can);
}
