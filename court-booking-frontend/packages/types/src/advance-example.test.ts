import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { advanceExample, advanceFor, formatPkrAmount, groupDigits, pyRound2, type AdvanceRule } from "./advance-example";

const rule = (over: Partial<AdvanceRule>): AdvanceRule => ({ mode: "default", value: null, minimum: null, defaultPercentage: 100, ...over });

test("pyRound2 matches Python round(x, 2): ties to even on exact binary ties", () => {
  assert.equal(pyRound2(0.125), 0.12); // exact tie -> even
  assert.equal(pyRound2(0.375), 0.38);
  assert.equal(pyRound2(2.675), 2.67); // binary value is below .675
  assert.equal(pyRound2(1.005), 1); // binary value is below 1.005
  assert.equal(pyRound2(1333.3333333), 1333.33);
  assert.equal(pyRound2(2000), 2000);
  assert.equal(pyRound2(666.666666), 666.67);
});

test("default mode uses the pricing rule's advance percentage", () => {
  assert.equal(advanceFor(4000, rule({ defaultPercentage: 100 })), 4000);
  assert.equal(advanceFor(4000, rule({ defaultPercentage: 25 })), 1000);
  // null percentage = the backend default (100)
  assert.equal(advanceFor(4000, rule({ defaultPercentage: null })), 4000);
});

test("percent and fixed modes, minimum floor, never above the total", () => {
  assert.equal(advanceFor(4000, rule({ mode: "percent", value: 50 })), 2000);
  assert.equal(advanceFor(3333, rule({ mode: "percent", value: 33.3 })), pyRound2((3333 * 33.3) / 100));
  assert.equal(advanceFor(4000, rule({ mode: "fixed", value: 1500 })), 1500);
  assert.equal(advanceFor(1000, rule({ mode: "fixed", value: 1500 })), 1000); // capped at total
  assert.equal(advanceFor(4000, rule({ mode: "percent", value: 10, minimum: 1000 })), 1000); // floor wins
  assert.equal(advanceFor(4000, rule({ mode: "percent", value: 50, minimum: 1000 })), 2000); // percent wins
  assert.equal(advanceFor(800, rule({ mode: "percent", value: 10, minimum: 1000 })), 800); // floor above total -> total
  assert.equal(advanceFor(4000, rule({ mode: "fixed", value: null })), 0);
  assert.equal(advanceFor(4000, rule({ mode: "percent", value: 0, minimum: 500 })), 500);
});

test("advanceExample: 60 minutes, scaled from the court's priced unit", () => {
  assert.deepEqual(advanceExample(4000, rule({ mode: "percent", value: 50 })), { minutes: 60, total: 4000, advance: 2000 });
  // a 90-minute court priced 6000 per 90 minutes, fixed 1500 per unit -> 60 minutes = 4000 total, 1000 advance
  assert.deepEqual(advanceExample(6000, rule({ mode: "fixed", value: 1500 }), { unitMinutes: 90 }), {
    minutes: 60,
    total: 4000,
    advance: 1000,
  });
});

test("money formatting without locale APIs", () => {
  assert.equal(groupDigits(4000), "4,000");
  assert.equal(groupDigits(1234567), "1,234,567");
  assert.equal(groupDigits(2500.5), "2,500.50");
  assert.equal(formatPkrAmount(2000), "PKR 2,000");
});

// Shared cases written by the backend from the REAL compute_advance (docs/round2-contract.md, A11).
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "advance-cases.json");

type FixtureCase = {
  name?: string;
  total: number;
  rule?: Record<string, unknown>;
  mode?: string;
  value?: number | null;
  minimum?: number | null;
  default_percentage?: number | null;
  defaultPercentage?: number | null;
  expected?: number;
  advance?: number;
};

function toRule(c: FixtureCase): AdvanceRule {
  const r = (c.rule ?? c) as Record<string, unknown>;
  const mode = (r.mode ?? r.advance_type ?? "default") as string;
  return {
    mode: (mode === null || mode === "none" ? "default" : mode) as AdvanceRule["mode"],
    value: (r.value ?? r.advance_value ?? null) as number | null,
    minimum: (r.minimum ?? r.advance_minimum ?? null) as number | null,
    defaultPercentage: (r.defaultPercentage ?? r.default_percentage ?? r.advance_percentage ?? null) as number | null,
  };
}

test("shared backend cases (fixtures/advance-cases.json)", (t) => {
  if (!existsSync(FIXTURE)) {
    t.skip("fixtures/advance-cases.json not present yet (the backend agent writes it on its branch; the lead merges it)");
    return;
  }
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as FixtureCase[] | { cases: FixtureCase[] };
  const cases = Array.isArray(raw) ? raw : raw.cases;
  assert.ok(cases.length > 0, "fixture has cases");
  for (const c of cases) {
    const expected = c.expected ?? c.advance;
    assert.equal(advanceFor(c.total, toRule(c), (c as { units?: number }).units ?? 1), expected, c.name ?? JSON.stringify(c));
  }
});
