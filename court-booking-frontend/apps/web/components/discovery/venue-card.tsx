import Link from "next/link";
import type { VenueSummary } from "@court-booking/types";
import { AmenityBadges } from "@/components/amenity-badges";
import { FavoriteButton } from "@/components/favorite-button";
import { formatDistance, formatPKR } from "@/lib/format";

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
 * One result card on /search. A server component: everything it shows comes from the list response (no per-venue
 * requests). The design's "Aaj khali / Kam slots" tag and Indoor/Outdoor tag are left out: the list response carries
 * neither today's availability nor the setting.
 */
export function VenueCard({ venue: v, href }: { venue: VenueSummary; href: string }) {
  const place = [v.area ?? v.city, formatDistance(v.distance_meters)].filter(Boolean).join(" Â· ");
  return (
    // The heart is a sibling of the link, not inside it (a button inside an anchor is invalid HTML and would open the venue).
    <div data-testid="venue-card" className="khelo-card group relative flex flex-col overflow-hidden rounded-3xl bg-khelo-surface">
      <Link
        href={href}
        className="flex h-full flex-col rounded-3xl focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-khelo-orange"
      >
        <div className={`relative h-[170px] shrink-0 overflow-hidden ${v.photo_urls?.[0] ? "bg-khelo-ink" : fallbackFor(v.id)}`}>
          {v.photo_urls?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.photo_urls[0]} alt={v.name} width={560} height={340} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <svg aria-hidden="true" width="100%" height="170" viewBox="0 0 280 170" fill="none" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 opacity-25">
              <rect x="30" y="25" width="220" height="120" rx="10" stroke="white" strokeWidth="3" />
              <line x1="140" y1="25" x2="140" y2="145" stroke="white" strokeWidth="3" />
              <circle cx="140" cy="85" r="22" stroke="white" strokeWidth="3" />
            </svg>
          )}
          {v.sports.length > 0 ? (
            <span className="absolute left-3.5 top-3.5 max-w-[calc(100%-84px)] truncate rounded-full bg-khelo-ink/80 px-3 py-[7px] text-[12px] font-bold capitalize text-white">
              {v.sports.join(" Â· ")}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-2 px-[22px] pb-[22px] pt-5">
          <div className="flex items-start justify-between gap-2.5">
            <h2 className="text-[20px] font-extrabold leading-[1.2]">{v.name}</h2>
            {v.average_rating != null ? (
              <div className="flex shrink-0 items-center gap-1 text-[14px] font-extrabold">
                <StarIcon />
                <span className="sr-only">Rated </span>
                {v.average_rating.toFixed(1)}
                {v.review_count > 0 ? <span className="font-medium text-khelo-muted-2">({v.review_count})</span> : null}
              </div>
            ) : null}
          </div>
          {place ? <div className="text-[14px] text-khelo-muted-2">{place}</div> : null}
          <AmenityBadges amenities={v.amenities} max={2} tone="khelo" />
          <div className="mt-auto flex items-center justify-between border-t border-khelo-divider pt-3.5">
            {v.min_price != null ? (
              <div data-testid="from-price">
                <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-khelo-muted-3">From</div>
                <div className="text-[18px] font-extrabold">
                  PKR {formatPKR(v.min_price)} <span className="text-[13px] font-medium text-khelo-muted-2">/ slot</span>
                </div>
              </div>
            ) : (
              <span className="text-[13px] text-khelo-muted-2">Price on request</span>
            )}
            <span className="text-[14px] font-extrabold text-khelo-orange-text">
              View <span aria-hidden="true">&rarr;</span>
            </span>
          </div>
        </div>
      </Link>
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
