import type { BookingStatusKey, OwnerBookingRow } from "@court-booking/types";

import { pktDateString } from "@/lib/format";

// Colours for the owner overview. Same hex values as the owner tokens in tailwind.config.js (used inline where a
// style object is needed, e.g. dynamic bar widths and row tints).
export const OV = {
  ink: "#101C21",
  muted: "#5B7079",
  faint: "#8399A1",
  border: "#DCE3E6",
  accent: "#0E6274",
  accentSoft: "#EBF2F4",
  greenBg: "#E4F0EA",
  greenBorder: "#A9CFBD",
  green: "#1F7A52",
  greenDark: "#14563A",
  redBg: "#F8E5E0",
  redBorder: "#DDBAB1",
  red: "#8C3823",
  amberBg: "#FBF0DD",
  amberBorder: "#E8D3A8",
  amber: "#9C5C0A",
  amberDark: "#7A480A",
  orange: "#FF6A2B",
  bar: { booked: "#0E6274", pending: "#F08A3C", blocked: "#8399A1", free: "#DCE9E7" },
};

/** "1 ghanta", "2 ghanta", "90 minute". */
export function durationLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ghanta`;
  return `${minutes} minute`;
}

/** "C1" for "Court 1", else the name as is. */
export function courtShort(name: string): string {
  const m = /^court\s*(\d+)$/i.exec(name.trim());
  return m ? `C${m[1]}` : name;
}

/** Just the number for "Court 2", else the name. */
export function courtNumber(name: string): string {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? m[1] : name;
}

export function statusChipLabel(key: BookingStatusKey): string {
  switch (key) {
    case "booked": return "Booked";
    case "held": return "Payment ke intezar";
    case "awaiting_approval": return "Approval ke intezar";
    case "no_show": return "No-show";
    case "cancelled": return "Cancelled";
    case "refund_owed": return "Refund owed";
    case "refunded": return "Refunded";
    case "expired": return "Expired";
  }
}

export type Tone = "green" | "red" | "amber" | "neutral";

/** Card tint: completion wins for booked rows; cancelled red-ish neutral; refund amber. */
export function rowTone(row: OwnerBookingRow): Tone {
  if (row.kind === "refund") return "amber";
  if (row.kind === "cancelled") return "neutral";
  if (row.completion?.result === "yes") return "green";
  if (row.completion?.result === "no") return "red";
  return "neutral";
}

export const TONE_STYLE: Record<Tone, { bg: string; border: string }> = {
  green: { bg: OV.greenBg, border: OV.greenBorder },
  red: { bg: OV.redBg, border: OV.redBorder },
  amber: { bg: OV.amberBg, border: OV.amberBorder },
  neutral: { bg: "#FFFFFF", border: OV.border },
};

export const SOURCE_LABEL: Record<string, string> = { app: "App chat", whatsapp: "WhatsApp", walkin: "Walk-in", phone: "Phone" };

export function dateTitle(date: string): string {
  return date === pktDateString() ? "Aaj" : "Is din";
}

/** The history route params every Overview card carries (date + courts, plus a status). */
export function historyParams(date: string, courtIds: string[], status?: string, extra: Record<string, string> = {}) {
  return {
    from: date,
    to: date,
    ...(courtIds.length ? { courts: courtIds.join(",") } : {}),
    ...(status ? { status } : {}),
    ...extra,
  };
}

export const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "booked", label: "Booked" },
  { key: "pending", label: "Pending" },
  { key: "cancelled", label: "Cancelled" },
  { key: "refund", label: "Refund" },
  { key: "completed", label: "Mukammal" },
  { key: "short_paid", label: "Adhoora" },
  { key: "held", label: "Payment ke intezar" },
  { key: "awaiting_approval", label: "Approval ke intezar" },
  { key: "no_show", label: "No-show" },
  { key: "refund_owed", label: "Refund owed" },
  { key: "refunded", label: "Refunded" },
  { key: "expired", label: "Expired" },
];
