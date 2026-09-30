import { SiteHeader } from "@/components/nav-auth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { amenityLabel } from "@court-booking/types";
import { serverApi } from "@/lib/server-api";
import { capitalize } from "@/lib/format";
import { safeJsonLd } from "@/lib/safe-json";
import { VenueScheduleClient } from "./venue-schedule-client";
import { PhotoGallery } from "@/components/photo-gallery";
import { VenueReviews } from "@/components/venue-reviews";

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
    aggregateRating:
      venue.average_rating && venue.review_count > 0
        ? { "@type": "AggregateRating", ratingValue: venue.average_rating, reviewCount: venue.review_count }
        : undefined,
  };

  // Escape characters that would otherwise let owner-controlled fields (name, description,
  // address) break out of the enclosing <script> tag and inject executable HTML on the public,
  // unauthenticated page. JSON.stringify itself does NOT escape <, >, / or & -- a venue name
  // containing `</script><script>alert(1)</script>` closes the JSON-LD script tag and executes
  // the second one; live-confirmed by QA. Escaping < to < is enough to make an early tag
  // close impossible while keeping the JSON-LD structurally identical for legitimate content.
  // Also escape > and & to defuse `<!--`/`-->` HTML-comment tricks and ampersand-based hex
  // entities. See safeJsonLd() in @/lib/safe-json below (kept as a shared util so any future
  // dangerouslySetInnerHTML-with-JSON site goes through the same escape).
  const jsonLdHtml = safeJsonLd(jsonLd);

  return (
    <>
    <SiteHeader />
    <main className="pb-16">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml }} />

      <div className="px-6 md:px-14 py-3 text-[13px] text-player-ink-fainter bg-player-surface border-b border-player-border-light">
        {venue.city} &nbsp;›&nbsp; {venue.area ?? venue.city} &nbsp;›&nbsp; {venue.sports.map(capitalize).join(", ")} &nbsp;›&nbsp;{" "}
        <span className="text-player-ink-muted font-semibold">{venue.name}</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-10 px-6 md:px-14 py-9">
        <div className="lg:col-span-2 flex flex-col gap-8 min-w-0">
          <PhotoGallery photos={venue.photo_urls ?? []} alt={venue.name} testId="venue-gallery" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">{venue.name}</h1>
              {venue.average_rating != null ? (
                <span className="px-3 py-1.5 rounded-full bg-player-accent-soft border border-player-accent-soft-border text-[13.5px] font-bold text-player-accent-hover">
                  ★ {venue.average_rating.toFixed(1)}
                  {venue.review_count > 0 ? ` (${venue.review_count})` : ""}
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
                    {amenityLabel(a)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <VenueScheduleClient venueId={venue.id} venueName={venue.name} sports={venue.sports} courts={venue.courts.filter((c) => c.is_active)} />

          <VenueReviews venueId={venue.id} />
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
