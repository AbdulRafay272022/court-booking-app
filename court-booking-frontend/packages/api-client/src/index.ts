import { type ApiClientConfig, createApiClient } from "./client";
import { createAdminApi } from "./admin";
import { createAuthApi } from "./auth";
import { createAvailabilityApi } from "./availability";
import { createBookingsApi } from "./bookings";
import { createChatApi } from "./chat";
import { createCourtsApi } from "./courts";
import { createOwnersApi } from "./owners";
import { createPaymentsApi } from "./payments";
import { createReviewsApi } from "./reviews";
import { createUsersApi } from "./users";
import { createVenuesApi } from "./venues";
import { createWaitlistApi } from "./waitlist";

export * from "./client";
export * from "./auth";
export * from "./venues";
export * from "./courts";
export * from "./availability";
export * from "./bookings";
export * from "./payments";
export * from "./waitlist";
export * from "./chat";
export * from "./reviews";
export * from "./owners";
export * from "./admin";
export * from "./users";

export function createCourtBookingApi(config: ApiClientConfig) {
  const client = createApiClient(config);
  return {
    client,
    auth: createAuthApi(client),
    venues: createVenuesApi(client),
    courts: createCourtsApi(client),
    availability: createAvailabilityApi(client),
    bookings: createBookingsApi(client),
    payments: createPaymentsApi(client),
    waitlist: createWaitlistApi(client),
    chat: createChatApi(client),
    reviews: createReviewsApi(client),
    owners: createOwnersApi(client),
    admin: createAdminApi(client),
    users: createUsersApi(client),
  };
}

export type CourtBookingApi = ReturnType<typeof createCourtBookingApi>;
