"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { countByGroup, isActiveBooking, nextBooking, statusGroup, type Booking, type StatusGroup } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { KheloPage } from "@/components/site/page-shell";
import { Button } from "@/components/site/button";
import { Container } from "@/components/site/primitives";
import { BookingCard, NextBookingCard } from "@/components/bookings/booking-card";
import { SavedVenues } from "@/components/bookings/saved-venues";

type Tab = "upcoming" | "past";
type Filter = "all" | StatusGroup;

// The API caps a page at 100; a player's newest bookings come first on "past", so only the oldest could ever drop off.
const PAGE = 100;

const FILTERS: Record<Tab, { key: Filter; label: string }[]> = {
  upcoming: [
    { key: "all", label: "All" },
    { key: "confirmed", label: "Confirmed" },
    { key: "pending", label: "Pending" },
    { key: "cancelled", label: "Cancelled" },
  ],
  past: [
    { key: "all", label: "All" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ],
};

const chip = (on: boolean) =>
  `khelo-btn inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-[18px] py-2 text-[14px] font-bold ${
    on ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-khelo-surface text-khelo-ink"
  }`;

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-1 rounded-3xl bg-khelo-surface p-4 shadow-[0_1px_2px_rgba(12,31,29,0.06)] sm:p-5" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="text-[11.5px] font-extrabold uppercase tracking-[0.8px] text-khelo-muted-2">{label}</span>
      <span className={`font-khelo-display text-3xl font-extrabold leading-none ${tone === "warn" && value > 0 ? "text-khelo-warning-text" : ""}`}>{value}</span>
      <span className="text-[13px] text-khelo-muted-2">{hint}</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-3xl bg-khelo-divider" />
      ))}
    </div>
  );
}

export default function BookingsPage() {
  const { ready } = useRequireAuth();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");

  // Both lists load up front: the stat tiles and the "next up" card need upcoming even while Past is selected.
  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, PAGE), enabled: ready });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, PAGE), enabled: ready });
  // The player's own reviews, to show "Rate your game" vs the stars + Edit on each completed booking.
  const reviewsQ = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine(), enabled: ready });
  const reviewByBooking = new Map((reviewsQ.data ?? []).map((r) => [r.booking_id, r]));
  const refetchAll = () => {
    upcomingQ.refetch();
    pastQ.refetch();
    reviewsQ.refetch();
  };

  if (!ready) return null;

  const upcoming: Booking[] = upcomingQ.data ?? [];
  const past: Booking[] = pastQ.data ?? [];
  const next = nextBooking(upcoming);
  const activeUpcoming = upcoming.filter((b) => isActiveBooking(b));
  const pendingCount = activeUpcoming.filter((b) => statusGroup(b.status) === "pending").length;
  const played = countByGroup(past).completed;

  const query = tab === "upcoming" ? upcomingQ : pastQ;
  const list = tab === "upcoming" ? upcoming : past;
  const counts = countByGroup(list);
  const shown = filter === "all" ? list : list.filter((b) => statusGroup(b.status) === filter);
  const firstName = user?.name?.trim().split(/\s+/)[0];

  function switchTab(t: Tab) {
    setTab(t);
    setFilter("all");
  }

  return (
    <KheloPage>
      <div className="border-b border-khelo-divider bg-khelo-warm-2">
        <Container className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10">
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange-label">Your dashboard</p>
            <h1 className="font-khelo-display text-[34px] font-extrabold leading-[1.05] tracking-[-1.5px] md:text-5xl">
              {firstName ? `Hi, ${firstName}` : "Your bookings"}
            </h1>
            <p className="text-[17px] text-khelo-muted">Everything you&apos;ve booked, in one place.</p>
          </div>
          <Button href="/search" size="md">
            Find a court
          </Button>
        </Container>
      </div>

      <Container className="flex flex-col gap-8 py-8">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label="Upcoming" value={activeUpcoming.length} hint="games booked" />
          <Stat label="Pending" value={pendingCount} hint="need your action" tone="warn" />
          <Stat label="Played" value={played} hint="games so far" />
        </div>

        {next ? <NextBookingCard booking={next} onChanged={refetchAll} /> : null}

        <SavedVenues />

        <section className="flex flex-col gap-5" aria-label="Your bookings">
          <div className="flex flex-wrap items-center gap-3 border-b border-khelo-divider pb-4">
            <div className="flex gap-2" role="tablist" aria-label="Upcoming or past">
              {(["upcoming", "past"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => switchTab(t)}
                  className={`khelo-btn inline-flex min-h-11 items-center rounded-full px-6 py-2.5 text-[15px] font-extrabold ${
                    tab === t ? "bg-khelo-ink text-white" : "bg-khelo-booked-bg text-khelo-ink"
                  }`}
                >
                  {t === "upcoming" ? "Upcoming" : "Past"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 sm:ml-auto" role="group" aria-label="Filter by status">
              {FILTERS[tab].map((f) => (
                <button key={f.key} className={chip(filter === f.key)} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}>
                  {f.label}
                  <span className={`text-[12px] ${filter === f.key ? "text-white/80" : "text-khelo-muted-2"}`}>{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite">
            {query.isLoading ? (
              <ListSkeleton />
            ) : query.isError && list.length === 0 ? (
              <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl bg-khelo-surface px-6 py-14 text-center">
                <h2 className="font-khelo-display text-xl font-extrabold">Something went wrong</h2>
                <p className="max-w-sm text-khelo-muted">{friendlyErrorMessage(query.error)}</p>
                <Button variant="dark" onClick={() => query.refetch()}>
                  Try again
                </Button>
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-3xl bg-khelo-surface px-6 py-14 text-center" data-testid="bookings-empty">
                <h2 className="font-khelo-display text-xl font-extrabold">
                  {filter !== "all" ? "Nothing here with that status" : tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}
                </h2>
                <p className="max-w-sm text-khelo-muted">
                  {filter !== "all"
                    ? "Try another status, or show all."
                    : tab === "upcoming"
                      ? "Find a court and book your first slot."
                      : "Games you've played show up here."}
                </p>
                {filter !== "all" ? (
                  <Button variant="dark" onClick={() => setFilter("all")}>
                    Show all
                  </Button>
                ) : tab === "upcoming" ? (
                  <Button href="/search">Find a court</Button>
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
