import assert from "node:assert/strict";
import { test } from "node:test";

import { acceptReceivedInput, dueDoneProblem, noshowReverseProblem, pointsReasonLabel, receivedPrompt, replyEarnsBonus } from "./phase3";

const ok = { finalPrice: 2000, received: 1500, method: "cash" as const, hasScreenshot: false };

test("reversal: final price can't be below what was already paid", () => {
  assert.equal(noshowReverseProblem({ ...ok, finalPrice: 400 }, 500), "price");
  assert.equal(noshowReverseProblem({ ...ok, finalPrice: null }, 500), "price");
  assert.equal(noshowReverseProblem(ok, 500), null);
});

test("reversal: received is between 0 and final - paid", () => {
  assert.equal(noshowReverseProblem({ ...ok, received: 1600 }, 500), "received");
  assert.equal(noshowReverseProblem({ ...ok, received: -1 }, 500), "received");
  assert.equal(noshowReverseProblem({ ...ok, received: 0 }, 500), null);
});

test("reversal: a method must be chosen, a transfer with money needs the screenshot", () => {
  assert.equal(noshowReverseProblem({ ...ok, method: null }, 500), "method");
  assert.equal(noshowReverseProblem({ ...ok, method: "transfer" }, 500), "screenshot");
  assert.equal(noshowReverseProblem({ ...ok, method: "transfer", hasScreenshot: true }, 500), null);
  assert.equal(noshowReverseProblem({ ...ok, method: "transfer", received: 0 }, 500), null);
});

test("dues done: cash or transfer with a screenshot", () => {
  assert.equal(dueDoneProblem(null, false), "method");
  assert.equal(dueDoneProblem("cash", false), null);
  assert.equal(dueDoneProblem("transfer", false), "screenshot");
  assert.equal(dueDoneProblem("transfer", true), null);
});

test("the +5 only until bonus_until", () => {
  const until = "2026-11-04T10:00:00Z";
  assert.equal(replyEarnsBonus({ bonus_until: until }, new Date("2026-11-04T09:59:00Z")), true);
  assert.equal(replyEarnsBonus({ bonus_until: until }, new Date("2026-11-04T10:01:00Z")), false);
  assert.equal(replyEarnsBonus({ bonus_until: null }), false);
});

test("the new points line has words", () => {
  assert.notEqual(pointsReasonLabel("noshow_transfer_ok"), "noshow_transfer_ok");
  assert.notEqual(pointsReasonLabel("noshow_transfer_ok", "en"), "noshow_transfer_ok");
});

test("every kitna mila box says what came before and what is left", () => {
  assert.equal(receivedPrompt(1000, 1500), "Pehle Rs 1,000 mil chuke. Abhi kitna mila? (baqi Rs 1,500)");
  assert.equal(receivedPrompt(0, 2000, "en"), "Already received Rs 0. How much now? (Rs 2,000 left)");
});

test("a kitna mila box refuses more than the remaining due", () => {
  assert.deepEqual(acceptReceivedInput("1500", 1500, "150"), { value: "1500", blocked: false });
  assert.deepEqual(acceptReceivedInput("15000", 1500, "1500"), { value: "1500", blocked: true });
  assert.deepEqual(acceptReceivedInput("1,2a0", 1500, "12"), { value: "120", blocked: false });
  assert.deepEqual(acceptReceivedInput("", 1500, "5"), { value: "", blocked: false });
  assert.deepEqual(acceptReceivedInput("007", 1500, "0"), { value: "7", blocked: false });
  assert.deepEqual(acceptReceivedInput("1", 0, "0"), { value: "0", blocked: true });
});
