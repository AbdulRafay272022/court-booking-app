import type { BookingSource } from "./booking";
import type { PaymentChecks } from "./payment";

export interface TodaySlot {
  starts_at: string;
  ends_at: string;
  status: string;
  booking_id: string | null;
  player_name: string | null;
  /** audit 2026-10-28 item 6: the booking account's profile photo (null: no account / no photo). */
  player_avatar_url?: string | null;
  amount_paid: number | null;
  price: number | null;
  balance_due: number | null;
  /** Section 32 Part 9. */
  checked_in_at: string | null;
  checked_in_by: "owner" | "player" | null;
  /** Owner Today detail: the booking's court + sport, how and when it was made. Null on an open/closed slot. Optional
   * so an older backend (before these fields) still typechecks and the screens fall back gracefully. */
  court_id?: string | null;
  court_name?: string | null;
  court_sport?: string | null;
  booking_source?: BookingSource | null;
  /** When the booking was made (bookings.created_at). */
  booked_at?: string | null;
  /** The registered account behind the booking (null for a walk-in with no account). `player_name` is the name it was booked under. */
  account_name?: string | null;
  player_phone?: string | null;
}

/** "App", "WhatsApp", "Walk-in", "Phone" -- what the owner reads. Unknown/missing -> null (don't guess). */
export function bookingSourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case "app": return "App";
    case "whatsapp": return "WhatsApp";
    case "walkin": return "Walk-in";
    case "phone": return "Phone";
    default: return null;
  }
}

/**
 * Owner Round 2 (A4, QA): the "Zariya" (channel) line in a booking's detail. `source` is where the booking started;
 * `channelDetail` ("owner" | "staff", only for walk-ins, from the audit log) says who added a walk-in. "app" covers both
 * the in-app chat and the website: the database cannot tell them apart, so it is never called "App chat".
 * Mobile uses this directly (Roman Urdu); the web reads the same wording from its dictionaries (`fmt.channel.*`).
 */
export const CHANNEL_HEADING: Record<"ru" | "en", string> = {
  ru: "Zariya (booking kahan se shuru hui)",
  en: "Channel (where the booking started)",
};

const CHANNEL_TEXT: Record<string, Record<"ru" | "en", string>> = {
  whatsapp: { ru: "WhatsApp chat", en: "WhatsApp chat" },
  app: { ru: "App ya website", en: "App or website" },
  walkin_owner: { ru: "Owner ne khud add ki (walk-in)", en: "Added by the owner (walk-in)" },
  walkin_staff: { ru: "Staff ne add ki", en: "Added by staff" },
  walkin: { ru: "Walk-in", en: "Walk-in" },
  phone: { ru: "Phone", en: "Phone" },
};

/** The dictionary suffix for a booking's channel: "whatsapp" | "app" | "walkin_owner" | "walkin_staff" | "walkin" | "phone";
 * null for an unknown/missing source (never guessed). */
export function bookingChannelKey(source: string | null | undefined, channelDetail?: string | null): string | null {
  if (source === "walkin") {
    if (channelDetail === "owner") return "walkin_owner";
    if (channelDetail === "staff") return "walkin_staff";
    return "walkin";
  }
  return source && CHANNEL_TEXT[source] ? source : null;
}

export function bookingChannelLabel(source: string | null | undefined, channelDetail?: string | null, lang: "ru" | "en" = "en"): string | null {
  const key = bookingChannelKey(source, channelDetail);
  return key ? CHANNEL_TEXT[key][lang] : null;
}

export interface TodayCourt {
  court_id: string;
  name: string;
  sport?: string | null;
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
  /** Carried by the API so screens never match a court by name. Optional for old backends. */
  court_id?: string | null;
  court_sport?: string | null;
  account_name?: string | null;
  starts_at: string;
  ends_at: string;
  player_name: string | null;
  /** audit 2026-10-28 item 6: the booking account's profile photo (null: no account / no photo). */
  player_avatar_url?: string | null;
  player_phone: string | null;
  ocr_verdict: string | null;
  ocr_amount: number | null;
  expected_amount: number;
  proof_url: string | null;
  submitted_at: string;
  minutes_since_submission: number;
  /** Section 32 Part 7 -- the five plain-language checks for this payment. */
  checks: PaymentChecks;
}

/** Section 32 Part 5: one row per PAYMENT (payment_entries), not per booking -- a booking with an advance
 * plus a later balance payment is two rows here. A negative amount_pkr is an admin correction reversing
 * an earlier row. */
export interface LedgerEntry {
  entry_id: string;
  recorded_at: string;
  court: string;
  court_id?: string | null;
  court_sport?: string | null;
  booking_id: string;
  starts_at: string;
  player: string | null;
  // Batch merge: Part 5's per-payment ledger row supersedes Part 10's per-booking row.
  method: string;
  /** "payment" | "refund" | "correction" with a ready-made label ("Payment" / "Refund" / "Correction"). */
  entry_type?: "payment" | "refund" | "correction";
  label?: string;
  /** Refund reference, or the audit text (expected / screenshot / paid / credited). */
  note?: string | null;
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

/** GET /owners/refunds -- Section 32 Part 10's owner-facing "Refunds to pay" screen. */
export interface OwnerRefund {
  id: string;
  booking_id: string;
  court_name: string;
  court_id?: string | null;
  court_sport?: string | null;
  venue_name: string;
  player_name: string | null;
  player_phone: string | null;
  starts_at: string;
  reason: string;
  refund_amount: number;
  refund_status: "owed" | "refunded";
  refunded_amount: number | null;
  /** Still owed after any partial refunds (refund_amount - refunded_amount). Show this as the amount to pay. */
  remaining_amount?: number;
  /** Round 2 (A10): what the player actually paid in, the policy refund, and what was already sent back. */
  player_sent?: number | null;
  refund_due?: number;
  already_refunded?: number;
  reason_label_key?: string;
  /** Round 2: the payment this refund came from (a screenshot thumb is shown when present). */
  payment_id?: string | null;
  /** audit 2026-10-28 Phase 2: the player's reason ("Refund maangein"). */
  player_note?: string | null;
  refund_reference: string | null;
  refunded_at: string | null;
  created_at: string;
  is_overdue: boolean;
  /** Stage 2: this refund's screenshot was also credited on N OTHER bookings (same image, any player); null = not reused. */
  duplicate_proof?: { used_on_bookings: number } | null;
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
