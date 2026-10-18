// What the mic writes into the field: Urdu script -> Roman Urdu letters, then the booking-word and number fixes.
import { romanFix } from "./roman-fix";
import { transliterate } from "./transliterate";

/** Recogniser text (Urdu script, Latin, or mixed) -> Roman Urdu, single-spaced and trimmed. */
export function toRomanUrdu(text: string): string {
  return romanFix(transliterate(text)).replace(/\s+/g, " ").trim();
}

/** Appends a spoken phrase to what is already typed, with one space between them, cut to `maxLength` when given. */
export function appendPhrase(current: string, phrase: string, maxLength?: number): string {
  const p = phrase.trim();
  if (!p) return current;
  const joined = current && !/\s$/.test(current) ? `${current} ${p}` : `${current}${p}`;
  return maxLength !== undefined ? joined.slice(0, maxLength) : joined;
}
