import type { Payment, PaymentProofOut, ProofUrlOut } from "@court-booking/types";
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
  };
}
