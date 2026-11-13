import type {
  PaisaBookingDetail,
  PaisaBookingsPage,
  PaisaDaybook,
  PaisaPeriod,
  PaisaPlayers,
  PaisaSummary,
  PaisaTasks,
} from "@court-booking/types";
import type { ApiClient } from "./client";

/** Filters shared by the Paisa reads. `from`/`to` only with period "custom". */
export interface PaisaRange {
  venueId?: string;
  courtIds?: string[];
  period?: PaisaPeriod;
  from?: string;
  to?: string;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function range(r: PaisaRange) {
  return {
    venue_id: r.venueId,
    court_ids: r.courtIds?.length ? r.courtIds.join(",") : undefined,
    period: r.period,
    from: r.period === "custom" ? r.from : undefined,
    to: r.period === "custom" ? r.to : undefined,
  };
}

/** Ledger v2 "Paisa" (backend app/api/paisa.py, flag ledger_v2; 403 FEATURE_DISABLED when off). */
export function createPaisaApi(client: ApiClient) {
  return {
    summary: (r: PaisaRange) => client.request<PaisaSummary>(`/owners/paisa/summary${qs(range(r))}`),
    bookings: (
      r: PaisaRange & {
        q?: string;
        moneyStatus?: string;
        booking?: string;
        staff?: string;
        act?: string;
        page?: number;
        pageSize?: number;
      },
    ) =>
      client.request<PaisaBookingsPage>(
        `/owners/paisa/bookings${qs({
          ...range(r),
          q: r.q,
          money_status: r.moneyStatus,
          booking: r.booking,
          staff: r.staff,
          act: r.act,
          page: r.page,
          page_size: r.pageSize,
        })}`,
      ),
    bookingsCsv: (r: PaisaRange & { q?: string; moneyStatus?: string }) =>
      client.requestText(`/owners/paisa/bookings.csv${qs({ ...range(r), q: r.q, money_status: r.moneyStatus })}`),
    booking: (bookingId: string, venueId?: string) =>
      client.request<PaisaBookingDetail>(`/owners/paisa/bookings/${bookingId}${qs({ venue_id: venueId })}`),
    daybook: (r: PaisaRange & { show?: "money" | "with_deductions" | "deductions"; method?: string; person?: string; kind?: string }) =>
      client.request<PaisaDaybook>(
        `/owners/paisa/daybook${qs({ ...range(r), show: r.show, method: r.method, person: r.person, kind: r.kind })}`,
      ),
    players: (venueId?: string, q?: string) => client.request<PaisaPlayers>(`/owners/paisa/players${qs({ venue_id: venueId, q })}`),
    tasks: (venueId?: string, filter: { date?: string; courtIds?: string[] } = {}) =>
      client.request<PaisaTasks>(
        `/owners/paisa/tasks${qs({ venue_id: venueId, date: filter.date, court_ids: filter.courtIds?.join(",") || undefined })}`,
      ),

    // owner-only writes (403 OWNER_ONLY for staff)
    addAdjustment: (bookingId: string, input: { kind: "price_reduced" | "waived"; amount_pkr: number; reason: string }, venueId?: string) =>
      client.request<PaisaBookingDetail>(`/owners/paisa/bookings/${bookingId}/adjustments${qs({ venue_id: venueId })}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    reverseAdjustment: (adjustmentId: string, reason: string, venueId?: string) =>
      client.request<PaisaBookingDetail>(`/owners/paisa/adjustments/${adjustmentId}/reverse${qs({ venue_id: venueId })}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    useCredit: (bookingId: string, amountPkr: number, venueId?: string) =>
      client.request<PaisaBookingDetail>(`/owners/paisa/bookings/${bookingId}/credit/use${qs({ venue_id: venueId })}`, {
        method: "POST",
        body: JSON.stringify({ amount_pkr: amountPkr }),
      }),
    keepRefundAsCredit: (disputeId: string, amountPkr: number, venueId?: string) =>
      client.request<PaisaBookingDetail>(`/owners/paisa/refunds/${disputeId}/keep-as-credit${qs({ venue_id: venueId })}`, {
        method: "POST",
        body: JSON.stringify({ amount_pkr: amountPkr }),
      }),
    /** Cash from a player against their open dues, oldest booking first. */
    playerPayment: (
      input: {
        player_id?: string | null;
        phone?: string | null;
        amount_pkr: number;
        business_date?: string;
        note?: string;
        excess_choice?: "refund" | "credit";
      },
      venueId?: string,
    ) =>
      client.request<{ allocations: { booking_id: string; short_code: string; amount: number }[] }>(
        `/owners/paisa/players/payment${qs({ venue_id: venueId })}`,
        { method: "POST", body: JSON.stringify({ ...input, method: "cash" }) },
      ),
  };
}
