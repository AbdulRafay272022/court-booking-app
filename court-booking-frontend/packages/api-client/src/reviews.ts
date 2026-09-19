import type { CreateReviewInput, Review } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createReviewsApi(client: ApiClient) {
  return {
    create: (input: CreateReviewInput) =>
      client.request<Review>("/reviews", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listForVenue: (venueId: string) => client.request<Review[]>(`/venues/${venueId}/reviews`),

    reply: (reviewId: string, ownerReply: string) =>
      client.request<Review>(`/reviews/${reviewId}/reply`, {
        method: "POST",
        body: JSON.stringify({ owner_reply: ownerReply }),
      }),
  };
}
