// Run: cd apps/web && npx tsx --test lib/scroll-lock.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM: body.style and window.scrollY / scrollTo.
const style: Record<string, string> = { overflow: "", position: "", top: "", width: "" };
let scrolledTo: number | null = null;
(globalThis as unknown as { document: unknown }).document = { body: { style } };
(globalThis as unknown as { window: unknown }).window = { scrollY: 640, scrollTo: (_x: number, y: number) => (scrolledTo = y) };

test("the page is pinned while an overlay is open and comes back to the same place", async () => {
  const { lockScroll, unlockScroll, scrollLockCount } = await import("./scroll-lock");
  lockScroll();
  assert.equal(style.position, "fixed");
  assert.equal(style.top, "-640px");
  lockScroll(); // a sheet opened from the popup
  unlockScroll(); // the sheet closes: the page stays locked
  assert.equal(style.position, "fixed");
  assert.equal(scrollLockCount(), 1);
  unlockScroll();
  assert.equal(style.position, "");
  assert.equal(style.overflow, "");
  assert.equal(scrolledTo, 640);
  unlockScroll(); // extra unlock is harmless
  assert.equal(scrollLockCount(), 0);
});
