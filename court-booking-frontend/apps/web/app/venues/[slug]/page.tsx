import { SiteHeader } from "@/components/nav-auth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import { capitalize } from "@/lib/format";
import { VenueScheduleClient } from "./venue-schedule-client";

export async function generateMetadata({ params }: PageProps<"/venues/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  try {
    const venue = await serverApi.getVenueBySlug(slug);
    const sports = venue.sports.map(capitalize).join(" & ");
    const title = `${sports} Courts in ${venue.area ?? venue.city} — ${venue.name}`;
    const description = venue.description || `Book ${sports} courts at ${venue.name} in ${venue.area ?? venue.city}, ${venue.city}. Real-time availability, instant confirmation.`;
    return { title, description, openGraph: { title, description, images: venue.photo_urls.slice(0, 1) } };
  } catch {
    return { title: "Venue not found" };
  }
}

export default async function VenuePage({ params }: PageProps<"/venues/[slug]">) {
  const { slug } = await params;
  let venue;
  try {
    venue = await serverApi.getVenueBySlug(slug);
  } catch {
    notFound();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: venue.name,
    description: venue.description ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address,
      addressLocality: venue.area ?? venue.city,
      addressRegion: venue.city,
      addressCountry: "PK",
    },
    aggregateRating: venue.average_rating
      ? { "@type": "AggregateRating", ratingValue: venue.average_rating, reviewCount: 1 }
      : undefined,
  };

  return (
    <>
    <SiteHeader />
    <main className="pb-16">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="px-6 md:px-14 py-3 text-[13px] text-player-ink-fainter bg-player-surface border-b border-player-border-light">
        {venue.city} &nbsp;›&nbsp; {venue.area ?? venue.city} &nbsp;›&nbsp; {venue.sports.map(capitalize).join(", ")} &nbsp;›&nbsp;{" "}
        <span className="text-player-ink-muted font-semibold">{venue.name}</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 px-6 md:px-14 py-6 bg-player-surface">
        <div className="col-span-2 h-64 rounded-2xl" style={{ background: "linear-gradient(135deg,#12657A,#0A3E4A)" }} />
        <div className="grid grid-rows-2 gap-2.5">
          <div className="rounded-2xl" style={{ background: "linear-gradient(135deg,#1F7A52,#14382A)" }} />
          <div className="rounded-2xl" style={{ background: "linear-gradient(135deg,#3A3532,#211E1C)" }} />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-10 px-6 md:px-14 py-9">
        <div className="lg:col-span-2 flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">{venue.name}</h1>
              {venue.average_rating != null ? (
                <span className="px-3 py-1.5 rounded-full bg-player-accent-soft border border-player-accent-soft-border text-[13.5px] font-bold text-player-accent-hover">
                  ★ {venue.average_rating.toFixed(1)}
                </span>
              ) : null}
            </div>
            <p className="text-[16.5px] text-player-ink-muted">
              {venue.courts.length} {venue.sports.map(capitalize).join("/")} court{venue.courts.length === 1 ? "" : "s"} · {venue.address}
            </p>
            {venue.amenities && venue.amenities.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {venue.amenities.map((a) => (
                  <span key={a} className="px-3 py-1.5 rounded-lg bg-player-surface-2 text-[13.5px] font-semibold text-player-ink-muted">
                    {capitalize(a)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <VenueScheduleClient venueId={venue.id} venueName={venue.name} courts={venue.courts.filter((c) => c.is_active)} />
        </div>

        <aside className="flex flex-col gap-4">
          <div className="bg-player-surface border-[1.5px] border-player-border rounded-2xl p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold tracking-widest text-player-ink-fainter">SPORTS</span>
              <span className="text-lg font-bold">{venue.sports.map(capitalize).join(", ")}</span>
            </div>
            {venue.whatsapp ? (
              <a
                href={`https://wa.me/${venue.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="h-12 rounded-xl border border-player-border flex items-center justify-center gap-2 text-[14.5px] font-semibold text-player-ink-muted"
              >
                Ask on WhatsApp
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
    </>
  );
}
