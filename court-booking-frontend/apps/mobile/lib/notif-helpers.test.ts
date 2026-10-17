import test from "node:test";
import assert from "node:assert/strict";
import { badgeLabel, dedupeEntries, effectiveReadAt, newestMs, unreadCount, type LogEntry } from "./notif-helpers";

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
