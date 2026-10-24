"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import type { HistoryStatusFilter, OwnerOverview } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { allDatesHistoryHref, approvalsHref, historyHref, pendingAllOf, pkr, slotSegments, topCourts } from "@/lib/overview-helpers";
import type { SlotFilter, SlotSegment } from "@/lib/overview-helpers";
import { Popover } from "./overlay";

const SEGMENT_STYLE: Record<SlotSegment["key"], string> = {
  booked: "bg-fl-teal",
  pending: "bg-fl-amber",
  blocked: "bg-fl-muted2",
  free: "bg-fl-teal-tint border border-fl-line-strong",
};

function ArrowUpRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const CARD = "relative rounded-2xl border border-fl-line-strong bg-fl-white p-5 flex flex-col gap-1 min-w-0";
const LABEL = "text-sm font-semibold text-fl-muted";
const BIG = "font-khelo-display font-extrabold text-fl-night leading-none tabular-nums";
const SUB = "text-[13px] text-fl-muted";
const LEGEND_ITEM =
  "min-h-11 w-full sm:w-auto inline-flex items-center gap-2 rounded-xl border border-fl-line-strong bg-fl-ground px-3 text-[13px] font-semibold text-fl-night whitespace-nowrap hover:border-fl-night";

/** A card title that may only break BEFORE a bracket: "Collected (ab tak mila)" becomes "Collected" + "(ab tak mila)", each
 * kept on one line, so a narrow card shows two clean lines instead of a word split anywhere (QA round 2, 360 / 1280 px). */
function TitleText({ text }: { text: string }) {
  const i = text.indexOf(" (");
  if (i <= 0) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <>
      <span className="whitespace-nowrap">{text.slice(0, i)}</span>{" "}
      <span className="whitespace-nowrap">{text.slice(i + 1)}</span>
    </>
  );
}

/**
 * A money value ("PKR 31,500") that never breaks onto two lines (Stage 2, B.c): `whitespace-nowrap`, and the font shrinks with
 * the card's own width (container query units) and with the text length, from 30px down to 16px, so five cards in one row at
 * 1280 px still fit "PKR 1,231,500" in Roman Urdu as well as English.
 */
function MoneyValue({ text, testId }: { text: string; testId?: string }) {
  // ~0.62em per character in the display font at extra-bold; 96% of the width leaves room for rounding
  const fit = Math.floor(960 / (Math.max(text.length, 6) * 0.62)) / 10;
  return (
    <div className="@container mt-2 min-w-0">
      <p data-testid={testId} className={`${BIG} whitespace-nowrap`} style={{ fontSize: `clamp(1rem, ${fit}cqi, 1.875rem)` }}>
        {text}
      </p>
    </div>
  );
}

/** A card whose title is a link stretched over the whole card; controls inside it sit above with `relative z-10`. */
function CardTitleLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className={`${LABEL} after:absolute after:inset-0 after:rounded-2xl`}>
      {children}
    </Link>
  );
}

/** "N bookings ka status baqi": one clickable line to History (any date, status_pending filter). Icon + text, 44px target. */
function StatusPendingLine({ n, href }: { n: number; href: string }) {
  const t = useT();
  const text = n === 1 ? t("nsw.line.one") : t("nsw.line.many", { n });
  return (
    <Link
      href={href}
      data-testid="ovw-status-pending"
      aria-label={t("nsw.line.aria", { text })}
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-owner-warn-soft-border bg-owner-warn-soft px-4 py-2.5 text-owner-warn-dark hover:brightness-[0.98]"
    >
      <span className="inline-flex items-center gap-2 text-[15px] font-bold">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {text}
      </span>
      <span className="text-[13px] font-medium text-fl-night">{t("nsw.line.hint")}</span>
      <span className="ml-auto inline-flex items-center">
        <Arrow />
      </span>
    </Link>
  );
}

export interface KpiCardsProps {
  overview: OwnerOverview;
  date: string;
  /** Pakistan "today" (the any-date History link spans around it). */
  today: string;
  /** The `courts` URL value (undefined = all courts). */
  courts: string | undefined;
  onOpenSlots: (filter: SlotFilter) => void;
}

