import test from "node:test";
import assert from "node:assert/strict";
import type { Booking, Slot } from "@court-booking/types";

import {
  bookingAction,
  cancelErrorCopy,
  cancelPolicySentence,
  cancelPolicyShort,
  cancelState,
  chatCandidates,
  durationOptions,
  fitsFrom,
  holdErrorCopy,
  nextGame,
  pickerModel,
  replayList,
  tonightStarts,
  venueDays,
} from "./player-flow";

const H = 3_600_000;
const NOW = Date.parse("2026-10-24T10:00:00Z"); // 3:00 PM PKT

const slot = (startIso: string, status: Slot["status"] = "available", extra: Partial<Slot> = {}): Slot => {
  const t = Date.parse(startIso);
  return {
    starts_at: new Date(t).toISOString(),
    ends_at: new Date(t + 30 * 60_000).toISOString(),
    status,
    price: 1000,
    advance_amount: 1000,
    held_until: null,
    booking_id: status === "available" ? null : "bk",
    is_mine: false,
    reason: null,
    after_midnight: false,
    ...extra,
  };
};
// 4:00 PM .. 9:30 PM PKT (11:00Z .. 16:30Z), 12 slots
const grid = (overrides: Record<number, Partial<Slot> & { status?: Slot["status"] }> = {}): Slot[] =>
  Array.from({ length: 12 }, (_, i) => {
    const o = overrides[i] ?? {};
    return slot(new Date(Date.parse("2026-10-24T11:00:00Z") + i * 30 * 60_000).toISOString(), o.status ?? "available", o);
  });

const booking = (extra: Partial<Booking>): Booking => ({
  id: "b1",
  court_id: "c1",
  player_id: "p1",
  starts_at: new Date(NOW + 24 * H).toISOString(),
  ends_at: new Date(NOW + 25 * H).toISOString(),
  status: "booked",
  source: "app",
  player_name: "Ali",
  player_phone: null,
  price: 4000,
  advance_amount: 2000,
  amount_paid: 2000,
  balance_due: 2000,
  held_until: null,
  payment_deadline: null,
  cancelled_by: null,
  cancellation_reason: null,
  checked_in_at: null,
  checked_in_by: null,
  created_at: new Date(NOW - H).toISOString(),
  ...extra,
});

test("holdErrorCopy: SLOT_ALREADY_TAKEN is friendly and asks for a slot refresh", () => {
  const c = holdErrorCopy("SLOT_ALREADY_TAKEN", "ru");
  assert.match(c.title, /kisi aur ne le liya/);
  assert.equal(c.refreshSlots, true);
  assert.match(holdErrorCopy("SLOT_ALREADY_TAKEN", "en").title, /Someone just took/);
});

test("holdErrorCopy: every documented hold code has its own copy, unknown codes fall back to the given message", () => {
  for (const code of ["SLOT_IN_PAST", "SLOT_BLOCKED", "BELOW_MINIMUM_BOOKING_TIME", "INVALID_SLOT_TIME", "INVALID_DURATION", "BOOKING_TOO_FAR", "VENUE_NOT_APPROVED", "NOT_FOUND"]) {
    assert.notEqual(holdErrorCopy(code).title, holdErrorCopy("WHATEVER").title, code);
  }
  assert.equal(holdErrorCopy("BOOKING_TOO_FAR").refreshSlots, false);
  assert.equal(holdErrorCopy("WHATEVER", "en", "Server said no").body, "Server said no");
});

