"use client";

import Link from "next/link";
import { VenueCard } from "@/components/discovery/venue-card";
import { useT } from "@/components/i18n/lang-provider";
import { useFavorites } from "@/lib/use-favorites";

/** The player's saved venues, as a row of the same cards /search shows. Sits next to the same shared list the hearts use,
 * so un-saving here (or on a search card) updates both. `grid` lays them out as a wrapping grid (Account > Saved) instead of a scrolling row. */
export function SavedVenues({ grid = false, showHeading = true }: { grid?: boolean; showHeading?: boolean }) {
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
        <div className={grid ? "grid gap-4 sm:grid-cols-2" : "flex gap-4 overflow-hidden"} aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className={`h-[300px] animate-pulse rounded-3xl bg-fl-mist ${grid ? "" : "w-[280px] shrink-0"}`} />
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
        <ul className={grid ? "grid gap-4 sm:grid-cols-2" : "-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3"} aria-label={t("bookings.saved.listAria")}>
          {venues.map((v, i) => (
            <li key={v.id} className={`flex flex-col ${grid ? "" : "w-[280px] shrink-0 snap-start"}`} data-testid="saved-venue">
              <VenueCard venue={v} href={`/venues/${v.slug}`} eager={i < 2} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
