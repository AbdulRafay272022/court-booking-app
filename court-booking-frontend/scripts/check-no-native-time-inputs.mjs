// Fails when app code brings back a browser/device-formatted time or date control. Those show 24-hour or a
// different date order depending on the machine (Section 32: nothing user-facing may ever read "23:00"),
// so all times go through the shared 12-hour pickers and the formatters in packages/types/src/datetime.ts.
// Run: npm run check:time-inputs   (from court-booking-frontend)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["apps/web", "apps/mobile", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", "out", ".turbo"]);
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const BANNED = [
  [/type\s*=\s*\{?\s*["'](time|date|datetime-local)["']/, 'native <input type="time|date|datetime-local">'],
  [/\btoLocale(Time|Date)?String\s*\(/, "toLocaleString / toLocaleTimeString / toLocaleDateString (device locale, can print 24-hour)"],
  [/\bhour12\s*:/, "hour12: option (Intl formatter override)"],
  [/toISOString\(\)\s*\.\s*(slice|substring|split)/, "toISOString().slice/split (UTC date, wrong for Pakistan after midnight)"],
];
// toLocaleString("en-US") on plain numbers (prices) is fine and used by format helpers.
const ALLOW_LINE = /\.toLocaleString\(\s*["']en-US["']\s*\)/;

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (EXT.test(name) && !/\.test\.[tj]sx?$/.test(name)) scan(full);
  }
}
function scan(file) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (ALLOW_LINE.test(line)) return;
    for (const [re, why] of BANNED) if (re.test(line)) hits.push(`${relative(".", file)}:${i + 1}  ${why}\n    ${t}`);
  });
}
for (const r of ROOTS) walk(r);

if (hits.length) {
  console.error(`Found ${hits.length} device-formatted time/date use(s):\n` + hits.join("\n"));
  process.exit(1);
}
console.log("ok: no native time/date inputs or device-locale time formatting in apps/ or packages/");
