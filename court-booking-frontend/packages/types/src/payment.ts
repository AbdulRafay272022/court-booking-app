import type { Booking } from "./booking";

export type OcrVerdict = "match" | "mismatch" | "unreadable";
export type ReviewVerdict = "approved" | "rejected";

/** Section 32 Part 7 -- verdicts computed once at submission time. */
export type NameMatchVerdict = "match" | "mismatch" | "unavailable";
export type TimeCheckVerdict = "within_timer" | "before_hold" | "after_timer" | "not_visible";
export type ReceiverMatchVerdict = "match" | "mismatch" | "not_configured" | "unavailable";

export interface Payment {
  id: string;
  booking_id: string;
  proof_url: string | null;
  proof_hash: string | null;
  expected_amount: number | null;
  ocr_amount: number | null;
  ocr_ref: string | null;
  ocr_verdict: OcrVerdict | null;
  ocr_confidence: number | null;
  // Section 32 Part 7
  ocr_payer_name: string | null;
  ocr_bank: string | null;
  ocr_receiver: string | null;
  ocr_flags: string[] | null;
  name_match_verdict: NameMatchVerdict | null;
  time_check_verdict: TimeCheckVerdict | null;
  receiver_match_verdict: ReceiverMatchVerdict | null;
  is_duplicate: boolean;
  duplicate_of: string | null;
  review_verdict: ReviewVerdict | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  auto_approved: boolean;
  created_at: string;
}

/** One plain-language check for the owner's approval card -- `text` is a
 * ready-made sentence from the backend; never re-derive or hand-roll it
 * client-side (same "hand it a ready-made string" convention this codebase
 * already uses for money/time in the AI chat). */
export interface PaymentCheck {
  verdict: "match" | "mismatch" | "warning" | "not_available" | "not_configured";
  text: string;
}

/** Section 32 Part 7 -- the five plain-language checks shown on the
 * owner's approval card. Purely informational: nothing here means the
 * payment was rejected, only that the owner should look closer. */
export interface PaymentChecks {
  name: PaymentCheck;
  amount: PaymentCheck;
  balance_text: string;
  time: PaymentCheck;
  bank: PaymentCheck;
  duplicate: PaymentCheck;
}

export interface PaymentProofOut {
  payment: Payment;
  booking: Booking;
}

export interface ProofUrlOut {
  url: string;
  expires_in: number;
}
