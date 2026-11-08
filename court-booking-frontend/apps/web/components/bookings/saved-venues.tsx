"use client";

import Link from "next/link";
import { VenueCard } from "@/components/discovery/venue-card";
import { useT } from "@/components/i18n/lang-provider";
import { useFavorites } from "@/lib/use-favorites";

/** The Find a court results grid (app/search/page.tsx). */
const SEARCH_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-[22px]";

/** The player's saved venues, as a row of the same cards /search shows. Sits next to the same shared list the hearts use,
 * so un-saving here (or on a search card) updates both. fix/nov-9: always the search grid (same card size); `grid` is kept for old callers. */
export function SavedVenues({ showHeading = true }: { grid?: boolean; showHeading?: boolean }) {
  const t = useT();
  const { enabled, loading, venues, isError } = useFavorites();
  if (!enabled) return null;

  return (
    <section className="flex flex-col gap-4" aria-label={t("bookings.saved.aria")} data-testid="saved-venues">
      <div className="flex items-baseline justify-between gap-3">
        {showHeading ? (
          <h2 className="font-khelo-display text-[22px] font-extrabold tracking-tight">
            {t("bookings.saved.title")}
            {venues.length ? <span className="ml-2 text-[15px] font-bold text-fl-muted2">{venues.length}</span> : null}
          </h2>
        ) : (
          <span />
        )}
        {venues.length > 0 ? (
          <Link href="/search" className="inline-flex min-h-11 items-center text-[14px] font-extrabold text-fl-orange-deep hover:underline">
            {t("bookings.saved.findMore")}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className={SEARCH_GRID} aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-3xl bg-fl-mist" />
          ))}
        </div>
      ) : isError && venues.length === 0 ? (
        <p role="alert" className="rounded-3xl bg-fl-white px-5 py-4 text-[15px] text-fl-muted">
          {t("bookings.saved.error")}
        </p>
      ) : venues.length === 0 ? (
        <p className="rounded-3xl border-[1.5px] border-dashed border-fl-line-strong bg-fl-white px-5 py-4 text-[15px] text-fl-muted" data-testid="saved-empty">
          {t("bookings.saved.empty")}
        </p>
      ) : (
        // fix/nov-9 item 7: the same card at the same size as Find a court (its grid), on My bookings and in the account hub
        <ul className={SEARCH_GRID} aria-label={t("bookings.saved.listAria")}>
          {venues.map((v, i) => (
            <li key={v.id} className="flex flex-col" data-testid="saved-venue">
              <VenueCard venue={v} href={`/venues/${v.slug}`} eager={i < 2} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
