// Offline accuracy check for the free voice pipeline (A9 item 3). Speech cannot be recorded here, so each case is a transcript of
// the kind Chrome's ur-PK recogniser returns (Urdu script, sometimes with English words in Latin letters, sometimes Urdu digits),
// written as \u escapes so the source stays ASCII. Each goes through toRomanUrdu (transliterate + roman-fix) and is compared with
// the Roman Urdu a person would type. Run: npx tsx --test lib/voice/accuracy.test.ts (prints the table).
import test from "node:test";
import assert from "node:assert/strict";
import { toRomanUrdu } from "./convert";

type Kind = "booking words" | "numbers" | "English mixed" | "name" | "everyday";

interface Case {
  input: string;
  expected: string;
  kind: Kind;
  /** Written after the dictionary was last changed and never tuned for (a fairer estimate). */
  heldOut?: boolean;
}

export const PHRASES: Case[] = [
  // customer ne kaha baqi paisa kal dega
  { kind: "booking words", expected: "customer ne kaha baqi paisa kal dega", input: "\u06a9\u0633\u0679\u0645\u0631 \u0646\u06d2 \u06a9\u06c1\u0627 \u0628\u0627\u0642\u06cc \u067e\u06cc\u0633\u06c1 \u06a9\u0644 \u062f\u06d2 \u06af\u0627" },
  // do hazaar mile baqi paanch sau rehte hain
  { kind: "numbers", expected: "2000 mile baqi 500 rehte hain", input: "\u062f\u0648 \u06c1\u0632\u0627\u0631 \u0645\u0644\u06d2 \u0628\u0627\u0642\u06cc \u067e\u0627\u0646\u0686 \u0633\u0648 \u0631\u06c1\u062a\u06d2 \u06c1\u06cc\u06ba" },
  // dedh hazaar advance diya tha
  { kind: "numbers", expected: "1500 advance diya tha", input: "\u0688\u06cc\u0691\u06be \u06c1\u0632\u0627\u0631 \u0627\u06cc\u0688\u0648\u0627\u0646\u0633 \u062f\u06cc\u0627 \u062a\u06be\u0627" },
  // baqi do hazaar paanch sau kal shaam tak
  { kind: "numbers", expected: "baqi 2500 kal shaam tak", input: "\u0628\u0627\u0642\u06cc \u062f\u0648 \u06c1\u0632\u0627\u0631 \u067e\u0627\u0646\u0686 \u0633\u0648 \u06a9\u0644 \u0634\u0627\u0645 \u062a\u06a9" },
  // player ne court ki booking cancel kar di
  { kind: "booking words", expected: "player ne court ki booking cancel kar di", input: "\u067e\u0644\u06cc\u0626\u0631 \u0646\u06d2 \u06a9\u0648\u0631\u0679 \u06a9\u06cc \u0628\u06a9\u0646\u06af \u06a9\u06cc\u0646\u0633\u0644 \u06a9\u0631 \u062f\u06cc" },
  // is ne kaha paise wapas karo
  { kind: "booking words", expected: "is ne kaha paise wapas karo", input: "\u0627\u0633 \u0646\u06d2 \u06a9\u06c1\u0627 \u067e\u06cc\u0633\u06d2 \u0648\u0627\u067e\u0633 \u06a9\u0631\u0648" },
  // dhai hazaar jazzcash par bheje
  { kind: "numbers", expected: "2500 jazzcash par bheje", input: "\u0688\u06be\u0627\u0626\u06cc \u06c1\u0632\u0627\u0631 \u062c\u0627\u0632 \u06a9\u06cc\u0634 \u067e\u0631 \u0628\u06be\u06cc\u062c\u06d2" },
  // aaj raat nau baje ki booking hai
  { kind: "everyday", expected: "aaj raat nau baje ki booking hai", input: "\u0622\u062c \u0631\u0627\u062a \u0646\u0648 \u0628\u062c\u06d2 \u06a9\u06cc \u0628\u06a9\u0646\u06af \u06c1\u06d2" },
  // advance ka screenshot whatsapp par bhej diya
  { kind: "English mixed", expected: "advance ka screenshot whatsapp par bhej diya", input: "\u0627\u06cc\u0688\u0648\u0627\u0646\u0633 \u06a9\u0627 \u0627\u0633\u06a9\u0631\u06cc\u0646 \u0634\u0627\u0679 \u0648\u0627\u0679\u0633 \u0627\u06cc\u067e \u067e\u0631 \u0628\u06be\u06cc\u062c \u062f\u06cc\u0627" },
  // Abbas Zafar ne sirf ek hazaar diye
  { kind: "name", expected: "abbas zafar ne sirf 1000 diye", input: "\u0639\u0628\u0627\u0633 \u0638\u0641\u0631 \u0646\u06d2 \u0635\u0631\u0641 \u0627\u06cc\u06a9 \u06c1\u0632\u0627\u0631 \u062f\u06cc\u06d2" },
  // Salman kal aa kar baqi dega
  { kind: "name", expected: "salman kal aa kar baqi dega", input: "\u0633\u0644\u0645\u0627\u0646 \u06a9\u0644 \u0622 \u06a9\u0631 \u0628\u0627\u0642\u06cc \u062f\u06d2 \u06af\u0627" },
  // malik ko bata dein payment ho gayi (English word returned in Latin letters)
  { kind: "English mixed", expected: "malik ko bata dein payment ho gayi", input: "\u0645\u0627\u0644\u06a9 \u06a9\u0648 \u0628\u062a\u0627 \u062f\u06cc\u06ba payment \u06c1\u0648 \u06af\u0626\u06cc" },
  // teen hazaar mein se do hazaar mil gaye
  { kind: "numbers", expected: "3000 mein se 2000 mil gaye", input: "\u062a\u06cc\u0646 \u06c1\u0632\u0627\u0631 \u0645\u06cc\u06ba \u0633\u06d2 \u062f\u0648 \u06c1\u0632\u0627\u0631 \u0645\u0644 \u06af\u0626\u06d2" },
  // saadhe teen hazaar poore de diye
  { kind: "numbers", expected: "3500 poore de diye", input: "\u0633\u0627\u0691\u06be\u06d2 \u062a\u06cc\u0646 \u06c1\u0632\u0627\u0631 \u067e\u0648\u0631\u06d2 \u062f\u06d2 \u062f\u06cc\u06d2" },
  // parson subah das baje aayega
  { kind: "everyday", expected: "parson subah das baje aayega", input: "\u067e\u0631\u0633\u0648\u06ba \u0635\u0628\u062d \u062f\u0633 \u0628\u062c\u06d2 \u0622\u0626\u06d2 \u06af\u0627" },
  // bakaya raqam pandrah sau rupay
  { kind: "numbers", expected: "bakaya raqam 1500 rupay", input: "\u0628\u0642\u0627\u06cc\u0627 \u0631\u0642\u0645 \u067e\u0646\u062f\u0631\u06c1 \u0633\u0648 \u0631\u0648\u067e\u06d2" },
  // 2000 rupay advance aa gaya (Urdu digits)
  { kind: "numbers", expected: "2000 rupay advance aa gaya", input: "\u06f2\u06f0\u06f0\u06f0 \u0631\u0648\u067e\u06d2 \u0627\u06cc\u0688\u0648\u0627\u0646\u0633 \u0622 \u06af\u06cc\u0627" },
  // okay main check kar ke batata hoon
  { kind: "English mixed", expected: "okay main check kar ke batata hoon", input: "\u0627\u0648\u06a9\u06d2 \u0645\u06cc\u06ba \u0686\u06cc\u06a9 \u06a9\u0631 \u06a9\u06d2 \u0628\u062a\u0627\u062a\u0627 \u06c1\u0648\u06ba" },
  // khel khatam hone ke baad paise dega
  { kind: "everyday", expected: "khel khatam hone ke baad paise dega", input: "\u06a9\u06be\u06cc\u0644 \u062e\u062a\u0645 \u06c1\u0648\u0646\u06d2 \u06a9\u06d2 \u0628\u0639\u062f \u067e\u06cc\u0633\u06d2 \u062f\u06d2 \u06af\u0627" },
  // meri booking cancel kar do (English words in Latin letters)
  { kind: "English mixed", expected: "meri booking cancel kar do", input: "\u0645\u06cc\u0631\u06cc booking cancel \u06a9\u0631 \u062f\u0648" },
  // en-IN mode: Chrome returns Latin; the fix layer still normalises spelling and numbers
  { kind: "English mixed", expected: "customer ne advance 1000 diya baqi 2500 kal", input: "customer ne advance 1000 diya baaki do hazar paanch sau kal" },
  // ---- held out: added after the last dictionary change and not tuned for ----
  // Ahmad bhai ne do sau rupay kam diye
  { heldOut: true, kind: "name", expected: "ahmad bhai ne 200 rupay kam diye", input: "\u0627\u062d\u0645\u062f \u0628\u06be\u0627\u0626\u06cc \u0646\u06d2 \u062f\u0648 \u0633\u0648 \u0631\u0648\u067e\u06d2 \u06a9\u0645 \u062f\u06cc\u06d2" },
  // court number do ki light theek nahi thi
  { heldOut: true, kind: "English mixed", expected: "court number do ki light theek nahi thi", input: "\u06a9\u0648\u0631\u0679 \u0646\u0645\u0628\u0631 \u062f\u0648 \u06a9\u06cc \u0644\u0627\u0626\u0679 \u0679\u06be\u06cc\u06a9 \u0646\u06c1\u06cc\u06ba \u062a\u06be\u06cc" },
  // main abhi unhen phone karta hoon
  { heldOut: true, kind: "everyday", expected: "main abhi unhen phone karta hoon", input: "\u0645\u06cc\u06ba \u0627\u0628\u06be\u06cc \u0627\u0646\u06c1\u06cc\u06ba \u0641\u0648\u0646 \u06a9\u0631\u062a\u0627 \u06c1\u0648\u06ba" },
  // baarish ki wajah se match jaldi khatam ho gaya
  { heldOut: true, kind: "everyday", expected: "baarish ki wajah se match jaldi khatam ho gaya", input: "\u0628\u0627\u0631\u0634 \u06a9\u06cc \u0648\u062c\u06c1 \u0633\u06d2 \u0645\u06cc\u0686 \u062c\u0644\u062f\u06cc \u062e\u062a\u0645 \u06c1\u0648 \u06af\u06cc\u0627" },
  // ek hazaar advance baqi chaar hazaar counter par
  { heldOut: true, kind: "numbers", expected: "1000 advance baqi 4000 counter par", input: "\u0627\u06cc\u06a9 \u06c1\u0632\u0627\u0631 \u0627\u06cc\u0688\u0648\u0627\u0646\u0633 \u0628\u0627\u0642\u06cc \u0686\u0627\u0631 \u06c1\u0632\u0627\u0631 \u06a9\u0627\u0624\u0646\u0679\u0631 \u067e\u0631" },
];

