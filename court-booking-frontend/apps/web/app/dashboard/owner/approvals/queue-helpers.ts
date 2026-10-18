/** Pure helpers for the Approvals list (Round 2, A1/A5/A10.3). Unit-tested in queue-helpers.test.ts. */
import type { ApprovalQueueItem, ApprovalState, ApproveAcceptMode } from "@court-booking/types";

export const PAGE_SIZE = 50;

/** Flattens the loaded pages, dropping repeats (a card can move to the next page while an earlier one is acted on). */
export function mergePages(pages: { items: ApprovalQueueItem[] }[] | undefined): ApprovalQueueItem[] {
  const seen = new Set<string>();
  const out: ApprovalQueueItem[] = [];
  for (const p of pages ?? []) {
    for (const item of p.items) {
      if (seen.has(item.payment_id)) continue;
      seen.add(item.payment_id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Which cards to show, in which order. `serverIds` is the server's order (newest first, stable because submitted_at never
 * changes). While a dialog is open the list is frozen to `snapshot` so a poll never moves a card under the owner's hand
 * (new arrivals wait until the dialog closes; cards that left the server still leave). `hidden` = acted on optimistically.
 */
export function visibleIds(serverIds: string[], snapshot: string[] | null, hidden: ReadonlySet<string>): string[] {
  const present = new Set(serverIds);
  return (snapshot ?? serverIds).filter((id) => present.has(id) && !hidden.has(id));
}

/** "N approvals baqi": the server total minus the cards already acted on that the server still lists. */
export function remainingCount(total: number, serverIds: string[], hidden: ReadonlySet<string>): number {
  return Math.max(0, total - serverIds.filter((id) => hidden.has(id)).length);
}

export function hasMore(loaded: number, total: number): boolean {
  return loaded < total;
}

export type AmountChip = { kind: "match"; amount: number } | { kind: "mismatch"; read: number; expected: number } | { kind: "unread"; expected: number };

/** Expected vs screenshot (OCR) amount, for the chip on each card. */
export function amountChip(item: Pick<ApprovalQueueItem, "ocr_amount" | "ocr_verdict" | "expected_amount">): AmountChip {
  if (item.ocr_amount == null) return { kind: "unread", expected: item.expected_amount };
  if (item.ocr_amount === item.expected_amount) return { kind: "match", amount: item.ocr_amount };
  return { kind: "mismatch", read: item.ocr_amount, expected: item.expected_amount };
}

/** The amount the approve dialog starts with: what the checks say was paid, else the OCR amount, else the expected advance. */
export function defaultApproveAmount(item: Pick<ApprovalQueueItem, "checks" | "ocr_amount" | "expected_amount">): number {
  return item.checks?.paid_amount ?? item.ocr_amount ?? item.expected_amount;
}

/** Parses the typed amount: whole rupees above 0, else null. */
export function parseAmount(text: string): number | null {
  const v = text.trim().replace(/,/g, "");
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/**
 * The overpayment choice (A10.3) is offered when the server flagged an overpayment and the confirmed amount is still above the
 * expected advance. Returns the numbers for the two radio labels, or null when there is nothing to choose.
 */
export function overpaymentChoice(item: Pick<ApprovalQueueItem, "overpayment" | "expected_amount">, amount: number | null): { expected: number; paid: number; excess: number } | null {
  if (!item.overpayment || amount == null) return null;
  const expected = item.overpayment.expected || item.expected_amount;
  if (amount <= expected) return null;
  return { expected, paid: amount, excess: amount - expected };
}

/** What goes to POST /payments/{id}/approve. accept_mode only when the choice was shown. */
export function approveArgs(
  item: Pick<ApprovalQueueItem, "checks" | "overpayment" | "expected_amount">,
  amount: number | null,
  mode: ApproveAcceptMode,
): { amountPkr: number | undefined; acceptMode: ApproveAcceptMode | undefined } {
  const choice = overpaymentChoice(item, amount);
  return {
    amountPkr: item.checks || choice ? (amount ?? undefined) : undefined,
    acceptMode: choice ? mode : undefined,
  };
}

/** A card that can only be acknowledged (the booking is gone). */
export function isClosedState(state: ApprovalState): boolean {
  return state !== "awaiting";
}

/** The state carried by a 409 BOOKING_NO_LONGER_PENDING (`details.state`), defaulting to "cancelled_by_player". */
export function stateFrom409(details: Record<string, unknown> | undefined): ApprovalState {
  const s = details?.state;
  return s === "expired" || s === "cancelled_by_owner" || s === "cancelled_by_player" ? s : "cancelled_by_player";
}

/** The reason sent to the backend (and the player) on Reject: the chosen preset (English value), plus the typed note. */
export function rejectReasonText(preset: string | null, note: string): string | null {
  const n = note.trim();
  if (preset === "Other" || preset === null) return n || null;
  return n ? `${preset} - ${n}` : preset;
}
