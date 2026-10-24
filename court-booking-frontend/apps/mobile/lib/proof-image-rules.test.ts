import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@court-booking/api-client";

import { isRetryableUploadError, jpegName, PROOF_JPEG_QUALITY, PROOF_MAX_SIDE, proofResize } from "./proof-image-rules";

test("proofResize: long side capped at 1600, aspect kept, never upscaled", () => {
  assert.equal(PROOF_MAX_SIDE, 1600);
  assert.equal(PROOF_JPEG_QUALITY, 0.7);
  assert.deepEqual(proofResize(1080, 2400), { height: 1600 }); // portrait phone screenshot
  assert.deepEqual(proofResize(4032, 3024), { width: 1600 }); // landscape camera photo
  assert.deepEqual(proofResize(3000, 3000), { width: 1600 });
  assert.equal(proofResize(720, 1600), null);
  assert.equal(proofResize(800, 600), null);
  assert.equal(proofResize(0, 0), null); // unknown size (some web pickers): re-encode only
});

test("jpegName: the re-encoded file is always .jpg", () => {
  assert.equal(jpegName("IMG_2024.HEIC"), "IMG_2024.jpg");
  assert.equal(jpegName("screenshot.png"), "screenshot.jpg");
  assert.equal(jpegName("proof"), "proof.jpg");
  assert.equal(jpegName(".png"), "proof.jpg");
});

test("isRetryableUploadError: timeouts and network drops are retryable, server refusals are not", () => {
  assert.equal(isRetryableUploadError(new ApiError("REQUEST_TIMEOUT", "timed out", 0)), true);
  assert.equal(isRetryableUploadError(new ApiError("UNKNOWN_ERROR", "Network request failed", 0)), true);
  assert.equal(isRetryableUploadError(new ApiError("INVALID_BOOKING_STATE", "not held", 409)), false);
  assert.equal(isRetryableUploadError(new ApiError("FILE_TOO_LARGE", "too big", 413)), false);
  assert.equal(isRetryableUploadError(new Error("boom")), true);
});
