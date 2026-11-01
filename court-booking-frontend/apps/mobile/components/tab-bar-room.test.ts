// Run: npx tsx --test components/tab-bar-room.test.ts   (from apps/mobile)
// The tab bars float over the content: every tab screen must leave bar height + home indicator under its last item.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { floatingBarRoom } from "./ui/floating-bar";

const root = join(__dirname, "..");

test("floatingBarRoom = bar offset above the home indicator + bar height + gap", () => {
  assert.equal(floatingBarRoom(0, 72), 12 + 8 + 72 + 16);
  assert.equal(floatingBarRoom(34, 70), 34 + 8 + 70 + 16);
});

test("every owner and player tab screen reserves the tab bar room", () => {
  for (const group of ["(owner)", "(player)"]) {
    const dir = join(root, "app", group, "(tabs)");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.startsWith("_"))) {
      const src = readFileSync(join(dir, f), "utf8");
      assert.ok(/useTabBarRoom\(\)|floatingBar="tabs"/.test(src), `${group}/(tabs)/${f} must use useTabBarRoom() or <Screen floatingBar="tabs">`);
      assert.ok(!/tabBarOwner \+ 64/.test(src), `${group}/(tabs)/${f}: fixed padding ignores the home indicator`);
    }
  }
});
