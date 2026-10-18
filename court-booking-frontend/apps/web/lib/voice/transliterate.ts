// Rule-based Urdu script -> Roman Urdu transliteration (A9, free: no API, no server). Pure, unit-tested in transliterate.test.ts.
//
// The source stays ASCII: every Urdu letter is written through a private one-character ASCII code (ENC below) and decoded to the
// real Unicode code point with String.fromCharCode when the module loads. Words are looked up in a dictionary first (common
// booking and everyday words, written in that code); anything else goes through a letter map with a short-vowel heuristic
// (Urdu script does not write short vowels, so "kl" must become "kal").

/** ASCII code -> Urdu code point. Only used to write the dictionary readably; the input is always real Urdu text. */
const ENC: Record<string, number> = {
  A: 0x0627, // alef
  "|": 0x0622, // alef madda
  b: 0x0628,
  p: 0x067e,
  t: 0x062a,
  T: 0x0679, // tteh
  C: 0x062b, // theh
  j: 0x062c,
  c: 0x0686, // tcheh
  H: 0x062d, // hah
  x: 0x062e, // khah
  d: 0x062f,
  D: 0x0688, // ddal
  Q: 0x0630, // thal
  r: 0x0631,
  R: 0x0691, // rreh
  z: 0x0632,
  J: 0x0698, // jeh
  s: 0x0633,
  $: 0x0634, // sheen
  S: 0x0635, // sad
  Z: 0x0636, // dad
  V: 0x0637, // tah
  X: 0x0638, // zah
  E: 0x0639, // ain
  G: 0x063a, // ghain
  f: 0x0641,
  q: 0x0642,
  k: 0x06a9, // keheh
  g: 0x06af, // gaf
  l: 0x0644,
  m: 0x0645,
  n: 0x0646,
  N: 0x06ba, // noon ghunna
  w: 0x0648,
  h: 0x06c1, // heh goal
  "@": 0x06be, // heh doachashmee
  y: 0x06cc, // farsi yeh
  Y: 0x06d2, // yeh barree
  "'": 0x0626, // yeh with hamza
  "`": 0x0621, // hamza
  u: 0x0624, // waw with hamza
};

/** Decode the private ASCII code to Urdu text (exported for tests that want to build input readably). */
export function ur(code: string): string {
  let out = "";
  for (const ch of code) out += ENC[ch] !== undefined ? String.fromCharCode(ENC[ch]) : ch;
  return out;
}

const U = (name: keyof typeof ENC) => String.fromCharCode(ENC[name]);
const ALEF = U("A");
const ALEF_MADDA = U("|");
const WAW = U("w");
const YEH = U("y");
const YEH_BARREE = U("Y");
const HEH = U("h");
const DO_CHASHMI = U("@");
const NOON_GHUNNA = U("N");
const AIN = U("E");
const HAMZA = U("`");
const YEH_HAMZA = U("'");
const WAW_HAMZA = U("u");

/** Consonant letters and their Roman value. */
const CONSONANTS: Record<string, string> = {};
for (const [code, roman] of [
  ["b", "b"], ["p", "p"], ["t", "t"], ["T", "t"], ["C", "s"], ["j", "j"], ["c", "ch"], ["H", "h"], ["x", "kh"], ["d", "d"],
  ["D", "d"], ["Q", "z"], ["r", "r"], ["R", "r"], ["z", "z"], ["J", "zh"], ["s", "s"], ["$", "sh"], ["S", "s"], ["Z", "z"],
  ["V", "t"], ["X", "z"], ["G", "gh"], ["f", "f"], ["q", "q"], ["k", "k"], ["g", "g"], ["l", "l"], ["m", "m"], ["n", "n"],
] as const) {
  CONSONANTS[U(code)] = roman;
}

/** Variant code points folded to the letters above (Arabic forms Chrome sometimes returns, presentation forms excluded). */
const FOLD: Record<number, string> = {
  0x0643: U("k"), // arabic kaf
  0x064a: YEH, // arabic yeh
  0x0649: YEH, // alef maksura
  0x0647: HEH, // arabic heh
  0x06c2: HEH, // heh goal with hamza
  0x06c0: HEH, // heh with yeh above
  0x06d3: YEH_HAMZA + YEH_BARREE, // yeh barree with hamza
  0x0623: ALEF, // alef with hamza above
  0x0625: ALEF, // alef with hamza below
  0x0671: ALEF, // alef wasla
  0x06d5: HEH, // ae
};

