import { createCourtBookingApi } from "@court-booking/api-client";
import { API_BASE_URL } from "./config";
import { Platform } from "react-native";
import { getAuthState, useAuthStore } from "./auth-store";
import { APP_LEVEL, useUpgradeStore } from "./app-level";

export const api = createCourtBookingApi({
  baseUrl: API_BASE_URL,
  getToken: async () => getAuthState().token,
  onTokenRefreshed: async (token, expiresAt) => {
    await useAuthStore.getState().setToken(token, expiresAt);
  },
  onUnauthorized: async () => {
    await useAuthStore.getState().signOut();
  },
  // founder 14 Nov: the server blocks an owner/staff app below its minimum level (426) -> "Update karein"
  clientInfo: { platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web", appLevel: APP_LEVEL },
  onUpgradeRequired: () => useUpgradeStore.getState().setRequired(true),
});
