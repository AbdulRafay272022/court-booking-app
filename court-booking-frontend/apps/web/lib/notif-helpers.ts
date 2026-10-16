/** Pure helpers behind the notification bell (no React, no storage), unit-tested in notif-helpers.test.ts. */

export interface LogEntry {
  id: string;
  channel: string;
  event_type: string;
  status: string;
  reference_id: string | null;
  created_at: string;
}

export type NotifRole = "player" | "owner" | "staff" | "admin";

const DEDUPE_WINDOW_MS = 5 * 60_000;
/** With no read marker yet, only the last day counts as unread (a new browser must not show 30 old items as new). */
export const FIRST_VISIT_UNREAD_MS = 24 * 3600_000;

export function ms(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** The log has one row per CHANNEL (push + WhatsApp for the same event): fold rows of the same event_type and
 * reference that happened within five minutes into one item (the newest row represents it). Newest first. */
export function dedupeEntries(entries: readonly LogEntry[]): LogEntry[] {
  const sorted = [...entries].sort((a, b) => ms(b.created_at) - ms(a.created_at));
  const out: LogEntry[] = [];
  for (const e of sorted) {
    const dup = out.find(
      (o) => o.event_type === e.event_type && (o.reference_id ?? "") === (e.reference_id ?? "") && Math.abs(ms(o.created_at) - ms(e.created_at)) <= DEDUPE_WINDOW_MS,
    );
    if (!dup) out.push(e);
  }
  return out;
}

/** The read marker to compare against: the stored one, else "24 hours ago". */
export function effectiveReadAt(stored: string | null, nowMs: number): number {
  const n = stored === null ? NaN : Number(stored);
  return Number.isFinite(n) && n > 0 ? n : nowMs - FIRST_VISIT_UNREAD_MS;
}

export function unreadCount(items: readonly LogEntry[], readAt: number): number {
  return items.filter((e) => ms(e.created_at) > readAt).length;
}

export function newestMs(items: readonly LogEntry[]): number {
  return items.reduce((m, e) => Math.max(m, ms(e.created_at)), 0);
}

/** Items that arrived after the previous poll. `previousNewest` null = the very first load: nothing is "new" then (no popups on page load). */
export function newArrivals(items: readonly LogEntry[], previousNewest: number | null): LogEntry[] {
  if (previousNewest === null) return [];
  return items.filter((e) => ms(e.created_at) > previousNewest);
}

const EVENT_ALIASES: Record<string, string> = {
  payment_submitted_owner: "payment_submitted",
  payment_submitted_whatsapp: "payment_submitted",
  payment_submitted_sms: "payment_submitted",
};

/** Events the dictionaries have a title for (`notif.event.<name>`). */
export const KNOWN_EVENTS = [
  "payment_submitted",
  "booking_confirmed",
  "booking_cancelled",
  "booking_reminder",
  "payment_rejected",
  "refund_owed",
  "refund_paid",
  "slot_reopened",
  "court_deactivated",
  "owner_daily_digest",
  "tournament_announcement",
  "venue_approved",
  "venue_changes_requested",
  "venue_rejected",
  "venue_pending_review",
] as const;

/** The translation key suffix for an event, or "generic" for one we do not know. */
export function eventSuffix(eventType: string): string {
  const e = EVENT_ALIASES[eventType] ?? eventType;
  return (KNOWN_EVENTS as readonly string[]).includes(e) ? e : "generic";
}

/** Where tapping a notification goes; null = no link (the row is plain text). */
export function routeForEvent(eventType: string, role: NotifRole): string | null {
  const e = EVENT_ALIASES[eventType] ?? eventType;
  const ownerSide = role === "owner" || role === "staff";
  switch (e) {
    case "payment_submitted":
      return ownerSide ? "/dashboard/owner/approvals" : null;
    case "refund_owed":
      return ownerSide ? "/dashboard/owner/refunds" : null;
    case "refund_paid":
      return ownerSide ? "/dashboard/owner/refunds" : role === "player" ? "/bookings" : null;
    case "booking_confirmed":
    case "booking_cancelled":
    case "booking_reminder":
    case "payment_rejected":
      return role === "player" ? "/bookings" : ownerSide ? "/dashboard/bookings" : null;
    case "slot_reopened":
      return role === "player" ? "/search" : null;
    case "owner_daily_digest":
    case "court_deactivated":
    case "venue_approved":
    case "venue_changes_requested":
    case "venue_rejected":
    case "venue_pending_review":
      return ownerSide ? "/dashboard/owner/today" : null;
    default:
      return null;
  }
}
