"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewStats, type Review } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatRelativeTime, formatShortDate } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";
import { useFeatureFlags } from "@/lib/use-feature-flags";

const FIRST_PAGE = 5;
const STAR_PATH = "M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9L12 2.8Z";

function StarShape({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="shrink-0">
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}

/** Five stars, filled to `value` (fractions allowed: 4.4 fills the fifth star 40%). */
function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  const pct = Math.max(0, Math.min(5, value)) * 20;
  return (
    <span role="img" aria-label={label ?? `${value} out of 5 stars`} className="relative inline-flex">
      <span className="inline-flex text-player-border">
        {[0, 1, 2, 3, 4].map((i) => (
          <StarShape key={i} size={size} />
        ))}
      </span>
      <span className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap" style={{ width: `${pct}%` }}>
        <span className="inline-flex text-player-accent">
          {[0, 1, 2, 3, 4].map((i) => (
            <StarShape key={i} size={size} />
          ))}
        </span>
      </span>
    </span>
  );
}

const AVATAR_TONES = [
  "bg-player-accent-soft text-player-accent-hover",
  "bg-player-teal-soft text-player-teal",
  "bg-player-success-soft text-player-success-dark",
  "bg-player-warn-soft text-player-warn",
  "bg-player-surface-2 text-player-ink-muted",
];

function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold ${AVATAR_TONES[h % AVATAR_TONES.length]}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** "3d ago" for recent reviews, a calendar date once it is older than a month. */
function when(iso: string): string {
  return Date.now() - new Date(iso).getTime() > 30 * 86_400_000 ? formatShortDate(iso) : formatRelativeTime(iso);
}

function Summary({ average, count, distribution }: { average: number; count: number; distribution: number[] }) {
  return (
    <div
      className="grid gap-6 sm:grid-cols-[auto_1fr] items-center bg-player-surface border border-player-border-light rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(20,26,29,0.04)]"
      data-testid="review-summary"
    >
      <div className="flex flex-col items-center sm:items-start gap-1.5 sm:pr-6 sm:border-r border-player-border-light">
        <span className="text-5xl font-extrabold tracking-tight leading-none" data-testid="review-average">
          {average.toFixed(1)}
        </span>
        <Stars value={average} size={20} label={`${average.toFixed(1)} out of 5 stars`} />
        <span className="text-[13px] text-player-ink-faint">
          {count} review{count === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Rating breakdown">
        {distribution.map((n, i) => {
          const star = 5 - i;
          return (
            <li key={star} className="flex items-center gap-3 text-[13px]" data-testid={`review-bar-${star}`}>
              <span className="w-9 shrink-0 font-semibold text-player-ink-muted">{star} ★</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-player-surface-2">
                <span className="block h-full rounded-full bg-player-accent" style={{ width: `${count ? (n / count) * 100 : 0}%` }} />
              </span>
              <span className="w-7 shrink-0 text-right font-mono text-player-ink-faint">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Section 32 Part 6: the venue's reviews, newest first, first name only. An admin viewing
 * the page also gets Hide/Unhide (the list includes hidden reviews for admins). */
export function VenueReviews({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const { isOn } = useFeatureFlags();
  const reviewsEnabled = isOn("reviews");
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ["venue-reviews", venueId],
    queryFn: () => api.reviews.listForVenue(venueId),
    enabled: reviewsEnabled,
  });
  const reviews = query.data ?? [];
  const stats = reviewStats(reviews);
  const shown = showAll ? reviews : reviews.slice(0, FIRST_PAGE);

  async function toggleHidden(r: Review) {
    if (r.is_hidden) await api.admin.unhideReview(r.id);
    else await api.admin.hideReview(r.id);
    await queryClient.invalidateQueries({ queryKey: ["venue-reviews", venueId] });
  }

  // Admin global kill switch (Section 32 Part 12): reviews hidden everywhere when off.
  if (!reviewsEnabled) return null;

  return (
    <section className="flex flex-col gap-5" data-testid="venue-reviews">
      <h2 className="text-xl font-bold">Reviews{stats.count ? ` (${stats.count})` : ""}</h2>

      {query.isLoading ? (
        <div className="flex flex-col gap-4 animate-pulse" aria-hidden="true">
          <div className="h-40 rounded-2xl bg-player-surface-2" />
          <div className="h-28 rounded-2xl bg-player-surface-2" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 px-6 text-center bg-player-surface border border-player-border-light rounded-2xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-player-accent-soft text-player-accent">
            <StarShape size={24} />
          </span>
          <p className="font-bold">No reviews yet</p>
          <p className="text-[14px] text-player-ink-faint max-w-xs">Played here? You can rate your game from My bookings once it&apos;s done.</p>
        </div>
      ) : (
        <>
          {stats.average != null ? <Summary average={stats.average} count={stats.count} distribution={stats.distribution} /> : null}

          <ul className="flex flex-col gap-4">
            {shown.map((r) => {
              const name = r.player_first_name ?? "Player";
              return (
                <li
                  key={r.id}
                  data-testid="review-card"
                  className="bg-player-surface border border-player-border-light rounded-2xl p-5 flex flex-col gap-3 shadow-[0_1px_2px_rgba(20,26,29,0.04)]"
                  style={r.is_hidden ? { opacity: 0.55 } : undefined}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={name} />
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-[15px] truncate">
                        {name}
                        {r.is_hidden ? <span className="ml-2 text-[11px] font-bold text-player-ink-fainter">HIDDEN</span> : null}
                      </span>
                      <span className="text-[12.5px] text-player-ink-fainter">
                        {when(r.created_at)}
                        {r.updated_at ? " · edited" : ""}
                      </span>
                    </div>
                    <span className="ml-auto">
                      <Stars value={r.rating} />
                    </span>
                  </div>
                  {r.comment ? <p className="text-[15px] leading-relaxed text-player-ink-muted">{r.comment}</p> : null}
                  {r.owner_reply ? (
                    <div className="rounded-xl bg-player-surface-2 px-4 py-3 flex flex-col gap-1">
                      <p className="text-[12px] font-bold tracking-wide text-player-ink-faint uppercase">Reply from the venue</p>
                      <p className="text-[14px] text-player-ink-muted">{r.owner_reply}</p>
                    </div>
                  ) : null}
                  {isAdmin ? (
                    <button onClick={() => toggleHidden(r)} className="self-start text-[12.5px] font-semibold text-player-accent-hover hover:underline">
                      {r.is_hidden ? "Unhide" : "Hide"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {reviews.length > FIRST_PAGE ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="self-center px-6 py-2.5 rounded-full border border-player-border bg-player-surface text-[14px] font-bold text-player-ink hover:border-player-accent hover:text-player-accent-hover transition-colors"
            >
              {showAll ? "Show fewer" : `Show all ${reviews.length} reviews`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