const ZABAR = String.fromCharCode(0x064e);
const ZER = String.fromCharCode(0x0650);
const PESH = String.fromCharCode(0x064f);
const SHADDA = String.fromCharCode(0x0651);
const SUKUN = String.fromCharCode(0x0652);
const TANWEEN = String.fromCharCode(0x064b);
const DIACRITIC_VOWEL: Record<string, string> = { [ZABAR]: "a", [ZER]: "i", [PESH]: "u", [SUKUN]: "", [TANWEEN]: "an" };

/**
 * Dictionary: ASCII-coded Urdu spelling -> Roman Urdu. Keys may be two words ("ry fnD") for words Chrome splits.
 * Kept to everyday and booking words; names and rare words go through the letter rules.
 */
const DICTIONARY_CODED: ReadonlyArray<readonly [string, string]> = [
  // grammar and everyday words
  ["hY", "hai"], ["hyN", "hain"], ["t@A", "tha"], ["t@Y", "the"], ["t@y", "thi"], ["kh", "ke"], ["kA", "ka"], ["ky", "ki"],
  ["kY", "ke"], ["kw", "ko"], ["sY", "se"], ["nY", "ne"], ["pr", "par"], ["myN", "mein"], ["tk", "tak"], ["Awr", "aur"],
  ["yA", "ya"], ["yh", "yeh"], ["wh", "woh"], ["As", "is"], ["Ab", "ab"], ["jb", "jab"], ["tb", "tab"],
  ["nhyN", "nahi"], ["nhy", "nahi"], ["jy", "ji"], ["hAN", "haan"], ["|j", "aaj"], ["kl", "kal"], ["Ab@y", "abhi"],
  ["b@y", "bhi"], ["lykn", "lekin"], ["mgr", "magar"], ["Agr", "agar"], ["tw", "to"], ["hy", "hi"], ["sb", "sab"],
  ["kc@", "kuch"], ["kyA", "kya"], ["kywN", "kyun"], ["kb", "kab"], ["kysY", "kaise"], ["ktnA", "kitna"], ["ktnY", "kitne"],
  ["khAN", "kahan"], ["|p", "aap"], ["hm", "hum"], ["mjhY", "mujhe"], ["AsY", "use"], ["Ayk", "ek"], ["pAs", "paas"],
  ["bAt", "baat"], ["cAhy'Y", "chahiye"], ["cAhyY", "chahiye"], ["bht", "bohat"], ["bs", "bas"], ["Ad@r", "idhar"],
  ["kw'y", "koi"], ["swAl", "sawal"], ["jwAb", "jawab"], ["tm", "tum"], ["T@yk", "theek"], ["SHyH", "sahi"],
  ["GlV", "ghalat"], ["dwbArh", "dobara"], ["AglY", "agle"], ["AglA", "agla"], ["hftY", "hafte"], ["hfth", "hafta"],
  ["pyr", "peer"],
  // verbs (the recogniser often writes the future ending as its own word: "dY gA")
  ["khA", "kaha"], ["khtA", "kehta"], ["khty", "kehti"], ["khtY", "kehte"], ["dYgA", "dega"], ["dY gA", "dega"],
  ["dYgy", "degi"], ["dY gy", "degi"], ["dYNgY", "denge"], ["dYN gY", "denge"], ["dY", "de"], ["dw", "do"], ["dyA", "diya"],
  ["dyY", "diye"], ["dynA", "dena"], ["dYnY", "dene"], ["lyA", "liya"], ["lyY", "liye"], ["lYgA", "lega"], ["lY gA", "lega"],
  ["lYNgY", "lenge"], ["lYN gY", "lenge"], ["mlA", "mila"], ["mlY", "mile"], ["mly", "mili"], ["mlYgA", "milega"],
  ["mlY gA", "milega"], ["mlYNgY", "milenge"], ["mlYN gY", "milenge"], ["|yA", "aaya"], ["|'y", "aayi"], ["|'YgA", "aayega"],
  ["|'Y gA", "aayega"], ["|'Y", "aaye"], ["gyA", "gaya"], ["g'Y", "gaye"], ["g'y", "gayi"], ["krnA", "karna"], ["krY", "kare"],
  ["kryN", "karein"], ["kr", "kar"], ["rhY", "rahe"], ["rhtY", "rehte"], ["rhty", "rehti"], ["rhtA", "rehta"], ["rhA", "raha"],
  ["rhy", "rahi"], ["rh", "reh"], ["hw", "ho"], ["hwA", "hua"], ["hw'y", "hui"], ["hw'Y", "hue"], ["hwgA", "hoga"],
  ["hw gA", "hoga"], ["hwgy", "hogi"], ["hw gy", "hogi"], ["hwNgY", "honge"], ["bwlA", "bola"], ["bwly", "boli"],
  ["sktA", "sakta"], ["skty", "sakti"], ["skA", "saka"], ["sktY", "sakte"], ["c@wR", "chhor"], ["c@wRA", "chhora"],
  ["btAyA", "bataya"], ["b@yjA", "bheja"], ["b@yjY", "bheje"], ["b@yj", "bhej"], ["|tA", "aata"], ["|ty", "aati"],
  ["|tY", "aate"], ["jAnA", "jana"], ["rk@", "rakh"], ["rk@A", "rakha"], ["mAnA", "mana"], ["mAnY", "mane"],
  ["ml", "mil"], ["dyN", "dein"], ["lyN", "lein"], ["hwN", "hoon"], ["cyk", "check"], ["Srf", "sirf"],
  // money and numbers
  ["bqAyA", "bakaya"], ["bAqy", "baqi"], ["pysh", "paisa"], ["pysY", "paise"], ["rwpY", "rupay"], ["rwpyh", "rupaya"],
  ["wAps", "wapas"], ["|d@A", "aadha"], ["hzAr", "hazaar"], ["sw", "sau"], ["lAk@", "lakh"], ["krwR", "crore"],
  ["tyn", "teen"], ["cAr", "chaar"], ["pAnc", "paanch"], ["c@", "chhe"], ["c@Y", "chhe"], ["sAt", "saat"], ["|T@", "aath"],
  ["nw", "nau"], ["ds", "das"], ["gyArh", "gyarah"], ["bArh", "barah"], ["tyrh", "terah"], ["cwdh", "chaudah"],
  ["pndrh", "pandrah"], ["swlh", "solah"], ["strh", "satrah"], ["AT@Arh", "atharah"], ["Anys", "unnees"], ["bys", "bees"],
  ["pcys", "pachees"], ["tys", "tees"], ["cAlys", "chalees"], ["pcAs", "pachaas"], ["sAT@", "saath"], ["str", "sattar"],
  ["Assy", "assi"], ["nwY", "nabbe"], ["DyR@", "dedh"], ["D@A'y", "dhai"], ["AR@A'y", "adhai"], ["sAR@Y", "saadhe"],
  ["swA", "sawa"], ["pwnY", "paune"], ["pwrA", "poora"], ["pwry", "poori"], ["pwrY", "poore"], ["zyAdh", "zyada"],
  ["km", "kam"], ["jmE", "jama"], ["qymt", "qeemat"], ["AdA", "ada"], ["AdA'ygy", "adaigi"], ["Ad@wrA", "adhoora"],
  ["mkml", "mukammal"], ["wEdh", "wada"],
  // time
  ["SbH", "subah"], ["$Am", "shaam"], ["rAt", "raat"], ["dn", "din"], ["bjY", "baje"], ["g@nTh", "ghanta"], ["g@nTY", "ghante"],
  ["mnT", "minute"], ["dyr", "der"], ["jldy", "jaldi"], ["prswN", "parson"], ["dwphr", "dopahar"], ["bEd", "baad"],
  ["phlY", "pehle"], ["phly", "pehli"],
  // booking words (English loanwords the recogniser writes in Urdu script)
  ["bkng", "booking"], ["bwkng", "booking"], ["kwrT", "court"], ["AyDwAns", "advance"], ["pymnT", "payment"],
  ["kynsl", "cancel"], ["ry fnD", "refund"], ["ryfnD", "refund"], ["ksTmr", "customer"], ["kstmr", "customer"],
  ["plyAr", "player"], ["ply'r", "player"], ["Askryn $AT", "screenshot"], ["Askryn", "screen"], ["AkAunT", "account"],
  ["AkAwnT", "account"], ["ky$", "cash"], ["bynk", "bank"], ["fwn", "phone"], ["nmbr", "number"], ["mysj", "message"],
  ["wATs Ayp", "whatsapp"], ["wATsAyp", "whatsapp"], ["Ayp", "app"], ["TA'm", "time"], ["slAT", "slot"], ["myc", "match"],
  ["pyDl", "padel"], ["fTsAl", "futsal"], ["krkT", "cricket"], ["Awnr", "owner"], ["mynyjr", "manager"], ["sTAf", "staff"],
  ["AwkY", "okay"], ["Ayzy pysh", "easypaisa"], ["jAz ky$", "jazzcash"], ["prAblm", "problem"], ["Tym", "team"],
];

