/**
 * Pure rules behind the Floodlight PLAYER screens (Venue picker, confirm sheet, Pay, Status, Bookings, Chat tab, Home).
 * No React / RN imports so node:test can pin them (lib/player-flow.test.ts). Every value comes from the API; nothing here
 * invents a price, a policy or availability.
 */
import { slotChipState, type SlotChipState } from "@court-booking/ui-tokens";
import { addDays, pktDateString, pktParts, type Booking, type Slot } from "@court-booking/types";

export type Lang = "ru" | "en";
const pick = (lang: Lang, ru: string, en: string) => (lang === "en" ? en : ru);

/* ------------------------------------------------------------------ hold errors */

export interface HoldErrorCopy {
  title: string;
  body: string;
  /** The slot list is stale: refetch availability and clear the pick. */
  refreshSlots: boolean;
}

/** POST /bookings/hold error code -> what the confirm sheet says (docs/floodlight-contract.md section (a) error table). */
export function holdErrorCopy(code: string | null | undefined, lang: Lang = "ru", fallback?: string): HoldErrorCopy {
  switch (code) {
    case "SLOT_ALREADY_TAKEN":
      return {
        title: pick(lang, "Ye waqt abhi kisi aur ne le liya", "Someone just took this time"),
        body: pick(lang, "Slots dobara load ho gaye hain. Koi aur khaali waqt chunein.", "The slots were refreshed. Pick another free time."),
        refreshSlots: true,
      };
    case "SLOT_IN_PAST":
      return {
        title: pick(lang, "Ye waqt guzar chuka hai", "This time has already started"),
        body: pick(lang, "Aage ka koi waqt chunein.", "Pick a later time."),
        refreshSlots: true,
      };
    case "SLOT_BLOCKED":
      return {
        title: pick(lang, "Venue ne ye waqt band kiya hai", "The venue has closed this time"),
        body: pick(lang, "Koi aur waqt chunein.", "Pick another time."),
        refreshSlots: true,
      };
    case "BELOW_MINIMUM_BOOKING_TIME":
    case "INVALID_DURATION":
      return {
        title: pick(lang, "Ye lambai is court par nahi chalti", "This length doesn't work on this court"),
        body: pick(lang, "Kitni der dobara chunein.", "Pick the length again."),
        refreshSlots: true,
      };
    case "INVALID_SLOT_TIME":
      return {
        title: pick(lang, "Ye waqt ab list mein nahi", "This time is no longer offered"),
        body: pick(lang, "Slots dobara load ho gaye hain. List se waqt chunein.", "The slots were refreshed. Pick a time from the list."),
        refreshSlots: true,
      };
    case "BOOKING_TOO_FAR":
      return {
        title: pick(lang, "Itni aage ki booking abhi nahi", "That's too far ahead"),
        body: pick(lang, "Ye venue itne din aage tak booking nahi leta. Qareeb ka din chunein.", "This venue doesn't take bookings that far ahead. Pick a nearer day."),
        refreshSlots: false,
      };
    case "VENUE_NOT_APPROVED":
      return {
        title: pick(lang, "Venue abhi live nahi", "This venue isn't live yet"),
        body: pick(lang, "Is venue par abhi booking nahi ho sakti.", "Bookings aren't open at this venue yet."),
        refreshSlots: false,
      };
    case "NOT_FOUND":
      return {
        title: pick(lang, "Ye court ab dastiyab nahi", "This court isn't available"),
        body: pick(lang, "Koi aur court chunein.", "Pick another court."),
        refreshSlots: true,
      };
    default:
      return {
        title: pick(lang, "Hold nahi ho saka", "Couldn't hold the slot"),
        body: fallback ?? pick(lang, "Dobara koshish karein.", "Please try again."),
        refreshSlots: false,
      };
  }
}

/* ------------------------------------------------------------------ cancellation */

