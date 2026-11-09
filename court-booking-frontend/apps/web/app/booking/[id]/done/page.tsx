"use client";

import { courtLabel } from "@/components/court-label";
import { PaymentInstructionsCard } from "@/components/booking/payment-instructions-card";
import { BookingExtrasCard } from "@/components/booking/booking-extras-card";
import { RefundDisputeCard } from "@/components/booking/refund-dispute-card";

import { use, useState } from "react";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { isConfirmed, journeySteps } from "@court-booking/ui-tokens";
import { bookingHeader, paymentLineLabel, refundSummary, timelineLabel, whatsappLink } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Button, Check, ErrorState, MoneyRows, StatusPill, Ticket, Timeline, useFlLang } from "@/components/fl";

/**
 * Booking status page (Status.dc.html). Honest by construction: the celebration, "Court aapka hai" and the QR ticket appear ONLY
 * when the backend status is `booked` (isConfirmed). Any other status shows the real status pill + the journey
 * (Hold -> Screenshot bheja -> Venue check -> Pakki) and keeps polling while the venue checks.
 */
function DonePageInner({ params }: PageProps<"/booking/[id]/done">) {
  const { id } = use(params);
  const t = useT();
  const fmt = useFmt();
  const lang = useFlLang();
  const router = useRouter();
  // Audit 2026-10-28 item 4: ONE call returns the booking with its venue, court, money lines, timeline, policy and contact.
  const detailQuery = useQuery({
    queryKey: ["booking-detail", id],
    queryFn: () => api.bookings.detail(id),
    refetchInterval: (query) => {
      const s = query.state.data?.booking.status;
      return s === "held" || s === "payment_submitted" ? 4000 : false;
    },
  });
  // fix/nov-8: same query (and cache) as BookingExtrasCard; it says whether "Main aaya tha" is open (noshow_reply flag).
  const extrasQuery = useQuery({
    queryKey: ["booking-extras", id],
    queryFn: () => api.phase3.extras(id),
    enabled: detailQuery.data?.booking.status === "no_show",
  });
  const bookingQuery = detailQuery;
  const detail = detailQuery.data;
  const booking = detail?.booking;

  if (!booking && bookingQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fl-ground px-6 font-fl-body text-fl-night">
        <ErrorState title={t("play.done.loadError")} message={friendlyErrorMessage(bookingQuery.error)} onRetry={() => bookingQuery.refetch()} />
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fl-night font-fl-body text-fl-white" role="status">
        {t("play.loading")}
      </main>
    );
  }

  const confirmed = isConfirmed(booking.status);
  // fix/nov-8: one header + QR area per status (booked / completed / no_show / cancelled / still waiting).
  const header = bookingHeader(booking, { canReplyNoShow: extrasQuery.data?.arrival.can_reply_noshow === true, lang: lang === "ru" ? "ru" : "en" });
  const waiting = header.kind === "waiting";
  const dueAtVenue = booking.status === "cancelled" ? 0 : booking.balance_due;
  const d = detail!;
  const venueName = d.venue.name;
  const court = courtLabel(d.court.name, d.court.sport);
  const place = d.venue.area ?? d.venue.city ?? "";
  const fields = [
    { label: t("play.done.date"), value: fmt.date(booking.starts_at) },
    { label: t("play.done.time"), value: fmt.timeRange(booking.starts_at, booking.ends_at) },
    { label: t("play.done.court"), value: `${court} · ${d.court.is_indoor ? t("play.done.indoor") : t("play.done.outdoor")}` },
    { label: t("play.done.duration"), value: fmt.duration(d.duration_minutes) },
    ...(place ? [{ label: t("play.done.venue"), value: place }] : []),
  ];
  const wa = whatsappLink(d.venue.whatsapp ?? d.venue.phone, t("play.done.waText", { id: booking.id.slice(0, 8) }));
  const tel = d.venue.phone ? `tel:${d.venue.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <main
      className="flex min-h-screen flex-col items-center gap-6 bg-fl-night px-4 pb-10 pt-12 font-fl-body sm:px-6"
      data-testid={confirmed ? "status-booked-page" : waiting ? "status-pending-page" : `status-${header.kind}-page`}
    >
      {header.kind === "booked" || header.kind === "completed" ? (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fl-mint text-fl-night" aria-hidden>
            <Check size={30} strokeWidth={3} />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="font-fl-display text-3xl font-extrabold tracking-tight text-fl-white" data-testid="status-title">{header.title}</h1>
            <p className="text-[15px] text-fl-on-dark-muted">{header.body}</p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-fl-display text-3xl font-extrabold tracking-tight text-fl-white" data-testid="status-title">{header.title}</h1>
          <p className="max-w-md text-[15px] text-fl-on-dark-muted">{header.body}</p>
          {header.askNoShow ? (
            <a href="#noshow-reply" className="mt-1 rounded-full bg-fl-white px-4 py-2 text-[14px] font-extrabold text-fl-night" data-testid="status-ask-noshow">
              {header.askNoShow}
            </a>
          ) : null}
        </div>
      )}

      <div className="flex w-full max-w-md flex-col gap-4">
        <Ticket bookingId={booking.id} booking={booking} venueName={venueName} eyebrow={t("play.done.ticketEyebrow")} fields={fields} qr={header.qr} />

        <MoneyRows
          rows={[
            { label: t("play.done.total"), value: `PKR ${formatPKR(booking.price)}` },
            { label: t("play.done.paid"), value: `PKR ${formatPKR(booking.amount_paid)}`, tone: "open" },
            {
              label: t("play.done.dueAtVenue"),
              // fix/nov-9: nothing is due at the venue for a cancelled booking (what comes back is the refund line)
              value: dueAtVenue > 0 ? `PKR ${formatPKR(dueAtVenue)}` : t("play.done.nothingDue"),
              strong: dueAtVenue > 0,
              tone: dueAtVenue > 0 ? "waiting" : "default",
            },
          ]}
        />

        {booking.status === "booked" && booking.balance_due > 0 ? (
          // audit 2026-10-28 item 20: the balance can be sent by transfer too (bank details + Raast QR when switched on)
          <PaymentInstructionsCard bookingId={id} />
        ) : null}

        {/* audit Phase 3: points rule + discount, the short-payment question, "Pohanch gaya" / "Main aaya tha" */}
        <BookingExtrasCard bookingId={id} />

        {/* fix/nov-9 items 9-12: where the refund goes, each refund sent + check + Mil gaya / Nahi mila, Khelo se shikayat */}
        <RefundDisputeCard bookingId={id} />

        <section className="flex flex-col gap-2 rounded-fl-card bg-fl-white p-5" data-testid="detail-payments">
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{t("play.done.paymentsTitle")}</h2>
          {d.payments.length === 0 ? (
            <p className="text-[14px] text-fl-muted">{t("play.done.noPayments")}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.payments.map((p, i) => (
                <li key={`${p.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                  <span className="text-fl-night">
                    {paymentLineLabel(p, lang)} <span className="text-fl-muted">· {fmt.when(p.at)}</span>
                  </span>
                  <span className={`font-extrabold tabular-nums ${p.amount < 0 ? "text-fl-danger" : "text-fl-open"}`}>
                    {p.amount < 0 ? "−" : ""}PKR {formatPKR(Math.abs(p.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.refund ? (
            <p className={`text-[14px] font-bold ${refundSummary(d.refund, lang === "ru" ? "ru" : "en").tone === "done" ? "text-fl-open" : "text-fl-waiting"}`} data-testid="detail-refund">
              {refundSummary(d.refund, lang === "ru" ? "ru" : "en").text}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-fl-card bg-fl-white p-5" data-testid="detail-timeline">
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{t("play.done.timelineTitle")}</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {d.timeline.map((e, i) => (
              <li key={`${e.at}-${e.kind}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                <span className="font-bold text-fl-night">
                  {timelineLabel(e.kind, lang)}
                  {e.amount ? <span className="font-normal text-fl-muted"> · PKR {formatPKR(e.amount)}</span> : null}
                  {e.note && e.kind === "rejected" ? <span className="block font-normal text-fl-muted">{e.note}</span> : null}
                </span>
                <span className="text-fl-muted">{fmt.when(e.at)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-2 rounded-fl-card bg-fl-white p-5" data-testid="detail-policy">
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{t("play.done.policyTitle")}</h2>
          <p className="text-[14px] text-fl-night">{fmt.cancellationPolicy(d.venue)}</p>
          {d.refund_request?.state === "eligible" ? (
            <RefundRequest bookingId={id} amount={d.refund_request.amount} onDone={() => detailQuery.refetch()} />
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-fl-card bg-fl-white p-5" data-testid="detail-contact">
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{t("play.done.contactTitle")}</h2>
          {d.venue.address ? <p className="text-[14px] text-fl-muted">{d.venue.address}</p> : null}
          {wa || tel ? (
            <div className="flex flex-wrap gap-2">
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-full bg-fl-teal px-4 py-2 text-[14px] font-extrabold text-fl-white">
                  {t("play.done.whatsapp")}
                </a>
              ) : null}
              {tel ? (
                <a href={tel} className="rounded-full border border-fl-line-strong px-4 py-2 text-[14px] font-extrabold text-fl-night">
                  {t("play.done.call")}
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-[14px] text-fl-muted">{t("play.done.noContact")}</p>
          )}
          <p className="text-[12px] text-fl-muted2">
            {t("play.done.bookingId")}: <span className="font-mono">{booking.id}</span>
          </p>
        </section>

        {header.qr === "show" ? (
          <Button label={t("play.done.checkin")} block variant="secondary" onClick={() => router.push(`/booking/${id}/checkin`)} />
        ) : null}

        {/* fix/nov-9: the Hold -> Screenshot -> Venue check -> Pakki journey only while the booking is still on its way; on a
            cancelled booking it guessed wrong ("Screenshot waqt par nahi aaya" for a booking the venue had approved). */}
        {waiting ? (
          <div className="flex flex-col gap-4 rounded-fl-card bg-fl-white p-5" data-testid="status-journey">
            <StatusPill booking={booking} />
            <Timeline steps={journeySteps(booking, lang)} />
          </div>
        ) : null}

        {!confirmed && (booking.status === "held" || booking.status === "payment_submitted") ? (
          <Button label={t("play.done.openPay")} block onClick={() => router.push(`/booking/${id}/pay`)} />
        ) : (
          <Button label={t("play.done.done")} block variant={confirmed ? "primary" : "secondary"} onClick={() => router.push("/bookings")} />
        )}
      </div>
    </main>
  );
}

/** audit 2026-10-28 Phase 2 item 3: "Refund maangein" (optional reason) on a cancelled booking the policy refunds. */
function RefundRequest({ bookingId, amount, onDone }: { bookingId: string; amount: number; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.bookings.requestRefund(bookingId, note.trim());
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return <Button label={t("play.done.refundAsk", { amount: `PKR ${formatPKR(amount)}` })} block variant="secondary" onClick={() => setOpen(true)} />;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="refund-request-form">
      <label className="text-[13px] font-bold text-fl-night" htmlFor="refund-note">
        {t("play.done.refundNote")}
      </label>
      <textarea id="refund-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="rounded-fl-input border border-fl-line-strong px-3 py-2 text-[14px]" />
      {error ? <p className="text-[13px] font-bold text-fl-danger">{error}</p> : null}
      <Button label={t("play.done.refundSend")} block onClick={send} disabled={busy} />
    </div>
  );
}

/** Booking screens need a session: a signed-out visitor is sent to log in and brought back here,
 * instead of the page silently signing them out on the first 401 with no explanation. */
export default function DonePage(props: PageProps<"/booking/[id]/done">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <DonePageInner {...props} />;
}
