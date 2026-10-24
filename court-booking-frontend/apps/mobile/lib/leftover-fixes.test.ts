import test from "node:test";
import assert from "node:assert/strict";
import type { StaffPermissionKey } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { DONE_TONE_COLORS, donePaidAmount } from "./booking-done";
import { contrastRatio } from "./contrast";
import { SERVER_ERROR_MESSAGE, friendlyErrorMessage } from "./error-messages";
import { duplicateChipCount, duplicateUsedText } from "./overview";
import { VENUE_SETTINGS_READ_ONLY_NOTE, venueSettingsAccess } from "./owner-access";
import { PLAYER_BOOKINGS_HREF, PLAYER_HOME_HREF, safeBackAction } from "./safe-back-rules";

const staffWith = (...keys: StaffPermissionKey[]) => (k: StaffPermissionKey) => keys.includes(k);

// ---- 1. Venue settings per-section access ----
test("venueSettingsAccess: owners edit everything, no note", () => {
  assert.deepEqual(venueSettingsAccess(() => true, false), { venue: true, courts: true, photos: true, readOnly: false, note: null });
});

test("venueSettingsAccess: view_ledger staff see everything read-only with the owner note", () => {
  const a = venueSettingsAccess(staffWith("view_ledger"), true);
  assert.equal(a.readOnly, true);
  assert.equal(a.venue || a.courts || a.photos, false);
  assert.equal(a.note, VENUE_SETTINGS_READ_ONLY_NOTE);
  assert.match(a.note!, /^Sirf dekh sakte hain/);
});

test("venueSettingsAccess: staff keys open only their own sections; venue basics stay owner-only", () => {
  const courts = venueSettingsAccess(staffWith("edit_court_settings"), true);
  assert.deepEqual([courts.venue, courts.courts, courts.photos, courts.readOnly], [false, true, false, false]);
  assert.ok(courts.note);
  const photos = venueSettingsAccess(staffWith("manage_photos", "view_ledger"), true);
  assert.deepEqual([photos.venue, photos.courts, photos.photos, photos.readOnly], [false, false, true, false]);
  const both = venueSettingsAccess(staffWith("edit_court_settings", "manage_photos"), true);
  assert.deepEqual([both.venue, both.courts, both.photos], [false, true, true]);
});

// ---- 2. Safe back ----
test("safeBackAction: back when there is history, else replace with the fallback", () => {
  assert.deepEqual(safeBackAction(true, PLAYER_BOOKINGS_HREF), { kind: "back" });
  assert.deepEqual(safeBackAction(false, PLAYER_BOOKINGS_HREF), { kind: "replace", href: "/bookings" });
  assert.deepEqual(safeBackAction(false, PLAYER_HOME_HREF), { kind: "replace", href: "/" });
});

// ---- 3. Done screen spinner + paid line ----
test("contrastRatio: known WCAG values", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF") * 10) / 10, 21);
  assert.equal(contrastRatio("#777", "#777"), 1);
  assert.ok(Math.abs(contrastRatio("#767676", "#FFFFFF") - 4.54) < 0.01);
});

test("done screen: the waiting spinner is clearly visible (>= 3:1) on every tone", () => {
  for (const [tone, c] of Object.entries(DONE_TONE_COLORS)) {
    assert.ok(contrastRatio(c.spinner, c.bg) >= 3, `${tone}: ${contrastRatio(c.spinner, c.bg).toFixed(2)}`);
  }
});

test("donePaidAmount: only real recorded money, never PKR 0", () => {
  assert.equal(donePaidAmount({ amount_paid: 0 }), null);
  assert.equal(donePaidAmount({ amount_paid: null }), null);
  assert.equal(donePaidAmount({ amount_paid: undefined }), null);
  assert.equal(donePaidAmount({ amount_paid: 1500 }), 1500);
});

// ---- 4. Duplicate chip ----
test("duplicateChipCount: hidden for no signal or 0, the count otherwise", () => {
  assert.equal(duplicateChipCount(null), null);
  assert.equal(duplicateChipCount(undefined), null);
  assert.equal(duplicateChipCount({ used_on_bookings: 0 }), null);
  assert.equal(duplicateChipCount({ used_on_bookings: 1 }), 1);
  assert.equal(duplicateChipCount({ used_on_bookings: 3 }), 3);
});

test("duplicateUsedText: singular / plural, and no '0 bookings'", () => {
  assert.equal(duplicateUsedText(1), "Ye screenshot pehle bhi 1 booking par use hua hai");
  assert.equal(duplicateUsedText(2), "Ye screenshot pehle bhi 2 bookings par use hua hai");
  assert.doesNotMatch(duplicateUsedText(0), /\b0\b/);
});

// ---- 5. Raw 5xx text ----
test("friendlyErrorMessage: an unknown 5xx never shows the server's raw text", () => {
  assert.equal(friendlyErrorMessage(new ApiError("INTERNAL_ERROR", "Internal server error", 500)), SERVER_ERROR_MESSAGE);
  assert.equal(friendlyErrorMessage(new ApiError("SOMETHING", "Bad gateway", 502)), SERVER_ERROR_MESSAGE);
  // known codes keep their own message, 4xx unknown codes keep the old behaviour
  assert.match(friendlyErrorMessage(new ApiError("NOT_STAFF_PERMITTED", "x", 403)), /^Aap ke paas/);
  assert.equal(friendlyErrorMessage(new ApiError("NEW_CODE", "Server says", 400)), "Server says");
});
