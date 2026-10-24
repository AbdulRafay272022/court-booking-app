"use client";

import { courtLabel } from "@/components/court-label";

import { use } from "react";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { isConfirmed, journeySteps } from "@court-booking/ui-tokens";
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
  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "held" || s === "payment_submitted" ? 4000 : false;
    },
  });
  const courtQuery = useQuery({
    queryKey: ["court", bookingQuery.data?.court_id],
    queryFn: () => api.courts.get(bookingQuery.data!.court_id),
    enabled: !!bookingQuery.data?.court_id,
  });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const booking = bookingQuery.data;

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
  const venueName = venueQuery.data?.name ?? t("play.done.venue");
  const court = courtQuery.data ? courtLabel(courtQuery.data.name, courtQuery.data.sport) : t("play.done.court");
  const place = venueQuery.data ? venueQuery.data.area ?? venueQuery.data.city : "";
  const fields = [
    { label: t("play.done.date"), value: fmt.date(booking.starts_at) },
    { label: t("play.done.time"), value: fmt.timeRange(booking.starts_at, booking.ends_at) },
    { label: t("play.done.court"), value: court },
    ...(place ? [{ label: t("play.done.venue"), value: place }] : []),
  ];

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-fl-night px-4 pb-10 pt-12 font-fl-body sm:px-6" data-testid={confirmed ? "status-booked-page" : "status-pending-page"}>
      {confirmed ? (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fl-mint text-fl-night" aria-hidden>
            <Check size={30} strokeWidth={3} />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="font-fl-display text-3xl font-extrabold tracking-tight text-fl-white">{t("play.done.title")}</h1>
            <p className="text-[15px] text-fl-on-dark-muted">{t("play.done.confirmedBy")}</p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-fl-display text-3xl font-extrabold tracking-tight text-fl-white">{t("play.done.notYetTitle")}</h1>
          <p className="max-w-md text-[15px] text-fl-on-dark-muted">{t("play.done.notYetBody")}</p>
        </div>
      )}

      <div className="flex w-full max-w-md flex-col gap-4">
        <Ticket bookingId={booking.id} booking={booking} venueName={venueName} eyebrow={t("play.done.ticketEyebrow")} fields={fields} />

        <MoneyRows
          rows={[
            { label: t("play.done.paid"), value: `PKR ${formatPKR(booking.amount_paid)}`, tone: "open" },
            {
              label: t("play.done.dueAtVenue"),
              value: booking.balance_due > 0 ? `PKR ${formatPKR(booking.balance_due)}` : t("play.done.nothingDue"),
              strong: booking.balance_due > 0,
              tone: booking.balance_due > 0 ? "waiting" : "default",
            },
          ]}
        />

        {!confirmed ? (
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

/** Booking screens need a session: a signed-out visitor is sent to log in and brought back here,
 * instead of the page silently signing them out on the first 401 with no explanation. */
export default function DonePage(props: PageProps<"/booking/[id]/done">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <DonePageInner {...props} />;
}
