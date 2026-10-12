"use client";

import Link from "next/link";
import type { VenueSummary } from "@court-booking/types";
import { AmenityBadges } from "@/components/amenity-badges";
import { FavoriteButton } from "@/components/favorite-button";
import { useT } from "@/components/i18n/lang-provider";
import { rememberSearch } from "@/components/venue/back-to-results";
import { formatDistance, formatPKR } from "@/lib/format";
import { searchHref } from "@/lib/search-links";
import { availabilityTag, settingKinds } from "@/lib/venue-tags";
import { coordsOf, pointUrl } from "@/lib/venue-location";

/** Photo-less cards get one of the brand colours, picked from the venue id so a venue keeps its colour between visits. */
const FALLBACKS = ["bg-khelo-ink", "bg-khelo-teal", "bg-khelo-orange-text", "bg-khelo-orange-label"] as const;
function fallbackFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-khelo-warning">
      <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

/**
 * Small links that sit ABOVE the card's stretched link (z-10) and are siblings of it, never inside it: an anchor inside an anchor is
 * invalid HTML. The pseudo-element widens the tap area to 44px high without making the pill taller.
 */
const TAG_LINK =
  "relative z-10 inline-flex items-center before:absolute before:-inset-x-1 before:-inset-y-[7px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange";

/**
 * One result card on /search (and the Saved venues strip). The WHOLE card opens the venue: the venue name is a real link whose ::after
 * covers the card (the "stretched link" pattern). Everything that is its own control (sport tags, area, Indoor/Outdoor, Open in Maps, the
 * heart) is a sibling positioned above it, so there are no nested interactive elements. Sport, area and Indoor/Outdoor lead to the
 * matching filtered Search. Everything it shows comes from the list response (no per-venue requests).
 */
