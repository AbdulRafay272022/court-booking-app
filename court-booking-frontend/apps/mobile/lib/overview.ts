import type { BookingStatusKey, MyPermissions, OwnerBookingRow, StaffPermissionKey } from "@court-booking/types";

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

/** Channel labels (A4). "app" covers the in-app chat AND the website (they cannot be told apart), so never "App chat".
 * The detail sheet uses `bookingChannelLabel` (packages/types) so a walk-in also says who added it. */
export const SOURCE_LABEL: Record<string, string> = { app: "App ya website", whatsapp: "WhatsApp chat", walkin: "Walk-in", phone: "Phone" };

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
  { key: "status_pending", label: "Status baqi" },
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

/** Stage 2 (C.3): the status chip text of a row. A booked row the owner marked with Haan/Nahi is `completed` on the server
 * (status_key stays "booked" for it), so it reads "Completed" instead of "Booked". */
export function rowStatusLabel(row: Pick<OwnerBookingRow, "kind" | "status_key" | "completion">): string {
  if (row.kind === "booked" && row.status_key === "booked" && row.completion) return "Completed";
  return statusChipLabel(row.status_key);
}

/** Stage 2 (C.3): booked, slot over, nobody marked it yet. Only the server knows (an older backend sends nothing = no chip). */
export function isStatusPending(row: Pick<OwnerBookingRow, "status_pending">): boolean {
  return row.status_pending === true;
}

/** Stage 2 (C.3): "Nahi aaye (No-show)" is offered only on a still-booked row whose slot has ended and that nobody marked
 * (not checked in, no Haan/Nahi). The server allows booked -> no_show only. */
export function canOfferNoShow(
  row: Pick<OwnerBookingRow, "kind" | "status_key" | "slot_ended" | "checked_in" | "completion">,
  completion: OwnerBookingRow["completion"] = row.completion,
): boolean {
  return row.kind === "booked" && row.status_key === "booked" && row.slot_ended && !row.checked_in && !completion;
}

/** Staff permission keys the owner screens hide buttons by (backend StaffPermissionKey). */
export const PERM = {
  approve: "approve_payments",
  recordPayments: "record_payments",
  checkIn: "check_in",
  refunds: "mark_refunds",
  /** Venue / court settings incl. the Stage 2 timers card (no separate venue-settings key exists). */
  editSettings: "edit_court_settings",
} as const satisfies Record<string, StaffPermissionKey>;

/** Stage 2 (B.b): may this account do `key` at `venueId`? true when allowed OR unknown (no data yet, an older backend, a
 * bad payload): the server's 403 NOT_STAFF_PERMITTED stays the fallback. false only when GET /owners/me/permissions says
 * this is a staff account without that key for the venue. Owners and admins may do everything. */
export function permissionAllows(data: unknown, venueId: string | undefined, key: StaffPermissionKey): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return true;
  const d = data as Partial<MyPermissions>;
  if (d.role !== "staff" || !Array.isArray(d.venue_permissions)) return true;
  const list = venueId ? d.venue_permissions.filter((v) => v && v.venue_id === venueId) : d.venue_permissions;
  return list.some((v) => Array.isArray(v?.permissions) && v.permissions.includes(key));
}

/** Approvals: how many OTHER bookings a flagged screenshot was already used on, or null when there is nothing to show
 * (no duplicate signal, or a count of 0 -- the chip used to read "pehle bhi 0 bookings par use hua hai"). */
export function duplicateChipCount(duplicate: { used_on_bookings?: number | null } | null | undefined): number | null {
  const n = Number(duplicate?.used_on_bookings ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** "This screenshot was already used on N other bookings" (singular for 1). A flagged screenshot whose earlier use was
 * never credited (count 0) still needs the confirm, so it gets a line without a number instead of "0 bookings". */
export function duplicateUsedText(n: number): string {
  if (!(n > 0)) return "Ye screenshot pehle bhi kisi aur payment mein bheja gaya tha";
  return `Ye screenshot pehle bhi ${n} ${n === 1 ? "booking" : "bookings"} par use hua hai`;
}

/** Stage 2: a refund whose screenshot was also credited on N OTHER bookings (OwnerRefund.duplicate_proof). */
export function duplicateCreditText(n: number): string {
  return `Ye screenshot ${n} aur ${n === 1 ? "booking" : "bookings"} par bhi credit hua`;
}

/** Stage 2 (C.4): "N bookings ka status baqi" (singular for 1). */
export function statusPendingLine(n: number): string {
  return `${n} ${n === 1 ? "booking" : "bookings"} ka status baqi`;
}
