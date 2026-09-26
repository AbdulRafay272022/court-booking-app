"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-require-auth";
import { SiteHeader } from "@/components/nav-auth";
import type { Booking, BookingStatus, Review } from "@court-booking/types";
import { cancellationPolicyText } from "@court-booking/api-client";

const REVIEW_EDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Section 32 Part 6: rate a completed game (1-5 stars + optional comment); edit within 7 days. */
function RateGame({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const editable = !review || Date.now() - new Date(review.created_at).getTime() < REVIEW_EDIT_WINDOW_MS;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (rating < 1) { setError("Pick a star rating."); return; }
    setBusy(true); setError(null);
    try {
      if (review) await api.reviews.edit(review.id, { rating, comment: comment || undefined });
      else await api.reviews.create({ booking_id: booking.id, rating, comment: comment || undefined });
      setOpen(false);
      onChanged();
    } catch (e) { setError(friendlyErrorMessage(e)); } finally { setBusy(false); }
  }

  if (review && !open) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <span aria-label={`Your rating: ${review.rating} of 5`} className="text-[15px]" style={{ color: "#F0A05C" }}>
          {"★".repeat(review.rating)}<span style={{ color: "#3A4249" }}>{"★".repeat(5 - review.rating)}</span>
        </span>
        {editable ? (
          <button onClick={() => setOpen(true)} className="text-[12.5px] font-semibold" style={{ color: "#9A928B" }}>Edit</button>
        ) : (
          <span className="text-[11.5px]" style={{ color: "#6E7A80" }}>Reviewed</span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="Rate your game"
        className="self-start text-[13px] font-bold px-3.5 py-2 rounded-lg"
        style={{ background: "#EF5A2C", color: "#fff" }}
      >
        Rate your game
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(n)}
            className="text-2xl leading-none" style={{ color: n <= rating ? "#F0A05C" : "#3A4249" }}>★</button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        className="rounded-lg p-2.5 text-[13.5px] bg-[#1E262B] text-white border border-[#2A3238] outline-none"
        rows={2}
      />
      {error ? <p role="alert" className="text-[12.5px] font-semibold" style={{ color: "#E29B8A" }}>{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="text-[13px] font-bold px-3.5 py-2 rounded-lg disabled:opacity-50" style={{ background: "#EF5A2C", color: "#fff" }}>
          {busy ? "Saving…" : review ? "Update review" : "Submit review"}
        </button>
        <button onClick={() => setOpen(false)} className="text-[13px] font-semibold px-3 py-2" style={{ color: "#9A928B" }}>Cancel</button>
      </div>
    </div>
  );
}

// Backlog #7: every status gets a colored icon matching its label color. The
// no_show icon (a circle with a diagonal slash -- "didn't show") is deliberately
// distinct from cancelled's plain X, and is the one flagged for owner approval.
type StatusIconName = "check" | "clock" | "x" | "ban";
const STATUS_META: Record<BookingStatus, { label: string; tone: "confirmed" | "waiting" | "neutral" | "danger"; icon: StatusIconName }> = {
  held: { label: "HOLDING", tone: "waiting", icon: "clock" },
  payment_submitted: { label: "WAITING FOR APPROVAL", tone: "waiting", icon: "clock" },
  booked: { label: "CONFIRMED", tone: "confirmed", icon: "check" },
  completed: { label: "COMPLETED", tone: "neutral", icon: "check" },
  no_show: { label: "NO-SHOW", tone: "danger", icon: "ban" },
  cancelled: { label: "CANCELLED", tone: "danger", icon: "x" },
};

function StatusIcon({ name, color, size = 13 }: { name: StatusIconName; color: string; size?: number }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color,
    strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    style: { flexShrink: 0 },
  };
  if (name === "check") return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>;
  if (name === "clock") return <svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
  if (name === "x") return <svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; // ban / no-show
}

function BookingCard({ booking, review, onChanged }: { booking: Booking; review?: Review; onChanged: () => void }) {
  const router = useRouter();
  const courtQuery = useQuery({ queryKey: ["court", booking.court_id], queryFn: () => api.courts.get(booking.court_id) });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const meta = STATUS_META[booking.status];
  const isDark = booking.status === "booked" || booking.status === "completed";
  const statusColor = meta.tone === "waiting" ? "#8A5A0A" : meta.tone === "danger" ? "#A8432C" : isDark ? "#5FBF95" : "#7A7068";
  const canResumePay = booking.status === "held" || booking.status === "payment_submitted";

  // Section 29 Part C: same client-side eligibility check as mobile -- a cutoff only ever gets
  // more restrictive as start approaches, so this can't go stale the way a one-shot fetch might.
  // The server re-checks this at cancel time regardless; this is a UX convenience, not the
  // source of truth.
  const court = courtQuery.data;
  const withinCutoff =
    court?.cancellation_cutoff_hours != null &&
    new Date(booking.starts_at).getTime() - Date.now() < court.cancellation_cutoff_hours * 3_600_000;
  const canCancelBooked = booking.status === "booked" && !!court?.cancellation_allowed && !withinCutoff;
  const canCancel = canResumePay || canCancelBooked;
  const bookedNotCancellable = booking.status === "booked" && !canCancelBooked && !!court;

  async function handleCancel() {
    const isPaid = booking.status === "booked";
    // Section 32 Part 10: show the refundable amount BEFORE the player confirms, in plain words.
    // The cutoff decision (2026-09-24) means a cancel that's actually allowed to go through is
    // always fully refundable -- there's no partial/non-refundable-inside-the-cutoff case, since
    // the cutoff blocks the cancel outright instead (see canCancelBooked above).
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

  return (
    <div
      onClick={() => canResumePay && router.push(`/booking/${booking.id}/pay`)}
      className="rounded-2xl p-6 flex flex-col gap-3.5 cursor-pointer"
      style={{
        background: isDark ? "#141A1D" : meta.tone === "waiting" ? "#FDF6E9" : "#FFFFFF",
        border: isDark ? "none" : `1px solid ${meta.tone === "waiting" ? "#F0DFBC" : "#EBE5E1"}`,
      }}
    >
      <div className="flex flex-col gap-1">
        <span
          className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest"
          style={{ color: statusColor }}
        >
          <StatusIcon name={meta.icon} color={statusColor} />
          {meta.label}
        </span>
        <span className="font-bold text-[17px]" style={{ color: isDark ? "#FFFFFF" : "#141A1D" }}>
          {venueQuery.data?.name ?? "…"}
        </span>
        <span className="text-[13px]" style={{ color: isDark ? "#9A928B" : "#7A7068" }}>
          {courtQuery.data?.name ? `${courtQuery.data.name} · ` : ""}
          {formatDate(booking.starts_at)} · {formatTimeRange(booking.starts_at, booking.ends_at)}
        </span>
      </div>
      <div className="h-px" style={{ background: isDark ? "#2A3238" : "#F0EBE7" }} />
      <div className="flex gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-bold tracking-widest" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>PAID</span>
          <span className="font-mono text-[14.5px] font-semibold" style={{ color: isDark ? "#FFFFFF" : "#141A1D" }}>
            {formatPKR(booking.amount_paid)}
          </span>
        </div>
        {booking.balance_due > 0 ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold tracking-widest" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>AT GATE</span>
            <span className="font-mono text-[14.5px] font-semibold" style={{ color: "#F0A05C" }}>{formatPKR(booking.balance_due)}</span>
          </div>
        ) : null}
      </div>
      {booking.status === "booked" ? (
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/booking/${booking.id}/checkin`); }}
          className="self-start text-[13px] font-semibold"
          style={{ color: isDark ? "#5FBF95" : "#0E6274" }}
        >
          Check in
        </button>
      ) : null}
      {canCancel ? (
        <button
          onClick={(e) => { e.stopPropagation(); handleCancel(); }}
          className="self-start text-[13px] font-semibold"
          style={{ color: isDark ? "#E29B8A" : "#A8432C" }}
        >
          Cancel booking
        </button>
      ) : bookedNotCancellable ? (
        <span className="text-[12px]" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>
          {withinCutoff ? "The cancellation window for this booking has closed." : cancellationPolicyText(court)}
        </span>
      ) : null}
      {booking.status === "completed" ? <RateGame booking={booking} review={review} onChanged={onChanged} /> : null}
    </div>
  );
}

export default function BookingsPage() {
  const { ready } = useRequireAuth();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const query = useQuery({ queryKey: ["bookings-mine", tab], queryFn: () => api.bookings.mine(tab), enabled: ready });
  // The player's own reviews, to show "Rate your game" vs the stars + Edit on each completed booking.
  const reviewsQuery = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine(), enabled: ready });
  const reviewByBooking = new Map((reviewsQuery.data ?? []).map((r) => [r.booking_id, r]));
  const refetchAll = () => {
    query.refetch();
    reviewsQuery.refetch();
  };

  if (!ready) return null;
  const bookings = query.data ?? [];

  return (
    <>
    <SiteHeader />
    <main className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Your bookings</h1>
      <div className="flex gap-2">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 rounded-full text-[13.5px] font-bold"
            style={{ background: tab === t ? "#141A1D" : "#F4EFEC", color: tab === t ? "#fff" : "#5C544D" }}
          >
            {t === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="text-player-ink-faint">Loading…</p>
      ) : query.isError && bookings.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
      ) : bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <h2 className="font-extrabold text-lg">{tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}</h2>
          <p className="text-player-ink-muted">{tab === "upcoming" ? "Find a court and book your first slot." : "Bookings you've played show up here."}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {bookings.map((b) => (
            <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
          ))}
        </div>
      )}
    </main>
    </>
  );
}