export function VenueCard({ venue: v, href }: { venue: VenueSummary; href: string }) {
  const t = useT();
  const distance = formatDistance(v.distance_meters);
  const placeName = v.area ?? v.city;
  const settings = settingKinds(v);
  const availability = availabilityTag(v.today_free_slots);
  const coords = coordsOf(v);
  return (
    <div data-testid="venue-card" className="khelo-card group relative flex flex-col overflow-hidden rounded-3xl bg-khelo-surface">
      <div className={`relative h-[170px] shrink-0 overflow-hidden ${v.photo_urls?.[0] ? "bg-khelo-ink" : fallbackFor(v.id)}`}>
        {v.photo_urls?.[0] ? (
          // The name link below already names the venue, so the photo is decorative.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.photo_urls[0]} alt="" width={560} height={340} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <svg aria-hidden="true" width="100%" height="170" viewBox="0 0 280 170" fill="none" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 opacity-25">
            <rect x="30" y="25" width="220" height="120" rx="10" stroke="white" strokeWidth="3" />
            <line x1="140" y1="25" x2="140" y2="145" stroke="white" strokeWidth="3" />
            <circle cx="140" cy="85" r="22" stroke="white" strokeWidth="3" />
          </svg>
        )}
        {v.sports.length > 0 ? (
          <ul className="absolute left-3.5 top-3.5 z-10 m-0 flex max-w-[calc(100%-84px)] list-none flex-wrap gap-x-1.5 gap-y-2 p-0">
            {v.sports.map((s) => (
              <li key={s}>
                <Link
                  href={searchHref({ city: v.city, sport: s })}
                  data-testid="sport-tag"
                  className={`${TAG_LINK} rounded-full bg-khelo-ink/80 px-3 py-[7px] text-[12px] font-bold capitalize text-white hover:bg-khelo-ink`}
                >
                  {s}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-[22px] pb-[22px] pt-5">
        <div className="flex items-start justify-between gap-2.5">
          <h2 className="text-[20px] font-extrabold leading-[1.2]">
            <Link
              href={href}
              onClick={() => rememberSearch(v.slug)}
              className="rounded-md after:absolute after:inset-0 after:z-0 after:rounded-3xl after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange focus-visible:after:outline-2 focus-visible:after:-outline-offset-4 focus-visible:after:outline-khelo-orange"
            >
              {v.name}
            </Link>
          </h2>
          {v.average_rating != null ? (
            <div className="flex shrink-0 items-center gap-1 text-[14px] font-extrabold">
              <StarIcon />
              <span className="sr-only">{t("venue.card.rated")}</span>
              {v.average_rating.toFixed(1)}
              {v.review_count > 0 ? <span className="font-medium text-khelo-muted-2">({v.review_count})</span> : null}
            </div>
          ) : null}
        </div>
        {placeName || distance || coords ? (
          <div className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-khelo-muted-2">
            {placeName ? (
              <Link
                href={searchHref(v.area ? { city: v.city, area: v.area } : { city: v.city })}
                data-testid="area-link"
                className={`${TAG_LINK} font-medium hover:text-khelo-ink hover:underline`}
              >
                {placeName}
              </Link>
            ) : null}
            {distance ? (
              <span>
                {placeName ? <span aria-hidden="true">&middot; </span> : null}
                {distance}
              </span>
            ) : null}
            {coords ? (
              <a
                href={pointUrl(coords)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-in-maps"
                aria-label={t("venue.card.openInMapsFor", { name: v.name })}
                className={`${TAG_LINK} font-bold text-khelo-orange-text hover:underline`}
              >
                {t("venue.card.openInMaps")}
              </a>
            ) : null}
          </div>
        ) : null}
        {availability || settings.length > 0 ? (
          <div className="flex flex-wrap gap-x-2 gap-y-2" data-testid="venue-tags">
            {availability ? (
              <span
                className={`rounded-full px-2.5 py-1.5 text-[12px] font-extrabold ${
                  availability.tone === "plenty" ? "bg-khelo-success-bg text-khelo-success-text" : "bg-khelo-warning-bg text-khelo-warning-text"
                }`}
              >
                {availability.tone === "plenty" ? t("venue.card.freeToday") : t("venue.card.fewSlots")}
              </span>
            ) : null}
            {settings.map((kind) => (
              <Link
                key={kind}
                href={searchHref({ city: v.city, indoor: kind === "indoor" })}
                data-testid="setting-link"
                className={`${TAG_LINK} rounded-full bg-khelo-page px-2.5 py-1.5 text-[12px] font-bold text-khelo-muted hover:text-khelo-ink hover:underline`}
              >
                {kind === "indoor" ? t("venue.card.indoor") : t("venue.card.outdoor")}
              </Link>
            ))}
          </div>
        ) : null}
        <AmenityBadges amenities={v.amenities} max={2} tone="khelo" />
        <div className="mt-auto flex items-center justify-between border-t border-khelo-divider pt-3.5">
          {v.min_price != null ? (
            <div data-testid="from-price">
              <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-khelo-muted-3">{t("venue.card.from")}</div>
              <div className="text-[18px] font-extrabold">
                PKR {formatPKR(v.min_price)} <span className="text-[13px] font-medium text-khelo-muted-2">{t("venue.card.perSlot")}</span>
              </div>
            </div>
          ) : (
            <span className="text-[13px] text-khelo-muted-2">{t("venue.card.priceOnRequest")}</span>
          )}
          <span aria-hidden="true" className="text-[14px] font-extrabold text-khelo-orange-text">
            {t("venue.card.view")} <span>&rarr;</span>
          </span>
        </div>
      </div>
      <div className="absolute right-3.5 top-3.5 z-10 flex h-11 w-11 items-center justify-center [&>button]:h-11 [&>button]:w-11">
        <FavoriteButton venueId={v.id} venueName={v.name} />
      </div>
    </div>
  );
}

/** Placeholder shown by app/search/loading.tsx while the list loads. */
export function VenueCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-3xl bg-khelo-surface" aria-hidden="true">
      <div className="h-[170px] bg-khelo-divider" />
      <div className="flex flex-col gap-3 px-[22px] pb-[22px] pt-5">
        <div className="h-5 w-2/3 rounded bg-khelo-divider" />
        <div className="h-4 w-1/3 rounded bg-khelo-divider" />
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-md bg-khelo-divider" />
          <div className="h-6 w-16 rounded-md bg-khelo-divider" />
        </div>
        <div className="mt-2 h-px bg-khelo-divider" />
        <div className="h-5 w-1/2 rounded bg-khelo-divider" />
      </div>
    </div>
  );
}
