import type { ComponentType } from "react";

/** Web build of the mobile app (local QA only): Sentry is never loaded. See lib/sentry.ts. */
export const SENTRY_ENABLED = false;

export function initSentry(): void {}

export function wrapRoot<P extends Record<string, unknown>>(Component: ComponentType<P>): ComponentType<P> {
  return Component;
}
