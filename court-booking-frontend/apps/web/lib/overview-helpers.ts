// Pure helpers for the owner Overview (docs/owner-overview-spec.md section 2). No React, no network: unit-tested in overview-helpers.test.ts.
import { addDays } from "@court-booking/types";
import type { OwnerBookingRow, OwnerOverview, CompletionResult, HistoryStatusFilter } from "@court-booking/types";

export type RowFilter = "all" | "booked" | "cancelled" | "refund";

/** A "YYYY-MM-DD" calendar date. */
export function isDateString(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `courts=id1,id2` -> the ids that exist at this venue. An empty result means "all courts". */
export function parseCourtIds(param: string | null | undefined, validIds: readonly string[]): string[] {
  if (!param) return [];
  const wanted = param.split(",").map((s) => s.trim()).filter(Boolean);
  return validIds.filter((id) => wanted.includes(id));
}

/** The `courts` URL value for a selection: undefined (omit it) when nothing or every court is selected. */
export function courtsParam(selected: readonly string[], allIds: readonly string[]): string | undefined {
  if (selected.length === 0 || selected.length >= allIds.length) return undefined;
  return allIds.filter((id) => selected.includes(id)).join(",");
}

function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string).replace(/%2C/g, ",")}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** /dashboard/owner/today?date=..&courts=.. (today's date and all courts are omitted). */
export function overviewHref(date: string, today: string, courts: string | undefined): string {
  return `/dashboard/owner/today${qs({ date: date === today ? undefined : date, courts })}`;
}

/** The History page with the Overview's day and courts, optionally with a status filter and one booking. */
export function historyHref(opts: { date: string; courts?: string; status?: HistoryStatusFilter; booking?: string }): string {
  return `/dashboard/bookings${qs({ from: opts.date, to: opts.date, courts: opts.courts, status: opts.status, booking: opts.booking })}`;
}

/** Approvals; `date` undefined = every date (the "Sab dikhao" view). */
export function approvalsHref(date: string | undefined, courts: string | undefined): string {
  return `/dashboard/owner/approvals${qs({ date, courts })}`;
}

/** How far back and ahead "any date" reaches on the History page (it always needs a from/to range). */
export const ALL_DATES_SPAN_DAYS = 365;

/** History with no practical date filter: a year back to a year ahead of `today`. */
export function allDatesHistoryHref(today: string, opts: { courts?: string; status?: HistoryStatusFilter }): string {
  return `/dashboard/bookings${qs({
    from: addDays(today, -ALL_DATES_SPAN_DAYS),
    to: addDays(today, ALL_DATES_SPAN_DAYS),
    courts: opts.courts,
    status: opts.status,
  })}`;
}

/** The any-date pending numbers, or null when the backend is older and does not send them (never invented). */
export function pendingAllOf(overview: Pick<OwnerOverview, "pending_all">): { count: number; approval: number; payment: number } | null {
  const p = overview.pending_all;
  if (!p || typeof p.count !== "number") return null;
  return { count: p.count, approval: p.awaiting_approval ?? 0, payment: p.awaiting_payment ?? 0 };
}

/** Which slots the "Sab slots" popup shows. "free" includes the free slots that have already passed. */
export type SlotFilter = "all" | "free" | "booked" | "pending" | "blocked";
export const SLOT_FILTERS: readonly SlotFilter[] = ["all", "free", "booked", "pending", "blocked"];

export function slotFilterMatches(view: "booked" | "pending" | "blocked" | "free" | "past", filter: SlotFilter): boolean {
  if (filter === "all") return true;
  if (filter === "free") return view === "free" || view === "past";
  return view === filter;
}

export function rowMatchesFilter(row: OwnerBookingRow, filter: RowFilter): boolean {
  return filter === "all" || row.kind === filter;
}

export function filterRows(rows: readonly OwnerBookingRow[], filter: RowFilter): OwnerBookingRow[] {
  return rows.filter((r) => rowMatchesFilter(r, filter));
}

export function rowCounts(rows: readonly OwnerBookingRow[]): Record<RowFilter, number> {
  const counts: Record<RowFilter, number> = { all: rows.length, booked: 0, cancelled: 0, refund: 0 };
  for (const r of rows) counts[r.kind] += 1;
  return counts;
}

export interface SlotSegment {
  key: "booked" | "pending" | "blocked" | "free";
  count: number;
  /** Share of the bar, 0..100. */
  percent: number;
}

/** Bar segments. Invariant (tested): the four counts add up to the total, so Total = Booked + Pending + Blocked + Free. */
export function slotSegments(slots: Pick<OwnerOverview["slots"], "total" | "booked" | "pending" | "blocked" | "free">): SlotSegment[] {
  const total = slots.total > 0 ? slots.total : slots.booked + slots.pending + slots.blocked + slots.free;
  const make = (key: SlotSegment["key"], count: number): SlotSegment => ({ key, count, percent: total > 0 ? (count / total) * 100 : 0 });
  return [make("booked", slots.booked), make("pending", slots.pending), make("blocked", slots.blocked), make("free", slots.free)];
}

/** The busiest `n` courts by `pick`, ties by name, empty ones dropped; `rest` is how many more courts have a non-zero count. */
export function topCourts<T extends { court_name: string }>(
  items: readonly T[],
  pick: (item: T) => number,
  n = 2,
): { top: T[]; rest: number } {
  const nonZero = items.filter((i) => pick(i) > 0).sort((a, b) => pick(b) - pick(a) || a.court_name.localeCompare(b.court_name));
  return { top: nonZero.slice(0, n), rest: Math.max(0, nonZero.length - n) };
}

export type RowTone = "green" | "red" | "refund" | "cancelled" | "none";

export function rowTone(row: OwnerBookingRow): RowTone {
  if (row.kind === "refund") return "refund";
  if (row.kind === "cancelled") return "cancelled";
  if (row.completion?.result === "yes") return "green";
  if (row.completion?.result === "no") return "red";
  return "none";
}

export function completionValue(row: OwnerBookingRow): "" | CompletionResult {
  return row.completion?.result ?? "";
}

/** What the row will look like once the server accepts the completion (used for the instant update). */
export function applyCompletion(row: OwnerBookingRow, result: CompletionResult, receivedPkr?: number): OwnerBookingRow {
  const received = result === "yes" ? row.total : Math.min(Math.max(receivedPkr ?? 0, 0), row.total);
  return {
    ...row,
    total_paid: received,
    due: row.total - received,
    completion: {
      result,
      received_pkr: received,
      reason: row.completion?.reason ?? null,
      marked_at: new Date().toISOString(),
      marked_by_name: row.completion?.marked_by_name ?? null,
    },
  };
}

/** Replace the rows of one booking (by id and kind booked) in an overview, leaving everything else untouched. */
export function patchOverviewRow(overview: OwnerOverview, next: OwnerBookingRow): OwnerOverview {
  return { ...overview, rows: overview.rows.map((r) => (r.booking_id === next.booking_id && r.kind === next.kind ? next : r)) };
}

/** The row an "Original booking" chip jumps to: a booked row of the same booking, else the cancelled one (for a refund row). */
export function findOriginalRow(rows: readonly OwnerBookingRow[], row: OwnerBookingRow): OwnerBookingRow | null {
  const id = row.original_booking_id ?? row.booking_id;
  const same = rows.filter((r) => r.booking_id === id && r !== row);
  return same.find((r) => r.kind === "booked") ?? same.find((r) => r.kind === "cancelled" && row.kind === "refund") ?? null;
}

/** DOM id of a table row / card, shared by the scroll-to-original code. */
export function rowDomId(row: Pick<OwnerBookingRow, "booking_id" | "kind">): string {
  return `ovw-row-${row.booking_id}-${row.kind}`;
}

/** First letter of a name for the avatar circle ("?" when there is no name). */
export function initialOf(name: string | null | undefined): string {
  const ch = (name ?? "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

/** "PKR 3,500" (money is written the same way in both languages). */
export function pkr(amount: number): string {
  return `PKR ${Math.round(amount).toLocaleString("en-US")}`;
}
