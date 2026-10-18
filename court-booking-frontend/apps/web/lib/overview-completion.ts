// "Nahi / short paid" semantics (Round 2, A8). The owner enters how much of the REMAINING due was received now; that amount is
// added to what was paid (a positive entry), never replacing it. Pure, unit-tested in overview-completion.test.ts.
import type { CompletionInput, OwnerBookingRow } from "@court-booking/types";

export type ReceivedNowCheck = { ok: true; value: number } | { ok: false; error: "required" | "range" };

/** "Baqi mein se kitna mila?" must be a whole number of PKR from 0 to the current due. */
export function validateReceivedNow(raw: string, due: number): ReceivedNowCheck {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "") return { ok: false, error: "required" };
  if (!/^\d+$/.test(cleaned)) return { ok: false, error: "range" };
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value) || value < 0 || value > Math.max(0, due)) return { ok: false, error: "range" };
  return { ok: true, value };
}

export interface CompletionPlan {
  receivedNow: number;
  paidAfter: number;
  dueAfter: number;
  /** "yes" (Mukammal) when nothing is left to pay, else "no" (Adhoora). */
  outcome: "yes" | "no";
  /** A reason must be written only when money is still due. */
  reasonRequired: boolean;
}

/** What saving this amount will do to the booking. */
export function planCompletion(row: Pick<OwnerBookingRow, "total_paid" | "due">, receivedNow: number): CompletionPlan {
  const due = Math.max(0, row.due);
  const amount = Math.min(Math.max(0, Math.floor(receivedNow)), due);
  const dueAfter = due - amount;
  return {
    receivedNow: amount,
    paidAfter: row.total_paid + amount,
    dueAfter,
    outcome: dueAfter === 0 ? "yes" : "no",
    reasonRequired: dueAfter > 0,
  };
}

/** True when the form may be saved (a reason is present whenever money stays due). */
export function canSaveCompletion(plan: CompletionPlan, reason: string): boolean {
  return !plan.reasonRequired || reason.trim().length > 0;
}

/**
 * Request body. `received_now` is the new field; `received_pkr` (the new total paid) is sent too so an older backend that does
 * not know `received_now` still records the same amount (the contract says it is ignored when `received_now` is present).
 */
export function completionBody(row: Pick<OwnerBookingRow, "total_paid" | "due">, receivedNow: number, reason: string): CompletionInput {
  const plan = planCompletion(row, receivedNow);
  const text = reason.trim();
  return { result: "no", received_now: plan.receivedNow, received_pkr: plan.paidAfter, reason: text || undefined };
}

/** The row as it will look once the server accepts it (the instant update; the server's row replaces it right after). */
export function applyReceivedNow(row: OwnerBookingRow, receivedNow: number, reason: string): OwnerBookingRow {
  const plan = planCompletion(row, receivedNow);
  return {
    ...row,
    total_paid: plan.paidAfter,
    due: plan.dueAfter,
    completion: {
      result: plan.outcome,
      received_pkr: plan.paidAfter,
      reason: reason.trim() || null,
      marked_at: new Date().toISOString(),
      marked_by_name: row.completion?.marked_by_name ?? null,
    },
  };
}
