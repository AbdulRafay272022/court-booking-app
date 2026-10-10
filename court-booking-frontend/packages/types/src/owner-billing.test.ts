import assert from "node:assert/strict";
import { test } from "node:test";

import type { OwnerPremiumFeature } from "./owner-billing";
import { premiumStateText, selectionTotal } from "./owner-billing";

const feature = (over: Partial<OwnerPremiumFeature>): OwnerPremiumFeature => ({
  key: "auto_approve", label: "Auto-approve payments", description: null, monthly_price_pkr: 1500, enabled: true, your_price_pkr: 1500,
  entitled: true, state: "trial", trial_ends_on: "2026-10-24", paid_through: null, cancelled: false, ...over,
});

test("the state sentence says what is happening in plain words", () => {
  assert.match(premiumStateText(feature({}), true), /Free trial until .*24 Oct/);
  assert.match(premiumStateText(feature({ state: "paid", paid_through: "2026-11-30", trial_ends_on: null }), true), /Paid until .*30 Nov/);
  assert.match(premiumStateText(feature({ state: "grace", entitled: true }), true), /overdue.*still works/);
  assert.match(premiumStateText(feature({ state: "lapsed", entitled: false }), true), /switched off.*Pay to turn it back on/i);
  assert.match(premiumStateText(feature({ state: "unpaid", entitled: false }), true), /trial is over/);
  assert.match(premiumStateText(feature({ enabled: false, state: "not_purchased", entitled: false, trial_ends_on: null, your_price_pkr: null }), true, 15), /15-day free trial/);
});

test("a cancelled feature says it keeps working until the end of what is paid, or just 'Cancelled'", () => {
  const stillWorks = feature({ enabled: false, cancelled: true, entitled: true, state: "paid", paid_through: "2026-11-30" });
  assert.match(premiumStateText(stillWorks, true), /Cancelled\. Keeps working until .*30 Nov/);
  assert.equal(premiumStateText(feature({ enabled: false, cancelled: true, entitled: false, state: "lapsed" }), true), "Cancelled.");
});

test("while billing is not enforced nothing sounds like a bill", () => {
  const text = premiumStateText(feature({ state: "not_enforced" }), false);
  assert.match(text, /Free trial until/);
  assert.doesNotMatch(text, /overdue|pay/i);
});

test("the total keeps locked prices for what is already on and uses today's price for what is new", () => {
  const features = [
    feature({ key: "a", enabled: true, your_price_pkr: 1000, monthly_price_pkr: 1800 }),
    feature({ key: "b", enabled: false, your_price_pkr: null, monthly_price_pkr: 2000 }),
    feature({ key: "c", enabled: false, your_price_pkr: null, monthly_price_pkr: 500 }),
  ];
  assert.equal(selectionTotal(features, new Set(["a"])), 1000);
  assert.equal(selectionTotal(features, new Set(["a", "b"])), 3000);
  assert.equal(selectionTotal(features, new Set(["b", "c"])), 2500);
  assert.equal(selectionTotal(features, new Set()), 0);
});

test("paying ahead during the free trial is visible: 'Free trial until X. Paid until Y.'", () => {
  const text = premiumStateText(feature({ state: "trial", trial_ends_on: "2026-10-24", paid_through: "2026-10-31" }), true);
  assert.match(text, /Free trial until .*24 Oct\. Paid until .*31 Oct/);
  assert.doesNotMatch(premiumStateText(feature({ state: "trial", trial_ends_on: "2026-10-24", paid_through: null }), true), /Paid until/);
});
