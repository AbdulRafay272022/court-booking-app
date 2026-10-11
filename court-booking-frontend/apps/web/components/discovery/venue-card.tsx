import Link from "next/link";
import type { VenueSummary } from "@court-booking/types";
import { AmenityBadges } from "@/components/amenity-badges";
import { formatDistance, formatPKR } from "@/lib/format";

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  );
}

/** One result card on /search. A server component: everything it shows comes from the list response. */
export function VenueCard({ venue: v, href }: { venue: VenueSummary; href: string }) {
  const place = [v.area ?? v.city, formatDistance(v.distance_meters)].filter(Boolean).join(" · ");
  return (
    <Link
      href={href}
      data-testid="venue-card"
      className="group flex flex-col bg-player-surface border border-player-border-light rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(20,26,29,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(20,26,29,0.22)] hover:border-player-accent-soft-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-player-accent"
    >
      <div className="relative h-44 overflow-hidden bg-player-surface-2">
        {v.photo_urls?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.photo_urls[0]} alt={v.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div
            className="h-full w-full flex items-center justify-center text-white/90 text-5xl font-extrabold tracking-tight"
            style={{ background: "linear-gradient(135deg,#F2784F,#C8431C)" }}
            aria-hidden="true"
          >
            {v.name.charAt(0).toUpperCase()}
          </div>
        )}
        {v.average_rating != null ? (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 shadow-sm text-[13px] font-bold text-player-ink">
            <span className="text-player-accent" aria-hidden="true">★</span>
            {v.average_rating.toFixed(1)}
            {v.review_count > 0 ? <span className="font-medium text-player-ink-faint">({v.review_count})</span> : null}
          </span>
        ) : null}
        {v.sports.length > 0 ? (
          <span className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-player-ink/80 backdrop-blur-sm text-[12px] font-semibold text-white capitalize">
            {v.sports.join(" · ")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-5 flex-1">
        <div className="flex flex-col gap-1">
          <h3 className="font-extrabold text-[18px] leading-snug tracking-tight text-player-ink group-hover:text-player-accent-hover transition-colors">{v.name}</h3>
          {place ? (
            <p className="inline-flex items-center gap-1.5 text-[13.5px] text-player-ink-faint">
              <PinIcon />
              {place}
            </p>
          ) : null}
        </div>

        <AmenityBadges amenities={v.amenities} max={2} />

        <div className="mt-auto pt-3 border-t border-player-border-light flex items-end justify-between gap-3">
          {v.min_price != null ? (
            <p className="flex flex-col leading-tight" data-testid="from-price">
              <span className="text-[11.5px] font-bold tracking-wider text-player-ink-fainter uppercase">From</span>
              <span className="text-[17px] font-bold text-player-ink">
                PKR <span className="font-mono">{formatPKR(v.min_price)}</span>
                <span className="text-[12.5px] font-medium text-player-ink-faint"> / slot</span>
              </span>
            </p>
          ) : (
            <span className="text-[13px] text-player-ink-faint">Price on request</span>
          )}
          <span className="inline-flex items-center gap-1 text-[13.5px] font-bold text-player-accent-hover transition-transform group-hover:translate-x-0.5">
            View <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Placeholder shown by app/search/loading.tsx while the list loads. */
export function VenueCardSkeleton() {
  return (
    <div className="bg-player-surface border border-player-border-light rounded-2xl overflow-hidden animate-pulse" aria-hidden="true">
      <div className="h-44 bg-player-surface-2" />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-5 w-2/3 rounded bg-player-surface-2" />
        <div className="h-4 w-1/3 rounded bg-player-surface-2" />
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-md bg-player-surface-2" />
          <div className="h-6 w-16 rounded-md bg-player-surface-2" />
        </div>
        <div className="h-px bg-player-border-light mt-2" />
        <div className="h-5 w-1/2 rounded bg-player-surface-2" />
      </div>
    </div>
  );
}
