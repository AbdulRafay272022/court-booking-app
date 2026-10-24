import type { ApprovalQueueItem, LedgerSummary, OwnerBookingRow, StaffPermissionKey } from "@court-booking/types";

/**
 * Pure rules for the Floodlight owner screens (boards OwnerToday, Approvals, OPaisa, OStaffView). No React / RN imports,
 * so lib/owner-floodlight.test.ts can run them under node:test.
 */

type Can = (key: StaffPermissionKey) => boolean;

/* ---------------- Tab bar: Aaj · Approvals · [+] · Paisa · Aur ---------------- */

/** Routes of the real Tabs navigator (app/(owner)/(tabs)/). "refunds" stays a tab route (deep links, notification paths)
 * but has no cell of its own: it lives under Paisa. */
export type OwnerTabRoute = "today" | "approvals" | "refunds" | "ledger" | "more";
export type OwnerBarKey = "aaj" | "approvals" | "paisa" | "aur";

export interface OwnerBarTab {
  key: OwnerBarKey;
  /** Where a tap goes. */
  route: OwnerTabRoute;
  label: string;
}

/**
 * The board's bar for this account. Same permission needs as lib/owner-access.ts TAB_NEEDS (backend-enforced):
 * Aaj / Approvals / Ledger read through view_ledger; Refunds needs mark_refunds. Paisa opens the Ledger when the account
 * may read it, else Refunds (a mark_refunds-only staff member), else it is hidden. "Aur" is always there.
 */
export function ownerBarTabs(can: Can): OwnerBarTab[] {
  const out: OwnerBarTab[] = [];
  if (can("view_ledger")) {
    out.push({ key: "aaj", route: "today", label: "Aaj" });
    out.push({ key: "approvals", route: "approvals", label: "Approvals" });
  }
  if (can("view_ledger")) out.push({ key: "paisa", route: "ledger", label: "Paisa" });
  else if (can("mark_refunds")) out.push({ key: "paisa", route: "refunds", label: "Paisa" });
  out.push({ key: "aur", route: "more", label: "Aur" });
  return out;
}

/** Which bar cell is lit for the focused tab route. */
export function activeBarKey(route: string | undefined): OwnerBarKey | null {
  switch (route) {
    case "today":
      return "aaj";
    case "approvals":
      return "approvals";
    case "ledger":
    case "refunds":
      return "paisa";
    case "more":
      return "aur";
    default:
      return null;
  }
}

/** The teal "+" walk-in FAB: only with the walkin permission. */
export function showWalkinFab(can: Can): boolean {
  return can("walkin");
}

export type PaisaSegment = "ledger" | "refunds" | "history";

/** The Ledger / Refunds / History switch on the Paisa screens (each segment navigates to its EXISTING route). */
export function paisaSegments(can: Can): PaisaSegment[] {
  const out: PaisaSegment[] = [];
  if (can("view_ledger")) out.push("ledger");
  if (can("mark_refunds")) out.push("refunds");
  if (can("view_ledger")) out.push("history");
  return out;
}

/* ---------------- Today hero: the SAME number as Paisa (audit G14) ---------------- */

/**
 * "Aaj aaya" on the Today hero. Reads the ledger summary the Paisa screen reads, so the two can never disagree:
 * for today it is `collected_today` (Paisa's "Aaj" tile); for another day it is `total_in_range` of a one-day ledger
 * query for that day. Null while unknown (loading never shows "0").
 */
export function heroCollected(summary: Pick<LedgerSummary, "collected_today" | "total_in_range"> | null | undefined, date: string, today: string): number | null {
  if (!summary) return null;
  return date === today ? summary.collected_today : summary.total_in_range;
}

/* ---------------- Approvals ---------------- */

/** Minutes the oldest still-awaiting payment has been waiting (null when none). */
export function oldestWaitMinutes(items: Pick<ApprovalQueueItem, "state" | "minutes_since_submission">[]): number | null {
  let max: number | null = null;
  for (const it of items) {
    if (it.state !== "awaiting") continue;
    const m = Math.max(0, Math.round(it.minutes_since_submission ?? 0));
    if (max === null || m > max) max = m;
  }
  return max;
}

