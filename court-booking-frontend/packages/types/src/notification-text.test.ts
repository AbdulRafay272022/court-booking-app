import assert from "node:assert/strict";
import { test } from "node:test";

import { NOTIFICATION_KINDS, deliveryText, eventTypeTitle, notificationText } from "./notification-text";
import type { NotificationFeedItem } from "./round2";

// Sat 17 Oct 2026, 2:00 PM PKT
const NOW = new Date("2026-10-17T09:00:00Z");

const item = (over: Partial<NotificationFeedItem>): NotificationFeedItem => ({
  id: "n1",
  event_type: "payment_submitted",
  kind: "payment_waiting",
  created_at: "2026-10-17T08:00:00Z",
  params: {},
  link: { kind: "approvals" },
  deliveries: [],
  ...over,
});

test("the spec example reads as one sentence plus context", () => {
  const t = notificationText(
    item({
      params: { player_name: "Abbas Zafar", court_name: "Futsal 1", starts_at: "2026-10-17T16:00:00Z", amount: 2000 },
      deliveries: [{ channel: "whatsapp", status: "sent" }],
    }),
    "ru",
    NOW,
  );
  assert.equal(t.title, "Naya payment approval ke liye");
  assert.equal(t.context, "Abbas Zafar - Futsal 1 - Aaj 9 PM - PKR 2,000");
  assert.equal(t.delivery, "WhatsApp par bheja gaya");
  const en = notificationText(item({ params: { player_name: "Abbas Zafar", starts_at: "2026-10-17T16:30:00Z" } }), "en", NOW);
  assert.equal(en.context, "Abbas Zafar - Today 9:30 PM");
});

test("every kind has a readable title in both languages, never 'New notification'", () => {
  for (const kind of NOTIFICATION_KINDS) {
    for (const lang of ["ru", "en"] as const) {
      const t = notificationText(item({ kind, event_type: kind === "other" ? "some_new_event" : kind }), lang, NOW);
      assert.ok(t.title.length > 3, `${kind} ${lang}`);
      assert.doesNotMatch(t.title, /new notification|nayi notification/i, `${kind} ${lang}`);
    }
  }
});

test("unknown kind -> title from event_type", () => {
  assert.equal(notificationText(item({ kind: "other", event_type: "refund_paid" }), "en", NOW).title, "Refund sent");
  assert.equal(eventTypeTitle("payment_review_expired", "ru"), "Payment review ka waqt khatam ho gaya");
  assert.equal(eventTypeTitle("weird_thing_happened", "en"), "Update: Weird thing happened");
  assert.equal(eventTypeTitle("", "ru"), "Khelo se update");
  assert.equal(eventTypeTitle("payment_submitted_whatsapp", "en"), "New payment waiting for approval");
});

test("late screenshot has its own title with player, court, time and amount", () => {
  const late = item({
    kind: "late_payment",
    event_type: "late_payment_proof",
    params: { player_name: "Abbas Zafar", court_name: "Futsal 1", starts_at: "2026-10-17T16:00:00Z", amount: 2000 },
  });
  const ru = notificationText(late, "ru", NOW);
  assert.equal(ru.title, "Screenshot hold khatam hone ke baad aaya");
  assert.equal(ru.context, "Abbas Zafar - Futsal 1 - Aaj 9 PM - PKR 2,000");
  assert.equal(notificationText(late, "en", NOW).title, "Screenshot arrived after the hold had expired");
  assert.ok(NOTIFICATION_KINDS.includes("late_payment"));
  // an older server that still sends kind "other" (or the old endpoint) gets the same title from the event type
  assert.equal(eventTypeTitle("late_payment_proof", "ru"), "Screenshot hold khatam hone ke baad aaya");
});

test("venue kinds show venue name and reason", () => {
  const t = notificationText(item({ kind: "venue_changes", params: { venue_name: "Twin Courts", reason: "Photo chahiye" } }), "ru", NOW);
  assert.equal(t.context, "Twin Courts - Photo chahiye");
});

test("delivery line: one row for WhatsApp then SMS, failures muted", () => {
  assert.equal(deliveryText([], "ru"), null);
  assert.equal(deliveryText([{ channel: "sms", status: "sent" }], "ru"), "SMS par bheja gaya");
  assert.equal(
    deliveryText([{ channel: "whatsapp", status: "failed" }, { channel: "sms", status: "sent" }], "ru"),
    "SMS par bheja gaya (WhatsApp par nahi gaya)",
  );
  assert.equal(deliveryText([{ channel: "whatsapp", status: "failed" }], "en"), "Could not be sent by WhatsApp");
  assert.equal(deliveryText([{ channel: "push", status: "sent" }, { channel: "whatsapp", status: "sent" }], "en"), "Sent by WhatsApp and the app");
});

test("tomorrow in Roman Urdu carries the date", () => {
  const t = notificationText(item({ params: { starts_at: "2026-10-18T13:00:00Z" } }), "ru", NOW);
  assert.match(t.context, /^Kal .*18 Oct 6 PM$/);
});
