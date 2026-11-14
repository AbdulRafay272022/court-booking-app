import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_APK_URL, resolveApkUrl } from "./apk-url";

test("/app redirects to APK_URL when it is an https link, else to the fixed S3 latest-APK file", () => {
  assert.equal(resolveApkUrl({}), DEFAULT_APK_URL);
  assert.equal(resolveApkUrl({ APK_URL: "  " }), DEFAULT_APK_URL);
  assert.equal(resolveApkUrl({ APK_URL: "http://insecure.example/k.apk" }), DEFAULT_APK_URL);
  assert.equal(resolveApkUrl({ APK_URL: "https://cdn.example/khelo-2026-11-20.apk" }), "https://cdn.example/khelo-2026-11-20.apk");
  assert.ok(DEFAULT_APK_URL.endsWith("/app/khelo-latest.apk") && DEFAULT_APK_URL.startsWith("https://"));
});
