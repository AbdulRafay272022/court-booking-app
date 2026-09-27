import { PASSWORD_MIN_LENGTH } from "./user";

/**
 * Client-side form validation shared by web and mobile, so the "smart submit button"
 * (disabled until every field is actually VALID, not just non-empty) means the same
 * thing on both. The backend re-validates everything; this only decides what the UI
 * lets a user try.
 */

/** Reduces whatever the user typed (`0300 1234567`, `+92 300 1234567`, `3001234567`) to the
 * 10 national digits after +92. May return fewer/more digits if the input is incomplete. */
export function pkNationalDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("92") && d.length > 10) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/** Pakistani mobile numbers: 10 digits after +92, starting with 3 (e.g. 3004408817). */
export function isValidPkMobile(input: string): boolean {
  const d = pkNationalDigits(input);
  return d.length === 10 && d.startsWith("3");
}

export function toE164(input: string): string {
  return `+92${pkNationalDigits(input)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isValidOtp(v: string): boolean {
  return /^\d{6}$/.test(v);
}

export function isValidName(v: string): boolean {
  return v.trim().replace(/\s+/g, " ").length >= 2;
}

/** Count Unicode codepoints, not UTF-16 code units. JavaScript's built-in `.length` counts
 * code units, so an astral-plane character (most emoji) contributes 2 -- meanwhile the
 * server-side check in Python uses `len()` which counts codepoints. Without this, a password
 * like "パスワード💪1" (7 real characters) looks valid client-side (length 8: the 💪 counts as
 * 2 UTF-16 code units) but is rejected 422 by the backend. The spread iterator walks
 * codepoints, matching Python. */
export function codepointLength(v: string): number {
  return Array.from(v).length;
}

/** Returns an error message for an invalid password, or null. Length only, on purpose: no
 * complexity rules until the project owner decides on them (see Section 26 notes). Counts
 * codepoints so it agrees with the backend's Python `len()` -- see codepointLength above for
 * why the naive `.length` disagrees on emoji. */
export function passwordError(v: string): string | null {
  return codepointLength(v) >= PASSWORD_MIN_LENGTH ? null : `Use at least ${PASSWORD_MIN_LENGTH} characters`;
}

export interface SignupFields {
  name: string;
  email: string;
  phone: string;
  city: string;
  gender: string;
  password: string;
  confirmPassword: string;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Every problem with the signup form right now (empty object = valid). `touched` lets the
 * UI show an error under a field only after the user has been there; the button gate
 * (`Object.keys(errors).length === 0`) doesn't care about touched. */
export function validateSignup(f: SignupFields): FieldErrors<keyof SignupFields> {
  const e: FieldErrors<keyof SignupFields> = {};
  if (!isValidName(f.name)) e.name = "Enter your full name";
  if (!isValidEmail(f.email)) e.email = "Enter a valid email address";
  if (!isValidPkMobile(f.phone)) e.phone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.city) e.city = "Choose your city";
  if (!f.gender) e.gender = "Choose an option";
  const pw = passwordError(f.password);
  if (pw) e.password = pw;
  if (!f.confirmPassword) e.confirmPassword = "Confirm your password";
  else if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match";
  return e;
}

export function validateLogin(f: { phone: string; password: string }): FieldErrors<"phone" | "password"> {
  const e: FieldErrors<"phone" | "password"> = {};
  if (!isValidPkMobile(f.phone)) e.phone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.password) e.password = "Enter your password";
  return e;
}

export function validateNewPassword(f: {
  password: string;
  confirmPassword: string;
}): FieldErrors<"password" | "confirmPassword"> {
  const e: FieldErrors<"password" | "confirmPassword"> = {};
  const pw = passwordError(f.password);
  if (pw) e.password = pw;
  if (!f.confirmPassword) e.confirmPassword = "Confirm your password";
  else if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match";
  return e;
}

// ---- Bank details ------------------------------------------------------------------------
// QA (signup-venue round, item 5): "!!!", "abc" and empty-ish strings previously saved with 201.
// These fields drive real player payouts, so obvious garbage must be refused -- but not so
// tightly that a legitimate Pakistani account number or a real bank name gets rejected. The
// exact same checks live server-side in app/schemas/venue.py's BankDetailsIn (Pydantic
// validators) so client and server can't drift on what counts as "valid".

const BANK_TITLE_ALLOWED = /^[A-Za-z][A-Za-z0-9 .,'&()/-]{1,79}$/;
const PK_ACCOUNT_DIGITS = /^\d{8,24}$/;
const PK_IBAN = /^PK\d{2}[A-Z0-9]{20}$/;

export function bankNameError(v: string): string | null {
  const t = v.trim();
  if (!t) return "Enter your bank or wallet name";
  return BANK_TITLE_ALLOWED.test(t)
    ? null
    : "Enter a real bank / wallet name (e.g. 'HBL', 'Meezan Bank', 'JazzCash', 'Easypaisa').";
}

export function accountTitleError(v: string): string | null {
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return "Enter the account title";
  const parts = t.split(" ");
  if (parts.length < 2 || parts.some((p) => p.length < 2)) {
    return "Enter the full name printed on the bank account (e.g. 'Ali Raza').";
  }
  return BANK_TITLE_ALLOWED.test(t) ? null : "Enter the full name printed on the bank account.";
}

export function accountNumberError(v: string): string | null {
  const t = v.replace(/[\s-]/g, "");
  if (!t) return "Enter your account number";
  return PK_ACCOUNT_DIGITS.test(t)
    ? null
    : "Enter your account number (digits only, 8-24 characters).";
}

export function ibanError(v: string | null | undefined): string | null {
  if (!v) return null; // IBAN is optional
  const t = v.replace(/\s/g, "").toUpperCase();
  return PK_IBAN.test(t)
    ? null
    : "Enter a valid Pakistani IBAN (starts with PK and is 24 characters), or leave it blank.";
}

export interface BankDetailsFields {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban?: string | null;
}

export function bankDetailsError(f: BankDetailsFields): FieldErrors<keyof BankDetailsFields> {
  const e: FieldErrors<keyof BankDetailsFields> = {};
  const b = bankNameError(f.bankName);
  if (b) e.bankName = b;
  const t = accountTitleError(f.accountTitle);
  if (t) e.accountTitle = t;
  const n = accountNumberError(f.accountNumber);
  if (n) e.accountNumber = n;
  const i = ibanError(f.iban ?? null);
  if (i) e.iban = i;
  return e;
}

/** `MM:SS` for a countdown; clamps below zero. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface ProfileFields {
  name: string;
  email: string;
  city: string;
  gender: string;
}

/** Edit-profile validation (name/email/city/gender). Phone and password are not fields here. */
export function validateProfile(f: ProfileFields): FieldErrors<keyof ProfileFields> {
  const e: FieldErrors<keyof ProfileFields> = {};
  if (!isValidName(f.name)) e.name = "Enter your full name";
  if (!isValidEmail(f.email)) e.email = "Enter a valid email address";
  if (!f.city) e.city = "Choose your city";
  if (!f.gender) e.gender = "Choose an option";
  return e;
}

/** Phone-change form: the new number plus the CURRENT password (re-authentication). */
export function validatePhoneChange(f: { newPhone: string; password: string }): FieldErrors<"newPhone" | "password"> {
  const e: FieldErrors<"newPhone" | "password"> = {};
  if (!isValidPkMobile(f.newPhone)) e.newPhone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.password) e.password = "Enter your current password";
  return e;
}

/** "HH:MM", 24-hour. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One day's opening hours. `close` at or before `open` is valid (Section 32 Part 3): the court closes the NEXT morning
 * (3 PM to 3 AM), and close == open means open 24 hours. A schedule day belongs to the day it opens. Returns a user-facing
 * message only when a time is missing, or null when the pair is fine. */
export function scheduleHoursError(open: string, close: string): string | null {
  if (!HHMM.test(open) || !HHMM.test(close)) return "Choose an opening time and a closing time.";
  return null;
}

/** "same day", "next day" (3 PM to 3 AM: closes the next morning) or "24 hours" (close == open). */
export function hoursKind(open: string, close: string): "same-day" | "next-day" | "24-hours" {
  if (close === open) return "24-hours";
  return close < open ? "next-day" : "same-day";
}

/** The whole week: one shared pair, or a pair per day (a day with no override uses the shared
 * one). `dayLabels[i]` names day `i` in the message. */
export function weeklyHoursError(
  sameEveryDay: boolean,
  defaultOpen: string,
  defaultClose: string,
  overrides: Partial<Record<number, { open: string; close: string }>>,
  dayLabels: readonly string[],
): string | null {
  if (sameEveryDay) return scheduleHoursError(defaultOpen, defaultClose);
  const week: { open: string; close: string }[] = [];
  for (let day = 0; day < 7; day++) {
    const o = overrides[day] ?? { open: defaultOpen, close: defaultClose };
    const problem = scheduleHoursError(o.open, o.close);
    if (problem) return `${dayLabels[day] ?? `Day ${day}`}: ${problem}`;
    week.push(o);
  }
  // An overnight day must not run into the next day's opening (Thu until 3 AM, Fri opens 2 AM). The week wraps.
  for (let day = 0; day < 7; day++) {
    const today = week[day];
    const next = week[(day + 1) % 7];
    if (hoursKind(today.open, today.close) !== "same-day" && today.close > next.open) {
      const name = dayLabels[day] ?? `Day ${day}`;
      const nextName = dayLabels[(day + 1) % 7] ?? `Day ${(day + 1) % 7}`;
      return `${name} runs until the next morning, past the time ${nextName} opens. Open ${nextName} later, or close ${name} earlier.`;
    }
  }
  return null;
}
