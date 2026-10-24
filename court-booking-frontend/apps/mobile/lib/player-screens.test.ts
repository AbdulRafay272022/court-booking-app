import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Floodlight M1: the player + auth screens use ONLY @/components/ui + tokens. No colour literal, no NativeWind class
// strings, no old player components (components/error-state, offline-banner, icons, the old kit look).
const root = join(__dirname, "..");
const DIRS = [join(root, "app", "(player)"), join(root, "app", "(auth)")];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/;
const RGBA = /\brgba?\(/;

test("player + auth screens: no hex / rgba colour literal", () => {
  const bad: string[] = [];
  for (const f of DIRS.flatMap(files)) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const clean = line.replace(/&#x?[0-9a-fA-F]+;/g, "");
        if (HEX.test(clean) || RGBA.test(clean)) bad.push(`${relative(root, f)}:${i + 1}`);
      });
  }
  assert.deepEqual(bad, []);
});

test("player + auth screens: no className strings (Floodlight components only)", () => {
  const bad = DIRS.flatMap(files).filter((f) => /className=/.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
  assert.deepEqual(bad, []);
});

test("player + auth screens: no old shared look (error-state, offline-banner, icons, kit form widgets)", () => {
  const banned = [/@\/components\/error-state/, /@\/components\/offline-banner/, /@\/components\/icons/, /@\/lib\/colors/, /\b(TextField|PasswordField|SubmitButton|FormMessage|ChoicePills|SelectField|AuthScreen|AccountScreen)\b/];
  const bad: string[] = [];
  for (const f of DIRS.flatMap(files)) {
    const src = readFileSync(f, "utf8");
    for (const re of banned) if (re.test(src)) bad.push(`${relative(root, f)} ${re}`);
  }
  assert.deepEqual(bad, []);
});

test("player + auth screens: 'Pakki' / 'Court aap ka hai' copy only comes from the shared status rules", () => {
  const bad: string[] = [];
  for (const f of DIRS.flatMap(files)) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // comments may name the rule
        if (/["'`][^"'`]*\b(Pakki|Court aap ka hai|Confirmed)\b/.test(line)) bad.push(`${relative(root, f)}:${i + 1}`);
      });
  }
  assert.deepEqual(bad, []);
});
