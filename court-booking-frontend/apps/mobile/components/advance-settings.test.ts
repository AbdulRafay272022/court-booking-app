// Run: npx tsx --test components/advance-settings.test.ts   (from apps/mobile)
// A11 parity: the wizard and Venue Settings both render the ONE AdvanceSettings editor with the same defaults, and the
// sentences come from the shared advance math. B1 parity: both render the same RemindersCard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdvanceExplain } from "@court-booking/types";

import {
  ADVANCE_DRAFT_DEFAULTS,
  advanceDefaultLine,
  advanceDraftFromCourt,
  advanceDraftProblem,
  advanceDraftToInput,
  advanceExampleLine,
  advancePriceFromSetup,
} from "./advance-settings-logic";

const root = join(__dirname, "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

test("wizard and Venue Settings use the same advance editor and reminders card", () => {
  const wizard = src("app/(owner)/venue-setup/courts.tsx");
  const settings = src("app/(owner)/venue-settings.tsx");
  for (const [name, file] of [["wizard", wizard], ["settings", settings]] as const) {
    assert.match(file, /from "@\/components\/advance-settings"/, `${name} imports the shared editor`);
    assert.match(file, /<AdvanceSettings\b/, `${name} renders AdvanceSettings`);
    assert.match(file, /advanceDraftToInput\(/, `${name} saves through the shared mapping`);
    assert.match(file, /advanceDraftProblem\(/, `${name} validates through the shared check`);
    assert.match(file, /<RemindersCard\b/, `${name} renders the reminders preview`);
    assert.doesNotMatch(file, /AdvanceRuleFields/, `${name} no longer uses the old editor`);
  }
  // same defaults: the wizard falls back to ADVANCE_DRAFT_DEFAULTS, Settings seeds from the court (null court = the same)
  assert.match(wizard, /ADVANCE_DRAFT_DEFAULTS/);
  assert.match(settings, /advanceDraftFromCourt\(/);
  assert.deepEqual(advanceDraftFromCourt(null), ADVANCE_DRAFT_DEFAULTS);
  assert.deepEqual(advanceDraftFromCourt({ advance_type: null, advance_value: null, advance_minimum: null }), ADVANCE_DRAFT_DEFAULTS);
});

test("draft <-> court fields keep the pre-Round-2 mapping", () => {
  assert.deepEqual(advanceDraftToInput(ADVANCE_DRAFT_DEFAULTS), { advance_type: null, advance_value: null, advance_minimum: null });
  assert.deepEqual(advanceDraftToInput({ advanceType: "percent", advanceValue: "50", advanceMinimum: "1000" }), {
    advance_type: "percent",
    advance_value: 50,
    advance_minimum: 1000,
  });
  assert.deepEqual(advanceDraftFromCourt({ advance_type: "fixed", advance_value: 500, advance_minimum: null }), {
    advanceType: "fixed",
    advanceValue: "500",
    advanceMinimum: "",
  });
});

test("validation blocks an empty or out-of-range value", () => {
  assert.equal(advanceDraftProblem(ADVANCE_DRAFT_DEFAULTS), null);
  assert.ok(advanceDraftProblem({ advanceType: "percent", advanceValue: "", advanceMinimum: "" }));
  assert.ok(advanceDraftProblem({ advanceType: "percent", advanceValue: "150", advanceMinimum: "" }));
  assert.equal(advanceDraftProblem({ advanceType: "percent", advanceValue: "50", advanceMinimum: "" }), null);
  assert.ok(advanceDraftProblem({ advanceType: "fixed", advanceValue: "0", advanceMinimum: "" }));
});

test("live example uses the court's real price (the spec's own example)", () => {
  const hourly = advancePriceFromSetup({ slotMinutes: 60, pricingRules: [{ pricePerSlot: "4000" }] });
  assert.equal(
    advanceExampleLine({ advanceType: "percent", advanceValue: "50", advanceMinimum: "" }, hourly, 100),
    "Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega, baqi PKR 2,000 venue par",
  );
  assert.equal(advanceExampleLine(ADVANCE_DRAFT_DEFAULTS, hourly, 100), "Court ka 1 ghante ka rate PKR 4,000 - default 100% -> player abhi PKR 4,000 dega");
  assert.match(advanceExampleLine({ advanceType: "percent", advanceValue: "10", advanceMinimum: "1000" }, hourly, 100)!, /kam az kam PKR 1,000\) -> player abhi PKR 1,000 dega/);
  // a 30-minute minimum booking priced at 2,000 is PKR 4,000 an hour: the example scales like the backend does
  const half = advancePriceFromSetup({ slotMinutes: 30, pricingRules: [{ pricePerSlot: "2000" }] });
  assert.match(advanceExampleLine({ advanceType: "fixed", advanceValue: "500", advanceMinimum: "" }, half, 100)!, /PKR 4,000 - fixed PKR 500 -> player abhi PKR 1,000 dega/);
  assert.equal(advanceExampleLine(ADVANCE_DRAFT_DEFAULTS, { unitPrice: null, unitMinutes: 60 }, 100), null);
});

test("'Agar aap kuch set na karein' shows the real default", () => {
  const hourly = { unitPrice: 4000, unitMinutes: 60 };
  assert.equal(advanceDefaultLine(hourly, 100, null), "Agar aap kuch set na karein: player poori raqam (100%) abhi dega - 1 ghante ki booking (PKR 4,000) par PKR 4,000.");
  const explain: AdvanceExplain = {
    mode: "percent", value: 50, minimum: null, hourly_price: 3000, example_minutes: 60, example_total: 3000, example_advance: 1500,
    default_rule: { source: "pricing_rule", percentage: 100, value_if_nothing_set: 3000 },
  };
  assert.equal(advanceDefaultLine(hourly, 100, explain), "Agar aap kuch set na karein: player poori raqam (100%) abhi dega - 1 ghante ki booking (PKR 3,000) par PKR 3,000.");
  assert.match(advanceDefaultLine({ unitPrice: null, unitMinutes: 60 }, 100, null), /pehle neeche price set karein/);
});
