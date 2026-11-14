import test from "node:test";
import assert from "node:assert/strict";

import { hasUpdateUrl, updateAction } from "./update-action";

test("Update karein: a release build with updates on takes the OTA update, anything else opens the store page", () => {
  assert.equal(updateAction({ isDev: false, updatesEnabled: true }), "ota");
  assert.equal(updateAction({ isDev: true, updatesEnabled: true }), "store");
  assert.equal(updateAction({ isDev: false, updatesEnabled: false }), "store");
});

test("the latest-APK link is used only when it is a real https link, never the placeholder", () => {
  assert.equal(hasUpdateUrl("https://REPLACE-WITH-LATEST-APK-LINK"), false);
  assert.equal(hasUpdateUrl(""), false);
  assert.equal(hasUpdateUrl("http://example.com/khelo.apk"), false);
  assert.equal(hasUpdateUrl("https://khelo.example/app"), true);
});
