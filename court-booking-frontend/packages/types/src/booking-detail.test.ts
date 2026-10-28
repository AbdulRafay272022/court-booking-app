// Run: cd packages/types && npx tsx --test src/booking-detail.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { paymentLineLabel, timelineLabel, whatsappLink } from "./booking-detail";

test("timeline words exist in both languages and never come back blank", () => {
  assert.equal(timelineLabel("held", "ru"), "Slot hold hua");
  assert.equal(timelineLabel("approved", "en"), "Venue approved the payment");
  assert.equal(timelineLabel("something_new", "ru"), "something new");
});

test("payment lines say how they were paid", () => {
  assert.equal(paymentLineLabel({ amount: 500, method: "cash_at_venue", is_reversal: false }, "ru"), "Venue par cash");
  assert.equal(paymentLineLabel({ amount: 1500, method: "bank_transfer_proof", is_reversal: false }, "en"), "Bank transfer");
  assert.match(paymentLineLabel({ amount: -500, method: "other", is_reversal: false }, "en"), /Refund/);
});

test("whatsapp links accept the usual Pakistani spellings and refuse junk", () => {
  assert.equal(whatsappLink("0333 5119042"), "https://wa.me/923335119042");
  assert.equal(whatsappLink("+92 333-5119042"), "https://wa.me/923335119042");
  assert.equal(whatsappLink("3335119042", "Salam"), "https://wa.me/923335119042?text=Salam");
  assert.equal(whatsappLink("021 1234567"), null);
  assert.equal(whatsappLink(null), null);
});

test("venue gaps are worded per court in both languages", async () => {
  const { venueMissingLabel } = await import("./booking-detail");
  assert.equal(venueMissingLabel({ code: "schedule", court: "Court 1" }, "ru"), "Court 1 ke khulne ke auqaat");
  assert.equal(venueMissingLabel({ code: "pricing", court: "Court A" }, "en"), "A price for Court A");
  assert.equal(venueMissingLabel({ code: "bank_details", court: null }, "en"), "Bank details (bank, account title, account number)");
});

test("the short refund line uses the founder's wording", async () => {
  const { refundPolicyShort } = await import("./booking-detail");
  assert.equal(refundPolicyShort({ cancellation_allowed: false, cancellation_cutoff_hours: null }, "ru"), "Refund nahi");
  assert.equal(refundPolicyShort({ cancellation_allowed: true, cancellation_cutoff_hours: 6 }, "ru"), "6 ghante pehle tak refund");
  assert.equal(refundPolicyShort({ cancellation_allowed: true, cancellation_cutoff_hours: null }, "ru"), "Shuru hone se pehle tak refund");
  assert.equal(refundPolicyShort({ cancellation_allowed: true, cancellation_cutoff_hours: 1 }, "en"), "Refund up to 1 hour before");
  assert.equal(refundPolicyShort(null, "ru"), "");
});
