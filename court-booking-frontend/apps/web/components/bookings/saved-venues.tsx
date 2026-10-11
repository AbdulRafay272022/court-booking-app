"use client";

import Link from "next/link";
import { VenueCard } from "@/components/discovery/venue-card";
import { useFavorites } from "@/lib/use-favorites";

/** The player's saved venues, as a row of the same cards /search shows. Sits next to the same shared list the hearts use,
 * so un-saving here (or on a search card) updates both. */
export function SavedVenues() {
  const { enabled, loading, venues, isError } = useFavorites();
  if (!enabled) return null;

  return (
    <section className="flex flex-col gap-4" aria-label="Saved venues" data-testid="saved-venues">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-khelo-display text-[22px] font-extrabold tracking-tight">
          Saved venues{venues.length ? <span className="ml-2 text-[15px] font-bold text-khelo-muted-2">{venues.length}</span> : null}
        </h2>
        {venues.length > 0 ? (
          <Link href="/search" className="inline-flex min-h-11 items-center text-[14px] font-extrabold text-khelo-orange-text hover:underline">
            Find more
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-hidden" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-[300px] w-[280px] shrink-0 animate-pulse rounded-3xl bg-khelo-divider" />
          ))}
        </div>
      ) : isError && venues.length === 0 ? (
        <p role="alert" className="rounded-3xl bg-khelo-surface px-5 py-4 text-[15px] text-khelo-muted">
          Couldn&apos;t load your saved venues right now.
        </p>
      ) : venues.length === 0 ? (
        <p className="rounded-3xl border-[1.5px] border-dashed border-khelo-dash bg-khelo-surface px-5 py-4 text-[15px] text-khelo-muted" data-testid="saved-empty">
          Tap the heart on any court to keep it here for next time.
        </p>
      ) : (
        <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3" aria-label="Saved venues list">
          {venues.map((v) => (
            <li key={v.id} className="flex w-[280px] shrink-0 snap-start flex-col" data-testid="saved-venue">
              <VenueCard venue={v} href={`/venues/${v.slug}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
