"use client";

import type { VenueSummary } from "@court-booking/types";
import { venueCardData } from "@court-booking/ui-tokens";
import { VenueCard as FlVenueCard, SkeletonCard } from "@/components/fl";
import { useFavoriteToggle } from "@/components/favorite-button";
import { rememberSearch } from "@/components/venue/back-to-results";

/**
 * One venue in a list (/search results, Saved venues): the shared Floodlight VenueCard (VenueCard.dc.html frame C) fed from the
 * list response only (no per-venue requests). Photos auto-advance only while the card is on screen, the heart saves the venue, and
 * the single "Amenities [n]" chip opens the full list. `sport` is the sport the player searched for (the photo chip shows it).
 * Opening the venue from /search remembers the search URL for the venue page's "Back to results".
 */
export function VenueCard({ venue, href, sport, eager }: { venue: VenueSummary; href: string; sport?: string | null; eager?: boolean }) {
  const fav = useFavoriteToggle(venue.id);
  return (
    <div
      data-testid="venue-card"
      className="flex flex-col"
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a && a.getAttribute("href") === href) rememberSearch(venue.slug);
      }}
    >
      <FlVenueCard
        venue={venueCardData(venue, { sport })}
        href={href}
        eager={eager}
        saved={fav.saved}
        onToggleSave={fav.visible ? () => void fav.toggle() : undefined}
      />
    </div>
  );
}

/** Placeholder shown by app/search/loading.tsx while the list loads. */
export function VenueCardSkeleton() {
  return <SkeletonCard />;
}
