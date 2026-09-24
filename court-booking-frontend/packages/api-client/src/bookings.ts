import type {
  Booking,
  HoldBookingInput,
  HoldBookingOut,
  PaymentProofOut,
  WalkinBookingInput,
} from "@court-booking/types";
import type { ApiClient } from "./client";

export function createBookingsApi(client: ApiClient) {
  return {
    hold: (input: HoldBookingInput) =>
      client.request<HoldBookingOut>("/bookings/hold", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    walkin: (input: WalkinBookingInput) =>
      client.request<{ booking: Booking }>("/bookings/walkin", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    mine: (status: "upcoming" | "past" | "all" = "all", page = 1, pageSize = 20) =>
      client.request<Booking[]>(`/bookings/mine?status=${status}&page=${page}&page_size=${pageSize}`),

    get: (id: string) => client.request<Booking>(`/bookings/${id}`),

    cancel: (id: string, reason?: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    checkin: (id: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/checkin`, { method: "POST" }),

    /** Section 32 Part 9: player scans the venue's printed QR (its token) to check
     * themselves in, as an alternative to the owner scanning their booking's QR. */
    checkinSelf: (id: string, venueQrToken: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/checkin/self`, {
        method: "POST",
        body: JSON.stringify({ venue_qr_token: venueQrToken }),
      }),

    /** Section 32 Part 9: manual counterpart to the automatic no-show job -- the server
     * refuses (`TOO_EARLY_FOR_NO_SHOW`) until the same grace window the job uses has passed. */
    noShow: (id: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/no-show`, { method: "POST" }),

    /** `file` is a real Blob/File on web (from an `<input type="file">` or an
     * expo-image-picker asset's `.file`); on native, pass the asset's `uri` string --
     * React Native's FormData recognizes a plain `{uri, name, type}` descriptor there,
     * which a real Blob object can't represent. */
    /** `onProgress` (0-1) drives an upload progress bar (Section 12) — a 3MB screenshot
     * over 3G can take a while, and a bare spinner doesn't show it's actually moving. */
    submitPaymentProof: (
      bookingId: string,
      file: string | Blob,
      fileName = "proof.jpg",
      mimeType = "image/jpeg",
      onProgress?: (fraction: number) => void,
    ) => {
      const formData = new FormData();
      const part = typeof file === "string" ? ({ uri: file, name: fileName, type: mimeType } as unknown as Blob) : file;
      formData.append("image", part, fileName);
      return client.requestUpload<PaymentProofOut>(`/bookings/${bookingId}/payment-proof`, formData, onProgress);
    },
  };
}
