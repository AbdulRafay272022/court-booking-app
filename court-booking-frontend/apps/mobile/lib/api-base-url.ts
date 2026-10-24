/**
 * Pure API base URL resolution (no RN imports, unit-tested in api-base-url.test.ts).
 *
 * Order: EXPO_PUBLIC_API_BASE_URL (per machine / per EAS profile) > app.json extra.apiBaseUrl >
 * localhost. One exception: a DEV bundle (__DEV__, i.e. Metro / a dev-client build) never falls
 * through to app.json's extra.apiBaseUrl, because that is the PRODUCTION API. Without the env var a
 * dev bundle talks to localhost instead. Release builds (preview / production) are unchanged.
 */
export const LOCAL_API_FALLBACK = "http://localhost:8000";

export function resolveApiBaseUrl(opts: {
  envUrl: string | undefined;
  extraUrl: string | undefined;
  isDev: boolean;
}): string {
  if (opts.envUrl) return opts.envUrl;
  if (opts.isDev) return LOCAL_API_FALLBACK;
  return opts.extraUrl ?? LOCAL_API_FALLBACK;
}
