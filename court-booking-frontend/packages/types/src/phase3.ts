/** audit 2026-10-28 Phase 3 items 3-6 (backend app/schemas/phase3.py). Every feature is behind a default-OFF flag. */

export interface PointEntry {
  id: string;
  delta: number;
  /** transfer_booking | short_reply | short_no_reply | short_no_reply_returned | redeem | redeem_returned */
  reason: string;
  booking_id: string | null;
  code: string | null;
  created_at: string;
}

export interface PlayerPoints {
  enabled: boolean;
  balance: number;
  redeem_points: number;
  rule_text_ru: string;
  rule_text_en: string;
  entries: PointEntry[];
}

export interface PointsOffer {
  state: "off" | "venue_off" | "not_now" | "not_enough" | "available" | "used";
  balance: number;
  cost_points: number;
  discount_pkr: number;
  rule_text_ru: string;
  rule_text_en: string;
}

/** One short payment ("kam mila"); while resolved_at is null it is a due the venue carries. */
export interface ShortPaymentDue {
  id: string;
  booking_id: string;
  code: string;
  venue_id: string;
  player_id: string | null;
  total_pkr: number;
  paid_pkr: number;
  due_pkr: number;
  status: "awaiting_reply" | "confirmed" | "disputed" | "no_reply";
  reply_deadline_at: string;
  replied_at: string | null;
  player_reason: string | null;
  penalty_applied: number;
  penalty_returned: boolean;
  owner_decision: "collect" | "waive" | null;
  resolved_at: string | null;
  resolution: "paid" | "waived" | null;
  player_name: string | null;
  starts_at: string | null;
  created_at: string;
  can_reply?: boolean | null;
}

export interface ArrivalState {
  enabled: boolean;
  arrival: { verdict: "near" | "far" | "pin_unreliable"; distance_m: number | null; at: string } | null;
  can_arrive: boolean;
  noshow_reply: { note: string | null; owner_decision: "keep" | "reverse" | null; at: string } | null;
  can_reply_noshow: boolean;
}

export interface BookingExtras {
  points: PointsOffer;
  short_payment: ShortPaymentDue | null;
  arrival: ArrivalState;
}

export interface ApprovalPlayerContext {
  dues: ShortPaymentDue[];
  no_shows: number;
  total_bookings: number;
}

/** Plain-language text for each points history line. */
export function pointsReasonLabel(reason: string, lang: "ru" | "en" = "ru"): string {
  const ru: Record<string, string> = {
    transfer_booking: "Poori payment transfer se",
    short_reply: "Hisaab ka jawab diya",
    short_no_reply: "Hisaab ka jawab nahi diya",
    short_no_reply_returned: "Kate hue points wapas",
    redeem: "Chhoot ke liye istemal",
    redeem_returned: "Booking cancel: points wapas",
  };
  const en: Record<string, string> = {
    transfer_booking: "Paid fully by transfer",
    short_reply: "Answered the balance check",
    short_no_reply: "Did not answer the balance check",
    short_no_reply_returned: "Points given back",
    redeem: "Used for a discount",
    redeem_returned: "Booking cancelled: points back",
  };
  return (lang === "ru" ? ru : en)[reason] ?? reason;
}
