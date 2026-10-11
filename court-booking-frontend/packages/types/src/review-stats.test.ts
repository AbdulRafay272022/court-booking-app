import assert from "node:assert/strict";
import test from "node:test";

import { reviewStats } from "./review";

const r = (rating: number, is_hidden = false) => ({ rating, is_hidden });

test("no reviews: no average, empty distribution", () => {
  assert.deepEqual(reviewStats([]), { count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
});

test("average and per-star counts (index 0 is 5 stars)", () => {
  const s = reviewStats([r(5), r(5), r(4), r(1)]);
  assert.equal(s.count, 4);
  assert.equal(s.average, 15 / 4);
  assert.deepEqual(s.distribution, [2, 1, 0, 0, 1]);
});

test("hidden reviews never count", () => {
  const s = reviewStats([r(5), r(1, true)]);
  assert.equal(s.count, 1);
  assert.equal(s.average, 5);
  assert.deepEqual(s.distribution, [1, 0, 0, 0, 0]);
});

test("out-of-range ratings are ignored rather than corrupting the breakdown", () => {
  const s = reviewStats([r(0), r(6), r(3.5), r(3)]);
  assert.equal(s.count, 1);
  assert.deepEqual(s.distribution, [0, 0, 1, 0, 0]);
});
