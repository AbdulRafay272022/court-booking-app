import type {
  Booking,
  Growth,
  Ledger,
  OwnerDigest,
  OwnerToday,
  Payment,
  PendingApproval,
  Venue,
} from "@court-booking/types";
import type { ApiClient } from "./client";
import { toQuery } from "./util";

export function createOwnersApi(client: ApiClient) {
  return {
    venues: () => client.request<Venue[]>("/owners/venues"),

    venueBookings: (venueId: string) => client.request<Booking[]>(`/owners/venues/${venueId}/bookings`),

    venuePendingPayments: (venueId: string) =>
      client.request<Payment[]>(`/owners/venues/${venueId}/payments/pending`),

    digest: () => client.request<OwnerDigest[]>("/owners/digest"),

    today: (params: { date?: string; venue_id?: string } = {}) =>
      client.request<OwnerToday>(`/owners/today${toQuery({ date_: params.date, venue_id: params.venue_id })}`),

    pendingApprovals: (venueId?: string) =>
      client.request<PendingApproval[]>(`/owners/pending-approvals${toQuery({ venue_id: venueId })}`),

    ledger: (startDate: string, endDate: string, venueId?: string) =>
      client.request<Ledger>(
        `/owners/ledger${toQuery({ start_date: startDate, end_date: endDate, venue_id: venueId })}`,
      ),

    ledgerExportCsv: (startDate: string, endDate: string, venueId?: string) =>
      client.requestText(
        `/owners/ledger/export${toQuery({ start_date: startDate, end_date: endDate, venue_id: venueId })}`,
      ),

    growth: (venueId?: string) =>
      client.request<Growth>(`/owners/growth${toQuery({ venue_id: venueId })}`),
  };
}
