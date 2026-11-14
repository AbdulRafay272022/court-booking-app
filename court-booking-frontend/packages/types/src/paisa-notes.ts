/**
 * Ledger v2 (founder 14 Nov): the notes the SYSTEM writes on payment entries and adjustments are stored as text (some
 * English, some Roman Urdu, from several generations of the code). The screens show them through this one helper so a
 * system note reads in the viewer's language. A note an owner / staff member typed is shown as it is.
 */
import type { PaisaLang } from "./paisa-text";

type Rule = { re: RegExp; ru: (m: RegExpMatchArray) => string; en: (m: RegExpMatchArray) => string };

const R = (re: RegExp, ru: string | ((m: RegExpMatchArray) => string), en: string | ((m: RegExpMatchArray) => string)): Rule => ({
  re,
  ru: typeof ru === "string" ? () => ru : ru,
  en: typeof en === "string" ? () => en : en,
});

const RULES: Rule[] = [
  R(/^Advance$/, "Advance", "Advance"),
  R(/^Advance credited at approval$/, "Approve par advance mila", "Advance received at approval"),
  R(/^Balance$/, "Baqi", "Balance"),
  R(/^Balance received$/, "Baqi mila", "Balance received"),
  R(/^Balance by transfer \(screenshot approved\)$/, "Baqi transfer se mila (screenshot approve)", "Balance by transfer (screenshot approved)"),
  R(/^Walk-in booking$/, "Walk-in booking", "Walk-in booking"),
  R(/^Booking completed$/, "Booking mukammal", "Booking completed"),
  R(/^Booking completed: cash$/, "Booking mukammal: cash mila", "Booking completed: cash"),
  R(/^Booking completed: balance received$/, "Booking mukammal: baqi mila", "Booking completed: balance received"),
  R(/^Booking completed: correction to the amount received$/, "Booking mukammal: mili hui raqam theek ki", "Booking completed: amount received corrected"),
  R(/^Booking completed: owner says PKR ([\d,]+) received$/, (m) => `Booking mukammal: owner ke mutabiq PKR ${m[1]} mila`, (m) => `Booking completed: owner says PKR ${m[1]} received`),
  R(/^Refund paid \((.*?)\)(?: -- partial, PKR ([\d,]+) still owed)?$/,
    (m) => `Refund diya (${m[1]})${m[2] ? ` · PKR ${m[2]} abhi baqi` : ""}`,
    (m) => `Refund paid (${m[1]})${m[2] ? ` · PKR ${m[2]} still owed` : ""}`),
  R(/^Refund taken back by Khelo: the player did not receive it \(escalation (\w+)\)$/,
    (m) => `Khelo ne refund wapas khola: player ko nahi mila (shikayat ${m[1]})`,
    (m) => `Refund reopened by Khelo: the player did not receive it (complaint ${m[1]})`),
  R(/^backfill: refund paid \((.*?)\)$/, (m) => `Purana refund (${m[1]})`, (m) => `Earlier refund (${m[1]})`),
  R(/^backfill: money received above what was credited \(\w+\)$/, "Purana: hisaab se zyada paisa mila", "Earlier: more money received than was credited"),
  R(/^Jama se diya$/, "Jama se diya", "Paid from credit"),
  R(/^Zyada paisa: player ke jama mein$/, "Zyada paisa: player ke jama mein", "Extra money: kept as player credit"),
  R(/^Refund ki jagah player ke jama mein$/, "Refund ki jagah player ke jama mein", "Kept as player credit instead of a refund"),
  R(/^Purana baqi mila \(due done\)$/, "Purana baqi mila", "Earlier due received"),
  R(/^No-show hataya: cash mila$/, "No-show hataya: cash mila", "No-show removed: cash received"),
  R(/^No-show hataya$/, "No-show hataya", "No-show removed"),
  R(/^No-show hatane par final raqam$/, "No-show hatane par asal raqam", "Final amount after removing the no-show"),
  R(/^No-show: advance rakha, baqi charge nahi$/, "No-show: advance rakha, baqi charge nahi", "No-show: advance kept, nothing more charged"),
  R(/^Staff se wasool: (.+) \(bank mein nahi mila\)$/, (m) => `Staff se wasool: ${m[1]} (bank mein nahi mila)`, (m) => `Collected from staff: ${m[1]} (not in the bank)`),
  R(/^Bank mein nahi mila(?: \([0-9a-f-]+\))?$/, "Bank mein nahi mila", "Not in the bank"),
  R(/^Owner ne maaf kiya$/, "Owner ne maaf kiya", "Waived by the owner"),
  R(/^Khelo ne player ke haq mein faisla kiya$/, "Khelo ne player ke haq mein faisla kiya", "Khelo decided for the player"),
  R(/^Cancel: advance rakha$/, "Cancel: advance rakha", "Cancelled: advance kept"),
  R(/^Cancel: sab wapas$/, "Cancel: sab wapas", "Cancelled: all refunded"),
  R(/^Cancel$/, "Cancel", "Cancelled"),
  R(/^(\d+) points$/, (m) => `${m[1]} points`, (m) => `${m[1]} points`),
  R(/^Rs (\d+) discount$/, (m) => `Rs ${m[1]} chhoot`, (m) => `Rs ${m[1]} discount`),
];

/** A stored note in the viewer's language (system notes translated; anything else unchanged). */
export function paisaNote(note: string | null | undefined, lang: PaisaLang): string | null {
  if (!note) return null;
  const n = note.trim();
  for (const r of RULES) {
    const m = n.match(r.re);
    if (m) return lang === "en" ? r.en(m) : r.ru(m);
  }
  return n;
}