test("cancelPolicySentence: built only from the venue's two fields, never invented", () => {
  assert.equal(cancelPolicySentence(null), null);
  assert.match(cancelPolicySentence({ cancellation_allowed: false, cancellation_cutoff_hours: 6 })!, /cancel nahi ho sakti/);
  assert.match(cancelPolicySentence({ cancellation_allowed: true, cancellation_cutoff_hours: 6 })!, /6 ghante pehle tak/);
  assert.match(cancelPolicySentence({ cancellation_allowed: true, cancellation_cutoff_hours: 1 }, "en")!, /1 hour before/);
  assert.match(cancelPolicySentence({ cancellation_allowed: true, cancellation_cutoff_hours: null })!, /kabhi bhi/);
  // no refund-time promise the backend does not make
  assert.doesNotMatch(cancelPolicySentence({ cancellation_allowed: true, cancellation_cutoff_hours: 6 })!, /din/);
  assert.match(cancelPolicyShort({ cancellation_allowed: true, cancellation_cutoff_hours: 6 }, "en")!, /6 hours/);
});

test("cancelState mirrors the server: pending always cancellable, booked follows the policy and the cutoff", () => {
  const policy = { cancellation_allowed: true, cancellation_cutoff_hours: 6 };
  assert.equal(cancelState(booking({ status: "held" }), null, NOW).canCancel, true);
  assert.equal(cancelState(booking({ status: "payment_submitted" }), policy, NOW).canCancel, true);
  assert.deepEqual(cancelState(booking({ status: "booked" }), { cancellation_allowed: false, cancellation_cutoff_hours: null }, NOW), { canCancel: false, blocked: "not_allowed" });
  assert.equal(cancelState(booking({ status: "booked" }), policy, NOW).canCancel, true); // starts in 24 h
  const soon = booking({ status: "booked", starts_at: new Date(NOW + 2 * H).toISOString() });
  assert.equal(cancelState(soon, policy, NOW).blocked, "window_closed");
  assert.equal(cancelState(booking({ status: "completed" }), policy, NOW).canCancel, false);
  assert.match(cancelErrorCopy("CANCELLATION_WINDOW_CLOSED"), /waqt guzar gaya/);
});

test("fitsFrom: needs N back-to-back free slots", () => {
  const s = grid({ 3: { status: "booked" } });
  assert.equal(fitsFrom(s, 0, 3), true);
  assert.equal(fitsFrom(s, 1, 3), false);
  assert.equal(fitsFrom(s, 10, 3), false); // runs off the end
});

test("pickerModel: selected start + in-range, held-by-other, own booking, no room and past slots", () => {
  const s = grid({
    // 4:00 PM is in the past at 3:00 PM? no: NOW is 3 PM PKT, so every slot is ahead
    4: { status: "held", is_mine: false },
    6: { status: "payment_submitted", is_mine: false },
    8: { status: "booked", is_mine: true },
    10: { status: "booked" },
  });
  const m = pickerModel(s, 2, s[0].starts_at, NOW);
  const st = (i: number) => m.items.find((x) => x.slot.starts_at === s[i].starts_at)?.state;
  assert.equal(st(0), "selected");
  assert.equal(st(1), "inRange");
  assert.equal(st(3), "noRoom"); // 3 is free but 4 is held, so 2 slots do not fit
  assert.equal(st(4), "held");
  assert.equal(st(6), "held"); // payment_submitted by someone else is "held"
  assert.equal(st(8), "mine");
  assert.equal(st(10), "booked");
  assert.deepEqual(m.range, [s[0].starts_at, s[1].starts_at]);
  assert.equal(m.endsAt, s[1].ends_at);
  // a start that no longer fits (length grew) is dropped instead of half-selected
  const m3 = pickerModel(s, 4, s[2].starts_at, NOW);
  assert.equal(m3.start, null);
  // past free slots are not rendered
  const later = pickerModel(s, 1, null, Date.parse(s[2].starts_at) + 1);
  assert.equal(later.items.some((x) => x.slot.starts_at === s[0].starts_at), false);
});

