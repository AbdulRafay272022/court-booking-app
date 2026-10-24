/** Pure helpers behind the notification bell badge and the notifications list (no React, no storage). Ported from the
 * web app's notif-helpers; unit-tested in notif-helpers.test.ts. */
import { formatDate, pktDateString, type NotificationFeedItem } from "@court-booking/types";

export interface LogEntry {
  id: string;
  channel: string;
  event_type: string;
  status: string;
  reference_id: string | null;
  created_at: string;
}

/** Anything with a timestamp: a raw log row or a feed item. */
export interface Timed {
  created_at: string;
}

const DEDUPE_WINDOW_MS = 5 * 60_000;
/** With no read marker yet, only the last day counts as unread. */
export const FIRST_VISIT_UNREAD_MS = 24 * 3600_000;
/** The badge shows at most this many; above it reads "99+". */
export const BADGE_CAP = 99;
const DAY_MS = 24 * 3600_000;

export function ms(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** The log has one row per channel (push + WhatsApp for the same event): fold rows of the same event_type and
 * reference within five minutes into one item. Newest first. (Only used for the old endpoint; the feed folds
 * server-side.) */
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

export function unreadCount(items: readonly Timed[], readAt: number): number {
  return items.filter((e) => ms(e.created_at) > readAt).length;
}

export function newestMs(items: readonly Timed[]): number {
  return items.reduce((m, e) => Math.max(m, ms(e.created_at)), 0);
}

/** Badge text for a count: "" (hidden) for 0, the number up to 99, then "99+". */
export function badgeLabel(count: number): string {
  if (!(count > 0)) return "";
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

const CHANNELS = new Set(["push", "whatsapp", "sms", "web_push"]);

/** Old-endpoint fallback (a backend without /notifications/feed): turn folded log rows into feed-shaped items so the
 * same row component and the shared notificationText() render them (kind "other": the text falls back to the
 * template-name map). The deliveries of folded rows are merged into the one item. */
export function feedFromLog(entries: readonly LogEntry[]): NotificationFeedItem[] {
  const sorted = [...entries].sort((a, b) => ms(b.created_at) - ms(a.created_at));
  const out: { item: NotificationFeedItem; ref: string }[] = [];
  for (const e of sorted) {
    const ref = e.reference_id ?? "";
    const channel = (CHANNELS.has(e.channel) ? e.channel : "push") as NotificationFeedItem["deliveries"][number]["channel"];
    const status: "sent" | "failed" = e.status === "failed" ? "failed" : "sent";
    const hit = out.find(
      (o) => o.item.event_type === e.event_type && o.ref === ref && Math.abs(ms(o.item.created_at) - ms(e.created_at)) <= DEDUPE_WINDOW_MS,
    );
    if (hit) {
      if (!hit.item.deliveries.some((d) => d.channel === channel)) hit.item.deliveries.push({ channel, status });
      continue;
    }
    out.push({
      ref,
      item: { id: e.id, event_type: e.event_type, kind: "other", created_at: e.created_at, params: {}, link: { kind: "none" }, deliveries: [{ channel, status }] },
    });
  }
  return out.map((o) => o.item);
}

/** Day heading for a past timestamp, Pakistan calendar: "Aaj", "Kal" (yesterday), else "Sat, 17 Oct". */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((Date.parse(pktDateString(now)) - Date.parse(pktDateString(d))) / DAY_MS);
  if (diff === 0) return "Aaj";
  if (diff === 1) return "Kal";
  return formatDate(d, now, "ru");
}

/** Newest-first items grouped under day headings (groups keep the input order). */
export function groupByDay<T extends Timed>(items: readonly T[], now: Date = new Date()): { key: string; title: string; items: T[] }[] {
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const it of [...items].sort((a, b) => ms(b.created_at) - ms(a.created_at))) {
    const key = pktDateString(new Date(it.created_at));
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, title: dayHeading(it.created_at, now), items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

export type NotifRole = "owner" | "player";
/** Where a tap on a notification goes (Expo Router href object), or null when it has no destination. */
export type NotifTarget = { pathname: string; params?: Record<string, string> } | null;

export function notificationTarget(item: Pick<NotificationFeedItem, "link" | "params">, role: NotifRole): NotifTarget {
  const kind = item.link?.kind ?? "none";
  if (role === "player") {
    if (kind === "booking" || kind === "bookings") return { pathname: "/(player)/(tabs)/bookings" };
    return null;
  }
  switch (kind) {
    case "approvals":
      return { pathname: "/(owner)/(tabs)/approvals" };
    case "refunds":
      return { pathname: "/(owner)/(tabs)/refunds" };
    case "booking": {
      if (!item.link.booking_id) return { pathname: "/(owner)/history" };
      const params: Record<string, string> = { booking: item.link.booking_id };
      if (item.params?.starts_at) {
        const day = pktDateString(new Date(item.params.starts_at));
        params.from = day;
        params.to = day;
      }
      return { pathname: "/(owner)/history", params };
    }
    case "bookings":
      return { pathname: "/(owner)/history" };
    case "overview":
      return { pathname: "/(owner)/(tabs)/today" };
    case "venue_status":
      return { pathname: "/(owner)" };
    default:
      return null;
  }
}
