"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-player-accent text-[15px] tracking-tight">
      {"★".repeat(rating)}
      <span className="text-player-border">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

/** Section 32 Part 6: the venue's reviews, newest first, first name only. An admin viewing
 * the page also gets Hide/Unhide (the list includes hidden reviews for admins). */
export function VenueReviews({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const query = useQuery({
    queryKey: ["venue-reviews", venueId],
    queryFn: () => api.reviews.listForVenue(venueId),
  });
  const reviews = query.data ?? [];

  async function toggleHidden(r: Review) {
    if (r.is_hidden) await api.admin.unhideReview(r.id);
    else await api.admin.hideReview(r.id);
    await queryClient.invalidateQueries({ queryKey: ["venue-reviews", venueId] });
  }

  return (
    <section className="flex flex-col gap-4" data-testid="venue-reviews">
      <h2 className="text-xl font-bold">Reviews{reviews.length ? ` (${reviews.length})` : ""}</h2>
      {query.isLoading ? (
        <p className="text-player-ink-fainter">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="text-player-ink-fainter text-[14px]">No reviews yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="bg-player-surface border border-player-border rounded-2xl p-4 flex flex-col gap-2"
              style={r.is_hidden ? { opacity: 0.55 } : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Stars rating={r.rating} />
                  <span className="font-semibold text-[14px]">{r.player_first_name ?? "Player"}</span>
                  {r.is_hidden ? <span className="text-[11px] font-bold text-player-ink-fainter">HIDDEN</span> : null}
                </div>
                <span className="text-[12.5px] text-player-ink-fainter">{formatShortDate(r.created_at)}</span>
              </div>
              {r.comment ? <p className="text-[14.5px] text-player-ink-muted">{r.comment}</p> : null}
              {r.owner_reply ? (
                <div className="mt-1 pl-3 border-l-2 border-player-border">
                  <p className="text-[12px] font-bold text-player-ink-fainter">Owner replied</p>
                  <p className="text-[14px] text-player-ink-muted">{r.owner_reply}</p>
                </div>
              ) : null}
              {isAdmin ? (
                <button
                  onClick={() => toggleHidden(r)}
                  className="self-start text-[12.5px] font-semibold text-player-accent-hover"
                >
                  {r.is_hidden ? "Unhide" : "Hide"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
