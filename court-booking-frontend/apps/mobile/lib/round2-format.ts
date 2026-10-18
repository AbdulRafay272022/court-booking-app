/** Owner Round 2 (mobile): small display helpers shared by Approvals, Overview, History and Refunds.
 * Dates and times always go through the shared PKT formatters (packages/types/src/datetime.ts). */
import type { ApprovalQueueItem, ApprovalState } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { addDays, formatDate, formatTimeRange, pktDateString } from "@/lib/format";

/** "Aaj" / "Kal" / "Sat, 24 Oct" for the booking's own (Pakistan) day. */
export function dayLabel(startsAt: string, now: Date = new Date()): string {
  const day = pktDateString(startsAt);
  const today = pktDateString(now);
  if (day === today) return "Aaj";
  if (day === addDays(today, 1)) return "Kal";
  return formatDate(startsAt, now);
}

/** "Aaj, 9:00 PM to 10:00 PM". */
export function slotWhen(startsAt: string, endsAt: string, now: Date = new Date()): string {
  return `${dayLabel(startsAt, now)}, ${formatTimeRange(startsAt, endsAt)}`;
}

/** The approve/reject answer for a booking the player (or the system) cancelled meanwhile. */
export function noLongerPendingState(e: unknown): ApprovalState | null {
  if (!(e instanceof ApiError) || e.code !== "BOOKING_NO_LONGER_PENDING") return null;
  const s = (e.details as { state?: string } | undefined)?.state;
  return s === "expired" || s === "cancelled_by_owner" || s === "cancelled_by_player" ? s : "cancelled_by_player";
}

export const STATE_CHIP: Record<Exclude<ApprovalState, "awaiting">, string> = {
  cancelled_by_player: "Player ne cancel kar di",
  expired: "Waqt khatam, booking cancel ho gayi",
  cancelled_by_owner: "Booking cancel ho chuki hai",
};

export function isGrey(item: Pick<ApprovalQueueItem, "state">): boolean {
  return item.state !== "awaiting";
}

/** History has no "all dates" mode on the server (it defaults to today), so "no date filter" is a wide window. */
export function allDatesRange(now: Date = new Date()): { from: string; to: string } {
  const today = pktDateString(now);
  return { from: addDays(today, -180), to: addDays(today, 180) };
}

/** Whole PKR from a typed string ("10,000" -> 10000); null when it is not a whole number. */
export function parsePkr(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}
