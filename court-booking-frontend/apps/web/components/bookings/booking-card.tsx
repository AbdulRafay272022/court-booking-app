"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { statusGroup, type Booking, type BookingStatus, type Review, type StatusGroup } from "@court-booking/types";
import { courtLabel } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { buttonClasses } from "@/components/site/button";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey, TFunction } from "@/lib/i18n";
import { searchHref } from "@/lib/search-links";
import { statusPill as honestStatus } from "@court-booking/ui-tokens";
import { useFlLang } from "@/components/fl";

const REVIEW_EDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** The current time, refreshed every minute, so time-window checks (review edit, cancellation cutoff) stay right while a tab stays open. */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/* ---------- status ---------- */

type IconName = "check" | "clock" | "x" | "ban";

// Every status gets a coloured icon matching its label colour. The no_show icon (a circle with a slash, "didn't show") is
// deliberately distinct from cancelled's plain X.
export const STATUS_META: Record<BookingStatus, { label: MessageKey; icon: IconName }> = {
  held: { label: "bookings.status.held", icon: "clock" },
  payment_submitted: { label: "bookings.status.payment_submitted", icon: "clock" },
  booked: { label: "bookings.status.booked", icon: "check" },
  completed: { label: "bookings.status.completed", icon: "check" },
  no_show: { label: "bookings.status.no_show", icon: "ban" },
  cancelled: { label: "bookings.status.cancelled", icon: "x" },
};

// Khelo status palette. Text colours are the ones that clear 4.5:1 on their own background; "danger" only exists as a
// bright accent (not a text colour), so the cancelled pill is a white chip with a danger border and icon and ink text.
export const GROUP_STYLE: Record<StatusGroup, { pill: string; strip: string; text: string }> = {
  confirmed: { pill: "bg-fl-open-tint text-fl-open border-fl-open", strip: "bg-fl-open", text: "text-fl-open" },
  pending: { pill: "bg-fl-waiting-tint text-fl-waiting border-fl-amber", strip: "bg-fl-amber", text: "text-fl-waiting" },
  completed: { pill: "bg-fl-booked-bg text-fl-muted border-fl-line-strong", strip: "bg-fl-muted2", text: "text-fl-muted" },
  cancelled: { pill: "bg-fl-white text-fl-night border-fl-danger", strip: "bg-fl-danger", text: "text-fl-night" },
};

function StatusIcon({ name, size = 13 }: { name: IconName; size?: number }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "shrink-0", "aria-hidden": true,
  };
  if (name === "check") return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>;
  if (name === "clock") return <svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
  if (name === "x") return <svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}

/**
 * The booking's status pill. The words come from the shared honest mapping (statusPill in @court-booking/ui-tokens): "Pakki ✓"
 * only for `booked`, Hold / Venue check while waiting, and who cancelled (player / venue / expired) for cancelled bookings.
 */
export function StatusPill({ booking, dark = false }: { booking: Pick<Booking, "status" | "cancelled_by" | "cancellation_reason">; dark?: boolean }) {
  const lang = useFlLang();
  const meta = STATUS_META[booking.status];
  const style = GROUP_STYLE[statusGroup(booking.status)];
  const spec = honestStatus({ status: booking.status, cancelled_by: booking.cancelled_by, cancellation_reason: booking.cancellation_reason }, lang);
  return (
    <span
      data-testid="status-pill"
      data-status-key={spec.key}
      className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-[12px] font-extrabold ${dark ? "border-fl-a-glass-dark-border bg-fl-a-glass-dark text-fl-white" : style.pill}`}
    >
      <StatusIcon name={meta.icon} />
      {spec.label}
    </span>
  );
}

/* ---------- rate a game ---------- */

/** Rate a completed game (1-5 stars + optional comment); edit within 7 days. */
function RateGame({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const t = useT();
  const now = useNow();
  const editable = !review || now - new Date(review.created_at).getTime() < REVIEW_EDIT_WINDOW_MS;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (rating < 1) {
      setError(t("bookings.rate.pickStar"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (review) await api.reviews.edit(review.id, { rating, comment: comment || undefined });
      else await api.reviews.create({ booking_id: booking.id, rating, comment: comment || undefined });
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (review && !open) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <span aria-label={t("bookings.rate.yourRating", { n: review.rating })} role="img" className="text-[18px] text-fl-amber">
          {"★".repeat(review.rating)}
          <span className="text-fl-line-strong">{"★".repeat(5 - review.rating)}</span>
        </span>
        {editable ? (
          <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-bold text-fl-orange-deep underline-offset-2 hover:underline">
            {t("bookings.rate.edit")}
          </button>
        ) : (
          <span className="text-[12px] text-fl-muted2">{t("bookings.rate.reviewed")}</span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t("bookings.rate.cta")}
        className="khelo-btn inline-flex min-h-11 items-center self-start rounded-[14px] bg-fl-orange px-4 py-2 text-[14px] font-extrabold text-fl-night"
      >
        {t("bookings.rate.cta")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-0.5" role="radiogroup" aria-label={t("bookings.rate.group")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            aria-label={t(n === 1 ? "bookings.rate.star1" : "bookings.rate.stars", { n })}
            onClick={() => setRating(n)}
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-3xl leading-none transition-transform hover:scale-110 ${n <= rating ? "text-fl-amber" : "text-fl-line-strong"}`}
          >
            {"★"}
          </button>
        ))}
      </div>
      <textarea
        aria-label={t("bookings.rate.commentLabel")}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("bookings.rate.commentPlaceholder")}
        className="khelo-input rounded-[14px] border-[1.5px] border-fl-line-strong bg-fl-white p-3 text-[15px] text-fl-night outline-none"
        rows={2}
      />
      {error ? (
        <p role="alert" className="text-[13px] font-bold text-fl-night">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-fl-danger" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="khelo-btn inline-flex min-h-11 items-center rounded-[14px] bg-fl-orange px-4 py-2 text-[14px] font-extrabold text-fl-night disabled:opacity-60">
          {busy ? t("bookings.rate.saving") : review ? t("bookings.rate.update") : t("bookings.rate.submit")}
        </button>
        <button onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center px-3 text-[14px] font-bold text-fl-muted hover:text-fl-night">
          {t("bookings.rate.cancel")}
        </button>
      </div>
    </div>
  );
}