/** "12 min", "2 ghante", "3 din". */
export function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ghante`;
  return `${Math.floor(minutes / (60 * 24))} din`;
}

/**
 * Payments that may go through the bulk "Sab approve" confirm (there is NO batch endpoint, contract B8: the screen sends
 * one approve call per payment, in order). Only the plainest case qualifies: waiting, the screenshot was READ and its
 * amount equals what is due ("match"), no duplicate flag at all (even a 0-count flag needs the separate confirm), no overpayment choice to make. Everything else needs the
 * owner's own look in the single-card sheet.
 */
export function bulkApprovable(items: ApprovalQueueItem[], locked: boolean): ApprovalQueueItem[] {
  if (locked) return [];
  return items.filter(
    (it) =>
      it.state === "awaiting" &&
      it.ocr_verdict === "match" &&
      it.ocr_amount != null &&
      Math.round(it.ocr_amount) === Math.round(it.expected_amount) &&
      !it.duplicate &&
      !it.overpayment,
  );
}

/** The amount sent with a bulk approve: what the single-card sheet would pre-fill (checks.paid_amount), else nothing. */
export function bulkApproveAmount(it: ApprovalQueueItem): number | undefined {
  return it.checks ? it.checks.paid_amount : undefined;
}

/* ---------------- Today timeline (multi-court "Courts ka din") ---------------- */

export type TimelineKind = "booked" | "walkin" | "pending" | "noshow";

export interface TimelineBlock {
  kind: TimelineKind;
  row: OwnerBookingRow;
  /** Minutes from the window start. */
  start: number;
  end: number;
}

export interface TimelineGap {
  start: number;
  end: number;
  /** Absolute start (ms), for "+ Add" (walk-in prefill). */
  startMs: number;
  /** The gap is still ahead of "now" (a walk-in can still go there). */
  future: boolean;
}

export interface TimelineColumn {
  courtId: string;
  name: string;
  blocks: TimelineBlock[];
  gaps: TimelineGap[];
}

export interface TimelineModel {
  /** Window start (ms, on the hour). */
  startMs: number;
  /** Hours hidden before the window start by `clipFromMs` (0 = the whole day is shown). */
  hiddenHours: number;
  /** Window length in minutes (whole hours). */
  minutes: number;
  /** One tick per hour: ms + minutes from start. */
  hours: { ms: number; offset: number }[];
  columns: TimelineColumn[];
  /** "Now" line offset in minutes, or null when now is outside the window. */
  now: number | null;
}

const HOUR = 3600_000;

/** Only live bookings sit on the timeline; cancelled/refund rows are listed below it, not drawn. */
export function timelineKind(row: Pick<OwnerBookingRow, "kind" | "status_key" | "source">): TimelineKind | null {
  if (row.kind !== "booked") return null;
  if (row.status_key === "held" || row.status_key === "awaiting_approval") return "pending";
  if (row.status_key === "no_show") return "noshow";
  if (row.status_key === "booked") return row.source === "walkin" ? "walkin" : "booked";
  return null;
}

/**
 * Lay out the day's bookings per court. The window is the venue's operating day when the server sends it, else the
 * span of the bookings themselves, rounded out to whole hours. Gaps are only spaces WITHOUT a booking (a blocked slot is
 * not known here), so the screen labels them "koi booking nahi", never "khaali".
 */
export function timelineModel(
  rows: OwnerBookingRow[],
  courts: { id: string; name: string }[],
  operatingDay: { start_at: string; end_at: string } | null | undefined,
  nowMs: number,
  minGapMinutes = 30,
  /** Start the window here instead (rounded down to the hour) when it is later than the natural start: Aaj opens at
   * "one hour before now" so the owner does not scroll through the morning; a toggle shows the whole day. */
  clipFromMs?: number | null,
): TimelineModel | null {
  const live = rows.map((r) => ({ r, k: timelineKind(r) })).filter((x): x is { r: OwnerBookingRow; k: TimelineKind } => x.k !== null);
  let lo: number;
  let hi: number;
  if (operatingDay) {
    lo = Date.parse(operatingDay.start_at);
    hi = Date.parse(operatingDay.end_at);
  } else {
    if (live.length === 0) return null;
    lo = Math.min(...live.map((x) => Date.parse(x.r.starts_at)));
    hi = Math.max(...live.map((x) => Date.parse(x.r.ends_at)));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  let startMs = Math.floor(lo / HOUR) * HOUR;
  const endMs = Math.ceil(hi / HOUR) * HOUR;
  if (clipFromMs != null) {
    const clip = Math.floor(clipFromMs / HOUR) * HOUR;
    if (clip > startMs && clip < endMs) startMs = clip;
  }
  const minutes = Math.round((endMs - startMs) / 60000);
  const toMin = (ms: number) => Math.round((ms - startMs) / 60000);
  const hours: { ms: number; offset: number }[] = [];
  for (let t = startMs; t <= endMs; t += HOUR) hours.push({ ms: t, offset: toMin(t) });

  // Courts in the venue's order, plus any court that only appears on a row (renamed/inactive).
  const order = [...courts];
  for (const x of live) if (!order.some((c) => c.id === x.r.court_id)) order.push({ id: x.r.court_id, name: x.r.court_name });

  const columns: TimelineColumn[] = order.map((c) => {
    const blocks = live
      .filter((x) => x.r.court_id === c.id)
      .map((x) => ({ kind: x.k, row: x.r, start: Math.max(0, toMin(Date.parse(x.r.starts_at))), end: Math.min(minutes, toMin(Date.parse(x.r.ends_at))) }))
      .filter((b) => b.end > b.start)
      .sort((a, b) => a.start - b.start);
    const gaps: TimelineGap[] = [];
    let cursor = 0;
    for (const b of blocks) {
      if (b.start - cursor >= minGapMinutes) gaps.push(gap(cursor, b.start));
      cursor = Math.max(cursor, b.end);
    }
    if (minutes - cursor >= minGapMinutes) gaps.push(gap(cursor, minutes));
    return { courtId: c.id, name: c.name, blocks, gaps };
  });

  function gap(s: number, e: number): TimelineGap {
    const sMs = startMs + s * 60000;
    return { start: s, end: e, startMs: sMs, future: startMs + e * 60000 > nowMs };
  }

  const now = nowMs >= startMs && nowMs <= endMs ? toMin(nowMs) : null;
  const hiddenHours = Math.max(0, Math.round((startMs - Math.floor(lo / HOUR) * HOUR) / HOUR));
  return { startMs, hiddenHours, minutes, hours, columns, now };
}

/** "1 ghanta", "1.5 ghante", "30 min". */
export function spanLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return h === 1 ? "1 ghanta" : `${Number.isInteger(h) ? h : h.toFixed(1)} ghante`;
}

/* ---------------- Feature flags ---------------- */

/** A flag gate for entry points: unknown (loading, error, older backend without the key) counts as ON, the server still
 * enforces it. Only an explicit `false` hides the entry. */
export function flagOn(flags: Record<string, boolean> | null | undefined, key: string): boolean {
  if (!flags || !(key in flags)) return true;
  return flags[key] !== false;
}

/* ---------------- Booking detail "Baqi mil gaye" ---------------- */

export type SettleAction = "completion" | "record" | "wait" | "none";

/**
 * What the detail sheet offers for the money still due (contract: completion {result:"yes"} only after the slot ended,
 * COMPLETION_TOO_EARLY before; before that a payment entry, which needs the split_payments flag).
 */
export function settleAction(
  row: Pick<OwnerBookingRow, "kind" | "status_key" | "due" | "slot_ended" | "completion">,
  opts: { canRecord: boolean; splitPayments: boolean },
): SettleAction {
  if (!opts.canRecord) return "none";
  if (row.kind !== "booked" || !["booked", "no_show"].includes(row.status_key)) return "none";
  if (row.completion) return row.due > 0 && opts.splitPayments ? "record" : "none";
  if (row.slot_ended) return "completion";
  if (row.due > 0) return opts.splitPayments ? "record" : "wait";
  return "none";
}

/* ---------------- Growth heatmap (contract B3: only UNDER-booked cells exist) ---------------- */

export interface GrowthCell {
  /** Lowest booking rate among the courts flagged for this day + hour (0..1). */
  rate: number;
  venueAverage: number;
  courts: string[];
}

/**
 * Rows = the hours that have at least one under-booked cell (sorted), columns = Mon..Sun (day_of_week 0 = Monday, as the
 * API sends it). Only the server's under-booked cells are filled; every other cell is "no signal", never "0%".
 */
export function growthGrid(slots: { court_id: string; day_of_week: number; hour: number; booking_rate: number; venue_average: number }[]): {
  hours: number[];
  cell: (day: number, hour: number) => GrowthCell | null;
} {
  const map = new Map<string, GrowthCell>();
  for (const s of slots) {
    if (s.day_of_week < 0 || s.day_of_week > 6) continue;
    const k = `${s.day_of_week}-${s.hour}`;
    const prev = map.get(k);
    if (!prev) map.set(k, { rate: s.booking_rate, venueAverage: s.venue_average, courts: [s.court_id] });
    else map.set(k, { rate: Math.min(prev.rate, s.booking_rate), venueAverage: prev.venueAverage, courts: [...prev.courts, s.court_id] });
  }
  const hours = [...new Set(slots.filter((s) => s.day_of_week >= 0 && s.day_of_week <= 6).map((s) => s.hour))].sort((a, b) => a - b);
  return { hours, cell: (d, h) => map.get(`${d}-${h}`) ?? null };
}
