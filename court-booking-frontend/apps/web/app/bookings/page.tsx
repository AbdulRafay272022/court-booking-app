"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { countByGroup, isActiveBooking, nextBooking, statusGroup, type Booking, type StatusGroup } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { SiteHeader } from "@/components/nav-auth";
import { BookingCard, NextBookingCard } from "@/components/bookings/booking-card";

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
  `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-player-accent ${
    on
      ? "border-player-accent bg-player-accent text-white shadow-[0_4px_12px_-4px_rgba(239,90,44,0.6)]"
      : "border-player-border bg-player-surface text-player-ink-muted hover:border-player-accent hover:bg-player-accent-soft hover:text-player-accent-hover"
  }`;

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-player-border-light bg-player-surface p-5 shadow-[0_1px_2px_rgba(20,26,29,0.04)]" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-player-ink-faint">{label}</span>
      <span className={`font-mono text-3xl font-extrabold leading-none ${tone === "warn" && value > 0 ? "text-player-warn" : ""}`}>{value}</span>
      <span className="text-[12.5px] text-player-ink-fainter">{hint}</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-2xl bg-player-surface-2" />
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
    <>
      <SiteHeader />
      <div className="border-b border-player-accent-soft-border" style={{ background: "linear-gradient(180deg,#FFF3EE 0%,#FAF8F6 100%)" }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 pb-8 pt-10 md:px-10">
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-player-accent-hover">Your dashboard</p>
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{firstName ? `Hi, ${firstName}` : "Your bookings"}</h1>
            <p className="text-[16px] text-player-ink-muted">Everything you&apos;ve booked, in one place.</p>
          </div>
          <Link href="/search" className="rounded-xl bg-player-accent px-5 py-3 text-[14px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(239,90,44,0.8)] transition-colors hover:bg-player-accent-hover">
            Find a court
          </Link>
        </div>
      </div>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8 md:px-10">
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label="Upcoming" value={activeUpcoming.length} hint="games booked" />
          <Stat label="Pending" value={pendingCount} hint="need your action" tone="warn" />
          <Stat label="Played" value={played} hint="games so far" />
        </div>

        {next ? <NextBookingCard booking={next} onChanged={refetchAll} /> : null}

        <section className="flex flex-col gap-5" aria-label="Your bookings">
          <div className="flex flex-wrap items-center gap-3 border-b border-player-border-light pb-4">
            <div className="flex gap-2" role="tablist" aria-label="Upcoming or past">
              {(["upcoming", "past"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => switchTab(t)}
                  className={`rounded-full px-5 py-2.5 text-[14px] font-bold transition-colors ${
                    tab === t ? "bg-player-ink text-white" : "bg-player-surface-2 text-player-ink-muted hover:bg-player-accent-soft hover:text-player-accent-hover"
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
                  <span className={`font-mono text-[12px] ${filter === f.key ? "text-white/80" : "text-player-ink-fainter"}`}>{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {query.isLoading ? (
            <ListSkeleton />
          ) : query.isError && list.length === 0 ? (
            <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-player-border-light bg-player-surface px-6 py-14 text-center" data-testid="bookings-empty">
              <h2 className="text-lg font-extrabold">
                {filter !== "all" ? "Nothing here with that status" : tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}
              </h2>
              <p className="max-w-sm text-player-ink-muted">
                {filter !== "all"
                  ? "Try another status, or show all."
                  : tab === "upcoming"
                    ? "Find a court and book your first slot."
                    : "Games you've played show up here."}
              </p>
              {filter !== "all" ? (
                <button onClick={() => setFilter("all")} className="rounded-full bg-player-ink px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-player-accent-hover">
                  Show all
                </button>
              ) : tab === "upcoming" ? (
                <Link href="/search" className="rounded-full bg-player-accent px-6 py-3 text-[14px] font-bold text-white hover:bg-player-accent-hover">
                  Find a court
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((b) => (
                <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
