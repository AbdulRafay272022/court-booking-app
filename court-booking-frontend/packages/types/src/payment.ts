import type { Booking } from "./booking";

export type OcrVerdict = "match" | "mismatch" | "unreadable";
export type ReviewVerdict = "approved" | "rejected";

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
  is_duplicate: boolean;
  duplicate_of: string | null;
  review_verdict: ReviewVerdict | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  auto_approved: boolean;
  created_at: string;
}

export interface PaymentProofOut {
  payment: Payment;
  booking: Booking;
}

export interface ProofUrlOut {
  url: string;
  expires_in: number;
}
