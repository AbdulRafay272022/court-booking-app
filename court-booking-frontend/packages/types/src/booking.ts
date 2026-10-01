export type BookingStatus =
  | "held"
  | "payment_submitted"
  | "booked"
  | "completed"
  | "no_show"
  | "cancelled";

export type BookingSource = "app" | "whatsapp" | "walkin" | "phone";
export type CancelledBy = "player" | "owner" | "system";

export interface Booking {
  id: string;
  court_id: string;
  player_id: string | null;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  source: BookingSource;
  player_name: string | null;
  player_phone: string | null;
  price: number;
  advance_amount: number;
  amount_paid: number;
  balance_due: number;
  held_until: string | null;
  payment_deadline: string | null;
  cancelled_by: CancelledBy | null;
  cancellation_reason: string | null;
  checked_in_at: string | null;
  /** Section 32 Part 9: "owner" (scanned the player's own QR / tapped Check in on Today)
   * or "player" (self-check-in via the venue's printed QR). Null until checked in. */
  checked_in_by: "owner" | "player" | null;
  created_at: string;
}

export interface PaymentInstructions {
  bank: string | null;
  account_title: string | null;
  account_number: string | null;
  iban: string | null;
  amount: number;
}

export interface HoldBookingInput {
  court_id: string;
  starts_at: string;
  /** How many consecutive 30-minute slots to book as one booking (at least the court's minimum). Omitted = the minimum. */
  slot_count?: number;
  /** The name the booking is made under when the player gave one in the chat (their own, or a friend's). Omit to use the account's name. */
  player_name?: string;
}

export interface HoldBookingOut {
  booking: Booking;
  payment_instructions: PaymentInstructions | null;
}

export interface WalkinBookingInput {
  court_id: string;
  starts_at: string;
  /** Consecutive 30-minute slots in this one booking (Part 4c). Omitted = the court's minimum booking. */
  slot_count?: number;
  /** Who the booking is for (required). */
  player_name: string;
  /** Optional Pakistani mobile (any common form; the server stores +923XXXXXXXXX and links an existing account). */
  player_phone?: string;
  amount_paid: number;
}

export interface BookingListResponse {
  bookings: Booking[];
}
