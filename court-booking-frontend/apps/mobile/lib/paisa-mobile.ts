/** Pure helpers for the mobile ledger v2 "Paisa" screen (no React / RN), unit-tested in lib/paisa-mobile.test.ts. */
import { PAISA_TABS, pktDateString, type MoneyStatus, type PaisaPeriod, type PaisaTab, type PaisaTaskKey } from "@court-booking/types";

export type PaisaView = PaisaTab;

/** Route params of /(owner)/(tabs)/paisa (all strings, all optional). */
export interface PaisaParams {
  view?: string;
  group?: string;
  period?: string;
  from?: string;
  to?: string;
  courts?: string;
  status?: string;
  q?: string;
  booking?: string;
  open?: string;
  staff?: string;
  act?: string;
  who?: string;
  date?: string;
}

export function parseView(v: string | undefined): PaisaView {
  return (PAISA_TABS as readonly string[]).includes(v ?? "") ? (v as PaisaView) : "bookings";
}

/** The old History status chips -> the closest money status on the Bookings tab (others: no status filter). */
const HISTORY_STATUS_TO_MONEY: Record<string, MoneyStatus> = {
  status_pending: "attendance_pending",
  short_paid: "part_paid",
  refund: "refund_due",
  no_show: "noshow_kept",
};

/** /(owner)/history params (from, to, courts, status, q, booking, open, staff, act, who) -> Paisa Bookings params. */
export function historyToPaisa(p: Record<string, string | undefined>, today: string = pktDateString()): PaisaParams {
  const out: PaisaParams = { view: "bookings" };
  const from = p.from || undefined;
  const to = p.to || from;
  if (from) {
    if (from === today && to === today) out.period = "today";
    else {
      out.period = "custom";
      out.from = from;
      out.to = to;
    }
  }
  for (const k of ["courts", "q", "booking", "open", "staff", "act", "who"] as const) if (p[k]) out[k] = p[k];
  const first = (p.status ?? "").split(",").filter(Boolean)[0];
  if (first && HISTORY_STATUS_TO_MONEY[first]) out.status = HISTORY_STATUS_TO_MONEY[first];
  return out;
}

/** /(owner)/(tabs)/refunds params (date, courts, booking, open) -> Paisa Kaam / refund group. */
export function refundsToPaisa(p: Record<string, string | undefined>): PaisaParams {
  const out: PaisaParams = { view: "kaam", group: "refund_due" };
  for (const k of ["date", "courts", "booking", "open"] as const) if (p[k]) out[k] = p[k];
  return out;
}

export function cleanParams(p: PaisaParams): Record<string, string> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
}

export function isPeriod(v: string | undefined): v is PaisaPeriod {
  return ["today", "yesterday", "this_week", "last_7", "last_30", "this_month", "last_3m", "last_6m", "last_1y", "all", "custom"].includes(v ?? "");
}

export function isTaskKey(v: string | undefined): v is PaisaTaskKey {
  return ["short_decide", "noshow_reply", "refund_due", "refund_not_got", "bank_check", "screenshots", "attendance", "due_collect"].includes(v ?? "");
}

/** "4 – 10 Nov" / "4 Nov 2026" from two "YYYY-MM-DD" days (no device timezone involved). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortRange(from: string, to: string): string {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  if (from === to) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** Cash share of cash + transfer, 0..1 (the Money in bar). */
export function cashShare(cash: number, transfer: number): number {
  const total = Math.max(cash, 0) + Math.max(transfer, 0);
  return total > 0 ? Math.max(cash, 0) / total : 0;
}

/** wa.me link for a phone like +923001234567 / 03001234567 (digits only, 92 prefix). */
export function waLink(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Whole rupees typed by a person ("2,000" / "2000"), null when not a positive whole number. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** The given keys of a route-params object that are set (for carrying params through a redirect). */
export function pick(p: Record<string, string | undefined>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (p[k]) out[k] = p[k] as string;
  return out;
}