function words(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Word-level edit distance (substitutions, insertions, deletions). */
function wordDistance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function measure(cases: Case[] = PHRASES) {
  let exact = 0;
  let errors = 0;
  let total = 0;
  const rows = cases.map((c) => {
    const got = toRomanUrdu(c.input);
    const e = words(c.expected);
    const dist = wordDistance(words(got), e);
    total += e.length;
    errors += dist;
    if (dist === 0) exact += 1;
    const wrong = words(got).filter((w) => !e.includes(w));
    return { kind: c.kind, expected: c.expected, got, ok: dist === 0, wrong };
  });
  return { rows, exactRate: exact / cases.length, wordAccuracy: 1 - errors / total, exact, n: cases.length };
}

test("voice pipeline accuracy on the phrase set", () => {
  const r = measure();
  const lines = r.rows.map((row) => `${row.ok ? "OK  " : "MISS"} [${row.kind}] ${row.got}${row.ok ? "" : `   (expected: ${row.expected}; wrong: ${row.wrong.join(", ")})`}`);
  const h = measure(PHRASES.filter((c) => c.heldOut));
  console.log(
    `\n${lines.join("\n")}\nALL: exact ${r.exact}/${r.n} = ${(r.exactRate * 100).toFixed(0)}%, word accuracy ${(r.wordAccuracy * 100).toFixed(1)}%` +
      `\nHELD OUT: exact ${h.exact}/${h.n} = ${(h.exactRate * 100).toFixed(0)}%, word accuracy ${(h.wordAccuracy * 100).toFixed(1)}%\n`,
  );
  assert.ok(PHRASES.length >= 15);
  // floors, so a change that makes the pipeline worse fails here
  assert.ok(r.wordAccuracy >= 0.85, `word accuracy ${r.wordAccuracy}`);
  assert.ok(r.exactRate >= 0.6, `exact rate ${r.exactRate}`);
  // every number phrase must come out with the right digits
  for (const row of r.rows.filter((x) => x.kind === "numbers")) {
    const want = row.expected.match(/\d+/g) ?? [];
    const got = row.got.match(/\d+/g) ?? [];
    assert.deepEqual(got, want, `digits in "${row.got}"`);
  }
});
