import assert from "node:assert/strict";
import test from "node:test";

import { countByGroup, isActiveBooking, nextBooking, startsInText, statusGroup } from "./booking-dashboard";
import type { BookingStatus } from "./booking";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const b = (status: BookingStatus, startH: number, extra: { held_until?: string | null } = {}) => ({
  status,
  starts_at: hours(startH),
  ends_at: hours(startH + 1),
  held_until: extra.held_until ?? null,
});

test("every raw status maps to one player-facing group", () => {
  assert.equal(statusGroup("booked"), "confirmed");
  assert.equal(statusGroup("held"), "pending");
  assert.equal(statusGroup("payment_submitted"), "pending");
  assert.equal(statusGroup("completed"), "completed");
  assert.equal(statusGroup("cancelled"), "cancelled");
  assert.equal(statusGroup("no_show"), "cancelled");
});

test("a hold whose time to pay has run out is not active; a live one is", () => {
  assert.equal(isActiveBooking(b("held", 5, { held_until: hours(-0.1) }), NOW), false);
  assert.equal(isActiveBooking(b("held", 5, { held_until: hours(0.2) }), NOW), true);
  assert.equal(isActiveBooking(b("payment_submitted", 5), NOW), true);
  assert.equal(isActiveBooking(b("cancelled", 5), NOW), false);
  assert.equal(isActiveBooking(b("completed", -5), NOW), false);
});

test("nextBooking picks the soonest active one, whatever the input order", () => {
  const list = [b("booked", 48), b("cancelled", 2), b("held", 5, { held_until: hours(-1) }), b("booked", 24), b("completed", -3)];
  assert.equal(nextBooking(list, NOW)?.starts_at, hours(24));
});

test("nextBooking keeps a booking that is in progress, drops one that has finished, and is null when nothing is left", () => {
  assert.equal(nextBooking([b("booked", -0.5)], NOW)?.starts_at, hours(-0.5));
  assert.equal(nextBooking([b("booked", -3)], NOW), null);
  assert.equal(nextBooking([], NOW), null);
});

test("counts per group", () => {
  const c = countByGroup([b("booked", 1), b("booked", 2), b("held", 3), b("cancelled", 4), b("no_show", 5), b("completed", -1)]);
  assert.deepEqual(c, { all: 6, confirmed: 2, pending: 1, completed: 1, cancelled: 2 });
});

test("starts-in wording", () => {
  const at = (h: number) => b("booked", h);
  assert.equal(startsInText(at(0.4).starts_at, at(0.4).ends_at, NOW), "in 24 min");
  assert.equal(startsInText(at(1).starts_at, at(1).ends_at, NOW), "in 1 hour");
  assert.equal(startsInText(at(5.5).starts_at, at(5.5).ends_at, NOW), "in 5 hours");
  assert.equal(startsInText(at(24).starts_at, at(24).ends_at, NOW), "in 1 day");
  assert.equal(startsInText(at(50).starts_at, at(50).ends_at, NOW), "in 2 days");
  assert.equal(startsInText(at(-0.5).starts_at, at(-0.5).ends_at, NOW), "happening now");
  assert.equal(startsInText(at(-3).starts_at, at(-3).ends_at, NOW), "finished");
});
