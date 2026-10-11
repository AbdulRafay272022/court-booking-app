import type { VenueSummary } from "@court-booking/types";

/** One pin on the Search map. */
export interface MapVenue {
  id: string;
  name: string;
  href: string;
  lat: number;
  lng: number;
  minPrice: number | null;
}

/** Share of the page's venues that must have coordinates before the List/Map toggle is offered. */
export const MAP_MIN_SHARE = 0.7;

/** The venues that can be pinned, and whether enough of them can for the map to be worth offering (min 1 venue). */
export function mapVenuesFor(venues: VenueSummary[], hrefFor: (v: VenueSummary) => string): { pins: MapVenue[]; offerMap: boolean } {
  const pins: MapVenue[] = [];
  for (const v of venues) {
    if (typeof v.latitude === "number" && typeof v.longitude === "number" && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) {
      pins.push({ id: v.id, name: v.name, href: hrefFor(v), lat: v.latitude, lng: v.longitude, minPrice: v.min_price });
    }
  }
  return { pins, offerMap: venues.length >= 1 && pins.length / venues.length >= MAP_MIN_SHARE };
}
