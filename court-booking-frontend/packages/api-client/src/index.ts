import { type ApiClientConfig, createApiClient } from "./client";
import { createAdminApi } from "./admin";
import { createAuthApi } from "./auth";
import { createAvailabilityApi } from "./availability";
import { createBookingsApi } from "./bookings";
import { createChatApi } from "./chat";
import { createCourtsApi } from "./courts";
import { createFeatureFlagsApi } from "./feature-flags";
import { createOwnersApi } from "./owners";
import { createStaffApi } from "./staff";
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
export * from "./feature-flags";
export * from "./staff";
export * from "./users";
export * from "./session";
export * from "./venue-draft";

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
    featureFlags: createFeatureFlagsApi(client),
    staff: createStaffApi(client),
    users: createUsersApi(client),
  };
}

export type CourtBookingApi = ReturnType<typeof createCourtBookingApi>;
