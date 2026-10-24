import type { ComponentType } from "react";
import { Platform } from "react-native";
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";

import { sentryEnabled, sentryEnvironment } from "./sentry-rules";

/**
 * Crash reporting. OFF unless EXPO_PUBLIC_SENTRY_DSN is set (inlined at bundle time from the
 * shell / the EAS build profile env). The DSN is never logged. With no DSN, nothing is
 * initialised and the root component is returned unwrapped, so the app behaves exactly as
 * before. Web uses lib/sentry.web.ts (always a no-op).
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const SENTRY_ENABLED = sentryEnabled(DSN, Platform.OS);

let initialised = false;

export function initSentry(): void {
  if (!SENTRY_ENABLED || initialised) return;
  initialised = true;
  Sentry.init({
    dsn: DSN,
    environment: sentryEnvironment(Updates.channel, typeof __DEV__ !== "undefined" && __DEV__),
    // Errors only for now; no performance tracing, no session replay, no PII.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

/** Wraps the root component only when Sentry is on; otherwise returns it untouched. */
export function wrapRoot<P extends Record<string, unknown>>(Component: ComponentType<P>): ComponentType<P> {
  return SENTRY_ENABLED ? (Sentry.wrap(Component) as ComponentType<P>) : Component;
}
