import { pktDateString } from "@court-booking/types";

/** The Approvals / Refunds pages share the Overview's URL filter: `?date=YYYY-MM-DD` (omitted = no day filter on these queues)
 * and `?courts=id1,id2` (omitted = all courts). Pure helpers, unit-tested in queue-filter.test.ts. */
export interface QueueFilter {
  date: string | undefined;
  courtIds: string[];
  active: boolean;
}

type ParamReader = { get(name: string): string | null };

export function parseQueueFilter(params: ParamReader): QueueFilter {
  const rawDate = params.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
  const courtIds = (params.get("courts") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-fA-F-]{8,}$/.test(s));
  return { date, courtIds, active: !!date || courtIds.length > 0 };
}

/** "History mein dekho": the History page with that booking highlighted, on the day the owner is looking at (the filter day,
 * else the booking's own Pakistan date). */
export function historyHref(bookingId: string, startsAt: string, filterDate?: string): string {
  const day = filterDate ?? pktDateString(startsAt);
  return `/dashboard/bookings?booking=${encodeURIComponent(bookingId)}&from=${day}&to=${day}`;
}
