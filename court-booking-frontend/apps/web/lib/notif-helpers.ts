/** Pure helpers behind the notification bell (no React, no storage), unit-tested in notif-helpers.test.ts. */
import { pktDateString, type NotificationFeedItem, type NotificationKind } from "@court-booking/types";
import { historyHref } from "./queue-filter";

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

type Timed = { created_at: string };

export function unreadCount(items: readonly Timed[], readAt: number): number {
  return items.filter((e) => ms(e.created_at) > readAt).length;
}

export function newestMs(items: readonly Timed[]): number {
  return items.reduce((m, e) => Math.max(m, ms(e.created_at)), 0);
}

/** Items that arrived after the previous poll. `previousNewest` null = the very first load: nothing is "new" then (no popups on page load). */
export function newArrivals<T extends Timed>(items: readonly T[], previousNewest: number | null): T[] {
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

// ---- Round 2 (A6): the readable feed -------------------------------------------------------------------------------

const ownerSideRole = (role: NotifRole) => role === "owner" || role === "staff" || role === "admin";

/** Where tapping a feed item goes (null = plain text). Booking links open History on that booking's day with it highlighted. */
export function feedRoute(item: Pick<NotificationFeedItem, "link" | "params">, role: NotifRole): string | null {
  const owner = ownerSideRole(role);
  const link = item.link ?? { kind: "none" };
  switch (link.kind) {
    case "approvals":
      return owner ? "/dashboard/owner/approvals" : null;
    case "refunds":
      return owner ? "/dashboard/owner/refunds" : role === "player" ? "/bookings" : null;
    case "booking":
      if (!owner) return role === "player" ? "/bookings" : null;
      if (link.booking_id && item.params?.starts_at) return historyHref(link.booking_id, item.params.starts_at);
      return link.booking_id ? `/dashboard/bookings?booking=${encodeURIComponent(link.booking_id)}` : "/dashboard/bookings";
    case "bookings":
      return owner ? "/dashboard/bookings" : role === "player" ? "/bookings" : null;
    case "overview":
    case "venue_status":
      return owner ? "/dashboard/owner/today" : null;
    default:
      return null;
  }
}

const LEGACY_KIND: Record<string, NotificationKind> = {
  payment_submitted: "payment_waiting",
  late_payment_proof: "late_payment",
  payment_approved: "payment_approved",
  payment_rejected: "payment_rejected",
  refund_owed: "refund_owed",
  refund_paid: "refund_sent",
  slot_reopened: "slot_freed",
  owner_daily_digest: "daily_summary",
  venue_approved: "venue_approved",
  venue_rejected: "venue_rejected",
  venue_changes_requested: "venue_changes",
  booking_confirmed: "booking_confirmed",
  booking_cancelled: "booking_cancelled",
  booking_reminder: "booking_reminder",
};

function legacyLink(eventType: string): NotificationFeedItem["link"] {
  switch (eventType) {
    case "payment_submitted":
    case "late_payment_proof":
      return { kind: "approvals" };
    case "refund_owed":
    case "refund_paid":
      return { kind: "refunds" };
    case "booking_confirmed":
    case "booking_cancelled":
    case "booking_reminder":
    case "payment_rejected":
      return { kind: "bookings" };
    case "owner_daily_digest":
    case "court_deactivated":
    case "venue_approved":
    case "venue_changes_requested":
    case "venue_rejected":
    case "venue_pending_review":
      return { kind: "overview" };
    default:
      return { kind: "none" };
  }
}

const FEED_FOLD_MS = 10 * 60_000;
const CHANNELS = ["push", "whatsapp", "sms", "web_push"] as const;

/** Old backend (no /feed): fold the per-channel log rows of one event (same type + reference within 10 minutes) into ONE
 * feed-shaped item with every channel's outcome, so the bell renders one readable row (titles come from event_type). */
export function legacyToFeed(entries: readonly LogEntry[]): NotificationFeedItem[] {
  const sorted = [...entries].sort((a, b) => ms(b.created_at) - ms(a.created_at));
  const out: NotificationFeedItem[] = [];
  const keys = new Map<NotificationFeedItem, { ref: string; type: string }>();
  for (const e of sorted) {
    const type = EVENT_ALIASES[e.event_type] ?? e.event_type;
    const ref = e.reference_id ?? "";
    const channel = (CHANNELS as readonly string[]).includes(e.channel) ? (e.channel as (typeof CHANNELS)[number]) : null;
    const status = e.status === "failed" ? "failed" : "sent";
    const hit = out.find((o) => {
      const k = keys.get(o)!;
      return k.type === type && k.ref === ref && Math.abs(ms(o.created_at) - ms(e.created_at)) <= FEED_FOLD_MS;
    });
    if (hit) {
      if (channel && !hit.deliveries.some((d) => d.channel === channel && d.status === status)) hit.deliveries.push({ channel, status });
      continue;
    }
    const item: NotificationFeedItem = {
      id: e.id,
      event_type: e.event_type,
      kind: LEGACY_KIND[type] ?? "other",
      created_at: e.created_at,
      params: {},
      link: legacyLink(type),
      deliveries: channel ? [{ channel, status }] : [],
    };
    keys.set(item, { ref, type });
    out.push(item);
  }
  return out;
}

export interface DayGroup<T> {
  /** Pakistan calendar date "YYYY-MM-DD". */
  day: string;
  kind: "today" | "yesterday" | "date";
  items: T[];
}

/** Newest first, grouped by Pakistan calendar day. */
export function groupByDay<T extends Timed>(items: readonly T[], nowMs: number): DayGroup<T>[] {
  const today = pktDateString(new Date(nowMs));
  const yesterday = pktDateString(new Date(nowMs - 24 * 3600_000));
  const groups: DayGroup<T>[] = [];
  for (const item of [...items].sort((a, b) => ms(b.created_at) - ms(a.created_at))) {
    const day = pktDateString(item.created_at);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, kind: day === today ? "today" : day === yesterday ? "yesterday" : "date", items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}