/* ---------- shared booking behaviour ---------- */

/** Court, venue and what the player may do with this booking. Same rules the old My bookings cards used. */
function useBookingView(booking: Booking, onChanged: () => void) {
  const router = useRouter();
  const t = useT();
  const now = useNow();
  const fmt = useFmt();
  const courtQuery = useQuery({ queryKey: ["court", booking.court_id], queryFn: () => api.courts.get(booking.court_id) });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const court = courtQuery.data;
  const canResumePay = booking.status === "held" || booking.status === "payment_submitted";

  // A cutoff only ever gets more restrictive as start approaches, so this can't go stale the way a one-shot fetch might.
  // The server re-checks it at cancel time regardless; this is a UX convenience, not the source of truth.
  const withinCutoff =
    court?.cancellation_cutoff_hours != null && new Date(booking.starts_at).getTime() - now < court.cancellation_cutoff_hours * 3_600_000;
  const canCancelBooked = booking.status === "booked" && !!court?.cancellation_allowed && !withinCutoff;
  const canCancel = canResumePay || canCancelBooked;
  const bookedNotCancellable = booking.status === "booked" && !canCancelBooked && !!court;
  const policyNote = bookedNotCancellable ? (withinCutoff ? t("bookings.policy.closed") : fmt.cancellationPolicy(court)) : null;

  async function handleCancel() {
    const isPaid = booking.status === "booked";
    // The refundable amount is shown BEFORE the player confirms, in plain words. A cancel that is allowed to go through is
    // always fully refundable: the cutoff blocks the cancel outright instead of making part of it non-refundable.
    const confirmMessage = isPaid
      ? t("bookings.cancel.confirmPaid", { amount: formatPKR(booking.amount_paid) })
      : t("bookings.cancel.confirmUnpaid");
    if (!confirm(confirmMessage)) return;
    try {
      await api.bookings.cancel(booking.id);
      if (isPaid) {
        alert(t("bookings.cancel.doneRefund", { amount: formatPKR(booking.amount_paid) }));
      }
      onChanged();
    } catch (e) {
      alert(friendlyErrorMessage(e));
    }
  }

  return {
    court,
    venueName: venueQuery.data?.name,
    venue: venueQuery.data,
    canResumePay,
    canCancel,
    policyNote,
    handleCancel,
    goPay: () => router.push(`/booking/${booking.id}/pay`),
    goDetail: () => router.push(`/booking/${booking.id}/done`),
    goCheckin: () => router.push(`/booking/${booking.id}/checkin`),
  };
}

function courtLine(court: ReturnType<typeof useBookingView>["court"]): string {
  return court?.name ? `${courtLabel(court.name, court.sport)} · ` : "";
}

