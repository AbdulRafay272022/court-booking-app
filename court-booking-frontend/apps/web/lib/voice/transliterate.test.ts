import test from "node:test";
import assert from "node:assert/strict";
import { hasUrduScript, transliterate, transliterateLetters, ur } from "./transliterate";
import { appendPhrase, toRomanUrdu } from "./convert";

test("dictionary words", () => {
  assert.equal(transliterate("\u06a9\u0644"), "kal");
  assert.equal(transliterate("\u0622\u062c"), "aaj");
  assert.equal(transliterate("\u0628\u0627\u0642\u06cc \u067e\u06cc\u0633\u06c1"), "baqi paisa");
  assert.equal(transliterate("\u062f\u06d2 \u06af\u0627"), "dega"); // two-word entry
  assert.equal(transliterate("\u0631\u06cc \u0641\u0646\u0688"), "refund");
});

test("letter rules insert the unwritten short vowel", () => {
  assert.equal(transliterateLetters([...ur("rqm")]), "raqam");
  assert.equal(transliterateLetters([...ur("xtm")]), "khatam");
  assert.equal(transliterateLetters([...ur("k@yl")]), "khel");
  assert.equal(transliterateLetters([...ur("krw")]), "karo");
  assert.equal(transliterateLetters([...ur("slmAn")]), "salman");
  assert.equal(transliterateLetters([...ur("swAl")]), "sawal");
  assert.equal(transliterateLetters([...ur("myry")]), "meri");
});

test("digits, punctuation, Latin and spacing", () => {
  assert.equal(transliterate("\u06f2\u06f5\u06f0\u06f0"), "2500"); // Urdu digits
  assert.equal(transliterate("\u0662\u0665"), "25"); // Arabic-Indic digits
  assert.equal(transliterate("\u06a9\u0644\u06d4"), "kal.");
  assert.equal(transliterate("\u06a9\u0644\u061f"), "kal?");
  assert.equal(transliterate("booking \u06a9\u0644"), "booking kal");
  assert.equal(transliterate("Hello, 123"), "Hello, 123");
  assert.equal(transliterate(""), "");
});

test("Arabic letter variants and joiners are folded", () => {
  assert.equal(transliterate("\u0643\u0644"), "kal"); // arabic kaf
  assert.equal(transliterate("\u0628\u0627\u0642\u064a"), "baqi"); // arabic yeh
  assert.equal(transliterate("\u06a9\u200c\u0644"), "kal"); // ZWNJ inside a word
});

test("output is Latin only", () => {
  const out = toRomanUrdu("\u0639\u0628\u0627\u0633 \u0638\u0641\u0631 \u0646\u06d2 \u06a9\u06c1\u0627 \u067e\u06cc\u0633\u06d2 \u0628\u0639\u062f \u0645\u06cc\u06ba");
  assert.equal(hasUrduScript(out), false, out);
  assert.match(out, /^[a-z0-9 ]+$/);
  assert.equal(hasUrduScript("abc"), false);
  assert.equal(hasUrduScript("\u06a9"), true);
});

test("appendPhrase joins with one space and respects maxLength", () => {
  assert.equal(appendPhrase("", "kal dega"), "kal dega");
  assert.equal(appendPhrase("baqi", "kal dega"), "baqi kal dega");
  assert.equal(appendPhrase("baqi ", "kal"), "baqi kal");
  assert.equal(appendPhrase("abc", "   "), "abc");
  assert.equal(appendPhrase("abcd", "efgh", 6), "abcd e");
});
