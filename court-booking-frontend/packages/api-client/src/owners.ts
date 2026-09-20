import type {
  Booking,
  Growth,
  Ledger,
  LedgerRow,
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

/** The ledger endpoint filters by VENUE only (`venue_id`) -- there is no court filter server-side. The
 * dashboards used to pass the selected COURT id in the venue slot, which (a) never scoped the ledger to the
 * selected venue (so a multi-venue owner saw every venue mixed together) and (b) made the court tabs send a
 * court UUID as a venue id (an empty ledger). Court filtering is client-side now: rows are filtered by court
 * name and the summary recomputed from what's left. */
export function filterLedgerByCourt(ledger: Ledger, courtName: string, startDate: string, endDate: string): Ledger {
  const bookings = ledger.bookings.filter((b) => b.court === courtName);
  const total = bookings.reduce((n, b) => n + b.amount_paid, 0);
  const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1);
  const by_source: Record<string, number> = {};
  for (const b of bookings) by_source[b.source] = (by_source[b.source] ?? 0) + 1;
  return {
    bookings,
    summary: {
      total_revenue: total,
      total_bookings: bookings.length,
      avg_revenue_per_day: total / days,
      by_source,
      by_court: { [courtName]: total },
    },
  };
}

/** Same columns as the server's CSV export (`GET /owners/ledger/export`), for a court-filtered view. */
export function ledgerRowsToCsv(rows: LedgerRow[]): string {
  const esc = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [["date", "court", "player", "source", "amount_paid", "balance_due", "status"].join(",")];
  for (const r of rows) lines.push([r.date, r.court, r.player ?? "", r.source, r.amount_paid, r.balance_due, r.status].map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}