const DICTIONARY = new Map<string, string>(DICTIONARY_CODED.map(([coded, roman]) => [ur(coded), roman]));

function isUrduLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x0600 && c <= 0x06ff && !(c >= 0x06f0 && c <= 0x06f9) && !(c >= 0x0660 && c <= 0x0669) && c !== 0x060c && c !== 0x06d4 && c !== 0x061f && c !== 0x061b) || (c >= 0x0750 && c <= 0x077f);
}

function normaliseChar(ch: string): string {
  const c = ch.charCodeAt(0);
  if (FOLD[c] !== undefined) return FOLD[c];
  if (c === 0x0640 || c === 0x200c || c === 0x200d || c === 0x200f || c === 0x200e) return ""; // tatweel, ZWNJ/ZWJ, direction marks
  return ch;
}

const PUNCT: Record<string, string> = {
  [String.fromCharCode(0x060c)]: ",",
  [String.fromCharCode(0x06d4)]: ".",
  [String.fromCharCode(0x061f)]: "?",
  [String.fromCharCode(0x061b)]: ";",
  [String.fromCharCode(0x066a)]: "%",
};

function digitOf(ch: string): string | null {
  const c = ch.charCodeAt(0);
  if (c >= 0x06f0 && c <= 0x06f9) return String(c - 0x06f0);
  if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
  return null;
}

