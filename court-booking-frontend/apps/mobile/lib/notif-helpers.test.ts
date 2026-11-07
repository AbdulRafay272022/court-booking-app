import test from "node:test";
import assert from "node:assert/strict";
import { badgeLabel, dayHeading, dedupeEntries, effectiveReadAt, feedFromLog, groupByDay, newestMs, notificationTarget, pushTarget, unreadCount, type LogEntry } from "./notif-helpers";
import { linkedBookingId } from "./linked-booking";

const e = (id: string, type: string, at: string, ref: string | null = "b1", channel = "push"): LogEntry => ({ id, channel, event_type: type, status: "sent", reference_id: ref, created_at: at });

test("dedupe folds same event within 5 minutes, newest first", () => {
  const out = dedupeEntries([
    e("1", "booking_confirmed", "2026-10-18T10:00:00Z", "b1", "whatsapp"),
    e("2", "booking_confirmed", "2026-10-18T10:01:00Z", "b1", "push"),
    e("3", "booking_confirmed", "2026-10-18T10:30:00Z", "b1"),
    e("4", "booking_confirmed", "2026-10-18T10:00:30Z", "b2"),
  ]);
  assert.deepEqual(out.map((x) => x.id), ["3", "2", "4"]);
});

test("effectiveReadAt falls back to 24h ago", () => {
  assert.equal(effectiveReadAt(null, 100_000_000), 100_000_000 - 86_400_000);
  assert.equal(effectiveReadAt("abc", 100_000_000), 100_000_000 - 86_400_000);
  assert.equal(effectiveReadAt("5000", 100_000_000), 5000);
});

test("unreadCount and newestMs", () => {
  const items = [e("1", "a", "2026-10-18T10:00:00Z"), e("2", "b", "2026-10-18T11:00:00Z")];
  assert.equal(unreadCount(items, new Date("2026-10-18T10:30:00Z").getTime()), 1);
  assert.equal(newestMs(items), new Date("2026-10-18T11:00:00Z").getTime());
  assert.equal(newestMs([]), 0);
});

test("badgeLabel caps at 99+", () => {
  assert.equal(badgeLabel(0), "");
  assert.equal(badgeLabel(7), "7");
  assert.equal(badgeLabel(99), "99");
  assert.equal(badgeLabel(100), "99+");
});

test("feedFromLog folds channels into one item with both deliveries", () => {
  const out = feedFromLog([
    e("1", "refund_owed", "2026-10-18T10:00:00Z", "b1", "push"),
    { ...e("2", "refund_owed", "2026-10-18T10:02:00Z", "b1", "whatsapp"), status: "failed" },
    e("3", "booking_confirmed", "2026-10-18T09:00:00Z", "b2", "sms"),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].event_type, "refund_owed");
  assert.deepEqual(out[0].deliveries, [{ channel: "whatsapp", status: "failed" }, { channel: "push", status: "sent" }]);
  assert.equal(out[0].kind, "other");
  assert.equal(out[1].deliveries[0].channel, "sms");
});

test("dayHeading and groupByDay use the Pakistan calendar", () => {
  const now = new Date("2026-10-18T12:00:00Z"); // 5 PM PKT, Sun 18 Oct
  assert.equal(dayHeading("2026-10-18T03:00:00Z", now), "Aaj");
  assert.equal(dayHeading("2026-10-17T20:00:00Z", now), "Aaj"); // 1 AM PKT on the 18th
  assert.equal(dayHeading("2026-10-17T10:00:00Z", now), "Kal");
  assert.match(dayHeading("2026-10-14T10:00:00Z", now), /14 Oct/);
  const groups = groupByDay([{ created_at: "2026-10-17T10:00:00Z" }, { created_at: "2026-10-18T10:00:00Z" }, { created_at: "2026-10-18T11:00:00Z" }], now);
  assert.deepEqual(groups.map((g) => [g.title, g.items.length]), [["Aaj", 2], ["Kal", 1]]);
});

