export interface TodaySlot {
  starts_at: string;
  ends_at: string;
  status: string;
  booking_id: string | null;
  player_name: string | null;
  amount_paid: number | null;
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

export interface LedgerRow {
  booking_id: string;
  date: string;
  court: string;
  player: string | null;
  source: string;
  amount_paid: number;
  balance_due: number;
  status: string;
}

export interface LedgerSummary {
  total_revenue: number;
  total_bookings: number;
  avg_revenue_per_day: number;
  by_source: Record<string, number>;
  by_court: Record<string, number>;
}

/** GET /owners/ledger */
export interface Ledger {
  bookings: LedgerRow[];
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
