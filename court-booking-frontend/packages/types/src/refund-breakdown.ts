/**
 * Round 2 (A10): the four numbers of a refund, one implementation for web and mobile.
 * New backend fields (`player_sent`, `refund_due`, `already_refunded`) are preferred; an older backend only sends
 * `refund_amount` / `refunded_amount` / `remaining_amount`, so those are the fallback.
 */
import type { OwnerRefund } from "./owner";

export type RefundBreakdownStatus = "none" | "owed" | "partial" | "done";

export interface RefundBreakdown {
  /** What the player actually paid in for this booking (null = the server did not say). */
  playerSent: number | null;
  /** The refund the policy owes. */
  refundDue: number;
  /** Already sent back by the owner. */
  alreadyRefunded: number;
  /** Still to send back (never negative). */
  remaining: number;
  /** none = nothing owed at all; owed = nothing sent yet; partial = some sent ("Hissa wapas"); done = fully sent. */
  status: RefundBreakdownStatus;
}

type RefundLike = Pick<OwnerRefund, "refund_amount" | "refunded_amount" | "refund_status"> &
  Partial<Pick<OwnerRefund, "remaining_amount" | "player_sent" | "refund_due" | "already_refunded">>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function refundBreakdown(r: RefundLike): RefundBreakdown {
  const refundDue = Math.max(0, num(r.refund_due) ?? num(r.refund_amount) ?? 0);
  const alreadyRefunded = Math.max(0, num(r.already_refunded) ?? num(r.refunded_amount) ?? 0);
  const remainingRaw = num(r.remaining_amount) ?? refundDue - alreadyRefunded;
  const remaining = Math.max(0, Math.round(remainingRaw * 100) / 100);
  const playerSent = num(r.player_sent);

  let status: RefundBreakdownStatus;
  if (refundDue <= 0 && alreadyRefunded <= 0) status = "none";
  else if (r.refund_status === "refunded" || remaining <= 0) status = "done";
  else if (alreadyRefunded > 0) status = "partial";
  else status = "owed";

  return { playerSent, refundDue, alreadyRefunded, remaining, status };
}

/** Client-side check before submit: the typed amount must be > 0 and not above what is still owed. */
export function refundAmountError(
  typed: number,
  remaining: number,
): "empty" | "not_positive" | "exceeds" | null {
  if (!Number.isFinite(typed)) return "empty";
  if (typed <= 0) return "not_positive";
  if (typed > remaining + 1e-9) return "exceeds";
  return null;
}

/** Loose payment reference check: at least 4 visible characters, at least one letter or digit, max 80. */
export function isPlausibleRefundReference(ref: string): boolean {
  const t = ref.trim();
  return t.length >= 4 && t.length <= 80 && /[A-Za-z0-9]/.test(t);
}
