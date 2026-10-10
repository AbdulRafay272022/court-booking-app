import type { Slot } from "./availability";
import { formatTime24As12, parseTime24 } from "./datetime";

/** The ONE slot grid of every court (Section 32 Part 4c): slots are 30 minutes, whatever the court's own setting. Mirrors
 * the backend's GRID_MINUTES. */
export const GRID_MINUTES = 30;

/** How many consecutive 30-minute slots a court's minimum booking time is (60 min -> 2, 90 -> 3, 120 -> 4). Mirrors the
 * backend's min_slots(). */
export function minSlotsFor(minBookingMinutes: number): number {
  return Math.max(1, Math.ceil(minBookingMinutes / GRID_MINUTES));
}

/** Minimum booking times an owner may choose per court (90 is here for padel). The court's `slot_minutes` setting IS its
 * minimum booking time now; the slot grid itself is always 30 minutes. Mirrors the backend's ALLOWED_SLOT_MINUTES. */
export const SLOT_MINUTES_OPTIONS = [30, 60, 90, 120] as const;

/** Longest single booking a player can make, whatever the court's slot length. Mirrors the backend's
 * MAX_BOOKING_MINUTES (raised 240 -> 360 in post-batch #8: a long evening / near-overnight booking needs
 * more than 4 hours). Keep this in step with the backend constant. */
export const MAX_BOOKING_MINUTES = 360;

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
  /** How many consecutive 30-minute slots this length takes. */
  slotCount: number;
  minutes: number;
  label: string;
  /** Total of the slots' own prices (a client-side estimate for the row; the server quote is the final word). */
  price: number;
  /** When it would end (an ISO instant, the last slot's ends_at). */
  endsAt: string;
}

/**
 * The booking lengths that can start at `slots[index]` on the 30-minute grid: `minSlots` slots (the court's minimum
 * booking time), then one more slot at a time, as long as every slot is open and directly follows the last (no gap,
 * nothing booked or blocked in between) and the total stays within MAX_BOOKING_MINUTES. EMPTY when the minimum does
 * not fit from here (a lone free half hour on a 60-minute court, or too close to closing time). Lengths are measured
 * from the slots themselves. The price and the final say still come from the server (GET /courts/:id/quote); this
 * only decides which choices to offer. Used by the player picker (chips) and the owner walk-in (slot selection).
 */
export function durationChoices(slots: Slot[], index: number, minSlots = 1, maxMinutes = MAX_BOOKING_MINUTES): DurationChoice[] {
  const choices: DurationChoice[] = [];
  let minutes = 0;
  let price = 0;
  for (let i = index, count = 1; i < slots.length; i++, count++) {
    const slot = slots[i];
    if (slot.status !== "available") break;
    if (i > index && slots[i - 1].ends_at !== slot.starts_at) break;
    minutes += Math.round((Date.parse(slot.ends_at) - Date.parse(slot.starts_at)) / 60000);
    price += slot.price;
    if (count > 1 && minutes > maxMinutes) break;
    if (count < minSlots) continue;
    choices.push({ slotCount: count, minutes, label: formatDuration(minutes), endsAt: slot.ends_at, price: Math.round(price * 100) / 100 });
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

/**
 * The slots the owner walk-in screen OFFERS (mirrors the backend rule, error WALKIN_IN_PAST): a slot whose 30 minutes have
 * already ended is not offered; the slot in progress (started, not ended) still is, because owners log people who have just
 * arrived. Judged by the real instant (`ends_at` against `now`), so an overnight court's 1:00 AM slot, which belongs to the
 * PREVIOUS schedule day, is judged by when it actually happens.
 *
 * `todaySlots` is the schedule day being viewed. For TODAY (`includeYesterdayTail`) the previous schedule day's after-midnight
 * slots are added first: at 1:10 AM an overnight court is still open on yesterday's schedule, and its 1:00 AM slot is the one
 * in progress. A date picker that never goes before today still reaches it this way.
 */
export function walkinSlots(
  todaySlots: Slot[],
  previousDaySlots: Slot[] | undefined,
  includeYesterdayTail: boolean,
  now: number | Date = Date.now(),
): Slot[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const tail = includeYesterdayTail ? (previousDaySlots ?? []).filter((s) => s.after_midnight) : [];
  return [...tail, ...todaySlots].filter((s) => Date.parse(s.ends_at) > nowMs);
}


/**
 * The slots a PLAYER can still use at `now`: drops slots that have already ended, and free slots that have already started
 * (the server refuses a hold whose start is not in the future). A slot that is under way but taken (somebody's booking, a
 * blackout, the player's own) stays so the list still tells the truth about it. A future day passes through untouched.
 */
export function upcomingSlots(slots: Slot[], now: number | Date = Date.now()): Slot[] {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return slots.filter((s) => Date.parse(s.ends_at) > nowMs && (s.status !== "available" || Date.parse(s.starts_at) > nowMs));
}
