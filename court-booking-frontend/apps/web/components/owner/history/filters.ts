/** Pure helpers for the Bookings history page: date presets and the URL <-> filter mapping (docs/owner-overview-contract.md, "URL query names"). */
import { addDays, daysOfMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { HistoryStatusFilter } from "@court-booking/types";

export type PresetKey = "today" | "yesterday" | "week" | "month" | "custom";

export const PRESET_KEYS: readonly PresetKey[] = ["today", "yesterday", "week", "month", "custom"];

export interface DateRange {
  from: string;
  to: string;
}

/** Calendar range of a preset for a Pakistan "today" ("YYYY-MM-DD"). Week = Monday to Sunday, month = 1st to last day (bookings in the future matter too). */
export function presetRange(preset: Exclude<PresetKey, "custom">, today: string): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "week": {
      const monday = addDays(today, -mondayFirstWeekdayOf(today));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month": {
      const days = daysOfMonth(monthOf(today));
      return { from: days[0], to: days[days.length - 1] };
    }
  }
}

/** Which preset (if any) a range equals; everything else is "custom". */
export function detectPreset(range: DateRange, today: string): PresetKey {
  for (const key of ["today", "yesterday", "week", "month"] as const) {
    const r = presetRange(key, today);
    if (r.from === range.from && r.to === range.to) return key;
  }
  return "custom";
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string | null | undefined): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Normalises a range: invalid or missing sides fall back, a reversed range is swapped. */
export function normaliseRange(from: string | null | undefined, to: string | null | undefined, today: string): DateRange {
  const f = validDate(from) ? from : validDate(to) ? to : today;
  const t = validDate(to) ? to : f;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

/** Every value the Status filter offers: the composites first, then each raw state. `booked` is both a composite and a raw key. */
export const STATUS_FILTERS: readonly HistoryStatusFilter[] = [
  "booked",
  "pending",
  "cancelled",
  "refund",
  "completed",
  "short_paid",
  "held",
  "awaiting_approval",
  "no_show",
  "refund_owed",
  "refunded",
  "expired",
];

export const SORT_FIELDS = ["starts_at", "player", "court", "total", "advance", "due", "total_paid", "status"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = "asc" | "desc";

export interface SortState {
  field: SortField;
  dir: SortDir;
}

/** "total:desc" -> {field, dir}; anything unknown -> null (server default order). */
export function parseSort(value: string | null | undefined): SortState | null {
  if (!value) return null;
  const [field, dir] = value.split(":");
  if (!(SORT_FIELDS as readonly string[]).includes(field)) return null;
  return { field: field as SortField, dir: dir === "desc" ? "desc" : "asc" };
}

export function formatSort(s: SortState | null): string | undefined {
  return s ? `${s.field}:${s.dir}` : undefined;
}

/** Clicking a header: new column -> ascending, same column -> flip, third click on a descending column -> back to default order. */
export function nextSort(current: SortState | null, field: SortField): SortState | null {
  if (!current || current.field !== field) return { field, dir: "asc" };
  if (current.dir === "asc") return { field, dir: "desc" };
  return null;
}

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface HistoryState {
  from: string;
  to: string;
  courts: string[];
  status: HistoryStatusFilter[];
  q: string;
  page: number;
  size: number;
  sort: SortState | null;
  booking: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** URL -> filter state. `get` is `searchParams.get`. Unknown status values and bad numbers are dropped. */
export function parseHistoryQuery(get: (key: string) => string | null, today: string): HistoryState {
  const { from, to } = normaliseRange(get("from"), get("to"), today);
  const status = list(get("status")).filter((s): s is HistoryStatusFilter => (STATUS_FILTERS as readonly string[]).includes(s));
  const pageNum = Math.floor(Number(get("page")));
  const sizeNum = Number(get("size"));
  const booking = get("booking");
  return {
    from,
    to,
    courts: [...new Set(list(get("courts")))],
    status: [...new Set(status)],
    q: (get("q") ?? "").slice(0, 100),
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
    size: (PAGE_SIZES as readonly number[]).includes(sizeNum) ? sizeNum : DEFAULT_PAGE_SIZE,
    sort: parseSort(get("sort")),
    booking: booking && UUID_RE.test(booking) ? booking : null,
  };
}

/** Filter state -> query string (no leading "?"). Defaults are omitted so the URL stays short; from/to are both omitted for "today". */
export function buildHistoryQuery(state: HistoryState, today: string): string {
  const usp = new URLSearchParams();
  if (!(state.from === today && state.to === today)) {
    usp.set("from", state.from);
    usp.set("to", state.to);
  }
  if (state.courts.length) usp.set("courts", state.courts.join(","));
  if (state.status.length) usp.set("status", state.status.join(","));
  if (state.q.trim()) usp.set("q", state.q.trim());
  if (state.page > 1) usp.set("page", String(state.page));
  if (state.size !== DEFAULT_PAGE_SIZE) usp.set("size", String(state.size));
  const sort = formatSort(state.sort);
  if (sort) usp.set("sort", sort);
  if (state.booking) usp.set("booking", state.booking);
  return usp.toString();
}

/** A link into the history page for one booking, using the booking's own PKT date for both ends of the range. */
export function historyLinkForBooking(bookingId: string, startsAt: string): string {
  const date = pktDateString(startsAt);
  return `/dashboard/bookings?booking=${bookingId}&from=${date}&to=${date}`;
}

/** Total number of pages for a total row count. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}
