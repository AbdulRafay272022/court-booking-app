import type { BookingQuote, CourtAvailability, RangeAvailability, VenueAvailability } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createAvailabilityApi(client: ApiClient) {
  return {
    forCourtOnDate: (courtId: string, date: string) =>
      client.request<CourtAvailability>(`/courts/${courtId}/availability?date=${date}`),

    forCourtRange: (courtId: string, startDate: string, endDate: string) =>
      client.request<RangeAvailability>(
        `/courts/${courtId}/availability?start_date=${startDate}&end_date=${endDate}`,
      ),

    forVenueOnDate: (venueId: string, date: string) =>
      client.request<VenueAvailability>(`/venues/${venueId}/availability?date=${date}`),

    /** What a booking of `slotCount` consecutive slots from `startsAt` costs (Section 32 Part 4). */
    quote: (courtId: string, startsAt: string, slotCount: number) =>
      client.request<BookingQuote>(
        `/courts/${courtId}/quote?starts_at=${encodeURIComponent(startsAt)}&slot_count=${slotCount}`,
      ),
  };
}
