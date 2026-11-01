// Fails when a mobile file passes a FUNCTION style (`style={({ pressed }) => ...}`) to React Native's own Pressable.
// NativeWind wraps that Pressable and on Android drops a function style completely (no background, padding, size or
// row layout: the 2026-10-31 emulator audit found the Approve button and the "+" tab invisible because of it).
// Such files must import Pressable from "@/components/ui" (components/ui/Pressable.tsx resolves the function itself).
// Run: npm run check:pressable   (from court-booking-frontend)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "apps/mobile";
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", "android", "ios"]);
const RN_PRESSABLE = /import\s*\{[^}]*\bPressable\b(?!\s+as)[^}]*\}\s*from\s*["']react-native["']/;
const FN_STYLE = /style=\{\s*\(\s*\{\s*pressed/;

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx$/.test(name)) {
      const src = readFileSync(full, "utf8");
      if (RN_PRESSABLE.test(src) && FN_STYLE.test(src)) hits.push(relative(".", full));
    }
  }
}
walk(ROOT);

if (hits.length) {
  console.error(`Function style on React Native's Pressable (invisible on Android). Import Pressable from "@/components/ui" instead:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log("check:pressable ok");
