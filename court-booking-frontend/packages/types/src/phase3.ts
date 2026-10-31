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
  /** a reply until this time gets +5 (4 days after the notice); later replies are still taken, without points */
  bonus_until?: string | null;
  /** only on the reply response: the points that reply gave (0 or 5) */
  bonus_points?: number | null;
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
    noshow_transfer_ok: "No-show hata, transfer sahi nikla",
  };
  const en: Record<string, string> = {
    transfer_booking: "Paid fully by transfer",
    short_reply: "Answered the balance check",
    short_no_reply: "Did not answer the balance check",
    short_no_reply_returned: "Points given back",
    redeem: "Used for a discount",
    redeem_returned: "Booking cancelled: points back",
    noshow_transfer_ok: "No-show taken back, transfer confirmed",
  };
  return (lang === "ru" ? ru : en)[reason] ?? reason;
}

/** audit Phase 3 item 9: points, dues and disputes per venue and in total (GET /owners/money-health, /admin/money-health). */
export interface MoneyHealthRow {
  venue_id: string;
  venue_name: string;
  dues_open: number;
  dues_open_pkr: number;
  short_disputes_waiting: number;
  noshow_replies_waiting: number;
  points_awarded: number;
  points_used: number;
}

export interface MoneyHealth {
  totals: Omit<MoneyHealthRow, "venue_id" | "venue_name">;
  venues: MoneyHealthRow[];
}

/** audit fixes 2026-10-31: taking back a no-show (POST /owners/bookings/{id}/noshow-reverse). */
export type MoneyMethod = "cash" | "transfer";

export interface NoShowReverseInput {
  final_price_pkr: number;
  /** money received NOW, on top of what is already recorded */
  received_pkr: number;
  method: MoneyMethod;
  reply_id?: string | null;
}

/** Why the reversal form can't be sent yet (null = ok). Mirrors the server: final price >= already paid,
 * 0 <= received <= final - paid, a transfer with money needs its screenshot. */
export function noshowReverseProblem(
  v: { finalPrice: number | null; received: number | null; method: MoneyMethod | null; hasScreenshot: boolean },
  alreadyPaid: number,
): "price" | "received" | "method" | "screenshot" | null {
  if (v.finalPrice == null || !Number.isFinite(v.finalPrice) || v.finalPrice < alreadyPaid) return "price";
  if (v.received == null || !Number.isFinite(v.received) || v.received < 0 || v.received > v.finalPrice - alreadyPaid) return "received";
  if (v.method == null) return "method";
  if (v.method === "transfer" && v.received > 0 && !v.hasScreenshot) return "screenshot";
  return null;
}

/** Dues "Done": cash settles now; a transfer needs its screenshot (it is settled once approved). */
export function dueDoneProblem(method: MoneyMethod | null, hasScreenshot: boolean): "method" | "screenshot" | null {
  if (method == null) return "method";
  if (method === "transfer" && !hasScreenshot) return "screenshot";
  return null;
}

/** Will a short-payment reply sent now still earn the +5? */
export function replyEarnsBonus(due: Pick<ShortPaymentDue, "bonus_until">, now: Date = new Date()): boolean {
  return !!due.bonus_until && now.getTime() <= new Date(due.bonus_until).getTime();
}

/** audit fixes 2026-10-31: every "kitna mila" box says what came before and what is left:
 * "Pehle Rs X mil chuke. Abhi kitna mila? (baqi Rs Y)". */
export function receivedPrompt(paid: number, due: number, lang: "ru" | "en" = "ru"): string {
  const rs = (n: number) => `Rs ${Math.max(0, Math.round(n)).toLocaleString("en-US")}`;
  return lang === "en"
    ? `Already received ${rs(paid)}. How much now? (${rs(due)} left)`
    : `Pehle ${rs(paid)} mil chuke. Abhi kitna mila? (baqi ${rs(due)})`;
}

/** Typing into a "kitna mila" box: digits only, and a number above `max` (the remaining due) is not taken -- the box keeps
 * its previous value. `blocked` = the keystroke was refused (show the hint in red). */
export function acceptReceivedInput(raw: string, max: number, previous: string): { value: string; blocked: boolean } {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits === "") return { value: "", blocked: false };
  const n = Number(digits);
  if (n > Math.max(0, Math.round(max))) return { value: previous, blocked: true };
  return { value: String(n), blocked: false };
}
