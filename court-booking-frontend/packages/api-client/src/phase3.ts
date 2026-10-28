import type { ArrivalState, BookingExtras, MoneyHealth, PlayerPoints, ShortPaymentDue } from "@court-booking/types";
import type { ApiClient } from "./client";

/** audit 2026-10-28 Phase 3 items 3-6: points, short payments / dues, no-show replies, "Pohanch gaya" (backend app/api/phase3.py). */
export function createPhase3Api(client: ApiClient) {
  return {
    myPoints: () => client.request<PlayerPoints>("/users/me/points"),
    extras: (bookingId: string) => client.request<BookingExtras>(`/bookings/${bookingId}/extras`),
    usePoints: (bookingId: string) => client.request<BookingExtras>(`/bookings/${bookingId}/use-points`, { method: "POST" }),
    replyShort: (claimId: string, answer: "yes" | "no", reason?: string) =>
      client.request<ShortPaymentDue>(`/short-payments/${claimId}/reply`, { method: "POST", body: JSON.stringify({ answer, reason: reason || null }) }),
    arrived: (bookingId: string, latitude: number, longitude: number, accuracy_m?: number | null) =>
      client.request<NonNullable<ArrivalState["arrival"]>>(`/bookings/${bookingId}/arrived`, {
        method: "POST",
        body: JSON.stringify({ latitude, longitude, accuracy_m: accuracy_m ?? null }),
      }),
    noshowReply: (bookingId: string, note?: string) =>
      client.request<{ id: string }>(`/bookings/${bookingId}/noshow-reply`, { method: "POST", body: JSON.stringify({ note: note || null }) }),
    // owner / staff
    moneyHealth: (venueId: string) => client.request<MoneyHealth>(`/owners/money-health?venue_id=${encodeURIComponent(venueId)}`),
    adminMoneyHealth: () => client.request<MoneyHealth>("/admin/money-health"),
    dues: (venueId: string) => client.request<ShortPaymentDue[]>(`/owners/dues?venue_id=${encodeURIComponent(venueId)}`),
    dueDone: (claimId: string) => client.request<ShortPaymentDue>(`/owners/dues/${claimId}/done`, { method: "POST" }),
    decideShort: (claimId: string, decision: "collect" | "waive") =>
      client.request<ShortPaymentDue>(`/owners/short-payments/${claimId}/decide`, { method: "POST", body: JSON.stringify({ decision }) }),
    decideNoShow: (replyId: string, decision: "keep" | "reverse") =>
      client.request<{ id: string }>(`/owners/noshow-replies/${replyId}/decide`, { method: "POST", body: JSON.stringify({ decision }) }),
  };
}
