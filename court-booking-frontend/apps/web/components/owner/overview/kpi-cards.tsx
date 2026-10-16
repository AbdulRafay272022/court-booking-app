"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import type { HistoryStatusFilter, OwnerOverview } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { approvalsHref, historyHref, pkr, slotSegments, topCourts } from "@/lib/overview-helpers";
import type { SlotSegment } from "@/lib/overview-helpers";
import { Popover } from "./overlay";

const SEGMENT_STYLE: Record<SlotSegment["key"], string> = {
  booked: "bg-khelo-teal",
  pending: "bg-khelo-orange",
  blocked: "bg-khelo-muted-3",
  free: "bg-khelo-mint border border-khelo-dash",
};

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

const CARD = "relative rounded-2xl border border-khelo-border bg-khelo-surface p-5 flex flex-col gap-1 min-w-0";
const LABEL = "text-sm font-semibold text-khelo-muted";
const BIG = "font-khelo-display font-extrabold text-khelo-ink leading-none tabular-nums";
const SUB = "text-[13px] text-khelo-muted";

/** A card whose title is a link stretched over the whole card; controls inside it sit above with `relative z-10`. */
function CardTitleLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className={`${LABEL} after:absolute after:inset-0 after:rounded-2xl`}>
      {children}
    </Link>
  );
}

export interface KpiCardsProps {
  overview: OwnerOverview;
  date: string;
  /** The `courts` URL value (undefined = all courts). */
  courts: string | undefined;
  onOpenSlots: () => void;
}

