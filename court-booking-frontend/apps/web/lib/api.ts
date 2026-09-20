import { createCourtBookingApi } from "@court-booking/api-client";
import { API_BASE_URL } from "./config";
import { getAuthState, useAuthStore } from "./auth-store";

export const api = createCourtBookingApi({
  baseUrl: API_BASE_URL,
  getToken: async () => getAuthState().token,
  onTokenRefreshed: async (token, expiresAt) => {
    useAuthStore.getState().setToken(token, expiresAt);
  },
  onUnauthorized: async () => {
    useAuthStore.getState().signOut();
  },
});
