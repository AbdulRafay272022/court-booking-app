import { API_BASE_URL } from "./config";
import type { Venue, VenueListResponse, VenueAvailability } from "@court-booking/types";
import type { ListVenuesParams } from "@court-booking/api-client";

/** For Server Components rendering PUBLIC data only (no auth) -- deliberately
 * separate from lib/api.ts, which reads the client-side auth store. That store is a
 * module-level singleton; reusing it here would leak one user's token across
 * concurrent requests from different users in the same Node server process. */
const API_PREFIX = "/api/v1";

async function publicFetch<T>(path: string, revalidate = 30): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Request to ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const serverApi = {
  listVenues: (params: ListVenuesParams) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) usp.set(k, String(v));
    // An availability search (date/time) must reflect bookings made moments ago, so it skips the 30s cache.
    return publicFetch<VenueListResponse>(`/venues?${usp.toString()}`, params.date ? 0 : 30);
  },
  areas: () => publicFetch<{ areas: string[] }>("/venues/areas", 60),
  getVenueBySlug: (slug: string) => publicFetch<Venue>(`/venues/by-slug/${slug}`, 15),
  getVenueAvailability: (venueId: string, date: string) =>
    publicFetch<VenueAvailability>(`/venues/${venueId}/availability?date=${date}`, 15),
};
