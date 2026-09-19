export type SlotStatus = "available" | "held" | "payment_submitted" | "booked" | "blocked";

export interface Slot {
  starts_at: string;
  ends_at: string;
  status: SlotStatus;
  price: number;
  advance_amount: number;
  held_until: string | null;
  booking_id: string | null;
  reason: string | null;
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
