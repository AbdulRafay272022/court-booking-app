import test from "node:test";
import assert from "node:assert/strict";
import { dedupeEntries, effectiveReadAt, eventSuffix, newArrivals, newestMs, routeForEvent, unreadCount, type LogEntry } from "./notif-helpers";

const e = (id: string, type: string, at: string, ref: string | null = "b1", channel = "push"): LogEntry => ({ id, channel, event_type: type, status: "sent", reference_id: ref, created_at: at });

test("push + WhatsApp rows of one event fold into one item, newest first", () => {
  const rows = [
    e("1", "booking_confirmed", "2026-10-16T10:00:10Z", "b1", "whatsapp"),
    e("2", "booking_confirmed", "2026-10-16T10:00:00Z", "b1", "push"),
    e("3", "booking_confirmed", "2026-10-16T10:30:00Z", "b2"),
    e("4", "booking_confirmed", "2026-10-16T11:30:00Z", "b1"),
  ];
  const out = dedupeEntries(rows);
  assert.deepEqual(out.map((x) => x.id), ["4", "3", "1"]);
});

test("unread uses the read marker; no marker means the last 24 hours", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();
  const items = [e("a", "refund_owed", "2026-10-16T11:00:00Z"), e("b", "refund_owed", "2026-10-15T09:00:00Z", "b2")];
  assert.equal(unreadCount(items, effectiveReadAt(null, now)), 1);
  assert.equal(unreadCount(items, effectiveReadAt("0", now)), 1);
  assert.equal(unreadCount(items, new Date("2026-10-15T00:00:00Z").getTime()), 2);
  assert.equal(unreadCount(items, newestMs(items)), 0);
});

test("a popup is only for rows newer than the previous poll, never on the first load", () => {
  const items = [e("a", "payment_submitted", "2026-10-16T11:00:00Z"), e("b", "payment_submitted", "2026-10-16T10:00:00Z", "b2")];
  assert.deepEqual(newArrivals(items, null), []);
  assert.deepEqual(newArrivals(items, new Date("2026-10-16T10:30:00Z").getTime()).map((x) => x.id), ["a"]);
  assert.deepEqual(newArrivals(items, newestMs(items)), []);
});

test("event names fold to a known key, unknown ones are generic", () => {
  assert.equal(eventSuffix("payment_submitted_whatsapp"), "payment_submitted");
  assert.equal(eventSuffix("payment_submitted_owner"), "payment_submitted");
  assert.equal(eventSuffix("refund_owed"), "refund_owed");
  assert.equal(eventSuffix("something_new"), "generic");
});

test("links depend on the role", () => {
  assert.equal(routeForEvent("payment_submitted", "owner"), "/dashboard/owner/approvals");
  assert.equal(routeForEvent("payment_submitted_sms", "staff"), "/dashboard/owner/approvals");
  assert.equal(routeForEvent("payment_submitted", "player"), null);
  assert.equal(routeForEvent("refund_owed", "owner"), "/dashboard/owner/refunds");
  assert.equal(routeForEvent("refund_paid", "player"), "/bookings");
  assert.equal(routeForEvent("booking_confirmed", "player"), "/bookings");
  assert.equal(routeForEvent("booking_cancelled", "owner"), "/dashboard/bookings");
  assert.equal(routeForEvent("unknown", "owner"), null);
  assert.equal(routeForEvent("booking_confirmed", "admin"), null);
});

// ---- Round 2 (A6) ----
import { feedRoute, groupByDay, legacyToFeed } from "./notif-helpers";

test("feed links: approvals/refunds/booking for owners, close-then-navigate targets", () => {
  assert.equal(feedRoute({ link: { kind: "approvals" }, params: {} }, "owner"), "/dashboard/owner/approvals");
  assert.equal(feedRoute({ link: { kind: "approvals" }, params: {} }, "player"), null);
  assert.equal(
    feedRoute({ link: { kind: "booking", booking_id: "b1" }, params: { starts_at: "2026-10-17T16:00:00Z" } }, "staff"),
    "/dashboard/bookings?booking=b1&from=2026-10-17&to=2026-10-17",
  );
  assert.equal(feedRoute({ link: { kind: "booking", booking_id: "b1" }, params: {} }, "player"), "/bookings");
  assert.equal(feedRoute({ link: { kind: "none" }, params: {} }, "owner"), null);
});

test("old endpoint: WhatsApp then SMS for one event = ONE item with both deliveries", () => {
  const rows = [
    { ...e("1", "payment_submitted", "2026-10-16T10:00:00Z", "p1", "whatsapp"), status: "failed" },
    e("2", "payment_submitted", "2026-10-16T10:01:00Z", "p1", "sms"),
    e("3", "slot_reopened", "2026-10-16T09:00:00Z", "b9"),
  ];
  const out = legacyToFeed(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, "payment_waiting");
  assert.deepEqual(out[0].link, { kind: "approvals" });
  assert.deepEqual(
    [...out[0].deliveries].sort((a, b) => a.channel.localeCompare(b.channel)),
    [{ channel: "sms", status: "sent" }, { channel: "whatsapp", status: "failed" }],
  );
  assert.equal(out[1].kind, "slot_freed");
});

test("group by Pakistan day: today, yesterday, older", () => {
  const now = new Date("2026-10-17T09:00:00Z").getTime(); // 2 PM PKT
  const g = groupByDay(
    [
      { created_at: "2026-10-17T08:00:00Z" },
      { created_at: "2026-10-16T20:00:00Z" }, // 1 AM 17 Oct PKT -> today
      { created_at: "2026-10-16T10:00:00Z" },
      { created_at: "2026-10-12T10:00:00Z" },
    ],
    now,
  );
  assert.deepEqual(g.map((x) => [x.kind, x.items.length]), [["today", 2], ["yesterday", 1], ["date", 1]]);
});
