"use client";

import Link from "next/link";
import { FavoriteButton } from "@/components/favorite-button";
import { formatPKR } from "@/lib/format";
import { useFavorites } from "@/lib/use-favorites";

/** The player's saved venues, as a row of compact cards on the dashboard. Sits next to the same shared list the hearts use,
 * so un-saving here (or on a search card) updates both. */
export function SavedVenues() {
  const { enabled, loading, venues, isError } = useFavorites();
  if (!enabled) return null;

  return (
    <section className="flex flex-col gap-3" aria-label="Saved venues" data-testid="saved-venues">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-extrabold tracking-tight">
          Saved venues{venues.length ? <span className="ml-2 font-mono text-[14px] font-semibold text-player-ink-fainter">{venues.length}</span> : null}
        </h2>
        {venues.length > 0 ? (
          <Link href="/search" className="text-[13.5px] font-bold text-player-accent-hover hover:underline">
            Find more
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-[88px] w-[280px] shrink-0 animate-pulse rounded-2xl bg-player-surface-2" />
          ))}
        </div>
      ) : isError && venues.length === 0 ? (
        <p className="rounded-2xl border border-player-border-light bg-player-surface px-5 py-4 text-[14px] text-player-ink-muted">
          Couldn&apos;t load your saved venues right now.
        </p>
      ) : venues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-player-border bg-player-surface px-5 py-4 text-[14px] text-player-ink-muted" data-testid="saved-empty">
          Tap the heart on any court to keep it here for next time.
        </p>
      ) : (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {venues.map((v) => (
            <li key={v.id} className="relative w-[280px] shrink-0 snap-start" data-testid="saved-venue">
              <Link
                href={`/venues/${v.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-player-border-light bg-player-surface p-3 pr-14 shadow-[0_1px_2px_rgba(20,26,29,0.04)] transition hover:border-player-accent-soft-border hover:shadow-[0_8px_20px_-10px_rgba(20,26,29,0.2)]"
              >
                {v.photo_urls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.photo_urls[0]} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-2xl font-extrabold text-white/90"
                    style={{ background: "linear-gradient(135deg,#F2784F,#C8431C)" }}
                    aria-hidden="true"
                  >
                    {v.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[15.5px] font-extrabold leading-snug">{v.name}</span>
                  <span className="truncate text-[12.5px] text-player-ink-faint">{[v.area ?? v.city, v.sports.join(" · ")].filter(Boolean).join(" · ")}</span>
                  <span className="text-[12.5px] font-semibold">
                    {v.average_rating != null ? (
                      <>
                        <span className="text-player-accent">★</span> {v.average_rating.toFixed(1)}
                        {v.min_price != null ? <span className="font-medium text-player-ink-faint"> · </span> : null}
                      </>
                    ) : null}
                    {v.min_price != null ? (
                      <span className="font-mono font-medium text-player-ink-muted">from PKR {formatPKR(v.min_price)}</span>
                    ) : null}
                  </span>
                </span>
              </Link>
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <FavoriteButton venueId={v.id} venueName={v.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
