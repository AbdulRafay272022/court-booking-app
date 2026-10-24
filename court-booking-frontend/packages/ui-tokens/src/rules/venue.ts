import type { VenueSummary } from "@court-booking/types";
import { formatPkr } from "./format";

/** Data the shared VenueCard renders (mobile + web). Everything optional is hidden when absent; nothing is invented. */
export interface VenueCardData {
  id: string;
  slug: string;
  name: string;
  /** One sport label for the photo chip (search sport, else the venue's first sport). */
  sport: string | null;
  /** area ?? city. */
  area: string | null;
  /** "1.2 km" / "800 m", or null without a location. */
  distance: string | null;
  /** Shown only with at least one review. */
  rating: number | null;
  reviewCount: number;
  /** "PKR 2,000" or null ("no price yet", never 0). */
  priceFrom: string | null;
  /** e.g. "Agla khaali 8 PM". The list API has no next-free TIME (contract B-dependency), so callers usually pass null. */
  nextFree: string | null;
  photos: string[];
  amenities: string[];
}

export function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.max(1, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : String(Math.round(km))} km`;
}

/** Map a GET /venues or /users/me/favorites item to card data per docs/venue-card-contract.md "Props mapping". */
export function venueCardData(v: VenueSummary, opts: { sport?: string | null; nextFree?: string | null } = {}): VenueCardData {
  const wanted = opts.sport?.toLowerCase();
  const sport = (wanted && v.sports.find((s) => s.toLowerCase() === wanted)) || v.sports[0] || null;
  const reviews = v.review_count ?? 0;
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    sport,
    area: v.area ?? v.city ?? null,
    distance: formatDistance(v.distance_meters),
    rating: reviews > 0 && v.average_rating != null ? v.average_rating : null,
    reviewCount: reviews,
    priceFrom: v.min_price != null ? formatPkr(v.min_price) : null,
    nextFree: opts.nextFree ?? null,
    photos: v.photo_urls ?? [],
    amenities: v.amenities ?? [],
  };
}

/** Stable fallback colour index (0..3) for a photo-less card, from the venue id. */
export function placeholderIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 4;
}
