import test from "node:test";
import assert from "node:assert/strict";

import { hasPayableDetails, INSTRUCTIONS_TTL_MS, pruneSavedInstructions } from "./booking-flow-rules";

const details = { bank: "Meezan", account_title: "Demo Arena", account_number: "0123", iban: null, amount: 2000 };

test("pruneSavedInstructions: keeps recent holds' bank details, drops old and unstamped ones", () => {
  const now = 1_000_000_000_000;
  const out = pruneSavedInstructions(
    {
      fresh: { ...details, saved_at: now - 60_000 },
      edge: { ...details, saved_at: now - INSTRUCTIONS_TTL_MS + 1 },
      old: { ...details, saved_at: now - INSTRUCTIONS_TTL_MS },
      unstamped: { ...details },
    },
    now,
  );
  assert.deepEqual(Object.keys(out).sort(), ["edge", "fresh"]);
  assert.deepEqual(pruneSavedInstructions(undefined as never, now), {});
});

test("hasPayableDetails: needs an account number or an IBAN", () => {
  assert.equal(hasPayableDetails(details), true);
  assert.equal(hasPayableDetails({ ...details, account_number: null, iban: "PK36MEZN" }), true);
  assert.equal(hasPayableDetails({ ...details, account_number: null }), false);
  assert.equal(hasPayableDetails(undefined), false);
  assert.equal(hasPayableDetails(null), false);
});
