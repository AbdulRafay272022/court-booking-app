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
  /** Money-correctness: what the player paid (screenshot amount, else the expected one) -- the editable default
   * for the approve amount field -- vs what this booking's flow expected (advance, or full price). */
  paid_amount: number;
  expected_amount: number;
  payment_status: "paid_in_full" | "overpaid" | "underpaid";
  /** Ready-made: "Paid in full" / "Overpaid by PKR 500" / "Underpaid by PKR 500". */
  payment_status_text: string;
  /** Amount paid on the booking once approved at `paid_amount` (credit is capped at the price). */
  total_after_approval: number;
  balance_after_approval: number;
}

export interface PaymentProofOut {
  payment: Payment;
  booking: Booking;
}

export interface ProofUrlOut {
  url: string;
  expires_in: number;
}

/** What the approval card shows for the amount currently typed into the editable "amount received" field.
 * Mirrors the backend's `build_payment_summary` (which computes the same for the pre-filled default): compares the
 * amount with the expected amount for this booking's flow, and says where the booking ends up after approval.
 * The ledger credits at most the booking price; `excess` is what would be queued as a refund owed. */
export function approvalSummary(
  checks: Pick<PaymentChecks, "expected_amount" | "paid_amount" | "total_after_approval" | "balance_after_approval">,
  amount: number,
  lang: "en" | "ru" = "en",
): {
  status: "paid_in_full" | "overpaid" | "underpaid";
  text: string;
  creditedNow: number;
  totalAfter: number;
  balanceAfter: number;
  excess: number;
} {
  const fmt = (n: number) => `PKR ${Math.round(n).toLocaleString("en-US")}`;
  const price = checks.total_after_approval + checks.balance_after_approval;
  const already = Math.max(checks.total_after_approval - Math.min(checks.paid_amount, price), 0);
  const credited = Math.min(Math.max(amount, 0), price - already);
  const totalAfter = already + credited;
  const balanceAfter = Math.max(price - totalAfter, 0);
  const excess = Math.max(amount - credited, 0);
  if (amount === checks.expected_amount) {
    return { status: "paid_in_full", text: lang === "ru" ? "Poori payment mil gayi" : "Paid in full", creditedNow: credited, totalAfter, balanceAfter, excess };
  }
  if (amount > checks.expected_amount) {
    return {
      status: "overpaid",
      text: lang === "ru" ? `${fmt(amount - checks.expected_amount)} zyada mile` : `Overpaid by ${fmt(amount - checks.expected_amount)}`,
      creditedNow: credited,
      totalAfter,
      balanceAfter,
      excess,
    };
  }
  return {
    status: "underpaid",
    text: lang === "ru" ? `${fmt(checks.expected_amount - amount)} kam mile` : `Underpaid by ${fmt(checks.expected_amount - amount)}`,
    creditedNow: credited,
    totalAfter,
    balanceAfter,
    excess,
  };
}
