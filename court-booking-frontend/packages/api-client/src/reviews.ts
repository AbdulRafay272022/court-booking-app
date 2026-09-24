import type { CreateReviewInput, Review, UpdateReviewInput } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createReviewsApi(client: ApiClient) {
  return {
    create: (input: CreateReviewInput) =>
      client.request<Review>("/reviews", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /** Section 32 Part 6: edit own review within 7 days of posting. */
    edit: (reviewId: string, input: UpdateReviewInput) =>
      client.request<Review>(`/reviews/${reviewId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    listForVenue: (venueId: string) => client.request<Review[]>(`/venues/${venueId}/reviews`),

    /** Section 32 Part 6: the player's own reviews (to map booking_id -> review in My Bookings). */
    mine: () => client.request<Review[]>("/reviews/mine"),

    reply: (reviewId: string, ownerReply: string) =>
      client.request<Review>(`/reviews/${reviewId}/reply`, {
        method: "POST",
        body: JSON.stringify({ owner_reply: ownerReply }),
      }),
  };
}
