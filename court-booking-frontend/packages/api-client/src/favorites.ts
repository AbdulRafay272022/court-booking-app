import type { VenueSummary } from "@court-booking/types";
import type { ApiClient } from "./client";

/** A player's saved venues. Save and remove are idempotent (204 either way); a venue that is not live is a 404 VENUE_NOT_FOUND. */
export function createFavoritesApi(client: ApiClient) {
  return {
    /** The signed-in user's saved venues as search cards, most recently saved first (at most 100). */
    list: () => client.request<VenueSummary[]>("/users/me/favorites"),

    add: (venueId: string) => client.request<void>(`/venues/${venueId}/favorite`, { method: "PUT" }),

    remove: (venueId: string) => client.request<void>(`/venues/${venueId}/favorite`, { method: "DELETE" }),
  };
}
