import type {
  AdminEscalation,
  BookingDisputes,
  Escalation,
  EscalationKind,
  PlayerRefundState,
  RefundPayout,
  RefundPayoutInput,
  RefundTransfer,
} from "@court-booking/types";
import type { ApiClient } from "./client";

/** fix/nov-9 items 9-12 (backend app/api/refund_flow.py). */
export function createRefundDisputesApi(client: ApiClient) {
  return {
    // player
    forBooking: (bookingId: string) => client.request<BookingDisputes>(`/bookings/${bookingId}/disputes`),
    setPayout: (bookingId: string, input: RefundPayoutInput) =>
      client.request<PlayerRefundState>(`/bookings/${bookingId}/refund-payout`, { method: "PUT", body: JSON.stringify(input) }),
    answerTransfer: (transferId: string, answer: "received" | "not_received", note?: string) =>
      client.request<RefundTransfer>(`/refund-transfers/${transferId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer, note: note || null }),
      }),
    escalate: (bookingId: string, kind: EscalationKind, reason?: string) =>
      client.request<Escalation>(`/bookings/${bookingId}/escalate`, { method: "POST", body: JSON.stringify({ kind, reason: reason || null }) }),
    // owner / staff (mark_refunds)
    /** The FULL number for the venue that owes this refund, while it is owed. Every call is written to the audit log. */
    revealPayout: (disputeId: string) => client.request<RefundPayout>(`/owners/refunds/${disputeId}/payout`),
    replyTransfer: (transferId: string, note: string) =>
      client.request<RefundTransfer>(`/owners/refund-transfers/${transferId}/reply`, { method: "POST", body: JSON.stringify({ note }) }),
    // admin
    adminList: (status?: "open" | "decided") =>
      client.request<AdminEscalation[]>(`/admin/escalations${status ? `?status=${status}` : ""}`),
    adminDecide: (escalationId: string, decision: "player" | "venue", note: string) =>
      client.request<Escalation>(`/admin/escalations/${escalationId}/decide`, { method: "POST", body: JSON.stringify({ decision, note }) }),
  };
}
