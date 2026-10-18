import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceDraftErrors, advancePreview, basePriceFromDrafts, nothingSetAdvance } from "./advance-preview";

const rule = (pricePerSlot: string, dayOfWeek: number[] | null = null, startTime: string | null = null) => ({ pricePerSlot, dayOfWeek, startTime, endTime: startTime ? "23:00" : null });

test("base price: the all-day rate, else the cheapest", () => {
  assert.equal(basePriceFromDrafts([rule("6000", null, "18:00"), rule("4000")]), 4000);
  assert.equal(basePriceFromDrafts([rule("6000", [5, 6]), rule("5000", null, "18:00")]), 5000);
  assert.equal(basePriceFromDrafts([rule("")]), null);
});

test("live example: 50% of a PKR 4,000 hour -> PKR 2,000 now", () => {
  const p = advancePreview({ advanceType: "percent", advanceValue: "50", advanceMinimum: "" }, 4000, 60, 100);
  assert.deepEqual(p, { minutes: 60, total: 4000, advance: 2000, balance: 2000, capped: false });
  // 90-minute court: the example uses its own minimum booking
  const q = advancePreview({ advanceType: "fixed", advanceValue: "9000", advanceMinimum: "" }, 6000, 90, 100);
  assert.equal(q?.minutes, 90);
  assert.equal(q?.advance, 6000);
  assert.equal(q?.capped, true);
  assert.equal(advancePreview({ advanceType: "percent", advanceValue: "150", advanceMinimum: "" }, 4000, 60, 100), null);
});

test("if nothing is set: the price rule's percentage (100 by default)", () => {
  assert.equal(nothingSetAdvance(4000, 60, null), 4000);
  assert.equal(nothingSetAdvance(4000, 60, 25), 1000);
  assert.equal(nothingSetAdvance(null, 60, null), null);
});

test("draft errors", () => {
  assert.equal(advanceDraftErrors({ advanceType: "percent", advanceValue: "101", advanceMinimum: "" }).value, "percent");
  assert.equal(advanceDraftErrors({ advanceType: "fixed", advanceValue: "", advanceMinimum: "" }).value, "amount");
  assert.equal(advanceDraftErrors({ advanceType: "", advanceValue: "", advanceMinimum: "" }).value, null);
});

// Parity (A11 / B1): Venue Settings and the onboarding wizard render the SAME advance component (with the same live-example
// inputs) and the SAME reminders card, so their fields and defaults cannot drift.
const here = dirname(fileURLToPath(import.meta.url));
const settingsSrc = readFileSync(join(here, "../../app/dashboard/owner/settings/page.tsx"), "utf8");
const wizardSrc = readFileSync(join(here, "../../app/venue-setup/courts/page.tsx"), "utf8");

test("settings and wizard share the advance card and the reminders card", () => {
  for (const src of [settingsSrc, wizardSrc]) {
    assert.match(src, /from "@\/components\/setup\/advance-rule-fields"/);
    assert.match(src, /<AdvanceRuleFields/);
    assert.match(src, /unitPrice=\{basePriceFromDrafts\(/);
    assert.match(src, /unitMinutes=\{/);
    assert.match(src, /from "@\/components\/setup\/payment-reminders-card"/);
    assert.match(src, /<PaymentRemindersCard/);
  }
});
