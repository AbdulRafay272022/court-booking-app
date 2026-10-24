import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSheetLifecycle } from "./ui/sheet-lifecycle";

test("sheet lifecycle: closed on mount never dismisses (gorhom DISMISSING trap)", () => {
  const l = createSheetLifecycle();
  l.mount();
  assert.equal(l.setOpen(false), "none");
  assert.equal(l.presented, false);
});

test("sheet lifecycle: open presents once, close dismisses once", () => {
  const l = createSheetLifecycle();
  l.mount();
  assert.equal(l.setOpen(true), "present");
  assert.equal(l.setOpen(true), "none");
  assert.equal(l.presented, true);
  assert.equal(l.setOpen(false), "dismiss");
  assert.equal(l.setOpen(false), "none");
});

test("sheet lifecycle: a user dismissal (backdrop / pan / close) notifies the owner", () => {
  const l = createSheetLifecycle();
  l.mount();
  l.setOpen(true);
  assert.equal(l.dismissed(), "notifyClose");
  assert.equal(l.presented, false);
  // the owner then sets open=false: nothing left to dismiss
  assert.equal(l.setOpen(false), "none");
  // and it can open again
  assert.equal(l.setOpen(true), "present");
});

test("sheet lifecycle: unmount while open dismisses instantly and never calls the gone owner", () => {
  const l = createSheetLifecycle();
  l.mount();
  l.setOpen(true);
  assert.equal(l.unmount(), "dismissInstant");
  assert.equal(l.dismissed(), "none");
  assert.equal(l.setOpen(true), "none");
  assert.equal(l.unmount(), "none");
});

test("sheet lifecycle: unmount while closed does nothing; remount works again", () => {
  const l = createSheetLifecycle();
  l.mount();
  assert.equal(l.unmount(), "none");
  l.mount();
  assert.equal(l.setOpen(true), "present");
  assert.equal(l.dismissed(), "notifyClose");
});

const src = (f: string) => readFileSync(join(__dirname, "ui", f), "utf8");

test("Sheet re-provides role / lang / font scale / toast inside the portal and stacks with push", () => {
  const s = src("Sheet.tsx");
  for (const p of ["<RoleProvider role={role}>", "<LangProvider lang={lang}>", "<FontScaleProvider scale={fontScale}>", "<ToastBridge value={toast}>"]) assert.ok(s.includes(p), p);
  assert.ok(s.includes('stackBehavior="push"'));
  assert.ok(s.includes("onCloseRef.current()"), "onClose goes through a ref (latest prop)");
  assert.ok(s.includes("dismiss({ duration: 0 })"), "unmount while open closes without animation");
});

test("RadioGroup / Checkbox / Switch expose aria-checked for the web accessibility tree", () => {
  const s = src("Controls.tsx");
  assert.ok(s.includes("aria-checked={on}"));
  assert.ok(s.includes("aria-checked={checked}"));
  assert.ok(s.includes("aria-checked={value}"));
});
