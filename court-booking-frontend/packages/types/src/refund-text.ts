/**
 * fix/nov-9 item 1: the ONE wording of a refund's state, used by the player's booking page and the owner's screens (web +
 * app). A refund can be sent in parts, so "Refund owed 2,000" after 1,000 went back was wrong: it now reads
 * "Refund bheja: PKR 1,000 · Baqi: PKR 1,000".
 */
import type { TextLang } from "./locale-text";

export interface RefundAmounts {
  amount: number;
  status: "owed" | "paid";
  sent?: number | null;
  remaining?: number | null;
}

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString("en-US")}`;

/** sent / remaining, falling back for an older server that only sends amount + status. */
export function refundParts(r: RefundAmounts): { total: number; sent: number; remaining: number } {
  const total = Number(r.amount) || 0;
  const sent = r.sent != null ? Number(r.sent) : r.status === "paid" ? total : 0;
  const remaining = r.remaining != null ? Number(r.remaining) : Math.max(total - sent, 0);
  return { total, sent, remaining };
}

export type RefundTone = "owed" | "partial" | "done";

export function refundSummary(r: RefundAmounts, lang: TextLang = "en"): { text: string; tone: RefundTone } {
  const { total, sent, remaining } = refundParts(r);
  const ru = lang === "ru";
  if (remaining <= 0) return { text: ru ? `Refund bhej diya gaya: ${pkr(sent || total)}` : `Refund sent: ${pkr(sent || total)}`, tone: "done" };
  if (sent > 0) {
    return { text: ru ? `Refund bheja: ${pkr(sent)} · Baqi: ${pkr(remaining)}` : `Refund sent: ${pkr(sent)} · Still owed: ${pkr(remaining)}`, tone: "partial" };
  }
  return { text: ru ? `Refund baqi: ${pkr(remaining)}` : `Refund owed: ${pkr(remaining)}`, tone: "owed" };
}