/** "in 25 min", "in 2 days", "happening now": same arithmetic as the shared startsInText, but translated. */
export function startsInLabel(t: TFunction, startsAt: string, endsAt: string, now: number = Date.now()): string {
  const start = Date.parse(startsAt);
  if (now >= start) return Date.parse(endsAt) > now ? t("bookings.startsIn.now") : t("bookings.startsIn.finished");
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes < 60) return t("bookings.startsIn.min", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hours === 1 ? "bookings.startsIn.hour" : "bookings.startsIn.hours", { n: hours });
  const days = Math.floor(hours / 24);
  return t(days === 1 ? "bookings.startsIn.day" : "bookings.startsIn.days", { n: days });
}

const TAG_LINK =
  "relative z-10 inline-flex min-h-8 items-center rounded-full bg-fl-booked-bg px-3 py-1 text-[12px] font-bold capitalize text-fl-night hover:bg-fl-line";

/** Sport, area and Indoor/Outdoor labels as links to the matching filtered Search. Each is a sibling link (never wrapped in another
 * link); the click does not bubble to a card that is itself clickable (resume payment). */
export function BookingTags({
  court,
  venue,
  dark = false,
}: {
  court?: { sport: string; is_indoor: boolean } | null;
  venue?: { city: string; area: string | null } | null;
  dark?: boolean;
}) {
  const t = useT();
  if (!court && !venue) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const area = venue?.area ?? venue?.city;
  const cls = dark ? TAG_LINK.replace("bg-fl-booked-bg", "bg-white/15").replace("text-fl-night", "text-white").replace("hover:bg-fl-line", "hover:bg-white/25") : TAG_LINK;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="booking-tags">
      {court?.sport ? (
        <li>
          <Link href={searchHref({ sport: court.sport })} onClick={stop} className={cls}>
            {court.sport}
          </Link>
        </li>
      ) : null}
      {area ? (
        <li>
          <Link href={searchHref({ city: venue?.city, area: venue?.area })} onClick={stop} className={cls}>
            {area}
          </Link>
        </li>
      ) : null}
      {court ? (
        <li>
          <Link href={searchHref({ indoor: court.is_indoor })} onClick={stop} className={cls}>
            {court.is_indoor ? t("bookings.tag.indoor") : t("bookings.tag.outdoor")}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/* ---------- cards ---------- */

/** One booking in the Upcoming / Past lists. */
export function BookingCard({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const t = useT();
  const fmt = useFmt();
  const v = useBookingView(booking, onChanged);
  const group = statusGroup(booking.status);
  const style = GROUP_STYLE[group];
  const dateParts = fmt.date(booking.starts_at).match(/^(\w+), (\d+) (\w+)/);

  return (
    <article
      data-testid="booking-card"
      data-status={booking.status}
      {...cardOpenProps(v.goDetail, t("bookings.card.openDetail", { venue: v.venueName ?? "" }))}
      className={`khelo-card relative flex cursor-pointer overflow-hidden rounded-3xl bg-fl-white shadow-fl-card-soft outline-none focus-visible:ring-2 focus-visible:ring-fl-teal ${
        group === "cancelled" ? "opacity-90" : ""
      }`}
    >
      <span className={`w-1.5 shrink-0 ${style.strip}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-fl-orange-tint text-fl-orange-deep" aria-hidden="true">
            {dateParts ? (
              <>
                <span className="text-[10.5px] font-extrabold uppercase leading-none tracking-wider">{dateParts[1]}</span>
                <span className="font-khelo-display text-[22px] font-extrabold leading-tight">{dateParts[2]}</span>
                <span className="text-[10.5px] font-extrabold uppercase leading-none tracking-wider">{dateParts[3]}</span>
              </>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="truncate font-khelo-display text-[19px] font-extrabold leading-snug tracking-tight">{v.venueName ?? "…"}</h3>
            <p className="text-[14px] text-fl-muted">
              {courtLine(v.court)}
              {fmt.date(booking.starts_at)} {"·"} {fmt.timeRange(booking.starts_at, booking.ends_at)}
            </p>
            <span className="mt-1 self-start">
              <StatusPill booking={booking} />
            </span>
            <BookingTags court={v.court} venue={v.venue} />
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-fl-line pt-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-fl-muted2">{t("bookings.card.paid")}</dt>
            <dd className="text-[17px] font-extrabold">PKR {formatPKR(booking.amount_paid)}</dd>
          </div>
          {booking.balance_due > 0 ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-fl-muted2">{t("bookings.card.atVenue")}</dt>
              <dd className="text-[17px] font-extrabold text-fl-waiting">PKR {formatPKR(booking.balance_due)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {v.canResumePay ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                v.goPay();
              }}
              className={buttonClasses({ variant: "primary", size: "sm", className: "!px-5 !py-2" })}
            >
              {booking.status === "held" ? t("bookings.card.completePay") : t("bookings.card.viewPay")}
            </button>
          ) : null}
          {booking.status === "booked" ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                v.goCheckin();
              }}
              className={buttonClasses({ variant: "outlineDark", size: "sm", className: "!px-5 !py-2" })}
            >
              {t("bookings.card.checkin")}
            </button>
          ) : null}
          {v.canCancel ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                v.handleCancel();
              }}
              className="inline-flex min-h-11 items-center px-2 text-[14px] font-bold text-fl-night underline decoration-fl-danger decoration-2 underline-offset-4"
            >
              {t("bookings.card.cancel")}
            </button>
          ) : null}
        </div>
        {v.policyNote ? <p className="text-[13px] leading-snug text-fl-muted">{v.policyNote}</p> : null}
        {booking.status === "completed" ? <RateGame booking={booking} review={review} onChanged={onChanged} /> : null}
      </div>
    </article>
  );
}

/** Audit 2026-10-28 item 4: the whole card opens the booking's detail page, for EVERY status. A click on a button or link
 * inside the card does its own thing instead (cancel, pay, review...). Keyboard: Enter / Space on the focused card. */
function cardOpenProps(open: () => void, label: string) {
  const fromControl = (target: EventTarget | null) => target instanceof Element && !!target.closest("button, a, input, textarea, select, [role=dialog]");
  return {
    role: "link" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: (e: MouseEvent) => {
      if (!fromControl(e.target)) open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        open();
      }
    },
  };
}

/** The featured card at the top of the dashboard: the player's next active booking. */
export function NextBookingCard({ booking, onChanged, showPaid = false }: { booking: Booking; onChanged: () => void; showPaid?: boolean }) {
  const t = useT();
  const fmt = useFmt();
  const v = useBookingView(booking, onChanged);
  const group = statusGroup(booking.status);

  return (
    <section
      data-testid="next-booking"
      {...cardOpenProps(v.goDetail, t("bookings.next.aria"))}
      className="relative cursor-pointer overflow-hidden rounded-[28px] bg-fl-night p-6 text-white outline-none focus-visible:ring-2 focus-visible:ring-fl-orange sm:p-8"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-fl-teal/40 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] font-extrabold uppercase tracking-[1.5px] text-fl-orange">{t("bookings.next.label")}</span>
          <span className="rounded-full bg-fl-orange px-3 py-1 text-[13px] font-extrabold text-fl-night" data-testid="starts-in">
            {startsInLabel(t, booking.starts_at, booking.ends_at)}
          </span>
          <StatusPill booking={booking} dark />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="font-khelo-display text-[28px] font-extrabold leading-tight tracking-[-0.5px] sm:text-4xl">{v.venueName ?? "…"}</h2>
          <p className="text-[16px] text-white/80">
            {courtLine(v.court)}
            {fmt.date(booking.starts_at)} {"·"} {fmt.timeRange(booking.starts_at, booking.ends_at)}
          </p>
        </div>
        <BookingTags court={v.court} venue={v.venue} dark />
        {showPaid ? (
          <p className="text-[15px] text-white/80" data-testid="next-paid">
            {t("bookings.card.paid")}: <span className="font-extrabold text-white">PKR {formatPKR(booking.amount_paid)}</span>
          </p>
        ) : null}
        {booking.balance_due > 0 ? <BringLine balance={booking.balance_due} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          {v.canResumePay ? (
            <button onClick={v.goPay} className={buttonClasses({ variant: "primary" })}>
              {booking.status === "held" ? t("bookings.card.completePay") : t("bookings.card.viewPay")}
            </button>
          ) : null}
          {booking.status === "booked" ? (
            <button onClick={v.goCheckin} className={buttonClasses({ variant: "primary" })}>
              {t("bookings.card.checkin")}
            </button>
          ) : null}
          {v.canCancel ? (
            <button onClick={v.handleCancel} className="inline-flex min-h-11 items-center px-3 text-[14px] font-bold text-white underline decoration-fl-danger decoration-2 underline-offset-4">
              {t("bookings.card.cancel")}
            </button>
          ) : null}
        </div>
        {v.policyNote && group === "confirmed" ? <p className="text-[13px] text-white/75">{v.policyNote}</p> : null}
      </div>
    </section>
  );
}

/** "Bring PKR 500 to pay at the venue." with the amount in bold (the amount is located in the translated sentence, so word order is free). */
function BringLine({ balance }: { balance: number }) {
  const t = useT();
  const amount = `PKR ${formatPKR(balance)}`;
  const [before, after] = t("bookings.next.bring", { amount }).split(amount);
  return (
    <p className="text-[15px] text-white/80">
      {before}
      <span className="font-extrabold text-white">{amount}</span>
      {after}
    </p>
  );
}
