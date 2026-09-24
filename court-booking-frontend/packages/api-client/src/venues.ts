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

    // native passes a `uri` string; web passes a real File/Blob (Section 32 Part 6).
    uploadPhoto: (venueId: string, file: string | Blob, fileName = "photo.jpg", mimeType = "image/jpeg") => {
      const formData = new FormData();
      if (typeof file === "string") {
        formData.append("file", { uri: file, name: fileName, type: mimeType } as unknown as Blob);
      } else {
        formData.append("file", file, fileName);
      }
      return client.request<Venue>(`/venues/${venueId}/photos`, { method: "POST", body: formData });
    },

    /** Section 32 Part 6: reorder / delete / set-cover -- send the desired ordered list of
     * this venue's own photo keys (index 0 = cover; an omitted key is deleted). */
    reorderPhotos: (venueId: string, keys: string[]) =>
      client.request<Venue>(`/venues/${venueId}/photos`, {
        method: "PUT",
        body: JSON.stringify({ photos: keys }),
      }),

    deactivate: (venueId: string) =>
      client.request<void>(`/venues/${venueId}`, { method: "DELETE" }),

    announce: (venueId: string, message: string) =>
      client.request<{ sent_count: number }>(`/venues/${venueId}/announcements`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
  };
}
