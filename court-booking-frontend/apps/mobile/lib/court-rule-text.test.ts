import test from "node:test";
import assert from "node:assert/strict";

import { hiddenRateText, ruleWhenText } from "./court-rule-text";

test("ruleWhenText: board wording", () => {
  assert.equal(ruleWhenText({ dayOfWeek: null, startTime: null, endTime: null }, true, true), "Baqi sab waqt");
  assert.equal(ruleWhenText({ dayOfWeek: null, startTime: null, endTime: null }, true, false), "Rozana · poora din");
  assert.equal(ruleWhenText({ dayOfWeek: [5, 6], startTime: null, endTime: null }, false, true), "Sat, Sun · poora din");
  assert.equal(ruleWhenText({ dayOfWeek: null, startTime: "18:00", endTime: "23:00" }, false, true), "Rozana · 6 PM – 11 PM");
  assert.equal(ruleWhenText({ dayOfWeek: [0, 1, 2, 3, 4], startTime: "17:30", endTime: null }, false, true), "Mon–Fri · 5:30 PM se");
  assert.equal(ruleWhenText({ dayOfWeek: [2, 0], startTime: null, endTime: "09:00" }, false, true), "Mon, Wed · 9 AM tak");
});

test("hiddenRateText names the rate that hides it", () => {
  assert.match(hiddenRateText({ byName: "Aam", byNarrower: false }), /neeche wale "Aam" se chhup raha hai/);
  assert.match(hiddenRateText({ byName: "another rate", byNarrower: true }), /doosra rate is se chhota hai/);
});
