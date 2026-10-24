import test from "node:test";
import assert from "node:assert/strict";
import type { BookingStatus } from "@court-booking/types";

import { doneCopy, donePollMs } from "./booking-done";

const ALL: BookingStatus[] = ["held", "payment_submitted", "booked", "completed", "no_show", "cancelled"];

test("doneCopy: only a booked booking says the court is yours / confirmed by the venue", () => {
  for (const s of ALL) {
    const c = doneCopy(s);
    const saysConfirmed = c.title === "Court is yours" || /confirmed by the venue/i.test(c.subtitle);
    assert.equal(saysConfirmed, s === "booked", `status ${s}`);
  }
});

test("doneCopy: payment_submitted waits for the owner, held sends the player back to pay", () => {
  const sub = doneCopy("payment_submitted");
  assert.equal(sub.title, "Payment bheji gayi");
  assert.match(sub.subtitle, /owner approval ka intezar/i);
  assert.equal(sub.tone, "waiting");
  assert.equal(sub.action, "bookings");
  const held = doneCopy("held");
  assert.equal(held.tone, "waiting");
  assert.equal(held.action, "pay");
});

test("doneCopy: every status has a title, subtitle and button label; cancellations say who", () => {
  for (const s of ALL) {
    const c = doneCopy(s);
    assert.ok(c.title && c.subtitle && c.actionLabel, `status ${s}`);
  }
  assert.equal(doneCopy("cancelled", "system").title, "Hold expired");
  assert.match(doneCopy("cancelled", "owner").subtitle, /venue cancelled/);
  assert.match(doneCopy("cancelled", "player").subtitle, /You cancelled/);
  assert.equal(doneCopy("no_show").tone, "ended");
  assert.equal(doneCopy("completed").tone, "confirmed");
});

test("donePollMs: polls only while the venue or the player still has to act", () => {
  assert.equal(donePollMs("payment_submitted"), 5000);
  assert.equal(donePollMs("held"), 5000);
  for (const s of ["booked", "completed", "no_show", "cancelled"] as const) assert.equal(donePollMs(s), false);
  assert.equal(donePollMs(undefined), false);
});
