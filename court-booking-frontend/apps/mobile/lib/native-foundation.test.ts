import test from "node:test";
import assert from "node:assert/strict";

import { sentryEnabled, sentryEnvironment } from "./sentry-rules";
import { LOCAL_API_FALLBACK, resolveApiBaseUrl } from "./api-base-url";

test("sentryEnabled: off without a DSN, off for a blank DSN, off on web", () => {
  assert.equal(sentryEnabled(undefined, "android"), false);
  assert.equal(sentryEnabled(null, "ios"), false);
  assert.equal(sentryEnabled("", "android"), false);
  assert.equal(sentryEnabled("   ", "android"), false);
  assert.equal(sentryEnabled("https://key@o0.ingest.sentry.io/1", "web"), false);
});

test("sentryEnabled: on for native with a DSN", () => {
  assert.equal(sentryEnabled("https://key@o0.ingest.sentry.io/1", "android"), true);
  assert.equal(sentryEnabled("https://key@o0.ingest.sentry.io/1", "ios"), true);
});

test("sentryEnvironment: development in dev, else channel, else production", () => {
  assert.equal(sentryEnvironment("preview", true), "development");
  assert.equal(sentryEnvironment("preview", false), "preview");
  assert.equal(sentryEnvironment(undefined, false), "production");
  assert.equal(sentryEnvironment(" ", false), "production");
});

test("resolveApiBaseUrl: env var always wins", () => {
  assert.equal(resolveApiBaseUrl({ envUrl: "http://10.0.2.2:8000", extraUrl: "https://prod", isDev: true }), "http://10.0.2.2:8000");
  assert.equal(resolveApiBaseUrl({ envUrl: "http://x", extraUrl: "https://prod", isDev: false }), "http://x");
});

test("resolveApiBaseUrl: a dev bundle never falls through to app.json's (production) URL", () => {
  assert.equal(resolveApiBaseUrl({ envUrl: undefined, extraUrl: "https://prod", isDev: true }), LOCAL_API_FALLBACK);
});

test("resolveApiBaseUrl: release builds keep app.json's URL (unchanged behaviour)", () => {
  assert.equal(resolveApiBaseUrl({ envUrl: undefined, extraUrl: "https://prod", isDev: false }), "https://prod");
  assert.equal(resolveApiBaseUrl({ envUrl: undefined, extraUrl: undefined, isDev: false }), LOCAL_API_FALLBACK);
});
