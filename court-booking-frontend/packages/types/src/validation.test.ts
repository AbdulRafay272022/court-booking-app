import assert from "node:assert/strict";
import test from "node:test";

import { codepointLength, passwordError } from "./validation";

// QA (signup-venue round): client used to count UTF-16 code units via .length; Python's len()
// counts codepoints. A password with an astral-plane character (most emoji) overcounts client
// side by 1 per such character, so a password that LOOKED valid client-side (>= 8) could be
// rejected server-side.

test("codepointLength counts codepoints, not UTF-16 code units", () => {
  // 💪 is astral: str.length is 2, codepointLength is 1
  assert.equal("💪".length, 2);
  assert.equal(codepointLength("💪"), 1);

  // "パスワード💪1" -- 7 real characters (Python len returns 7)
  const pw = "パスワード💪1";
  assert.equal(codepointLength(pw), 7);
  assert.equal(pw.length, 8); // sanity: naive .length overcounts here
});

test("passwordError agrees with the backend on an astral-heavy password", () => {
  // "パスワード💪1" is 7 codepoints -- fewer than the 8-char minimum. Both client and server
  // must agree this is too short; before the fix, client accepted it (naive length 8) and
  // server rejected it (Python len 7), producing a confusing 422.
  assert.ok(passwordError("パスワード💪1"));

  // At 8 codepoints (add one more 1), both accept.
  assert.equal(passwordError("パスワード💪12"), null);

  // ASCII baseline: 7 vs 8 chars behaves the same way it always did.
  assert.ok(passwordError("abcdefg"));
  assert.equal(passwordError("abcdefgh"), null);
});