export function KpiCards({ overview, date, courts, onOpenSlots }: KpiCardsProps) {
  const t = useT();
  const [courtPopover, setCourtPopover] = useState(false);
  const { slots, bookings, money } = overview;
  const history = (status: HistoryStatusFilter, courtId?: string) => historyHref({ date, courts: courtId ?? courts, status });

  const segments = slotSegments(slots);
  const bookedCourts = topCourts(slots.by_court, (c) => c.booked, 2);

  return (
    <section aria-label={t("ovw.title")} className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4" data-testid="ovw-kpis">
      {/* Total slots */}
      <div className={`${CARD} col-span-2`} data-testid="kpi-total">
        <div className="flex items-start justify-between gap-3">
          <p className={LABEL}>{t("ovw.kpi.total")}</p>
          <button
            type="button"
            onClick={onOpenSlots}
            data-testid="ovw-see-slots"
            className="min-h-11 -mt-2.5 -mr-2 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-khelo-page text-[13px] font-bold text-khelo-ink whitespace-nowrap"
          >
            {t("ovw.kpi.seeSlots")}
            <ArrowUpRight />
          </button>
        </div>
        <p className={`${BIG} text-4xl mt-2`}>{slots.total}</p>
        <div
          role="img"
          aria-label={t("ovw.kpi.barAria", { booked: slots.booked, pending: slots.pending, blocked: slots.blocked, free: slots.free })}
          className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-khelo-mint-2"
        >
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <span key={s.key} className={`h-full ${SEGMENT_STYLE[s.key]}`} style={{ width: `${s.percent}%` }} />
            ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-khelo-ink">
          {segments.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${SEGMENT_STYLE[s.key]}`} />
              {t(`ovw.kpi.legend.${s.key}` as "ovw.kpi.legend.booked", { n: s.count })}
            </li>
          ))}
        </ul>
      </div>

      {/* Booked slots */}
      <div className={CARD} data-testid="kpi-booked">
        <CardTitleLink href={history("booked")}>{t("ovw.kpi.booked")}</CardTitleLink>
        <p className={`${BIG} text-4xl mt-2`}>{slots.booked}</p>
        <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
          {bookedCourts.top.map((c) => (
            <Link
              key={c.court_id}
              href={history("booked", c.court_id)}
              className="min-h-9 inline-flex items-center px-3 rounded-full bg-khelo-page text-[13px] font-semibold text-khelo-ink whitespace-nowrap max-w-full truncate"
            >
              {c.court_name} {"·"} {c.booked}
            </Link>
          ))}
          {bookedCourts.top.length === 0 ? <span className={SUB}>{t("ovw.kpi.noneYet")}</span> : null}
          {bookedCourts.rest > 0 ? (
            <span className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={courtPopover}
                aria-label={`${t("ovw.kpi.more", { n: bookedCourts.rest })}: ${t("ovw.kpi.moreAria")}`}
                data-testid="ovw-more-courts"
                onClick={() => setCourtPopover((o) => !o)}
                className="min-h-9 px-3 rounded-full bg-khelo-page text-[13px] font-bold text-khelo-ink whitespace-nowrap"
              >
                {t("ovw.kpi.more", { n: bookedCourts.rest })}
              </button>
              <Popover open={courtPopover} onClose={() => setCourtPopover(false)} title={t("ovw.kpi.popover.booked")} testId="ovw-courts-popover">
                <p className="text-xs text-khelo-muted mb-2">{t("ovw.kpi.popover.hint")}</p>
                <ul className="flex flex-col">
                  {slots.by_court.map((c) => (
                    <li key={c.court_id}>
                      <Link
                        href={history("booked", c.court_id)}
                        className="min-h-11 flex items-center justify-between gap-3 px-2 rounded-lg text-sm font-semibold text-khelo-ink hover:bg-khelo-page"
                      >
                        <span className="truncate">{c.court_name}</span>
                        <span className="tabular-nums font-extrabold">{c.booked}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Popover>
            </span>
          ) : null}
        </div>
      </div>

      {/* Free slots: no history target, it opens the slots popup */}
      <div className={CARD} data-testid="kpi-free">
        <button type="button" onClick={onOpenSlots} className={`${LABEL} text-left after:absolute after:inset-0 after:rounded-2xl`}>
          {t("ovw.kpi.free")}
        </button>
        <p className={`${BIG} text-4xl mt-2`}>{slots.free}</p>
        <p className={`${SUB} mt-3`}>{t("ovw.kpi.freeSub", { up: slots.free_upcoming, past: slots.free_past })}</p>
      </div>

      {/* Bookings */}
      <div className={CARD} data-testid="kpi-bookings">
        <CardTitleLink href={history("booked")}>{t("ovw.kpi.bookings")}</CardTitleLink>
        <p className={`${BIG} text-4xl mt-2`}>{bookings.count}</p>
        <p className={`${SUB} mt-3`}>{t("ovw.kpi.bookingsSub", { n: slots.booked })}</p>
      </div>

      {/* Cancelled */}
      <div className={CARD} data-testid="kpi-cancelled">
        <CardTitleLink href={history("cancelled")}>{t("ovw.kpi.cancelled")}</CardTitleLink>
        <p className={`${BIG} text-4xl mt-2`}>{bookings.cancelled}</p>
        <p className={`${SUB} mt-3`}>{t("ovw.kpi.cancelledSub")}</p>
      </div>

      {/* Refunds */}
      <div className={CARD} data-testid="kpi-refunds">
        <CardTitleLink href={history("refund")}>{t("ovw.kpi.refunds")}</CardTitleLink>
        <p className={`${BIG} text-4xl mt-2`}>{bookings.refunds.count}</p>
        <p className={`${SUB} mt-3`}>{bookings.refunds.count > 0 ? pkr(bookings.refunds.amount) : t("ovw.kpi.refundsSub")}</p>
      </div>

      {/* Pending bookings */}
      <div className={`${CARD} bg-khelo-warm-2 border-khelo-orange/50`} data-testid="kpi-pending">
        <CardTitleLink href={approvalsHref(date, courts)} testId="kpi-pending-link">
          <span className="text-khelo-orange-label">{t("ovw.kpi.pending")}</span>
        </CardTitleLink>
        <p className={`${BIG} text-4xl mt-2`}>{bookings.pending.count}</p>
        <p className={`${SUB} mt-3`}>
          {t("ovw.kpi.pendingSub", { a: bookings.pending.awaiting_approval, p: bookings.pending.awaiting_payment })}
        </p>
        <div className="relative z-10 mt-1 flex flex-col items-start gap-0.5">
          <Link href={approvalsHref(date, courts)} className="min-h-9 inline-flex items-center gap-1.5 text-sm font-bold text-khelo-orange-label">
            {t("ovw.kpi.approve")}
            <Arrow />
          </Link>
          {bookings.pending.awaiting_payment > 0 ? (
            <Link
              href={history("held")}
              data-testid="kpi-pay-waiting"
              className="min-h-9 inline-flex items-center text-[13px] font-semibold text-khelo-ink underline underline-offset-2"
            >
              {t("ovw.kpi.payWaiting", { n: bookings.pending.awaiting_payment })}
            </Link>
          ) : null}
        </div>
      </div>

      {/* Collected */}
      <div className={`${CARD} col-span-1 lg:col-span-2`} data-testid="kpi-collected">
        <CardTitleLink href={history("booked")}>{t("ovw.kpi.collected")}</CardTitleLink>
        <p className={`${BIG} mt-2 text-2xl sm:text-4xl xl:text-5xl`}>{pkr(money.collected)}</p>
        <p className={`${SUB} mt-3`}>{t("ovw.kpi.collectedSub")}</p>
      </div>

      {/* Due */}
      <div className={`${CARD} col-span-1 lg:col-span-2`} data-testid="kpi-due">
        <CardTitleLink href={history("booked")}>{t("ovw.kpi.due")}</CardTitleLink>
        <p className={`${BIG} mt-2 text-2xl sm:text-4xl xl:text-5xl`}>{pkr(money.due)}</p>
        <p className={`${SUB} mt-3`}>{t("ovw.kpi.dueSub", { n: money.due_bookings })}</p>
      </div>
    </section>
  );
}
