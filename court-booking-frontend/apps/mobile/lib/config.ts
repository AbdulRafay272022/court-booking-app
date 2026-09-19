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
