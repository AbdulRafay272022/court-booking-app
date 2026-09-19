import type { CreateVenueInput, Venue, VenueListResponse } from "@court-booking/types";
import type { ApiClient } from "./client";
import { toQuery } from "./util";

export interface ListVenuesParams {
  city?: string;
  sport?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  page?: number;
  per_page?: number;
}

export function createVenuesApi(client: ApiClient) {
  return {
    list: (params: ListVenuesParams = {}) =>
      client.request<VenueListResponse>(`/venues${toQuery(params)}`),

    get: (venueId: string) => client.request<Venue>(`/venues/${venueId}`),

    getBySlug: (slug: string) => client.request<Venue>(`/venues/by-slug/${slug}`),

    create: (input: CreateVenueInput) =>
      client.request<{ venue: Venue }>("/venues", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    update: (venueId: string, input: Partial<CreateVenueInput>) =>
      client.request<Venue>(`/venues/${venueId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    uploadPhoto: (venueId: string, fileUri: string, fileName = "photo.jpg", mimeType = "image/jpeg") => {
      const formData = new FormData();
      formData.append("file", { uri: fileUri, name: fileName, type: mimeType } as unknown as Blob);
      return client.request<Venue>(`/venues/${venueId}/photos`, {
        method: "POST",
        body: formData,
      });
    },

    deactivate: (venueId: string) =>
      client.request<void>(`/venues/${venueId}`, { method: "DELETE" }),

    announce: (venueId: string, message: string) =>
      client.request<{ sent_count: number }>(`/venues/${venueId}/announcements`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
  };
}
