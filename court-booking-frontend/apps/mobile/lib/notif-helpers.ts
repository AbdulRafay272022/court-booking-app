/** Pure helpers behind the notification bell badge (no React, no storage). Ported from the web app's
 * notif-helpers; unit-tested in notif-helpers.test.ts. */

export interface LogEntry {
  id: string;
  channel: string;
  event_type: string;
  status: string;
  reference_id: string | null;
  created_at: string;
}

const DEDUPE_WINDOW_MS = 5 * 60_000;
/** With no read marker yet, only the last day counts as unread. */
export const FIRST_VISIT_UNREAD_MS = 24 * 3600_000;
/** The badge shows at most this many; above it reads "99+". */
export const BADGE_CAP = 99;

export function ms(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** The log has one row per channel (push + WhatsApp for the same event): fold rows of the same event_type and
 * reference within five minutes into one item. Newest first. */
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

/** Badge text for a count: "" (hidden) for 0, the number up to 99, then "99+". */
export function badgeLabel(count: number): string {
  if (!(count > 0)) return "";
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}