test("durationOptions + venueDays", () => {
  assert.deepEqual(durationOptions(2), [2, 3, 4]);
  assert.deepEqual(durationOptions(11), [11, 12]);
  assert.deepEqual(venueDays("2026-10-30", 90).slice(0, 3), ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(venueDays("2026-10-30", 3).length, 3);
  assert.equal(venueDays("2026-10-30", null).length, 7);
});

test("nextGame only returns a real BOOKED upcoming booking; replayList only real past games, one per court", () => {
  const held = booking({ id: "h", status: "held", starts_at: new Date(NOW + H).toISOString(), ends_at: new Date(NOW + 2 * H).toISOString() });
  const later = booking({ id: "k", status: "booked" });
  assert.equal(nextGame([held], NOW), null);
  assert.equal(nextGame([held, later], NOW)?.id, "k");
  const past = [
    booking({ id: "p1", court_id: "c1", status: "completed", starts_at: new Date(NOW - 48 * H).toISOString(), ends_at: new Date(NOW - 47 * H).toISOString() }),
    booking({ id: "p2", court_id: "c1", status: "completed", starts_at: new Date(NOW - 24 * H).toISOString(), ends_at: new Date(NOW - 23 * H).toISOString() }),
    booking({ id: "p3", court_id: "c2", status: "cancelled", starts_at: new Date(NOW - 24 * H).toISOString(), ends_at: new Date(NOW - 23 * H).toISOString() }),
  ];
  assert.deepEqual(replayList(past, NOW).map((b) => b.id), ["p2"]);
});

test("tonightStarts: real free starts from 5 PM PKT today where the minimum fits, deduped across courts", () => {
  const a = grid({ 4: { status: "booked" } }); // 4:00..9:30 PM; index 2 = 5:00 PM
  const b = grid();
  const starts = tonightStarts([{ min_slots: 2, slots: a }, { min_slots: 2, slots: b }], NOW);
  assert.equal(starts[0], a[2].starts_at); // 5:00 PM, not 4:00 / 4:30 PM
  assert.equal(new Set(starts).size, starts.length);
  assert.equal(starts.includes(a[11].starts_at), false); // 9:30 PM: 2 slots do not fit before the day's end
});

test("chatCandidates: live bookings first, then recent ones; expired holds are not live", () => {
  const live = booking({ id: "live", status: "payment_submitted" });
  const expired = booking({ id: "exp", status: "held", held_until: new Date(NOW - 60_000).toISOString(), starts_at: new Date(NOW + 5 * H).toISOString(), ends_at: new Date(NOW + 6 * H).toISOString() });
  const recent = booking({ id: "rec", status: "completed", starts_at: new Date(NOW - 48 * H).toISOString(), ends_at: new Date(NOW - 47 * H).toISOString() });
  const old = booking({ id: "old", status: "completed", starts_at: new Date(NOW - 30 * 24 * H).toISOString(), ends_at: new Date(NOW - 30 * 24 * H + H).toISOString() });
  const ids = chatCandidates([recent, old, expired, live, live], NOW).map((b) => b.id);
  assert.deepEqual(ids, ["live", "rec"]);
});

test("bookingAction: one honest main action per status", () => {
  assert.equal(bookingAction({ status: "held", held_until: new Date(NOW + 60_000).toISOString() }, NOW), "pay");
  assert.equal(bookingAction({ status: "held", held_until: new Date(NOW - 60_000).toISOString() }, NOW), "details");
  assert.equal(bookingAction({ status: "payment_submitted", held_until: null }, NOW), "status");
  assert.equal(bookingAction({ status: "booked", held_until: null }, NOW), "ticket");
  assert.equal(bookingAction({ status: "completed", held_until: null }, NOW), "rate");
});

test("doneCopy (Roman Urdu): only a booked booking says 'Court aap ka hai'", async () => {
  const { doneCopy } = await import("./booking-done");
  for (const s of ["held", "payment_submitted", "booked", "completed", "no_show", "cancelled"] as const) {
    const c = doneCopy(s, null, "ru");
    assert.equal(/Court aap ka hai/i.test(c.title + c.subtitle), s === "booked", s);
    assert.doesNotMatch(c.title + c.subtitle, /pakki/i, s);
  }
  assert.equal(doneCopy("held", null, "ru").action, "pay");
  assert.match(doneCopy("cancelled", "owner", "ru").title, /Venue/);
});
