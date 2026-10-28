import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
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
import { BackToResults } from "@/components/venue/back-to-results";
import { VenueLocation } from "@/components/venue/venue-location";
import { getT } from "@/lib/i18n-server";
import { searchHref } from "@/lib/search-links";
import { coordsOf, pointUrl } from "@/lib/venue-location";

export async function generateMetadata({ params }: PageProps<"/venues/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const t = await getT();
  try {
    const venue = await serverApi.getVenueBySlug(slug);
    const sports = venue.sports.map(capitalize).join(" & ");
    const place = venue.area ?? venue.city;
    const title = t("venue.meta.title", { sports, place, name: venue.name });
    const description = venue.description || t("venue.meta.description", { sports, name: venue.name, place, city: venue.city });
    return { title, description, openGraph: { title, description, images: venue.photo_urls.slice(0, 1) } };
  } catch {
    return { title: t("venue.meta.notFound") };
  }
}

export default async function VenuePage({ params }: PageProps<"/venues/[slug]">) {
  const { slug } = await params;
  const t = await getT();
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
  // audit 2026-10-28 item 13: no venue-level Indoor / Outdoor chips (a venue with one of each showed both, which read as a
  // contradiction). Each court says it on its own card in the court picker (venue-schedule-client.tsx).
  // "From" price = the cheapest active pricing rule across the active courts; hidden when no court has one.
  const prices = activeCourts.flatMap((c) => (c.pricing_rules ?? []).filter((r) => r.is_active).map((r) => r.price_per_slot));
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;
  const place = [venue.area ?? venue.city, venue.city !== (venue.area ?? venue.city) ? venue.city : null].filter(Boolean).join(", ");
  const coords = coordsOf(venue);
  const showArea = venue.area && venue.area !== venue.city;
  // Every label that looks like a filter is a link to that filter (see lib/search-links.ts). `before:` widens the tap area to 44px.
  const crumbLink =
    "inline-flex min-h-11 items-center rounded-md px-1 hover:text-fl-night hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-orange";
  const tagLink =
    "relative inline-flex items-center before:absolute before:-inset-x-1 before:-inset-y-[7px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-orange";

  return (
    <KheloPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml }} />

      <Container wide className="pb-16 pt-5 md:pt-7">
        <div className="mb-4 flex flex-col gap-0.5">
          <BackToResults slug={venue.slug} />
          <nav aria-label={t("venue.breadcrumb.label")} className="text-[13px] text-fl-muted2">
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0">
              <li>
                <Link href={searchHref({ city: venue.city })} className={crumbLink}>
                  {venue.city}
                </Link>
              </li>
              {showArea ? (
                <>
                  <li aria-hidden="true">{"›"}</li>
                  <li>
                    <Link href={searchHref({ city: venue.city, area: venue.area })} className={crumbLink}>
                      {venue.area}
                    </Link>
                  </li>
                </>
              ) : null}
              {venue.sports.length > 0 ? (
                <>
                  <li aria-hidden="true">{"›"}</li>
                  <li className="flex flex-wrap items-center">
                    {venue.sports.map((s, i) => (
                      <span key={s} className="inline-flex items-center">
                        <Link href={searchHref({ city: venue.city, sport: s })} className={crumbLink}>
                          {capitalize(s)}
                        </Link>
                        {i < venue.sports.length - 1 ? <span aria-hidden="true">,</span> : null}
                      </span>
                    ))}
                  </li>
                </>
              ) : null}
              <li aria-hidden="true">{"›"}</li>
              <li aria-current="page" className="font-bold text-fl-night">
                {venue.name}
              </li>
            </ol>
          </nav>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
          <div className="flex min-w-0 flex-col gap-8">
            <PhotoGallery photos={venue.photo_urls ?? []} alt={venue.name} testId="venue-gallery" />

            <header className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                {venue.sports.map((s) => (
                  <Link
                    key={s}
                    href={searchHref({ city: venue.city, sport: s })}
                    data-testid="sport-tag"
                    className={`${tagLink} rounded-full bg-fl-night px-3 py-[7px] text-[12px] font-bold capitalize text-white hover:bg-fl-teal`}
                  >
                    {s}
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1px] md:text-[44px]">{venue.name}</h1>
                {venue.average_rating != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-fl-waiting-tint px-3 py-1.5 text-[14px] font-extrabold text-fl-waiting">
                    <span aria-hidden="true">{"★"}</span>
                    <span className="sr-only">{t("venue.card.rated")}</span>
                    {venue.average_rating.toFixed(1)}
                    {venue.review_count > 0 ? <span className="font-medium"> ({venue.review_count})</span> : null}
                  </span>
                ) : null}
                <FavoriteButton venueId={venue.id} venueName={venue.name} />
              </div>
              <p className="text-[16px] text-fl-muted">
                {t(venue.courts.length === 1 ? "venue.hero.courtOne" : "venue.hero.courtMany", { count: venue.courts.length, sports: venue.sports.map(capitalize).join("/") })} · {venue.address}
                {coords ? (
                  <>
                    {" "}
                    <a
                      href={pointUrl(coords)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="open-in-maps"
                      className="inline-flex min-h-11 items-center font-bold text-fl-orange-deep hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-orange"
                    >
                      {t("venue.card.openInMaps")}
                    </a>
                  </>
                ) : null}
              </p>
              <AmenityBadges amenities={venue.amenities} size="md" />
              {venue.description ? <p className="max-w-[68ch] text-[15.5px] leading-relaxed text-fl-muted">{venue.description}</p> : null}
            </header>

            <div id="availability" className="scroll-mt-6">
              <VenueScheduleClient venueId={venue.id} venueName={venue.name} sports={venue.sports} courts={activeCourts} horizonDays={venue.booking_horizon_days} cancellation={{ cancellation_allowed: venue.cancellation_allowed, cancellation_cutoff_hours: venue.cancellation_cutoff_hours }} />
            </div>

            <VenueLocation name={venue.name} address={venue.address} area={venue.area} city={venue.city} latitude={venue.latitude} longitude={venue.longitude} />

            <VenueReviews venueId={venue.id} />
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6" aria-label={t("venue.aside.label")}>
            <div className="flex flex-col gap-5 rounded-3xl bg-fl-white p-6">
              {fromPrice != null ? (
                <div data-testid="from-price">
                  <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-fl-muted2">{t("venue.card.from")}</div>
                  <div className="font-khelo-display text-[30px] font-extrabold leading-tight">
                    PKR {formatPKR(fromPrice)} <span className="text-[14px] font-medium text-fl-muted2">{t("venue.card.perSlot")}</span>
                  </div>
                </div>
              ) : null}
              <dl className="flex flex-col gap-3 text-[14px]">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-fl-muted2">{t("venue.aside.sports")}</dt>
                  <dd className="font-bold">{sportsText}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-fl-muted2">{t("venue.aside.location")}</dt>
                  <dd className="font-bold">{place}</dd>
                </div>
              </dl>
              <a href="#availability" className="khelo-btn hidden min-h-12 items-center justify-center rounded-[14px] bg-fl-orange px-6 lg:inline-flex text-[15px] font-extrabold text-fl-night">
                {t("venue.aside.check")}
              </a>
              {venue.whatsapp ? (
                <a
                  href={`https://wa.me/${venue.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="khelo-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-fl-night text-[14.5px] font-bold text-fl-night"
                >
                  {t("venue.aside.whatsapp")}
                </a>
              ) : null}
            </div>
          </aside>
        </div>
      </Container>
    </KheloPage>
  );
}
