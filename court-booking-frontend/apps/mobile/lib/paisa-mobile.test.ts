import test from "node:test";
import assert from "node:assert/strict";
import { cashShare, historyToPaisa, parseAmount, parseView, refundsToPaisa, shortRange, waLink } from "./paisa-mobile";

test("old History params map to Paisa Bookings", () => {
  assert.deepEqual(historyToPaisa({ from: "2026-11-12", to: "2026-11-12", status: "booked" }, "2026-11-12"), { view: "bookings", period: "today" });
  assert.deepEqual(
    historyToPaisa({ from: "2026-11-01", to: "2026-11-05", courts: "a,b", status: "short_paid", booking: "x", open: "1", staff: "s", act: "cash", who: "Ali" }, "2026-11-12"),
    { view: "bookings", period: "custom", from: "2026-11-01", to: "2026-11-05", courts: "a,b", status: "part_paid", booking: "x", open: "1", staff: "s", act: "cash", who: "Ali" },
  );
  assert.deepEqual(historyToPaisa({}, "2026-11-12"), { view: "bookings" });
});

test("old Refunds params map to Kaam refund_due", () => {
  assert.deepEqual(refundsToPaisa({ booking: "b", open: "1", date: "2026-11-01" }), { view: "kaam", group: "refund_due", booking: "b", open: "1", date: "2026-11-01" });
});

test("views, ranges, amounts and WhatsApp links", () => {
  assert.equal(parseView("kaam"), "kaam");
  assert.equal(parseView("nope"), "bookings");
  assert.equal(shortRange("2026-11-04", "2026-11-10"), "4 – 10 Nov");
  assert.equal(shortRange("2026-10-28", "2026-11-03"), "28 Oct – 3 Nov");
  assert.equal(cashShare(300, 100), 0.75);
  assert.equal(cashShare(0, 0), 0);
  assert.equal(parseAmount("2,000"), 2000);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("12.5"), null);
  assert.equal(waLink("03001234567", "a b"), "https://wa.me/923001234567?text=a%20b");
});
