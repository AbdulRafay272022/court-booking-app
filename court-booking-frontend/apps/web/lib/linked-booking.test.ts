import test from "node:test";
import assert from "node:assert/strict";
import { linkedBookingId } from "./linked-booking";

const B = "c710ec77-af12-47f1-8aeb-1930dfba27fa";
const get = (q: string) => (k: string) => new URLSearchParams(q).get(k);

test("?booking=<uuid>&open=1 opens the popup; without open=1 it only highlights; junk ids are ignored", () => {
  assert.equal(linkedBookingId(get(`booking=${B}&open=1`)), B);
  assert.equal(linkedBookingId(get(`booking=${B}`)), null);
  assert.equal(linkedBookingId(get(`booking=nope&open=1`)), null);
  assert.equal(linkedBookingId(get(`open=1`)), null);
});
