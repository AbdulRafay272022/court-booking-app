import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { VenueListResponse } from "@court-booking/types";
import { serverApi } from "@/lib/server-api";
import { SiteHeader } from "@/components/nav-auth";
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
    <>
      <SiteHeader />
      <div className="border-b border-player-accent-soft-border" style={{ background: "linear-gradient(180deg,#FFF3EE 0%,#FAF8F6 100%)" }}>
        <div className="px-6 md:px-14 pt-10 pb-8 flex flex-col gap-2 max-w-[1400px] mx-auto">
          <p className="text-[12px] font-bold tracking-[0.14em] text-player-accent-hover uppercase">Find a court</p>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            {filters.sport ? `${filters.sport} courts` : "Courts"} in {city}
          </h1>
          <p className="text-[16px] text-player-ink-muted max-w-xl">
            Real venues, live availability. Pick a court, choose a time, and book in a minute.
          </p>
        </div>
      </div>

      <main className="px-6 md:px-14 py-8 flex flex-col gap-8 max-w-[1400px] mx-auto w-full">
        <Suspense>
          <FilterBar areas={areas} city={city} total={result ? result.total : null} />
        </Suspense>

        {failed ? (
          <div role="alert" className="flex flex-col items-center gap-2 py-16 text-center bg-player-surface border border-player-border-light rounded-2xl">
            <h2 className="text-xl font-extrabold">Couldn&apos;t load venues</h2>
            <p className="text-player-ink-muted max-w-md">Check your filters (dates must be today or later) and try again.</p>
          </div>
        ) : venues.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 px-6 text-center bg-player-surface border border-player-border-light rounded-2xl" data-testid="empty-state">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-player-accent-soft text-player-accent text-2xl" aria-hidden="true">
              ⌕
            </span>
            {filtered ? (
              <>
                <h2 className="text-xl font-extrabold">No venues match these filters</h2>
                <p className="text-player-ink-muted max-w-md">
                  Try a different date or time, a wider price range, or remove a filter.
                </p>
                <Link
                  href={`/search?city=${encodeURIComponent(city)}`}
                  className="mt-1 px-6 py-3 rounded-full bg-player-accent hover:bg-player-accent-hover transition-colors text-white text-[14px] font-bold"
                >
                  Clear all filters
                </Link>
              </>
            ) : (
              <>
                <h2 className="text-xl font-extrabold">No courts in {city} yet</h2>
                <p className="text-player-ink-muted max-w-md">
                  We&apos;re opening one area at a time so every listing is real. Right now we&apos;re live in DHA and Clifton,
                  Karachi.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {venues.map((v) => (
              <VenueCard key={v.id} venue={v} href={`/venues/${v.slug}${sportQuery}`} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