export function KpiCards({ overview, date, today, courts, onOpenSlots }: KpiCardsProps) {
  const t = useT();
  const [courtPopover, setCourtPopover] = useState(false);
  const { slots, bookings, money } = overview;
  const history = (status: HistoryStatusFilter, courtId?: string) => historyHref({ date, courts: courtId ?? courts, status });
  const pendingAll = pendingAllOf(overview);
  // Stage 2 (C.4): bookings whose slot ended and nobody marked (ANY date); an older backend does not send it
  const statusPending = typeof overview.status_pending_count === "number" ? overview.status_pending_count : 0;

  const segments = slotSegments(slots);
  const bookedCourts = topCourts(slots.by_court, (c) => c.booked, 2);

  function legendContent(s: SlotSegment) {
    const swatch = <span aria-hidden="true" className={`inline-block w-3 h-3 shrink-0 rounded-sm ${SEGMENT_STYLE[s.key]}`} />;
    if (s.key === "pending") {
      return (
        <>
          {swatch}
          <span>{t("ovw.kpi.legend.pendingDay", { n: s.count })}</span>
          <span className="text-[12px] font-normal text-fl-muted">({t("ovw.kpi.legend.pendingHint")})</span>
        </>
      );
    }
    return (
      <>
        {swatch}
        <span>{t(`ovw.kpi.legend.${s.key}` as "ovw.kpi.legend.booked", { n: s.count })}</span>
      </>
    );
  }

  return (
    <section aria-label={t("ovw.title")} className="flex flex-col gap-3 md:gap-4" data-testid="ovw-kpis">
      {statusPending > 0 ? <StatusPendingLine n={statusPending} href={allDatesHistoryHref(today, { courts, status: "status_pending" })} /> : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {/* Total slots: bar, legend (each a button), free split, court breakdown */}
        <div className={`${CARD} md:col-span-2`} data-testid="kpi-total">
          <div className="flex items-start justify-between gap-3">
            <p className={LABEL}>{t("ovw.kpi.total")}</p>
            <button
              type="button"
              onClick={() => onOpenSlots("all")}
              data-testid="ovw-see-slots"
              className="min-h-11 -mt-2.5 -mr-2 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-fl-ground text-[13px] font-bold text-fl-night whitespace-nowrap"
            >
              {t("ovw.kpi.seeSlots")}
              <ArrowUpRight />
            </button>
          </div>
          <p className={`${BIG} text-4xl mt-1`} data-testid="kpi-total-n">
            {slots.total}
          </p>
          <div
            role="img"
            aria-label={t("ovw.kpi.barAria", { booked: slots.booked, pending: slots.pending, blocked: slots.blocked, free: slots.free })}
            className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-fl-teal-tint"
          >
            {segments
              .filter((s) => s.count > 0)
              .map((s) => (
                <span
                  key={s.key}
                  title={s.key === "pending" ? t("ovw.kpi.legend.pendingHint") : undefined}
                  className={`h-full ${SEGMENT_STYLE[s.key]}`}
                  style={{ width: `${s.percent}%` }}
                />
              ))}
          </div>
          <ul aria-label={t("ovw.kpi.legendAria")} className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap gap-2" data-testid="kpi-legend">
            {segments.map((s) => (
              <li key={s.key} className="min-w-0">
                {s.key === "booked" ? (
                  <Link href={history("booked")} aria-label={`${t("ovw.kpi.legend.booked", { n: s.count })}. ${t("ovw.kpi.legendGo.booked")}`} data-testid="kpi-legend-booked" className={LEGEND_ITEM}>
                    {legendContent(s)}
                  </Link>
                ) : s.key === "pending" ? (
                  <Link
                    href={approvalsHref(date, courts)}
                    title={t("ovw.kpi.legend.pendingHint")}
                    aria-label={`${t("ovw.kpi.legend.pendingDay", { n: s.count })} (${t("ovw.kpi.legend.pendingHint")}). ${t("ovw.kpi.legendGo.pending")}`}
                    data-testid="kpi-legend-pending"
                    className={LEGEND_ITEM}
                  >
                    {legendContent(s)}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenSlots(s.key as SlotFilter)}
                    aria-label={`${t(`ovw.kpi.legend.${s.key}` as "ovw.kpi.legend.free", { n: s.count })}. ${t(`ovw.kpi.legendGo.${s.key}` as "ovw.kpi.legendGo.free")}`}
                    data-testid={`kpi-legend-${s.key}`}
                    className={LEGEND_ITEM}
                  >
                    {legendContent(s)}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className={`${SUB} mt-2`} data-testid="kpi-free-line">
            {t("ovw.kpi.freeLine", { up: slots.free_upcoming, past: slots.free_past })}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={SUB}>{t("ovw.kpi.byCourt")}:</span>
            {bookedCourts.top.map((c) => (
              <Link
                key={c.court_id}
                href={history("booked", c.court_id)}
                className="min-h-11 inline-flex items-center px-3 rounded-full bg-fl-ground text-[13px] font-semibold text-fl-night whitespace-nowrap max-w-full truncate"
              >
                {c.court_name} {"\u00b7"} {c.booked}
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
                  className="min-h-11 px-3 rounded-full bg-fl-ground text-[13px] font-bold text-fl-night whitespace-nowrap"
                >
                  {t("ovw.kpi.more", { n: bookedCourts.rest })}
                </button>
                <Popover open={courtPopover} onClose={() => setCourtPopover(false)} title={t("ovw.kpi.popover.booked")} testId="ovw-courts-popover">
                  <p className="text-xs text-fl-muted mb-2">{t("ovw.kpi.popover.hint")}</p>
                  <ul className="flex flex-col">
                    {slots.by_court.map((c) => (
                      <li key={c.court_id}>
                        <Link
                          href={history("booked", c.court_id)}
                          className="min-h-11 flex items-center justify-between gap-3 px-2 rounded-lg text-sm font-semibold text-fl-night hover:bg-fl-ground"
                        >
                          <span className="truncate">{c.court_name}</span>
                          <span className="tabular-nums font-extrabold whitespace-nowrap">{t("ovw.kpi.courtBooked", { n: c.booked })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Popover>
              </span>
            ) : null}
          </div>
        </div>

        {/* Pending bookings: ANY date (pending_all), not the day picked above */}
        <div className={`${CARD} bg-fl-waiting-tint border-fl-waiting-border`} data-testid="kpi-pending">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CardTitleLink href={approvalsHref(undefined, courts)} testId="kpi-pending-link">
              <span className="text-fl-waiting whitespace-nowrap">{t("ovw.kpi.pending")}</span>
            </CardTitleLink>
            <span
              data-testid="kpi-pending-scope"
              className="inline-flex items-center gap-1 rounded-full border border-fl-waiting-border bg-fl-white px-2.5 py-0.5 text-[12px] font-bold text-fl-night whitespace-nowrap"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              {t("ovw.kpi.pendingAll")}
            </span>
          </div>
          {pendingAll ? (
            <>
              <p className={`${BIG} text-4xl mt-2`} data-testid="kpi-pending-n">
                {pendingAll.count}
              </p>
              <p className={`${SUB} mt-2`}>{t("ovw.kpi.pendingAllHelp")}</p>
              <div className="relative z-10 mt-2 flex flex-col items-start gap-1">
                <Link
                  href={approvalsHref(undefined, courts)}
                  aria-label={t("ovw.kpi.pendingApprovalAria", { n: pendingAll.approval })}
                  data-testid="kpi-pending-approval"
                  className="min-h-11 inline-flex items-center gap-1.5 text-sm font-bold text-fl-teal-deep"
                >
                  {t("ovw.kpi.pendingApproval", { n: pendingAll.approval })}
                  <Arrow />
                </Link>
                <Link
                  href={allDatesHistoryHref(today, { courts, status: "held" })}
                  aria-label={t("ovw.kpi.pendingPaymentAria", { n: pendingAll.payment })}
                  data-testid="kpi-pay-waiting"
                  className="min-h-11 inline-flex items-center gap-1.5 text-sm font-semibold text-fl-night underline underline-offset-2"
                >
                  {t("ovw.kpi.pendingPayment", { n: pendingAll.payment })}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={`${SUB} mt-2`} data-testid="kpi-pending-unavailable">
                {t("ovw.kpi.pendingUnavailable")}
              </p>
              <div className="relative z-10 mt-1">
                <Link href={approvalsHref(undefined, courts)} className="min-h-11 inline-flex items-center gap-1.5 text-sm font-bold text-fl-teal-deep">
                  {t("ovw.kpi.openApprovals")}
                  <Arrow />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        <div className={CARD} data-testid="kpi-bookings">
          <CardTitleLink href={history("booked")}><TitleText text={t("ovw.kpi.bookings")} /></CardTitleLink>
          <p className={`${BIG} text-4xl mt-2`}>{bookings.count}</p>
          <p className={`${SUB} mt-3`}>{t("ovw.kpi.bookingsSub", { n: slots.booked })}</p>
        </div>

        <div className={CARD} data-testid="kpi-cancelled">
          <CardTitleLink href={history("cancelled")}><TitleText text={t("ovw.kpi.cancelled")} /></CardTitleLink>
          <p className={`${BIG} text-4xl mt-2`}>{bookings.cancelled}</p>
          <p className={`${SUB} mt-3`}>{t("ovw.kpi.cancelledSub")}</p>
        </div>

        <div className={CARD} data-testid="kpi-refunds">
          <CardTitleLink href={history("refund")}><TitleText text={t("ovw.kpi.refunds")} /></CardTitleLink>
          <p className={`${BIG} text-4xl mt-2`}>{bookings.refunds.count}</p>
          <p className={`${SUB} mt-3`}>{bookings.refunds.count > 0 ? pkr(bookings.refunds.amount) : t("ovw.kpi.refundsSub")}</p>
        </div>

        <div className={CARD} data-testid="kpi-collected">
          <CardTitleLink href={history("booked")}><TitleText text={t("ovw.kpi.collected")} /></CardTitleLink>
          <MoneyValue text={pkr(money.collected)} testId="kpi-collected-value" />
          <p className={`${SUB} mt-3`}>{t("ovw.kpi.collectedSub")}</p>
        </div>

        <div className={`${CARD} col-span-2 lg:col-span-1`} data-testid="kpi-due">
          <CardTitleLink href={history("booked")}><TitleText text={t("ovw.kpi.due")} /></CardTitleLink>
          <MoneyValue text={pkr(money.due)} testId="kpi-due-value" />
          <p className={`${SUB} mt-3`}>{t("ovw.kpi.dueSub", { n: money.due_bookings })}</p>
        </div>
      </div>
    </section>
  );
}
