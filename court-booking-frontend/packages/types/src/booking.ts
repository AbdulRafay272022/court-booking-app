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
  /** How many consecutive slots (the court's slot length each) to book as one booking. Default 1. */
  slot_count?: number;
}

export interface HoldBookingOut {
  booking: Booking;
  payment_instructions: PaymentInstructions | null;
}

export interface WalkinBookingInput {
  court_id: string;
  starts_at: string;
  player_name: string;
  player_phone?: string;
  amount_paid: number;
}

export interface BookingListResponse {
  bookings: Booking[];
}
