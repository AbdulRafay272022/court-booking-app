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
  refunded: "bg-owner-accent-soft text-fl-teal-deep",
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

/**
 * Stage 2 (C.3): the slot ended and nobody marked the booking yet (Haan / Nahi or No-show). The server sends `status_pending`;
 * an older backend does not, so the same rule is applied here (booked, ended, not completed, not checked in).
 */
export function isStatusPending(
  row: Pick<OwnerBookingRow, "kind" | "status_key" | "slot_ended" | "completion" | "checked_in" | "status_pending">,
): boolean {
  if (typeof row.status_pending === "boolean") return row.status_pending;
  return row.kind === "booked" && row.status_key === "booked" && row.slot_ended && !row.completion && !row.checked_in;
}

/** "Status baqi": clock icon + text (never colour alone). */
export function StatusPendingChip() {
  const t = useT();
  return (
    <span data-testid="status-pending-chip" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-owner-warn-soft-border bg-owner-warn-soft px-2.5 py-0.5 text-[12.5px] font-bold text-owner-warn-dark">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {t("nsw.chip.pending")}
    </span>
  );
}

/** The manual "Nahi aaye (No-show)" button; only rendered for a status-pending row and a permitted user. */
export function NoShowButton({ name, onClick, busy, compact }: { name: string; onClick: () => void; busy?: boolean; compact?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="no-show-btn"
      aria-label={t("nsw.btnAria", { name })}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl border-[1.5px] border-owner-danger-soft-border bg-owner-surface px-3 font-bold text-owner-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent disabled:opacity-60 ${compact ? "text-[13px]" : "text-[14px]"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6l12.8 12.8" />
      </svg>
      {t("nsw.btn")}
    </button>
  );
}
