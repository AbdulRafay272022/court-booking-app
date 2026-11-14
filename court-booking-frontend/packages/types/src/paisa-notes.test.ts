import { test } from "node:test";
import assert from "node:assert/strict";

import { paisaNote } from "./paisa-notes";
import { sportLabel } from "./sports";

test("system notes read in the viewer's language; typed notes stay as they are (founder 14 Nov)", () => {
  assert.equal(paisaNote("Advance credited at approval", "ru"), "Approve par advance mila");
  assert.equal(paisaNote("Advance credited at approval", "en"), "Advance received at approval");
  assert.equal(paisaNote("Booking completed: owner says PKR 1,000 received", "ru"), "Booking mukammal: owner ke mutabiq PKR 1,000 mila");
  assert.equal(paisaNote("Refund paid (REF11) -- partial, PKR 400 still owed", "ru"), "Refund diya (REF11) · PKR 400 abhi baqi");
  assert.equal(paisaNote("Refund paid (TX-1)", "en"), "Refund paid (TX-1)");
  assert.equal(paisaNote("Jama se diya", "en"), "Paid from credit");
  assert.equal(paisaNote("Bank mein nahi mila (3f2a-11)", "en"), "Not in the bank");
  assert.equal(paisaNote("counter par diye", "en"), "counter par diye");
  assert.equal(paisaNote(null, "ru"), null);
});

test("sport labels: stored lowercase reads as the label", () => {
  assert.equal(sportLabel("padel"), "Padel");
  assert.equal(sportLabel("FUTSAL"), "Futsal");
  assert.equal(sportLabel("squash"), "Squash");
  assert.equal(sportLabel(""), "");
});
