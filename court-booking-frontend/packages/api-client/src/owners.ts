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

/** Section 32 Part 5: filters for the per-payment ledger. All optional -- `venueId`/`courtId` scope which
 * courts' payments show up, `method`/`bookingStatus` narrow the row list. The three "collected" summary
 * numbers are always "now"-relative and ignore these, except for venue/court scoping. */
export interface LedgerFilters {
  venueId?: string;
  courtId?: string;
  method?: string;
  bookingStatus?: string;
}

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

    ledger: (startDate: string, endDate: string, filters: LedgerFilters = {}) =>
      client.request<Ledger>(
        `/owners/ledger${toQuery({
          start_date: startDate,
          end_date: endDate,
          venue_id: filters.venueId,
          court_id: filters.courtId,
          method: filters.method,
          booking_status: filters.bookingStatus,
        })}`,
      ),

    ledgerExportCsv: (startDate: string, endDate: string, filters: LedgerFilters = {}) =>
      client.requestText(
        `/owners/ledger/export${toQuery({
          start_date: startDate,
          end_date: endDate,
          venue_id: filters.venueId,
          court_id: filters.courtId,
          method: filters.method,
          booking_status: filters.bookingStatus,
        })}`,
      ),

    growth: (venueId?: string) =>
      client.request<Growth>(`/owners/growth${toQuery({ venue_id: venueId })}`),
  };
}
