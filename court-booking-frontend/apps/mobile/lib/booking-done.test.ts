import test from "node:test";
import assert from "node:assert/strict";
import type { BookingStatus } from "@court-booking/types";

import { bookingShortCode, calendarLink, doneCopy, donePollMs, doneView, ticketTimeRange } from "./booking-done";

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

test("bookingShortCode matches the backend short_code", () => {
  assert.equal(bookingShortCode("3b9a41d7-1111-2222-3333-444455556666"), "KH-3B9A41D7");
});

test("doneView: already pakki opens the ticket; turning pakki on screen (or celebrate) shows the celebration", () => {
  assert.equal(doneView("booked", "booked", false), "ticket");
  assert.equal(doneView("completed", "completed", false), "ticket");
  assert.equal(doneView("payment_submitted", "booked", false), "status");
  assert.equal(doneView("booked", "booked", true), "status");
  assert.equal(doneView("held", "held", false), "status");
  assert.equal(doneView("booked", "cancelled", false), "status");
});

test("calendarLink: UTC stamps and encoded title", () => {
  const url = calendarLink("Padel · Demo Arena", "2026-10-24T14:00:00Z", "2026-10-24T15:00:00Z", "Clifton");
  assert.match(url, /dates=20261024T140000Z\/20261024T150000Z/);
  assert.match(url, /text=Padel%20%C2%B7%20Demo%20Arena/);
  assert.match(url, /location=Clifton/);
});

test("ticketTimeRange: one AM/PM when shared, both when not", () => {
  assert.equal(ticketTimeRange("2026-10-24T14:00:00Z", "2026-10-24T15:00:00Z"), "7:00 – 8:00 PM");
  assert.equal(ticketTimeRange("2026-10-24T06:00:00Z", "2026-10-24T08:00:00Z"), "11:00 AM – 1:00 PM");
  assert.equal(ticketTimeRange("2026-10-24T18:00:00Z", "2026-10-24T19:00:00Z"), "11:00 PM – 12:00 AM");
});
