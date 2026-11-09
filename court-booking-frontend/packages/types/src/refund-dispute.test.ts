import { test } from "node:test";
import assert from "node:assert/strict";
import { escalationStatusLine, payoutInputError, refundCheckLabel, refundCheckReasons, type Escalation } from "./refund-dispute";

test("payout input: wallet numbers, IBAN and title are checked like the server", () => {
  assert.equal(payoutInputError({ method: "jazzcash", account: "0300 1234567", title: "Ali Raza" }, "ru"), null);
  assert.equal(payoutInputError({ method: "easypaisa", account: "+92 300-1234567", title: "Ali Raza" }, "en"), null);
  assert.equal(payoutInputError({ method: "bank", account: "pk36 scbl 0000 0011 2345 6702", title: "Ali Raza" }, "en"), null);
  assert.match(payoutInputError({ method: "bank", account: "PK36SCBL0000", title: "Ali" }, "en")!, /IBAN/);
  assert.match(payoutInputError({ method: "jazzcash", account: "12345", title: "Ali" }, "ru")!, /mobile number/);
  assert.match(payoutInputError({ method: "jazzcash", account: "03001234567", title: " " }, "en")!, /title/);
  assert.equal(payoutInputError({ use_previous: true }, "ru"), null);
});

test("check labels follow the language and never mix", () => {
  assert.equal(refundCheckLabel("match", "ru"), "Match");
  assert.equal(refundCheckLabel("mismatch", "ru"), "Farq hai");
  assert.equal(refundCheckLabel("mismatch", "en"), "Doesn't match");
  assert.deepEqual(refundCheckReasons(["amount", "receiver"], "en"), ["Amount is different", "Receiver name/number is different"]);
  assert.deepEqual(refundCheckReasons(["amount"], "ru"), ["Raqam alag hai"]);
});

test("escalation status line", () => {
  const base: Escalation = {
    id: "e", kind: "refund", status: "open", reason: null, admin_decision: null, admin_note: null, created_at: "", decided_at: null,
  };
  assert.match(escalationStatusLine(base, "ru"), /Khelo ko bhej di/);
  const won = { ...base, status: "decided" as const, admin_decision: "player" as const, admin_note: "Screenshot mein 900 hain" };
  assert.equal(escalationStatusLine(won, "en"), "Khelo decided in your favour: Screenshot mein 900 hain");
  assert.match(escalationStatusLine({ ...won, admin_decision: "venue" }, "ru"), /venue ki baat sahi/);
});
