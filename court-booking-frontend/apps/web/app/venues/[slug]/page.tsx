import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";
import { AmenityBadges } from "@/components/amenity-badges";
import { FavoriteButton } from "@/components/favorite-button";
import { serverApi } from "@/lib/server-api";
import { capitalize, formatPKR } from "@/lib/format";
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
    const description = venue.description || `Book ${sports} courts at ${venue.name} in ${venue.area ?? venue.city}, ${venue.city} on Khelo. Real-time availability, instant confirmation.`;
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

  const activeCourts = venue.courts.filter((c) => c.is_active);
  const sportsText = venue.sports.map(capitalize).join(", ");
  // Setting comes from the courts themselves: all indoor, all outdoor, or both. Hidden when there are no active courts.
  const settings = [
    activeCourts.some((c) => c.is_indoor) ? "Indoor" : null,
    activeCourts.some((c) => !c.is_indoor) ? "Outdoor" : null,
  ].filter((t): t is string => t !== null);
  // "From" price = the cheapest active pricing rule across the active courts; hidden when no court has one.
  const prices = activeCourts.flatMap((c) => (c.pricing_rules ?? []).filter((r) => r.is_active).map((r) => r.price_per_slot));
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;
  const place = [venue.area ?? venue.city, venue.city !== (venue.area ?? venue.city) ? venue.city : null].filter(Boolean).join(", ");

  return (
    <KheloPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml }} />

      <Container wide className="pb-16 pt-5 md:pt-7">
        <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-khelo-muted-2">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li>{venue.city}</li>
            {venue.area && venue.area !== venue.city ? (
              <>
                <li aria-hidden="true">{"›"}</li>
                <li>{venue.area}</li>
              </>
            ) : null}
            {sportsText ? (
              <>
                <li aria-hidden="true">{"›"}</li>
                <li>{sportsText}</li>
              </>
            ) : null}
            <li aria-hidden="true">{"›"}</li>
            <li aria-current="page" className="font-bold text-khelo-ink">
              {venue.name}
            </li>
          </ol>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
          <div className="flex min-w-0 flex-col gap-8">
            <PhotoGallery photos={venue.photo_urls ?? []} alt={venue.name} testId="venue-gallery" />

            <header className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {venue.sports.map((s) => (
                  <span key={s} className="rounded-full bg-khelo-ink px-3 py-[7px] text-[12px] font-bold capitalize text-white">
                    {s}
                  </span>
                ))}
                {settings.map((t) => (
                  <span key={t} data-testid="setting-tag" className="rounded-full bg-khelo-mint px-3 py-[7px] text-[12px] font-bold text-khelo-teal">
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1px] md:text-[44px]">{venue.name}</h1>
                {venue.average_rating != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-khelo-warning-bg px-3 py-1.5 text-[14px] font-extrabold text-khelo-warning-text">
                    <span aria-hidden="true">{"★"}</span>
                    <span className="sr-only">Rated </span>
                    {venue.average_rating.toFixed(1)}
                    {venue.review_count > 0 ? <span className="font-medium"> ({venue.review_count})</span> : null}
                  </span>
                ) : null}
                <FavoriteButton venueId={venue.id} venueName={venue.name} variant="pill" />
              </div>
              <p className="text-[16px] text-khelo-muted">
                {venue.courts.length} {venue.sports.map(capitalize).join("/")} court{venue.courts.length === 1 ? "" : "s"} · {venue.address}
              </p>
              <AmenityBadges amenities={venue.amenities} size="md" tone="khelo" />
              {venue.description ? <p className="max-w-[68ch] text-[15.5px] leading-relaxed text-khelo-muted">{venue.description}</p> : null}
            </header>

            <div id="availability" className="scroll-mt-6">
              <VenueScheduleClient venueId={venue.id} venueName={venue.name} sports={venue.sports} courts={activeCourts} horizonDays={venue.booking_horizon_days} />
            </div>

            <VenueReviews venueId={venue.id} />
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6" aria-label="Venue summary">
            <div className="flex flex-col gap-5 rounded-3xl bg-khelo-surface p-6">
              {fromPrice != null ? (
                <div data-testid="from-price">
                  <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-khelo-muted-2">From</div>
                  <div className="font-khelo-display text-[30px] font-extrabold leading-tight">
                    PKR {formatPKR(fromPrice)} <span className="text-[14px] font-medium text-khelo-muted-2">/ slot</span>
                  </div>
                </div>
              ) : null}
              <dl className="flex flex-col gap-3 text-[14px]">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-khelo-muted-2">Sports</dt>
                  <dd className="font-bold">{sportsText}</dd>
                </div>
                {settings.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-khelo-muted-2">Setting</dt>
                    <dd className="font-bold">{settings.join(" & ")}</dd>
                  </div>
                ) : null}
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-khelo-muted-2">Location</dt>
                  <dd className="font-bold">{place}</dd>
                </div>
              </dl>
              <a href="#availability" className="khelo-btn hidden min-h-12 items-center justify-center rounded-[14px] bg-khelo-orange px-6 lg:inline-flex text-[15px] font-extrabold text-khelo-ink">
                Check availability
              </a>
              {venue.whatsapp ? (
                <a
                  href={`https://wa.me/${venue.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="khelo-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-khelo-ink text-[14.5px] font-bold text-khelo-ink"
                >
                  Ask on WhatsApp
                </a>
              ) : null}
            </div>
          </aside>
        </div>
      </Container>
    </KheloPage>
  );
}
