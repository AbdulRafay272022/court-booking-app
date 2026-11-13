/** Section 32 Part 5: the append-only ledger of real money recorded against a booking -- separate from
 * `Payment` (OCR payment-PROOF review, see payment.ts). */
export type PaymentMethod = "bank_transfer_proof" | "cash_at_venue" | "other";

export interface PaymentEntry {
  id: string;
  booking_id: string;
  amount_pkr: number;
  method: PaymentMethod;
  recorded_by: string | null;
  note: string | null;
  /** Set only on a correction entry: the id of the entry it reverses. */
  reverses_entry_id: string | null;
  created_at: string;
}

export interface RecordPaymentEntryInput {
  amount_pkr: number;
  method: PaymentMethod;
  note?: string;
  /** ledger v2: an earlier business day ("YYYY-MM-DD", needs a note), never a later one */
  business_date?: string;
  /** ledger v2: money above the booking total -> refund to the player or keep as their credit (owner only) */
  excess_choice?: "refund" | "credit";
  /** ledger v2: the same amount + method was recorded in the last 10 minutes and this is NOT a duplicate */
  confirm_duplicate?: boolean;
}

/** POST /bookings/:id/payment-entries */
export interface PaymentEntryResult {
  entry: PaymentEntry;
  amount_paid: number;
  balance_due: number;
}
