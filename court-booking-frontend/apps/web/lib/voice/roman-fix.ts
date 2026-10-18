// Roman Urdu correction layer (A9): fixes common spellings of booking words and turns Urdu number words into digits
// ("do hazaar paanch sau" -> "2500", "dedh hazaar" -> "1500"). Pure, unit-tested in roman-fix.test.ts. Runs on the output of
// transliterate() and on Latin text the recogniser returned directly (English mode, or English words inside Urdu mode).

/** Spelling variants -> the one spelling we write. Keys are lower case. */
const VARIANTS: Record<string, string> = {
  baki: "baqi", baaqi: "baqi", baaki: "baqi", bqi: "baqi", baqee: "baqi",
  pesa: "paisa", paysa: "paisa", paisaa: "paisa", pese: "paise", paisay: "paise", pesay: "paise",
  hazar: "hazaar", hajar: "hazaar", hazzar: "hazaar", hazaar: "hazaar", hzar: "hazaar", hazara: "hazaar",
  sao: "sau", saw: "sau",
  kall: "kal", aj: "aaj", aja: "aaj",
  adwance: "advance", advans: "advance", edvance: "advance", aydwans: "advance", edwans: "advance", adwans: "advance",
  kort: "court", koort: "court", kwrt: "court", korat: "court",
  daga: "dega", dayga: "dega", dyga: "dega", diga: "dega",
  wapis: "wapas", waps: "wapas", vapas: "wapas", vapis: "wapas",
  bkng: "booking", bukking: "booking", buking: "booking", bakang: "booking", bakng: "booking", bokng: "booking",
  pement: "payment", paymant: "payment", pemant: "payment", pemnt: "payment",
  kastmar: "customer", kustamar: "customer", customar: "customer", kasatmar: "customer", kstmr: "customer",
  rupe: "rupay", rupaye: "rupay", rupee: "rupay", rupees: "rupay", rupaiye: "rupay", ropay: "rupay", rope: "rupay",
  nahin: "nahi", nai: "nahi", nahee: "nahi", nhi: "nahi",
  hen: "hain", hayn: "hain", men: "mein",
  kenasal: "cancel", kensel: "cancel", kansal: "cancel", cancal: "cancel",
  rifand: "refund", refand: "refund", rifund: "refund",
};

const UNITS: Record<string, number> = {
  ek: 1, aik: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, panj: 5, chhe: 6, chhay: 6, che: 6, chay: 6,
  saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10, gyarah: 11, giyarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14,
  pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnees: 19, unees: 19, bees: 20, pachees: 25, tees: 30, paintees: 35,
  chalees: 40, paintalees: 45, pachaas: 50, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90, navve: 90,
};

/** Fractional numbers that stand alone ("dedh hazaar" = 1.5 x 1000). */
const FRACTIONS: Record<string, number> = { dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5 };

/** Prefixes that modify the next unit ("saadhe teen" = 3.5, "sawa do" = 2.25, "paune do" = 1.75). */
const MODIFIERS: Record<string, number> = { saadhe: 0.5, sadhe: 0.5, sarhe: 0.5, saarhe: 0.5, sawa: 0.25, paune: -0.25 };

const MULTIPLIERS: Record<string, number> = { sau: 100, so: 100, hazaar: 1000, lakh: 100000, lac: 100000, crore: 10000000, karor: 10000000 };

/** Unit words that are also common ordinary words ("do" = give, "ek" = a, "saath" = with): only numbers next to a multiplier. */
const AMBIGUOUS = new Set(["do", "ek", "aik", "saath", "sat", "tin", "che", "das", "so", "char", "ath"]);

type Tok = { word: string; sep: string };

function splitWords(text: string): Tok[] {
  const toks: Tok[] = [];
  const re = /([A-Za-z0-9]+)([^A-Za-z0-9]*)/g;
  const lead = /^[^A-Za-z0-9]*/.exec(text)?.[0] ?? "";
  if (lead) toks.push({ word: "", sep: lead });
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) toks.push({ word: m[1], sep: m[2] });
  return toks;
}

function numberKind(w: string): "unit" | "fraction" | "modifier" | "mult" | "digits" | null {
  if (/^\d+$/.test(w)) return "digits";
  if (UNITS[w] !== undefined) return "unit";
  if (FRACTIONS[w] !== undefined) return "fraction";
  if (MODIFIERS[w] !== undefined) return "modifier";
  if (MULTIPLIERS[w] !== undefined) return "mult";
  return null;
}

/** Value of a run of number words, or null when it is not a clean whole number. */
export function numberValue(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let pending = 0; // modifier waiting for its unit
  let any = false;
  for (const w of words) {
    const kind = numberKind(w);
    if (kind === "digits" || kind === "unit") {
      const v = kind === "digits" ? Number(w) : UNITS[w];
      current += v + (pending && v > 0 ? pending : 0);
      pending = 0;
      any = true;
    } else if (kind === "fraction") {
      current += FRACTIONS[w];
      any = true;
    } else if (kind === "modifier") {
      pending = MODIFIERS[w];
    } else if (kind === "mult") {
      const m = MULTIPLIERS[w];
      if (m === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * m;
        current = 0;
      }
      any = true;
    } else return null;
  }
  if (!any || pending) return null;
  const value = total + current;
  return Number.isInteger(value) ? value : null;
}

/** Should this run of number words become digits? Only when it really reads as an amount. */
function convertible(words: string[]): boolean {
  if (words.some((w) => numberKind(w) === "mult" && w !== "so")) return true;
  if (words.length === 1) {
    const w = words[0];
    return numberKind(w) === "unit" && !AMBIGUOUS.has(w) && UNITS[w] >= 10;
  }
  return false;
}

/**
 * Fixes spellings and converts number words. Unknown words keep their original case; corrected words are written in lower case.
 */
export function romanFix(text: string): string {
  const toks = splitWords(text).map((t) => {
    const lower = t.word.toLowerCase();
    const fixed = VARIANTS[lower];
    return fixed ? { word: fixed, sep: t.sep, lower: fixed } : { word: t.word, sep: t.sep, lower };
  });

  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    // a run of number words joined only by spaces
    if (t.word && numberKind(t.lower)) {
      let j = i;
      const words: string[] = [];
      while (j < toks.length && toks[j].word && numberKind(toks[j].lower)) {
        words.push(toks[j].lower);
        if (!/^\s*$/.test(toks[j].sep)) {
          j += 1;
          break;
        }
        j += 1;
      }
      // trim to the longest prefix that is a clean, convertible amount
      for (let k = words.length; k >= 1; k -= 1) {
        const part = words.slice(0, k);
        const value = numberValue(part);
        if (value !== null && convertible(part) && !(k === 1 && /^\d+$/.test(part[0]))) {
          out.push(String(value) + toks[i + k - 1].sep);
          i += k;
          break;
        }
        if (k === 1) {
          out.push(t.word + t.sep);
          i += 1;
        }
      }
      continue;
    }
    out.push(t.word + t.sep);
    i += 1;
  }
  return out.join("");
}
