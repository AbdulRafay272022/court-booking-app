import test from "node:test";
import assert from "node:assert/strict";
import { cnicDigits, cnicImageProblem, formatCnic, isValidCnic } from "./cnic";
import { identityErrorKey } from "./identity-errors";

test("mask while typing: 12345-1234567-1", () => {
  assert.equal(formatCnic(""), "");
  assert.equal(formatCnic("352"), "352");
  assert.equal(formatCnic("35202"), "35202");
  assert.equal(formatCnic("352021"), "35202-1");
  assert.equal(formatCnic("352021234567"), "35202-1234567");
  assert.equal(formatCnic("3520212345671"), "35202-1234567-1");
  // extra digits are dropped, letters ignored, pasted dashes re-placed
  assert.equal(formatCnic("35202123456719"), "35202-1234567-1");
  assert.equal(formatCnic("35a202-12345 67-1"), "35202-1234567-1");
  assert.equal(cnicDigits("35202-1234567-1"), "3520212345671");
});

test("valid = exactly 13 digits once dashes are removed", () => {
  assert.equal(isValidCnic("35202-1234567-1"), true);
  assert.equal(isValidCnic("3520212345671"), true);
  assert.equal(isValidCnic("35202-1234567"), false);
  assert.equal(isValidCnic("35202-1234567-12"), false);
  assert.equal(isValidCnic("35202-12345x7-1"), false);
  assert.equal(isValidCnic(""), false);
});

test("photo checks: jpeg/png/webp up to 10 MB", () => {
  assert.equal(cnicImageProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(cnicImageProblem({ type: "image/webp", size: 10 * 1024 * 1024 }), null);
  assert.equal(cnicImageProblem({ type: "application/pdf", size: 1000 }), "type");
  assert.equal(cnicImageProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 }), "size");
});

test("CNIC error codes map to cnic.* keys", () => {
  assert.equal(identityErrorKey("CNIC_INVALID"), "cnic.err.invalid");
  assert.equal(identityErrorKey("CNIC_NOT_CONFIGURED"), "cnic.err.notConfigured");
  assert.equal(identityErrorKey("SOMETHING_ELSE"), null);
});
