"use client";

import Link from "next/link";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useFmt } from "@/lib/use-fmt";
import { courtLabel } from "@/components/court-label";
import { useT } from "@/components/i18n/lang-provider";
import { Button } from "@/components/site/button";
import { BookingCard, NextBookingCard } from "@/components/bookings/booking-card";
import { useMyBookings } from "@/components/bookings/use-my-bookings";
import { Card } from "./parts";

const PAST_SHOWN = 3;

/** Account > Bookings: the next booking, the last few past ones, and (players) the waitlist. Same queries, helpers and cards as /bookings. */
export function BookingsPanel() {
  const t = useT();
  const { upcomingQ, pastQ, reviewByBooking, refetchAll, past, next } = useMyBookings(true);
  const loading = upcomingQ.isLoading || pastQ.isLoading;
  const failed = (upcomingQ.isError && !upcomingQ.data) || (pastQ.isError && !pastQ.data);
  // /bookings lists the newest past bookings first, so the first few are the most recent.
  const recent = past.slice(0, PAST_SHOWN);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-khelo-display text-[22px] font-extrabold tracking-tight">{t("account.bookings.title")}</h2>
        <Link href="/bookings" className="inline-flex min-h-11 items-center text-[15px] font-extrabold text-khelo-orange-text hover:underline" data-testid="account-all-bookings">
          {t("account.bookings.all")}
        </Link>
      </div>

      <div aria-live="polite" className="flex flex-col gap-6">
        {loading ? (
          <div className="h-48 animate-pulse rounded-3xl bg-khelo-divider" aria-hidden="true" />
        ) : failed ? (
          <Card className="flex flex-col items-start gap-3" role="alert">
            <p className="text-[15px] text-khelo-muted">{t("account.bookings.error")}</p>
            <Button variant="dark" onClick={refetchAll}>
              {t("account.bookings.retry")}
            </Button>
          </Card>
        ) : (
          <>
            {next ? (
              <NextBookingCard booking={next} onChanged={refetchAll} showPaid />
            ) : (
              <Card className="flex flex-col items-start gap-3" data-testid="account-no-upcoming">
                <p className="text-[16px] font-bold">{t("account.bookings.noUpcoming")}</p>
                <p className="text-[15px] text-khelo-muted">{t("account.bookings.noUpcomingBody")}</p>
                <Button href="/search">{t("account.bookings.find")}</Button>
              </Card>
            )}

            {recent.length > 0 ? (
              <section className="flex flex-col gap-3" aria-labelledby="account-recent-h">
                <h3 id="account-recent-h" className="text-[14px] font-extrabold uppercase tracking-[0.8px] text-khelo-muted-2">
                  {t("account.bookings.recent")}
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {recent.map((b) => (
                    <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      <Waitlist />
    </div>
  );
}

/** Section 29 Tier 2 Part 4: "My waitlist" (mobile's profile tab has had it for a while). Player-only: owners don't join waitlists. */
function Waitlist() {
  const t = useT();
  const fmt = useFmt();
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const waitlistQuery = useQuery({
    queryKey: ["waitlist-mine"],
    queryFn: () => api.waitlist.mine(),
    enabled: role === "player",
  });
  const activeEntries = (waitlistQuery.data ?? []).filter((e) => e.is_active);
  // A waitlist entry carries the court's name but not its sport, so read each court (cached, shared with My Bookings).
  const courtIds = [...new Set(activeEntries.map((e) => e.court_id))];
  const courtSports = new Map(
    useQueries({
      queries: courtIds.map((id) => ({ queryKey: ["court", id], queryFn: () => api.courts.get(id) })),
    }).flatMap((q) => (q.data ? [[q.data.id, q.data.sport] as const] : [])),
  );

  async function leaveWaitlist(entryId: string) {
    try {
      await api.waitlist.leave(entryId);
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
    } catch (e) {
      alert(t("account.waitlist.leaveFailed", { reason: friendlyErrorMessage(e) }));
    }
  }

  if (role !== "player" || activeEntries.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="account-waitlist-h">
      <h3 id="account-waitlist-h" className="text-[14px] font-extrabold uppercase tracking-[0.8px] text-khelo-muted-2">
        {t("account.waitlist.title")}
      </h3>
      {activeEntries.map((entry) => (
        <Card key={entry.id} className="flex items-center justify-between gap-4 !p-4 sm:!p-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[16px] font-bold">
              {entry.venue_name} {"·"} {courtLabel(entry.court_name, courtSports.get(entry.court_id))}
            </span>
            <span className="text-[14px] text-khelo-muted">
              {fmt.date(entry.slot_starts_at)} {"·"} {fmt.time(entry.slot_starts_at)} {"·"} {t("account.waitlist.position", { n: entry.position })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => leaveWaitlist(entry.id)}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center px-3 text-[14px] font-bold text-khelo-ink underline decoration-khelo-danger decoration-2 underline-offset-4"
          >
            {t("account.waitlist.leave")}
          </button>
        </Card>
      ))}
    </section>
  );
}
