import Constants from "expo-constants";

import { resolveApiBaseUrl } from "./api-base-url";

/**
 * Resolution order: EXPO_PUBLIC_API_BASE_URL env var (set per-machine, e.g. for
 * Android emulator use http://10.0.2.2:8000, for a physical device use your
 * machine's LAN IP; set per EAS build profile in eas.json) > app.json's
 * expo.extra.apiBaseUrl (PRODUCTION) > localhost fallback. A dev bundle (__DEV__) never
 * uses app.json's production URL: without the env var it talks to localhost (see
 * lib/api-base-url.ts). Release builds behave exactly as before.
 */
export const API_BASE_URL = resolveApiBaseUrl({
  envUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  extraUrl: Constants.expoConfig?.extra?.apiBaseUrl as string | undefined,
  isDev: typeof __DEV__ !== "undefined" && __DEV__,
});

/** The web app's public origin -- used to link out to pages that only exist there (Terms,
 * Privacy) rather than duplicating that content natively. Env var > app.json > localhost. */
export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL ??
  (Constants.expoConfig?.extra?.webBaseUrl as string | undefined) ??
  "http://localhost:3100";
