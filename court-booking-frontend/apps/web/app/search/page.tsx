import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { VenueListResponse } from "@court-booking/types";
import { serverApi } from "@/lib/server-api";
import { KheloPage } from "@/components/site/page-shell";
import { buttonClasses } from "@/components/site/button";
import { FilterBar } from "@/components/discovery/filter-bar";
import { VenueCard } from "@/components/discovery/venue-card";
import { activeFilterCount, filtersToApiParams, parseFilters } from "@/lib/discovery-filters";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const { sport } = parseFilters(await searchParams);
  const title = sport ? `${sport} Courts in Karachi` : "Court Booking in Karachi";
  return { title, description: `Browse ${sport ?? "padel and futsal"} courts available to book right now in DHA and Clifton, Karachi.` };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const city = typeof sp.city === "string" ? sp.city : "Karachi";
  const filters = parseFilters(sp);

  let result: VenueListResponse | null = null;
  let failed = false;
  try {
    result = await serverApi.listVenues({ city, ...filtersToApiParams(filters) });
  } catch {
    failed = true;
  }
  let areas: string[] = [];
  try {
    areas = (await serverApi.areas()).areas;
  } catch {
    // the area picker just stays empty; the rest of the page still works
  }

  const venues = result?.venues ?? [];
  const filtered = activeFilterCount(filters) > 0;
  // Opening a venue from here keeps the sport the player was looking at (the venue page preselects it). The value is
  // percent-encoded: "Football (full-field)" has spaces and parentheses.
  const sportQuery = filters.sport ? `?sport=${encodeURIComponent(filters.sport)}` : "";

  return (
    <KheloPage app>
      <Suspense>
        <FilterBar areas={areas} city={city} total={result ? result.total : null}>
          {failed ? (
            <div role="alert" className="flex flex-col items-center gap-2 rounded-3xl bg-khelo-surface px-6 py-16 text-center">
              <h2 className="font-khelo-display text-xl font-extrabold">Couldn&apos;t load venues</h2>
              <p className="max-w-md text-khelo-muted">Check your filters (dates must be today or later) and try again.</p>
            </div>
          ) : venues.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-khelo-surface px-6 py-16 text-center" data-testid="empty-state">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-khelo-warm text-2xl text-khelo-orange-text" aria-hidden="true">
                ⌕
              </span>
              {filtered ? (
                <>
                  <h2 className="font-khelo-display text-xl font-extrabold">No venues match these filters</h2>
                  <p className="max-w-md text-khelo-muted">Try a different date or time, a wider price range, or remove a filter.</p>
                  <Link href={`/search?city=${encodeURIComponent(city)}`} className={buttonClasses({ variant: "primary", pill: true, className: "mt-1" })}>
                    Clear all filters
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="font-khelo-display text-xl font-extrabold">No courts in {city} yet</h2>
                  <p className="max-w-md text-khelo-muted">
                    We&apos;re opening one area at a time so every listing is real. Right now we&apos;re live in DHA and Clifton, Karachi.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-[22px]">
              {venues.map((v) => (
                <VenueCard key={v.id} venue={v} href={`/venues/${v.slug}${sportQuery}`} />
              ))}
            </div>
          )}
        </FilterBar>
      </Suspense>
    </KheloPage>
  );
}
