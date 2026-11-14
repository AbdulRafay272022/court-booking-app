/** Ledger v2 "Paisa" (docs/design/LEDGER-V2-CONTRACT.md section 5): response shapes of GET/POST /owners/paisa/*. Money is whole
 * PKR (number). Dates are "YYYY-MM-DD" business days; instants are ISO strings. */
import type { OwnerRefund } from "./owner";

export type PaisaPeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_3m"
  | "last_6m"
  | "last_1y"
  | "all"
  | "custom";

/** Muddat dropdown order (web + mobile). "yesterday" (Kal) is offered on the Bookings tab. */
export const PAISA_PERIODS: readonly PaisaPeriod[] = [
  "today",
  "yesterday",
  "this_week",
  "last_7",
  "last_30",
  "this_month",
  "last_3m",
  "last_6m",
  "last_1y",
  "all",
  "custom",
];
export const PAISA_DEFAULT_PERIOD: PaisaPeriod = "this_month";

export type MoneyStatus =
  | "unpaid"
  | "paid_full"
  | "part_paid"
  | "attendance_pending"
  | "advance_paid"
  | "noshow_kept"
  | "cancel_kept"
  | "cancel_clear"
  | "cancel_refund"
  | "refund_due"
  | "disputed";

export const MONEY_STATUSES: readonly MoneyStatus[] = [
  "unpaid",
  "advance_paid",
  "attendance_pending",
  "part_paid",
  "paid_full",
  "refund_due",
  "noshow_kept",
  "cancel_kept",
  "cancel_clear",
  "cancel_refund",
  "disputed",
];

export type DeductionKind = "points" | "no_show" | "cancellation" | "price_reduced";
export type AdjustmentKind = DeductionKind | "waived";
export type EntryKind = "payment" | "refund" | "correction" | "credit_in" | "credit_out";

/** A Statement box: tapping it lists exactly the bookings that add up its number (backend paisa_service.BOXES). */
export type PaisaBox = "received" | "due" | "due_at_slot" | "waived" | "refund_due" | "deductions";

export interface PaisaStatement {
  booking_amount: number;
  deductions: Record<DeductionKind, number> & { total: number };
  final: number;
  received: number;
  due: number;
  due_at_slot: number;
  waived: number;
  refund_due: number;
}

export interface PaisaMoneyIn {
  cash: number;
  transfer: number;
  /** only old rows ("Doosra") */
  other: number;
  refunds_paid: { cash: number; transfer: number; other: number; total: number };
  credit_in: number;
  credit_out: number;
  net: number;
}

export interface PaisaRightNow {
  due: number;
  due_count: number;
  refund_due: number;
  refund_count: number;
  advance_received: number;
  advance_count: number;
  player_credit: number;
  pending_approval: number;
  pending_count: number;
}

export interface PaisaSummary {
  right_now: PaisaRightNow;
  range: { from: string; to: string; period: PaisaPeriod };
  counts: { bookings: number; played: number; no_show: number; cancelled: number };
  statement: PaisaStatement;
  money_in: PaisaMoneyIn;
  by_month: { month: string; final: number; received: number; due: number; refund_due: number; net_in: number }[];
}

export interface PaisaBookingRow {
  booking_id: string;
  short_code: string;
  player: string;
  phone: string | null;
  player_id: string | null;
  court_id: string;
  court: string;
  court_sport: string | null;
  starts_at: string;
  ends_at: string;
  business_date: string;
  status: string;
  source: string;
  base_price: number;
  deductions: number;
  final: number;
  received: number;
  waived: number;
  balance: number;
  due: number;
  due_at_slot: number;
  refund_due: number;
  money_status: MoneyStatus;
}

export interface PaisaBookingsPage {
  range: { from: string; to: string };
  total: number;
  page: number;
  page_size: number;
  search_all_dates: boolean;
  totals: PaisaStatement;
  items: PaisaBookingRow[];
}

export interface PaisaHistoryItem {
  at: string;
  business_date: string | null;
  type: "entry" | "adjustment";
  kind: EntryKind | AdjustmentKind;
  /** a correction counts under the kind of what it reverses */
  bucket: string;
  method: string | null;
  amount: number;
  by: string | null;
  note: string | null;
  id: string;
  reverses?: string | null;
  reversible: boolean;
}

export type PaisaAction =
  | "record_payment"
  | "collect"
  | "waive"
  | "reduce_price"
  | "refund"
  | "credit"
  | "use_credit"
  | "reverse_noshow"
  | "cancel";

export interface PaisaAdjustmentLine {
  id: string;
  kind: AdjustmentKind;
  amount: number;
  reason: string | null;
  by: string | null;
  at: string;
  reversible: boolean;
}