export interface VenuePolicy {
  cancellation_allowed: boolean;
  cancellation_cutoff_hours: number | null;
}

const hoursWord = (n: number, lang: Lang) => (lang === "en" ? `${n} hour${n === 1 ? "" : "s"}` : `${n} ghante`);

/**
 * One honest sentence for a venue's cancellation policy, built only from `cancellation_allowed` +
 * `cancellation_cutoff_hours` (no free-text policy exists). The refund rule is the server's: an allowed cancel refunds
 * the full amount paid (booking_service.py), sent by the venue itself.
 */
export function cancelPolicySentence(venue: VenuePolicy | null | undefined, lang: Lang = "ru"): string | null {
  if (!venue) return null;
  if (!venue.cancellation_allowed) {
    return pick(lang, "Booking pakki hone ke baad cancel nahi ho sakti.", "Once the booking is confirmed it can't be cancelled.");
  }
  if (venue.cancellation_cutoff_hours != null && venue.cancellation_cutoff_hours > 0) {
    const h = venue.cancellation_cutoff_hours;
    return pick(
      lang,
      `Shuru hone se ${hoursWord(h, lang)} pehle tak cancel: jitna diya, poora wapas. Us ke baad cancel nahi.`,
      `Cancel up to ${hoursWord(h, lang)} before the start for a full refund of what you paid. No cancelling after that.`,
    );
  }
  return pick(lang, "Shuru hone se pehle kabhi bhi cancel: jitna diya, poora wapas.", "Cancel any time before the start for a full refund of what you paid.");
}

/** Short value for the confirm sheet row ("Cancel"). */
export function cancelPolicyShort(venue: VenuePolicy | null | undefined, lang: Lang = "ru"): string | null {
  if (!venue) return null;
  if (!venue.cancellation_allowed) return pick(lang, "Pakki ke baad nahi", "Not after confirming");
  if (venue.cancellation_cutoff_hours != null && venue.cancellation_cutoff_hours > 0) {
    return pick(lang, `${hoursWord(venue.cancellation_cutoff_hours, lang)} pehle tak, poora paisa wapas`, `Up to ${hoursWord(venue.cancellation_cutoff_hours, lang)} before, full refund`);
  }
  return pick(lang, "Shuru se pehle kabhi bhi, poora paisa wapas", "Any time before the start, full refund");
}

export type CancelBlock = "not_allowed" | "window_closed" | "status";
export interface CancelState {
  canCancel: boolean;
  blocked?: CancelBlock;
  /** When a cutoff applies: the last moment a cancel is allowed (ms). */
  cutoffAt?: number;
}

/** Mirrors the server rule (booking_service.py:433-521) for the UI; the server re-checks on cancel. */
export function cancelState(
  booking: Pick<Booking, "status" | "starts_at">,
  venue: VenuePolicy | null | undefined,
  now: number = Date.now(),
): CancelState {
  if (booking.status === "held" || booking.status === "payment_submitted") return { canCancel: true };
  if (booking.status !== "booked") return { canCancel: false, blocked: "status" };
  if (!venue) return { canCancel: false, blocked: "status" };
  if (!venue.cancellation_allowed) return { canCancel: false, blocked: "not_allowed" };
  if (venue.cancellation_cutoff_hours != null && venue.cancellation_cutoff_hours > 0) {
    const cutoffAt = Date.parse(booking.starts_at) - venue.cancellation_cutoff_hours * 3_600_000;
    return now < cutoffAt ? { canCancel: true, cutoffAt } : { canCancel: false, blocked: "window_closed", cutoffAt };
  }
  return Date.parse(booking.starts_at) > now ? { canCancel: true } : { canCancel: false, blocked: "window_closed" };
}

