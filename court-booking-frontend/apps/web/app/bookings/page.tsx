"use client";

import { useState } from "react";
import { countByGroup, statusGroup, type StatusGroup } from "@court-booking/types";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";
import { KheloPage } from "@/components/site/page-shell";
import { Button } from "@/components/site/button";
import { Container } from "@/components/site/primitives";
import { BookingCard, NextBookingCard } from "@/components/bookings/booking-card";
import { SavedVenues } from "@/components/bookings/saved-venues";
import { useMyBookings } from "@/components/bookings/use-my-bookings";

type Tab = "upcoming" | "past";
type Filter = "all" | StatusGroup;

const FILTERS: Record<Tab, { key: Filter; label: MessageKey }[]> = {
  upcoming: [
    { key: "all", label: "bookings.filter.all" },
    { key: "confirmed", label: "bookings.filter.confirmed" },
    { key: "pending", label: "bookings.filter.pending" },
    { key: "cancelled", label: "bookings.filter.cancelled" },
  ],
  past: [
    { key: "all", label: "bookings.filter.all" },
    { key: "completed", label: "bookings.filter.completed" },
    { key: "cancelled", label: "bookings.filter.cancelled" },
  ],
};

const chip = (on: boolean) =>
  `khelo-btn inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-[18px] py-2 text-[14px] font-bold ${
    on ? "border-fl-night bg-fl-night text-white" : "border-fl-line-strong bg-fl-white text-fl-night"
  }`;

function Stat({ label, testId, value, hint, tone }: { label: string; testId: string; value: number; hint: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-1 rounded-3xl bg-fl-white p-4 shadow-fl-card-soft sm:p-5" data-testid={`stat-${testId}`}>
      <span className="text-[11.5px] font-extrabold uppercase tracking-[0.8px] text-fl-muted2">{label}</span>
      <span className={`font-khelo-display text-3xl font-extrabold leading-none ${tone === "warn" && value > 0 ? "text-fl-waiting" : ""}`}>{value}</span>
      <span className="text-[13px] text-fl-muted2">{hint}</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-3xl bg-fl-line" />
      ))}
    </div>
  );
}

export default function BookingsPage() {
  const t = useT();
  const { ready } = useRequireAuth(["player"]); // My bookings is the player's page; owners and staff manage bookings in the dashboard
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");

  const { upcomingQ, pastQ, reviewByBooking, refetchAll, upcoming, past, next, activeUpcoming, pendingCount, played } = useMyBookings(!!ready);

  if (!ready) return null;

  const query = tab === "upcoming" ? upcomingQ : pastQ;
  const list = tab === "upcoming" ? upcoming : past;
  const counts = countByGroup(list);
  const shown = filter === "all" ? list : list.filter((b) => statusGroup(b.status) === filter);
  const firstName = user?.name?.trim().split(/\s+/)[0];

  function switchTab(next: Tab) {
    setTab(next);
    setFilter("all");
  }

  return (
    <KheloPage>
      <div className="border-b border-fl-line bg-fl-orange-tint">
        <Container className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10">
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-fl-orange-deep">{t("bookings.page.eyebrow")}</p>
            <h1 className="font-khelo-display text-[34px] font-extrabold leading-[1.05] tracking-[-1.5px] md:text-5xl">
              {firstName ? t("bookings.page.hi", { name: firstName }) : t("bookings.page.title")}
            </h1>
            <p className="text-[17px] text-fl-muted">{t("bookings.page.subtitle")}</p>
          </div>
          <Button href="/search" size="md">
            {t("bookings.page.find")}
          </Button>
        </Container>
      </div>

      <Container className="flex flex-col gap-8 py-8">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label={t("bookings.stat.upcoming")} testId="upcoming" value={activeUpcoming.length} hint={t("bookings.stat.upcomingHint")} />
          <Stat label={t("bookings.stat.pending")} testId="pending" value={pendingCount} hint={t("bookings.stat.pendingHint")} tone="warn" />
          <Stat label={t("bookings.stat.played")} testId="played" value={played} hint={t("bookings.stat.playedHint")} />
        </div>

        {next ? <NextBookingCard booking={next} onChanged={refetchAll} /> : null}

        <SavedVenues />

        <section className="flex flex-col gap-5" aria-label={t("bookings.list.aria")}>
          <div className="flex flex-wrap items-center gap-3 border-b border-fl-line pb-4">
            <div className="flex gap-2" role="tablist" aria-label={t("bookings.list.tabsAria")}>
              {(["upcoming", "past"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => switchTab(k)}
                  className={`khelo-btn inline-flex min-h-11 items-center rounded-full px-6 py-2.5 text-[15px] font-extrabold ${
                    tab === k ? "bg-fl-night text-white" : "bg-fl-booked-bg text-fl-night"
                  }`}
                >
                  {k === "upcoming" ? t("bookings.tab.upcoming") : t("bookings.tab.past")}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 sm:ml-auto" role="group" aria-label={t("bookings.filter.aria")}>
              {FILTERS[tab].map((f) => (
                <button key={f.key} className={chip(filter === f.key)} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}>
                  {t(f.label)}
                  <span className={`text-[12px] ${filter === f.key ? "text-white/80" : "text-fl-muted2"}`}>{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite">
            {query.isLoading ? (
              <ListSkeleton />
            ) : query.isError && list.length === 0 ? (
              <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl bg-fl-white px-6 py-14 text-center">
                <h2 className="font-khelo-display text-xl font-extrabold">{t("bookings.error.title")}</h2>
                <p className="max-w-sm text-fl-muted">{friendlyErrorMessage(query.error)}</p>
                <Button variant="dark" onClick={() => query.refetch()}>
                  {t("bookings.error.retry")}
                </Button>
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-3xl bg-fl-white px-6 py-14 text-center" data-testid="bookings-empty">
                <h2 className="font-khelo-display text-xl font-extrabold">
                  {filter !== "all" ? t("bookings.empty.filteredTitle") : tab === "upcoming" ? t("bookings.empty.upcomingTitle") : t("bookings.empty.pastTitle")}
                </h2>
                <p className="max-w-sm text-fl-muted">
                  {filter !== "all" ? t("bookings.empty.filteredBody") : tab === "upcoming" ? t("bookings.empty.upcomingBody") : t("bookings.empty.pastBody")}
                </p>
                {filter !== "all" ? (
                  <Button variant="dark" onClick={() => setFilter("all")}>
                    {t("bookings.empty.showAll")}
                  </Button>
                ) : tab === "upcoming" ? (
                  <Button href="/search">{t("bookings.page.find")}</Button>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {shown.map((b) => (
                  <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
                ))}
              </div>
            )}
          </div>
        </section>
      </Container>
    </KheloPage>
  );
}
