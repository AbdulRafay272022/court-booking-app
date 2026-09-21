import type { Slot } from "./availability";
import { formatTime24As12, parseTime24 } from "./datetime";

/** Slot lengths an owner may choose per court (90 is here for padel). Mirrors the backend's ALLOWED_SLOT_MINUTES. */
export const SLOT_MINUTES_OPTIONS = [30, 60, 90, 120] as const;

/** Longest single booking a player can make, whatever the court's slot length. Mirrors the backend's MAX_BOOKING_MINUTES. */
export const MAX_BOOKING_MINUTES = 240;

/** "30 minutes", "1 hour", "1.5 hours", "2 hours": how a booking length is said to a player. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${Number(hours.toFixed(2))} hours`;
}

export interface SlotPreview {
  /** How many bookable slots a day with these hours has. */
  count: number;
  /** "HH:MM" of the first slot's start, and of the LAST slot's start and end. */
  firstStart: string;
  lastStart: string;
  lastEnd: string;
  /** True when the last slot ends after midnight (an overnight court): lastEnd is the NEXT morning. */
  crossesMidnight: boolean;
}

const DAY = 24 * 60;

function minutesOf(time24: string): number | null {
  const t = parseTime24(time24);
  if (!t) return null;
  return ((t.hour % 12) + (t.meridiem === "PM" ? 12 : 0)) * 60 + t.minute;
}

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The slots a court with these opening hours and slot length produces, computed exactly like the backend's grid:
 * the first slot starts at opening time and slots run back to back while they still END by closing time (a
 * left-over shorter than one slot at the end is not bookable). Returns null when the hours are unusable.
 * This is what the settings screens show as the live "you will get N slots a day" preview.
 */
export function slotPreview(open24: string, close24: string, slotMinutes: number): SlotPreview | null {
  const open = minutesOf(open24);
  const close = minutesOf(close24);
  if (open === null || close === null || slotMinutes <= 0) return null;
  // close at or before open = the court closes the NEXT morning (3 PM to 3 AM); close == open = open 24 hours
  const end = close <= open ? close + DAY : close;
  const count = Math.floor((end - open) / slotMinutes);
  if (count < 1) return null;
  const lastStart = open + (count - 1) * slotMinutes;
  return {
    count,
    firstStart: hhmm(open),
    lastStart: hhmm(lastStart),
    lastEnd: hhmm(lastStart + slotMinutes),
    crossesMidnight: lastStart + slotMinutes > DAY,
  };
}

/** "11 slots a day, 6:00 AM to 10:30 PM" -- the one-line preview text. */
export function slotPreviewText(open24: string, close24: string, slotMinutes: number): string {
  const p = slotPreview(open24, close24, slotMinutes);
  if (!p) return "These hours are too short for even one slot.";
  const to = `${formatTime24As12(p.lastEnd)}${p.crossesMidnight ? " the next morning" : ""}`;
  return `${p.count} ${p.count === 1 ? "slot" : "slots"} a day, ${formatTime24As12(p.firstStart)} to ${to}`;
}

export interface DurationChoice {
  /** How many consecutive slots this length takes. */
  slotCount: number;
  minutes: number;
  label: string;
  /** When it would end (an ISO instant, the last slot's ends_at). */
  endsAt: string;
}

/**
 * The booking lengths a player can pick when they tap `slots[index]`: one slot, two slots ... as long as every
 * following slot is open and directly follows the last (no gap, nothing booked or blocked in between) and the
 * total stays within MAX_BOOKING_MINUTES. Always includes at least the tapped slot. The price and the final say
 * still come from the server (GET /courts/:id/quote); this only decides which chips to offer.
 */
export function durationChoices(slots: Slot[], index: number, slotMinutes: number, maxMinutes = MAX_BOOKING_MINUTES): DurationChoice[] {
  const choices: DurationChoice[] = [];
  for (let i = index, count = 1; i < slots.length; i++, count++) {
    const slot = slots[i];
    if (slot.status !== "available") break;
    if (i > index && slots[i - 1].ends_at !== slot.starts_at) break;
    const minutes = count * slotMinutes;
    if (count > 1 && minutes > maxMinutes) break;
    choices.push({ slotCount: count, minutes, label: formatDuration(minutes), endsAt: slot.ends_at });
  }
  return choices;
}

/** The plain-language cancellation policy of a VENUE (Section 32 Part 4: one policy per venue). */
export function cancellationPolicyText(
  venue: { cancellation_allowed: boolean; cancellation_cutoff_hours: number | null } | null | undefined,
): string {
  if (!venue) return "";
  if (!venue.cancellation_allowed) return "This venue does not allow cancellations once booked.";
  if (venue.cancellation_cutoff_hours != null) {
    return `Free cancellation up to ${venue.cancellation_cutoff_hours}h before your booking.`;
  }
  return "You can cancel any time before your booking starts.";
}
