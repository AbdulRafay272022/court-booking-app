import test from "node:test";
import assert from "node:assert/strict";
import { bookingHeader, ticketQrMode } from "./booking-header";

const NOW = Date.parse("2026-11-08T10:00:00Z");
const future = "2026-11-08T12:00:00Z";
const past = "2026-11-08T09:00:00Z";

test("only held / payment_submitted say 'abhi pakki nahi' and show the QR placeholder", () => {
  for (const status of ["held", "payment_submitted"] as const) {
    const h = bookingHeader({ status, ends_at: future }, { now: NOW, lang: "ru" });
    assert.equal(h.title, "Booking abhi pakki nahi");
    assert.equal(h.qr, "placeholder");
  }
  for (const status of ["booked", "completed", "no_show", "cancelled"] as const) {
    const h = bookingHeader({ status, ends_at: future, cancelled_by: "owner" }, { now: NOW, lang: "ru" });
    assert.notEqual(h.title, "Booking abhi pakki nahi", status);
    assert.notEqual(h.qr, "placeholder", status);
  }
});

test("booked = 'Court aapka hai' + QR; completed = 'Khel ho gaya'; no_show = 'No-show mark hui'", () => {
  assert.deepEqual([bookingHeader({ status: "booked", ends_at: future }, { now: NOW, lang: "ru" }).title, bookingHeader({ status: "booked", ends_at: future }, { now: NOW }).qr], ["Court aapka hai", "show"]);
  const done = bookingHeader({ status: "completed", ends_at: past }, { now: NOW, lang: "ru" });
  assert.equal(done.title, "Khel ho gaya");
  assert.equal(done.qr, "none");
  const ns = bookingHeader({ status: "no_show", ends_at: past }, { now: NOW, lang: "ru" });
  assert.equal(ns.title, "No-show mark hui");
  assert.equal(ns.qr, "none");
});

test("no-show asks 'Aap aaye the? Batayein' only when the player may still reply (noshow_reply flag on)", () => {
  assert.equal(bookingHeader({ status: "no_show", ends_at: past }, { now: NOW, lang: "ru", canReplyNoShow: false }).askNoShow, null);
  assert.equal(bookingHeader({ status: "no_show", ends_at: past }, { now: NOW, lang: "ru", canReplyNoShow: true }).askNoShow, "Aap aaye the? Batayein");
  assert.equal(bookingHeader({ status: "booked", ends_at: future }, { now: NOW, lang: "ru", canReplyNoShow: true }).askNoShow, null);
});

test("cancelled says who cancelled it", () => {
  const t = (by: "owner" | "player" | "system" | null) => bookingHeader({ status: "cancelled", cancelled_by: by, ends_at: future }, { now: NOW, lang: "ru" }).title;
  assert.equal(t("player"), "Booking cancel ho gayi");
  assert.equal(t("owner"), "Venue ne booking cancel kar di");
  assert.equal(t("system"), "Waqt khatam ho gaya");
  assert.equal(t(null), "Booking cancel ho gayi");
});

test("past bookings never show a QR or a placeholder", () => {
  for (const status of ["held", "payment_submitted", "booked", "completed", "no_show", "cancelled"] as const) {
    assert.equal(ticketQrMode({ status, ends_at: past }, NOW), "none", status);
  }
  assert.equal(ticketQrMode({ status: "booked", ends_at: future }, NOW), "show");
});

test("fix/nov-9: points are shown per venue, and a booking says what it earned", async () => {
  const { bookingPointsLine, venuePointsLine } = await import("./phase3");
  assert.equal(venuePointsLine({ venue_name: "Court Site", balance: 100 }), "Court Site: 100 points");
  assert.equal(bookingPointsLine({ balance: 100, venue_name: "Court Site", earned_here: 50 }, "ru"), "Court Site: 100 points · Is booking par +50");
  assert.equal(bookingPointsLine({ balance: 80, venue_name: "Court Site", earned_here: -20 }, "en"), "Court Site: 80 points · This booking -20");
  assert.equal(bookingPointsLine({ balance: 0, venue_name: "Court Site", earned_here: 0 }, "ru"), "Court Site: 0 points");
});
