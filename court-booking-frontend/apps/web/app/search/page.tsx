import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { VenueListResponse } from "@court-booking/types";
import { serverApi } from "@/lib/server-api";
import { SiteHeader } from "@/components/nav-auth";
import { FilterBar } from "@/components/discovery/filter-bar";
import { activeFilterCount, filtersToApiParams, parseFilters } from "@/lib/discovery-filters";
import { formatDistance, formatPKR } from "@/lib/format";

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
    <main className="px-6 md:px-14 py-10 flex flex-col gap-7">
      <h1 className="text-2xl font-extrabold tracking-tight">
        {filters.sport ? `${filters.sport} courts` : "Courts"} in {city}
      </h1>

      <Suspense>
        <FilterBar areas={areas} city={city} total={result ? result.total : null} />
      </Suspense>

      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-2 py-16 text-center">
          <h2 className="text-xl font-extrabold">Couldn&apos;t load venues</h2>
          <p className="text-player-ink-muted max-w-md">Check your filters (dates must be today or later) and try again.</p>
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="empty-state">
          {filtered ? (
            <>
              <h2 className="text-xl font-extrabold">No venues match these filters</h2>
              <p className="text-player-ink-muted max-w-md">
                Try a different date or time, a wider price range, or remove a filter.
              </p>
              <Link href={`/search?city=${encodeURIComponent(city)}`} className="px-5 py-2.5 rounded-full bg-player-ink text-white text-[13.5px] font-semibold">
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {venues.map((v) => (
            <Link
              key={v.id}
              href={`/venues/${v.slug}${sportQuery}`}
              data-testid="venue-card"
              className="bg-player-surface border border-player-border-light rounded-2xl overflow-hidden hover:shadow-md transition-shadow"
            >
              {v.photo_urls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.photo_urls[0]} alt={v.name} className="h-32 w-full object-cover" />
              ) : (
                <div className="h-32" style={{ background: "linear-gradient(135deg,#12657A,#0A3E4A)" }} />
              )}
              <div className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-[16px]">{v.name}</h3>
                  {v.average_rating != null ? (
                    <span className="text-[13px] font-bold text-player-accent-hover shrink-0">★ {v.average_rating.toFixed(1)}</span>
                  ) : null}
                </div>
                <p className="text-[13px] text-player-ink-faint">
                  {[v.area ?? v.city, formatDistance(v.distance_meters)].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-player-ink-fainter">{v.sports.join(" · ")}</p>
                {v.min_price != null ? (
                  <p className="text-[13.5px] font-semibold text-player-ink" data-testid="from-price">
                    from PKR <span className="font-mono">{formatPKR(v.min_price)}</span>
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
    </>
  );
}
