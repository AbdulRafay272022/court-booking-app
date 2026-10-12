import assert from "node:assert/strict";
import test from "node:test";
import { NAMESPACES, ru, en } from "../messages";
import { interpolate, parseLang, translate } from "./i18n";

const vars = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

test("en and ru have identical key sets", () => {
  const a = Object.keys(ru).sort();
  const b = Object.keys(en).sort();
  assert.deepEqual(
    a.filter((k) => !b.includes(k)),
    [],
    "keys missing from en",
  );
  assert.deepEqual(
    b.filter((k) => !a.includes(k)),
    [],
    "keys missing from ru",
  );
});

test("no empty values and every key starts with a known namespace", () => {
  for (const [lang, dict] of [
    ["ru", ru],
    ["en", en],
  ] as const) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(String(value).trim().length > 0, `${lang}:${key} is empty`);
      const prefix = key.split(".")[0];
      assert.ok((NAMESPACES as readonly string[]).includes(prefix), `${key}: unknown prefix '${prefix}'`);
    }
  }
});

test("placeholders match between languages", () => {
  for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
    assert.equal(vars(ru[key]), vars(en[key]), `${key}: {placeholders} differ between ru and en`);
  }
});

test("translate interpolates, and parseLang defaults to ru", () => {
  assert.equal(interpolate("Hi {name}", { name: "Ali" }), "Hi Ali");
  assert.equal(interpolate("Hi {name}"), "Hi {name}");
  assert.equal(parseLang(undefined), "ru");
  assert.equal(parseLang("en"), "en");
  assert.equal(parseLang("fr"), "ru");
  assert.equal(translate("en", "common.lang.en"), "EN");
});

test("no double-encoded text (mojibake) in either dictionary", () => {
  const c = String.fromCharCode;
  const bad = new RegExp("[" + c(0xc2, 0xc3) + "][" + c(0x80) + "-" + c(0xbf) + "]|" + c(0xe2, 0x20ac) + "|" + c(0xfffd));
  for (const dict of [ru, en]) for (const [k, v] of Object.entries(dict)) assert.ok(!bad.test(String(v)), `${k} looks garbled`);
});
