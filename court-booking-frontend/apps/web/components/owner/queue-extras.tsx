"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/i18n/lang-provider";
import { historyHref } from "@/lib/queue-filter";

/** "Naya" chip: text + dot, so colour is never the only signal. */
export function NayaChip() {
  const t = useT();
  return (
    <span data-testid="naya-chip" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-khelo-warm px-2.5 py-1 text-[12px] font-extrabold text-khelo-orange-label">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-khelo-orange" />
      {t("notif.naya")}
    </span>
  );
}

/** Shown while the Overview's date / court filter is active: how many rows, and "Sab dikhao" (clears the filter). */
export function FilterBanner({ kind, count }: { kind: "approvals" | "refunds"; count: number }) {
  const t = useT();
  const pathname = usePathname();
  const text = t(`notif.filter.${kind}.${count === 1 ? "one" : "many"}`, { n: count });
  return (
    <div data-testid="filter-banner" role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-owner-warn-soft-border bg-owner-warn-soft px-4 py-2.5 text-[13.5px] font-semibold text-owner-warn-dark">
      <span>{text}</span>
      <Link href={pathname} data-testid="filter-clear" className="inline-flex min-h-11 items-center font-bold text-owner-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent">
        {t("notif.filter.clear")}
      </Link>
    </div>
  );
}

/** Details (opens the shared booking popup) + "History mein dekho" (the History page with the row highlighted). */
export function RowLinks({ bookingId, startsAt, filterDate, who, onDetails }: { bookingId: string | undefined; startsAt: string; filterDate?: string; who: string; onDetails: () => void }) {
  const t = useT();
  if (!bookingId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="row-details"
        aria-label={t("notif.detailsAria", { who })}
        onClick={onDetails}
        className="min-h-11 cursor-pointer rounded-lg border border-owner-border bg-owner-surface px-4 text-[13.5px] font-semibold text-owner-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
      >
        {t("notif.details")}
      </button>
      <Link
        href={historyHref(bookingId, startsAt, filterDate)}
        data-testid="row-history"
        className="inline-flex min-h-11 items-center rounded-lg px-2 text-[13.5px] font-semibold text-owner-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
      >
        {t("notif.history")}
      </Link>
    </div>
  );
}