export interface PaisaBookingDetail {
  booking: PaisaBookingRow;
  calc: {
    booking_amount: number;
    deductions: PaisaAdjustmentLine[];
    deductions_total: number;
    final: number;
    received: number;
    payments: number;
    refunds: number;
    credit_in: number;
    credit_out: number;
    waived: number;
    waivers: PaisaAdjustmentLine[];
    balance: number;
    due: number;
    due_at_slot: number;
    refund_due: number;
  };
  dispute: { status: string; player_reason: string | null; owner_decision: string | null; claim_id: string; resolved: boolean } | null;
  open_refunds: { dispute_id: string; reason: string; remaining: number }[];
  pending_screenshots: { payment_id: string; amount: number; at: string }[];
  history: PaisaHistoryItem[];
  actions: PaisaAction[];
  credit_available: number;
  can_credit: boolean;
  owed: number;
  final_if_noshow_undone: number;
}

export interface PaisaDaybookRow {
  type: "entry" | "adjustment";
  id: string;
  at: string;
  date: string;
  kind: string;
  bucket: string;
  method: "cash" | "transfer" | "other" | null;
  amount: number;
  by: string | null;
  note: string | null;
  booking_id: string;
  short_code: string;
  player: string;
  court: string;
  slot_business_date: string;
  booking_status: string;
}

export interface PaisaDaybook {
  range: { from: string; to: string };
  days: { date: string; total: number; rows: PaisaDaybookRow[] }[];
  footer: { in: number; out: number; net: number; cash_by: { name: string; amount: number }[] };
}

export interface PaisaPlayer {
  key: { player_id: string | null; phone: string | null };
  name: string;
  phone: string | null;
  due_total: number;
  credit: number;
  open_bookings: { booking_id: string; short_code: string; starts_at: string; slot_date: string; court: string; due: number; money_status: MoneyStatus }[];
}

export interface PaisaPlayers {
  points_awarded: number;
  points_used: number;
  items: PaisaPlayer[];
}

export type PaisaTaskKey =
  | "short_decide"
  | "noshow_reply"
  | "refund_due"
  | "refund_not_got"
  | "bank_check"
  | "screenshots"
  | "attendance"
  | "due_collect";

export const PAISA_TASK_ORDER: readonly PaisaTaskKey[] = [
  "short_decide",
  "noshow_reply",
  "refund_due",
  "refund_not_got",
  "bank_check",
  "screenshots",
  "attendance",
  "due_collect",
];

/** A due (short payment claim) row, as GET /owners/dues returns it. */
export interface PaisaDueItem {
  id: string;
  booking_id: string;
  code: string;
  player_name: string | null;
  due_pkr: number;
  status: "awaiting_reply" | "confirmed" | "disputed" | "no_reply";
  player_reason: string | null;
  owner_decision: "collect" | "waive" | null;
  starts_at: string | null;
  [k: string]: unknown;
}

export interface PaisaNoShowItem {
  booking_id: string;
  player_name: string | null;
  court_name: string | null;
  starts_at: string | null;
  marked_by_name: string | null;
  marked_at: string;
  reply_id: string | null;
  player_note: string | null;
  arrival_verdict: string | null;
  arrival_distance_m: number | null;
  highlight: boolean;
}

export interface PaisaBankMissingItem {
  entry_id: string;
  booking_id: string;
  code: string;
  player_name: string | null;
  amount_pkr: number;
  approved_by_name: string | null;
  credited_at: string;
  decision: "staff" | "player" | null;
  [k: string]: unknown;
}

export type PaisaTaskGroup =
  | { key: "short_decide" | "due_collect"; count: number; items: PaisaDueItem[] }
  | { key: "noshow_reply"; count: number; items: PaisaNoShowItem[] }
  | { key: "refund_due"; count: number; total: number; oldest_days: number; items: OwnerRefund[] }
  | { key: "refund_not_got"; count: number; items: OwnerRefund[] }
  | { key: "bank_check"; count: number; items: PaisaBankMissingItem[] }
  | { key: "screenshots"; count: number; items: never[] }
  | { key: "attendance"; count: number; items: PaisaBookingRow[] };

export interface PaisaTasks {
  /** the Paisa tab / sidebar badge */
  total: number;
  groups: PaisaTaskGroup[];
}

export type ExcessChoice = "refund" | "credit";

/** 409 EXCESS_CHOICE_REQUIRED details */
export interface ExcessChoiceDetails {
  excess_pkr: number;
  can_credit: boolean;
}

export interface CancelPreview {
  allowed: boolean;
  mode: "refund" | "keep" | "clear";
  late: boolean;
  paid_pkr: number;
  refund_pkr: number;
  keep_pkr: number;
}

/** Statement identity (contract 1): Final = Received + Due + Due at slot + Waived - Refund due. Used by tests and screens. */
export function statementBalances(s: PaisaStatement): boolean {
  return s.final === s.received + s.due + s.due_at_slot + s.waived - s.refund_due;
}

export type PaisaTab = "bookings" | "lenden" | "players" | "kaam";
export const PAISA_TABS: readonly PaisaTab[] = ["bookings", "lenden", "players", "kaam"];
