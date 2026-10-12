import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { VenueListResponse } from "@court-booking/types";
import { serverApi } from "@/lib/server-api";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { buttonClasses } from "@/components/site/button";
import { FilterBar } from "@/components/discovery/filter-bar";
import { VenueCard } from "@/components/discovery/venue-card";
import { ResultsView } from "@/components/discovery/results-view";
import { mapVenuesFor } from "@/lib/map-venues";
import { activeFilterCount, filtersToApiParams, parseFilters } from "@/lib/discovery-filters";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const { sport } = parseFilters(await searchParams);
  const t = await getT();
  const title = sport ? t("search.meta.titleSport", { sport }) : t("search.meta.title");
  return { title, description: t("search.meta.description", { sport: sport ?? t("search.meta.sportFallback") }) };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const t = await getT();
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
  const hrefFor = (v: { slug: string }) => `/venues/${v.slug}${sportQuery}`;
  // The List/Map toggle is offered only when most of this page's venues carry coordinates.
  const map = mapVenuesFor(venues, hrefFor);

  return (
    <KheloPage app>
      <Suspense>
        <FilterBar areas={areas} city={city} total={result ? result.total : null}>
          {failed ? (
            <div role="alert" className="flex flex-col items-center gap-2 rounded-3xl bg-khelo-surface px-6 py-16 text-center">
              <h2 className="font-khelo-display text-xl font-extrabold">{t("search.failed.title")}</h2>
              <p className="max-w-md text-khelo-muted">{t("search.failed.body")}</p>
            </div>
          ) : venues.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-khelo-surface px-6 py-16 text-center" data-testid="empty-state">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-khelo-warm text-2xl text-khelo-orange-text" aria-hidden="true">
                ⌕
              </span>
              {filtered ? (
                <>
                  <h2 className="font-khelo-display text-xl font-extrabold">{t("search.empty.filtered.title")}</h2>
                  <p className="max-w-md text-khelo-muted">{t("search.empty.filtered.body")}</p>
                  <Link href={`/search?city=${encodeURIComponent(city)}`} className={buttonClasses({ variant: "primary", pill: true, className: "mt-1" })}>
                    {t("search.empty.clear")}
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="font-khelo-display text-xl font-extrabold">{t("search.empty.none.title", { city })}</h2>
                  <p className="max-w-md text-khelo-muted">{t("search.empty.none.body")}</p>
                </>
              )}
            </div>
          ) : (
            <ResultsView
              pins={map.offerMap ? map.pins : null}
              list={
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-[22px]">
                  {venues.map((v) => (
                    <VenueCard key={v.id} venue={v} href={hrefFor(v)} />
                  ))}
                </div>
              }
            />
          )}
        </FilterBar>
      </Suspense>
    </KheloPage>
  );
}
