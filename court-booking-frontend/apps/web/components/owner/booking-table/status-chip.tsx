"use client";

import type { BookingStatusKey, OwnerBookingRow } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";

const STYLE: Record<BookingStatusKey, string> = {
  booked: "bg-owner-success-soft text-owner-success-dark",
  held: "bg-owner-warn-soft text-owner-warn-dark",
  awaiting_approval: "bg-owner-warn-soft text-owner-warn-dark",
  no_show: "bg-owner-danger-soft text-owner-danger",
  cancelled: "bg-owner-border-light text-owner-ink-muted",
  refund_owed: "bg-owner-warn-soft text-owner-warn-dark",
  refunded: "bg-owner-accent-soft text-owner-accent",
  expired: "bg-owner-border-light text-owner-ink-muted",
};

/** The label of a status key ("hist.st.<key>"): shared by the chip, the detail popup and the CSV-free status filter list. */
export function statusLabelKey(key: BookingStatusKey): MessageKey {
  return `hist.st.${key}` as MessageKey;
}

export function StatusChip({ statusKey }: { statusKey: BookingStatusKey }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-bold ${STYLE[statusKey] ?? STYLE.cancelled}`}>
      {t(statusLabelKey(statusKey))}
    </span>
  );
}

/** Row shape helper used by both views: confirmed bookings (the only ones that can be marked complete). */
export function isConfirmedBooked(row: Pick<OwnerBookingRow, "kind" | "status_key">): boolean {
  return row.kind === "booked" && (row.status_key === "booked" || row.status_key === "no_show");
}
