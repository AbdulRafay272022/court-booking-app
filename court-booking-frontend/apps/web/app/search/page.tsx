import Link from "next/link";
import type { Metadata } from "next";
import { serverApi } from "@/lib/server-api";
import { SiteHeader } from "@/components/nav-auth";
import { capitalize, formatDistance } from "@/lib/format";

const SPORTS = ["padel", "futsal", "cricket", "tennis"];

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const sp = await searchParams;
  const sport = typeof sp.sport === "string" ? sp.sport : undefined;
  const title = sport ? `${capitalize(sport)} Courts in Karachi` : "Court Booking in Karachi";
  return { title, description: `Browse ${sport ?? "padel and futsal"} courts available to book right now in DHA and Clifton, Karachi.` };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const sport = typeof sp.sport === "string" ? sp.sport : undefined;
  const city = typeof sp.city === "string" ? sp.city : "Karachi";

  const { venues, total } = await serverApi.listVenues({ sport, city, radius_km: 15 });

  function hrefFor(nextSport?: string) {
    const usp = new URLSearchParams();
    usp.set("city", city);
    if (nextSport) usp.set("sport", nextSport);
    return `/search?${usp.toString()}`;
  }

  return (
    <>
    <SiteHeader />
    <main className="px-6 md:px-14 py-10 flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {sport ? `${capitalize(sport)} courts` : "Courts"} in {city}
        </h1>
        <p className="text-player-ink-faint text-sm">
          {total} venue{total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link
          href={hrefFor(undefined)}
          className="px-4 py-2.5 rounded-full text-[13.5px] font-semibold"
          style={{ background: !sport ? "#141A1D" : "#F4EFEC", color: !sport ? "#fff" : "#5C544D" }}
        >
          All sports
        </Link>
        {SPORTS.map((s) => (
          <Link
            key={s}
            href={hrefFor(s)}
            className="px-4 py-2.5 rounded-full text-[13.5px] font-semibold"
            style={{ background: sport === s ? "#141A1D" : "#F4EFEC", color: sport === s ? "#fff" : "#5C544D" }}
          >
            {capitalize(s)}
          </Link>
        ))}
      </div>

      {venues.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <h2 className="text-xl font-extrabold">No {sport ?? "courts"} in {city} yet</h2>
          <p className="text-player-ink-muted max-w-md">
            We're opening one area at a time so every listing is real. Right now we're live in DHA and Clifton,
            Karachi.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {venues.map((v) => (
            <Link
              key={v.id}
              href={`/venues/${v.slug}`}
              className="bg-player-surface border border-player-border-light rounded-2xl overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="h-32" style={{ background: "linear-gradient(135deg,#12657A,#0A3E4A)" }} />
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
                <p className="text-xs text-player-ink-fainter">{v.sports.map(capitalize).join(" · ")}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
    </>
  );
}
