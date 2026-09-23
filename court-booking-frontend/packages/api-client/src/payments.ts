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
    approve: (paymentId: string) =>
      client.request<PaymentProofOut>(`/payments/${paymentId}/approve`, { method: "POST" }),

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

    reverseEntry: (entryId: string, reason: string) =>
      client.request<PaymentEntry>(`/admin/payment-entries/${entryId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
  };
}