test("notificationTarget maps link kinds to screens", () => {
  const base = { params: { starts_at: "2026-10-18T16:00:00Z" } };
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "approvals" } }, "owner"), { pathname: "/(owner)/(tabs)/approvals" });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "refunds" } }, "owner"), { pathname: "/(owner)/(tabs)/refunds" });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "booking", booking_id: "b9" } }, "owner"), {
    pathname: "/(owner)/history",
    params: { booking: "b9", open: "1", from: "2026-10-18", to: "2026-10-18" },
  });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "bookings" } }, "owner"), { pathname: "/(owner)/history" });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "overview" } }, "owner"), { pathname: "/(owner)/(tabs)/today" });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "venue_status" } }, "owner"), { pathname: "/(owner)" });
  assert.equal(notificationTarget({ ...base, link: { kind: "none" } }, "owner"), null);
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "booking", booking_id: "b9" } }, "player"), { pathname: "/(player)/booking/[id]/done", params: { id: "b9" } });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "booking" } }, "player"), { pathname: "/(player)/(tabs)/bookings" });
  assert.equal(notificationTarget({ ...base, link: { kind: "approvals" } }, "player"), null);
});

test("late screenshot (old endpoint) reads as a late screenshot and the feed kind opens Approvals", async () => {
  const { notificationText } = await import("@court-booking/types");
  const [item] = feedFromLog([e("1", "late_payment_proof", "2026-10-18T10:00:00Z", "b1")]);
  assert.equal(notificationText(item, "ru").title, "Screenshot hold khatam hone ke baad aaya");
  const feedItem = { ...item, kind: "late_payment" as const, link: { kind: "approvals" as const, booking_id: "b1" } };
  assert.equal(notificationText(feedItem, "ru").title, "Screenshot hold khatam hone ke baad aaya");
  assert.deepEqual(notificationTarget(feedItem, "owner"), { pathname: "/(owner)/(tabs)/approvals", params: { booking: "b1", open: "1" } });
});

test("fix/nov-8: bell and push open the exact booking", () => {
  const B = "c710ec77-af12-47f1-8aeb-1930dfba27fa";
  const base = { params: {} };
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "approvals", booking_id: B } }, "owner"), { pathname: "/(owner)/(tabs)/approvals", params: { booking: B, open: "1" } });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "refunds", booking_id: B } }, "owner"), { pathname: "/(owner)/(tabs)/refunds", params: { booking: B, open: "1" } });
  assert.deepEqual(notificationTarget({ ...base, link: { kind: "refunds", booking_id: B } }, "player"), { pathname: "/(player)/booking/[id]/done", params: { id: B } });
  for (const e of ["booking_confirmed", "payment_rejected", "booking_cancelled", "booking_reminder", "refund_paid", "player_no_show"]) {
    assert.deepEqual(pushTarget({ event_type: e, reference_id: B }), { pathname: "/(player)/booking/[id]/done", params: { id: B } }, e);
  }
  for (const e of ["payment_submitted", "late_payment_proof", "payment_reminder_2"]) {
    assert.deepEqual(pushTarget({ event_type: e, reference_id: B }), { pathname: "/(owner)/(tabs)/approvals", params: { booking: B, open: "1" } }, e);
  }
  assert.deepEqual(pushTarget({ event_type: "refund_owed", reference_id: B }), { pathname: "/(owner)/(tabs)/refunds", params: { booking: B, open: "1" } });
  assert.deepEqual(pushTarget({ event_type: "owner_staff_action", reference_id: B }), { pathname: "/(owner)/history", params: { booking: B, open: "1" } });
  assert.deepEqual(pushTarget({ event_type: "payment_submitted" }), { pathname: "/(owner)/(tabs)/approvals" });
  assert.deepEqual(pushTarget({ event_type: "slot_reopened", reference_id: B }), { pathname: "/(player)/search" });
  assert.equal(pushTarget(undefined), null);
  assert.equal(linkedBookingId({ booking: B, open: "1" }), B);
  assert.equal(linkedBookingId({ booking: B }), null);
});
