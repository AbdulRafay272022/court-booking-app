import test from "node:test";
import assert from "node:assert/strict";

import { updateAction } from "./update-action";

test("Update karein: a release build with updates on takes the OTA update, anything else opens the store page", () => {
  assert.equal(updateAction({ isDev: false, updatesEnabled: true }), "ota");
  assert.equal(updateAction({ isDev: true, updatesEnabled: true }), "store");
  assert.equal(updateAction({ isDev: false, updatesEnabled: false }), "store");
});
