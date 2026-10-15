import type { Booking, BookingStatus } from "./booking";
import { WORDS, type TextLang } from "./locale-text";

/** The four buckets the player dashboard filters and counts by (the six raw statuses are too fine for a player). */
export type StatusGroup = "confirmed" | "pending" | "completed" | "cancelled";

export function statusGroup(status: BookingStatus): StatusGroup {
  switch (status) {
    case "booked":
      return "confirmed";
    case "held":
    case "payment_submitted":
      return "pending";
    case "completed":
      return "completed";
    case "cancelled":
    case "no_show":
      return "cancelled";
  }
}

/**
 * A booking that still needs the player to turn up or pay: confirmed, or pending. A pending hold whose time to pay has
 * already run out is not active (the expiry job may not have cancelled it yet), so it never becomes "your next booking".
 */
export function isActiveBooking(b: Pick<Booking, "status" | "held_until">, now: number = Date.now()): boolean {
  const group = statusGroup(b.status);
  if (group !== "confirmed" && group !== "pending") return false;
  if (b.status === "held" && b.held_until && Date.parse(b.held_until) <= now) return false;
  return true;
}

/** The soonest active booking that has not finished yet, or null. `bookings` may be in any order. */
export function nextBooking<T extends Pick<Booking, "status" | "held_until" | "starts_at" | "ends_at">>(
  bookings: T[],
  now: number = Date.now(),
): T | null {
  let best: T | null = null;
  for (const b of bookings) {
    if (!isActiveBooking(b, now) || Date.parse(b.ends_at) <= now) continue;
    if (best === null || Date.parse(b.starts_at) < Date.parse(best.starts_at)) best = b;
  }
  return best;
}

export interface BookingCounts {
  all: number;
  confirmed: number;
  pending: number;
  completed: number;
  cancelled: number;
}

export function countByGroup(bookings: Pick<Booking, "status">[]): BookingCounts {
  const counts: BookingCounts = { all: bookings.length, confirmed: 0, pending: 0, completed: 0, cancelled: 0 };
  for (const b of bookings) counts[statusGroup(b.status)] += 1;
  return counts;
}

/** "in 2 days", "in 3 hours", "in 25 min", "happening now" -- for the next-booking card. */
export function startsInText(startsAt: string, endsAt: string, now: number = Date.now(), lang: TextLang = "en"): string {
  const start = Date.parse(startsAt);
  if (now >= start) return Date.parse(endsAt) > now ? WORDS[lang].happeningNow : WORDS[lang].finished;
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes < 60) return WORDS[lang].inMin(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return WORDS[lang].inHours(hours);
  const days = Math.floor(hours / 24);
  return WORDS[lang].inDays(days);
}
