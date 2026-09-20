import Constants from "expo-constants";

/**
 * Resolution order: EXPO_PUBLIC_API_BASE_URL env var (set per-machine, e.g. for
 * Android emulator use http://10.0.2.2:8000, for a physical device use your
 * machine's LAN IP) > app.json's expo.extra.apiBaseUrl > localhost fallback.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:8000";

/** The web app's public origin -- used to link out to pages that only exist there (Terms,
 * Privacy) rather than duplicating that content natively. Same resolution order as
 * API_BASE_URL above. */
export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL ??
  (Constants.expoConfig?.extra?.webBaseUrl as string | undefined) ??
  "http://localhost:3100";
