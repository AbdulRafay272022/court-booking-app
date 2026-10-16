"use client";

import type { OwnerBookingRow } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";

function Icon({ d }: { d: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CHECK = "M5 12.5l4.5 4.5L19 7.5";
const WARN = "M12 8v5m0 3.5h.01M12 3a9 9 0 100 18 9 9 0 000-18z";

const BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-bold";

/** Mukammal (green + check), Adhoora (red + warning) and Check-in chips: icon AND word, never colour alone. */
export function CompletionChips({ row, showCheckedIn = true }: { row: Pick<OwnerBookingRow, "completion" | "checked_in">; showCheckedIn?: boolean }) {
  const t = useT();
  const done = row.completion;
  return (
    <>
      {done?.result === "yes" ? (
        <span className={`${BASE} bg-owner-success-soft text-owner-success-dark`}>
          <Icon d={CHECK} />
          {t("hist.chip.complete")}
        </span>
      ) : null}
      {done?.result === "no" ? (
        <span className={`${BASE} bg-owner-danger-soft text-owner-danger`}>
          <Icon d={WARN} />
          {t("hist.chip.short")}
        </span>
      ) : null}
      {showCheckedIn && row.checked_in ? (
        <span className={`${BASE} bg-owner-accent-soft text-owner-accent`}>
          <Icon d={CHECK} />
          {t("hist.chip.checkedIn")}
        </span>
      ) : null}
    </>
  );
}
