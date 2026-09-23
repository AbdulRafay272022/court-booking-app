export interface TodaySlot {
  starts_at: string;
  ends_at: string;
  status: string;
  booking_id: string | null;
  player_name: string | null;
  amount_paid: number | null;
  price: number | null;
  balance_due: number | null;
}

export interface TodayCourt {
  court_id: string;
  name: string;
  slots: TodaySlot[];
}

export interface TodaySummary {
  total_bookings: number;
  total_revenue: number;
  pending_approvals: number;
  walkins: number;
}

/** GET /owners/today */
export interface OwnerToday {
  date: string;
  courts: TodayCourt[];
  summary: TodaySummary;
}

/** One entry from GET /owners/pending-approvals */
export interface PendingApproval {
  payment_id: string;
  booking_id: string;
  court_name: string;
  starts_at: string;
  ends_at: string;
  player_name: string | null;
  player_phone: string | null;
  ocr_verdict: string | null;
  ocr_amount: number | null;
  expected_amount: number;
  proof_url: string | null;
  submitted_at: string;
  minutes_since_submission: number;
}

/** Section 32 Part 5: one row per PAYMENT (payment_entries), not per booking -- a booking with an advance
 * plus a later balance payment is two rows here. A negative amount_pkr is an admin correction reversing
 * an earlier row. */
export interface LedgerEntry {
  entry_id: string;
  recorded_at: string;
  court: string;
  booking_id: string;
  starts_at: string;
  player: string | null;
  method: string;
  amount_pkr: number;
  running_total: number;
  booking_status: string;
}

export interface LedgerSummary {
  /** Always "now"-relative (Pakistan time), independent of the selected date range/filters. */
  collected_today: number;
  collected_this_week: number;
  collected_this_month: number;
  outstanding_balance: number;
  cancelled_refund_pending: number;
  /** Net total of `entries` below (respects the selected date range and filters). */
  total_in_range: number;
  by_court: Record<string, number>;
  by_day: Record<string, number>;
}

/** GET /owners/ledger */
export interface Ledger {
  entries: LedgerEntry[];
  summary: LedgerSummary;
}

export interface GrowthSuggestion {
  court_id: string;
  day_of_week: number;
  hour: number;
  booking_rate: number;
  venue_average: number;
  suggestion: string;
  weeks_of_data: number;
}

/** GET /owners/growth (Pro/Business tier only) */
export interface Growth {
  underbooked_slots: GrowthSuggestion[];
  computed_at: string;
}

/** GET /owners/digest */
export interface OwnerDigest {
  venue_id: string;
  venue_name: string;
  bookings_today: number;
  revenue_today: number;
  payments_awaiting_review: number;
  upcoming_bookings_7_days: number;
}
