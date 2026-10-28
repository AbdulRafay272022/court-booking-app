import type {
  StaffActivity,
  BankCheck,
  Booking,
  Growth,
  Ledger,
  HistoryFilters,
  CompletionInput,
  OwnerBadges,
  OwnerBookingDetail,
  OwnerBookingRow,
  OwnerBookingsPage,
  OwnerOverview,
  ApprovalsQueuePage,
  AcknowledgeResult,
  AdvanceExplain,
  VenueTimers,
  VenueTimerValues,
  MyPermissions,
  OwnerIdentity,
  OwnerDigest,
  OwnerRefund,
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

function historyQuery(f: HistoryFilters): string {
  const usp = new URLSearchParams();
  const set = (k: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  };
  set("venue_id", f.venueId);
  set("date_from", f.dateFrom);
  set("date_to", f.dateTo);
  set("court_ids", f.courtIds?.join(",") || undefined);
  for (const s of f.statuses ?? []) usp.append("statuses", s);
  set("q", f.q?.trim());
  set("page", f.page);
  set("page_size", f.pageSize);
  set("sort", f.sort);
  const text = usp.toString();
  return text ? `?${text}` : "";
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

    /** `date` + `courtIds` (optional) narrow the list to one operating day / some courts, same rule as the Overview. */
    pendingApprovals: (venueId?: string, filter: { date?: string; courtIds?: string[] } = {}) =>
      client.request<PendingApproval[]>(
        `/owners/pending-approvals${toQuery({ venue_id: venueId, date: filter.date, court_ids: filter.courtIds?.join(",") || undefined })}`,
      ),

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

    /** Owner Overview (docs/owner-overview-contract.md). `courtIds` empty/undefined = all courts. */
    overview: (params: { date?: string; venueId?: string; courtIds?: string[] } = {}) =>
      client.request<OwnerOverview>(
        `/owners/overview${toQuery({ date: params.date, venue_id: params.venueId, court_ids: params.courtIds?.join(",") || undefined })}`,
      ),

    bookingsHistory: (f: HistoryFilters) =>
      client.request<OwnerBookingsPage>(`/owners/bookings-history${historyQuery(f)}`),

    bookingsHistoryCsv: (f: HistoryFilters) =>
      client.requestText(`/owners/bookings-history/export.csv${historyQuery(f)}`),

    bookingDetail: (bookingId: string) =>
      client.request<OwnerBookingDetail>(`/owners/bookings/${bookingId}/overview-detail`),

    /** Booking completed (Haan / Nahi). Needs the record_payments permission. */
    markCompletion: (bookingId: string, input: CompletionInput) =>
      client.request<OwnerBookingRow>(`/owners/bookings/${bookingId}/completion`, { method: "POST", body: JSON.stringify(input) }),

    badges: (venueId?: string) => client.request<OwnerBadges>(`/owners/badges${toQuery({ venue_id: venueId })}`),

    /** Round 2 (A1/A5): every payment awaiting review, newest first, with cancelled-by-player cards. */
    approvalsQueue: (params: { venueId?: string; date?: string; courtIds?: string[]; page?: number; pageSize?: number } = {}) =>
      client.request<ApprovalsQueuePage>(
        `/owners/approvals-queue${toQuery({ venue_id: params.venueId, date: params.date, court_ids: params.courtIds?.join(",") || undefined, page: params.page, page_size: params.pageSize })}`,
      ),

    /** Round 2 (A5): "Theek hai" on a card whose booking the player cancelled. */
    acknowledgeCancelled: (paymentId: string, moneyReceived: boolean) =>
      client.request<AcknowledgeResult>(`/owners/payments/${paymentId}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ money_received: moneyReceived }),
      }),

    /** Round 2 (A11): how this court's advance works, with a live example. */
    advanceExplain: (courtId: string) => client.request<AdvanceExplain>(`/courts/${courtId}/advance-explain`),

    /** Stage 2: per-venue hold / reminder / auto-cancel timers (null = default). */
    venueTimers: (venueId: string) => client.request<VenueTimers>(`/owners/venues/${venueId}/timers`),
    updateVenueTimers: (venueId: string, values: VenueTimerValues) =>
      client.request<VenueTimers>(`/owners/venues/${venueId}/timers`, { method: "PUT", body: JSON.stringify(values) }),

    /** Stage 2: what this account may do per venue (hide buttons up front for staff). */
    myPermissions: () => client.request<MyPermissions>("/owners/me/permissions"),

    /** Audit 2026-10-28 item 16: per person activity at one venue (owner / admin only). Dates are Pakistan YYYY-MM-DD. */
    bankCheck: (venueId: string, date?: string) =>
      client.request<BankCheck>(`/owners/bank-check?${new URLSearchParams({ venue_id: venueId, ...(date ? { date } : {}) }).toString()}`),
    staffActivity: (venueId: string, dateFrom?: string, dateTo?: string) =>
      client.request<StaffActivity>(
        `/owners/staff-activity?${new URLSearchParams({ venue_id: venueId, ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) }).toString()}`,
      ),

    /** Stage 2: CNIC (never returns the number, only a masked form). */
    identity: () => client.request<OwnerIdentity>("/owners/identity"),
    submitIdentity: (number: string, front: string | Blob, back: string | Blob) => {
      const form = new FormData();
      form.append("number", number);
      const part = (f: string | Blob, name: string) =>
        typeof f === "string" ? ({ uri: f, name, type: "image/jpeg" } as unknown as Blob) : f;
      form.append("front", part(front, "front.jpg"), "front.jpg");
      form.append("back", part(back, "back.jpg"), "back.jpg");
      return client.requestUpload<OwnerIdentity>("/owners/identity", form);
    },

    growth: (venueId?: string) =>
      client.request<Growth>(`/owners/growth${toQuery({ venue_id: venueId })}`),

    /** Section 32 Part 10: the owner's "Refunds to pay" screen. */
    refunds: (venueId?: string, filter: { date?: string; courtIds?: string[] } = {}) =>
      client.request<OwnerRefund[]>(
        `/owners/refunds${toQuery({ venue_id: venueId, date: filter.date, court_ids: filter.courtIds?.join(",") || undefined })}`,
      ),

    /** Records a refund the owner already sent OUTSIDE the app (JazzCash/bank) -- there is no
     * payment gateway here, this is purely a record with a reference and an optional screenshot.
     * `amount` lets an owner record a smaller-than-owed refund (negotiated in person); the
     * backend rejects anything larger than what's actually owed. */
    markRefundPaid: (
      disputeId: string,
      reference: string,
      amount?: number,
      screenshot?: string | Blob,
      fileName = "refund.jpg",
      mimeType = "image/jpeg",
    ) => {
      const formData = new FormData();
      formData.append("reference", reference);
      if (amount !== undefined) formData.append("amount", String(amount));
      if (screenshot !== undefined) {
        const part =
          typeof screenshot === "string" ? ({ uri: screenshot, name: fileName, type: mimeType } as unknown as Blob) : screenshot;
        formData.append("screenshot", part, fileName);
      }
      return client.requestUpload<OwnerRefund>(`/owners/refunds/${disputeId}/mark-refunded`, formData);
    },
  };
}
