/** fix/nov-7: pure helpers behind the owner web "Paisa" page (its Hisaab tab). Unit-tested in paisa.test.ts. */
import { addDays, formatDate, pktDateString, type LedgerEntry } from "@court-booking/types";

export type PaisaPeriod = "aaj" | "hafta" | "mahina";

export const PAISA_PERIODS: readonly PaisaPeriod[] = ["aaj", "hafta", "mahina"];

/** Pakistan calendar range of a period chip: Aaj = today, Is hafta = Monday to today, Is mahina = the 1st to today. */
export function periodRange(period: PaisaPeriod, today: string = pktDateString()): { start: string; end: string } {
  if (period === "aaj") return { start: today, end: today };
  if (period === "mahina") return { start: `${today.slice(0, 8)}01`, end: today };
  const [y, m, d] = today.split("-").map(Number);
  const mondayFirst = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return { start: addDays(today, -mondayFirst), end: today };
}

/** "Mila": money received in the period, split by how it came. Refunds paid back are NOT counted here (they are money out);
 * corrections are (they fix what was received). `other` is a correction / adjustment that is neither cash nor transfer. */
export function milaSplit(entries: readonly LedgerEntry[]): { total: number; cash: number; transfer: number; other: number } {
  let cash = 0;
  let transfer = 0;
  let other = 0;
  for (const e of entries) {
    if (e.entry_type === "refund") continue;
    if (e.method === "cash_at_venue") cash += e.amount_pkr;
    else if (e.method === "bank_transfer_proof") transfer += e.amount_pkr;
    else other += e.amount_pkr;
  }
  return { total: cash + transfer + other, cash, transfer, other };
}

export interface PaisaDay {
  /** Pakistan calendar date "YYYY-MM-DD". */
  day: string;
  /** "Aaj · Sun, 8 Nov" / "Kal · Sat, 7 Nov" / "Jumma, 6 Nov" (Roman Urdu). */
  label: string;
  /** Net of the day's rows (refunds and corrections included). */
  total: number;
  /** Newest first. */
  entries: LedgerEntry[];
}

/** The day header in Roman Urdu: today and yesterday are named, older days are the date. */
export function dayLabel(day: string, today: string = pktDateString()): string {
  const date = formatDate(`${day}T12:00:00+05:00`, new Date(`${today}T12:00:00+05:00`), "ru");
  if (day === today) return `Aaj · ${date}`;
  if (day === addDays(today, -1)) return `Kal · ${date}`;
  return date;
}

/** Rows grouped by Pakistan day, newest day first, newest row first. */
export function groupByDay(entries: readonly LedgerEntry[], today: string = pktDateString()): PaisaDay[] {
  const byDay = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const day = pktDateString(e.recorded_at);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({
      day,
      label: dayLabel(day, today),
      total: list.reduce((s, e) => s + e.amount_pkr, 0),
      entries: [...list].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)),
    }));
}

/** What a row is, in Roman Urdu. */
export function entryKind(e: LedgerEntry): string {
  if (e.entry_type === "correction") return "Raqam theek ki gayi";
  if (e.entry_type === "refund") return "Wapas diye";
  if (e.method === "cash_at_venue") return "Cash";
  if (e.method === "bank_transfer_proof") return "Transfer";
  return "Doosra tareeqa";
}

/** A correction's old -> new total paid ("PKR 3,000 -> PKR 1,000"), or null when the server did not send it. */
export function correctionChange(e: LedgerEntry, pkr: (n: number) => string): string | null {
  if (e.entry_type !== "correction" || e.paid_before_pkr == null || e.paid_after_pkr == null) return null;
  return `${pkr(e.paid_before_pkr)} → ${pkr(e.paid_after_pkr)}`;
}
