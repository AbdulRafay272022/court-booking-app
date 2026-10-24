import test from "node:test";
import assert from "node:assert/strict";

import { refundAmountFor } from "./refund-confirm";

test("refundAmountFor: the screenshot's amount when OCR read one, else the advance asked for (same as the backend)", () => {
  assert.equal(refundAmountFor({ ocr_amount: 2500, expected_amount: 2000 }), 2500);
  assert.equal(refundAmountFor({ ocr_amount: null, expected_amount: 2000 }), 2000);
  assert.equal(refundAmountFor({ ocr_amount: 0, expected_amount: 2000 }), 2000);
});
