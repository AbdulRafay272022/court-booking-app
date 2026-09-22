export type SlotStatus = "available" | "held" | "payment_submitted" | "booked" | "blocked";

export interface Slot {
  starts_at: string;
  ends_at: string;
  status: SlotStatus;
  price: number;
  advance_amount: number;
  held_until: string | null;
  booking_id: string | null;
  /** True when the signed-in viewer is the player on this slot's live booking (never for anonymous). */
  is_mine: boolean;
  reason: string | null;
  /** True for a slot that starts after midnight on an overnight court: it is in the OPENING day's list, but its own date is
   * the next day (show it as "Fri 1:00 AM"). */
  after_midnight: boolean;
}

/** GET /courts/:id/quote?starts_at=&slot_count= -- the total for a booking of several consecutive slots, priced
 * slot by slot with the court's own rules. The hold charges exactly this. */
export interface BookingQuote {
  court_id: string;
  starts_at: string;
  ends_at: string;
  slot_count: number;
  slot_minutes: number;
  duration_minutes: number;
  price: number;
  advance_amount: number;
  balance_due: number;
}

/** GET /courts/:id/availability?date= */
export interface CourtAvailability {
  court_id: string;
  date: string;
  slot_minutes: number;
  slots: Slot[];
}

/** GET /courts/:id/availability?start_date=&end_date= (max 28 days) */
export interface DateSlots {
  date: string;
  slots: Slot[];
}

export interface RangeAvailability {
  court_id: string;
  slot_minutes: number;
  days: DateSlots[];
}

/** GET /venues/:id/availability?date= — one entry per active court */
export interface VenueCourtAvailability {
  court_id: string;
  court_name: string;
  slot_minutes: number;
  slots: Slot[];
}

export interface VenueAvailability {
  venue_id: string;
  date: string;
  courts: VenueCourtAvailability[];
}

/** One day on a court's month calendar (Section 32 Part 4b): `past` (before today) | `beyond` (past the venue's
 * booking horizon) | `closed` (no schedule that day, or every slot blocked) | `full` (nothing open) | `few`
 * (almost full: <=20% of the day's slots open, at least 1) | `open`. */
export type DaySummaryState = "past" | "beyond" | "closed" | "full" | "few" | "open";

export interface DaySummary {
  date: string;
  state: DaySummaryState;
  open_slots: number;
  total_slots: number;
}

/** GET /courts/:id/availability/summary?month=YYYY-MM -- one row per day of the month, computed from one
 * in-memory read (not one query per day). Powers the calendar-first venue page's month dots. */
export interface CourtMonthSummary {
  court_id: string;
  month: string; // "2026-09"
  slot_minutes: number;
  /** The lowest active price on this court (floodlight surcharge included); null if it has no price yet. */
  starts_from_price: number | null;
  booking_horizon_days: number;
  last_bookable_date: string;
  days: DaySummary[];
}
