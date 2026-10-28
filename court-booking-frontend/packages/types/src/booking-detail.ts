import type { Booking } from "./booking";
import type { TextLang } from "./locale-text";

/** Audit 2026-10-28 item 4: GET /bookings/{id}/detail, the player's own booking on one screen (web /booking/[id]/done,
 * app booking/[id]/done). Mirrors app/schemas/booking.py PlayerBookingDetailOut. */
export interface PlayerBookingDetail {
  booking: Booking;
  venue: {
    id: string;
    name: string;
    slug: string;
    area: string | null;
    city: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    cancellation_allowed: boolean;
    cancellation_cutoff_hours: number | null;
  };
  court: { id: string; name: string; sport: string; is_indoor: boolean };
  duration_minutes: number;
  payments: { at: string; amount: number; method: "bank_transfer_proof" | "cash_at_venue" | "other"; is_reversal: boolean }[];
  timeline: { at: string; kind: string; amount: number | null; note: string | null }[];
  refund: { amount: number; status: "owed" | "paid"; paid_at: string | null } | null;
}

const TIMELINE: Record<TextLang, Record<string, string>> = {
  ru: {
    held: "Slot hold hua",
    created: "Booking bani",
    proof_submitted: "Payment screenshot bheja",
    approved: "Venue ne payment approve ki",
    rejected: "Venue ne payment reject ki",
    expired: "Waqt khatam, booking cancel",
    cancelled: "Booking cancel hui",
    refund_owed: "Refund baqi",
    refunded: "Refund bhej diya gaya",
    checked_in: "Check-in ho gaya",
    no_show: "No-show mark hua",
    slot_started: "Khel shuru hua",
    balance_received: "Baqi paise mile",
    completion_marked: "Booking mukammal mark hui",
  },
  en: {
    held: "Slot held",
    created: "Booking created",
    proof_submitted: "Payment screenshot sent",
    approved: "Venue approved the payment",
    rejected: "Venue rejected the payment",
    expired: "Time ran out, booking cancelled",
    cancelled: "Booking cancelled",
    refund_owed: "Refund owed",
    refunded: "Refund sent",
    checked_in: "Checked in",
    no_show: "Marked as no-show",
    slot_started: "Game started",
    balance_received: "Balance received",
    completion_marked: "Booking marked complete",
  },
};

/** The words for one timeline event kind; an unknown kind falls back to the kind itself (never blank). */
export function timelineLabel(kind: string, lang: TextLang = "en"): string {
  return TIMELINE[lang][kind] ?? kind.replace(/_/g, " ");
}

/** How a payment line was paid. Negative amounts are refunds or corrections. */
export function paymentLineLabel(line: { amount: number; method: string; is_reversal: boolean }, lang: TextLang = "en"): string {
  const ru = lang === "ru";
  if (line.amount < 0) return line.is_reversal ? (ru ? "Correction" : "Correction") : ru ? "Refund / correction" : "Refund / correction";
  if (line.method === "bank_transfer_proof") return ru ? "Bank transfer" : "Bank transfer";
  if (line.method === "cash_at_venue") return ru ? "Venue par cash" : "Cash at venue";
  return ru ? "Doosra tareeqa" : "Other";
}

/** A wa.me link for a Pakistani number in any common spelling, or null when it is not a usable mobile number. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) digits = `92${digits}`;
  if (!/^923\d{9}$/.test(digits)) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
