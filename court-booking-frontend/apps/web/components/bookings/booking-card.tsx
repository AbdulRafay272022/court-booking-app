"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cancellationPolicyText } from "@court-booking/api-client";
import { startsInText, statusGroup, type Booking, type BookingStatus, type Review, type StatusGroup } from "@court-booking/types";
import { courtLabel } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";
import { buttonClasses } from "@/components/site/button";

const REVIEW_EDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** The current time, refreshed every minute, so time-window checks (review edit, cancellation cutoff) stay right while a tab stays open. */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/* ---------- status ---------- */

type IconName = "check" | "clock" | "x" | "ban";

// Every status gets a coloured icon matching its label colour. The no_show icon (a circle with a slash, "didn't show") is
// deliberately distinct from cancelled's plain X.
export const STATUS_META: Record<BookingStatus, { label: string; icon: IconName }> = {
  held: { label: "Holding your slot", icon: "clock" },
  payment_submitted: { label: "Waiting for approval", icon: "clock" },
  booked: { label: "Confirmed", icon: "check" },
  completed: { label: "Completed", icon: "check" },
  no_show: { label: "No-show", icon: "ban" },
  cancelled: { label: "Cancelled", icon: "x" },
};

// Khelo status palette. Text colours are the ones that clear 4.5:1 on their own background; "danger" only exists as a
// bright accent (not a text colour), so the cancelled pill is a white chip with a danger border and icon and ink text.
export const GROUP_STYLE: Record<StatusGroup, { pill: string; strip: string; text: string }> = {
  confirmed: { pill: "bg-khelo-success-bg text-khelo-success-text border-khelo-success", strip: "bg-khelo-success", text: "text-khelo-success-text" },
  pending: { pill: "bg-khelo-warning-bg text-khelo-warning-text border-khelo-warning", strip: "bg-khelo-warning", text: "text-khelo-warning-text" },
  completed: { pill: "bg-khelo-booked-bg text-khelo-muted border-khelo-border", strip: "bg-khelo-muted-3", text: "text-khelo-muted" },
  cancelled: { pill: "bg-khelo-surface text-khelo-ink border-khelo-danger", strip: "bg-khelo-danger", text: "text-khelo-ink" },
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

export function StatusPill({ status, dark = false }: { status: BookingStatus; dark?: boolean }) {
  const meta = STATUS_META[status];
  const style = GROUP_STYLE[statusGroup(status)];
  return (
    <span
      data-testid="status-pill"
      className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-[12px] font-extrabold ${dark ? "border-white/30 bg-white/10 text-white" : style.pill}`}
    >
      <StatusIcon name={meta.icon} />
      {meta.label}
    </span>
  );
}

/* ---------- rate a game ---------- */

/** Rate a completed game (1-5 stars + optional comment); edit within 7 days. */
function RateGame({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const now = useNow();
  const editable = !review || now - new Date(review.created_at).getTime() < REVIEW_EDIT_WINDOW_MS;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (rating < 1) {
      setError("Pick a star rating.");
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
        <span aria-label={`Your rating: ${review.rating} of 5`} role="img" className="text-[18px] text-khelo-warning">
          {"★".repeat(review.rating)}
          <span className="text-khelo-border">{"★".repeat(5 - review.rating)}</span>
        </span>
        {editable ? (
          <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-bold text-khelo-orange-text underline-offset-2 hover:underline">
            Edit
          </button>
        ) : (
          <span className="text-[12px] text-khelo-muted-2">Reviewed</span>
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
        aria-label="Rate your game"
        className="khelo-btn inline-flex min-h-11 items-center self-start rounded-[14px] bg-khelo-orange px-4 py-2 text-[14px] font-extrabold text-khelo-ink"
      >
        Rate your game
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setRating(n)}
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-3xl leading-none transition-transform hover:scale-110 ${n <= rating ? "text-khelo-warning" : "text-khelo-border"}`}
          >
            {"★"}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Comment on your game (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        className="khelo-input rounded-[14px] border-[1.5px] border-khelo-border bg-khelo-surface p-3 text-[15px] text-khelo-ink outline-none"
        rows={2}
      />
      {error ? (
        <p role="alert" className="text-[13px] font-bold text-khelo-ink">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-khelo-danger" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="khelo-btn inline-flex min-h-11 items-center rounded-[14px] bg-khelo-orange px-4 py-2 text-[14px] font-extrabold text-khelo-ink disabled:opacity-60">
          {busy ? "Saving…" : review ? "Update review" : "Submit review"}
        </button>
        <button onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center px-3 text-[14px] font-bold text-khelo-muted hover:text-khelo-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------- shared booking behaviour ---------- */

/** Court, venue and what the player may do with this booking. Same rules the old My bookings cards used. */
function useBookingView(booking: Booking, onChanged: () => void) {
  const router = useRouter();
  const now = useNow();
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
  const policyNote = bookedNotCancellable ? (withinCutoff ? "The cancellation window for this booking has closed." : cancellationPolicyText(court)) : null;

  async function handleCancel() {
    const isPaid = booking.status === "booked";
    // The refundable amount is shown BEFORE the player confirms, in plain words. A cancel that is allowed to go through is
    // always fully refundable: the cutoff blocks the cancel outright instead of making part of it non-refundable.
    const confirmMessage = isPaid
      ? `Cancel this booking? You paid PKR ${formatPKR(booking.amount_paid)} -- the venue owes you that amount back. Refunds are sent manually by the venue (JazzCash/bank), not automatically through the app.`
      : "Cancel this booking? This can't be undone.";
    if (!confirm(confirmMessage)) return;
    try {
      await api.bookings.cancel(booking.id);
      if (isPaid) {
        alert(
          `Booking cancelled. A refund of PKR ${formatPKR(booking.amount_paid)} has been recorded for this venue to send you -- refunds are handled manually and aren't automatic.`,
        );
      }
      onChanged();
    } catch (e) {
      alert(friendlyErrorMessage(e));
    }
  }

  return {
    court,
    venueName: venueQuery.data?.name,
    canResumePay,
    canCancel,
    policyNote,
    handleCancel,
    goPay: () => router.push(`/booking/${booking.id}/pay`),
    goCheckin: () => router.push(`/booking/${booking.id}/checkin`),
  };
}

function courtLine(court: ReturnType<typeof useBookingView>["court"]): string {
  return court?.name ? `${courtLabel(court.name, court.sport)} · ` : "";
}

/* ---------- cards ---------- */

/** One booking in the Upcoming / Past lists. */
export function BookingCard({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const v = useBookingView(booking, onChanged);
  const group = statusGroup(booking.status);
  const style = GROUP_STYLE[group];
  const dateParts = formatDate(booking.starts_at).match(/^(\w+), (\d+) (\w+)/);

  return (
    <article
      data-testid="booking-card"
      data-status={booking.status}
      onClick={() => v.canResumePay && v.goPay()}
      className={`relative flex overflow-hidden rounded-3xl bg-khelo-surface shadow-[0_1px_2px_rgba(12,31,29,0.06)] ${
        v.canResumePay ? "khelo-card cursor-pointer" : ""
      } ${group === "cancelled" ? "opacity-90" : ""}`}
    >
      <span className={`w-1.5 shrink-0 ${style.strip}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-khelo-warm text-khelo-orange-label" aria-hidden="true">
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
            <p className="text-[14px] text-khelo-muted">
              {courtLine(v.court)}
              {formatDate(booking.starts_at)} {"·"} {formatTimeRange(booking.starts_at, booking.ends_at)}
            </p>
            <span className="mt-1 self-start">
              <StatusPill status={booking.status} />
            </span>
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-khelo-divider pt-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-khelo-muted-2">Paid</dt>
            <dd className="text-[17px] font-extrabold">PKR {formatPKR(booking.amount_paid)}</dd>
          </div>
          {booking.balance_due > 0 ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-extrabold uppercase tracking-[0.8px] text-khelo-muted-2">At the venue</dt>
              <dd className="text-[17px] font-extrabold text-khelo-warning-text">PKR {formatPKR(booking.balance_due)}</dd>
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
              {booking.status === "held" ? "Complete payment" : "View payment"}
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
              Check in
            </button>
          ) : null}
          {v.canCancel ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                v.handleCancel();
              }}
              className="inline-flex min-h-11 items-center px-2 text-[14px] font-bold text-khelo-ink underline decoration-khelo-danger decoration-2 underline-offset-4"
            >
              Cancel booking
            </button>
          ) : null}
        </div>
        {v.policyNote ? <p className="text-[13px] leading-snug text-khelo-muted">{v.policyNote}</p> : null}
        {booking.status === "completed" ? <RateGame booking={booking} review={review} onChanged={onChanged} /> : null}
      </div>
    </article>
  );
}

/** The featured card at the top of the dashboard: the player's next active booking. */
export function NextBookingCard({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const v = useBookingView(booking, onChanged);
  const group = statusGroup(booking.status);

  return (
    <section
      data-testid="next-booking"
      aria-label="Your next booking"
      className="relative overflow-hidden rounded-[28px] bg-khelo-ink p-6 text-white sm:p-8"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-khelo-teal/40 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange">Next up</span>
          <span className="rounded-full bg-khelo-orange px-3 py-1 text-[13px] font-extrabold text-khelo-ink" data-testid="starts-in">
            {startsInText(booking.starts_at, booking.ends_at)}
          </span>
          <StatusPill status={booking.status} dark />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="font-khelo-display text-[28px] font-extrabold leading-tight tracking-[-0.5px] sm:text-4xl">{v.venueName ?? "…"}</h2>
          <p className="text-[16px] text-white/80">
            {courtLine(v.court)}
            {formatDate(booking.starts_at)} {"·"} {formatTimeRange(booking.starts_at, booking.ends_at)}
          </p>
        </div>
        {booking.balance_due > 0 ? (
          <p className="text-[15px] text-white/80">
            Bring <span className="font-extrabold text-white">PKR {formatPKR(booking.balance_due)}</span> to pay at the venue.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {v.canResumePay ? (
            <button onClick={v.goPay} className={buttonClasses({ variant: "primary" })}>
              {booking.status === "held" ? "Complete payment" : "View payment"}
            </button>
          ) : null}
          {booking.status === "booked" ? (
            <button onClick={v.goCheckin} className={buttonClasses({ variant: "primary" })}>
              Check in
            </button>
          ) : null}
          {v.canCancel ? (
            <button onClick={v.handleCancel} className="inline-flex min-h-11 items-center px-3 text-[14px] font-bold text-white underline decoration-khelo-danger decoration-2 underline-offset-4">
              Cancel booking
            </button>
          ) : null}
        </div>
        {v.policyNote && group === "confirmed" ? <p className="text-[13px] text-white/75">{v.policyNote}</p> : null}
      </div>
    </section>
  );
}
