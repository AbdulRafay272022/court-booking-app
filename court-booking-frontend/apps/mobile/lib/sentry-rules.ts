/**
 * Pure rules for whether Sentry runs (no RN imports, unit-tested in sentry-rules.test.ts).
 *
 * Sentry is OFF unless EXPO_PUBLIC_SENTRY_DSN is set to a non-blank value, and always off on web
 * (the web build of the mobile app is only used for local QA). The DSN is never logged.
 */
export type SentryPlatform = "ios" | "android" | "web" | "windows" | "macos" | string;

export function sentryEnabled(dsn: string | undefined | null, platform: SentryPlatform): boolean {
  if (platform === "web") return false;
  return typeof dsn === "string" && dsn.trim().length > 0;
}

/** Environment tag sent with events: the EAS build profile / update channel when known. */
export function sentryEnvironment(channel: string | undefined | null, isDev: boolean): string {
  if (isDev) return "development";
  return channel && channel.trim() ? channel.trim() : "production";
}