/** Error code from POST /bookings/:id/cancel -> plain words. */
export function cancelErrorCopy(code: string | null | undefined, lang: Lang = "ru", fallback?: string): string {
  if (code === "CANCELLATION_NOT_ALLOWED") return pick(lang, "Ye venue pakki booking cancel nahi karne deta.", "This venue doesn't allow cancelling a confirmed booking.");
  if (code === "CANCELLATION_WINDOW_CLOSED") return pick(lang, "Cancel ka waqt guzar gaya.", "The cancellation window has closed.");
  return fallback ?? pick(lang, "Cancel nahi ho saka. Dobara koshish karein.", "Couldn't cancel. Please try again.");
}

/* ------------------------------------------------------------------ venue slot picker */

/** True when `slotCount` consecutive, back-to-back AVAILABLE slots start at index `i`. */
export function fitsFrom(slots: readonly Pick<Slot, "status" | "starts_at" | "ends_at">[], i: number, slotCount: number): boolean {
  if (i < 0 || i + slotCount > slots.length) return false;
  for (let k = i; k < i + slotCount; k++) {
    if (slots[k].status !== "available") return false;
    if (k > i && slots[k - 1].ends_at !== slots[k].starts_at) return false;
  }
  return true;
}

export interface PickerItem {
  slot: Slot;
  state: SlotChipState;
}

export interface PickerModel {
  items: PickerItem[];
  /** The valid chosen start (null when the pick no longer fits: length changed, slot taken). */
  start: string | null;
  /** starts_at of every slot in the booking (start included). */
  range: string[];
  /** Start / end of the whole booking. */
  startsAt: string | null;
  endsAt: string | null;
}

/** SlotOut[] + chosen length + chosen start -> one chip state per slot (null-state slots, i.e. past free ones, are dropped). */
export function pickerModel(slots: readonly Slot[], slotCount: number, chosenStart: string | null, now: number): PickerModel {
  const n = Math.max(1, slotCount);
  const startIdx = chosenStart ? slots.findIndex((s) => s.starts_at === chosenStart) : -1;
  const valid = startIdx >= 0 && Date.parse(slots[startIdx].starts_at) > now && fitsFrom(slots, startIdx, n);
  const range = valid ? slots.slice(startIdx, startIdx + n).map((s) => s.starts_at) : [];
  const items: PickerItem[] = [];
  slots.forEach((slot, i) => {
    const state = slotChipState(slot, {
      now,
      selectedStart: valid ? slots[startIdx].starts_at : null,
      inRange: range.slice(1),
      fits: fitsFrom(slots, i, n),
    });
    if (state) items.push({ slot, state });
  });
  return {
    items,
    start: valid ? slots[startIdx].starts_at : null,
    range,
    startsAt: valid ? slots[startIdx].starts_at : null,
    endsAt: valid ? slots[startIdx + n - 1].ends_at : null,
  };
}

/** Length choices for the "Kitni der" step: the court's minimum and the next two half-hour steps (max 6 hours). */
export function durationOptions(minSlots: number, maxSlots = 12): number[] {
  const base = Math.max(1, minSlots);
  return [base, base + 1, base + 2].filter((n) => n <= maxSlots);
}

/** Next `count` Pakistan dates from today, never past the venue's booking horizon (today counts as day 1). */
export function venueDays(today: string, horizonDays: number | null | undefined, count = 7): string[] {
  const max = Math.max(1, Math.min(count, horizonDays && horizonDays > 0 ? horizonDays : count));
  return Array.from({ length: max }, (_, i) => addDays(today, i));
}

/* ------------------------------------------------------------------ home */

type B = Pick<Booking, "id" | "status" | "starts_at" | "ends_at" | "court_id" | "held_until">;

/** Home "Next game": ONLY a real upcoming booking the venue has confirmed (status booked) that hasn't ended. */
export function nextGame<T extends B>(upcoming: readonly T[], now: number = Date.now()): T | null {
  let best: T | null = null;
  for (const b of upcoming) {
    if (b.status !== "booked" || Date.parse(b.ends_at) <= now) continue;
    if (!best || Date.parse(b.starts_at) < Date.parse(best.starts_at)) best = b;
  }
  return best;
}

