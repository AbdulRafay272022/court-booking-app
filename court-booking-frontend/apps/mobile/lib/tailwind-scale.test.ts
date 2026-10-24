import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// NativeWind only generates classes that exist in the Tailwind scale. A class like `p-4.5` or `h-13` is silently dropped
// (no padding, no height), which is how 18 screens ended up with text touching card edges (docs/mobile-audit-2026-10.md G1).
// tailwind.config.js has no `spacing` extend, so only Tailwind 3's default spacing keys are valid.
const SCALE = new Set([
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20",
  "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96",
]);
const PREFIXES = [
  "p", "px", "py", "pt", "pb", "pl", "pr", "ps", "pe", "m", "mx", "my", "mt", "mb", "ml", "mr", "ms", "me",
  "gap", "gap-x", "gap-y", "space-x", "space-y", "w", "h", "min-w", "min-h", "max-h", "size", "inset", "inset-x", "inset-y",
  "top", "bottom", "left", "right", "translate-x", "translate-y",
];
// Longest prefix first, so `gap-x-4.5` is read as gap-x + 4.5, not gap + x-4.5.
const PREFIX_RE = PREFIXES.slice().sort((a, b) => b.length - a.length).map((p) => p.replace(/-/g, "\\-")).join("|");
const CLASS_RE = new RegExp(`(?<![\\w\\-\\[])-?(?:${PREFIX_RE})-(\\d+(?:\\.\\d+)?)(?![\\w.\\-\\]])`, "g");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every `className`-ish string literal on one line: we scan whole lines, which is enough because the classes live in
 * quoted strings and the numeric part is what matters. */
export function invalidSpacingClasses(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(CLASS_RE)) if (!SCALE.has(m[1])) found.push(m[0]);
  return found;
}

test("invalidSpacingClasses: flags off-scale values and accepts scale and arbitrary values", () => {
  assert.deepEqual(invalidSpacingClasses('className="p-4.5 px-5 gap-5.5 h-13 w-[18px] py-2.5 -mt-0.5 gap-x-4.5"'), [
    "p-4.5",
    "gap-5.5",
    "h-13",
    "gap-x-4.5",
  ]);
  assert.deepEqual(invalidSpacingClasses('className="text-[13.5px] rounded-2xl tracking-[0.1em] flex-1 z-10"'), []);
});

test("no screen or component uses a spacing class NativeWind cannot generate", () => {
  const root = join(__dirname, "..");
  const bad: string[] = [];
  for (const dir of ["app", "components"]) {
    for (const file of sourceFiles(join(root, dir))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const c of invalidSpacingClasses(line)) bad.push(`${relative(root, file)}:${i + 1} ${c}`);
        });
    }
  }
  assert.deepEqual(bad, []);
});
