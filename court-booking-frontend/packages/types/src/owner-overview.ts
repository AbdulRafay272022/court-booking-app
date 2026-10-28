/** Owner Overview / Bookings history / booking detail (docs/owner-overview-contract.md). Mirrors the backend schemas. */

export type OverviewRowKind = "booked" | "cancelled" | "refund";

/** The one primary status a row shows. Chips (completion, checked_in) are separate fields. */
export type BookingStatusKey =
  | "booked"
  | "held"
  | "awaiting_approval"
  | "no_show"
  | "cancelled"
  | "refund_owed"
  | "refunded"
  | "expired";

/** Filter values accepted by GET /owners/bookings-history `statuses` (composites plus each raw key). */
export type HistoryStatusFilter =
  | "booked"
  | "pending"
  | "cancelled"
  | "refund"
  | "completed"
  | "short_paid"
  | "status_pending"
  | BookingStatusKey;

export type CompletionResult = "yes" | "no";

export interface BookingCompletion {
  result: CompletionResult;
  received_pkr: number;
  reason: string | null;
  marked_at: string;
  marked_by_name: string | null;
}

export interface OwnerBookingRow {
  booking_id: string;
  /** "KH-" + first 8 hex chars of the id, upper case. */
  short_code: string;
  kind: OverviewRowKind;
  status_key: BookingStatusKey;
  player_name: string | null;
  /** audit 2026-10-28 item 6: the booking account's profile photo. */
  player_avatar_url?: string | null;
  /** Null when the viewer lacks permission. */
  player_phone: string | null;
  court_id: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  slot_count: number;
  total: number;
  advance: number;
  due: number;
  total_paid: number;
  source: "app" | "whatsapp" | "walkin" | "phone";
  checked_in: boolean;
  completion: BookingCompletion | null;
  /** True once ends_at has passed (enables the Booking completed dropdown). */
  slot_ended: boolean;
  /** Cancelled and refund rows point back at the booking's own (original) row. */
  original_booking_id: string | null;
  /** Refund rows (and cancelled rows that have one). */
  refund_amount: number | null;
  refund_status: "owed" | "paid" | null;
  /** Stage 2: booked, slot ended, not completed and not no_show yet (owner must mark). */
  status_pending?: boolean;
}

export interface SlotCourtCounts {
  court_id: string;
  court_name: string;
  total: number;
  booked: number;
  pending: number;
  blocked: number;
  free: number;
}

export interface OwnerOverview {
  date: string;
  venue_id: string;
  operating_day: { start_at: string; end_at: string } | null;
  slots: {
    total: number;
    booked: number;
    pending: number;
    blocked: number;
    free: number;
    free_upcoming: number;
    free_past: number;
    by_court: SlotCourtCounts[];
  };
  bookings: {
    count: number;
    cancelled: number;
    refunds: { count: number; amount: number };
    pending: { count: number; awaiting_approval: number; awaiting_payment: number };
    by_court: { court_id: string; court_name: string; count: number }[];
  };
  money: { collected: number; due: number; due_bookings: number };
  /** Round 2 (A7): held + payment_submitted for ANY date (venue + court filter). Optional for an older backend. */
  pending_all?: import("./round2").PendingAll;
  /** Stage 2: bookings whose slot ended and the owner has not marked yet (any date). */
  status_pending_count?: number;
  rows: OwnerBookingRow[];
}

export interface HistoryFilters {
  venueId?: string;
  dateFrom: string;
  dateTo: string;
  courtIds?: string[];
  statuses?: HistoryStatusFilter[];
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface OwnerBookingsPage {
  items: OwnerBookingRow[];
  total: number;
  page: number;
  page_size: number;
  totals: { count: number; total: number; collected: number; due: number };
}

export interface BookingTimelineEvent {
  at: string;
  /** Stable key the UI translates: held, proof_submitted, approved, rejected, cancelled, refund_owed, refunded, checked_in, no_show, slot_started, completion_marked ... */
  kind: string;
  /** Free detail already formatted by the server in data form only (amounts, names, reasons), never prose. */
  amount?: number | null;
  actor_name?: string | null;
  note?: string | null;
}

export interface OwnerBookingDetail {
  row: OwnerBookingRow;
  booked_at: string;
  hold_expires_at: string | null;
  advance_required: number;
  payment_id: string | null;
  ocr_verdict: string | null;
  ocr_amount: number | null;
  approval: { verdict: "approved" | "rejected" | null; by_name: string | null; at: string | null; reason: string | null; auto: boolean } | null;
  cancellation: { by: "player" | "owner" | "system"; at: string | null; reason: string | null } | null;
  refund: { amount: number; status: "owed" | "paid"; paid_at: string | null; reference: string | null } | null;
  completion: BookingCompletion | null;
  timeline: BookingTimelineEvent[];
  /** Owner Round 2 (A4): for a walk-in, who added it ("owner" | "staff"); null/absent otherwise or when unknown. */
  channel_detail?: string | null;
}

export interface CompletionInput {
  result: CompletionResult;
  /** Round 2 (A8): the amount received NOW out of the remaining due; when set, received_pkr is ignored. */
  received_now?: number;
  received_pkr?: number;
  reason?: string;
}

export interface OwnerBadges {
  approvals: number;
  refunds: number;
}
