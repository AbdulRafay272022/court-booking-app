import { test } from "node:test";
import assert from "node:assert/strict";
import { counterText, stepIndex, swipeDelta } from "./gallery-nav";

test("stepIndex wraps both ways and clamps a stale index", () => {
  assert.equal(stepIndex(0, 1, 6), 1);
  assert.equal(stepIndex(5, 1, 6), 0);
  assert.equal(stepIndex(0, -1, 6), 5);
  assert.equal(stepIndex(9, 0, 3), 2);
  assert.equal(stepIndex(0, 1, 0), 0);
  assert.equal(stepIndex(0, 1, 1), 0);
});

test("swipeDelta: left = next, right = previous, taps and vertical scrolls do nothing", () => {
  assert.equal(swipeDelta({ x: 200, y: 10 }, { x: 100, y: 20 }), 1);
  assert.equal(swipeDelta({ x: 100, y: 10 }, { x: 200, y: 0 }), -1);
  assert.equal(swipeDelta({ x: 100, y: 10 }, { x: 110, y: 10 }), 0);
  assert.equal(swipeDelta({ x: 100, y: 0 }, { x: 160, y: 120 }), 0);
  assert.equal(swipeDelta(null, { x: 0, y: 0 }), 0);
});

test("counterText shows 1/6 style only with 2+ photos", () => {
  assert.equal(counterText(0, 6), "1/6");
  assert.equal(counterText(5, 6), "6/6");
  assert.equal(counterText(0, 1), null);
  assert.equal(counterText(0, 0), null);
});
