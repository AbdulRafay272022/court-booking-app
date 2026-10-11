import type { PublicStats } from "@court-booking/types";
import type { ApiClient } from "./client";

/** Public, unauthenticated read-only endpoints. */
export function createPublicApi(client: ApiClient) {
  return {
    /** Platform counts (venues, courts, bookings, players) for the marketing home page. */
    stats: () => client.request<PublicStats>("/public/stats", {}, { skipAuth: true }),
  };
}
