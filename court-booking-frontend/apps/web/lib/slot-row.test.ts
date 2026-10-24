import { test } from "node:test";
import assert from "node:assert/strict";
import { slotRowSpec } from "./slot-row";

const NOW = Date.parse("2026-10-24T10:00:00Z");
const at = (h: number) => new Date(Date.UTC(2026, 9, 24, h)).toISOString();
const slot = (status: "available" | "held" | "payment_submitted" | "booked" | "blocked", is_mine = false, h = 15) => ({ starts_at: at(h), status, is_mine });

test("held / payment_submitted by someone else = held (never 'booked', never mine)", () => {
  for (const s of ["held", "payment_submitted"] as const) {
    const r = slotRowSpec(slot(s), { now: NOW, fits: true });
    assert.equal(r?.state, "held");
    assert.equal(r?.labelKey, "venue.pop.heldByOther");
    assert.equal(r?.pressable, false);
    assert.equal(r?.waitlist, false);
  }
});

test("your own live booking: honest status label, Pakki only when booked", () => {
  const held = slotRowSpec(slot("held", true), { now: NOW, fits: true }, "ru");
  assert.equal(held?.state, "mine");
  assert.equal(held?.mineHref, "pay");
  assert.doesNotMatch(held?.statusLabel ?? "", /Pakki/);
  const check = slotRowSpec(slot("payment_submitted", true), { now: NOW, fits: true }, "ru");
  assert.equal(check?.statusLabel, "Venue check");
  assert.equal(check?.mineHref, "pay");
  const booked = slotRowSpec(slot("booked", true), { now: NOW, fits: true }, "ru");
  assert.equal(booked?.statusLabel, "Pakki ✓");
  assert.equal(booked?.mineHref, "done");
});

test("booked by others offers the waitlist; blocked is closed; too-short is noRoom; open is pressable", () => {
  assert.deepEqual([slotRowSpec(slot("booked"), { now: NOW, fits: true })?.state, slotRowSpec(slot("booked"), { now: NOW, fits: true })?.waitlist], ["booked", true]);
  assert.equal(slotRowSpec(slot("blocked"), { now: NOW, fits: true })?.state, "blocked");
  assert.equal(slotRowSpec(slot("available"), { now: NOW, fits: false })?.state, "noRoom");
  const open = slotRowSpec(slot("available"), { now: NOW, fits: true });
  assert.equal(open?.state, "open");
  assert.equal(open?.pressable, true);
});

test("a past free slot is not rendered", () => {
  assert.equal(slotRowSpec(slot("available", false, 8), { now: NOW, fits: true }), null);
});
