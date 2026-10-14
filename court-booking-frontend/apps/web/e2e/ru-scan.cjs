#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Finds visible English left in Roman Urdu mode. Input: the JSON written by e2e/text-dump.cjs (needs both `en` and `ru` per route).
 *   node e2e/ru-scan.cjs dump.json [--all]
 * Report A "same as English": a line that is character-for-character the same in `en` and `ru` on that route (so it was not translated),
 *   unless it is only brand/sport/technical words, numbers or one of the lines in ALLOW_LINES.
 * Report B "English words in Roman Urdu text": English function words / UI verbs found anywhere in a `ru` line (catches mixed lines).
 * Exit code 0 always (it is a report); the totals are printed so a script can read them.
 */
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: node e2e/ru-scan.cjs dump.json [--all]");
  process.exit(2);
}
const dump = JSON.parse(fs.readFileSync(file, "utf8"));

// Words people say in Roman Urdu as they are (technical / brand / unit words), sport names, months and the like.
const ALLOW_WORDS = new Set(
  `khelo pkr whatsapp am pm ok futsal padel cricket tennis badminton football ground karachi lahore islamabad dha clifton gulshan
   booking bookings slot slots court courts venue venues owner owners player players payment payments screenshot password otp login log in out account
   approve reject refund refunds ledger walk dashboard premium invoice staff check qr code sms email id iban bank hbl wifi ai chat live
   mon tue wed thu fri sat sun jan feb mar apr may jun jul aug sep oct nov dec min km m hr
   terms privacy blog features about contact home search signup sign up en ru roman urdu
   instagram facebook google maps leaflet openstreetmap contributors copyright aftr solutions
   demo arena test`
    .split(/\s+/),
);

// English function words / UI verbs that essentially never appear in Roman Urdu copy.
const ENGLISH_MARKERS = new Set(
  `the and your you our are was were is be been this that these those there here what when where which who why how with from for to of in on at by
   or not no yes please enter choose select click tap loading error try again back next previous submit delete edit add remove close open save cancel
   confirm continue done failed success saved sent send share copy copied upload download view show hide more less all any some none new old
   have has had can could will would should may might must need want about into over under only just also than then them they their we us my me
   if else but so as it its an a`
    .split(/\s+/),
);
// Marker words that are fine because Roman Urdu uses the same spelling: remove them from the list.
for (const w of ["a", "me", "in", "do", "to", "hum", "main", "sab", "bas", "na", "ho", "so", "or", "all", "no", "yes", "back", "open", "close", "done", "view", "more", "new", "show", "send", "save", "cancel", "confirm", "continue", "edit", "add", "remove", "copy", "share", "upload", "download", "hide", "loading", "again", "next", "previous"]) ENGLISH_MARKERS.delete(w);

// Lines that are legitimately identical in both languages (data, labels that are the same word in both).
const ALLOW_LINES = new Set(["Khelo", "EN", "Roman Urdu", "PKR", "AM", "PM", "WhatsApp"]);

const words = (s) => (s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 0);
const onlyAllowed = (line) => {
  const ws = words(line);
  return ws.length === 0 || ws.every((w) => ALLOW_WORDS.has(w));
};

let sameTotal = 0;
let wordTotal = 0;
const lines = [];
for (const [route, langs] of Object.entries(dump)) {
  const en = (langs.en || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const ru = (langs.ru || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!langs.ru || langs.ru.startsWith("ERROR")) {
    lines.push(`\n## ${route}\n  (no ru dump: ${langs.ru || "missing"})`);
    continue;
  }
  const enSet = new Set(en);
  const same = [];
  const marked = [];
  for (const line of ru) {
    if (ALLOW_LINES.has(line) || onlyAllowed(line)) continue;
    if (enSet.has(line)) same.push(line);
    else {
      const hit = words(line).filter((w) => ENGLISH_MARKERS.has(w) && !ALLOW_WORDS.has(w));
      if (hit.length >= 1) marked.push(`${line}   [${[...new Set(hit)].join(", ")}]`);
    }
  }
  sameTotal += same.length;
  wordTotal += marked.length;
  if (same.length || marked.length) {
    lines.push(`\n## ${route}`);
    for (const l of same) lines.push(`  SAME   ${l.slice(0, 150)}`);
    for (const l of marked) lines.push(`  WORDS  ${l.slice(0, 170)}`);
  }
}
console.log(lines.join("\n"));
console.log(`\nTOTAL: ${sameTotal} line(s) identical to English, ${wordTotal} line(s) with English words, across ${Object.keys(dump).length} routes`);
