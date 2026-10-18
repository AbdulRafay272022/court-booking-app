import assert from "node:assert/strict";
import { test } from "node:test";

import { CHANNEL_HEADING, bookingChannelKey, bookingChannelLabel } from "./owner";

test("channel labels per the spec (A4)", () => {
  assert.equal(bookingChannelLabel("whatsapp", null, "ru"), "WhatsApp chat");
  assert.equal(bookingChannelLabel("app", null, "ru"), "App ya website");
  assert.equal(bookingChannelLabel("app", null, "en"), "App or website");
  assert.equal(bookingChannelLabel("walkin", "owner", "ru"), "Owner ne khud add ki (walk-in)");
  assert.equal(bookingChannelLabel("walkin", "staff", "ru"), "Staff ne add ki");
  assert.equal(bookingChannelLabel("walkin", null, "ru"), "Walk-in");
  assert.equal(bookingChannelLabel("walkin", "someone_else", "en"), "Walk-in");
  assert.equal(bookingChannelLabel("phone", null, "ru"), "Phone");
  assert.equal(bookingChannelLabel("carrier_pigeon", null, "ru"), null);
  assert.equal(bookingChannelLabel(null), null);
  assert.equal(CHANNEL_HEADING.ru, "Zariya (booking kahan se shuru hui)");
  assert.equal(CHANNEL_HEADING.en, "Channel (where the booking started)");
});

test("never 'App chat': the app source covers the website too", () => {
  for (const lang of ["ru", "en"] as const) assert.doesNotMatch(bookingChannelLabel("app", null, lang) ?? "", /app chat/i);
  assert.equal(bookingChannelKey("walkin", "staff"), "walkin_staff");
});