function isVowelLetter(ch: string | undefined): boolean {
  return ch === ALEF || ch === ALEF_MADDA || ch === YEH_BARREE || ch === AIN || ch === HAMZA || (ch !== undefined && DIACRITIC_VOWEL[ch] !== undefined);
}

/** Whether position j starts a consonant sound (used to decide where to insert the unwritten short "a"). */
function consonantAt(chars: string[], j: number): boolean {
  const ch = chars[j];
  if (ch === undefined) return false;
  if (CONSONANTS[ch] !== undefined || ch === YEH_HAMZA) return true;
  if (ch === HEH) return j !== chars.length - 1; // a final heh is a vowel ("paisa")
  if (ch === WAW) return j === 0 || chars[j + 1] === ALEF; // "sawal", "jawab"
  if (ch === YEH) return j === 0;
  return false;
}

/** Letter-by-letter fallback for one word (array of normalised letters). */
export function transliterateLetters(chars: string[]): string {
  let out = "";
  let prevVowel = false; // was the sound just before the current letter a vowel?
  const n = chars.length;
  for (let i = 0; i < n; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1];
    const first = i === 0;
    const last = i === n - 1;

    if (DIACRITIC_VOWEL[ch] !== undefined) {
      out += DIACRITIC_VOWEL[ch];
      prevVowel = ch !== SUKUN;
      continue;
    }
    if (ch === SHADDA) {
      const m = /([a-z]+?)(h?)$/.exec(out);
      if (m && m[1]) out += m[1].slice(-1);
      continue;
    }
    if (ch === ALEF_MADDA) {
      out += "aa";
      prevVowel = true;
      continue;
    }
    if (ch === ALEF) {
      if (first && next === YEH) {
        out += "e";
        i += 1;
      } else if (first && next === WAW) {
        out += "o";
        i += 1;
      } else out += "a";
      prevVowel = true;
      continue;
    }
    if (ch === YEH_BARREE) {
      out += "e";
      prevVowel = true;
      continue;
    }
    if (ch === AIN) {
      if (!isVowelLetter(next) && next !== WAW && next !== YEH) out += "a";
      prevVowel = true;
      continue;
    }
    if (ch === HAMZA) continue;
    if (ch === NOON_GHUNNA) {
      out += "n";
      continue;
    }
    if (ch === WAW_HAMZA) {
      out += "o";
      prevVowel = true;
      continue;
    }
    if (ch === WAW && !first && next !== ALEF) {
      out += prevVowel ? "w" : "o";
      prevVowel = !prevVowel;
      continue;
    }
    if (ch === YEH && !first) {
      if (prevVowel) {
        out += last ? "i" : "y";
        prevVowel = last;
      } else if (last) {
        out += "i";
        prevVowel = true;
      } else if (next === ALEF) {
        out += "iy";
        prevVowel = false;
      } else {
        out += "e";
        prevVowel = true;
      }
      continue;
    }
    if (ch === HEH && last && !first) {
      out += prevVowel ? "h" : "a";
      prevVowel = true;
      continue;
    }
    if (ch === DO_CHASHMI) {
      out += "h"; // a lone do-chashmi (normally eaten by the consonant before it)
      continue;
    }

    // a consonant sound
    let roman = ch === WAW ? "w" : ch === YEH ? "y" : ch === YEH_HAMZA ? "y" : ch === HEH ? "h" : (CONSONANTS[ch] ?? "");
    let j = i + 1;
    if (chars[j] === DO_CHASHMI) {
      roman += "h"; // aspirated: kh, gh, bh, ...
      j += 1;
      i += 1;
    }
    out += roman;
    if (consonantAt(chars, j)) {
      if (!prevVowel) {
        out += "a"; // onset consonant before another consonant: "kl" -> "kal"
        prevVowel = true;
      } else {
        // coda: "rak|hna"; but a single consonant left at the very end gets an "a" ("waps" -> "wapas")
        const nextLast = j === n - 1 || (j === n - 2 && chars[n - 1] === DO_CHASHMI);
        if (nextLast && chars[j] !== NOON_GHUNNA) out += "a";
        prevVowel = nextLast;
      }
    } else {
      prevVowel = false;
    }
  }
  return out;
}

