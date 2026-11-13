import type {
  Payment,
  PaymentEntry,
  PaymentEntryResult,
  PaymentProofOut,
  ProofUrlOut,
  RecordPaymentEntryInput,
} from "@court-booking/types";
import type { ApiClient } from "./client";

export function createPaymentsApi(client: ApiClient) {
  return {
    /** `amountPkr` = the amount the owner confirms the player really paid; omitted = the screenshot amount
     * (else the expected advance). The ledger credits at most the booking price; any excess is queued as a refund. */
    approve: (
      paymentId: string,
      amountPkr?: number,
      acceptMode?: "advance_only" | "full",
      confirmDuplicate?: boolean,
      excessChoice?: "refund" | "credit",
    ) => {
      const body: Record<string, unknown> = {};
      // ledger v2: money above the booking total -> refund (default in the UI) or player credit (owner only)
      if (excessChoice !== undefined) body.excess_choice = excessChoice;
      if (amountPkr !== undefined) body.amount_pkr = amountPkr;
      // Round 2 (A10.3): what to do with money above the expected advance.
      if (acceptMode !== undefined) body.accept_mode = acceptMode;
      // Stage 2: required to approve a duplicate-flagged screenshot.
      if (confirmDuplicate) body.confirm_duplicate = true;
      return client.request<PaymentProofOut>(`/payments/${paymentId}/approve`, {
        method: "POST",
        ...(Object.keys(body).length ? { body: JSON.stringify(body) } : {}),
      });
    },

    reject: (paymentId: string, reason: string) =>
      client.request<PaymentProofOut>(`/payments/${paymentId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    proofUrl: (paymentId: string) => client.request<ProofUrlOut>(`/payments/${paymentId}/proof-url`),

    listForBooking: (bookingId: string) => client.request<Payment[]>(`/bookings/${bookingId}/payments`),

    /** Section 32 Part 5: the append-only payment_entries ledger (owner-recorded balance payments, a
     * walk-in's amount, the system-recorded advance) -- distinct from the OCR proof review above. */
    recordEntry: (bookingId: string, input: RecordPaymentEntryInput) =>
      client.request<PaymentEntryResult>(`/bookings/${bookingId}/payment-entries`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listEntriesForBooking: (bookingId: string) =>
      client.request<PaymentEntry[]>(`/bookings/${bookingId}/payment-entries`),

    /** ledger v2 "Paisa darj karein" with Transfer: the screenshot goes to Approvals (credited only when approved; the owner
     * can approve at once). `screenshot`: a File/Blob on web, the picked asset's uri on native. */
    recordTransfer: (
      bookingId: string,
      input: { amount_pkr: number; note?: string; excess_choice?: "refund" | "credit" },
      screenshot: string | Blob,
      fileName = "transfer.jpg",
      mimeType = "image/jpeg",
    ) => {
      const form = new FormData();
      form.append("amount_pkr", String(input.amount_pkr));
      if (input.note) form.append("note", input.note);
      if (input.excess_choice) form.append("excess_choice", input.excess_choice);
      const part = typeof screenshot === "string" ? ({ uri: screenshot, name: fileName, type: mimeType } as unknown as Blob) : screenshot;
      form.append("screenshot", part, fileName);
      return client.requestUpload<Payment>(`/bookings/${bookingId}/payment-entries/transfer`, form);
    },

    /** A venue owner can correct entries on their own bookings; an admin can correct any. */
    reverseEntry: (entryId: string, reason: string) =>
      client.request<PaymentEntry>(`/payment-entries/${entryId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
  };
}
