import assert from "node:assert/strict";
import test from "node:test";

import { paisaV2Href, parsePaisaV2, parseRupees, signedPkr, waLink } from "./paisa-v2";

test("v1 tab names and notification links land on the right v2 tab / group", () => {
  assert.deepEqual(parsePaisaV2("hisaab", null), { tab: "bookings", group: null });
  assert.deepEqual(parsePaisaV2("bank", null), { tab: "kaam", group: "bank_check" });
  assert.deepEqual(parsePaisaV2("baqi", null), { tab: "players", group: null });
  assert.deepEqual(parsePaisaV2("wapas", null), { tab: "kaam", group: "refund_due" });
  assert.deepEqual(parsePaisaV2(null, null), { tab: "bookings", group: null });
  assert.deepEqual(parsePaisaV2("kaam", "attendance"), { tab: "kaam", group: "attendance" });
  assert.deepEqual(parsePaisaV2("lenden", "attendance"), { tab: "lenden", group: null });
  assert.deepEqual(parsePaisaV2("nope", "x"), { tab: "bookings", group: null });
});

test("v2 hrefs keep the other query values", () => {
  assert.equal(paisaV2Href("bookings"), "/dashboard/owner/paisa");
  assert.equal(paisaV2Href("kaam", "refund_due", { booking: "b1", open: "1", tab: "x" }), "/dashboard/owner/paisa?tab=kaam&group=refund_due&booking=b1&open=1");
});

test("money text and parsing", () => {
  assert.equal(signedPkr(1500), "+ PKR 1,500");
  assert.equal(signedPkr(-500), "− PKR 500");
  assert.equal(parseRupees("PKR 1,500"), 1500);
  assert.ok(Number.isNaN(parseRupees("12.5")));
  assert.equal(waLink("0300 1234567", "hi"), "https://wa.me/923001234567?text=hi");
  assert.equal(waLink("12", "hi"), null);
});
