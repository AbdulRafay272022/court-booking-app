import assert from "node:assert/strict";
import test from "node:test";
import { MAX_FACTOR, clampPan, fitScale, fitView, isFit, isMax, zoomAt, zoomPercent } from "./zoom";

const stage = { w: 400, h: 800 };
const tall = { w: 1080, h: 2400 }; // a phone screenshot
const wide = { w: 2000, h: 500 };

test("fit uses the tighter side and never returns 0", () => {
  assert.equal(fitScale(stage, tall), 800 / 2400);
  assert.equal(fitScale(stage, wide), 400 / 2000);
  assert.equal(fitScale({ w: 0, h: 0 }, tall), 1);
  assert.equal(fitScale(stage, { w: 0, h: 10 }), 1);
});

test("zoom is clamped between fit and 4x fit", () => {
  const fit = fitView(stage, tall);
  const out = zoomAt(fit, fit.scale / 10, { x: 0, y: 0 }, stage, tall);
  assert.deepEqual(out, fit, "cannot go below fit");
  const big = zoomAt(fit, fit.scale * 100, { x: 0, y: 0 }, stage, tall);
  assert.equal(big.scale, fit.scale * MAX_FACTOR);
  assert.ok(isMax(big, stage, tall));
  assert.equal(zoomPercent(big, stage, tall), 400);
});

test("zooming back out to fit recentres the image", () => {
  const fit = fitView(stage, tall);
  const zoomed = zoomAt(fit, fit.scale * 3, { x: 150, y: 300 }, stage, tall);
  assert.notEqual(zoomed.x, 0);
  const back = zoomAt(zoomed, fit.scale, { x: -100, y: 0 }, stage, tall);
  assert.deepEqual(back, fit);
  assert.ok(isFit(back, stage, tall));
});

test("the focus point stays under the cursor while zooming", () => {
  const fit = fitView(stage, tall);
  const focus = { x: 50, y: -100 };
  const z = zoomAt(fit, fit.scale * 2, focus, stage, tall);
  // image point under focus before: (focus - pan) / scale
  const before = (focus.x - fit.x) / fit.scale;
  const after = (focus.x - z.x) / z.scale;
  assert.ok(Math.abs(before - after) < 1e-9);
});

test("pan is clamped so the image never leaves the stage", () => {
  const fit = fitView(stage, tall);
  const z = zoomAt(fit, fit.scale * 2, { x: 0, y: 0 }, stage, tall);
  const dragged = clampPan({ ...z, x: 10_000, y: -10_000 }, stage, tall);
  const dw = tall.w * z.scale;
  const dh = tall.h * z.scale;
  assert.equal(dragged.x, (dw - stage.w) / 2);
  assert.equal(dragged.y, -(dh - stage.h) / 2);
  // at fit the image is not pannable at all
  assert.deepEqual(clampPan({ ...fit, x: 40, y: 40 }, stage, tall), fit);
});
