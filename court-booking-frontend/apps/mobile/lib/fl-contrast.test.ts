import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  colorPairs,
  contrast,
  EXEMPT_PAIRS,
  MIN_TEXT,
  MIN_UI,
  over,
  palette,
  role,
  buttonVariant,
  type ColorPair,
} from "@court-booking/ui-tokens";
import { tailwindCjs, themeCss } from "../../../packages/ui-tokens/src/generate";

function ratio(p: ColorPair): number {
  if (!p.over) return contrast(p.fg, p.bg);
  const c = over(p.bg, p.over);
  return contrast(p.fg, `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`);
}

test("contrast math matches the System board's tested values", () => {
  assert.equal(contrast(palette.night, palette.orange), 5.98);
  assert.equal(contrast(palette.white, palette.orange), 2.86);
  assert.equal(contrast(palette.white, palette.teal), 5.06);
  assert.equal(contrast(palette.night, palette.ground), 15.74);
  assert.equal(contrast(palette.muted, palette.ground), 6.44);
  assert.equal(contrast(palette.open, palette.openTint), 5.75);
  assert.equal(contrast(palette.waiting, palette.waitingTint), 5.31);
  assert.equal(contrast(palette.bannedGrey, palette.white), 2.97);
});

test("every text pair the components use is >= 4.5:1 and every UI pair >= 3:1", () => {
  const failures: string[] = [];
  const rows: string[] = [];
  for (const p of colorPairs()) {
    const r = ratio(p);
    const min = p.kind === "text" ? MIN_TEXT : MIN_UI;
    rows.push(`${r.toFixed(2).padStart(6)}  ${p.kind.padEnd(4)}  ${p.name}`);
    if (r < min) failures.push(`${p.name}: ${p.fg} on ${p.bg}${p.over ? ` over ${p.over}` : ""} = ${r} (< ${min})`);
  }
  if (process.env.FL_CONTRAST_REPORT) console.log(rows.join("\n"));
  assert.deepEqual(failures, []);
  assert.ok(colorPairs().length > 90, "the pair list covers the component set");
});

test("exempt pairs are UI-only, below 3:1 on purpose, and each has a reason", () => {
  for (const p of EXEMPT_PAIRS) {
    assert.equal(p.kind, "ui", p.name);
    assert.ok(p.why.length > 20, p.name);
  }
  const exemptKeys = new Set(EXEMPT_PAIRS.map((p) => `${p.fg}|${p.bg}`));
  for (const p of colorPairs()) {
    if (p.kind === "text") assert.ok(!exemptKeys.has(`${p.fg}|${p.bg}`), `text pair ${p.name} reuses an exempt colour pair`);
  }
});

test("no white text on orange anywhere, and no orange primary on the owner side", () => {
  const white = palette.white.toUpperCase();
  const orange = palette.orange.toUpperCase();
  for (const p of colorPairs()) {
    const onOrange = p.bg.toUpperCase() === orange;
    assert.ok(!(onOrange && p.fg.toUpperCase() === white), `white on orange: ${p.name}`);
  }
  const o = role.owner;
  for (const [name, v] of Object.entries({
    primary: o.primary.bg,
    tabActive: o.tabActive.bg,
    selected: o.selected.bg,
    selectedBorder: o.selected.border,
    slotSelected: o.slotSelected.bg,
    control: o.control.onBg,
    switchOn: o.switchOn,
    ring: o.ring,
    fab: o.fab?.bg ?? "",
    link: o.link,
  })) {
    assert.notEqual(v.toUpperCase(), orange, `owner ${name} must not be orange`);
  }
  // On the owner side orange is allowed only as the badge and the "now" line, always with ink.
  assert.equal(o.badge.fg, palette.night);
  assert.equal(role.player.primary.fg, palette.night, "orange buttons use ink");
  assert.equal(role.owner.primary.fg, palette.white, "teal buttons use white");
  for (const v of Object.values(buttonVariant)) assert.notEqual(v.bg.toUpperCase(), orange);
});

test("small text never uses the banned grey #8A9996", () => {
  for (const p of colorPairs()) assert.notEqual(p.fg.toUpperCase(), palette.bannedGrey.toUpperCase(), p.name);
});

test("generated tailwind.cjs and theme.css are in sync with the tokens", () => {
  const dir = join(__dirname, "..", "..", "..", "packages", "ui-tokens", "generated");
  const norm = (s: string) => s.replace(/\r\n/g, "\n");
  assert.equal(norm(readFileSync(join(dir, "tailwind.cjs"), "utf8")), tailwindCjs(), "run: npm run generate --workspace=@court-booking/ui-tokens");
  assert.equal(norm(readFileSync(join(dir, "theme.css"), "utf8")), themeCss(), "run: npm run generate --workspace=@court-booking/ui-tokens");
});

// --- no hex literals in the component libraries (the token package is the only place with hex) ---
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
const RGBA = /\brgba?\(/g;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("no hex / rgba colour literal in mobile components/ui, the dev page or web components/fl", () => {
  const root = join(__dirname, "..");
  const dirs = [join(root, "components", "ui"), join(root, "app", "dev"), join(root, "..", "web", "components", "fl"), join(root, "..", "web", "app", "dev")];
  const extra: string[] = [];
  const bad: string[] = [];
  let scanned = 0;
  for (const f of [...dirs.flatMap(files), ...extra.filter(existsSync)]) {
    scanned++;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Strip HTML entities like &#x2713; and URL fragments ("#top") are not colours; only flag 3/6/8-digit hex.
        const clean = line.replace(/&#x?[0-9a-fA-F]+;/g, "");
        for (const m of clean.match(HEX) ?? []) bad.push(`${relative(root, f)}:${i + 1} ${m}`);
        if (RGBA.test(clean)) bad.push(`${relative(root, f)}:${i + 1} rgba()`);
        RGBA.lastIndex = 0;
      });
  }
  assert.ok(scanned >= 20, `expected the component libraries to exist (scanned ${scanned})`);
  assert.deepEqual(bad, []);
});