/** Home "Phir se khelo": the player's real past games (completed, or booked and already over), one per court, newest first. */
export function replayList<T extends B>(past: readonly T[], now: number = Date.now(), max = 3): T[] {
  const played = past
    .filter((b) => b.status === "completed" || (b.status === "booked" && Date.parse(b.ends_at) <= now))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const b of played) {
    if (seen.has(b.court_id)) continue;
    seen.add(b.court_id);
    out.push(b);
    if (out.length >= max) break;
  }
  return out;
}

/** Hour (PKT) from which a free slot counts as "aaj raat". */
export const TONIGHT_FROM_HOUR = 17;

/**
 * Real open start times for tonight across a venue's courts (GET /venues/:id/availability): free slots that start from
 * now and from 5 PM PKT today, where the court's minimum length fits. Deduped by time, earliest first.
 */
export function tonightStarts(
  courts: readonly { min_slots: number; slots: readonly Slot[] }[],
  now: number = Date.now(),
): string[] {
  const today = pktDateString(now);
  const byInstant = new Map<number, string>();
  for (const c of courts) {
    c.slots.forEach((s, i) => {
      const t = Date.parse(s.starts_at);
      if (t <= now || pktDateString(t) !== today || pktParts(t).hour < TONIGHT_FROM_HOUR) return;
      if (!fitsFrom(c.slots, i, Math.max(1, c.min_slots))) return;
      if (!byInstant.has(t)) byInstant.set(t, s.starts_at);
    });
  }
  return [...byInstant.entries()].sort((a, b) => a[0] - b[0]).map(([, iso]) => iso);
}

/* ------------------------------------------------------------------ chat tab */

/**
 * Chat tab rows (backend has no conversation list, contract B1): one row per booking that can have a booking chat,
 * i.e. live ones (held / venue check / booked and not over) plus games from the last `recentDays`. Live first (soonest),
 * then recent (newest). Capped so the tab makes at most `max` history calls.
 */
export function chatCandidates<T extends B>(bookings: readonly T[], now: number = Date.now(), recentDays = 7, max = 8): T[] {
  const byId = new Map<string, T>();
  for (const b of bookings) byId.set(b.id, b);
  const all = [...byId.values()];
  const live = all
    .filter((b) => (b.status === "held" || b.status === "payment_submitted" || b.status === "booked") && Date.parse(b.ends_at) > now)
    .filter((b) => !(b.status === "held" && b.held_until && Date.parse(b.held_until) <= now))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const liveIds = new Set(live.map((b) => b.id));
  const since = now - recentDays * 86_400_000;
  const recent = all
    .filter((b) => !liveIds.has(b.id) && Date.parse(b.starts_at) >= since && (Date.parse(b.starts_at) <= now || b.status === "cancelled"))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return [...live, ...recent].slice(0, max);
}

/* ------------------------------------------------------------------ bookings list */

export type BookingAction = "pay" | "status" | "ticket" | "rate" | "details";

/** The ONE main action on a bookings-list card. */
export function bookingAction(b: Pick<Booking, "status" | "held_until">, now: number = Date.now()): BookingAction {
  if (b.status === "held") return b.held_until && Date.parse(b.held_until) <= now ? "details" : "pay";
  if (b.status === "payment_submitted") return "status";
  if (b.status === "booked") return "ticket";
  if (b.status === "completed") return "rate";
  return "details";
}

/** Total / Mila / Baqi from BookingOut (contract section (c)). Labels only; values are formatted by the screen. */
export function moneyBreakdown(b: Pick<Booking, "price" | "advance_amount" | "amount_paid" | "balance_due">): {
  total: number;
  advance: number;
  paid: number;
  due: number;
} {
  return { total: b.price, advance: b.advance_amount, paid: b.amount_paid, due: b.balance_due };
}
