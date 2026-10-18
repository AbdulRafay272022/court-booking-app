import test from "node:test";
import assert from "node:assert/strict";
import { numberValue, romanFix } from "./roman-fix";

test("Urdu number words become digits (spec examples)", () => {
  assert.equal(romanFix("do hazaar paanch sau"), "2500");
  assert.equal(romanFix("dedh hazaar"), "1500");
  assert.equal(romanFix("dhai hazaar"), "2500");
  assert.equal(romanFix("dhai sau"), "250");
  assert.equal(romanFix("saadhe teen hazaar"), "3500");
  assert.equal(romanFix("sawa do hazaar"), "2250");
  assert.equal(romanFix("paune do hazaar"), "1750");
  assert.equal(romanFix("ek hazaar do sau pachaas"), "1250");
  assert.equal(romanFix("pandrah sau"), "1500");
  assert.equal(romanFix("ek lakh"), "100000");
  assert.equal(romanFix("2 hazaar"), "2000");
  assert.equal(romanFix("hazaar"), "1000");
});

test("numbers inside a sentence keep the words around them", () => {
  assert.equal(romanFix("do hazaar mile baqi paanch sau rehte hain"), "2000 mile baqi 500 rehte hain");
  assert.equal(romanFix("customer ne kaha baqi paisa kal dega"), "customer ne kaha baqi paisa kal dega");
  assert.equal(romanFix("baqi 2500, kal"), "baqi 2500, kal");
});

test("ambiguous small words stay words", () => {
  assert.equal(romanFix("de do"), "de do"); // the verb "give"
  assert.equal(romanFix("ek baat"), "ek baat");
  assert.equal(romanFix("saath aaya"), "saath aaya"); // "with"
  assert.equal(romanFix("nau baje"), "nau baje");
  assert.equal(romanFix("so what"), "so what");
  assert.equal(romanFix("bees minute"), "20 minute");
});

test("spelling variants of booking words", () => {
  assert.equal(romanFix("baaki pese kall"), "baqi paise kal");
  assert.equal(romanFix("Hazar"), "1000");
  assert.equal(romanFix("adwance wapis"), "advance wapas");
  assert.equal(romanFix("kort ki bukking"), "court ki booking");
  assert.equal(romanFix("Customer ne"), "Customer ne"); // unknown words keep their case
});

test("numberValue", () => {
  assert.equal(numberValue(["do", "hazaar", "paanch", "sau"]), 2500);
  assert.equal(numberValue(["dedh"]), null); // 1.5 is not a whole number
  assert.equal(numberValue(["saadhe"]), null);
  assert.equal(numberValue(["baqi"]), null);
});