function transliterateWord(word: string): string {
  const hit = DICTIONARY.get(word);
  if (hit !== undefined) return hit;
  return transliterateLetters([...word]);
}

type Token = { kind: "urdu" | "other"; text: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buf = "";
  let bufKind: Token["kind"] | null = null;
  const flush = () => {
    if (buf) tokens.push({ kind: bufKind as Token["kind"], text: buf });
    buf = "";
    bufKind = null;
  };
  for (const raw of input) {
    const ch = normaliseChar(raw);
    if (!ch) continue;
    for (const c of ch) {
      const kind: Token["kind"] = isUrduLetter(c) ? "urdu" : "other";
      if (kind !== bufKind) flush();
      bufKind = kind;
      buf += c;
    }
  }
  flush();
  return tokens;
}

/**
 * Urdu script (or mixed Urdu + Latin) -> Roman Urdu. Latin text, digits and spacing pass through unchanged; Urdu digits and
 * punctuation become ASCII; output is lower case for the transliterated words.
 */
export function transliterate(input: string): string {
  const tokens = tokenize(input);
  // two-word dictionary entries ("ry fnD") are matched across a single space
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.kind === "urdu") {
      const space = tokens[i + 1];
      const second = tokens[i + 2];
      if (space && second && space.kind === "other" && /^\s+$/.test(space.text) && second.kind === "urdu") {
        const pair = DICTIONARY.get(`${tok.text} ${second.text}`);
        if (pair !== undefined) {
          out.push(pair);
          i += 2;
          continue;
        }
      }
      out.push(transliterateWord(tok.text));
      continue;
    }
    let text = "";
    for (const c of tok.text) text += digitOf(c) ?? PUNCT[c] ?? c;
    out.push(text);
  }
  return out.join("");
}

/** True when the text contains any Urdu-script letter. */
export function hasUrduScript(input: string): boolean {
  for (const c of input) if (isUrduLetter(c)) return true;
  return false;
}
